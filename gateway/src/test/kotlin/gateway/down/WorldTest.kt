package gateway.down

import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import net.rsprot.protocol.game.outgoing.camera.CamMoveToCyclesV3
import net.rsprot.protocol.game.outgoing.camera.util.CameraEaseFunction
import net.rsprot.protocol.game.outgoing.misc.client.HintArrow
import net.rsprot.protocol.game.outgoing.sound.SynthSound
import net.rsprot.protocol.game.outgoing.zone.header.UpdateZonePartialFollows
import net.rsprot.protocol.game.outgoing.zone.payload.LocAddChangeV2
import net.rsprot.protocol.game.outgoing.zone.payload.SoundArea
import net.rsprot.protocol.message.OutgoingGameMessage
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** tsps world packets, built as ClientProtocol.ts builds them, through [World]. */
class WorldTest {
    private val sent = ArrayList<OutgoingGameMessage>()
    private val world = World { sent += it }.apply { rebuild(LUMBRIDGE_ZONE_X, LUMBRIDGE_ZONE_Z) }

    @Test
    fun `a loc change goes behind its zone in the build area`() {
        val x = 3222
        val z = 3218
        world.handle(packet(TspsServerPacket.LOC_ADD_CHANGE, TspsWriter().u16(DOOR).u16(x).u16(z).u8(0).u8((0 shl 2) or 1)))
        val header = sent[0] as UpdateZonePartialFollows
        val sceneX = (LUMBRIDGE_ZONE_X - 6) shl 3
        val sceneZ = (LUMBRIDGE_ZONE_Z - 6) shl 3
        assertEquals((x - sceneX) and 7.inv(), header.zoneX)
        assertEquals((z - sceneZ) and 7.inv(), header.zoneZ)
        val loc = sent[1] as LocAddChangeV2
        assertEquals(DOOR, loc.id)
        assertEquals(x and 7, loc.xInZone)
        assertEquals(z and 7, loc.zInZone)
        assertEquals(1, loc.rotation)
    }

    @Test
    fun `sounds are area sounds with a tile and synth sounds without one`() {
        world.handle(packet(TspsServerPacket.SOUND, TspsWriter().u16(SOUND).u8(1).u16(3222).u16(3218).u8(0).u8(1).u16(0).u8(5).u8(0)))
        world.handle(packet(TspsServerPacket.SOUND, TspsWriter().u16(SOUND).u8(0).u8(1).u16(0).u8(0).u8(0)))
        assertTrue(sent[0] is UpdateZonePartialFollows && sent[1] is SoundArea)
        assertEquals(SOUND, (sent[2] as SynthSound).id)
    }

    @Test
    fun `timed camera moves and hint arrows map to their packets`() {
        world.handle(packet(TspsServerPacket.CAMERA_CONTROL, TspsWriter().u8(8).u16(3222).u16(3218).u16(400).u16(60).u8(2).u8(0)))
        val camera = sent.single() as CamMoveToCyclesV3
        assertEquals(60, camera.cycles)
        assertEquals(CameraEaseFunction.EASE_OUT_CUBIC, camera.easing)
        world.handle(packet(TspsServerPacket.HINT_ARROW, TspsWriter().u8(1).u16(NPC_INDEX).u16(0).u8(0).u8(0)))
        assertEquals(NPC_INDEX, ((sent.last() as HintArrow).type as HintArrow.NpcHintArrow).index)
    }

    /** A tsps packet with [payload]'s bytes, as TspsCodec.split would hand it over. */
    private fun packet(opcode: Int, payload: TspsWriter) = TspsPacket(opcode, payload.body())

    private companion object {
        const val LUMBRIDGE_ZONE_X = 3222 shr 3
        const val LUMBRIDGE_ZONE_Z = 3218 shr 3
        const val DOOR = 1543
        const val SOUND = 2739
        const val NPC_INDEX = 42
    }
}
