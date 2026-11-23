# Air 2S Drone Simulator — Project Plan

This file is the single source of truth for the project: what we build, the decisions
already made, and the numbered steps. Each step is small enough for one work session.
The prompts that run the steps are in [PROMPTS.md](PROMPTS.md).

---

## 1. What we are building

A 3D flight simulator of a DJI Air 2S-class camera drone. It runs in the Chrome browser
on a PC or laptop. You fly the drone on the screen with a real **DJI Smart Controller**
linked over **Bluetooth**. Keyboard and ordinary gamepads also work, so the simulator can
be built and tested without the controller.

Must-haves:

- A drone that behaves like an Air 2S: Cine / Normal / Sport modes, published speeds,
  3-axis gimbal, battery, Return-to-Home, obstacle sensing.
- Control from the DJI Smart Controller over Bluetooth.
- Four switchable 3D environments: **mountains, city, ocean, beach**.
- Lighting with a full **day / night** cycle, plus weather.
- Built in small steps, each one working and tested before the next starts.

Not in version 1: multiplayer, VR, real-world map data, a phone build, a copy of the
DJI Fly screen design.

---

## 2. Decisions already made

Change these first if any of them is wrong — everything else depends on them.

| # | Decision | Choice | Why | Alternative |
|---|----------|--------|-----|-------------|
| 1 | Platform | Web app: TypeScript + Three.js + Vite, in Chrome | No install. Web Bluetooth is built in. An AI coding session can build *and* test it (headless Chromium). Runs on Windows, macOS, Linux, ChromeOS. | Unity or Godot: higher graphics ceiling, but cannot be built or tested in a cloud session and needs a Bluetooth plugin. |
| 2 | Where the simulator runs | PC / laptop (or a TV connected to it) | "Drone on the screen", strong GPU. | On the controller's own screen: weak GPU, old Android. |
| 3 | Controller link | A small Android "RC Bridge" app on the Smart Controller sends stick data over Bluetooth LE to the browser | The controller is not a Bluetooth gamepad by itself (section 3). | See the fallback ladder in section 3. |
| 4 | World content | Procedural (generated from a seed) | No licence problems, small download, easy to vary. | Bought or hand-made 3D assets. |
| 5 | Flight physics | Our own flight model, no physics engine | A camera drone is driven by its flight controller; a small custom model is simple, deterministic and testable. | Rapier / cannon-es rigid bodies. |
| 6 | Repository layout | `sim/` (web app), `rc-bridge/` (Android app), `docs/` | Two apps, one shared protocol document. | — |

---

## 3. Controller reality check (the biggest risk)

### What is known (checked November 2026)

- The Smart Controller (model RM500) is an Android 7.1 device with Wi-Fi, Bluetooth 4.2,
  a 5.5" 1080p screen and HDMI output. DJI's FAQ says third-party apps can be installed
  (there are no Google Play services).
- I found **no** DJI document or reliable report that it can act as a standard Bluetooth
  gamepad. DJI support has said its own DJI Flight Simulator is the only simulator tested
  with this controller.
- DJI Mobile SDK v4 for Android added Air 2S support in v4.16 (December 2021). Its
  remote-controller "hardware state" callback reports both sticks (range −660…660), the
  dials and the buttons. An app running on the controller can read them.
- Web Bluetooth works in Chrome and Edge on Windows, macOS, ChromeOS and Android. It does
  **not** work in Firefox or Safari (so no iPhone / iPad). It needs HTTPS or `localhost`.

### The design that follows

```
 DJI Smart Controller (Android 7.1)                  PC / laptop (Chrome)
┌──────────────────────────────────┐              ┌───────────────────────────────┐
│ RC Bridge app                    │  Bluetooth   │ Simulator web app             │
│  DJI Mobile SDK v4 ─► sticks,    │  LE (GATT    │  Web Bluetooth ─► input layer │
│  dials, buttons ─► 20-byte packet│ ───────────► │  ─► flight model ─► 3D scene  │
│  50 times per second             │  notify)     │                               │
└──────────────────────────────────┘              └───────────────────────────────┘
```

