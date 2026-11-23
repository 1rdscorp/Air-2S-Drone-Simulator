package com.air2ssim.rcprobe

import java.util.Locale

// What each probe has found so far, as plain data, and the rules that turn it into a
// verdict. Nothing here touches Android, so all of it is covered by unit tests.

// ---- Probe 1: are the sticks an Android input device? ------------------------------------

data class InputDeviceInfo(
    val name: String,
    /** Android classes it as a joystick or a gamepad. */
    val isGameController: Boolean,
    /** Number of joystick axes it reports. */
    val axes: Int,
)

enum class TestState { NOT_STARTED, RUNNING, FINISHED }

data class InputFindings(
    val devices: List<InputDeviceInfo>,
    val test: TestState,
    val secondsLeft: Int,
    /** Joystick events in which an axis really moved. */
    val stickEvents: Int,
    /** Name of the device the stick events came from. */
    val stickDevice: String?,
    /** Names of the keys Android reported while the app was open. */
    val keysSeen: List<String>,
)

fun inputVerdict(findings: InputFindings): ProbeResult {
    val controllers = findings.devices.filter { it.isGameController }
    val details = buildList {
        if (controllers.isEmpty()) {
            add("Android lists no joystick or gamepad (${findings.devices.size} input devices in all).")
        } else {
            for (device in controllers) {
                add("Listed as a game controller: ${device.name} (${device.axes} axes).")
            }
        }
        if (findings.keysSeen.isNotEmpty()) {
            add("Buttons Android reported as keys: ${findings.keysSeen.joinToString(", ")}.")
        }
    }

    if (findings.stickEvents > 0) {
        val source = findings.stickDevice ?: "an input device"
        return ProbeResult(
            Verdict.PASS,
            "Android sees the sticks as a game controller: ${findings.stickEvents} stick events from $source.",
            details,
        )
    }
    return when (findings.test) {
        TestState.NOT_STARTED -> ProbeResult(
            Verdict.NOT_RUN,
            "Press \"Test the sticks\", then move both sticks in circles.",
            details,
        )
        TestState.RUNNING -> ProbeResult(
            Verdict.WAITING,
            "Move both sticks in circles now. ${findings.secondsLeft} s left.",
            details,
        )
        TestState.FINISHED -> ProbeResult(
            Verdict.FAIL,
            "No stick movement reached Android in 10 seconds. The sticks are not a normal input device.",
            details,
        )
    }
}

// ---- Probe 2: can this device advertise over Bluetooth LE? --------------------------------

enum class AdvertisingState { NOT_STARTED, STARTING, STARTED, FAILED }

data class BleFindings(
    val hasAdapter: Boolean,
    val enabled: Boolean,
    /** What Android answers to "is multiple advertisement supported"; null before the test. */
    val multipleAdvertisement: Boolean?,
    /** Whether Android handed out an advertiser object; null before the test. */
    val hasAdvertiser: Boolean?,
    val gattServerOpened: Boolean?,
    val advertising: AdvertisingState,
    /** Android's error number when advertising failed. */
    val advertisingError: Int?,
    /** What went wrong in words, when Android said so in another way than the error number. */
    val problem: String?,
    /** False when the device name had to be left out to make the advertisement fit. */
    val nameIncluded: Boolean,
    val connectedDevices: Int,
    val subscribers: Int,
    val packetsSent: Long,
    val packetsPerSecond: Double,
    /** Packets left out because the previous one had not gone out yet. */
    val packetsSkipped: Long,
)

/** Android's advertising error numbers in words. */
fun advertisingErrorText(code: Int?): String = when (code) {
    1 -> "the advertisement is too large (error 1)"
    2 -> "too many advertisers are already running (error 2)"
    3 -> "advertising was already started (error 3)"
    4 -> "internal Bluetooth error (error 4)"
    5 -> "this Bluetooth chip cannot advertise (error 5, feature unsupported)"
    null -> "no error number was given"
    else -> "error $code"
}

