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
  - `sim/e2e/` — Playwright smoke tests.
- `rc-bridge/` — Android app for the Smart Controller (Kotlin, DJI Mobile SDK v4). Created in Step 22.
- `docs/` — plan, prompts, protocol, setup guides.
- `.github/workflows/` — `ci.yml` (every push) and `deploy.yml` (GitHub Pages, from `main`).

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

- Address settings: `?debug=1` (overlay), `?paused=1`, `?speed=0.5` (0.05 to 8), plus
  `env`, `time`, `seed`, `quality`, which are read now and used from Steps 10, 17, 11, 20.
- Keys: `` ` `` or F2 overlay, P pause, `.` one step while paused, `-` and `=` speed.
- `window.__sim` (see `sim/src/core/testHook.ts`): `tick`, `time`, `paused`, `timeScale`,
  `pause()`, `resume()`, `step(n)`, `getState()`, `getStats()`, `params`.
- For a repeatable screenshot or test: open with `?paused=1`, call `__sim.step(n)`, then
  read `__sim.getState()` or take the picture.

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
- Flight code depends on `ControlFrame`, never on a specific input device.
- Every environment implements the `Environment` interface and frees everything in
  `dispose()`.
- All Air 2S numbers live in one config file, each with a comment naming its source.
- World content is procedural and seeded. No DJI logos, artwork or copied screen designs.
- Do not draw long lines with line geometry (`GridHelper`, `Line`, `LineSegments`): the
  software renderer misplaces lines that pass behind the camera. Use textures or meshes.
- Secrets (the DJI app key) come from a local file or CI secret and are never committed.

## Safety

The Smart Controller always commands a linked, powered-on drone, whatever app is on its
screen. Hardware tests are run with the drone switched off, and every checklist says so.