### What is not known yet — answered by Step 04

1. Does the SDK deliver stick values while the drone is powered **off**? (Expected yes:
   the SDK has an "only remote controller connected" state. Not confirmed on this hardware.)
2. Does the RM500's Bluetooth chip support BLE *peripheral* mode (advertising)? Android 7.1
   has the API, but support depends on the hardware.
3. Are the sticks perhaps visible to Android as a normal input device? Unlikely, but if
   yes the bridge app needs no DJI SDK at all.

### Fallback ladder (first one that works wins)

| Order | Link | Controller side | Simulator side | Note |
|-------|------|-----------------|----------------|------|
| 1 | Bluetooth LE | GATT server in the bridge app | Web Bluetooth | Preferred. |
| 2 | Bluetooth Classic (serial) | RFCOMM server in the bridge app | Web Serial over Bluetooth (Chrome desktop) | Still Bluetooth. Browser support to confirm in Step 04. |
| 3 | Wi-Fi | WebSocket server in the bridge app | `WebSocket` to the controller's IP | Lowest risk, not Bluetooth. |
| 4 | USB cable | none | Web Serial + DJI's serial protocol | Community tools do this for the RC-N1; unconfirmed for the RM500. |

If the sticks cannot be read at all, the simulator still works with any standard gamepad.

### Safety rule

The Smart Controller always commands a linked, powered-on drone, whatever app is on its
screen. **Simulator sessions are flown with the real drone switched off.** The bridge app
shows a full-screen warning whenever it detects an aircraft.

### If your controller is a different model

DJI RC Pro and DJI RC (the newer screen controllers) run newer Android versions and may
allow a simpler link. Say which model you have when running Step 04.

---

## 4. Architecture

### Simulator modules (`sim/src/`)

| Module | Job |
|--------|-----|
| `core/` | Game loop (fixed 120 Hz simulation step, interpolated rendering), event bus, settings, URL parameters, test hook. |
| `input/` | Control sources (keyboard, gamepad, Bluetooth bridge, mock), stick-mode mapping, deadzone, expo. Produces one `ControlFrame` per step. |
| `drone/` | Flight model, flight controller (modes, take-off / landing states, RTH), battery, obstacle sensing, gimbal. All Air 2S numbers live in one config file. |
| `world/` | `Environment` interface, world manager (switching, loading, cleanup), terrain engine, water, the four environments, collision queries. |
| `sky/` | Time of day, sun and moon, sky dome, stars, lights, shadows, fog, weather, wind. |
| `camera/` | Gimbal (FPV) camera, chase camera, free spectator camera. |
| `ui/` | HUD, menus, settings, connection screens. Original design; no DJI logos or artwork. |
| `audio/` | Motor, wind, warnings, ambient sound. |

### The contracts between modules

These two interfaces let the steps stay independent. Steps may extend them but should not
break them.

```ts
// input/ — what the flight controller receives every simulation step
interface ControlFrame {
  t: number;                                   // ms timestamp of the sample
  roll: number; pitch: number;                 // -1..1 after mapping, deadzone, expo
  yaw: number; throttle: number;               // -1..1
  gimbal: number;                              // -1..1 gimbal dial deflection
  mode: 'C' | 'N' | 'S';                       // Cine / Normal / Sport
  buttons: Record<ButtonId, boolean>;          // rth, pause, record, shutter, c1, c2, ...
  connected: boolean;                          // false => failsafe behaviour
}
interface ControlSource {
  readonly id: string;                         // 'keyboard' | 'gamepad' | 'ble-bridge' | 'mock'
  readonly connected: boolean;
  poll(now: number): RawControls | null;       // raw sticks before mapping
}

// world/ — what every environment must provide
interface Environment {
  readonly id: 'test' | 'mountains' | 'city' | 'ocean' | 'beach';
  load(ctx: WorldContext): Promise<void>;
  update(dt: number, frame: FrameState): void;
  dispose(): void;                             // free every geometry, texture, light
  heightAt(x: number, z: number): number;      // ground, roof or water surface
  raycast(origin: Vec3, dir: Vec3, maxDist: number): Hit | null;
  readonly spawn: { position: Vec3; headingDeg: number };
  readonly lighting: LightingProfile;          // per-environment sky / fog tweaks
}
```

