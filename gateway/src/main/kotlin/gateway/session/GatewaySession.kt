package gateway.session

import gateway.coverage.DropCounter
import gateway.down.ActorBlocks
import gateway.down.BlockReader
import gateway.down.GroundItems
import gateway.down.Interfaces
import gateway.down.Items
import gateway.down.StockMarket
import gateway.down.MapRebuild
import gateway.down.NpcSync
import gateway.down.PlayerSync
import gateway.down.TspsChatMessage
import gateway.down.TspsHandshake
import gateway.down.TspsLoginResult
import gateway.tsps.TspsClientPacket
import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsSocket
import gateway.up.Upstream
import net.rsprot.protocol.api.Session
import net.rsprot.protocol.api.login.GameLoginResponseHandler
import net.rsprot.protocol.game.outgoing.info.Infos
import net.rsprot.protocol.game.outgoing.map.RebuildLoginV2
import net.rsprot.protocol.game.outgoing.misc.client.ServerTickEnd
import net.rsprot.protocol.game.outgoing.logout.Logout
import net.rsprot.protocol.game.outgoing.misc.player.MessageGame
import net.rsprot.protocol.game.outgoing.misc.player.SetMapFlagV2
import net.rsprot.protocol.game.outgoing.misc.player.UpdateRunEnergy
import net.rsprot.protocol.game.outgoing.misc.player.SetPlayerOp
import net.rsprot.protocol.loginprot.incoming.util.AuthenticationType
import net.rsprot.protocol.loginprot.incoming.util.LoginBlock
import net.rsprot.protocol.loginprot.outgoing.LoginResponse
import net.rsprot.protocol.loginprot.outgoing.util.AuthenticatorResponse
import net.rsprot.protocol.message.IncomingGameMessage
import net.rsprot.protocol.message.OutgoingGameMessage
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.logging.Logger
/**
 * One official client and the tsps session behind it.
 *
 * Everything for a session runs on its own thread: tsps packets, the client's packets and the
 * rsprot entity world. tsps drives the clock: each tick ends with its `NPC_INFO`, at which point
 * the gateway processes the client's packets, writes the info packets and flushes.
 */