fun bleVerdict(findings: BleFindings): ProbeResult {
    if (!findings.hasAdapter) {
        return ProbeResult(Verdict.FAIL, "This device has no Bluetooth.")
    }
    val details = buildList {
        findings.multipleAdvertisement?.let {
            add("Android says advertising is ${if (it) "supported" else "NOT supported"} by the chip.")
        }
        findings.hasAdvertiser?.let {
            add("Advertiser object: ${if (it) "yes" else "no"}.")
        }
        findings.gattServerOpened?.let {
            add("Data service opened: ${if (it) "yes" else "no"}.")
        }
        if (findings.advertising == AdvertisingState.STARTED) {
            add(
                if (findings.nameIncluded) {
                    "Advertising with the device name."
                } else {
                    "Advertising without the device name (it did not fit)."
                },
            )
            add("Computers connected: ${findings.connectedDevices}; listening: ${findings.subscribers}.")
            if (findings.packetsSent > 0) {
                add(
                    String.format(
                        Locale.US,
                        "Packets sent: %d, now %.0f per second, %d left out.",
                        findings.packetsSent,
                        findings.packetsPerSecond,
                        findings.packetsSkipped,
                    ),
                )
            }
        }
    }

    if (!findings.enabled) {
        return ProbeResult(
            Verdict.WAITING,
            "Bluetooth is switched off. Switch it on in the controller's settings, then press the button again.",
            details,
        )
    }
    return when (findings.advertising) {
        AdvertisingState.NOT_STARTED -> ProbeResult(
            Verdict.NOT_RUN,
            "Press \"Start Bluetooth test\".",
            details,
        )
        AdvertisingState.STARTING -> ProbeResult(Verdict.WAITING, "Starting to advertise…", details)
        AdvertisingState.FAILED -> ProbeResult(
            Verdict.FAIL,
            when {
                findings.hasAdvertiser == false ->
                    "Android gave no advertiser: this device cannot act as a Bluetooth LE device."
                findings.problem != null -> "The Bluetooth test could not start. ${findings.problem}"
                else -> "Advertising did not start: ${advertisingErrorText(findings.advertisingError)}."
            },
            details,
        )
        AdvertisingState.STARTED -> ProbeResult(
            Verdict.PASS,
            if (findings.subscribers > 0) {
                String.format(
                    Locale.US,
                    "Advertising works, and a computer is receiving %.0f packets per second.",
                    findings.packetsPerSecond,
                )
            } else {
                "Advertising works: this device can act as a Bluetooth LE device. Now connect from the PC."
            },
            details,
        )
    }
}

// ---- Probe 3: does the DJI SDK deliver the sticks with the aircraft off? -------------------

enum class DjiState {
    NOT_STARTED,
    NEEDS_PERMISSIONS,
    REGISTERING,
    REGISTER_FAILED,
    WAITING_FOR_CONTROLLER,
    CONTROLLER_FOUND,
}

data class DjiFindings(
    /** False in the small build, which does not contain the DJI SDK. */
    val included: Boolean,
    val keyPresent: Boolean,
    val state: DjiState,
    /** Seconds spent in the current state. */
    val secondsInState: Int,
    val error: String?,
    /** What the SDK calls the connected product, if any. */
    val productName: String?,
    val aircraftConnected: Boolean,
    val updates: Long,
    val updatesPerSecond: Double,
    val sticks: StickValues?,
    /** Largest travel seen on one stick axis, in SDK units (full travel is 1320). */
    val stickTravel: Int,
    val axesMoved: Int,
    /** Notes from the SDK, newest last. */
    val log: List<String>,
)

/** How long the SDK gets to report the remote controller, and then stick data. */
const val DJI_CONTROLLER_TIMEOUT_S = 60
const val DJI_DATA_TIMEOUT_S = 30

/** A stick axis counts as moved when it travelled at least this far (full travel is 1320). */
const val DJI_STICK_TRAVEL_NEEDED = 300

