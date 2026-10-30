package gateway.it

import net.rsprox.protocol.game.outgoing.model.interfaces.IfOpenTop
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Test

/** Returning accounts log in to the welcome screen; its play button needs IF_BUTTONX to reach tsps. */
class WelcomeScreenTest {
    private val modulus = LiveGateway.gateway.rsa.modulus

    @Test
    fun `play on the welcome screen opens the gameframe`() {
        val name = LiveGateway.newAccount("gwplay")
        LiveGateway.client().login(name, PASSWORD, modulus).game!!.use { it.expect<RebuildLoginV2>() }

        // tsps saves the account and frees the name a few ticks after the socket closes.
        val game =
            generateSequence { LiveGateway.client().login(name, PASSWORD, modulus) }
                .take(RELOGIN_ATTEMPTS)
                .onEach { if (it.code != OK) Thread.sleep(RELOGIN_WAIT_MS) }
                .first { it.code == OK }
                .game!!
        game.use {
            // tsps mounts the gameframe at login, then swaps the welcome screen in the same tick.
            while (it.expect<IfOpenTop>(limit = 2_000).interfaceId != WELCOME_SCREEN) continue
            it.button(WELCOME_SCREEN, PLAY_BUTTON)
            assertNotEquals(WELCOME_SCREEN, it.expect<IfOpenTop>(limit = 2_000).interfaceId)
        }
    }

    private companion object {
        const val PASSWORD = "gateway-test"
        const val OK = 2
        const val WELCOME_SCREEN = 378
        const val PLAY_BUTTON = 72
        const val RELOGIN_ATTEMPTS = 20
        const val RELOGIN_WAIT_MS = 1_000L
    }
}
