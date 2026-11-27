import { describe, expect, it } from 'vitest';
import { SIM_DT, SIM_HZ } from '../core/gameLoop';
import { Simulation } from '../core/simulation';
import { type ButtonId, type ControlFrame, neutralFrame, noButtonsPressed } from '../input/types';
import { boxAt, BoxWorld, type FlightWorld } from '../world/collision';
import { CRASH_CHOSEN, FLIGHT_PROCEDURE } from './air2s.config';
import {
  createDroneState,
  createFlyingState,
  type DroneState,
  heightAboveHome,
  horizontalSpeed,
} from './droneState';
import { stepDrone } from './flightModel';

type Input = Partial<Pick<ControlFrame, 'roll' | 'pitch' | 'yaw' | 'throttle' | 'mode'>> & {
  press?: ButtonId[];
};

function frame(input: Input = {}): ControlFrame {
  const { press = [], ...sticks } = input;
  const buttons = noButtonsPressed();
  for (const id of press) {
    buttons[id] = true;
  }
  return { ...neutralFrame(0, 'N', true), ...sticks, buttons };
}

/**
 * A small world: a wall 30 m north of the start, a platform to land on 20 m east, and a
 * start that is not at the origin and does not face north.
 */
const wall = boxAt(0, -30, 40, 2, 20);
const platform = boxAt(20, 0, 6, 6, 1.5);
const boxes = new BoxWorld([wall, platform]);
const world: FlightWorld = {
  heightAt: (x, z) => boxes.heightAt(x, z),
  spawn: { x: 0, z: 0, heading: 0 },
};

function run(
  state: DroneState,
  seconds: number,
  input: Input = {},
  in_: FlightWorld = world,
): DroneState {
  const controls = frame(input);
  for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
    stepDrone(state, controls, SIM_DT, undefined, in_);
  }
  return state;
}

/** Runs until `done` says so, and returns the seconds it took. */
function runUntil(state: DroneState, input: Input, done: (state: DroneState) => boolean): number {
  const controls = frame(input);
  for (let i = 0; i < 120 * SIM_HZ; i++) {
    if (done(state)) {
      return i * SIM_DT;
    }
    stepDrone(state, controls, SIM_DT, undefined, world);
  }
  throw new Error('never happened');
}

describe('ground height from the world', () => {
  const high: FlightWorld = { heightAt: () => 250, spawn: { x: 0, z: 0, heading: 0 } };

  it('stands on the ground wherever the ground is', () => {
    const state = run(createDroneState({ ground: 250 }), 2, {}, high);

    expect(state).toMatchObject({ y: 250, groundY: 250, onGround: true, phase: 'motorsOff' });
  });

  it('takes off to 1.2 m above the ground it stands on', () => {
    const state = createDroneState({ ground: 250 });
    run(state, 0.1, { press: ['takeoffLand'] }, high);
    run(state, 8, {}, high);

    expect(state.phase).toBe('flying');
    expect(state.y).toBeCloseTo(250 + FLIGHT_PROCEDURE.takeoffHeight, 2);
    expect(heightAboveHome(state)).toBeCloseTo(FLIGHT_PROCEDURE.takeoffHeight, 2);
  });

  it('lands back on that ground', () => {
    const state = createFlyingState(10, { ground: 250 });
    run(state, 0.1, { press: ['takeoffLand'] }, high);
    run(state, 20, {}, high);

    expect(state).toMatchObject({ y: 250, onGround: true, phase: 'motorsOff' });
  });

  it('keeps track of the surface below the aircraft', () => {
    const state = createFlyingState(10);
    expect(run(state, 0.1).groundY).toBe(0);

    state.x = 20; // over the platform
    state.holdX = 20;
    expect(run(state, 0.1).groundY).toBe(1.5);
  });

  it('shows the height above home, not above whatever is below', () => {
    const state = createFlyingState(10);
    state.x = 20;
    state.holdX = 20;
    run(state, 0.5);

    expect(state.groundY).toBe(1.5);
    expect(heightAboveHome(state)).toBeCloseTo(10, 3);
  });
});

