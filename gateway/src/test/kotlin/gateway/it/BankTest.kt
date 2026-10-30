package gateway.it

import gateway.headless.HeadlessClient
import net.rsprox.protocol.game.outgoing.model.interfaces.IfSetEventsV2
import net.rsprox.protocol.game.outgoing.model.inv.UpdateInvFull
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import net.rsprox.protocol.game.outgoing.model.misc.client.ServerTickEnd
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test

/** Rearranging the bank as the official client does it: drags, and drops onto the tab bar. */
class BankTest {
    @Test
    fun `items swap by drag and move to a new tab, and back`() {
        val developer = LiveGateway.developerName
        assumeTrue(developer != null, "DEV_USERNAME isn't set; ::bank is a developer command")
        LiveGateway.login(developer!!).use { game ->
            game.expect<RebuildLoginV2>()
            game.ticks(LOGIN_TICKS)
            game.command("bank")
            var tabBarEnabled = false
            val opened = game.bankAfter(TICKS) { if (it is IfSetEventsV2 && it.interfaceId == BANK && it.componentId == TABS) tabBarEnabled = true }
            assertTrue(tabBarEnabled, "the tab bar takes drops")
            assumeTrue(opened.size >= 3, "the developer's bank needs three items")
            val (first, second) = opened

            // Slot 0 onto slot 1. Within one component RuneLite has already swapped them on screen,
            // so the first obj is the dropped-on slot's item (as its recorded drags show).
            game.drag(BANK, ITEMS, 0, second, BANK, ITEMS, 1, first)
            assertEquals(listOf(second, first), game.bankAfter(TICKS).take(2))
            game.drag(BANK, ITEMS, 0, first, BANK, ITEMS, 1, second)
            assertEquals(listOf(first, second), game.bankAfter(TICKS).take(2))

            // The third item onto tab 1's button: it leads the bank as tab 1's only item.
            val third = opened[2]
            // Onto another component the client sends the objs as they are: the dragged one first.
            game.drag(BANK, ITEMS, 2, third, BANK, TABS, TAB_1, NO_OBJ)
            assertEquals(third, game.bankAfter(TICKS).first())
            // And back, dropped into the empty space after the main tab's items (no swap there).
            game.drag(BANK, ITEMS, 0, third, BANK, ITEMS, MAIN_TAB_DROP, NO_OBJ)
            val back = game.bankAfter(TICKS)
            assertEquals(opened.toSet(), back.toSet())
            assertEquals(third, back.last(), "at the end of the main tab")
        }
    }

    private fun HeadlessClient.Game.ticks(count: Int) {
        var seen = 0
        while (seen < count) if ((next() ?: error("stream ended")) is ServerTickEnd) seen++
    }

    /** The bank's item ids in slot order after [count] ticks (the last full update). */
    private fun HeadlessClient.Game.bankAfter(count: Int, each: (Any) -> Unit = {}): List<Int> {
        var bank: List<Int>? = null
        var seen = 0
        while (seen < count) {
            val message = next() ?: error("stream ended")
            each(message)
            if (message is ServerTickEnd) seen++
            if (message is UpdateInvFull && message.inventoryId == BANK_INV) bank = message.objs.map { it.id }.filter { it >= 0 }
        }
        return bank ?: error("no bank update")
    }

    private companion object {
        const val LOGIN_TICKS = 6
        const val TICKS = 3
        const val BANK = 12
        const val ITEMS = 12
        const val TABS = 10
        const val MAIN_TAB = 10
        const val TAB_1 = 11
        const val BANK_INV = 95
        const val NO_OBJ = 0xFFFF

        /** tsps's drop slot for the empty space after the main tab's items: 1410 + 9 × 2 + tab 0. */
        const val MAIN_TAB_DROP = 1428
    }
}
