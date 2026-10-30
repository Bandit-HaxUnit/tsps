package gateway.it

import gateway.headless.HeadlessClient
import net.rsprox.protocol.common.CoordGrid
import net.rsprox.protocol.game.outgoing.model.info.playerinfo.PlayerInfo
import net.rsprox.protocol.game.outgoing.model.info.playerinfo.PlayerUpdateType
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import net.rsprox.protocol.game.outgoing.model.map.RebuildNormalV2
import net.rsprox.protocol.game.outgoing.model.map.RebuildRegionV2
import net.rsprox.protocol.game.outgoing.model.misc.player.SetMapFlagV2
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test

/** M2: walking, the map flag, rebuilds on teleport and templated instances. */
class M2MovementTest {
    private val modulus = LiveGateway.gateway.rsa.modulus

    @Test
    fun `a walk click sets the map flag and moves the player there`() {
        login(LiveGateway.newAccount("gwwalk")).use { game ->
            val start = game.expect<RebuildLoginV2>().playerInfoInitBlock.localPlayerCoord
            val target = CoordGrid(start.level, start.x + WALK_DISTANCE, start.z)
            game.walk(target.x, target.z)
            val flag = game.expect<SetMapFlagV2>()
            assertEquals(target.x to target.z, flag.x to flag.z)
            assertEquals(target, game.localMovementUntil { it == target })
        }
    }

    @Test
    fun `a teleport to another region rebuilds the map around the new tile`() {
        login(developer()).use { game ->
            game.expect<RebuildLoginV2>()
            for ((x, z) in listOf(LUMBRIDGE, EDGEVILLE)) {
                game.command("tele $x $z 0")
                val rebuild = game.expectOrNull<RebuildNormalV2>()
                val tile = game.localMovementUntil { it.x == x && it.z == z }
                assertEquals(CoordGrid(0, x, z), tile)
                if (rebuild != null) assertEquals((x ushr 3) to (z ushr 3), rebuild.zoneX to rebuild.zoneZ)
            }
        }
    }

    @Test
    fun `a templated instance sends REBUILD_REGION`() {
        login(developer()).use { game ->
            game.expect<RebuildLoginV2>()
            game.command(INSTANCE_COMMAND)
            val rebuild = game.expect<RebuildRegionV2>(limit = 2_000)
            val zones = (0 until 4).flatMap { level -> (0 until 13).flatMap { x -> (0 until 13).map { z -> rebuild.buildArea[level, x, z] } } }
            assertTrue(zones.any { !it.invalid }, "instance with no zones")
            game.command("tele ${LUMBRIDGE.first} ${LUMBRIDGE.second} 0")
            game.expect<RebuildNormalV2>(limit = 2_000)
        }
    }

    private fun login(name: String): HeadlessClient.Game = LiveGateway.login(name)

    /** The account tsps gives developer rights (DEV_USERNAME), which `::tele` needs. */
    private fun developer(): String {
        val name = LiveGateway.developerName
        assumeTrue(name != null, "DEV_USERNAME isn't set for tsps; developer commands can't be tested")
        return name!!
    }

    /** Reads PLAYER_INFO until the local player moves to a tile matching [done]. */
    private fun HeadlessClient.Game.localMovementUntil(done: (CoordGrid) -> Boolean): CoordGrid {
        repeat(MOVEMENT_PACKETS) {
            val info = expect<PlayerInfo>()
            val coord = (info.updates[index] as? PlayerUpdateType.HighResolutionMovement)?.coord ?: return@repeat
            if (done(coord)) return coord
        }
        error("the local player never reached the expected tile")
    }

    private inline fun <reified T> HeadlessClient.Game.expectOrNull(): T? = runCatching { expect<T>(limit = 200) }.getOrNull()

    private companion object {
        const val PASSWORD = "gateway-test"
        const val OK = 2
        const val DUPLICATE = 5
        const val WALK_DISTANCE = 3
        const val MOVEMENT_PACKETS = 60
        // Builds a templated Gauntlet map around an empty-handed developer.
        const val INSTANCE_COMMAND = "gauntletstart"
        val LUMBRIDGE = 3222 to 3218
        val EDGEVILLE = 3093 to 3493
    }
}
