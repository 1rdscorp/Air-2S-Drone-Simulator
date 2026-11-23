package com.air2ssim.rcprobe

import android.app.Activity
import android.content.Context
import android.content.Intent

/**
 * Probe 3: does the DJI Mobile SDK deliver stick values while the aircraft is off?
 *
 * The real probe is only in the "dji" build, which contains the SDK. The "plain" build has
 * a stand-in that says so. Both are created by `DjiProbeFactory`, one per build.
 */
interface DjiProbe {
    /** Starts the probe, or continues it after permissions were granted. */
    fun start(activity: Activity)

    /** Call from the activity when Android reports the answer to a permission request. */
    fun onPermissionsResult(requestCode: Int)

    /** Call with the intent that started the activity, and with every later one. */
    fun onIntent(context: Context, intent: Intent?)

    fun findings(nowMs: Long): DjiFindings

    /** The newest stick values, for the Bluetooth test packet; null when there are none. */
    fun latestSticks(): StickValues?

    /** True while the SDK reports a connected aircraft. */
    fun aircraftConnected(): Boolean

    fun stop()
}

/** The stand-in used by the build without the DJI SDK. */
class NoDjiProbe : DjiProbe {
    override fun start(activity: Activity) = Unit

    override fun onPermissionsResult(requestCode: Int) = Unit

    override fun onIntent(context: Context, intent: Intent?) = Unit

    override fun findings(nowMs: Long) = DjiFindings(
        included = false,
        keyPresent = false,
        state = DjiState.NOT_STARTED,
        secondsInState = 0,
        error = null,
        productName = null,
        aircraftConnected = false,
        updates = 0,
        updatesPerSecond = 0.0,
        sticks = null,
        stickTravel = 0,
        axesMoved = 0,
        log = emptyList(),
    )

    override fun latestSticks(): StickValues? = null

    override fun aircraftConnected() = false

    override fun stop() = Unit
}
