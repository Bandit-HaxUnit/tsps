package gateway.session

import gateway.coverage.DropCounter
import gateway.down.InitialPlayerSync
import gateway.down.TspsHandshake
import gateway.down.TspsLoginResult
import gateway.tsps.TspsClientPacket
import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsSocket
import net.rsprot.protocol.api.Session
import net.rsprot.protocol.api.login.GameLoginResponseHandler
import net.rsprot.protocol.game.outgoing.info.Infos
import net.rsprot.protocol.game.outgoing.interfaces.IfOpenTop
import net.rsprot.protocol.game.outgoing.map.RebuildLoginV2
import net.rsprot.protocol.game.outgoing.misc.client.ServerTickEnd
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
    private var root = DEFAULT_TOPLEVEL

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
    fun onClientMessage(message: IncomingGameMessage) {
        DropCounter.up(message)
    }

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
            TspsServerPacket.WIDGET_SET_ROOT -> {
                root = packet.reader().u16()
                send(IfOpenTop(root))
            }
            TspsServerPacket.PLAYER_SYNC -> if (state == State.AWAITING_SCENE) InitialPlayerSync.decodeOrNull(packet)?.let(::enterGame)
            TspsServerPacket.NPC_INFO -> if (state == State.IN_GAME) endTick()
            TspsServerPacket.TICK, TspsServerPacket.REBUILD_NORMAL -> Unit
            else -> DropCounter.down(packet.opcode)
        }
    }

    /** tsps has placed the player: log the client in at that tile. */
    private fun enterGame(sync: InitialPlayerSync) {
        val infos = world.allocPlayer(handshake.index)
        infos.updateRootCoord(sync.level, sync.x, sync.z)
        infos.updateRootBuildAreaCenteredOnPlayer(sync.x, sync.z)
        Appearance.apply(infos.playerInfo.avatar.extendedInfo, handshake)
        self = infos

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
        session.queue(RebuildLoginV2(sync.x ushr 3, sync.z ushr 3, -1, infos.playerInfo))
        beforeLogin.forEach(session::queue)
        beforeLogin.clear()
        state = State.IN_GAME
        log.info("${handshake.name} entered at ${sync.x}, ${sync.z}, ${sync.level} (index ${handshake.index})")
        endTick()
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
        session?.requestClose()
        self?.let(world::releasePlayer)
        self = null
        executor.shutdown()
        executor.awaitTermination(0, TimeUnit.SECONDS)
    }

    private companion object {
        val log: Logger = Logger.getLogger(GatewaySession::class.java.name)
        const val DEFAULT_TOPLEVEL = 161
        const val STAFF_ADMINISTRATOR = 2
        const val PING_INTERVAL_MS = 5_000L
    }
}
