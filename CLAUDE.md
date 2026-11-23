# Air 2S Drone Simulator

A 3D drone flight simulator that runs in Chrome and is flown with a real DJI Smart
Controller linked over Bluetooth. Keyboard and standard gamepads also work.

The full plan, decisions and numbered steps are in `docs/PLAN.md`. Read it before any
work. Reusable prompts are in `docs/PROMPTS.md`.

## Status

Progress is the checklist in `docs/PLAN.md` section 6. Decisions taken along the way are
in its decision log (section 9).

## Layout

- `sim/` — web simulator: TypeScript (strict), Three.js, Vite.
  - `sim/src/` — app code; unit tests sit next to the code as `*.test.ts`.
  - `sim/e2e/` — Playwright browser tests; `*-snapshots/` folders hold reference pictures.
- `rc-probe/` — small Android app for the controller check of Step 04 (Kotlin). Two
  builds: `plain` (no DJI software) and `dji` (DJI Mobile SDK 4.18). It is a throw-away
  test tool, not the start of the bridge app.
- `rc-bridge/` — Android app for the Smart Controller (Kotlin, DJI Mobile SDK v4). Created in Step 22.
- `docs/` — plan, prompts, protocol, setup guides.
- `.github/workflows/` — `ci.yml` (every push), `rc-probe.yml` (pushes that touch
  `rc-probe/`, and by hand) and `deploy.yml` (GitHub Pages, from `main`).
  The published site is https://1rdscorp.github.io/Air-2S-Drone-Simulator/ and shows what
  is merged into `main`. `deploy.yml` runs on the push and again after GitHub's own
  "pages build and deployment" job, which would otherwise replace the simulator with the
  README. If the site shows text instead of the simulator, start `deploy.yml` by hand.

## Commands

Run all of these inside `sim/` (Node 22, `npm ci` first).

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server with live reload at http://localhost:5173 |
| `npm run lint` | ESLint and Prettier check (`npm run format` fixes formatting) |
| `npm run typecheck` | TypeScript, no output files |
| `npm test` | Unit tests (Vitest); `npm run test:watch` while working |
| `npm run e2e` | Builds, then runs the Playwright smoke test against the production build |
| `npm run build` | Production build into `sim/dist/` |
| `npm run check` | Lint, type-check, unit tests, build and smoke test in one go |

The Android app in `rc-probe/` has its own commands. Run them inside `rc-probe/`; they
need a JDK (17 or newer) and the Android SDK (`ANDROID_HOME`, platform 35).

| Command | What it does |
|---------|--------------|
| `./gradlew testPlainDebugUnitTest` | Unit tests, and a start of the app's screen on a simulated Android 7.1 |
| `./gradlew lintPlainDebug lintDjiDebug` | Android lint for both builds |
| `./gradlew assemblePlainDebug` | The small app, `app/build/outputs/apk/plain/debug/` |
| `./gradlew assembleDjiDebug` | The app with the DJI SDK; the key comes from `DJI_APP_KEY` or `rc-probe/dji.properties` |

Notes for headless and cloud sessions:

- A cloud session has no Android SDK. Download Google's command-line tools into a folder,
  set `ANDROID_HOME` to it and install `platforms;android-35`, `build-tools;35.0.0` and
  `platform-tools` with `sdkmanager`. No Android device or emulator can run there, so the
  app itself is only ever tried by the owner on the real controller.

- `@playwright/test` is pinned to the version whose Chromium is preinstalled in Claude
  cloud sessions. If the versions drift apart, set `PW_CHROMIUM_PATH` to the installed
  browser instead of downloading another one.
- Headless Chromium draws WebGL in software (`--enable-unsafe-swiftshader`). Pictures are
  correct but slow, so never judge frame rate there.
- For screenshots of work in progress, start `npm run dev` and drive it with Playwright.

## Debug tools

- Address settings: `?debug=1` (overlay), `?paused=1`, `?speed=0.5` (0.05 to 8),
  `?stickmode=1|2|3`, `?expo=0..1`, `?sticks=0` (hide the stick monitor),
  `?camera=chase|fpv|free`, `?gimbalup=1` (camera may tilt up to +24°), `?sound=0`
  (start muted), `?volume=0..1`, plus `env`,
  `time`, `seed`, `quality`, which are read now and used from Steps 10, 17, 11, 20.
