import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../camera/cameraRig';
import { SIM_DT, SIM_HZ } from '../core/gameLoop';
import { type ButtonId, type ControlFrame, neutralFrame, noButtonsPressed } from '../input/types';
import { AIR_2S_SPECS, GIMBAL_TUNING } from './air2s.config';
import { createDroneState, createFlyingState, type DroneState } from './droneState';
import { stepDrone } from './flightModel';
import { gimbalUpperLimit } from './gimbal';

const DEG = Math.PI / 180;

interface Input {
  gimbal?: number;
  press?: ButtonId[];
  roll?: number;
  pitch?: number;
  connected?: boolean;
}

function controls(input: Input = {}): ControlFrame {
  const { press = [], ...rest } = input;
  const buttons = noButtonsPressed();
  for (const id of press) {
    buttons[id] = true;
  }
  return { ...neutralFrame(0, 'N', true), ...rest, buttons };
}

/** Runs for `seconds` with the controls held as given. */
function run(state: DroneState, seconds: number, input: Input = {}, upward = false): DroneState {
  const frame = controls(input);
  for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
    stepDrone(state, frame, SIM_DT, { gimbalUpward: upward });
  }
  return state;
}

/** Presses a button briefly and lets go again. */
function tap(state: DroneState, button: ButtonId): DroneState {
  run(state, 0.1, { press: [button] });
  return run(state, 0.1);
}

/** The drone camera as it would be drawn for this state. */
function droneCamera(state: DroneState): PerspectiveCamera {
  const camera = new PerspectiveCamera();
  new CameraRig('fpv').update(camera, state, 0);
  return camera;
}

/** How far the picture is rolled sideways, in degrees: 0 means the horizon is level. */
function cameraRollDeg(camera: PerspectiveCamera): number {
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  return Math.asin(right.y) / DEG;
}

/** How far the camera looks above (+) or below (-) the horizon, in degrees. */
function cameraPitchDeg(camera: PerspectiveCamera): number {
  return Math.asin(camera.getWorldDirection(new Vector3()).y) / DEG;
}

describe('gimbal stabilisation', () => {
  it('keeps the camera roll at 0° when the drone rolls 30°', () => {
    const state = createFlyingState(50);
    state.roll = 30 * DEG;

    expect(cameraRollDeg(droneCamera(state))).toBeCloseTo(0, 9);
  });

  it('keeps the horizon level through a real, hard banked flight', () => {
    const state = createFlyingState(50);
    let steepest = 0;
    let worstRoll = 0;
    for (let i = 0; i < 6 * SIM_HZ; i++) {
      stepDrone(state, controls({ roll: i < 3 * SIM_HZ ? 1 : -1, pitch: 1 }), SIM_DT);
      steepest = Math.max(steepest, Math.abs(state.roll) / DEG);
      worstRoll = Math.max(worstRoll, Math.abs(cameraRollDeg(droneCamera(state))));
    }

    expect(steepest).toBeGreaterThan(15); // the drone really did bank
    expect(worstRoll).toBeLessThan(1e-9);
  });

  it('keeps the camera pointing at the horizon when the drone pitches', () => {
    const state = createFlyingState(50);
    for (const pitch of [-25, 10, 35]) {
      state.pitch = pitch * DEG;

      expect(cameraPitchDeg(droneCamera(state)), `drone pitch ${pitch}`).toBeCloseTo(0, 9);
    }
  });

  it('holds its tilt against the horizon, not against the drone', () => {
    const state = createFlyingState(50);
    state.gimbalTilt = -40 * DEG;
    state.pitch = 25 * DEG;
    state.roll = -20 * DEG;
    const camera = droneCamera(state);

    expect(cameraPitchDeg(camera)).toBeCloseTo(-40, 9);
    expect(cameraRollDeg(camera)).toBeCloseTo(0, 9);
  });

  it('turns with the drone: the camera looks where the nose points', () => {
    const state = createFlyingState(50);
    state.heading = 90 * DEG;
    const direction = droneCamera(state).getWorldDirection(new Vector3());

    expect(direction.x).toBeCloseTo(1, 9);
    expect(direction.z).toBeCloseTo(0, 9);
  });

  it('looks straight down at -90° with north at the top for a drone facing north', () => {
    const state = createFlyingState(50);
    state.gimbalTilt = -90 * DEG;
    const camera = droneCamera(state);
    const top = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

    expect(cameraPitchDeg(camera)).toBeCloseTo(-90, 6);
    expect(top.z).toBeCloseTo(-1, 9); // the top of the picture is north
    expect(cameraRollDeg(camera)).toBeCloseTo(0, 9);
  });
});

