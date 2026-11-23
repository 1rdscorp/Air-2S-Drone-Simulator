package com.air2ssim.rcprobe

import org.junit.Assert.assertEquals
import org.junit.Test

class ProbeToolsTest {
    @Test
    fun `rate meter counts events per second over its window`() {
        val meter = RateMeter(windowMs = 2000)
        for (i in 0 until 100) {
            meter.record(i * 20L) // 50 per second for two seconds
        }

        assertEquals(50.0, meter.perSecond(1999), 0.6)
    }

    @Test
    fun `rate meter forgets old events`() {
        val meter = RateMeter(windowMs = 2000)
        for (i in 0 until 100) {
            meter.record(i * 20L)
        }

        assertEquals(25.0, meter.perSecond(3000), 1.0)
        assertEquals(0.0, meter.perSecond(10_000), 0.0)
    }

    @Test
    fun `rate meter starts at zero and can be cleared`() {
        val meter = RateMeter()
        assertEquals(0.0, meter.perSecond(0), 0.0)

        meter.record(10)
        meter.clear()
        assertEquals(0.0, meter.perSecond(20), 0.0)
    }

    @Test
    fun `stick travel is zero before anything was recorded`() {
        val travel = StickTravel()

        assertEquals(0, travel.largest())
        assertEquals(0, travel.axesMoved(1))
    }

    @Test
    fun `stick travel is the widest range on one axis`() {
        val travel = StickTravel()
        travel.record(StickValues(0, 0, 0, 0))
        travel.record(StickValues(-660, 10, 0, 0))
        travel.record(StickValues(660, -10, 100, 0))

        assertEquals(1320, travel.largest())
    }

    @Test
    fun `counts the axes that really moved`() {
        val travel = StickTravel()
        travel.record(StickValues(0, 0, 0, 0))
        travel.record(StickValues(-660, 10, 400, 0))
        travel.record(StickValues(660, -10, 0, 3))

        assertEquals(2, travel.axesMoved(300))
        assertEquals(4, travel.axesMoved(3))
    }

    @Test
    fun `a stick held still off-centre has not travelled`() {
        val travel = StickTravel()
        repeat(50) { travel.record(StickValues(500, 500, -500, -500)) }

        assertEquals(0, travel.largest())
    }
}

class CrashNotesTest {
    @Test
    fun `describes a failure with its kind, its message and where it happened`() {
        val text = CrashNotes.describe(IllegalStateException("no radio"))

        assertEquals(true, text.startsWith("java.lang.IllegalStateException: no radio | at "))
        assertEquals(true, text.contains("CrashNotesTest"))
    }

    @Test
    fun `names the deepest cause, which is usually the real reason`() {
        val root = UnsatisfiedLinkError("libdji.so not found")
        val text = CrashNotes.describe(RuntimeException("start failed", RuntimeException("wrapped", root)))

        assertEquals(true, text.startsWith("java.lang.RuntimeException: start failed | "))
        assertEquals(true, text.contains("caused by java.lang.UnsatisfiedLinkError: libdji.so not found"))
    }

    @Test
    fun `stays short enough to photograph`() {
        val text = CrashNotes.describe(IllegalStateException("x"), maxFrames = 2)

        assertEquals(3, text.split(" | ").size)
    }
}