### Conventions

- Units: metres, seconds, radians inside the code; degrees only in the UI and config.
- Axes: Three.js default, Y up. Heading 0° = north = −Z.
- The simulation is deterministic: same seed and same inputs give the same flight.
- URL parameters make any view reproducible, e.g. `?env=city&time=21.5&seed=7&quality=low`.

### Testing

- **Unit tests (Vitest):** flight model, input mapping, protocol codec, terrain maths.
- **Smoke tests (Playwright, headless Chromium):** the app loads, no console errors,
  screenshots of the changed feature.
- **Hardware tests:** short checklists that you run with the real controller (Steps 04, 22–25).

### Performance targets

60 frames per second at 1080p on a mid-range laptop with the Medium quality preset.
First load under 10 MB. Each environment loads in under 5 seconds.

---

## 5. Air 2S reference numbers

All of these go into one config file (Step 05) with a comment naming the source.

| Value | Cine (C) | Normal (N) | Sport (S) | Status |
|-------|----------|------------|-----------|--------|
| Max horizontal speed | 5 m/s | 15 m/s | 19 m/s | Checked |
| Max ascent speed | tune by feel | 6 m/s | 6 m/s | Checked (N, S) |
| Max descent speed | tune by feel | 6 m/s | 6 m/s | Checked (N, S) |
| Max yaw rate | ~60°/s | 90°/s | 250°/s | N, S checked; C from memory |
| Max tilt angle | — | — | 35° | S checked |

| Value | Number | Status |
|-------|--------|--------|
| Max flight time (no wind) | 31 min | Checked |
| Max hover time | 30 min | Checked |
| Max wind resistance | 10.7 m/s | Checked |
| Take-off weight | 595 g | From memory |
| Camera field of view | 88° (22 mm equivalent) | From memory |
| Gimbal tilt range | −90° to 0°, extended to +24° | From memory |
| Obstacle sensing | forward, backward, upward, downward | From memory |
| Battery | 3500 mAh, 11.55 V | From memory |

"From memory" values must be checked against DJI's official specification page in Step 05
before they are hard-coded.

---

## 6. Roadmap

35 steps in 7 milestones. Steps 01–20 need no DJI hardware. Tick a step when it is done
and add a line to the decision log (section 9) if something changed.

### Milestone 0 — Foundation

- [ ] **01 — Project scaffold**
  - Build: `sim/` with Vite, TypeScript (strict), Three.js; ESLint, Prettier, Vitest;
    one Playwright smoke test; GitHub Actions for lint, type-check, tests and build;
    a GitHub Pages deploy workflow so every merged step has a link to try.
  - Done when: the dev server shows a lit scene with a ground grid; CI is green;
    `CLAUDE.md` lists the real commands.
- [ ] **02 — Game loop and debug tools**
  - Build: fixed 120 Hz simulation step with interpolated rendering; pause and time
    scale; debug overlay (FPS, frame time, draw calls); `window.__sim` test hook; URL
    parameters.
  - Done when: a unit test proves the same inputs give the same state at any render rate.

### Milestone 1 — First flight (keyboard and gamepad)

- [ ] **03 — Input layer**
  - Build: `ControlFrame`, `ControlSource`, input manager; keyboard source; standard
    Gamepad API source; stick modes 1 / 2 / 3; deadzone and expo; on-screen stick monitor.
  - Done when: mapping, deadzone and expo are unit-tested; the monitor follows keyboard
    and gamepad.