describe('gimbal limits', () => {
  it('starts level', () => {
    expect(createDroneState().gimbalTilt).toBe(0);
  });

  it('is clamped at -90°: it stops looking straight down however long the dial is held', () => {
    const state = run(createFlyingState(50), 10, { gimbal: -1 });

    expect(state.gimbalTilt).toBe(AIR_2S_SPECS.gimbal.tiltMin);
    expect(state.gimbalTilt / DEG).toBeCloseTo(-90, 9);
    expect(state.gimbalRate).toBe(0);
  });

  it('is clamped at 0°: it cannot look above level by default', () => {
    const state = createFlyingState(50);
    state.gimbalTilt = -30 * DEG;
    run(state, 10, { gimbal: 1 });

    expect(state.gimbalTilt).toBe(0);
    expect(state.gimbalRate).toBe(0);
  });

  it('can look up to +24° when the upward setting is on, and no further', () => {
    const state = run(createFlyingState(50), 10, { gimbal: 1 }, true);

    expect(state.gimbalTilt / DEG).toBeCloseTo(24, 9);
    expect(gimbalUpperLimit(true) / DEG).toBeCloseTo(24, 9);
    expect(gimbalUpperLimit(false)).toBe(0);
  });

  it('never leaves its range during a long run of random dial movements', () => {
    const state = createFlyingState(50);
    let seed = 99;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return (seed / 4294967296) * 2 - 1;
    };
    let lowest = 0;
    let highest = 0;
    for (let i = 0; i < 400; i++) {
      run(state, 0.5, { gimbal: random(), press: random() > 0.8 ? ['c2'] : [] });
      lowest = Math.min(lowest, state.gimbalTilt);
      highest = Math.max(highest, state.gimbalTilt);
    }

    expect(lowest).toBeGreaterThanOrEqual(-90 * DEG);
    expect(highest).toBeLessThanOrEqual(0);
    expect(lowest).toBeLessThan(-80 * DEG); // it did reach the bottom
  });

  it('leaves a stop at once when the dial is turned the other way', () => {
    const state = run(createFlyingState(50), 10, { gimbal: -1 });

    run(state, 0.5, { gimbal: 1 });

    expect(state.gimbalTilt / DEG).toBeGreaterThan(-80);
  });
});

describe('gimbal dial', () => {
  it('tilts down with the dial down and up with the dial up', () => {
    const state = run(createFlyingState(50), 1, { gimbal: -1 });
    expect(state.gimbalTilt).toBeLessThan(-20 * DEG);

    const before = state.gimbalTilt;
    run(state, 0.5, { gimbal: 1 });
    expect(state.gimbalTilt).toBeGreaterThan(before);
  });

  it('reaches its full speed with the dial fully turned, and half of it half way', () => {
    // The speed closes in on its target without ever quite touching it, hence 3 decimals.
    const full = run(createFlyingState(50), 1, { gimbal: -1 });
    expect(full.gimbalRate).toBeCloseTo(-GIMBAL_TUNING.dialSpeed, 3);

    const half = run(createFlyingState(50), 1, { gimbal: -0.5 });
    expect(half.gimbalRate).toBeCloseTo(-GIMBAL_TUNING.dialSpeed / 2, 3);
  });

  it('never moves faster than the published 100° per second', () => {
    expect(GIMBAL_TUNING.dialSpeed).toBeLessThanOrEqual(AIR_2S_SPECS.gimbal.maxTiltSpeed);
    expect(GIMBAL_TUNING.shortcutSpeed).toBeLessThanOrEqual(AIR_2S_SPECS.gimbal.maxTiltSpeed);

    const state = createFlyingState(50);
    let fastest = 0;
    for (let i = 0; i < 3 * SIM_HZ; i++) {
      stepDrone(state, controls({ press: i < SIM_HZ ? ['c2'] : ['c1'] }), SIM_DT);
      fastest = Math.max(fastest, Math.abs(state.gimbalRate));
    }
    expect(fastest / DEG).toBeLessThanOrEqual(100 + 1e-9);
  });

  it('starts softly: it is not at full speed in the first instant', () => {
    const state = createFlyingState(50);
    stepDrone(state, controls({ gimbal: -1 }), SIM_DT);

    expect(Math.abs(state.gimbalRate)).toBeLessThan(GIMBAL_TUNING.dialSpeed * 0.2);
    expect(Math.abs(state.gimbalRate)).toBeGreaterThan(0);
  });

  it('stops softly: it glides a little after the dial is let go, then rests', () => {
    const state = run(createFlyingState(50), 1, { gimbal: -1 });
    const atRelease = state.gimbalTilt;

    stepDrone(state, controls(), SIM_DT);
    expect(Math.abs(state.gimbalRate)).toBeGreaterThan(GIMBAL_TUNING.dialSpeed * 0.5);

    run(state, 2);
    expect(state.gimbalRate).toBe(0); // a complete rest, not a slow creep
    expect(atRelease - state.gimbalTilt).toBeGreaterThan(1 * DEG);
    expect(atRelease - state.gimbalTilt).toBeLessThan(10 * DEG);
  });

  it('holds its tilt when the dial is centred', () => {
    const state = run(createFlyingState(50), 0.8, { gimbal: -1 });
    run(state, 3);
    const held = state.gimbalTilt;

    run(state, 30, { pitch: 1, roll: 0.5 }); // fly around: the tilt must not change

    expect(state.gimbalTilt).toBe(held);
  });

  it('works on the ground with the motors off', () => {
    const state = run(createDroneState(), 1, { gimbal: -1 });

    expect(state.phase).toBe('motorsOff');
    expect(state.gimbalTilt).toBeLessThan(-20 * DEG);
  });

  it('ignores the dial and the shortcuts when the controller is lost', () => {
    const state = run(createFlyingState(50), 3, { gimbal: -1, press: ['c2'], connected: false });

    expect(state.gimbalTilt).toBe(0);
  });

  it('copes with nonsense from the dial', () => {
    const state = run(createFlyingState(50), 1, { gimbal: Number.NaN });
    expect(state.gimbalTilt).toBe(0);

    run(state, 10, { gimbal: -50 });
    expect(state.gimbalTilt / DEG).toBeCloseTo(-90, 9);
  });
});

