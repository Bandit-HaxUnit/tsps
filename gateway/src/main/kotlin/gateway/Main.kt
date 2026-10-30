package gateway

import gateway.cache.Cache
import gateway.config.GatewayConfig
import gateway.crypto.RsaKeys

fun main() {
    val config = GatewayConfig.load()
    val rsa = RsaKeys.loadOrCreate(config.keyFile)
    val cache = Cache.open(config.cacheDirectory)
    println("tsps gateway: port ${config.gatewayPort}, tsps ${config.tspsUrl}, cache ${config.cacheDirectory.fileName}")
    println("${cache.store.archives.size} archives")
    println("RSProx modulus: ${rsa.modulus.toString(16)}")
}