- [ ] **04 — Controller reality check (needs your hardware)**
  - Part A, no code, 10 minutes: pair the controller with the PC over Bluetooth and
    look for a game controller; open a gamepad-tester page in the controller's own
    browser; connect by USB and look in Device Manager.
  - Part B: a tiny "RC Probe" Android app with three probes — Android input devices,
    BLE advertising support, DJI SDK stick callback with the drone off — each showing
    PASS or FAIL, with a "copy report" button.
  - Done when: the three unknowns in section 3 are answered and the chosen link is
    written in the decision log. Can be postponed, but must be done before Step 21.
- [ ] **05 — Flight model v1**
  - Build: drone state (position, velocity, attitude, rates); flight controller that
    turns sticks into target velocity, climb rate and yaw rate; tilt response, drag,
    braking on stick release, hover hold; Air 2S config file with verified numbers;
    flat-ground collision.
  - Done when: unit tests pass for Normal mode — top speed 15 m/s, climb 6 m/s,
    descent 6 m/s, yaw 90°/s, zero drift in hover without wind.
- [ ] **06 — Flight states and modes**
  - Build: state machine motors off → take-off → flying → landing → landed, started
    by the stick command (both sticks down and inward) or a button; auto take-off to
    1.2 m; auto landing; Cine / Normal / Sport parameter sets; emergency motor stop.
  - Done when: every transition is unit-tested; each mode reaches its own top speed.
- [ ] **07 — Drone model and cameras**
  - Build: an original low-poly folding quadcopter (no DJI artwork), spinning
    propellers, visible tilt; chase camera, gimbal (FPV) camera, free spectator camera;
    a key to switch.
  - Done when: screenshot tests exist for all three cameras.
- [ ] **08 — Gimbal**
  - Build: 3-axis stabilisation (horizon stays level when the drone tilts); tilt −90° to
    0°, optional +24°; dial and key control with rate limit and smoothing; correct field
    of view; recentre and look-down shortcuts.
  - Done when: tests show camera roll stays 0° at 30° drone roll and tilt is clamped.
- [ ] **09 — HUD v1**
  - Build: height, distance from home, horizontal and vertical speed, mode, battery
    placeholder, flight time, compass, attitude and home-direction indicator, gimbal
    angle, message toasts.
  - Done when: a Playwright test sees HUD values change with the simulation state.

### Milestone 2 — World system

- [ ] **10 — Environment framework**
  - Build: `Environment` interface; world manager with loading screen and full cleanup;
    environment picker menu; a flat "Test Field" with a landing pad and a few obstacles;
    collision and crash handling (crash → reset at home).
  - Done when: switching environments ten times leaves GPU memory counts stable.
- [ ] **11 — Terrain engine**
  - Build: seeded procedural height field; chunks with distance-based level of detail
    and no cracks; generation in a Web Worker; material blended by height and slope;
    `heightAt`; drone-to-terrain collision.
  - Done when: `heightAt` is continuous across chunk borders (unit test); flying at
    19 m/s causes no visible stutter.
- [ ] **12 — Mountains**
  - Build: high peaks and valleys, snow line, rock on steep slopes, alpine lake,
    instanced conifers below the tree line, a meadow helipad as spawn.
  - Done when: screenshots from three fixed viewpoints look right and the frame budget holds.
- [ ] **13 — Water system**
  - Build: reusable water module with wave motion, sky reflection, sun glitter,
    depth-based colour and foam; `waterHeightAt` on the CPU matching the shader;
    touching water ends the flight with a clear message.
  - Done when: CPU and shader wave heights match at sample points (unit test).
- [ ] **14 — Ocean**
  - Build: open sea with islands, a lighthouse, an anchored ship and buoys as targets,
    long swell, horizon haze.
  - Done when: screenshots and frame budget pass.
- [ ] **15 — Beach**
  - Build: shoreline from sea to wet sand, dry sand, dunes and vegetation; shore foam
    and wave run-up; palms, umbrellas, a pier, a lifeguard tower; turquoise shallows.
  - Done when: screenshots and frame budget pass.
- [ ] **16 — City**
  - Build: seeded road grid, blocks and lots; building generator (downtown towers to
    low suburbs) with instancing; procedural window texture; park, river, bridge,
    landmark tower; box collisions through a spatial grid; landing on roofs works.
  - Done when: collision unit tests pass; draw calls stay inside the budget.

