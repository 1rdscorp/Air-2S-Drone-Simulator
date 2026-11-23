package com.air2ssim.rcprobe

/**
 * The 20-byte packet the Bluetooth test sends 50 times per second. It exists only to
 * measure the link; it is not the simulator's real protocol (that is Step 21).
 *
 *   byte 0       0xA5, marks a test packet
 *   byte 1       1, the layout version
 *   bytes 2-5    packet counter, unsigned 32 bit, low byte first
 *   bytes 6-9    milliseconds since the test started, unsigned 32 bit, low byte first
 *   bytes 10-17  left X, left Y, right X, right Y: signed 16 bit each, low byte first,
 *                -660 to 660 as the DJI SDK reports them; 0 when there are no stick values
 *   byte 18      flags: bit 0 = stick values are real, bit 1 = an aircraft is connected
 *   byte 19      all previous bytes combined with XOR
 */
object TestPacket {
    const val SIZE = 20
    const val MARKER = 0xA5
    const val VERSION = 1
    const val FLAG_STICKS_VALID = 0x01
    const val FLAG_AIRCRAFT_CONNECTED = 0x02

    fun encode(
        counter: Long,
        elapsedMs: Long,
        sticks: StickValues?,
        aircraftConnected: Boolean,
    ): ByteArray {
        val packet = ByteArray(SIZE)
        packet[0] = MARKER.toByte()
        packet[1] = VERSION.toByte()
        putUnsigned32(packet, 2, counter)
        putUnsigned32(packet, 6, elapsedMs)
        if (sticks != null) {
            putSigned16(packet, 10, sticks.leftX)
            putSigned16(packet, 12, sticks.leftY)
            putSigned16(packet, 14, sticks.rightX)
            putSigned16(packet, 16, sticks.rightY)
        }
        var flags = 0
        if (sticks != null) flags = flags or FLAG_STICKS_VALID
        if (aircraftConnected) flags = flags or FLAG_AIRCRAFT_CONNECTED
        packet[18] = flags.toByte()
        packet[19] = checksum(packet)
        return packet
    }

    /** XOR of bytes 0 to 18. */
    fun checksum(packet: ByteArray): Byte {
        var sum = 0
        for (index in 0 until SIZE - 1) {
            sum = sum xor (packet[index].toInt() and 0xFF)
        }
        return sum.toByte()
    }

    private fun putUnsigned32(target: ByteArray, offset: Int, value: Long) {
        for (index in 0 until 4) {
            target[offset + index] = ((value ushr (8 * index)) and 0xFF).toByte()
        }
    }

    private fun putSigned16(target: ByteArray, offset: Int, value: Int) {
        val clamped = value.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
        target[offset] = (clamped and 0xFF).toByte()
        target[offset + 1] = ((clamped shr 8) and 0xFF).toByte()
    }
}
