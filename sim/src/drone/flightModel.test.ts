import { describe, expect, it } from 'vitest';
import { GameLoop, SIM_DT, SIM_HZ } from '../core/gameLoop';
import { type ControlFrame, type FlightMode, neutralFrame } from '../input/types';
import { DRAG, GRAVITY, MODE_LIMITS } from './air2s.config';
import {
  createDroneState,
  createFlyingState,
  type DroneState,
  horizontalSpeed,
} from './droneState';
import { stepDrone } from './flightModel';

const DEG = Math.PI / 180;

type Sticks = Partial<
  Pick<ControlFrame, 'roll' | 'pitch' | 'yaw' | 'throttle' | 'connected' | 'mode'>
>;

function controls(sticks: Sticks = {}): ControlFrame {
  return { ...neutralFrame(0, 'N', true), ...sticks };
}

/** Flies for `seconds` with the sticks held where given. */
function fly(state: DroneState, seconds: number, sticks: Sticks = {}): DroneState {
  const frame = controls(sticks);
  for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
    stepDrone(state, frame, SIM_DT);
  }
  return state;
}

/** A drone hovering high up, so nothing in the test touches the ground. */
function highUp(): DroneState {
  return createFlyingState(500);
}

describe('Normal mode: published speeds', () => {
  it('reaches a top speed of 15 m/s and stays there', () => {
    const state = fly(highUp(), 20, { pitch: 1 });
    expect(horizontalSpeed(state)).toBeCloseTo(15, 2);

    fly(state, 10, { pitch: 1 });
    expect(horizontalSpeed(state)).toBeCloseTo(15, 3);
  });

  it('never goes noticeably above 15 m/s on the way there', () => {
    const state = highUp();
    let fastest = 0;
    for (let i = 0; i < 30 * SIM_HZ; i++) {
      stepDrone(state, controls({ pitch: 1 }), SIM_DT);
      fastest = Math.max(fastest, horizontalSpeed(state));
    }

    expect(fastest).toBeLessThan(15.05);
  });

  it('reaches 15 m/s in every direction, and not more with both sticks fully over', () => {
    const cases: Sticks[] = [
      { pitch: -1 },
      { roll: 1 },
      { roll: -1 },
      { pitch: 1, roll: 1 },
      { pitch: -1, roll: -1 },
    ];
    for (const sticks of cases) {
      const state = fly(highUp(), 20, sticks);
      expect(horizontalSpeed(state), JSON.stringify(sticks)).toBeCloseTo(15, 2);
    }
  });

  it('flies at half speed with the stick half way', () => {
    const state = fly(highUp(), 20, { pitch: 0.5 });

    expect(horizontalSpeed(state)).toBeCloseTo(7.5, 2);
  });

  it('climbs at 6 m/s', () => {
    const state = fly(highUp(), 10, { throttle: 1 });

    expect(state.vy).toBeCloseTo(6, 3);
  });

  it('descends at 6 m/s', () => {
    const state = fly(highUp(), 10, { throttle: -1 });

    expect(state.vy).toBeCloseTo(-6, 3);
  });

  it('turns at 90 degrees per second', () => {
    const right = fly(highUp(), 5, { yaw: 1 });
    expect(right.yawRate / DEG).toBeCloseTo(90, 3);

    const left = fly(highUp(), 5, { yaw: -1 });
    expect(left.yawRate / DEG).toBeCloseTo(-90, 3);
  });

  it('turns through close to 900 degrees in 10 seconds', () => {
    const state = fly(highUp(), 10, { yaw: 1 });

    // A little less than 900 because the turn takes a moment to get going.
    expect(state.heading / DEG).toBeGreaterThan(870);
    expect(state.heading / DEG).toBeLessThan(900);
  });
});

