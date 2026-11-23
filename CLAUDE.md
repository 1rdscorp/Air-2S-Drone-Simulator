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
- `rc-bridge/` — Android app for the Smart Controller (Kotlin, DJI Mobile SDK v4). Created in Step 22.
- `docs/` — plan, prompts, protocol, setup guides.
- `.github/workflows/` — `ci.yml` (every push) and `deploy.yml` (GitHub Pages, from `main`).
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

Notes for headless and cloud sessions:

- `@playwright/test` is pinned to the version whose Chromium is preinstalled in Claude
  cloud sessions. If the versions drift apart, set `PW_CHROMIUM_PATH` to the installed
  browser instead of downloading another one.
- Headless Chromium draws WebGL in software (`--enable-unsafe-swiftshader`). Pictures are
  correct but slow, so never judge frame rate there.
- For screenshots of work in progress, start `npm run dev` and drive it with Playwright.

## Debug tools

- Address settings: `?debug=1` (overlay), `?paused=1`, `?speed=0.5` (0.05 to 8),
  `?stickmode=1|2|3`, `?expo=0..1`, `?sticks=0` (hide the stick monitor),
  `?camera=chase|fpv|free`, plus `env`, `time`, `seed`, `quality`, which are read now and
  used from Steps 10, 17, 11, 20.
- Keys: `` ` `` or F2 overlay, I stick monitor, V next camera view, P pause, `.` one step
  while paused, `-` and `=` speed, Backspace puts the aircraft back at the start.
- `window.__sim` (see `sim/src/core/testHook.ts`): `tick`, `time`, `paused`, `timeScale`,
  `pause()`, `resume()`, `step(n)`, `reset({ height? })`, `setControls({...} | null)`,
  `setCamera(mode)`, `getCamera()`, `getState()`, `getStats()`, `getInput()`, `params`.
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

## Picture tests

Some browser tests compare the 3D view with a reference picture (`toHaveScreenshot`), for
example `sim/e2e/camera.spec.ts`. They hide the text overlays first and allow 1 % of the
pixels to differ.

- When such a test fails, look at the actual picture before anything else. If the view
  changed by mistake, fix the code.
- Only when the view was meant to change, renew the references inside `sim/` with
  `npx playwright test --update-snapshots`, look at every new picture, and commit them.
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
  `CINE_CHOSEN`, `MODE_TUNING` and `FLIGHT_PROCEDURE`. Flight feel is changed there, never
  in `flightModel.ts`.
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
- Do not draw long lines with line geometry (`GridHelper`, `Line`, `LineSegments`): the
  software renderer misplaces lines that pass behind the camera. Use textures or meshes.
- Secrets (the DJI app key) come from a local file or CI secret and are never committed.

## Safety

The Smart Controller always commands a linked, powered-on drone, whatever app is on its
screen. Hardware tests are run with the drone switched off, and every checklist says so.
