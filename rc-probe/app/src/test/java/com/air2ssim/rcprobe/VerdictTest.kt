package com.air2ssim.rcprobe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VerdictTest {
    // ---- Probe 1 ---------------------------------------------------------------------

    private fun input(
        devices: List<InputDeviceInfo> = emptyList(),
        test: TestState = TestState.NOT_STARTED,
        stickEvents: Int = 0,
        keys: List<String> = emptyList(),
    ) = InputFindings(devices, test, secondsLeft = 7, stickEvents, stickDevice = "Sticks", keys)

    @Test
    fun `input - not run until the test is started`() {
        assertEquals(Verdict.NOT_RUN, inputVerdict(input()).verdict)
    }

    @Test
    fun `input - waiting while the test runs, with the time left`() {
        val result = inputVerdict(input(test = TestState.RUNNING))

        assertEquals(Verdict.WAITING, result.verdict)
        assertTrue(result.summary.contains("7 s left"))
    }

    @Test
    fun `input - fails when the test ended without any stick movement`() {
        assertEquals(Verdict.FAIL, inputVerdict(input(test = TestState.FINISHED)).verdict)
    }

    @Test
    fun `input - a listed joystick alone is not a pass, the sticks must be seen moving`() {
        val joystick = InputDeviceInfo("Some joystick", isGameController = true, axes = 4)
        val result = inputVerdict(input(devices = listOf(joystick), test = TestState.FINISHED))

        assertEquals(Verdict.FAIL, result.verdict)
        assertTrue(result.details.any { it.contains("Some joystick (4 axes)") })
    }

    @Test
    fun `input - passes as soon as stick movement arrives, even after the ten seconds`() {
        for (state in TestState.entries) {
            val result = inputVerdict(input(test = state, stickEvents = 42))

            assertEquals(Verdict.PASS, result.verdict)
            assertTrue(result.summary.contains("42 stick events from Sticks"))
        }
    }

    @Test
    fun `input - says how many devices there are when none is a game controller`() {
        val touch = InputDeviceInfo("touchscreen", isGameController = false, axes = 0)
        val result = inputVerdict(input(devices = listOf(touch, touch)))

        assertTrue(result.details.first().contains("no joystick or gamepad (2 input devices"))
    }

    @Test
    fun `input - lists the buttons that arrived as keys`() {
        val result = inputVerdict(input(keys = listOf("BACK", "BUTTON_C")))

        assertTrue(result.details.any { it.contains("BACK, BUTTON_C") })
    }

    // ---- Probe 2 ---------------------------------------------------------------------

    private fun ble(
        hasAdapter: Boolean = true,
        enabled: Boolean = true,
        hasAdvertiser: Boolean? = true,
        advertising: AdvertisingState = AdvertisingState.NOT_STARTED,
        error: Int? = null,
        problem: String? = null,
        nameIncluded: Boolean = true,
        subscribers: Int = 0,
        rate: Double = 0.0,
        sent: Long = 0,
    ) = BleFindings(
        hasAdapter, enabled, multipleAdvertisement = true, hasAdvertiser, gattServerOpened = true,
        advertising, error, problem, nameIncluded, connectedDevices = subscribers, subscribers,
        packetsSent = sent, packetsPerSecond = rate, packetsSkipped = 3,
    )

    @Test
    fun `bluetooth - fails without a Bluetooth adapter`() {
        assertEquals(Verdict.FAIL, bleVerdict(ble(hasAdapter = false)).verdict)
    }

    @Test
    fun `bluetooth - asks to switch Bluetooth on`() {
        val result = bleVerdict(ble(enabled = false, advertising = AdvertisingState.STARTED))

        assertEquals(Verdict.WAITING, result.verdict)
        assertTrue(result.summary.contains("switched off"))
    }

    @Test
    fun `bluetooth - not run, then waiting while it starts`() {
        assertEquals(Verdict.NOT_RUN, bleVerdict(ble()).verdict)
        assertEquals(
            Verdict.WAITING,
            bleVerdict(ble(advertising = AdvertisingState.STARTING)).verdict,
        )
    }

    @Test
    fun `bluetooth - passes once advertising has started`() {
        val result = bleVerdict(ble(advertising = AdvertisingState.STARTED))

        assertEquals(Verdict.PASS, result.verdict)
        assertTrue(result.summary.contains("Now connect from the PC"))
    }

    @Test
    fun `bluetooth - reports the packet rate once a computer listens`() {
        val result = bleVerdict(
            ble(advertising = AdvertisingState.STARTED, subscribers = 1, rate = 49.6, sent = 1200),
        )

        assertEquals(Verdict.PASS, result.verdict)
        assertTrue(result.summary.contains("receiving 50 packets per second"))
        assertTrue(result.details.any { it.contains("Packets sent: 1200, now 50 per second, 3 left out") })
    }

    @Test
    fun `bluetooth - says when the name had to be left out`() {
        val result = bleVerdict(ble(advertising = AdvertisingState.STARTED, nameIncluded = false))

        assertTrue(result.details.any { it.contains("without the device name") })
    }

    @Test
    fun `bluetooth - fails with the reason when advertising did not start`() {
        val result = bleVerdict(ble(advertising = AdvertisingState.FAILED, error = 5))

        assertEquals(Verdict.FAIL, result.verdict)
        assertTrue(result.summary.contains("cannot advertise (error 5"))
    }

    @Test
    fun `bluetooth - fails clearly when Android gives no advertiser`() {
        val result = bleVerdict(ble(hasAdvertiser = false, advertising = AdvertisingState.FAILED))

        assertEquals(Verdict.FAIL, result.verdict)
        assertTrue(result.summary.contains("cannot act as a Bluetooth LE device"))
    }

    @Test
    fun `bluetooth - passes on what Android said when the test could not even start`() {
        val result = bleVerdict(
            ble(advertising = AdvertisingState.FAILED, problem = "SecurityException: no permission"),
        )

        assertEquals(Verdict.FAIL, result.verdict)
        assertTrue(result.summary.contains("SecurityException: no permission"))
    }

    @Test
    fun `bluetooth - names every Android advertising error`() {
        for (code in 1..5) {
            assertTrue(advertisingErrorText(code).contains("error $code"))
        }
        assertEquals("error 9", advertisingErrorText(9))
        assertFalse(advertisingErrorText(null).contains("null"))
    }

    // ---- Probe 3 ---------------------------------------------------------------------

    private fun dji(
        included: Boolean = true,
        keyPresent: Boolean = true,
        state: DjiState = DjiState.NOT_STARTED,
        seconds: Int = 0,
        error: String? = null,
        aircraft: Boolean = false,
        updates: Long = 0,
        travel: Int = 0,
    ) = DjiFindings(
        included, keyPresent, state, seconds, error, productName = "UNKNOWN_AIRCRAFT",
        aircraftConnected = aircraft, updates = updates, updatesPerSecond = 10.0,
        sticks = if (updates > 0) StickValues(1, 2, 3, 4) else null,
        stickTravel = travel, axesMoved = 2, log = listOf("registered"),
    )

    @Test
    fun `dji - not included in the small build`() {
        assertEquals(Verdict.NOT_INCLUDED, djiVerdict(dji(included = false)).verdict)
    }

    @Test
    fun `dji - fails when built without an app key`() {
        val result = djiVerdict(dji(keyPresent = false, state = DjiState.CONTROLLER_FOUND))

        assertEquals(Verdict.FAIL, result.verdict)
        assertTrue(result.summary.contains("without a DJI app key"))
    }

    @Test
    fun `dji - walks through not run, permissions and registering`() {
        assertEquals(Verdict.NOT_RUN, djiVerdict(dji()).verdict)
        assertEquals(Verdict.WAITING, djiVerdict(dji(state = DjiState.NEEDS_PERMISSIONS)).verdict)
        assertEquals(Verdict.WAITING, djiVerdict(dji(state = DjiState.REGISTERING)).verdict)
    }

    @Test
    fun `dji - a refused registration fails with DJI's reason`() {
        val result = djiVerdict(dji(state = DjiState.REGISTER_FAILED, error = "invalid app key"))

        assertEquals(Verdict.FAIL, result.verdict)
        assertTrue(result.summary.contains("could not register with DJI: invalid app key"))
    }

    @Test
    fun `dji - waits a minute for the remote controller, then fails`() {
        val waiting = dji(state = DjiState.WAITING_FOR_CONTROLLER, seconds = 59)
        val tooLong = dji(state = DjiState.WAITING_FOR_CONTROLLER, seconds = 60)

        assertEquals(Verdict.WAITING, djiVerdict(waiting).verdict)
        assertEquals(Verdict.FAIL, djiVerdict(tooLong).verdict)
    }

    @Test
    fun `dji - waits half a minute for stick data, then fails`() {
        val waiting = dji(state = DjiState.CONTROLLER_FOUND, seconds = 29)
        val tooLong = dji(state = DjiState.CONTROLLER_FOUND, seconds = 30)

        assertEquals(Verdict.WAITING, djiVerdict(waiting).verdict)
        assertEquals(Verdict.FAIL, djiVerdict(tooLong).verdict)
    }

    @Test
    fun `dji - data without movement is not yet a pass`() {
        val result = djiVerdict(dji(state = DjiState.CONTROLLER_FOUND, updates = 500, travel = 40))

        assertEquals(Verdict.WAITING, result.verdict)
        assertTrue(result.summary.contains("move both sticks"))
    }

    @Test
    fun `dji - passes when the sticks are seen moving with the aircraft off`() {
        val result = djiVerdict(dji(state = DjiState.CONTROLLER_FOUND, updates = 500, travel = 900))

        assertEquals(Verdict.PASS, result.verdict)
        assertTrue(result.summary.contains("with the aircraft off: 10 updates per second"))
        assertTrue(result.details.any { it.contains("left 1 / 2, right 3 / 4") })
    }

    @Test
    fun `dji - never passes while an aircraft is connected`() {
        val result = djiVerdict(
            dji(state = DjiState.CONTROLLER_FOUND, aircraft = true, updates = 500, travel = 1320),
        )

        assertEquals(Verdict.WAITING, result.verdict)
        assertTrue(result.summary.contains("Switch the aircraft off"))
    }

    // ---- Report ----------------------------------------------------------------------

    @Test
    fun `the report answers the three questions in order`() {
        val device = DeviceFacts("1.0", "DJI", "RM500", "7.1.2", 25, listOf("arm64-v8a", "armeabi-v7a"))
        val report = buildReport(
            device,
            ProbeResult(Verdict.FAIL, "No stick movement.", listOf("no joystick")),
            ProbeResult(Verdict.PASS, "Advertising works."),
            ProbeResult(Verdict.NOT_INCLUDED, "Small build."),
        )

        assertEquals(
            """
            RC PROBE REPORT (app 1.0)
            Device: DJI RM500, Android 7.1.2 (API 25), arm64-v8a/armeabi-v7a

            1 STICKS AS INPUT DEVICE: FAIL
              No stick movement.
              - no joystick

            2 BLUETOOTH LE ADVERTISING: PASS
              Advertising works.

            3 DJI SDK, AIRCRAFT OFF: NOT IN THIS BUILD
              Small build.
            """.trimIndent(),
            report,
        )
    }
}

class ReportCrashLineTest {
    private val device = DeviceFacts("1.0", "DJI", "RM500", "7.1.2", 25, listOf("arm64-v8a"))
    private val none = ProbeResult(Verdict.NOT_RUN, "Not run.")

    @Test
    fun `the report has no crash line when the app never closed by itself`() {
        assertFalse(buildReport(device, none, none, none).contains("CLOSED BY ITSELF"))
    }

    @Test
    fun `the report ends with why the app closed by itself`() {
        val report = buildReport(device, none, none, none, "2026-11-23 19:00: java.lang.Error: boom")

        assertTrue(
            report.endsWith(
                "\n\nTHE APP CLOSED BY ITSELF EARLIER:\n  2026-11-23 19:00: java.lang.Error: boom",
            ),
        )
    }
}
