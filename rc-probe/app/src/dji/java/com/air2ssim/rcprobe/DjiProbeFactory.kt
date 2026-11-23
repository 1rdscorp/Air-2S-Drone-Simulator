package com.air2ssim.rcprobe

/** This build contains the DJI SDK, so it gets the real probe. */
object DjiProbeFactory {
    fun create(): DjiProbe = RealDjiProbe()
}
