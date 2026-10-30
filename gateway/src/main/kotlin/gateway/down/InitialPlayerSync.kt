package gateway.down

import gateway.tsps.TspsPacket

/**
 * The first `PLAYER_SYNC` (20) after login: a teleport of the local player from 0,0 to its
 * absolute tile (`encodeInitialPlayerSync` in ClientProtocol.ts).
 */
class InitialPlayerSync(val index: Int, val x: Int, val z: Int, val level: Int) {
    companion object {
        /** Null when [packet] isn't an initial sync (its first entry isn't an absolute teleport). */
        fun decodeOrNull(packet: TspsPacket): InitialPlayerSync? {
            val reader = packet.reader()
            reader.u16() // scene base x
            reader.u16() // scene base y
            val index = reader.u16()
            reader.i32() // loop cycle
            reader.u16() // bit stream length
            val bits = BitReader(packet.payload, reader.offset)
            if (bits.read(1) != 1) return null // local player has movement
            bits.read(1) // update block
            if (bits.read(2) != 3) return null // teleport
            if (bits.read(1) != 1) return null // absolute
            val packed = bits.read(30)
            return InitialPlayerSync(index, (packed ushr 14) and 0x3FFF, packed and 0x3FFF, (packed ushr 28) and 3)
        }
    }
}

/** MSB-first bit reader over tsps sync bit streams. */
class BitReader(private val data: ByteArray, byteOffset: Int) {
    private var position = byteOffset * 8

    fun read(count: Int): Int {
        var value = 0
        repeat(count) {
            val bit = (data[position ushr 3].toInt() ushr (7 - (position and 7))) and 1
            value = (value shl 1) or bit
            position++
        }
        return value
    }

    fun alignToByte() {
        position = (position + 7) and 7.inv()
    }

    val byteOffset: Int get() = (position + 7) ushr 3
}
