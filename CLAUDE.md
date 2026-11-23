# Air 2S Drone Simulator

A 3D drone flight simulator that runs in Chrome and is flown with a real DJI Smart
Controller linked over Bluetooth. Keyboard and standard gamepads also work.

The full plan, decisions and numbered steps are in `docs/PLAN.md`. Read it before any
work. Reusable prompts are in `docs/PROMPTS.md`.

## Status

No code exists yet. Progress is the checklist in `docs/PLAN.md` section 6.

## Layout

- `sim/` — web simulator: TypeScript (strict), Three.js, Vite. Created in Step 01.
- `rc-bridge/` — Android app for the Smart Controller (Kotlin, DJI Mobile SDK v4). Created in Step 22.
- `docs/` — plan, prompts, protocol, setup guides.

## Commands

None yet. Step 01 creates them and must list them here (dev server, lint, type-check,
unit tests, smoke tests, build).

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
- Flight code depends on `ControlFrame`, never on a specific input device.
- Every environment implements the `Environment` interface and frees everything in
  `dispose()`.
- All Air 2S numbers live in one config file, each with a comment naming its source.
- World content is procedural and seeded. No DJI logos, artwork or copied screen designs.
- Secrets (the DJI app key) come from a local file or CI secret and are never committed.

## Safety

The Smart Controller always commands a linked, powered-on drone, whatever app is on its
screen. Hardware tests are run with the drone switched off, and every checklist says so.