fun djiVerdict(findings: DjiFindings): ProbeResult {
    if (!findings.included) {
        return ProbeResult(
            Verdict.NOT_INCLUDED,
            "This is the small build without the DJI SDK. Install the DJI build to run this probe.",
        )
    }
    if (!findings.keyPresent) {
        return ProbeResult(
            Verdict.FAIL,
            "This app was built without a DJI app key. See docs/CONTROLLER_CHECK.md, part B.",
        )
    }
    val details = buildList {
        findings.productName?.let { add("The SDK reports the product as: $it.") }
        if (findings.updates > 0) {
            add(
                String.format(
                    Locale.US,
                    "Stick updates: %d, now %.0f per second.",
                    findings.updates,
                    findings.updatesPerSecond,
                ),
            )
        }
        findings.sticks?.let {
            add("Sticks now: left ${it.leftX} / ${it.leftY}, right ${it.rightX} / ${it.rightY} (range -660 to 660).")
        }
        if (findings.updates > 0) {
            add("Axes moved: ${findings.axesMoved} of 4; largest travel ${findings.stickTravel} of 1320.")
        }
        addAll(findings.log.takeLast(6).map { "SDK: $it" })
    }

    return when (findings.state) {
        DjiState.NOT_STARTED -> ProbeResult(
            Verdict.NOT_RUN,
            "Press \"Start DJI SDK test\". The first time, the controller needs internet (Wi-Fi).",
            details,
        )
        DjiState.NEEDS_PERMISSIONS -> ProbeResult(
            Verdict.WAITING,
            "Allow every permission Android asks for, then press the button again.",
            details,
        )
        DjiState.REGISTERING -> ProbeResult(
            Verdict.WAITING,
            "Registering the app with DJI… (${findings.secondsInState} s). This needs internet the first time.",
            details,
        )
        DjiState.REGISTER_FAILED -> ProbeResult(
            Verdict.FAIL,
            "The app could not register with DJI: ${findings.error ?: "no reason given"}.",
            details,
        )
        DjiState.WAITING_FOR_CONTROLLER ->
            if (findings.secondsInState >= DJI_CONTROLLER_TIMEOUT_S) {
                ProbeResult(
                    Verdict.FAIL,
                    "Registered, but the SDK reported no remote controller in $DJI_CONTROLLER_TIMEOUT_S seconds.",
                    details,
                )
            } else {
                ProbeResult(
                    Verdict.WAITING,
                    "Registered. Waiting for the SDK to report the remote controller… (${findings.secondsInState} s)",
                    details,
                )
            }
        DjiState.CONTROLLER_FOUND -> when {
            findings.aircraftConnected -> ProbeResult(
                Verdict.WAITING,
                "AN AIRCRAFT IS CONNECTED. Switch the aircraft off: this check only counts with the aircraft off.",
                details,
            )
            findings.updates == 0L ->
                if (findings.secondsInState >= DJI_DATA_TIMEOUT_S) {
                    ProbeResult(
                        Verdict.FAIL,
                        "The SDK found the remote controller but sent no stick data in $DJI_DATA_TIMEOUT_S seconds.",
                        details,
                    )
                } else {
                    ProbeResult(
                        Verdict.WAITING,
                        "Remote controller found. Waiting for stick data… (${findings.secondsInState} s)",
                        details,
                    )
                }
            findings.stickTravel < DJI_STICK_TRAVEL_NEEDED -> ProbeResult(
                Verdict.WAITING,
                "Stick data is arriving. Now move both sticks in full circles.",
                details,
            )
            else -> ProbeResult(
                Verdict.PASS,
                String.format(
                    Locale.US,
                    "The SDK delivers the sticks with the aircraft off: %.0f updates per second.",
                    findings.updatesPerSecond,
                ),
                details,
            )
        }
    }
}

// ---- The report -----------------------------------------------------------------------

data class DeviceFacts(
    val appVersion: String,
    val manufacturer: String,
    val model: String,
    val androidVersion: String,
    val apiLevel: Int,
    val abis: List<String>,
)

/**
 * The whole outcome as text, short enough to photograph or copy. The three numbered lines
 * answer the three open questions in docs/PLAN.md, section 3.
 */
fun buildReport(
    device: DeviceFacts,
    input: ProbeResult,
    ble: ProbeResult,
    dji: ProbeResult,
    /** Why the app closed by itself the last time, if it did. */
    lastCrash: String? = null,
): String {
    val lines = mutableListOf<String>()
    lines += "RC PROBE REPORT (app ${device.appVersion})"
    lines += "Device: ${device.manufacturer} ${device.model}, Android ${device.androidVersion} " +
        "(API ${device.apiLevel}), ${device.abis.joinToString("/")}"
    val probes = listOf(
        "1 STICKS AS INPUT DEVICE" to input,
        "2 BLUETOOTH LE ADVERTISING" to ble,
        "3 DJI SDK, AIRCRAFT OFF" to dji,
    )
    for ((title, result) in probes) {
        lines += ""
        lines += "$title: ${result.verdict.label}"
        lines += "  ${result.summary}"
        for (detail in result.details) {
            lines += "  - $detail"
        }
    }
    if (lastCrash != null) {
        lines += ""
        lines += "THE APP CLOSED BY ITSELF EARLIER:"
        lines += "  $lastCrash"
    }
    return lines.joinToString("\n")
}