describe('descending by hand', () => {
  it('slows down by itself close to the ground, so an ordinary landing is gentle', () => {
    const state = createFlyingState(60);
    let fastest = 0;
    let atTouchdown = 0;
    const controls = frame({ throttle: -1 });
    for (let i = 0; i < 60 * SIM_HZ && !state.onGround; i++) {
      fastest = Math.max(fastest, -state.vy);
      atTouchdown = -state.vy;
      stepDrone(state, controls, SIM_DT, undefined, world);
    }

    expect(fastest).toBeCloseTo(6, 1); // the full published speed high up
    expect(atTouchdown).toBeLessThan(1.5);
    expect(atTouchdown).toBeLessThan(CRASH_CHOSEN.maxTouchdownSpeed);
    expect(state.phase).toBe('idle');
    expect(state.roll).toBe(0);
  });

  it('is not slowed high above the ground', () => {
    const state = run(createFlyingState(200), 5, { throttle: -1 });

    expect(-state.vy).toBeCloseTo(6, 2);
  });

  it('slows above a roof as it does above the ground', () => {
    const state = createFlyingState(12);
    state.x = 20;
    state.holdX = 20;
    run(state, 20, { throttle: -1 });

    expect(state).toMatchObject({ y: 1.5, onGround: true, phase: 'motorsOff' });
    expect(state.roll).toBe(0);
  });
});

describe('landing on top of things', () => {
  it('sets down on a platform and stands on it', () => {
    const state = createFlyingState(8);
    state.x = 20;
    state.holdX = 20;
    run(state, 0.1, { press: ['takeoffLand'] });
    run(state, 15);

    expect(state).toMatchObject({ x: 20, y: 1.5, onGround: true, phase: 'motorsOff' });
  });

  it('takes off again from the platform to 1.2 m above it', () => {
    const state = createDroneState({ x: 20, ground: 1.5 });
    run(state, 0.1, { press: ['takeoffLand'] });
    run(state, 8);

    expect(state.y).toBeCloseTo(1.5 + FLIGHT_PROCEDURE.takeoffHeight, 2);
    expect(state.homeY).toBe(1.5);
    expect(heightAboveHome(state)).toBeCloseTo(FLIGHT_PROCEDURE.takeoffHeight, 2);
  });

  it('flies over the platform without touching it', () => {
    const state = createFlyingState(3);
    run(state, 6, { roll: 1 }); // east, over the platform at 3 m

    expect(state.x).toBeGreaterThan(30);
    expect(state.phase).toBe('flying');
  });
});

describe('crashing', () => {
  it('into a wall at speed: the motors stop and it falls where it hit', () => {
    const state = createFlyingState(10);
    const seconds = runUntil(state, { pitch: 1 }, (s) => s.phase === 'crashed');

    expect(seconds).toBeGreaterThan(2);
    expect(state.z).toBeGreaterThan(-29.1); // in front of the wall, not inside it
    expect(state.z).toBeLessThan(-28.5);
    expect(horizontalSpeed(state)).toBe(0);
    expect(state.onGround).toBe(false);

    run(state, 2);
    expect(state).toMatchObject({ phase: 'crashed', y: 0, onGround: true });
    expect(state.roll).toBe(CRASH_CHOSEN.restRoll); // lying tipped over
    expect(state.z).toBeGreaterThan(-29.1);
  });

  it('is put back at the start after a moment, motors off and upright', () => {
    const state = createFlyingState(10);
    runUntil(state, { pitch: 1 }, (s) => s.phase === 'crashed' && s.onGround);

    run(state, CRASH_CHOSEN.resetDelay - 0.1);
    expect(state.phase).toBe('crashed');

    run(state, 0.2);
    // Exactly as a new flight starts: nothing of the crashed one is left.
    expect(state).toEqual(createDroneState());
  });

  it('ignores the pilot while it lies there', () => {
    const state = createFlyingState(10);
    runUntil(state, { pitch: 1 }, (s) => s.phase === 'crashed' && s.onGround);
    const where = { x: state.x, z: state.z };

    run(state, 1, { pitch: -1, throttle: 1, press: ['takeoffLand'] });

    expect(state.phase).toBe('crashed');
    expect(state).toMatchObject(where);
  });

  it('does not take off by itself when the button is still held after being put back', () => {
    const state = createFlyingState(10);
    runUntil(state, { pitch: 1 }, (s) => s.phase === 'crashed' && s.onGround);

    run(state, CRASH_CHOSEN.resetDelay + 1, { press: ['takeoffLand'] });
    expect(state.phase).toBe('motorsOff');

    // Let go and press again: now it takes off.
    run(state, 0.1);
    run(state, 0.1, { press: ['takeoffLand'] });
    expect(state.phase).toBe('takingOff');
  });

  it('a slow nudge against a wall just stops the aircraft', () => {
    const state = createFlyingState(10);
    state.z = -28.6; // just in front of the wall, creeping forward in Cine mode
    state.holdZ = -28.6;
    run(state, 6, { pitch: 0.1, mode: 'C' });

    expect(state.phase).toBe('flying');
    expect(state.z).toBeGreaterThan(-29.01);
    expect(state.y).toBeCloseTo(10, 1);
  });

  it('into the ground while flying fast', () => {
    const state = createFlyingState(4);
    runUntil(state, { pitch: 1, throttle: -1 }, (s) => s.phase === 'crashed');

    expect(state).toMatchObject({ y: 0, onGround: true });
    expect(state.z).toBeLessThan(-5);
  });

  it('by falling: motors cut high up', () => {
    const state: DroneState = { ...createFlyingState(25), phase: 'motorsOff' };
    run(state, 4);

    expect(state).toMatchObject({ phase: 'crashed', y: 0, onGround: true });
  });

  it('but not by a fall from knee height', () => {
    const state: DroneState = { ...createFlyingState(0.3), phase: 'motorsOff' };
    run(state, 2);

    expect(state).toMatchObject({ phase: 'motorsOff', y: 0, onGround: true, roll: 0 });
  });

  it('onto a roof: it lies on the roof it fell on', () => {
    const state: DroneState = { ...createFlyingState(30), phase: 'motorsOff', x: 20 };
    run(state, 4);

    expect(state).toMatchObject({ phase: 'crashed', x: 20, y: 1.5, onGround: true });
  });

  it('a low kerb is not a wall: flying slowly onto it sets the aircraft down', () => {
    const kerb = new BoxWorld([boxAt(0, -3, 10, 2, 0.15)]);
    const street: FlightWorld = {
      heightAt: (x, z) => kerb.heightAt(x, z),
      spawn: { x: 0, z: 0, heading: 0 },
    };
    const state = createFlyingState(0.1);
    run(state, 8, { pitch: 0.15, mode: 'C' }, street);

    expect(state.phase).toBe('idle');
    expect(state.y).toBe(0.15);
  });
});

