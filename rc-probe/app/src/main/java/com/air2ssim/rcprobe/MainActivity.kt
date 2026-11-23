package com.air2ssim.rcprobe

import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import android.widget.Toast

/**
 * The one screen of the app: three probes, each with a verdict, and the report below them.
 *
 * The probes do their work on their own; this screen asks them four times per second what
 * they have found and shows it.
 */
class MainActivity : Activity() {
    private val inputProbe = InputProbe()
    private lateinit var djiProbe: DjiProbe
    private lateinit var bleProbe: BleProbe

    private val handler = Handler(Looper.getMainLooper())
    private var report = ""
    private var lastCrash: String? = null

    private val refresher = object : Runnable {
        override fun run() {
            refresh()
            handler.postDelayed(this, REFRESH_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CrashNotes.install(applicationContext)
        lastCrash = CrashNotes.read(applicationContext)
        setContentView(R.layout.activity_main)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        djiProbe = DjiProbeFactory.create()
        bleProbe = BleProbe(
            applicationContext,
            sticks = { djiProbe.latestSticks() },
            aircraftConnected = { djiProbe.aircraftConnected() },
        )

        val facts = deviceFacts()
        text(R.id.title).text = getString(R.string.app_name) + " " + facts.appVersion
        text(R.id.device).text = "${facts.manufacturer} ${facts.model} · Android ${facts.androidVersion} " +
            "(API ${facts.apiLevel}) · ${facts.abis.joinToString(" / ")}"

        findViewById<Button>(R.id.input_button).setOnClickListener {
            inputProbe.startTest(SystemClock.uptimeMillis())
            refresh()
        }
        findViewById<Button>(R.id.ble_button).setOnClickListener {
            startBluetoothTest()
            refresh()
        }
        findViewById<Button>(R.id.dji_button).setOnClickListener {
            djiProbe.start(this)
            refresh()
        }
        findViewById<Button>(R.id.copy_button).setOnClickListener { copyReport() }

        djiProbe.onIntent(this, intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        djiProbe.onIntent(this, intent)
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresher)
    }

    override fun onPause() {
        handler.removeCallbacks(refresher)
        super.onPause()
    }

    override fun onDestroy() {
        bleProbe.stop()
        djiProbe.stop()
        super.onDestroy()
    }

    /** Sticks that Android sees as a joystick arrive here. */
    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean =
        inputProbe.onMotionEvent(event) || super.dispatchGenericMotionEvent(event)

    /** Keys are only noted for the report; they keep doing what they normally do. */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        inputProbe.onKeyEvent(event)
        return super.dispatchKeyEvent(event)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        djiProbe.onPermissionsResult(requestCode)
    }

    // The app targets Android 11, where switching Bluetooth on needs no extra permission;
    // should a device refuse all the same, the refusal is caught below.
    @SuppressLint("MissingPermission")
    private fun startBluetoothTest() {
        val adapter = (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?)?.adapter
        if (adapter != null && !adapter.isEnabled) {
            // Ask Android to switch Bluetooth on; the person then presses the button again.
            try {
                @Suppress("DEPRECATION")
                startActivityForResult(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), REQUEST_BLUETOOTH)
            } catch (_: ActivityNotFoundException) {
                // No such dialog on this device: the verdict tells the person what to do.
            } catch (_: SecurityException) {
                // As above.
            }
            return
        }
        bleProbe.start()
    }

    private fun refresh() {
        val now = SystemClock.uptimeMillis()
        val input = inputVerdict(inputProbe.findings(now))
        val ble = bleVerdict(bleProbe.findings(now))
        val djiFindings = djiProbe.findings(now)
        val dji = djiVerdict(djiFindings)

        show(input, R.id.input_verdict, R.id.input_summary, R.id.input_details)
        show(ble, R.id.ble_verdict, R.id.ble_summary, R.id.ble_details)
        show(dji, R.id.dji_verdict, R.id.dji_summary, R.id.dji_details)

        findViewById<Button>(R.id.dji_button).visibility =
            if (djiFindings.included) View.VISIBLE else View.GONE
        text(R.id.safety).text = getString(
            if (djiFindings.aircraftConnected) R.string.aircraft_warning else R.string.safety,
        )

        report = buildReport(deviceFacts(), input, ble, dji, lastCrash)
        setTextIfChanged(text(R.id.report), report)
    }

    private fun show(result: ProbeResult, verdictId: Int, summaryId: Int, detailsId: Int) {
        val verdict = text(verdictId)
        setTextIfChanged(verdict, result.verdict.label)
        verdict.setBackgroundColor(
            getColor(
                when (result.verdict) {
                    Verdict.PASS -> R.color.pass
                    Verdict.FAIL -> R.color.fail
                    Verdict.WAITING -> R.color.waiting
                    Verdict.NOT_RUN, Verdict.NOT_INCLUDED -> R.color.not_run
                },
            ),
        )
        setTextIfChanged(text(summaryId), result.summary)
        val details = text(detailsId)
        setTextIfChanged(details, result.details.joinToString("\n") { "• $it" })
        details.visibility = if (result.details.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun copyReport() {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText(getString(R.string.report_label), report))
        Toast.makeText(this, R.string.report_copied, Toast.LENGTH_SHORT).show()
    }

    private fun deviceFacts() = DeviceFacts(
        appVersion = BuildConfig.VERSION_NAME,
        manufacturer = Build.MANUFACTURER.orEmpty(),
        model = Build.MODEL.orEmpty(),
        androidVersion = Build.VERSION.RELEASE.orEmpty(),
        apiLevel = Build.VERSION.SDK_INT,
        abis = Build.SUPPORTED_ABIS.toList(),
    )

    private fun text(id: Int): TextView = findViewById(id)

    /** Rewriting unchanged text would cancel a text selection and wastes work. */
    private fun setTextIfChanged(view: TextView, value: String) {
        if (view.text.toString() != value) {
            view.text = value
        }
    }

    private companion object {
        const val REFRESH_MS = 250L
        const val REQUEST_BLUETOOTH = 1
    }
}
