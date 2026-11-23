package com.air2ssim.rcprobe

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelUuid
import android.os.SystemClock
import java.util.UUID

/**
 * Probe 2: can this device act as a Bluetooth LE device that a computer connects to?
 *
 * It opens a small data service, starts advertising it, and then sends a 20-byte test
 * packet 50 times per second to every computer that listens. The page
 * `controller-check.html` on the PC connects and counts what arrives.
 *
 * The app targets Android 11, so on every Android version the two old Bluetooth
 * permissions in the manifest are enough and nothing has to be asked at run time.
 */
@SuppressLint("MissingPermission")
class BleProbe(
    private val context: Context,
    /** Stick values and aircraft state to put into the test packet, if another probe has them. */
    private val sticks: () -> StickValues?,
    private val aircraftConnected: () -> Boolean,
) {
    private val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?
    private val lock = Any()

    private var gattServer: BluetoothGattServer? = null
    private var characteristic: BluetoothGattCharacteristic? = null
    private var advertiser: BluetoothLeAdvertiser? = null

    private var multipleAdvertisement: Boolean? = null
    private var hasAdvertiser: Boolean? = null
    private var gattServerOpened: Boolean? = null
    private var advertising = AdvertisingState.NOT_STARTED
    private var advertisingError: Int? = null
    private var problem: String? = null
    private var nameIncluded = true

    private val connected = HashSet<BluetoothDevice>()
    private val subscribers = HashSet<BluetoothDevice>()
    private var packetsSent = 0L
    private var packetsSkipped = 0L
    private var counter = 0L
    private var awaitingSent = 0
    private var awaitingSince = 0L
    private var lastPacket = ByteArray(TestPacket.SIZE)
    private val rate = RateMeter()

    private var sendThread: HandlerThread? = null
    private var sendHandler: Handler? = null
    private var startedAt = 0L

    /** Starts the test: data service first, then advertising. Safe to call again. */
    fun start() {
        val adapter = manager?.adapter
        if (adapter == null || !adapter.isEnabled) {
            return // `findings` reports the missing or switched-off Bluetooth
        }
        stop()
        synchronized(lock) {
            multipleAdvertisement = null
            hasAdvertiser = null
            gattServerOpened = null
            advertising = AdvertisingState.STARTING
            advertisingError = null
            problem = null
            nameIncluded = true
            packetsSent = 0
            packetsSkipped = 0
            counter = 0
            awaitingSent = 0
            rate.clear()
        }
        try {
            openServiceAndAdvertise(adapter)
        } catch (failure: RuntimeException) {
            // This device is untested: whatever Android throws must end up in the report.
            fail("${failure.javaClass.simpleName}: ${failure.message}")
        }
    }

    private fun openServiceAndAdvertise(adapter: BluetoothAdapter) {
        val supported = adapter.isMultipleAdvertisementSupported
        val leAdvertiser = adapter.bluetoothLeAdvertiser
        synchronized(lock) {
            multipleAdvertisement = supported
            hasAdvertiser = leAdvertiser != null
        }
        if (leAdvertiser == null) {
            fail(null)
            return
        }
        advertiser = leAdvertiser

        val server = manager?.openGattServer(context, serverCallback)
        synchronized(lock) { gattServerOpened = server != null }
        if (server == null) {
            fail("Android did not open a data service (GATT server).")
            return
        }
        gattServer = server

        val notify = BluetoothGattCharacteristic(
            PACKET_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ,
        )
        // A computer switches the packets on by writing to this standard descriptor.
        notify.addDescriptor(
            BluetoothGattDescriptor(
                CLIENT_CONFIG_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
            ),
        )
        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        service.addCharacteristic(notify)
        characteristic = notify
        // Advertising starts in `onServiceAdded`, once the service really exists.
        if (!server.addService(service)) {
            fail("Android refused to add the data service.")
        }
    }

    private fun fail(reason: String?) {
        synchronized(lock) {
            advertising = AdvertisingState.FAILED
            if (reason != null) {
                problem = reason
            }
        }
    }

    fun stop() {
        sendThread?.quitSafely()
        sendThread = null
        sendHandler = null
        try {
            advertiser?.stopAdvertising(advertiseCallback)
        } catch (_: RuntimeException) {
            // Bluetooth was switched off meanwhile; there is nothing left to stop.
        }
        try {
            gattServer?.close()
        } catch (_: RuntimeException) {
            // As above.
        }
        gattServer = null
        characteristic = null
        synchronized(lock) {
            connected.clear()
            subscribers.clear()
            if (advertising != AdvertisingState.FAILED) {
                advertising = AdvertisingState.NOT_STARTED
            }
        }
    }

    fun findings(nowMs: Long): BleFindings {
        val adapter = manager?.adapter
        synchronized(lock) {
            return BleFindings(
                hasAdapter = adapter != null,
                enabled = adapter?.isEnabled == true,
                multipleAdvertisement = multipleAdvertisement,
                hasAdvertiser = hasAdvertiser,
                gattServerOpened = gattServerOpened,
                advertising = advertising,
                advertisingError = advertisingError,
                problem = problem,
                nameIncluded = nameIncluded,
                connectedDevices = connected.size,
                subscribers = subscribers.size,
                packetsSent = packetsSent,
                packetsPerSecond = rate.perSecond(nowMs),
                packetsSkipped = packetsSkipped,
            )
        }
    }

    private fun startAdvertising(withName: Boolean) {
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .setTimeout(0)
            .build()
        // The service id goes into the advertisement so the PC can find this device by it.
        // The name goes into the scan response, because both do not fit into one packet.
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()
        synchronized(lock) { nameIncluded = withName }
        try {
            if (withName) {
                val scanResponse = AdvertiseData.Builder().setIncludeDeviceName(true).build()
                advertiser?.startAdvertising(settings, data, scanResponse, advertiseCallback)
            } else {
                advertiser?.startAdvertising(settings, data, advertiseCallback)
            }
        } catch (failure: RuntimeException) {
            fail("${failure.javaClass.simpleName}: ${failure.message}")
        }
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            synchronized(lock) { advertising = AdvertisingState.STARTED }
            startSending()
        }

        override fun onStartFailure(errorCode: Int) {
            val retryWithoutName = synchronized(lock) {
                errorCode == ADVERTISE_FAILED_DATA_TOO_LARGE && nameIncluded
            }
            if (retryWithoutName) {
                // A long device name does not fit; the PC finds the service without it.
                startAdvertising(withName = false)
            } else {
                synchronized(lock) {
                    advertising = AdvertisingState.FAILED
                    advertisingError = errorCode
                }
            }
        }
    }

    private val serverCallback = object : BluetoothGattServerCallback() {
        override fun onServiceAdded(status: Int, service: BluetoothGattService?) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                startAdvertising(withName = true)
            } else {
                fail("Android could not add the data service (status $status).")
            }
        }

        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            synchronized(lock) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    connected += device
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    connected -= device
                    subscribers -= device
                    awaitingSent = 0
                }
            }
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic,
        ) {
            val packet = synchronized(lock) { lastPacket }
            val rest = if (offset < packet.size) packet.copyOfRange(offset, packet.size) else ByteArray(0)
            gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, rest)
        }

        override fun onDescriptorReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            descriptor: BluetoothGattDescriptor,
        ) {
            val listening = synchronized(lock) { device in subscribers }
            val value = if (listening) {
                BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            } else {
                BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
            }
            gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?,
        ) {
            if (descriptor.uuid == CLIENT_CONFIG_UUID) {
                val wantsPackets = value != null && value.isNotEmpty() && value[0].toInt() and 0x01 != 0
                synchronized(lock) {
                    if (wantsPackets) subscribers += device else subscribers -= device
                }
            }
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
            }
        }

        override fun onNotificationSent(device: BluetoothDevice, status: Int) {
            synchronized(lock) {
                if (awaitingSent > 0) awaitingSent--
            }
        }
    }

    /** Sends one test packet every 20 ms on its own thread, so the screen cannot delay it. */
    private fun startSending() {
        if (sendThread != null) {
            return
        }
        val thread = HandlerThread("rc-probe-ble").apply { start() }
        val handler = Handler(thread.looper)
        sendThread = thread
        sendHandler = handler
        startedAt = SystemClock.uptimeMillis()
        var next = startedAt
        handler.post(object : Runnable {
            override fun run() {
                sendPacket()
                next += SEND_INTERVAL_MS
                val now = SystemClock.uptimeMillis()
                if (next < now) next = now // fell behind: do not send a burst to catch up
                handler.postAtTime(this, next)
            }
        })
    }

    private fun sendPacket() {
        val server = gattServer ?: return
        val notify = characteristic ?: return
        val now = SystemClock.uptimeMillis()
        val targets: List<BluetoothDevice>
        val packet: ByteArray
        synchronized(lock) {
            if (subscribers.isEmpty()) {
                return
            }
            // Android accepts the next packet only after it has sent the previous one. Should
            // its "sent" message ever go missing, do not wait for it for ever.
            if (awaitingSent > 0 && now - awaitingSince > SENT_TIMEOUT_MS) {
                awaitingSent = 0
            }
            if (awaitingSent > 0) {
                packetsSkipped++
                return
            }
            packet = TestPacket.encode(counter, now - startedAt, sticks(), aircraftConnected())
            counter++
            lastPacket = packet
            targets = subscribers.toList()
            awaitingSent = targets.size
            awaitingSince = now
        }
        var accepted = 0
        for (device in targets) {
            if (notifyDevice(server, device, notify, packet)) accepted++
        }
        synchronized(lock) {
            awaitingSent -= targets.size - accepted
            if (awaitingSent < 0) awaitingSent = 0
            if (accepted > 0) {
                packetsSent++
                rate.record(now)
            } else {
                packetsSkipped++
            }
        }
    }

    private fun notifyDevice(
        server: BluetoothGattServer,
        device: BluetoothDevice,
        notify: BluetoothGattCharacteristic,
        packet: ByteArray,
    ): Boolean = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            server.notifyCharacteristicChanged(device, notify, false, packet) ==
                BluetoothStatusCodes.SUCCESS
        } else {
            @Suppress("DEPRECATION")
            notify.value = packet
            @Suppress("DEPRECATION")
            server.notifyCharacteristicChanged(device, notify, false)
        }
    } catch (_: RuntimeException) {
        false
    }

    companion object {
        /** Ids of the test service. The check page on the PC uses the same ones. */
        val SERVICE_UUID: UUID = UUID.fromString("6a1e0001-7d0c-4b7a-9c53-a25c0de5ad01")
        val PACKET_UUID: UUID = UUID.fromString("6a1e0002-7d0c-4b7a-9c53-a25c0de5ad01")

        /** The standard "client characteristic configuration" descriptor. */
        val CLIENT_CONFIG_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        /** 20 ms between packets is 50 packets per second. */
        const val SEND_INTERVAL_MS = 20L

        /** How long to wait for Android to confirm a packet before sending the next anyway. */
        const val SENT_TIMEOUT_MS = 250L
    }
}
