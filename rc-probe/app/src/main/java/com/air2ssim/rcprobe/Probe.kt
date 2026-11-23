package com.air2ssim.rcprobe

/** How a probe turned out. */
enum class Verdict(val label: String) {
    PASS("PASS"),
    FAIL("FAIL"),

    /** The probe is running, or needs the person to do something. */
    WAITING("WAITING"),
    NOT_RUN("NOT RUN"),

    /** This build of the app does not contain the probe. */
    NOT_INCLUDED("NOT IN THIS BUILD"),
}

/** The outcome of one probe: the verdict, one sentence, and the facts behind it. */
data class ProbeResult(
    val verdict: Verdict,
    val summary: String,
    val details: List<String> = emptyList(),
)

/** Positions of the two sticks as the DJI SDK reports them: -660 to 660 on each axis. */
data class StickValues(
    val leftX: Int,
    val leftY: Int,
    val rightX: Int,
    val rightY: Int,
)

/** Remembers how far each stick axis has travelled, to tell real movement from noise. */
class StickTravel {
    private val lowest = IntArray(4) { Int.MAX_VALUE }
    private val highest = IntArray(4) { Int.MIN_VALUE }

    fun record(sticks: StickValues) {
        val values = intArrayOf(sticks.leftX, sticks.leftY, sticks.rightX, sticks.rightY)
        for (axis in values.indices) {
            lowest[axis] = minOf(lowest[axis], values[axis])
            highest[axis] = maxOf(highest[axis], values[axis])
        }
    }

    /** The largest distance between the lowest and the highest value seen on any one axis. */
    fun largest(): Int {
        var travel = 0
        for (axis in lowest.indices) {
            if (highest[axis] >= lowest[axis]) {
                travel = maxOf(travel, highest[axis] - lowest[axis])
            }
        }
        return travel
    }

    /** Number of axes that moved by at least `threshold`. */
    fun axesMoved(threshold: Int): Int =
        lowest.indices.count { highest[it] >= lowest[it] && highest[it] - lowest[it] >= threshold }
}

/** Counts events per second over the last `windowMs` milliseconds. */
class RateMeter(private val windowMs: Long = 2000) {
    private val times = ArrayDeque<Long>()

    @Synchronized
    fun record(nowMs: Long) {
        times.addLast(nowMs)
        drop(nowMs)
    }

    @Synchronized
    fun perSecond(nowMs: Long): Double {
        drop(nowMs)
        return times.size * 1000.0 / windowMs
    }

    @Synchronized
    fun clear() {
        times.clear()
    }

    private fun drop(nowMs: Long) {
        while (times.isNotEmpty() && times.first() <= nowMs - windowMs) {
            times.removeFirst()
        }
    }
}
