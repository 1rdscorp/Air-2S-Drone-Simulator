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

Added while preparing Step 04 (web search and DJI's published sample code; nothing here
was tried on the hardware):

- The SDK has a real "only the remote controller is connected" state: DJI's sample app
  shows it when the aircraft is off. Whether stick values arrive in that state is not
  documented anywhere I could find; the probe has to show it.
- SDK 4.18 (October 2024) is the last v4 release. Registering an app needs internet once,
  and DJI's flight app must be force-stopped first, or it keeps the controller for itself.
- Apps are installed on the controller from its own browser or from a microSD card.
  Reports disagree on whether its Android is 32 or 64 bit, so the app is built for both.
- Community tools read the sticks of the newer DJI RC over Wi-Fi from an undocumented
  service, at about 9 values per second, and report that newer firmware closes it. Too
  slow and too fragile to build on; noted only for completeness.
- DJI Flight Simulator uses the Smart Controller over the USB-C cable. One user reports
  that it then appears to the PC as a serial (COM) port; nobody reports a game controller.

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
| 2 | Bluetooth Classic (serial) | RFCOMM server in the bridge app | Web Serial over Bluetooth (Chrome desktop) | Still Bluetooth. Chrome and Edge 117 or newer on a PC; the controller has to be paired with the PC first. |
| 3 | Wi-Fi | WebSocket server in the bridge app | `WebSocket` to the controller's IP | Lowest risk, not Bluetooth. A page loaded over https may not open a plain connection to a device on the home network, so with this link the simulator has to be opened from `localhost` instead of the published site. |
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
  readonly label: string;                      // name shown to the pilot
  readonly connected: boolean;
  readonly deadzone: number;                   // stick travel around the centre that counts as zero
  poll(now: number): RawControls | null;       // the physical sticks, before mapping
}

