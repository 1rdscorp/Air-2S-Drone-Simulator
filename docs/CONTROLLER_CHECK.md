# Controller check (Step 04)

A hardware test for you to run with the real DJI Smart Controller. It answers the three
open questions of the plan (`docs/PLAN.md`, section 3) and decides how the controller
will talk to the simulator.

> **Safety: switch the aircraft OFF before you start, and leave it off until you have
> finished.** The Smart Controller commands a linked, switched-on aircraft whatever app
> is on its screen. Nothing in this check needs the aircraft.

The three questions:

1. Can an app on the controller read the sticks while the aircraft is off?
2. Can the controller act as a Bluetooth LE device that a PC connects to?
3. Are the sticks perhaps a normal game controller already, with no special app at all?

The check has three parts. Do them in order; you can stop after any part and send what
you have.

| Part | Needs | Time | Answers |
|------|-------|------|---------|
| A | Controller, PC, USB-C cable | 10 minutes | Question 3, from the PC's side |
| B | The small RC Probe app | 15 minutes | Questions 2 and 3 |
| C | A DJI developer account and the RC Probe DJI app | 30 to 45 minutes | Question 1 |

**Please read this first:** the RC Probe app was built and tested only on a simulated
Android. It has never run on a real Smart Controller. If it closes by itself, will not
install or shows something odd, that is a useful result too: write down what you saw.

## What you need

- The DJI Smart Controller, charged, and connected to your Wi-Fi.
- A PC or laptop with Bluetooth and Chrome or Edge.
- A USB-C cable.
- A phone, to photograph the controller's screen.

The check page is https://1rdscorp.github.io/Air-2S-Drone-Simulator/controller-check.html.
It appears there once this step has been merged.

## Part A — without any app

1. Switch the aircraft off.
2. On the PC, open the check page in Chrome or Edge.
3. **Bluetooth.** On the controller, open Settings, then Bluetooth, and switch it on. On
   the PC, open the Bluetooth settings, add a device and choose the controller.
   - Whether or not the pairing works, look at section 2 of the check page. Move both
     sticks in circles and press a few buttons on the controller.
   - On Windows, also press the Windows key and R together, type `joy.cpl` and press
     Enter. Is a game controller listed?
4. **USB.** Connect the USB-C port on the bottom of the controller to the PC. If the
   controller asks what the connection is for, first choose charging only, later repeat
   with file transfer.
   - Look at section 2 of the check page again while moving the sticks.
   - On Windows, right-click the Start button and open Device Manager. Which new entries
     appeared when you plugged the cable in? Look under "Ports (COM & LPT)", "Human
     Interface Devices" and "Portable Devices", and write their names down.
5. **The controller's own browser.** On the controller, open the built-in browser and go
   to the check page. Move the sticks and press the buttons. Photograph the screen.
6. On the PC, press "Copy report" at the bottom of the check page and keep the text.

## Part B — the small RC Probe app

This build contains no DJI software and needs no account.

1. On the controller, in the browser, on the check page, tap "Download RC Probe (APK)".
2. Open the downloaded file: from the download notification, or in Apps → File Manager →
   Installation packages. Android warns that the app comes from an unknown source; allow
   it and install.
   - If the download does not work on the controller: download `rc-probe.apk` on the PC
     from the same button, copy it to a microSD card, put the card into the controller and
     open the file there in the File Manager.
3. Open **RC Probe**. The line under the title shows the controller's model and Android
   version.
4. **Probe 1.** Tap "Test the sticks", then move both sticks in circles for ten seconds.
   The verdict becomes PASS or FAIL.
5. **Probe 2.** Tap "Start Bluetooth test". If Android asks to switch Bluetooth on, allow
   it and tap the button again. The verdict becomes PASS or FAIL.
6. If probe 2 says PASS: on the PC, on the check page, section 4, press "Connect to RC
   Probe". Chrome shows a list; choose the controller and press Pair. It may be listed
   under the controller's Bluetooth name or as an unnamed device.
   - Wait ten seconds. The page then shows PASS with the number of packets per second, or
     TOO SLOW.
   - If the list stays empty for 20 seconds, close it. That is a result too.
7. Photograph the controller's screen with the report at the bottom, and on the PC press
   "Copy report" again.

## Part C — RC Probe with the DJI software

Only this part can answer question 1. It needs a DJI app key, which only a DJI developer
account can create.

1. Create a developer account at https://developer.dji.com. DJI's own instructions say
   the sign-up asks for an e-mail address, a phone number and card details. If you do not
   want to give those, stop here and say so; question 1 then stays open until Step 22.