- Keys: `` ` `` or F2 overlay, I stick monitor, V next camera view, M sound, P pause, `.`
  one step while paused, `-` and `=` speed, Backspace puts the aircraft back at the start.
- `window.__sim` (see `sim/src/core/testHook.ts`): `tick`, `time`, `paused`, `timeScale`,
  `pause()`, `resume()`, `step(n)`, `reset({ height? })`, `setControls({...} | null)`,
  `setCamera(mode)`, `getCamera()`, `getState()`, `getStats()`, `getInput()`, `getAudio()`,
  `params`.
- The aircraft starts on the ground with the motors off. For an exact flight test: open
  with `?paused=1`, call `__sim.reset({ height: 20 })` to start in a hover, then
  `__sim.setControls({ pitch: 1, mode: 'S', buttons: { takeoffLand: true } })`,
  `__sim.step(n)` and read `__sim.getState()`. See `sim/e2e/flight.spec.ts`.
- `__sim.step(n)` redraws once per call, and a redraw is slow in the software renderer.
  Step many ticks in one call; never call `step(1)` in a long loop.
- Flight keys and gamepad buttons are defined in `sim/src/input/keyboardSource.ts` and
  `gamepadSource.ts`. Keep the Controls tables in `README.md` in step with them, and keep
  new flight keys clear of the debug keys above.
- A gamepad can be faked in browser tests by replacing `navigator.getGamepads` before the
  page loads; see `sim/e2e/input.spec.ts`.
- For a repeatable screenshot or test: open with `?paused=1`, call `__sim.step(n)`, then
  read `__sim.getState()` or take the picture.

## Sound

- All sound is generated in code; there are no sound files. `sim/src/audio/soundModel.ts`
  works out from the simulation state what should be heard (motor notes, loudness, rushing
  air, tones for flight events) and is plain, unit-tested code. `audioEngine.ts` plays it
  with Web Audio and only adds the smooth changes. Sound never changes the simulation.
- Browsers allow sound only after a key press or a click, so the engine starts on the
  first one. It is silent while paused, while muted and while the page is in the background.
- Nobody can listen in a headless session. Check sound by measuring it:
  - `__sim.getAudio()` gives what the engine aims for and, once sound runs, the loudness
    and the strongest frequency measured at the output (see `sim/e2e/audio.spec.ts`).
  - With `npm run dev` running, `node scripts/render-sound.mjs flight.wav` renders a
    scripted flight to a sound file and prints its loudness and strongest note second by
    second. Send the file to the owner to listen to; that is the "screenshot" for sound.
- A new sound belongs to the step that brings the thing it is for: battery warnings to
  Step 26, obstacle beeps to Step 27, wind to Step 19, surroundings to the environments.

## Picture tests

Some browser tests compare the 3D view with a reference picture (`toHaveScreenshot`), for
example `sim/e2e/camera.spec.ts` and `sim/e2e/gimbal.spec.ts`. They hide the text overlays
first and allow at most 100 pixels to differ. The comparison has to be that strict: the
scene is mostly flat sky and ground, so even a clearly different view changes well under
1 % of the pixels.

- When such a test fails, look at the actual picture before anything else. If the view
  changed by mistake, fix the code.
- The tests hide everything on top of the 3D view with `visibility: hidden` on `#hud` and
  the other overlays. An element that sets its own `visibility` stays visible and ends up
  in the pictures, so show and hide parts of an overlay with `hidden` or `display`.
- Only when the view was meant to change, renew the references inside `sim/` with
  `npx playwright test --update-snapshots=all`, look at every new picture, and commit them.
- After a change that should alter a view, check that the old reference really fails
  before renewing it. If it still passes, the test is not looking at what changed.
- Keep everything in a pictured scene dependent only on simulation state and simulated
  time, never on real time; otherwise the picture is different on every run.

## Working rules

- One step per session, and only the step the user names. Work that belongs to a later
  step gets a `TODO(step-XX)` comment, not an implementation.
- The decisions in `docs/PLAN.md` section 2 are settled. Raise a concern before changing one.
- A step is finished only when lint, type-check and tests pass, the app starts in
  headless Chromium, and screenshots of the change have been shown to the user. The user
  checks work by trying it, not by reading code.
- After a step: tick it in `docs/PLAN.md`, add a decision-log line for anything decided,
  and update this file if commands or folders changed.
