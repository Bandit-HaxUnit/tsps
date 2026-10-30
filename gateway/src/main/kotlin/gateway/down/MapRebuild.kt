package gateway.down

import gateway.tsps.TspsPacket
import net.rsprot.protocol.game.outgoing.map.RebuildNormalV2
import net.rsprot.protocol.game.outgoing.map.RebuildRegionV2
import net.rsprot.protocol.game.outgoing.map.util.RebuildRegionZone
import net.rsprot.protocol.message.OutgoingGameMessage

/** A tsps scene rebuild, centred on zone [zoneX], [zoneZ]. */
sealed class MapRebuild(val zoneX: Int, val zoneZ: Int) {
    abstract fun toMessage(): OutgoingGameMessage

    /** `REBUILD_NORMAL` (141): `u16 zoneX, u16 zoneZ, u8 keep, u16 keyCount, keys`. */
    class Normal(zoneX: Int, zoneZ: Int) : MapRebuild(zoneX, zoneZ) {
        override fun toMessage() = RebuildNormalV2(zoneX, zoneZ, NO_WORLD_AREA)
    }

    /**
     * `REBUILD_REGION` (140), a templated instance: `u16 zoneZ, u8 reload, u16 zoneX,
     * u16 keyCount`, then per level, x, z of the 13×13 scene a bit for "has a zone" and the
     * zone's 26-bit reference, packed as rsprot's ReferenceZone.
     */
    class Region(zoneX: Int, zoneZ: Int, private val reload: Boolean, private val zones: Array<Int?>) :
        MapRebuild(zoneX, zoneZ) {
        override fun toMessage() =
            RebuildRegionV2(zoneX, zoneZ, reload) { x, z, level ->
                zones[(level * SCENE_ZONES + (x - zoneX + 6)) * SCENE_ZONES + (z - zoneZ + 6)]?.let(::zone)
            }
    }

    companion object {
        /** OSRS's world-area id; tsps has none to give, and -1 is the client's "none". */
        const val NO_WORLD_AREA = -1
        private const val SCENE_ZONES = 13
        private const val LEVELS = 4

        /** A template zone reference, packed as rsprot's ReferenceZone. */
        fun zone(packed: Int) =
            RebuildRegionZone((packed ushr 14) and 0x3FF, (packed ushr 3) and 0x7FF, (packed ushr 24) and 3, (packed ushr 1) and 3)

        fun normal(packet: TspsPacket): Normal {
            val reader = packet.reader()
            return Normal(reader.u16(), reader.u16())
        }

        fun region(packet: TspsPacket): Region {
            val reader = packet.reader()
            val zoneZ = reader.u16()
            val reload = reader.u8() != 0
            val zoneX = reader.u16()
            reader.u16() // key count; the keys follow the palette
            val bits = BitReader(packet.payload, reader.offset)
            val zones = Array(LEVELS * SCENE_ZONES * SCENE_ZONES) { if (bits.read(1) == 1) bits.read(26) else null }
            return Region(zoneX, zoneZ, reload, zones)
        }
    }
}
