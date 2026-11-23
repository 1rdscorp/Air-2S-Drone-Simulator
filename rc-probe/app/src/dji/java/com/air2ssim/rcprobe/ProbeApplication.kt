package com.air2ssim.rcprobe

import android.app.Application
import android.content.Context
import com.cySdkyc.clx.Helper

/**
 * The DJI Mobile SDK v4 ships most of its code packed inside the app and unpacks it here,
 * before anything else runs. This is the call DJI's own sample makes for SDK 4.18.
 *
 * If the unpacking fails on this device, the app still opens: probes 1 and 2 do not need
 * the SDK, and probe 3 then reports what went wrong.
 */
class ProbeApplication : Application() {
    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(base)
        CrashNotes.install(this)
        try {
            Helper.install(this)
        } catch (failure: Throwable) {
            sdkProblem = CrashNotes.describe(failure)
        }
    }

    companion object {
        /** Why the DJI SDK could not be unpacked, or null when it started normally. */
        @Volatile
        var sdkProblem: String? = null
    }
}
