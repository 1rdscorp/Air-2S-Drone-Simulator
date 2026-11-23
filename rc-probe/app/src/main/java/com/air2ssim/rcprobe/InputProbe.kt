package com.air2ssim.rcprobe

import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import kotlin.math.abs

/**
 * Probe 1: does Android itself see the sticks, as a joystick or a gamepad?
 *
 * It lists Android's input devices, and during a 10-second test it counts joystick events
 * in which an axis really moved. If the sticks were a normal input device, no DJI SDK
 * would be needed to read them.
 */
class InputProbe {
    private var testStartedAt: Long? = null
    private var stickEvents = 0
    private var stickDevice: String? = null
    private val lastAxisValues = HashMap<Long, Float>()
    private val keysSeen = LinkedHashSet<String>()

    fun startTest(nowMs: Long) {
        testStartedAt = nowMs
        stickEvents = 0
        stickDevice = null
        lastAxisValues.clear()
    }

    /** Call for every generic motion event the activity receives. Returns true if it was a stick. */
    fun onMotionEvent(event: MotionEvent): Boolean {
        if (event.source and InputDevice.SOURCE_CLASS_JOYSTICK == 0) {
            return false
        }
        val device = event.device ?: return false
        var moved = false
        for (range in device.motionRanges) {
            if (range.source and InputDevice.SOURCE_CLASS_JOYSTICK == 0) {
                continue
            }
            val value = event.getAxisValue(range.axis)
            val key = device.id.toLong() * 1000 + range.axis
            val previous = lastAxisValues.put(key, value)
            if (previous != null && abs(value - previous) > AXIS_NOISE) {
                moved = true
            }
        }
        if (moved) {
            stickEvents++
            stickDevice = device.name
        }
        return true
    }

    /** Call for every key event the activity receives; the keys are only noted, not used. */
    fun onKeyEvent(event: KeyEvent) {
        if (event.action == KeyEvent.ACTION_DOWN && keysSeen.size < MAX_KEYS_LISTED) {
            keysSeen += KeyEvent.keyCodeToString(event.keyCode).removePrefix("KEYCODE_")
        }
    }

    fun findings(nowMs: Long): InputFindings {
        val startedAt = testStartedAt
        val elapsed = if (startedAt == null) 0 else nowMs - startedAt
        val state = when {
            startedAt == null -> TestState.NOT_STARTED
            elapsed < TEST_MS -> TestState.RUNNING
            else -> TestState.FINISHED
        }
        return InputFindings(
            devices = listDevices(),
            test = state,
            secondsLeft = if (state == TestState.RUNNING) ((TEST_MS - elapsed + 999) / 1000).toInt() else 0,
            stickEvents = stickEvents,
            stickDevice = stickDevice,
            keysSeen = keysSeen.toList(),
        )
    }

    private fun listDevices(): List<InputDeviceInfo> =
        InputDevice.getDeviceIds().toList().mapNotNull { id ->
            val device = InputDevice.getDevice(id) ?: return@mapNotNull null
            val sources = device.sources
            val joystick = sources and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK
            val gamepad = sources and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD
            InputDeviceInfo(
                name = device.name ?: "unnamed",
                isGameController = joystick || gamepad,
                axes = device.motionRanges.count {
                    it.source and InputDevice.SOURCE_CLASS_JOYSTICK != 0
                },
            )
        }

    private companion object {
        const val TEST_MS = 10_000L

        /** Axis values run from -1 to 1; smaller changes than this are jitter. */
        const val AXIS_NOISE = 0.02f
        const val MAX_KEYS_LISTED = 12
    }
}