describe('hover', () => {
  it('does not move at all when started at rest with the sticks centred', () => {
    const state = fly(createFlyingState(2), 60);

    expect(state).toEqual(createFlyingState(2));
  });

  it('does not drift after flying and letting go of the sticks', () => {
    const state = highUp();
    fly(state, 8, { pitch: 1, roll: 0.4, yaw: 0.5, throttle: 0.6 });
    fly(state, 15); // let it brake and settle
    const settled = { ...state };

    fly(state, 60);

    expect(Math.hypot(state.x - settled.x, state.z - settled.z)).toBeLessThan(0.001);
    expect(Math.abs(state.y - settled.y)).toBeLessThan(0.001);
    expect(Math.abs(state.heading - settled.heading)).toBeLessThan(1e-6);
    expect(horizontalSpeed(state)).toBeLessThan(1e-4);
    expect(Math.abs(state.vy)).toBeLessThan(1e-4);
  });

  it('levels out and stops turning in the hover', () => {
    const state = highUp();
    fly(state, 6, { pitch: 1, yaw: 1 });
    fly(state, 15);

    expect(Math.abs(state.pitch)).toBeLessThan(1e-4);
    expect(Math.abs(state.roll)).toBeLessThan(1e-4);
    expect(Math.abs(state.yawRate)).toBeLessThan(1e-6);
    expect(state.holdActive).toBe(true);
    expect(state.altitudeHoldActive).toBe(true);
  });

  it('comes back to its hover point if something moves it', () => {
    const state = highUp();
    fly(state, 2); // hover point is fixed at the start

    state.x += 3; // as if a gust had pushed it
    state.y -= 2;
    fly(state, 20);

    expect(state.x).toBeCloseTo(0, 3);
    expect(state.z).toBeCloseTo(0, 3);
    expect(state.y).toBeCloseTo(500, 3);
  });

  it('keeps its height while flying fast', () => {
    const state = fly(highUp(), 20, { pitch: 1, roll: 0.5 });

    expect(state.y).toBe(500);
  });
});

describe('braking', () => {
  /** From full speed, lets go of the sticks and measures how the aircraft stops. */
  function stopFromFullSpeed(): { seconds: number; metres: number } {
    const state = fly(highUp(), 20, { pitch: 1 });
    const startZ = state.z;
    let ticks = 0;
    while (horizontalSpeed(state) > 0.1) {
      stepDrone(state, controls(), SIM_DT);
      ticks++;
      if (ticks > 60 * SIM_HZ) {
        throw new Error('the aircraft never stopped');
      }
    }
    return { seconds: ticks * SIM_DT, metres: Math.abs(state.z - startZ) };
  }

  it('stops from 15 m/s within a few seconds and a few tens of metres', () => {
    const { seconds, metres } = stopFromFullSpeed();

    expect(seconds).toBeLessThan(4.5);
    expect(metres).toBeLessThan(30);
  });

  it('does not stop unrealistically fast', () => {
    const { seconds, metres } = stopFromFullSpeed();

    expect(seconds).toBeGreaterThan(1.5);
    expect(metres).toBeGreaterThan(10);
  });

  it('tilts back to brake, and does not swing back the other way afterwards', () => {
    const state = fly(highUp(), 20, { pitch: 1 });
    const northmost = { z: state.z };
    let tiltedBack = false;
    for (let i = 0; i < 15 * SIM_HZ; i++) {
      stepDrone(state, controls(), SIM_DT);
      tiltedBack ||= state.pitch < -10 * DEG;
      northmost.z = Math.min(northmost.z, state.z);
    }

    expect(tiltedBack).toBe(true);
    // Ends within a few centimetres of the furthest point it reached.
    expect(Math.abs(state.z - northmost.z)).toBeLessThan(0.1);
  });
});