- Say plainly what could not be verified. Anything that needs the real controller is a
  hardware test for the user; give a numbered checklist.

## Code conventions

- Units are metres, seconds and radians in code; degrees only in UI and config.
- Three.js axes, Y up. Heading 0° is north, which is −Z.
- The simulation runs at a fixed 120 Hz step and is deterministic: same seed and inputs
  give the same flight. Rendering interpolates and never changes simulation state.
  State changes only inside `Simulation.step`; drawing reads `Simulation.interpolate`.
- Flight code depends on `ControlFrame`, never on a specific input device. A device is a
  `ControlSource` that reports the two physical sticks; `InputManager` does stick mode,
  deadzone and expo.
- Every environment implements the `Environment` interface and frees everything in
  `dispose()`.
- All Air 2S numbers live in `sim/src/drone/air2s.config.ts`: published values with their
  source in `AIR_2S_SPECS`; chosen and tuned values (not published) separately in
  `CINE_CHOSEN`, `MODE_TUNING`, `FLIGHT_PROCEDURE` and `PROPULSION_CHOSEN` (motor speeds,
  for the sound). Flight feel is changed there, never in `flightModel.ts`.
- What the aircraft is doing is its flight phase (motors off, idle, taking off, flying,
  landing). `sim/src/drone/flightPhase.ts` decides the phase from sticks and buttons;
  `flightModel.ts` moves the aircraft for that phase.
- The aircraft state is `DroneState` in `sim/src/drone/droneState.ts`. `y` is the height of
  its underside, so 0 means standing on the ground. Heading 0 is north and grows turning
  right; it is not wrapped at 360°. Positive pitch is nose down, positive roll is right
  side down.
- World content is procedural and seeded. No DJI logos, artwork or copied screen designs.
- The aircraft shape is built in code in `sim/src/drone/droneModel.ts`. The views are in
  `sim/src/camera/cameraRig.ts`; a camera reads the aircraft's pose and never changes the
  simulation.
- The camera gimbal is part of the simulation state (`gimbalTilt` in `DroneState`, moved by
  `sim/src/drone/gimbal.ts`). Its tilt is measured against the horizon: 0 is level, −90°
  is straight down. The drone camera view and the model's camera pod both read it.
- The flight display is `sim/src/ui/hud.ts`. It only shows numbers that `hudValues`
  (`sim/src/ui/hudValues.ts`) reads off the simulation state, and every value carries a
  `data-hud` name that browser tests read (see `sim/e2e/hud.spec.ts`). The home point and
  the flight time are in `DroneState` (`sim/src/drone/flightRecord.ts`).
- Messages to the pilot come from flight events: `Simulation` reports what happened in a
  step (`sim/src/drone/flightEvents.ts`), `sim/src/ui/flightMessages.ts` has the words.
  Events are a report and never change the flight. Messages live in simulated time.
- Do not draw long lines with line geometry (`GridHelper`, `Line`, `LineSegments`): the
  software renderer misplaces lines that pass behind the camera. Use textures or meshes.
- Secrets (the DJI app key) come from a local file or CI secret and are never committed.

## Controller check (Step 04)

- `docs/CONTROLLER_CHECK.md` is the checklist the owner follows with the real controller.
  Keep it in step with the app and the page whenever a button or a text changes.
- `sim/public/controller-check.html` is published next to the simulator. It is written by
  hand in old-style JavaScript (ES5) because it is also opened in the controller's own,
  years-old browser; it is excluded from Prettier, and `sim/src/controllerCheckPage.test.ts`
  fails if newer syntax slips in. Its browser tests are `sim/e2e/controllerCheck.spec.ts`.
- The page and the app share the ids of the Bluetooth test service and the layout of the
  20-byte test packet (`rc-probe/.../TestPacket.kt`). Both sides test the same reference
  packet; change them together.
- In the app, what a probe found is plain data (`Findings.kt`) and a function turns it
  into the verdict. Keep Android calls out of those functions so they stay unit-tested.
- The DJI app key is the repository secret `DJI_APP_KEY`. An app built with it contains
  the key and is never put on the public site; `deploy.yml` publishes only the small build.

## Safety

The Smart Controller always commands a linked, powered-on drone, whatever app is on its
screen. Hardware tests are run with the drone switched off, and every checklist says so.