describe('gimbal shortcuts', () => {
  it('C2 looks straight down', () => {
    const state = tap(createFlyingState(50), 'c2');
    run(state, 3);

    expect(state.gimbalTilt).toBe(-90 * DEG);
    expect(state.gimbalRate).toBe(0);
    expect(state.gimbalMovingToTarget).toBe(false);
  });

  it('C1 recentres: back to level from anywhere', () => {
    const state = run(createFlyingState(50), 10, { gimbal: -1 });
    tap(state, 'c1');
    run(state, 3);

    expect(state.gimbalTilt).toBe(0);
    expect(state.gimbalRate).toBe(0);
  });

  it('recentres from above level too, when the upward setting is on', () => {
    const state = run(createFlyingState(50), 10, { gimbal: 1 }, true);
    run(state, 0.1, { press: ['c1'] }, true);
    run(state, 3, {}, true);

    expect(state.gimbalTilt).toBe(0);
  });

  it('is quick but not instant, and does not overshoot', () => {
    const state = tap(createFlyingState(50), 'c2');
    expect(state.gimbalTilt / DEG).toBeGreaterThan(-45); // 0.2 s in: still on its way

    let lowest = 0;
    let seconds = 0.2;
    while (state.gimbalMovingToTarget && seconds < 10) {
      stepDrone(state, controls(), SIM_DT);
      lowest = Math.min(lowest, state.gimbalTilt);
      seconds += SIM_DT;
    }
    expect(seconds).toBeGreaterThan(0.9);
    expect(seconds).toBeLessThan(4);
    expect(lowest).toBeGreaterThanOrEqual(-90 * DEG);
  });

  it('hands back to the pilot as soon as the dial is turned', () => {
    const state = tap(createFlyingState(50), 'c2');
    run(state, 0.3, { gimbal: 1 });
    run(state, 3);

    expect(state.gimbalMovingToTarget).toBe(false);
    expect(state.gimbalTilt / DEG).toBeGreaterThan(-60); // it never got to straight down
  });

  it('acts once per press, not again while the button is held', () => {
    const state = run(createFlyingState(50), 3, { press: ['c2'] });
    expect(state.gimbalTilt).toBe(-90 * DEG);

    run(state, 1, { press: ['c2'], gimbal: 1 }); // dial up while the button is still held
    run(state, 2, { press: ['c2'] });

    expect(state.gimbalTilt / DEG).toBeGreaterThan(-60);
  });

  it('does not disturb the flight', () => {
    const plain = run(createFlyingState(50), 5, { pitch: 1 });
    const withGimbal = run(createFlyingState(50), 5, { pitch: 1, gimbal: -1, press: ['c1'] });

    expect(withGimbal.z).toBe(plain.z);
    expect(withGimbal.vz).toBe(plain.vz);
    expect(withGimbal.phase).toBe('flying');
  });
});