describe('tilt', () => {
  it('leans forward to fly forward, and holds the tilt that balances the air drag', () => {
    const state = fly(highUp(), 20, { pitch: 1 });
    const balance = Math.atan((DRAG * 15 * 15) / GRAVITY);

    expect(state.pitch).toBeCloseTo(balance, 4);
    expect(state.pitch / DEG).toBeGreaterThan(15);
    expect(state.roll).toBeCloseTo(0, 6);
  });

  it('leans right to fly right, and back to fly backwards', () => {
    expect(fly(highUp(), 5, { roll: 1 }).roll).toBeGreaterThan(10 * DEG);
    expect(fly(highUp(), 5, { roll: -1 }).roll).toBeLessThan(-10 * DEG);
    expect(fly(highUp(), 5, { pitch: -1 }).pitch).toBeLessThan(-10 * DEG);
  });

  it('never tilts further than the published 25 degrees', () => {
    const state = highUp();
    let steepest = 0;
    const moves: Sticks[] = [
      { pitch: 1 },
      { pitch: -1 },
      { roll: 1, pitch: 1 },
      { roll: -1, pitch: -1 },
      {},
      { roll: 1, yaw: 1 },
    ];
    for (const sticks of moves) {
      for (let i = 0; i < 4 * SIM_HZ; i++) {
        stepDrone(state, controls(sticks), SIM_DT);
        const tilt = Math.atan(Math.hypot(Math.tan(state.pitch), Math.tan(state.roll)));
        steepest = Math.max(steepest, tilt);
      }
    }

    expect(steepest / DEG).toBeGreaterThan(20);
    expect(steepest).toBeLessThanOrEqual(MODE_LIMITS.N.maxTilt + 0.5 * DEG);
  });

  it('takes a moment to tilt: it is not instant', () => {
    const state = highUp();
    stepDrone(state, controls({ pitch: 1 }), SIM_DT);
    const afterOneStep = state.pitch;
    fly(state, 0.5, { pitch: 1 });

    expect(afterOneStep).toBeLessThan(1 * DEG);
    expect(state.pitch).toBeGreaterThan(20 * DEG);
  });
});

describe('directions', () => {
  it('flies north (towards -z) with the stick forward when facing north', () => {
    const state = fly(highUp(), 5, { pitch: 1 });

    expect(state.z).toBeLessThan(-20);
    expect(state.x).toBeCloseTo(0, 6);
  });

  it('flies east (towards +x) with the stick to the right when facing north', () => {
    const state = fly(highUp(), 5, { roll: 1 });

    expect(state.x).toBeGreaterThan(20);
    expect(state.z).toBeCloseTo(0, 6);
  });

  it('flies where the nose points: forward is east after a quarter turn to the right', () => {
    const state = highUp();
    state.heading = 90 * DEG;
    fly(state, 5, { pitch: 1 });

    expect(state.x).toBeGreaterThan(20);
    expect(state.z).toBeCloseTo(0, 6);
  });

  it('turns right with positive yaw and climbs with positive throttle', () => {
    expect(fly(highUp(), 1, { yaw: 1 }).heading).toBeGreaterThan(0);
    expect(fly(highUp(), 1, { throttle: 1 }).y).toBeGreaterThan(500);
    expect(fly(highUp(), 1, { throttle: -1 }).y).toBeLessThan(500);
  });

  it('keeps flying along the nose while turning gently: it flies a circle', () => {
    const state = fly(highUp(), 40, { pitch: 0.3, yaw: 0.3 });

    // 4.5 m/s at 27 degrees per second is a circle of about 9.5 m radius.
    expect(Math.hypot(state.x, state.z)).toBeLessThan(22);
    expect(horizontalSpeed(state)).toBeCloseTo(4.5, 0);
  });

  it('cannot hold full speed in a tight turn: the tilt limit makes it slow down', () => {
    // Half speed while turning at 45 degrees per second would need more than 25 degrees of tilt.
    const state = fly(highUp(), 40, { pitch: 0.5, yaw: 0.5 });

    expect(horizontalSpeed(state)).toBeLessThan(7);
    expect(horizontalSpeed(state)).toBeGreaterThan(4);
  });
});