// world/ — what every environment must provide
interface Environment {
  readonly id: 'test' | 'mountains' | 'city' | 'ocean' | 'beach';
  readonly name: string;                       // name shown to the pilot
  load(ctx: WorldContext): Promise<void>;      // build the scenery under ctx.root
  update(frame: FrameState): void;             // every drawn frame: simulated time, camera, aircraft
  dispose(): void;                             // free every geometry, material, texture
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

All of these live in `sim/src/drone/air2s.config.ts`, each with its source. They were
checked in Step 05 through web search of DJI's support page, product page and user manual;
the pages themselves could not be opened from the build session.

| Value | Cine (C) | Normal (N) | Sport (S) |
|-------|----------|------------|-----------|
| Max horizontal speed | 5 m/s | 15 m/s | 19 m/s |
| Max ascent speed | not published | 6 m/s | 6 m/s |
| Max descent speed | not published | 6 m/s | 6 m/s |
| Max yaw rate | 60°/s | 90°/s | 250°/s |
| Max tilt angle | not published | 25° (35° in strong wind) | 35° |

| Value | Number |
|-------|--------|
| Max flight time (no wind) | 31 min |
| Max hover time | 30 min |
| Max wind resistance | 10.7 m/s |
| Take-off weight | 595 g |
| Size unfolded | 183 × 253 × 77 mm |
| Camera field of view | 88° (22 mm equivalent, f/2.8) |
| Gimbal tilt range | −90° to 0°, extended to +24°; up to 100°/s |
| Obstacle sensing | forward 0.38–23.8 m, backward 0.37–23.4 m, upward 0.34–28.6 m, downward 0.1–8 m; none to the sides |
| Battery | 3500 mAh, 11.55 V, 40.42 Wh |

Not published, so tuned by feel and by tests: how quickly the aircraft tilts, accelerates,
brakes and turns in each mode, and the air drag. The drag value was chosen so that the
published tilt limits and top speeds agree with each other.

Chosen in Step 06, because DJI publishes nothing for them: Cine mode climbs and descends at
2 m/s and tilts at most 12°. Take-off height (1.2 m), landing speeds and the hold times for
starting and stopping the motors are also chosen values; see `FLIGHT_PROCEDURE` in the
config file.

---

## 6. Roadmap

36 steps in 7 milestones (35 planned at the start, and 09a added later). Steps 01–20 need no DJI hardware. Tick a step when it is done
and add a line to the decision log (section 9) if something changed.

### Milestone 0 — Foundation

- [x] **01 — Project scaffold**
  - Build: `sim/` with Vite, TypeScript (strict), Three.js; ESLint, Prettier, Vitest;
    one Playwright smoke test; GitHub Actions for lint, type-check, tests and build;
    a GitHub Pages deploy workflow so every merged step has a link to try.
  - Done when: the dev server shows a lit scene with a ground grid; CI is green;
    `CLAUDE.md` lists the real commands.
- [x] **02 — Game loop and debug tools**
  - Build: fixed 120 Hz simulation step with interpolated rendering; pause and time
    scale; debug overlay (FPS, frame time, draw calls); `window.__sim` test hook; URL
    parameters.
  - Done when: a unit test proves the same inputs give the same state at any render rate.

### Milestone 1 — First flight (keyboard and gamepad)

- [x] **03 — Input layer**
  - Build: `ControlFrame`, `ControlSource`, input manager; keyboard source; standard
    Gamepad API source; stick modes 1 / 2 / 3; deadzone and expo; on-screen stick monitor.
  - Done when: mapping, deadzone and expo are unit-tested; the monitor follows keyboard
    and gamepad.
- [ ] **04 — Controller reality check (needs your hardware)** — the tools were built on
  2026-11-23; **the check itself is waiting for you to run it** with the real controller,
  following `docs/CONTROLLER_CHECK.md`. It must be done before Step 21.
  - Part A, no code, 10 minutes: pair the controller with the PC over Bluetooth and
    look for a game controller; open a gamepad-tester page in the controller's own
    browser; connect by USB and look in Device Manager.
  - Part B: a tiny "RC Probe" Android app with three probes — Android input devices,
    BLE advertising support, DJI SDK stick callback with the drone off — each showing
    PASS or FAIL, with a "copy report" button.
  - Built: the check page `controller-check.html` next to the simulator (game
    controllers, keys, and a Bluetooth link test that counts packets per second); the
    RC Probe app in `rc-probe/`, as a small build without DJI software and a build with
    the DJI Mobile SDK 4.18; the checklist `docs/CONTROLLER_CHECK.md`.
  - Done when: the three unknowns in section 3 are answered and the chosen link is
    written in the decision log.
- [x] **05 — Flight model v1**
  - Build: drone state (position, velocity, attitude, rates); flight controller that
    turns sticks into target velocity, climb rate and yaw rate; tilt response, drag,
    braking on stick release, hover hold; Air 2S config file with verified numbers;
    flat-ground collision.
  - Done when: unit tests pass for Normal mode — top speed 15 m/s, climb 6 m/s,
    descent 6 m/s, yaw 90°/s, zero drift in hover without wind.
- [x] **06 — Flight states and modes**
  - Build: state machine motors off → take-off → flying → landing → landed, started
    by the stick command (both sticks down and inward) or a button; auto take-off to
    1.2 m; auto landing; Cine / Normal / Sport parameter sets; emergency motor stop.
  - Done when: every transition is unit-tested; each mode reaches its own top speed.
- [x] **07 — Drone model and cameras**
  - Build: an original low-poly folding quadcopter (no DJI artwork), spinning
    propellers, visible tilt; chase camera, gimbal (FPV) camera, free spectator camera;
    a key to switch.
  - Done when: screenshot tests exist for all three cameras.
- [x] **08 — Gimbal**
  - Build: 3-axis stabilisation (horizon stays level when the drone tilts); tilt −90° to
    0°, optional +24°; dial and key control with rate limit and smoothing; correct field
    of view; recentre and look-down shortcuts.
  - Done when: tests show camera roll stays 0° at 30° drone roll and tilt is clamped.
- [x] **09 — HUD v1**
  - Build: height, distance from home, horizontal and vertical speed, mode, battery
    placeholder, flight time, compass, attitude and home-direction indicator, gimbal
    angle, message toasts.
  - Done when: a Playwright test sees HUD values change with the simulation state.
- [ ] **09a — Flight sticks** — added on 2026-11-23 at the owner's request, for a WINWING
  Orion 2 stick with the F-16 grip. Built; **waiting for the owner to try it with the real
  stick.**
  - Build: flight sticks, throttles and pedals as their own kind of device, also several
    at once; a setup screen that asks for each control and is answered by moving it; the
    setup saved in the browser; keyboard and stick usable together.
  - Done when: a made-up flight stick is set up and flown in a browser test (done), and
    the owner has flown with the real one.

### Milestone 2 — World system

- [x] **10 — Environment framework**
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
  - First part done on 2026-11-23, brought forward at the owner's request: motor sound by
    thrust and distance, air rushing past by speed, tones for flight events and warnings,
    sound on / off and loudness.
  - Still open: spoken-style prompts; sound of the surroundings (needs the environments,
    Steps 12 to 16); wind (Step 19); battery warnings (Step 26); obstacle beeps (Step 27).
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
- Before Step 04 part C and Step 22: create a DJI developer account and an app key.
  Parts A and B of the check need no account.
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
- 2026-11-23 — step 01 — TypeScript is pinned to 6.0, not 7 — the lint tooling (typescript-eslint) does not support 7 yet.
- 2026-11-23 — step 01 — The ground grid is a texture, not line geometry — headless Chromium's software renderer misplaces long lines that pass behind the camera, so screenshots would be wrong.
- 2026-11-23 — step 01 — CI runs on every push to any branch; the smoke test runs against the production build — the same files that get deployed.
- 2026-11-23 — step 01 — `@playwright/test` is pinned to 1.63.0 — it matches the browser preinstalled in Claude cloud sessions.
- 2026-11-23 — step 01 — The Pages deploy workflow is written but has not run — it needs a `main` branch and Pages switched on (Settings → Pages → Source: GitHub Actions).
- 2026-11-23 — step 02 — A display frame longer than 0.25 s is cut — after a stall the simulation slows down instead of running hundreds of steps to catch up.
- 2026-11-23 — step 02 — Besides `env`, `time`, `seed` and `quality`, the address also takes `debug`, `paused` and `speed` — they make screenshots and tests repeatable. The first four are read and checked now but only used from their own steps (10, 17, 11, 20).
- 2026-11-23 — step 02 — `window.__sim` is also present in the production build — the browser tests run against that build.
- 2026-11-23 — step 02 — Until Step 05 the simulated world is only the turning reference cube — it gives the loop something real to step and interpolate.
- 2026-11-23 — publish — GitHub Pages is switched on and the deploy from `main` works; the site is https://1rdscorp.github.io/Air-2S-Drone-Simulator/ — a step appears there once it is merged into `main`.
- 2026-11-23 — step 03 — A control source reports the two physical sticks; the input manager applies the stick mode — so the keyboard is two sticks too (W A S D left, arrows right) and stick modes 1 / 2 / 3 work the same for every device.
- 2026-11-23 — step 03 — Controls are read once per display frame, not once per simulation step — browsers only refresh gamepads once per frame, and the stick monitor keeps working while the simulation is paused.
- 2026-11-23 — step 03 — Another device takes over only when it is used while the active one is idle; a lost device gives `connected: false` with centred sticks and no silent fall-back — so signal loss can be simulated properly in Step 24.
- 2026-11-23 — step 03 — The flight mode is remembered by the input manager (start: Normal) — keyboard and gamepad have no three-position switch, they only select a mode.
- 2026-11-23 — step 03 — A held key moves its stick out over about 0.2 s and back in about 0.13 s — full deflection in an instant is hard to fly, and a short tap now gives a small correction.
- 2026-11-23 — step 03 — Defaults: expo 0.3, gamepad deadzone 0.08, keyboard deadzone 0. New address settings `stickmode`, `expo`, `sticks`; the stick mode is set in the address until the settings screen exists (Step 34).
- 2026-11-23 — step 03 — `ControlSource` gained `label` and `deadzone`; buttons so far are rth, pause (flight pause), record, shutter, c1, c2.
- 2026-11-23 — step 04 — Postponed at the owner's request — it needs the real controller and does not block flying; it must be done before Step 21.
- 2026-11-23 — step 05 — The Air 2S numbers were checked through web search of DJI's pages, not by reading the pages directly — the build session could not open dji.com. Take-off weight, tilt limits, yaw rates, gimbal, sensing, lens and battery are now confirmed; see section 5.
- 2026-11-23 — step 05 — Flight model: the sticks ask for a speed, a climb rate and a turn rate; the controller turns the speed error into a tilt, the aircraft takes a moment to reach that tilt, tilt accelerates and air drag slows — this is how a camera drone behaves, and it gives visible tilt, lag and braking for free.
- 2026-11-23 — step 05 — Air drag is 0.0185 × speed² — with it, the published 25° (Normal) and 35° (Sport) tilt limits give top speeds just above the published 15 and 19 m/s, so the numbers agree with each other.
- 2026-11-23 — step 05 — Resulting Normal-mode behaviour: 0 to 10 m/s in 2.8 s, 23° nose-down at 15 m/s, stop from 15 m/s in about 3 s and 20 m. A fast turn at speed slows the aircraft, because the tilt limit cannot supply the sideways force. Change `NORMAL_TUNING` if this does not feel right.
- 2026-11-23 — step 05 — Hover hold: after braking below 0.2 m/s the aircraft fixes its hover point and returns to it if moved; the same for height below 0.15 m/s — needed for zero drift now and for wind in Step 19.
- 2026-11-23 — step 05 — Only Normal mode flies; the 1 / 2 / 3 keys are read but change nothing until Step 06. The aircraft starts hovering at 2 m. Touching the ground simply stops it and throttle up lifts off again, until Step 06 (take-off and landing) and Step 10 (crashes).
- 2026-11-23 — step 05 — A simple follow camera and a stand-in drone shape were added now, ahead of Step 07 — without them the flight could not be seen or tried.
- 2026-11-23 — step 05 — The ground is now 4 km wide with distant haze, and the sun's shadow area follows the aircraft — so there is room to fly for a few minutes.
- 2026-11-23 — step 05 — The stick monitor moved to the bottom-right corner — at the bottom centre it covered the aircraft.
- 2026-11-23 — step 05 — Fixed a Step 03 fault: a key pressed and released between two display frames was missed, so a quick tap on 1 / 2 / 3 or a button could do nothing. Taps are now remembered until the next read.
- 2026-11-23 — step 05 — Added Backspace (back to the start) and, for tests, `__sim.setControls()` and `__sim.reset()`.
- 2026-11-23 — publish — The deploy workflow now also runs each time GitHub's own "pages build and deployment" job has finished — while the Pages setting is "Deploy from a branch", that job publishes the README on every merge and sometimes landed after our deploy, so the site showed text instead of the simulator. Setting Pages → Source to "GitHub Actions" would remove GitHub's job; the workflow works either way.
- 2026-11-23 — step 06 — Flight phases are motors off, idle (on the ground, motors running), taking off, flying, landing. The plan's "landed" is idle after a landing by hand, and motors off after an automatic landing — that is how the real aircraft ends each kind of landing.
- 2026-11-23 — step 06 — The stick command is recognised from the stick functions: throttle and pitch fully down, roll and yaw fully over in opposite directions — this is "both sticks down and inward or outward" in every stick mode, so no device needs special handling.
- 2026-11-23 — step 06 — Timings: stick command held 0.25 s on the ground starts or stops the motors; held 2 s in the air cuts them (emergency stop); throttle held fully down for 3 s on the ground stops them. These are chosen values and were not checked against a DJI page.
- 2026-11-23 — step 06 — One take-off / landing button (T, gamepad Start): takes off from the ground, lands from the air, and pressed again cancels a landing. Flight pause (Space, gamepad B) also cancels an automatic take-off or landing.
- 2026-11-23 — step 06 — The K key gives the stick command on the keyboard — holding four keys at once does not register on many keyboards.
- 2026-11-23 — step 06 — Automatic take-off climbs to 1.2 m in about 2 s without overshoot and ignores the sticks; it is the same in every flight mode. Automatic landing descends at 3 m/s, slows below 7 m to 0.5 m/s at touchdown, and lets the pilot steer and turn.
- 2026-11-23 — step 06 — After an emergency stop the aircraft falls under gravity and air drag (about 23 m/s after 90 m) and simply stops on the ground; damage and crashes are Step 10.
- 2026-11-23 — step 06 — The three modes have their own limits and feel. Measured: Cine reaches 4.5 m/s in 2.8 s and stops from 5 m/s in 7 m; Normal reaches 13.5 m/s in 4.6 s and stops from 15 m/s in 20 m; Sport reaches 17 m/s in 4.1 s, flies at 34° tilt at 19 m/s and stops in 22 m. Change `MODE_TUNING` if a mode does not feel right.
- 2026-11-23 — step 06 — The aircraft now starts on the ground with the motors off. A one-line flight status at the bottom of the screen says what it is doing and which key comes next — without it the first screen would not explain itself; Step 09 turns it into the proper HUD.
- 2026-11-23 — step 06 — For tests, `__sim.reset({ height })` starts in a hover and `__sim.setControls({ buttons })` presses buttons.
- 2026-11-23 — step 07 — The aircraft model is built in code from simple solids (rounded body, four arms, motors, two-blade propellers, legs, camera pod) and sized to the published 183 × 253 × 77 mm — no model file to license, and nothing copied from DJI. Red marks on the front legs and a green mark at the back show which way it faces; real navigation lights are Step 18.
- 2026-11-23 — step 07 — Propellers: still when the motors are off, turning visibly when idling, and a see-through disc in powered flight. What is shown depends only on the flight phase and the simulated time — so the same moment always looks the same, which the picture tests need.
- 2026-11-23 — step 07 — Chase camera: 1.7 m behind and 0.55 m above, level, and it swings round behind a turning aircraft with a 0.18 s delay — the turn is then visible in the picture instead of the world just rotating.
- 2026-11-23 — step 07 — Drone camera: looks out of the lens position on the nose, level and straight ahead whatever the tilt. Gimbal tilt and the real field of view are Step 08.
- 2026-11-23 — step 07 — Free camera: it stays on the aircraft and is moved round it with the mouse (drag to look, scroll to zoom) — a camera flown with keys would clash with the flight keys. It does not turn with the aircraft.
- 2026-11-23 — step 07 — V goes through the three views; `?camera=chase|fpv|free` chooses one at start; `__sim.setCamera()` and `__sim.getCamera()` are for tests. A label in the top-right corner names the view.
- 2026-11-23 — step 07 — Picture tests compare each view with a reference picture stored in `sim/e2e/camera.spec.ts-snapshots/`, allowing 1 % of the pixels to differ — enough for small differences between machines, not enough to hide a changed view.
- 2026-11-23 — step 08 — The gimbal's tilt is measured against the horizon, not against the aircraft — that is what stabilisation means: the camera never rolls, and its tilt does not change when the aircraft pitches. The camera turns with the aircraft's heading.
- 2026-11-23 — step 08 — Tilt range −90° to 0° (published), and up to +24° with `?gimbalup=1` until the settings screen exists. The gimbal's mechanical limits are not modelled, so the camera stays steady at any aircraft tilt.
- 2026-11-23 — step 08 — Dial: 50°/s with the dial fully turned, eased in and out over about 0.12 s, never above the published 100°/s. These are tuned values in `GIMBAL_TUNING`. After the dial is let go the camera glides about 6° further and then rests completely.
- 2026-11-23 — step 08 — Shortcuts: C1 (keyboard Z, gamepad left bumper) recentres to level; C2 (keyboard X, right bumper) looks straight down. Each takes about 1.5 s and does not overshoot; turning the dial takes over. Step 25 can make the buttons configurable.
- 2026-11-23 — step 08 — Field of view of the drone camera: DJI's 88° is across the diagonal of the 3:2 photo; that is 77.6° from side to side, which agrees with the published 22 mm equivalent lens. The width of the view is fixed at that value and the height follows the window's shape (48.6° on a 16:9 screen). The chase and free views keep 55°.
- 2026-11-23 — step 08 — Picture tests are now strict: at most 100 differing pixels, with a finer colour threshold — the 1 % allowance of Step 07 let the field-of-view change through unnoticed, because this scene is mostly flat sky and ground. Unchanged views are identical to the last pixel from run to run.
- 2026-11-23 — step 08 — The camera pod of the model stays level and tilts with the gimbal, so stabilisation can be seen from the chase and free views.
- 2026-11-23 — step 09 — Home point and flight time are part of the simulation state: starting the motors records the spot as home and sets the clock to zero; the clock runs while the motors run, also on the ground, and keeps its value after they stop — Return-to-Home (Step 26) needs the same home point, and a display fed only by simulation state is the same on every run.
- 2026-11-23 — step 09 — Flight display layout, our own design: mode, flight time and battery top left; a compass tape top centre with the heading and a mark for the direction of home; a horizon instrument bottom left with the direction to home on its rim, next to height, distance from home, speed, climb rate and camera tilt. Metric units only until the settings screen (Step 34).
- 2026-11-23 — step 09 — The battery always reads 100 % — the battery model is Step 26.
- 2026-11-23 — step 09 — Closer than 0.5 m to home the two home marks are hidden — there is no meaningful direction to a point straight below.
- 2026-11-23 — step 09 — Messages: the simulation reports what happens in a flight (take-off, landing, mode change, emergency stop, lost controller, ...) as flight events, and the display turns them into short messages under the compass. They last 4 simulated seconds, warnings 7, at most three at once, and a newer message about the same subject replaces the older one — so a test that steps the simulation always sees the same messages, and they stay while paused.
- 2026-11-23 — step 09 — The line at the bottom that says which key comes next stays as it is. The "Paused / Speed" badge moved to the top right and the debug overlay moved down, to make room for the compass and the top row.
- 2026-11-23 — step 04 — The tools for the controller check are built; the check itself is not done and the step stays open until the owner has run `docs/CONTROLLER_CHECK.md` with the real controller — only the hardware can answer the three questions.
- 2026-11-23 — step 04 — The probe is its own small app in `rc-probe/`, not the start of the bridge app — it is thrown away after the check, and `rc-bridge/` (Step 22) starts clean with what the check has found.
- 2026-11-23 — step 04 — Two builds of the probe: a small one without any DJI software (0.9 MB, no account needed, offered for download next to the simulator) and one with the DJI Mobile SDK 4.18 (77 MB, needs a DJI app key, offered only as a download on the build's page) — two of the three questions can then be answered at once, and a fault in DJI's old SDK cannot stop the other two probes.
- 2026-11-23 — step 04 — The DJI app key is the repository secret `DJI_APP_KEY`, or the ignored file `rc-probe/dji.properties` for a local build. The app with the key inside is never published on the project site, because the site is public.
- 2026-11-23 — step 04 — The Bluetooth probe goes one step further than "can it advertise": it also sends a 20-byte test packet 50 times per second, and the check page on the PC connects and counts them — advertising alone would not show whether the link is fast enough to fly with (at least 40 packets per second). The packet is for this measurement only; the real protocol is Step 21.
- 2026-11-23 — step 04 — Android build tools are pinned: Gradle 8.14.3, Android Gradle plugin 8.13.2, Kotlin 2.2.21, target Android 11 (API 30), minimum Android 7.0 — DJI's SDK v4 is old and newer tools are not guaranteed to work with it. With target 30 the two old Bluetooth permissions are enough on every Android version.
- 2026-11-23 — step 04 — The check page is hand-written in old-style JavaScript and excluded from the code formatter; a unit test checks that it stays that way — part of the check is opening it in the controller's own browser, which is years old.
- 2026-11-23 — step 30 — The first part of the sound was built early, at the owner's request, and the step stays open — the rest belongs to things that do not exist yet (surroundings, wind, battery, obstacles) and is listed under Step 30.
- 2026-11-23 — step 30 — All sound is generated in the browser; there are no recordings — nothing to license, nothing to download, and it follows the flight exactly.
- 2026-11-23 — step 30 — Motor sound: each motor plays the note of its blades passing, 197 Hz in a hover (two blades at 5900 turns per minute), with overtones and a hiss. The note rises with thrust: in a climb, when tilted, at speed; it falls in a descent. The four motors differ slightly, which gives the buzz, and shift against each other when the aircraft tips or turns. Motor speeds are not published by DJI; the hover speed is worked out from weight and propeller size, idle (2200) and top speed (9000) are chosen. Change `PROPULSION_CHOSEN` and `SOUND_TUNING` if it does not sound right.
- 2026-11-23 — step 30 — The listener is the camera: the aircraft is quieter and duller from farther away and is heard from the side it is on. In the drone camera view it is heard from on board.
- 2026-11-23 — step 30 — Tones: rising for take-off, falling for landing, one note per flight mode (higher for faster modes), harsh notes for the emergency stop and a lost controller, a dull knock for touching and hitting the ground. Starting and stopping the motors has no tone; the motors themselves are heard running up and down.
- 2026-11-23 — step 30 — Sound starts with the first key press or click, because browsers do not allow it earlier; a label says so. M switches it off and on; `?sound=0` starts without it and `?volume=` sets the loudness (default 0.7) until the settings screen exists (Step 34). It is silent while paused and while the page is in the background.
- 2026-11-23 — step 30 — The sound was checked by measuring, not by ear: a browser test measures the loudness and the strongest frequency at the output, and `sim/scripts/render-sound.mjs` renders a test flight to a file and lists what is in it — the build session cannot play sound. How it sounds to a person is for the owner to judge.
- 2026-11-23 — step 09a — Flight sticks were added as an extra step, at the owner's request — the owner has a WINWING Orion 2 stick with the F-16 grip; the check page showed how the browser (Firefox) reports it.
- 2026-11-23 — step 09a — Only a device with the browser's standard layout is read as a game controller; every other one is a flight stick — until now any device with four axes was read as a game controller, so a flight stick's left / right turned the aircraft and an axis resting at one end made it climb or spin by itself.
- 2026-11-23 — step 09a — The pilot shows the simulator which control is which, on a setup screen opened with J: it asks for one control at a time and is answered by moving that control; the direction of the movement tells whether the axis is reversed. Nothing is assumed about a model — axes and buttons of flight sticks arrive as plain numbered lists, different for every model and browser.
- 2026-11-23 — step 09a — Before the setup, only the stick's first two axes are used (left / right, forward / back); climbing and turning stay on the keyboard — that much is the same on every joystick, and it flies at once.
- 2026-11-23 — step 09a — With a flight stick, the keyboard keeps working at the same time: buttons, flight mode and camera tilt count from every device, and whichever of the four flight controls the stick has no control for comes from the keyboard. This relaxes the Step 03 rule "one device at a time", but only for buttons and when a flight stick is involved; keyboard and gamepad are still not mixed.
- 2026-11-23 — step 09a — A lever that stays where it is put (a throttle) is recognised in the setup and gets a middle zone, a fifth of its travel to either side, that means "hold the height" — a drone's climb control springs back to the middle, a throttle lever does not, and without the zone the middle could not be found by hand. The pilot can overrule the recognition.
- 2026-11-23 — step 09a — The setup is kept in the browser's storage, one setup for all devices together; if one of its devices is unplugged the stick does not fly at all — with the throttle gone, half a setup would fly without height control. The simulation is paused while the setup screen is open, and no key reaches the aircraft.
- 2026-11-23 — step 09a — Not done: calibration of end stops and centre (the device's own software does that), buttons for return to home, record and photo (they do nothing yet), and Chrome's way of reporting a hat switch, of which only "up" can be used as a button; in Firefox a hat works in every direction.
- 2026-11-23 — step 09a — Tested with made-up devices only — no flight stick can be plugged into the build session. Which axis the real stick's thumb control is, and whether its hat arrives as buttons or as axes, is not known; the setup screen is built not to need to know.
- 2026-11-27 — step 10 — A place to fly is one object with a fixed set of duties: build the scenery, say where the aircraft starts and how the place is lit, answer "how high is the surface here" and "what does this ray hit", and free everything when it is left. Mountains, ocean, beach and city will each be one such object.
- 2026-11-27 — step 10 — The flight knows the world only as the height of the surface below each spot, obstacles included — simple, fast and exact for terrain, roofs and platforms. The price: nothing can be flown under. A bridge, a pier or an arch needs more than this; decide when the city or the beach asks for one.
- 2026-11-27 — step 10 — The list of places opens with E or a click on the place's name. All five places are listed from the start; the four that are not built yet are marked so and cannot be chosen, and `?env=` with one of them gives the test field and a note — the pilot sees what is coming, and nothing breaks.
- 2026-11-27 — step 10 — Changing the place starts a new flight: aircraft at the start of the new place, motors off, messages cleared. The simulation stands still while the list is open and while a place loads. The old place is freed before the new one is built, so the two are never in memory together.
- 2026-11-27 — step 10 — The test field: ground with a grid of 5 m squares, a landing pad at the start, a cube, a wall, a 30 m tower, a gate of two pillars, a raised platform and three steps with landing marks, and a row of poles. The four straight lines from the start are kept clear, so a first flight straight ahead hits nothing.
- 2026-11-27 — step 10 — A crash is: coming down faster than 3 m/s, touching a surface while moving sideways faster than 2.5 m/s, or flying into the side of something faster than 0.8 m/s. A slower bump into a wall just stops the aircraft. Chosen values — a real camera drone breaks earlier, but a simulator that punishes every firm landing is no fun to learn on. They are in `CRASH_CHOSEN`.
- 2026-11-27 — step 10 — After a crash the aircraft falls, lies tipped over for 3 seconds, and is put back at the start of the place with the motors off ("reset at home" in the plan; the start is used, since the home point may be on a roof). There is no damage model.
- 2026-11-27 — step 10 — A descent by hand is slowed below 7 m, down to 0.5 m/s at the surface, however far the stick is pushed — so an ordinary landing can never be a crash, in the way the real aircraft's landing protection slows the last metres. Above 7 m the full descent speed is unchanged.
- 2026-11-27 — step 10 — An emergency stop in the air now ends in a crash and a new start, instead of the aircraft simply standing on the ground afterwards (Steps 05 and 06 had left that for this step).
- 2026-11-27 — step 10 — The aircraft can stand on anything flat. Take-off and hover heights count from the surface below; the display shows the height above the spot where the motors were started, as the real one does.
- 2026-11-27 — step 10 — "GPU memory stays stable" is checked by a browser test: it loads the place ten times and compares the renderer's counts of geometries and textures. With the cleanup switched off the counts grew on every load, so the test does see a leak. With only one place built, "switching" means loading the test field again; every new place joins that test.
- 2026-11-27 — step 10 — Obstacles cast no shadows for now — the sun's shadow area is a few metres wide and follows the aircraft, so an obstacle cast a cut-off piece of shadow that travelled along. The aircraft's own shadow still falls on the ground and on obstacles. Full shadows come with Step 17.
- 2026-11-27 — step 10 — Each place has one fixed lighting (sky colour, haze, sun) until Step 17 brings the time of day. The seed is handed to every place; the test field does not use it.
- 2026-11-27 — step 10 — Not checked: the frame rate on a real graphics card (the build session draws in software), and whether the crash limits feel right in the hand — both are for the owner to try.
- 2026-11-27 — step 08 — For the camera tilt, whatever was done last counts: a shortcut (level, straight down) pressed while the dial is turned now overrules the dial until the dial has been let go; turning the dial afterwards takes over as before — until now a turned dial always won, and from the keyboard the dial is still springing back for about a tenth of a second after R or F is let go, so X or Z pressed right away did nothing. Found by a browser test that failed now and then.

---

## Sources

- [DJI Smart Controller product and support pages](https://www.dji.com/smart-controller) — Bluetooth 4.2, third-party apps, screen and HDMI.
- [DJI forum: Smart Controller Android version and apps](https://forum.dji.com/thread-181292-1-1.html)
- [DJI forum: RM500 in DJI Flight Simulator](https://forum.dji.com/thread-282997-1-1.html)
- [DJI Mobile SDK v4: remote controller hardware state](https://developer.dji.com/api-reference/android-api/Components/RemoteController/DJIRemoteController_DJIRCHardwareState.html)
- [DroneDJ: Mobile SDK 4.16 adds Air 2S](https://dronedj.com/2022/01/03/dji-sdk-mini-2-se-air-2s/)
- [MDN: Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API) and [caniuse: Web Bluetooth](https://caniuse.com/web-bluetooth)
- [DJI Mobile SDK v4 sample app](https://github.com/dji-sdk/Mobile-SDK-Android/tree/master/Sample%20Code) — build settings for SDK 4.18, the "only remote controller connected" state, reading the sticks.
- [Chrome: serial over Bluetooth](https://developer.chrome.com/blog/serial-over-bluetooth) — Web Serial for Bluetooth serial ports, from Chrome 117.
- [Litchi: DJI controllers with a screen](https://flylitchi.com/dji-monitors) — force-stop DJI's own app before another app can use the controller.
- [dji-rc-joystick](https://github.com/voluminor/dji-rc-joystick) — community tool reading the DJI RC's sticks over Wi-Fi.
- [DJI Air 2S specifications](https://www.dji.com/air-2s/info) and [support page](https://www.dji.com/support/product/air-2s)
- [Community example: DJI RC-N1 as a simulator joystick over USB](https://github.com/pverhaert/DJI_RCN1_for_drone_simulators)
