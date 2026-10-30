package gateway.it

import gateway.Gateway
import gateway.headless.HeadlessClient
import gateway.headless.TestCache
import org.junit.jupiter.api.Assumptions.assumeTrue
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket

/**
 * A gateway started in-process on a free port, in front of this checkout's running tsps
 * (`yarn start`). Integration tests are skipped when tsps isn't up.
 */
object LiveGateway {
    val gateway: Gateway by lazy {
        val config = TestCache.config
        assumeTrue(isListening(config.websocketPort), "tsps isn't running on ${config.websocketPort}; start it with `yarn start`")
        val port = ServerSocket(0).use { it.localPort }
        Gateway.start(config.copy(gatewayPort = port)).also { Runtime.getRuntime().addShutdownHook(Thread(it::stop)) }
    }

    fun client() = HeadlessClient("127.0.0.1", gateway.config.gatewayPort)

    /** A fresh account name; tsps creates unknown accounts on first login. */
    fun newAccount(prefix: String): String = prefix + (System.nanoTime() % 1_000_000).toString().padStart(6, '0')

    private fun isListening(port: Int) =
        runCatching { Socket().use { it.connect(InetSocketAddress("127.0.0.1", port), 500) } }.isSuccess
}