describe('Simulation in a world', () => {
  const start = { x: 12, z: -7, heading: Math.PI / 2 };
  const withStart: FlightWorld = { heightAt: (x, z) => boxes.heightAt(x, z), spawn: start };

  function runSim(sim: Simulation, seconds: number, input: Input = {}): void {
    for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
      sim.step(SIM_DT, frame(input));
    }
  }

  it("starts at the world's start, facing its way, motors off", () => {
    const sim = new Simulation();
    sim.setWorld(withStart);

    expect(sim.snapshot()).toMatchObject({
      phase: 'motorsOff',
      x: 12,
      z: -7,
      y: 0,
      heading: Math.PI / 2,
    });
    expect(sim.world).toBe(withStart);
  });

  it('can be put into a hover above the start', () => {
    const sim = new Simulation();
    sim.setWorld(withStart);
    sim.reset(15);

    expect(sim.snapshot()).toMatchObject({ phase: 'flying', x: 12, z: -7, y: 15, holdX: 12 });
  });

  it('flies into the wall, crashes, and is back at the start a few seconds later', () => {
    const sim = new Simulation();
    sim.setWorld(withStart);
    sim.reset(10);
    const events: string[] = [];

    for (let i = 0; i < 30 * SIM_HZ; i++) {
      // Facing east at the start; the wall is to the north, so fly left.
      sim.step(SIM_DT, frame({ roll: -1 }));
      sim.drainEvents((event) => events.push(event.type));
    }

    expect(events).toEqual(['crashed', 'backAtStart']);
    expect(sim.snapshot()).toMatchObject({ phase: 'motorsOff', x: 12, z: -7, y: 0, roll: 0 });
  });

  it('is never drawn half-way between the wreck and the start', () => {
    const sim = new Simulation();
    sim.setWorld(withStart);
    sim.reset(10);
    runSim(sim, 6, { roll: -1 });
    expect(sim.phase).toBe('crashed');

    for (let i = 0; i < 5 * SIM_HZ && sim.phase === 'crashed'; i++) {
      sim.step(SIM_DT, frame());
    }

    expect(sim.phase).toBe('motorsOff');
    expect(sim.interpolate(0.5)).toMatchObject({ x: 12, z: -7 });
  });

  it('flies the same flight every time in the same world', () => {
    const fly = (): DroneState => {
      const sim = new Simulation();
      sim.setWorld(withStart);
      sim.reset(6);
      for (let i = 0; i < 40 * SIM_HZ; i++) {
        sim.step(
          SIM_DT,
          frame({
            pitch: Math.sin(i * 0.004),
            roll: Math.cos(i * 0.003),
            yaw: 0.3,
            throttle: -0.1,
          }),
        );
      }
      return sim.snapshot();
    };

    expect(fly()).toEqual(fly());
  });
});