describe('ground', () => {
  it('stops on the ground instead of sinking through it', () => {
    const state = fly(createFlyingState(2), 2, { throttle: -1, pitch: 1 });

    expect(state.y).toBe(0);
    expect(state.onGround).toBe(true);
    expect(state.vy).toBe(0);
    expect(horizontalSpeed(state)).toBe(0);
    expect(state.pitch).toBe(0);
  });

  it('stays put on the ground whatever the steering sticks do', () => {
    const state = fly(createFlyingState(2), 2, { throttle: -1 });

    fly(state, 5, { pitch: 1, roll: -1, yaw: 1 });

    expect(state).toMatchObject({ phase: 'idle', x: 0, y: 0, z: 0, heading: 0, onGround: true });
    expect(horizontalSpeed(state)).toBe(0);
  });

  it('lifts off again with throttle up while the motors are still running', () => {
    const state = fly(createFlyingState(2), 2, { throttle: -1 });

    fly(state, 2, { throttle: 1 });

    expect(state.onGround).toBe(false);
    expect(state.y).toBeGreaterThan(5);
  });

  it('never goes below the ground during a long flight of random stick movements', () => {
    const state = createDroneState();
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return (seed / 4294967296) * 2 - 1;
    };
    const modes: FlightMode[] = ['C', 'N', 'S'];
    let lowest = Number.POSITIVE_INFINITY;
    let secondsInTheAir = 0;
    for (let second = 0; second < 900; second++) {
      const frame = controls({
        roll: random(),
        pitch: random(),
        yaw: random(),
        throttle: random(),
        mode: modes[second % 3] ?? 'N',
      });
      // Now and then press the take-off / landing button, so the flight keeps going.
      frame.buttons.takeoffLand = second % 11 === 0;
      for (let i = 0; i < SIM_HZ; i++) {
        stepDrone(state, frame, SIM_DT);
        lowest = Math.min(lowest, state.y);
      }
      secondsInTheAir += state.onGround ? 0 : 1;
    }

    expect(lowest).toBeGreaterThanOrEqual(0);
    expect(secondsInTheAir).toBeGreaterThan(300);
    for (const value of Object.values(state)) {
      if (typeof value === 'number') {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
    expect(horizontalSpeed(state)).toBeLessThan(19.5);
  });
});

describe('flight modes', () => {
  const MODES: FlightMode[] = ['C', 'N', 'S'];

  it('each mode reaches its own top speed: Cine 5, Normal 15, Sport 19 m/s', () => {
    const expected = { C: 5, N: 15, S: 19 };
    for (const mode of MODES) {
      const state = fly(highUp(), 40, { pitch: 1, mode });

      expect(horizontalSpeed(state), mode).toBeCloseTo(expected[mode], 2);
    }
  });

  it('no mode goes noticeably above its top speed on the way there', () => {
    for (const mode of MODES) {
      const state = highUp();
      let fastest = 0;
      for (let i = 0; i < 40 * SIM_HZ; i++) {
        stepDrone(state, controls({ pitch: 1, mode }), SIM_DT);
        fastest = Math.max(fastest, horizontalSpeed(state));
      }

      expect(fastest, mode).toBeLessThan(MODE_LIMITS[mode].maxSpeed + 0.05);
    }
  });

  it('each mode turns at its own rate: 60, 90 and 250 degrees per second', () => {
    const expected = { C: 60, N: 90, S: 250 };
    for (const mode of MODES) {
      const state = fly(highUp(), 6, { yaw: 1, mode });

      expect(state.yawRate / DEG, mode).toBeCloseTo(expected[mode], 2);
    }
  });

  it('Normal and Sport climb and descend at 6 m/s, Cine more slowly', () => {
    for (const mode of MODES) {
      const up = fly(highUp(), 10, { throttle: 1, mode });
      const down = fly(highUp(), 10, { throttle: -1, mode });

      expect(up.vy, mode).toBeCloseTo(MODE_LIMITS[mode].maxAscent, 3);
      expect(down.vy, mode).toBeCloseTo(-MODE_LIMITS[mode].maxDescent, 3);
    }
    expect(MODE_LIMITS.N.maxAscent).toBe(6);
    expect(MODE_LIMITS.S.maxAscent).toBe(6);
    expect(MODE_LIMITS.C.maxAscent).toBeLessThan(6);
  });

  it('never tilts further than the limit of the mode', () => {
    for (const mode of MODES) {
      const state = highUp();
      let steepest = 0;
      for (const sticks of [{ pitch: 1 }, { pitch: -1, roll: 1 }, {}, { roll: -1 }]) {
        for (let i = 0; i < 5 * SIM_HZ; i++) {
          stepDrone(state, controls({ ...sticks, mode }), SIM_DT);
          const tilt = Math.atan(Math.hypot(Math.tan(state.pitch), Math.tan(state.roll)));
          steepest = Math.max(steepest, tilt);
        }
      }

      expect(steepest, mode).toBeLessThanOrEqual(MODE_LIMITS[mode].maxTilt + 0.5 * DEG);
      expect(steepest, mode).toBeGreaterThan(MODE_LIMITS[mode].maxTilt * 0.8);
    }
  });

  it('Sport gets going faster than Normal, and Cine more gently', () => {
    const speedAfter = (mode: FlightMode): number =>
      horizontalSpeed(fly(highUp(), 1.5, { pitch: 1, mode }));

    expect(speedAfter('S')).toBeGreaterThan(speedAfter('N'));
    expect(speedAfter('N')).toBeGreaterThan(speedAfter('C'));
  });

  it('takes effect at once when the mode is changed in flight', () => {
    const state = fly(highUp(), 40, { pitch: 1, mode: 'S' });
    expect(horizontalSpeed(state)).toBeCloseTo(19, 1);

    fly(state, 40, { pitch: 1, mode: 'C' });
    expect(horizontalSpeed(state)).toBeCloseTo(5, 2);

    fly(state, 40, { pitch: 1, mode: 'N' });
    expect(horizontalSpeed(state)).toBeCloseTo(15, 2);
  });

  it('holds the hover in every mode', () => {
    for (const mode of MODES) {
      const state = highUp();
      fly(state, 10, { pitch: 1, roll: 0.5, throttle: 0.5, mode });
      fly(state, 25, { mode });
      const settled = { ...state };
      fly(state, 60, { mode });

      expect(Math.hypot(state.x - settled.x, state.z - settled.z), mode).toBeLessThan(0.001);
      expect(Math.abs(state.y - settled.y), mode).toBeLessThan(0.001);
    }
  });
});

describe('robustness', () => {
  it('treats a lost controller as centred sticks', () => {
    const state = fly(highUp(), 10, { pitch: 1, throttle: 1, yaw: 1, connected: false });

    expect(state).toEqual(highUp());
  });

  it('limits stick values outside -1 to 1 and ignores nonsense', () => {
    const tooMuch = fly(highUp(), 20, { pitch: 7 });
    expect(horizontalSpeed(tooMuch)).toBeCloseTo(15, 2);

    const nonsense = fly(highUp(), 5, { pitch: Number.NaN, throttle: Number.POSITIVE_INFINITY });
    expect(nonsense).toEqual(highUp());
  });

  it('gives exactly the same flight at any display frame rate', () => {
    const script = (tick: number): Sticks => ({
      pitch: Math.sin(tick * 0.004),
      roll: Math.cos(tick * 0.0031) * 0.7,
      yaw: Math.sin(tick * 0.0017),
      throttle: tick % 1200 < 300 ? 0.5 : -0.1,
    });
    const TARGET_TICK = 40 * SIM_HZ;

    const flightAt = (displayHz: number): DroneState => {
      const state = highUp();
      const captured: { state: DroneState | null } = { state: null };
      const loop = new GameLoop({
        step(dt, tick) {
          stepDrone(state, controls(script(tick)), dt);
          if (tick + 1 === TARGET_TICK) {
            captured.state = { ...state };
          }
        },
        render() {},
      });
      while (captured.state === null) {
        loop.frame(1 / displayHz);
      }
      return captured.state;
    };

    const reference = flightAt(60);
    for (const hz of [24, 30, 144, 240]) {
      expect(flightAt(hz), `${hz} Hz display`).toEqual(reference);
    }
  });
});
