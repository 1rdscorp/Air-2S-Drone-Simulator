package com.air2ssim.rcprobe

import android.bluetooth.BluetoothManager
import android.content.ClipboardManager
import android.content.Context
import android.view.View
import android.widget.Button
import android.widget.TextView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper
import org.robolectric.shadows.ShadowSystemClock
import java.time.Duration

/**
 * Starts the real screen of the small build on a simulated Android 7.1, the version the
 * Smart Controller runs. This cannot show that Bluetooth works on the controller, but it
 * does show that the screen opens, that every button can be pressed, and what it then says.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [25])
class MainActivityTest {
    private fun start(): MainActivity {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        ShadowLooper.idleMainLooper()
        return activity
    }

    private fun MainActivity.textOf(id: Int): String = findViewById<TextView>(id).text.toString()

    private fun MainActivity.press(id: Int) {
        findViewById<Button>(id).performClick()
        ShadowLooper.idleMainLooper()
    }

    /** Lets simulated time pass and the screen refresh itself. */
    private fun pass(seconds: Long) {
        ShadowSystemClock.advanceBy(Duration.ofSeconds(seconds))
        ShadowLooper.idleMainLooper()
    }

    @Test
    fun `opens with the safety notice and nothing run yet`() {
        val activity = start()

        assertTrue(activity.textOf(R.id.title).startsWith("RC Probe 1.0"))
        assertTrue(activity.textOf(R.id.device).contains("Android 7.1"))
        assertTrue(activity.textOf(R.id.safety).contains("switch the aircraft OFF"))
        assertEquals("NOT RUN", activity.textOf(R.id.input_verdict))
        assertEquals("NOT IN THIS BUILD", activity.textOf(R.id.dji_verdict))
        assertEquals(View.GONE, activity.findViewById<Button>(R.id.dji_button).visibility)
    }

    @Test
    fun `the stick test waits ten seconds and fails when no stick movement arrives`() {
        val activity = start()

        activity.press(R.id.input_button)
        assertEquals("WAITING", activity.textOf(R.id.input_verdict))
        assertTrue(activity.textOf(R.id.input_summary).contains("Move both sticks in circles now"))

        pass(11)
        assertEquals("FAIL", activity.textOf(R.id.input_verdict))
        assertTrue(activity.textOf(R.id.input_details).contains("no joystick or gamepad"))
    }

    @Test
    fun `with Bluetooth switched off it asks to switch it on`() {
        val activity = start()

        assertEquals("WAITING", activity.textOf(R.id.ble_verdict))
        assertTrue(activity.textOf(R.id.ble_summary).contains("Bluetooth is switched off"))

        activity.press(R.id.ble_button) // must not crash; it asks Android to switch Bluetooth on
        assertEquals("WAITING", activity.textOf(R.id.ble_verdict))
    }

    @Test
    fun `with Bluetooth on, pressing the button runs the Bluetooth test to a verdict`() {
        val activity = start()
        val manager = activity.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        shadowOf(manager.adapter).setEnabled(true)
        pass(1)
        assertEquals("NOT RUN", activity.textOf(R.id.ble_verdict))

        activity.press(R.id.ble_button)
        pass(1)

        // The simulated Android has no real radio, so either outcome is possible here; what
        // matters is that the test ends in a clear verdict with a reason, not in a crash.
        val verdict = activity.textOf(R.id.ble_verdict)
        assertTrue("verdict was $verdict", verdict == "PASS" || verdict == "FAIL")
        assertTrue(activity.textOf(R.id.ble_summary).isNotEmpty())
    }

    @Test
    fun `the report lists the three probes and can be copied`() {
        val activity = start()
        val report = activity.textOf(R.id.report)

        assertTrue(report.startsWith("RC PROBE REPORT (app 1.0)"))
        assertTrue(report.contains("1 STICKS AS INPUT DEVICE: NOT RUN"))
        assertTrue(report.contains("2 BLUETOOTH LE ADVERTISING: WAITING"))
        assertTrue(report.contains("3 DJI SDK, AIRCRAFT OFF: NOT IN THIS BUILD"))

        activity.press(R.id.copy_button)
        val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        assertEquals(report, clipboard.primaryClip?.getItemAt(0)?.text.toString())
    }

    @Test
    fun `survives being closed while the Bluetooth test runs`() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val manager = activity.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        shadowOf(manager.adapter).setEnabled(true)
        activity.press(R.id.ble_button)

        controller.pause().stop().destroy()
    }
}