### Milestone 3 — Light, sky, day / night, weather

- [ ] **17 — Time of day and sky**
  - Build: time-of-day model (hour, date, latitude) giving sun and moon direction;
    sky dome; sun light with cascaded shadows; ambient light and fog colour taken from
    the sky; tone mapping and exposure; time slider, presets (sunrise, noon, golden
    hour, sunset, blue hour, night) and time speed.
  - Done when: screenshots for six presets look right; unit tests confirm the sun
    rises in the east and is highest at noon.
- [ ] **18 — Night**
  - Build: stars, moon and moonlight; lit city windows that change with the hour;
    street lights; rotating lighthouse beam; drone navigation lights and bottom
    landing light; automatic exposure.
  - Done when: a night screenshot exists for every environment; the city holds its
    frame budget at night.
- [ ] **19 — Weather and wind**
  - Build: wind model (steady part plus gusts, stronger with height) that pushes the
    drone; the flight controller fights it up to its tilt limit; "high wind" warning;
    haze, fog and a cloud layer; presets clear, hazy, overcast, windy, fog.
  - Done when: tests show the drone holds position in 5 m/s wind and drifts when the
    wind is above its limit.
- [ ] **20 — Post-processing and quality presets**
  - Build: bloom, light colour grade, anti-aliasing; Low / Medium / High / Ultra
    presets (shadows, detail distance, water quality, resolution); dynamic resolution
    aiming at 60 FPS; settings saved in the browser.
  - Done when: triangle and draw-call budgets per preset are checked automatically.

### Milestone 4 — DJI Smart Controller over Bluetooth

- [ ] **21 — Protocol and simulated controller**
  - Build: `docs/PROTOCOL.md` (service and characteristic IDs, 20-byte packet layout,
    rates, versioning, failsafe rules); TypeScript codec with golden test vectors
    shared with the Android tests; a mock source that replays packets.
  - Done when: the simulator can be flown end-to-end from recorded packets, no hardware.
- [ ] **22 — RC Bridge app: read the sticks**
  - Build: `rc-bridge/` Kotlin app for Android 7.1; DJI Mobile SDK v4 registration
    (app key from a local file or CI secret, never committed); live stick and button
    display; aircraft-detected safety warning; CI builds an installable APK;
    `docs/BRIDGE_SETUP.md`.
  - Done when (hardware test): sticks move on the controller's screen with the drone off.
- [ ] **23 — RC Bridge app: Bluetooth transmit**
  - Build: the link chosen in Step 04 (BLE GATT server by default); 50 packets per
    second plus keep-alive; foreground service, screen kept on, reconnect.
  - Done when (hardware test): a BLE scanner or the simulator receives at least 40
    packets per second.
- [ ] **24 — Simulator: Bluetooth controller source**
  - Build: Web Bluetooth source; "Connect controller" screen with status, packet rate
    and controller battery; auto-reconnect; failsafe (no data for 0.3 s → centre sticks
    and hover; 3 s → signal-lost behaviour); clear notice in unsupported browsers.
  - Done when: tests pass against a mocked Bluetooth API; you can fly with the real controller.
- [ ] **25 — Full controller mapping**
  - Build: flight-mode switch, RTH, pause, record, shutter, gimbal dial, second dial,
    custom buttons, 5D button for menus; calibration wizard; mapping editor.
  - Done when (hardware test): every control on the checklist does what it says.

### Milestone 5 — Air 2S behaviour

- [ ] **26 — Battery and Return-to-Home** — power model (31 min maximum, more drain
  when climbing, fast or in wind), optional faster drain; low and critical warnings;
  home point; smart RTH (climb, return, descend), cancel, landing on the pad.
- [ ] **27 — Obstacle sensing** — four sensing directions using `raycast`; brake,
  bypass or off; disabled in Sport mode as on the real aircraft; HUD distance bars and beeps.
