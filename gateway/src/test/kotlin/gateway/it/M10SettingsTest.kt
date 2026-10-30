package gateway.it

import gateway.headless.HeadlessClient
import net.rsprox.protocol.game.outgoing.model.interfaces.IfOpenSub
import net.rsprox.protocol.game.outgoing.model.interfaces.IfSetEventsV2
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import net.rsprox.protocol.game.outgoing.model.misc.client.ServerTickEnd
import net.rsprox.protocol.game.outgoing.model.varp.VarpLarge
import net.rsprox.protocol.game.outgoing.model.varp.VarpSmall
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** M10: settings the official client keeps itself, and the XP drops setup tsps saves for it. */
class M10SettingsTest {
    @Test
    fun `login leaves the client's own audio settings alone`() {
        LiveGateway.login(LiveGateway.newAccount("gwaud")).use { game ->
            game.expect<RebuildLoginV2>()
            // The client keeps its volumes in its own options; tsps's copies would reset them.
            val audio = game.until(TICKS).varps().filter { (id, _) -> id in AUDIO_VARPS }
            assertEquals(emptyList<Pair<Int, Int>>(), audio)
        }
    }

    @Test
    fun `an XP drops setup choice is saved and comes back at the next login`() {
        val name = LiveGateway.newAccount("gwxpd")
        val chosen =
            LiveGateway.login(name).use { game ->
                game.expect<RebuildLoginV2>()
                game.until(TICKS)
                game.button(ORBS, XP_DROPS_ORB, op = 2)
                // The setup opens with its dropdown rows enabled, so the client reports a choice.
                game.untilAll(
                    { it is IfOpenSub && it.interfaceId == XP_DROPS_SETUP },
                    { it is IfSetEventsV2 && it.interfaceId == XP_DROPS_SETUP && it.componentId == POSITION_DROPDOWN },
                )
                game.button(XP_DROPS_SETUP, POSITION_DROPDOWN, sub = POSITION_ROW)
                val value = requireNotNull(game.until(TICKS).varps().lastOrNull { it.first == XP_DROPS_VARP }?.second)
                assertEquals(POSITION_ROW - 1, value and POSITION_BITS, "position varbit in varp $XP_DROPS_VARP = $value")
                value
            }
        LiveGateway.login(name).use { game ->
            val messages = game.until(TICKS)
            val restored = messages.varps().lastOrNull { it.first == XP_DROPS_VARP }?.second
            assertEquals(chosen, restored, "login varps: ${messages.varps()}")
        }
    }

    private fun HeadlessClient.Game.until(ticks: Int): List<Any> {
        val messages = ArrayList<Any>()
        var seen = 0
        while (seen < ticks) {
            val message = next() ?: error("stream ended")
            messages += message
            if (message is ServerTickEnd) seen++
        }
        return messages
    }

    private fun HeadlessClient.Game.untilAll(vararg wanted: (Any) -> Boolean) {
        val missing = wanted.toMutableList()
        repeat(PACKETS) {
            val message = next() ?: error("stream ended")
            missing.removeAll { it(message) }
            if (missing.isEmpty()) return
        }
        error("${missing.size} expected packets never arrived")
    }

    private fun List<Any>.varps(): List<Pair<Int, Int>> =
        mapNotNull {
            when (it) {
                is VarpSmall -> it.id to it.value
                is VarpLarge -> it.id to it.value
                else -> null
            }
        }

    private companion object {
        const val TICKS = 4
        const val PACKETS = 5_000
        val AUDIO_VARPS = setOf(18, 168, 169, 872, 3796)
        const val ORBS = 160
        const val XP_DROPS_ORB = 6
        const val XP_DROPS_SETUP = 137
        const val POSITION_DROPDOWN = 6
        const val POSITION_ROW = 3
        const val POSITION_BITS = 0b11
        const val XP_DROPS_VARP = 1227
    }
}
