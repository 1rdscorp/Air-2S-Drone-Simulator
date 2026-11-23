package com.air2ssim.rcprobe

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.usb.UsbManager
import android.os.SystemClock
import dji.common.error.DJIError
import dji.common.error.DJISDKError
import dji.common.remotecontroller.HardwareState
import dji.sdk.base.BaseComponent
import dji.sdk.base.BaseProduct
import dji.sdk.products.Aircraft
import dji.sdk.remotecontroller.RemoteController
import dji.sdk.sdkmanager.DJISDKInitEvent
import dji.sdk.sdkmanager.DJISDKManager
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Probe 3 with the DJI Mobile SDK v4: registers the app with DJI, waits for the SDK to
 * report the remote controller, and listens to its "hardware state", which carries the
 * stick positions. Whether that arrives with the aircraft switched off is the question.
 *
 * Everything the SDK tells us is kept as a short note for the report, because on the real
 * controller the notes are the only way to see what happened.
 */
class RealDjiProbe : DjiProbe {
    private val lock = Any()
    private val registering = AtomicBoolean(false)

    private var appContext: Context? = null
    private var state = DjiState.NOT_STARTED
    private var stateSince = SystemClock.uptimeMillis()
    private var error: String? = null
    private var productName: String? = null
    private var aircraft = false
    private var registered = false
    private var watched: RemoteController? = null

    private var updates = 0L
    private var sticks: StickValues? = null
    private val travel = StickTravel()
    private val rate = RateMeter()
    private val log = ArrayList<String>()

    override fun start(activity: Activity) {
        if (!BuildConfig.DJI_KEY_PRESENT) {
            return // `findings` reports the missing key
        }
        appContext = activity.applicationContext
        val sdkProblem = ProbeApplication.sdkProblem
        if (sdkProblem != null) {
            note("the SDK did not start")
            setState(DjiState.REGISTER_FAILED, "the DJI SDK did not start on this device. $sdkProblem")
            return
        }
        val missing = missingPermissions(activity)
        if (missing.isNotEmpty()) {
            setState(DjiState.NEEDS_PERMISSIONS)
            activity.requestPermissions(missing.toTypedArray(), REQUEST_PERMISSIONS)
            return
        }
        register()
    }

    override fun onPermissionsResult(requestCode: Int) {
        val context = appContext ?: return
        if (requestCode == REQUEST_PERMISSIONS && missingPermissions(context).isEmpty()) {
            register()
        }
    }

    override fun onIntent(context: Context, intent: Intent?) {
        // The controller's radio shows up as a USB accessory; the SDK wants to be told.
        if (intent?.action == UsbManager.ACTION_USB_ACCESSORY_ATTACHED) {
            note("USB accessory attached")
            context.sendBroadcast(Intent(DJISDKManager.USB_ACCESSORY_ATTACHED))
        }
    }

    override fun findings(nowMs: Long): DjiFindings {
        if (synchronized(lock) { registered }) {
            // Do not rely on the SDK's callbacks alone: ask it what it has, every time.
            guarded("getProduct") { inspect(DJISDKManager.getInstance().product) }
        }
        synchronized(lock) {
            return DjiFindings(
                included = true,
                keyPresent = BuildConfig.DJI_KEY_PRESENT,
                state = state,
                secondsInState = ((nowMs - stateSince) / 1000).toInt(),
                error = error,
                productName = productName,
                aircraftConnected = aircraft,
                updates = updates,
                updatesPerSecond = rate.perSecond(nowMs),
                sticks = sticks,
                stickTravel = travel.largest(),
                axesMoved = travel.axesMoved(DJI_STICK_TRAVEL_NEEDED),
                log = log.toList(),
            )
        }
    }

    override fun latestSticks(): StickValues? = synchronized(lock) { sticks }

    override fun aircraftConnected(): Boolean = synchronized(lock) { aircraft }

    override fun stop() {
        val controller = synchronized(lock) { watched.also { watched = null } }
        guarded("stop") { controller?.setHardwareStateCallback(null) }
    }

    private fun missingPermissions(context: Context): List<String> =
        RUNTIME_PERMISSIONS.filter {
            context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }

    private fun register() {
        val context = appContext ?: return
        if (!registering.compareAndSet(false, true)) {
            return
        }
        setState(DjiState.REGISTERING)
        // Registration talks to DJI's server and must not block the screen.
        Thread({
            guarded("registerApp", onFailure = { message ->
                registering.set(false)
                setState(DjiState.REGISTER_FAILED, message)
            }) {
                note("SDK version ${DJISDKManager.getInstance().sdkVersion}")
                DJISDKManager.getInstance().registerApp(context, callback)
            }
        }, "rc-probe-dji").start()
    }