- [ ] **28 — Camera features** — photo capture, video recording to a file, exposure
  compensation, digital zoom, grid lines, clean view without HUD.
- [ ] **29 — Flight limits and signal** — height and distance limits; signal strength
  from distance and line of sight; weak-signal warnings; failsafe RTH.
- [ ] **30 — Audio** — synthesised motor sound by thrust and distance, wind noise,
  warning tones and spoken-style prompts, ambient sound per environment.
- [ ] **31 — Intelligent modes (optional)** — QuickShots-style automatic moves (pull
  away, rocket, circle, helix), point-of-interest orbit, cruise control.

### Milestone 6 — Training and polish

- [ ] **32 — Training missions** — mission framework (goals, triggers, timer, score)
  and six missions, from "take off, hover, land" to "night landing in the city".
- [ ] **33 — Minimap, flight log, replay** — top-down map with home and heading;
  recorded flights replayed with the free camera; export.
- [ ] **34 — Settings, onboarding, offline app** — full settings screen, first-run
  tutorial, installable offline web app, loading screens.
- [ ] **35 — Performance pass and release 1.0** — profiling per environment, lazy
  loading per environment, user guide, version 1.0.

---

## 7. How a step is run

1. Start a **new session** for each step and paste the step prompt from `PROMPTS.md`.
2. The assistant restates the goal, builds only that step, tests it and shows screenshots.
3. It ticks the step here, notes anything it decided, commits and pushes.
4. You try the result. If it is good, merge and go to the next step. If not, use the
   fix or tuning prompt.
5. After the last step of a milestone, run the milestone review prompt.

### Your part

- Step 04, 22–25: run the hardware checklists with the real controller (drone off).
- Before Step 04 part B and Step 22: create a free DJI developer account and an app key.
- Step 01: allow GitHub Pages for the repository, if you want a link to each version.
- Any time: say how the flight feels compared with your real Air 2S.

---

## 8. Risks

| Risk | Effect | Answer |
|------|--------|--------|
| Sticks cannot be read on the controller without a drone | No DJI controller input | Step 04 finds out early; fallback ladder; gamepad always works. |
| RM500 cannot advertise over BLE | No Web Bluetooth link | Bluetooth Classic serial, then Wi-Fi. |
| DJI Mobile SDK v4 is old and in maintenance | Build problems with new Android tools | Pin tool versions; keep the bridge app tiny. |
| Browser 3D performance in the city at night | Low frame rate | Instancing, level of detail, quality presets, dynamic resolution (Steps 16, 18, 20). |
| Scope creep | The project never finishes | One step per session; optional steps are marked. |
| Trademarks | Problems if published | Original models and UI; "not affiliated with DJI" notice. |

---

## 9. Decision log

Add one line per decision: date — step — what was decided — why.

- 2026-11-23 — plan — Web app + Android bridge over BLE chosen as the starting design — see section 2 and 3.

---

## Sources

- [DJI Smart Controller product and support pages](https://www.dji.com/smart-controller) — Bluetooth 4.2, third-party apps, screen and HDMI.
- [DJI forum: Smart Controller Android version and apps](https://forum.dji.com/thread-181292-1-1.html)
- [DJI forum: RM500 in DJI Flight Simulator](https://forum.dji.com/thread-282997-1-1.html)
- [DJI Mobile SDK v4: remote controller hardware state](https://developer.dji.com/api-reference/android-api/Components/RemoteController/DJIRemoteController_DJIRCHardwareState.html)
- [DroneDJ: Mobile SDK 4.16 adds Air 2S](https://dronedj.com/2022/01/03/dji-sdk-mini-2-se-air-2s/)
- [MDN: Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API) and [caniuse: Web Bluetooth](https://caniuse.com/web-bluetooth)
- [DJI Air 2S specifications](https://www.dji.com/air-2s/info) and [support page](https://www.dji.com/support/product/air-2s)
- [Community example: DJI RC-N1 as a simulator joystick over USB](https://github.com/pverhaert/DJI_RCN1_for_drone_simulators)
