package com.air2ssim.rcprobe

import android.content.Context
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Remembers why the app closed by itself, and shows it in the report the next time the
 * app is opened. The app runs on a device nobody could test it on, so a crash must leave
 * a trace that can be photographed.
 *
 * Only failures in Java or Kotlin code can be caught this way. A crash inside one of the
 * DJI SDK's native libraries leaves no note.
 */
object CrashNotes {
    private const val FILE_NAME = "last-crash.txt"
    private var installed = false

    @Synchronized
    fun install(context: Context) {
        if (installed) {
            return
        }
        installed = true
        val file = File(context.filesDir, FILE_NAME)
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, failure ->
            try {
                val time = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date())
                file.writeText("$time, thread ${thread.name}: ${describe(failure)}")
            } catch (_: Throwable) {
                // Nothing more can be done; let Android close the app as usual.
            }
            previous?.uncaughtException(thread, failure)
        }
    }

    /** The note left by the last crash, or null if there is none. */
    fun read(context: Context): String? = try {
        File(context.filesDir, FILE_NAME).takeIf { it.exists() }?.readText()?.takeIf { it.isNotBlank() }
    } catch (_: Throwable) {
        null
    }

    /**
     * A failure in a few lines: what it was, the deepest cause, and where it happened.
     * Short enough to read off a photographed screen.
     */
    fun describe(failure: Throwable, maxFrames: Int = 4): String {
        var root = failure
        var depth = 0
        while (root.cause != null && root.cause !== root && depth < 10) {
            root = root.cause!!
            depth++
        }
        val parts = mutableListOf("${failure.javaClass.name}: ${failure.message}")
        if (root !== failure) {
            parts += "caused by ${root.javaClass.name}: ${root.message}"
        }
        root.stackTrace.take(maxFrames).forEach { frame ->
            parts += "at ${frame.className}.${frame.methodName}(${frame.fileName}:${frame.lineNumber})"
        }
        return parts.joinToString(" | ")
    }
}
