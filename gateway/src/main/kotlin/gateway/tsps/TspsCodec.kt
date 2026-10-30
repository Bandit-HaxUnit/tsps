package gateway.tsps

import java.io.ByteArrayOutputStream

/** One tsps server packet: its opcode and payload, length prefix removed. */
class TspsPacket(val opcode: Int, val payload: ByteArray) {
    fun reader() = TspsReader(payload)
}

/** Big-endian reader for tsps payloads; strings are latin1, NUL-terminated. */
class TspsReader(private val data: ByteArray, var offset: Int = 0) {
    val remaining: Int get() = data.size - offset

    fun u8(): Int = data[offset++].toInt() and 0xFF

    fun s8(): Int = data[offset++].toInt()

    fun u16(): Int = (u8() shl 8) or u8()

    fun s16(): Int = u16().toShort().toInt()

    fun i32(): Int = (u16() shl 16) or u16()

    fun i64(): Long = (i32().toLong() shl 32) or (i32().toLong() and 0xFFFFFFFFL)

    fun string(): String {
        val start = offset
        while (data[offset] != 0.toByte()) offset++
        return String(data, start, offset++ - start, Charsets.ISO_8859_1)
    }

    fun bytes(length: Int): ByteArray = data.copyOfRange(offset, offset + length).also { offset += length }
}

object TspsCodec {
    /** Splits one WebSocket message into its packets. Throws on an opcode tsps doesn't define. */
    fun split(message: ByteArray): List<TspsPacket> {
        val packets = ArrayList<TspsPacket>()
        var offset = 0
        while (offset < message.size) {
            val opcode = message[offset++].toInt() and 0xFF
            val declared = requireNotNull(TspsServerPacket.LENGTHS[opcode]) { "unknown tsps server opcode $opcode" }
            val length =
                when (declared) {
                    -1 -> message[offset++].toInt() and 0xFF
                    -2 -> ((message[offset++].toInt() and 0xFF) shl 8) or (message[offset++].toInt() and 0xFF)
                    else -> declared
                }
            require(offset + length <= message.size) { "tsps packet $opcode overruns its frame" }
            packets += TspsPacket(opcode, message.copyOfRange(offset, offset + length))
            offset += length
        }
        return packets
    }
}

/** Builds tsps client packets: `u8 opcode`, a length prefix for variable ones, the payload. */
class TspsWriter {
    private val out = ByteArrayOutputStream()

    fun u8(value: Int) = apply { out.write(value) }

    fun u16(value: Int) = apply { u8(value ushr 8).u8(value) }

    fun i32(value: Int) = apply { u16(value ushr 16).u16(value) }

    fun string(value: String) = apply { out.writeBytes(value.toByteArray(Charsets.ISO_8859_1)).also { out.write(0) } }

    fun fixed(opcode: Int): ByteArray = byteArrayOf(opcode.toByte()) + out.toByteArray()

    fun varByte(opcode: Int): ByteArray {
        val body = out.toByteArray()
        require(body.size <= 0xFF) { "tsps client packet $opcode exceeds byte length" }
        return byteArrayOf(opcode.toByte(), body.size.toByte()) + body
    }

    fun varShort(opcode: Int): ByteArray {
        val body = out.toByteArray()
        require(body.size <= 0xFFFF) { "tsps client packet $opcode exceeds short length" }
        return byteArrayOf(opcode.toByte(), (body.size ushr 8).toByte(), body.size.toByte()) + body
    }
}

/**
 * The tsps client packets the gateway sends, mirroring `ClientPacketId` in
 * `server/.../net/protocol/ClientPackets.ts`. tsps closes the session on an opcode it doesn't
 * know, so nothing else may be sent.
 */
object TspsClientPacket {
    const val PING = 201
    const val HANDSHAKE = 202
    const val LOGIN = 204

    /** `HANDSHAKE_CAPABILITY_NATIVE_CLIENT` in ClientProtocol.ts. */
    const val CAPABILITY_NATIVE_CLIENT = 0x1
    private const val CLIENT_TYPE_DESKTOP = 0

    fun login(username: String, password: String, revision: Int): ByteArray =
        TspsWriter().string(username).string(password).i32(revision).u8(0).varShort(LOGIN)

    fun handshake(username: String): ByteArray =
        TspsWriter()
            .string(username)
            .u8(0) // no appearance; tsps sends it
            .u8(CLIENT_TYPE_DESKTOP)
            .u8(CAPABILITY_NATIVE_CLIENT)
            .varByte(HANDSHAKE)

    fun ping(time: Int): ByteArray = TspsWriter().i32(time).fixed(PING)
}