2. In DJI's developer centre, open Apps and create an app:
   - App type: Mobile SDK
   - Software platform: Android
   - Package name: `com.air2ssim.rcprobe` (exactly this)
   - Name, category and description: anything, for example "RC Probe"
   - DJI sends an e-mail; confirm it. Then copy the App Key, a line of letters and digits.
3. Give the key to the build, without putting it into the project's files:
   - On GitHub, open the repository, then Settings → Secrets and variables → Actions →
     New repository secret.
   - Name: `DJI_APP_KEY`. Secret: the key. Save.
   - Never paste the key into a file, an issue or a chat.
4. Build the app: on GitHub, open Actions → "RC Probe app" → Run workflow. After about
   five minutes, open the finished run and download `rc-probe-dji` under Artifacts. Unzip
   it; inside is `rc-probe-dji.apk`, about 77 MB.
   - This file contains your key. Do not pass it on.
5. Copy `rc-probe-dji.apk` to a microSD card (or over USB with file transfer), and install
   it on the controller from the File Manager, as in part B.
6. Make sure the controller is on Wi-Fi: the first start has to reach DJI's server once.
7. Close DJI's own flight app completely: Settings → Apps → DJI Fly (or DJI GO 4) → Force
   stop. Otherwise it keeps the connection to the controller's sticks for itself.
8. Check again that the aircraft is off. Open **RC Probe DJI**.
   - If Android asks which app should open for a USB accessory, choose RC Probe DJI and
     "Just once".
9. Tap "Start DJI SDK test". Android asks for location, storage and phone permissions;
   DJI's software will not register without them. Allow them, then tap the button again.
10. Watch the verdict of probe 3. It goes through "Registering", "Waiting for the remote
    controller" and "Stick data is arriving". Then move both sticks in full circles. It
    ends in PASS or FAIL within about two minutes.
    - If the screen ever shows "AN AIRCRAFT IS CONNECTED", switch the aircraft off.
11. If probe 2 passed in part B: start the Bluetooth test here as well and connect from
    the PC as before. The check page now shows the real stick values, and they should
    follow the sticks.
12. Photograph the controller's screen with the report, and on the PC press "Copy report".

## What to send back

- The report text from the PC (parts A, B and C).
- The photos of the controller's screen.
- From part A: what Windows showed in `joy.cpl` and in Device Manager.
- Anything that did not go as described.

## What the answers decide

| Result | What follows |
|--------|--------------|
| Part A: the PC sees the sticks as a game controller | No app on the controller is needed. The simulator's gamepad input already works. |
| Probe 1 PASS | The bridge app needs no DJI software and no DJI account. |
| Probe 3 PASS and probe 2 PASS with at least 40 packets per second | The plan as designed: bridge app with the DJI SDK, Bluetooth LE to the browser. |
| Probe 3 PASS, probe 2 FAIL or too slow | Next link on the list: Bluetooth serial, then Wi-Fi. |
| Probe 3 FAIL and probe 1 FAIL | An app on the controller cannot read the sticks. Left are the USB cable route and a standard gamepad. |

## If something goes wrong

- **"App not installed".** An RC Probe from an earlier download is in the way, because
  each build is signed differently. Uninstall it in Settings → Apps, then install again.
- **An RC Probe closes by itself.** Open it again: it remembers why it closed and shows
  that at the bottom of the report, under "THE APP CLOSED BY ITSELF EARLIER". Photograph
  it. If RC Probe DJI closes every time, say so; the small RC Probe is not affected.
- **"The app could not register with DJI".** The text after it is the reason. Common
  ones: no internet at the first start, or the package name of the key is not exactly
  `com.air2ssim.rcprobe`.
- **Probe 3 stays at "Waiting for the remote controller".** Check that DJI Fly was force
  stopped, restart the controller, and try once more. If it fails again after a minute,
  that is the answer.

## For developers

- The app is in `rc-probe/`. The rules that turn findings into verdicts are plain Kotlin
  in `Findings.kt` and are unit-tested; the screen is started on a simulated Android 7.1
  in `MainActivityTest.kt`.
- Two builds: `plain` (app name RC Probe, no DJI SDK) and `dji` (RC Probe DJI, DJI Mobile
  SDK 4.18). Commands are in `CLAUDE.md`.
- For a local DJI build, put the key into `rc-probe/dji.properties` as
  `DJI_APP_KEY=...`. That file is ignored by git.
- The Bluetooth test sends a 20-byte packet 50 times per second; its layout is in
  `TestPacket.kt`. It only measures the link. The simulator's real protocol is Step 21.