class GatewaySession(
    private val context: GatewayContext,
    private val responses: GameLoginResponseHandler<GatewaySession>,
    private val block: LoginBlock<AuthenticationType>,
) : TspsSocket.Listener {
    private enum class State { CONNECTING, LOGGING_IN, ENTERING, AWAITING_SCENE, IN_GAME, CLOSED }

    private val executor: ExecutorService =
        Executors.newSingleThreadExecutor { Thread(it, "gateway-${block.username}").apply { isDaemon = true } }
    private var state = State.CONNECTING
    private lateinit var tsps: TspsSocket
    private lateinit var handshake: TspsHandshake
    private var session: Session<GatewaySession>? = null

    private val world = EntityWorld(context.allocator, context.huffman)
    private var self: Infos? = null
    private val varps = VarpMirror(context.vars)
    private val items = Items(context.objs, ::send)
    private val groundItems = GroundItems(::send)
    private val stockMarket = StockMarket(::send)
    private val interfaces = Interfaces(varps, InterfaceTree(context.enums), stockMarket, items::scriptInventories, ::send)
    private val upstream = Upstream(varps) { tsps.send(it) }
    private val players = PlayerSync()
    private val npcs = NpcSync()
    private var mirror: EntityMirror? = null
    private var level = 0

    /** The scene tsps built before the client logged in; REBUILD_LOGIN takes its place. */
    private var loginScene: MapRebuild? = null

    /** Messages produced before the client is logged in, sent right after REBUILD_LOGIN. */
    private val beforeLogin = ArrayList<OutgoingGameMessage>()
    private var lastPing = 0L

    fun start() {
        val password = (block.authentication as? AuthenticationType.PasswordAuthentication)?.password?.asString()
        if (password == null) {
            fail(LoginResponse.InvalidUsernameOrPassword)
            return
        }
        val address = responses.ctx.channel().remoteAddress().toString().substringAfter('/').substringBeforeLast(':')
        TspsSocket.connect(context.config.tspsUrl, address, this).whenComplete { socket, error ->
            executor.execute {
                if (error != null) {
                    log.warning("${block.username}: ${error.message}")
                    fail(LoginResponse.LoginServerOffline)
                    return@execute
                }
                tsps = socket
                state = State.LOGGING_IN
                tsps.send(TspsClientPacket.login(block.username, password, context.revision))
            }
        }
    }

    override fun onPackets(packets: List<TspsPacket>) = executor.execute { packets.forEach(::onTspsPacket) }

    override fun onClosed(reason: String) =
        executor.execute {
            log.info("${block.username}: $reason")
            when (state) {
                State.CLOSED -> Unit
                State.IN_GAME -> close()
                else -> fail(LoginResponse.LoginServerOffline)
            }
        }

    /** A decoded client packet, from [Session.processIncomingPackets] on this session's thread. */
    fun onClientMessage(message: IncomingGameMessage) = upstream.handle(message)

    private fun onTspsPacket(packet: TspsPacket) {
        when (state) {
            State.LOGGING_IN -> if (packet.opcode == TspsServerPacket.LOGIN_RESPONSE) onLoginResult(TspsLoginResult.decode(packet))
            State.ENTERING -> if (packet.opcode == TspsServerPacket.HANDSHAKE) onHandshake(TspsHandshake.decode(packet))
            State.AWAITING_SCENE, State.IN_GAME -> onGamePacket(packet)
            State.CONNECTING, State.CLOSED -> Unit
        }
    }

    private fun onLoginResult(result: TspsLoginResult) {
        if (!result.ok) {
            fail(result.toLoginResponse())
            return
        }
        state = State.ENTERING
        tsps.send(TspsClientPacket.handshake(block.username))
    }

    private fun onHandshake(handshake: TspsHandshake) {
        this.handshake = handshake
        state = State.AWAITING_SCENE
    }

    private fun onGamePacket(packet: TspsPacket) {
        when (packet.opcode) {
            TspsServerPacket.PLAYER_SYNC -> onPlayerSync(players.decode(packet))
            TspsServerPacket.NPC_INFO -> {
                val frame = npcs.decode(packet)
                mirror?.applyNpcs(frame, level)
                if (state == State.IN_GAME) endTick()
            }
            TspsServerPacket.CHAT_MESSAGE -> onChat(TspsChatMessage.decode(packet))
            TspsServerPacket.PLAYER_OPTION -> {
                val reader = packet.reader()
                val slot = reader.u8()
                val priority = reader.u8() != 0
                send(SetPlayerOp(slot, priority, reader.utf8().ifEmpty { null }))
            }
            TspsServerPacket.REBUILD_NORMAL -> onRebuild(MapRebuild.normal(packet))
            TspsServerPacket.REBUILD_REGION -> onRebuild(MapRebuild.region(packet))
            TspsServerPacket.DESTINATION -> {
                val reader = packet.reader()
                val x = reader.u16()
                val z = reader.u16()
                send(if (x == 0 && z == 0) SetMapFlagV2() else SetMapFlagV2(x, z))
            }
            TspsServerPacket.RUN_ENERGY -> {
                val reader = packet.reader()
                send(UpdateRunEnergy(reader.u8() * RUN_ENERGY_PER_PERCENT))
                // The run orb reads varp 173; the browser sets it from this packet itself.
                varps.setVarp(RUN_VARP, reader.u8())?.let(::send)
            }
            TspsServerPacket.LOGOUT_RESPONSE -> {
                val reader = packet.reader()
                val ok = reader.u8() != 0
                val reason = reader.string()
                if (ok) send(Logout) else if (reason.isNotEmpty()) send(MessageGame(GAME_MESSAGE, reason))
            }
            TspsServerPacket.TICK -> groundItems.tick(packet.reader().i32())
            else -> if (!interfaces.handle(packet) && !items.handle(packet) && !groundItems.handle(packet)) DropCounter.down(packet.opcode)
        }
    }

    private fun onRebuild(rebuild: MapRebuild) {
        val self = self
        if (self == null) {
            loginScene = rebuild
            return
        }
        self.updateRootBuildArea(rebuild.zoneX - SCENE_RADIUS_ZONES, rebuild.zoneZ - SCENE_RADIUS_ZONES)
        send(rebuild.toMessage())
        groundItems.rebuild(rebuild.zoneX, rebuild.zoneZ)
    }

    private fun onPlayerSync(frame: PlayerSync.Frame) {
        val tile = frame.tiles[frame.localIndex] ?: return
        level = tile.level
        if (self == null) {
            if (state != State.AWAITING_SCENE) return
            enterGame(tile)
        }
        val reader = BlockReader(frame.updateBlocks)
        val blocks = frame.updateIndices.associateWith { ActorBlocks.player(reader) }
        mirror?.applyPlayers(frame, blocks)
    }

    private fun onChat(chat: TspsChatMessage) {
        when {
            // Public chat goes overhead and to the chatbox through PLAYER_INFO.
            chat.isPublic && chat.playerIndex >= 0 -> mirror?.queueChat(chat.playerIndex, chat.text, chat.modIcon)
            chat.isGameMessage -> send(MessageGame(chat.type, chat.from.ifEmpty { null }, chat.text))
            else -> DropCounter.down(TspsServerPacket.CHAT_MESSAGE)
        }
    }

    /** tsps has placed the player: log the client in at that tile. */
    private fun enterGame(tile: PlayerSync.Tile) {
        val infos = world.allocPlayer(handshake.index)
        infos.updateRootCoord(tile.level, tile.x, tile.z)
        val scene = loginScene ?: MapRebuild.Normal(tile.x ushr 3, tile.z ushr 3)
        infos.updateRootBuildArea(scene.zoneX - SCENE_RADIUS_ZONES, scene.zoneZ - SCENE_RADIUS_ZONES)
        Appearance.apply(infos.playerInfo.avatar.extendedInfo, handshake)
        self = infos
        mirror = EntityMirror(world, context.objs, infos, handshake.index, items::selfAppearance)

        val ok =
            LoginResponse.Ok(
                authenticatorResponse = AuthenticatorResponse.NoAuthenticator,
                staffModLevel = if (handshake.admin) STAFF_ADMINISTRATOR else 0,
                playerMod = false,
                index = handshake.index,
                member = handshake.members,
                accountHash = 0,
                userId = handshake.index.toLong(),
                userHash = 0,
            )
        val session = responses.writeSuccessfulResponse(ok, block)
        session.setDisconnectionHook { executor.execute(::close) }
        this.session = session
        // REBUILD_LOGIN is always a static map; an instance follows as its own rebuild.
        session.queue(RebuildLoginV2(scene.zoneX, scene.zoneZ, MapRebuild.NO_WORLD_AREA, infos.playerInfo))
        if (scene is MapRebuild.Region) session.queue(scene.toMessage())
        groundItems.rebuild(scene.zoneX, scene.zoneZ)
        // The browser client adds these itself; tsps handles op 2 as trade and 3 as follow.
        session.queue(SetPlayerOp(TRADE_OP, false, "Trade with"))
        session.queue(SetPlayerOp(FOLLOW_OP, false, "Follow"))
        beforeLogin.forEach(session::queue)
        beforeLogin.clear()
        state = State.IN_GAME
        log.info("${handshake.name} entered at ${tile.x}, ${tile.z}, ${tile.level} (index ${handshake.index})")
    }

    private fun endTick() {
        val session = session ?: return
        val self = self ?: return
        session.processIncomingPackets(this)
        world.update()
        val root = self.getPackets().rootWorldInfoPackets
        session.queue(root.activeWorld)
        root.worldEntityInfo.getOrNull()?.let(session::queue)
        root.playerInfo.getOrNull()?.let(session::queue)
        session.queue(root.npcUpdateOrigin)
        root.npcInfo.getOrNull()?.let(session::queue)
        session.queue(ServerTickEnd)
        session.flush()
        keepAlive()
    }

    /** tsps closes a socket that has pinged once and then gone quiet for 30 s. */
    private fun keepAlive() {
        val now = System.currentTimeMillis()
        if (now - lastPing < PING_INTERVAL_MS) return
        lastPing = now
        tsps.send(TspsClientPacket.ping(now.toInt()))
    }

    private fun send(message: OutgoingGameMessage) {
        val session = session
        if (session == null) beforeLogin += message else session.queue(message)
    }

    private fun fail(response: LoginResponse) {
        if (state == State.CLOSED) return
        responses.writeFailedResponse(response)
        close()
    }

    private fun close() {
        if (state == State.CLOSED) return
        state = State.CLOSED
        if (::tsps.isInitialized) tsps.close()
        session?.flush()
        session?.requestClose()
        mirror?.release()
        mirror = null
        self?.let(world::releasePlayer)
        self = null
        executor.shutdown()
        executor.awaitTermination(0, TimeUnit.SECONDS)
    }

    private companion object {
        val log: Logger = Logger.getLogger(GatewaySession::class.java.name)
        const val STAFF_ADMINISTRATOR = 2
        const val PING_INTERVAL_MS = 5_000L
        const val SCENE_RADIUS_ZONES = 6
        const val TRADE_OP = 2
        const val RUN_VARP = 173
        const val RUN_ENERGY_PER_PERCENT = 100
        const val GAME_MESSAGE = 0

        const val FOLLOW_OP = 3
    }
}
