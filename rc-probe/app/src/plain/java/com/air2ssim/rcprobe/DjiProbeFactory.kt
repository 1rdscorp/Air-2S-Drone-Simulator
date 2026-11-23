package com.air2ssim.rcprobe

/** The small build has no DJI SDK, so its DJI probe only says that it is not included. */
object DjiProbeFactory {
    fun create(): DjiProbe = NoDjiProbe()
}
