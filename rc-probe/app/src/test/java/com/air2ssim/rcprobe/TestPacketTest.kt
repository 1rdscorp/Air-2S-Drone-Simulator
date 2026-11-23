package com.air2ssim.rcprobe

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class TestPacketTest {
    private fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

    /**
     * The same packet is decoded by the check page in the browser test
     * `sim/e2e/controllerCheck.spec.ts`. Change both together.
     */
    @Test
    fun `encodes the reference packet`() {
        val packet = TestPacket.encode(
            counter = 0x01020304,
            elapsedMs = 5000,
            sticks = StickValues(leftX = -660, leftY = 660, rightX = 100, rightY = -1),
            aircraftConnected = false,
        )

        assertArrayEquals(
            bytes(
                0xA5, 0x01,
                0x04, 0x03, 0x02, 0x01,
                0x88, 0x13, 0x00, 0x00,
                0x6C, 0xFD, 0x94, 0x02, 0x64, 0x00, 0xFF, 0xFF,
                0x01,
                0x59,
            ),
            packet,
        )
    }

    @Test
    fun `is always 20 bytes and starts with the marker and the version`() {
        val packet = TestPacket.encode(0, 0, null, false)

        assertEquals(20, packet.size)
        assertEquals(0xA5, packet[0].toInt() and 0xFF)
        assertEquals(1, packet[1].toInt())
    }

    @Test
    fun `without stick values the sticks are zero and the flag is off`() {
        val packet = TestPacket.encode(7, 140, null, false)

        for (index in 10..17) {
            assertEquals(0, packet[index].toInt())
        }
        assertEquals(0, packet[18].toInt())
    }

    @Test
    fun `flags say whether sticks are real and whether an aircraft is connected`() {
        val sticks = StickValues(0, 0, 0, 0)

        assertEquals(1, TestPacket.encode(0, 0, sticks, false)[18].toInt())
        assertEquals(2, TestPacket.encode(0, 0, null, true)[18].toInt())
        assertEquals(3, TestPacket.encode(0, 0, sticks, true)[18].toInt())
    }

    @Test
    fun `the last byte makes the XOR of all 20 bytes zero`() {
        val packet = TestPacket.encode(123456, 98765, StickValues(-321, 12, 660, -660), true)

        var sum = 0
        for (byte in packet) {
            sum = sum xor (byte.toInt() and 0xFF)
        }
        assertEquals(0, sum)
    }

    @Test
    fun `the counter wraps like an unsigned 32 bit number`() {
        val packet = TestPacket.encode(0x1_0000_0005L, 0, null, false)

        assertArrayEquals(bytes(0x05, 0x00, 0x00, 0x00), packet.copyOfRange(2, 6))
    }

    @Test
    fun `stick values outside 16 bits are limited, not wrapped`() {
        val packet = TestPacket.encode(0, 0, StickValues(100_000, -100_000, 0, 0), false)

        assertArrayEquals(bytes(0xFF, 0x7F, 0x00, 0x80), packet.copyOfRange(10, 14))
    }
}
