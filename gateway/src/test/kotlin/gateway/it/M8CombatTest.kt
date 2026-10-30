package gateway.it

import net.rsprox.protocol.game.outgoing.model.info.npcinfo.NpcInfo
import net.rsprox.protocol.game.outgoing.model.info.npcinfo.NpcUpdateType
import net.rsprox.protocol.game.outgoing.model.info.shared.extendedinfo.HeadbarExtendedInfo
import net.rsprox.protocol.game.outgoing.model.info.shared.extendedinfo.HitmarkExtendedInfo
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import net.rsprox.protocol.game.outgoing.model.misc.client.ServerTickEnd
import net.rsprox.protocol.game.outgoing.model.misc.player.MessageGame
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test

/** M8: attacking an NPC shows hitsplats on it. */
class M8CombatTest {
    @Test
    fun `attacking a lumbridge npc puts hitsplats on it`() {
        val developer = LiveGateway.developerName
        assumeTrue(developer != null, "DEV_USERNAME isn't set; the test teleports to Lumbridge")
        LiveGateway.login(developer!!).use { game ->
            game.expect<RebuildLoginV2>()
            game.command("tele $X $Z 0")
            var target = -1
            while (target < 0) {
                // The nearest one: tsps flickers NPCs right at the edge of its 15-tile view.
                target = game.expect<NpcInfo>().updates.entries
                    .filter { (_, update) -> update is NpcUpdateType.LowResolutionToHighResolution && update.id in ATTACKABLE }
                    .minByOrNull { (_, update) ->
                        update as NpcUpdateType.LowResolutionToHighResolution
                        maxOf(Math.abs(update.x - X), Math.abs(update.z - Z))
                    }?.key ?: -1
            }
            // tsps ignores clicks while the teleport still holds the player.
            var ticks = 0
            while (ticks < SETTLE_TICKS) if (game.next() is ServerTickEnd) ticks++
            game.npcOp2(target)
            val seen = ArrayList<String>()
            repeat(COMBAT_TICKS) {
                var npcs: NpcInfo? = null
                while (npcs == null) {
                    when (val message = game.next() ?: error("stream ended")) {
                        is NpcInfo -> npcs = message
                        is MessageGame -> seen += "message: ${message.message}"
                    }
                }
                val update = npcs.updates[target] ?: return@repeat
                val info = (update as? NpcUpdateType.Active)?.extendedInfo
                if (info == null) {
                    seen += update.javaClass.simpleName
                    return@repeat
                }
                seen += info.map { it.javaClass.simpleName }
                // A hit lands as a hitsplat and the health bar under it.
                if (info.any { it is HitmarkExtendedInfo } && info.any { it is HeadbarExtendedInfo }) return
            }
            error("npc $target never took a hit; its updates: $seen")
        }
    }

    private companion object {
        const val X = 3222
        const val Z = 3218
        const val COMBAT_TICKS = 60
        const val SETTLE_TICKS = 4

        /** The rats that spawn by Lumbridge castle (npc-spawns.json); Attack is their op 2. */
        val ATTACKABLE = setOf(2854)
    }
}
