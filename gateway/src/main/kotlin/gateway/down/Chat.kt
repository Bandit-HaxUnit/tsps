package gateway.down

import gateway.tsps.TspsPacket

/** `CHAT_MESSAGE` (120): `text, u8 chat type, from, prefix, u16 player index`. */
class TspsChatMessage(val text: String, val type: Int, val from: String, val prefix: String, val playerIndex: Int) {
    /** Public chat types: 2, and autochat's 90 and 91. */
    val isPublic: Boolean get() = type == 2 || type == 90 || type == 91

    /**
     * Messages OSRS sends as MESSAGE_GAME: game (0), broadcast (14), filtered (105), trade and
     * challenge requests (101, 103), and the other system types. Private and friends-chat
     * types have their own packets.
     */
    val isGameMessage: Boolean get() = !isPublic && type !in SOCIAL_TYPES

    /** The mod icon tsps puts in front of the name as `<img=N>`, or 0. */
    val modIcon: Int get() = Regex("""<img=(\\d+)>""").find(from)?.groupValues?.get(1)?.toInt()?.plus(1) ?: 0

    companion object {
        private const val NO_PLAYER = 0xFFFF

        /** Private in/out, mod private, friends chat and clan types, which M6 maps. */
        private val SOCIAL_TYPES = setOf(3, 6, 7, 9, 41, 44)

        fun decode(packet: TspsPacket): TspsChatMessage {
            val reader = packet.reader()
            val text = reader.string()
            val type = reader.u8()
            val from = reader.string()
            val prefix = reader.string()
            val index = if (reader.remaining >= 2) reader.u16() else NO_PLAYER
            return TspsChatMessage(text, type, from, prefix, if (index == NO_PLAYER) -1 else index)
        }
    }
}