    private val callback = object : DJISDKManager.SDKManagerCallback {
        override fun onRegister(result: DJIError?) {
            registering.set(false)
            if (result == DJISDKError.REGISTRATION_SUCCESS) {
                note("registered with DJI")
                synchronized(lock) { registered = true }
                setState(DjiState.WAITING_FOR_CONTROLLER)
                guarded("startConnectionToProduct") {
                    val started = DJISDKManager.getInstance().startConnectionToProduct()
                    note("connection to product started: $started")
                }
            } else {
                val reason = result?.description ?: "no reason given"
                note("registration failed: $reason")
                setState(DjiState.REGISTER_FAILED, reason)
            }
        }

        override fun onProductDisconnect() {
            note("product disconnected")
        }

        override fun onProductConnect(product: BaseProduct?) {
            note("product connected")
            guarded("onProductConnect") { inspect(product) }
        }

        override fun onProductChanged(product: BaseProduct?) {
            note("product changed")
            guarded("onProductChanged") { inspect(product) }
        }

        override fun onComponentChange(
            key: BaseProduct.ComponentKey?,
            oldComponent: BaseComponent?,
            newComponent: BaseComponent?,
        ) {
            note("component ${key?.name ?: "?"}: ${if (newComponent == null) "gone" else "present"}")
            guarded("onComponentChange") { inspect(DJISDKManager.getInstance().product) }
        }

        override fun onInitProcess(event: DJISDKInitEvent?, totalProcess: Int) {
            // Start-up progress; too chatty for the report.
        }

        override fun onDatabaseDownloadProgress(current: Long, total: Long) {
            // The no-fly-zone database; not needed by the probe.
        }
    }

    /** Looks at what the SDK calls the product and starts listening to its remote controller. */
    private fun inspect(product: BaseProduct?) {
        val name = product?.model?.displayName ?: if (product == null) null else "a product without a model"
        // `isConnected` on the product means the aircraft itself answers.
        val aircraftOn = product?.isConnected == true
        val controller = (product as? Aircraft)?.remoteController

        val isNew = synchronized(lock) {
            if (name != productName) {
                productName = name
            }
            aircraft = aircraftOn
            if (controller != null && controller !== watched) {
                watched = controller
                true
            } else {
                false
            }
        }
        if (isNew && controller != null) {
            note("remote controller found (connected: ${controller.isConnected})")
            controller.setHardwareStateCallback(::onHardwareState)
            setState(DjiState.CONTROLLER_FOUND)
        }
    }

    private fun onHardwareState(hardware: HardwareState) {
        val left = hardware.leftStick
        val right = hardware.rightStick
        val values = StickValues(
            leftX = left?.horizontalPosition ?: 0,
            leftY = left?.verticalPosition ?: 0,
            rightX = right?.horizontalPosition ?: 0,
            rightY = right?.verticalPosition ?: 0,
        )
        val now = SystemClock.uptimeMillis()
        synchronized(lock) {
            updates++
            sticks = values
            travel.record(values)
        }
        rate.record(now)
    }

    private fun setState(next: DjiState, problem: String? = null) {
        synchronized(lock) {
            if (state != next) {
                state = next
                stateSince = SystemClock.uptimeMillis()
            }
            error = problem
        }
    }

    private fun note(text: String) {
        synchronized(lock) {
            // The same note many times in a row says nothing new.
            if (log.lastOrNull() != text) {
                log += text
                if (log.size > MAX_NOTES) {
                    log.removeAt(0)
                }
            }
        }
    }

    /** The SDK is old and this device is untested: a failure inside it must end up in the report. */
    private fun guarded(what: String, onFailure: (String) -> Unit = {}, action: () -> Unit) {
        try {
            action()
        } catch (failure: Throwable) {
            val message = "$what failed: ${CrashNotes.describe(failure, maxFrames = 2)}"
            note(message)
            onFailure(message)
        }
    }

    private companion object {
        const val REQUEST_PERMISSIONS = 4
        const val MAX_NOTES = 20

        /** The permissions Android asks the person for. DJI's sample requests these before registering. */
        val RUNTIME_PERMISSIONS = listOf(
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.WRITE_EXTERNAL_STORAGE,
            Manifest.permission.READ_EXTERNAL_STORAGE,
            Manifest.permission.READ_PHONE_STATE,
        )
    }
}
