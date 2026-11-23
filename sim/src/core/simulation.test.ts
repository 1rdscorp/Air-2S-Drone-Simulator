import { describe, expect, it } from 'vitest';
import { createDroneState, createFlyingState } from '../drone/droneState';
import { type ControlFrame, neutralFrame } from '../input/types';
import { GameLoop, SIM_DT, SIM_HZ } from './gameLoop';
import { Simulation, type SimState } from './simulation';

const HOVER = neutralFrame(0, 'N', true);
const FORWARD: ControlFrame = { ...HOVER, pitch: 1 };

function run(sim: Simulation, seconds: number, controls: ControlFrame): void {
  for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
    sim.step(SIM_DT, controls);
  }
}

/** A simulation with the aircraft already hovering, 50 m up. */
function airborne(): Simulation {
  const sim = new Simulation();
  sim.reset(50);
  return sim;
}

describe('Simulation', () => {
  it('starts with the aircraft on the ground, motors off', () => {
    expect(new Simulation().snapshot()).toEqual(createDroneState());
  });

  it('does not move on the ground until the motors are started', () => {
    const sim = new Simulation();
    run(sim, 5, { ...FORWARD, throttle: 1 });

    expect(sim.snapshot()).toEqual(createDroneState());
  });

  it('takes off when the take-off button is pressed', () => {
    const sim = new Simulation();
    run(sim, 0.1, { ...HOVER, buttons: { ...HOVER.buttons, takeoffLand: true } });
    run(sim, 8, HOVER);

    expect(sim.snapshot().phase).toBe('flying');
    expect(sim.snapshot().y).toBeGreaterThan(1);
  });

  it('flies the aircraft with the controls it is given', () => {
    const sim = airborne();
    run(sim, 5, FORWARD);

    const state = sim.snapshot();
    expect(state.z).toBeLessThan(-20); // north
    expect(Math.hypot(state.vx, state.vz)).toBeGreaterThan(10);
  });

  it('stays where it is with centred sticks', () => {
    const sim = airborne();
    run(sim, 10, HOVER);

    // Nothing but the flight clock has moved.
    expect(sim.snapshot()).toEqual({
      ...createFlyingState(50),
      flightSeconds: expect.closeTo(10, 6) as number,
    });
  });

  it('blends between the previous and the current step for drawing', () => {
    const sim = airborne();
    run(sim, 2, FORWARD);
    const before = sim.snapshot();
    sim.step(SIM_DT, FORWARD);
    const after = sim.snapshot();

    expect(sim.interpolate(0).z).toBeCloseTo(before.z, 12);
    expect(sim.interpolate(1).z).toBeCloseTo(after.z, 12);
    expect(sim.interpolate(0.5).z).toBeCloseTo((before.z + after.z) / 2, 12);
    expect(sim.interpolate(0.5).pitch).toBeCloseTo((before.pitch + after.pitch) / 2, 12);
  });

  it('does not change when it is drawn', () => {
    const sim = airborne();
    run(sim, 1, FORWARD);
    const before = sim.snapshot();

    for (const alpha of [0, 0.3, 1, -5, 7]) {
      sim.interpolate(alpha);
    }

    expect(sim.snapshot()).toEqual(before);
  });

  it('hands out snapshots that are independent copies', () => {
    const sim = airborne();
    const first = sim.snapshot();
    run(sim, 1, FORWARD);

    expect(first).toEqual(createFlyingState(50));
    expect(sim.snapshot()).not.toEqual(first);
  });

  it('lets the display read the current state without copying it', () => {
    const sim = airborne();
    const live = sim.state;
    run(sim, 1, FORWARD);

    expect(sim.state).toBe(live);
    expect(live).toEqual(sim.snapshot());
    expect(sim.snapshot()).not.toBe(live);
  });

  it('keeps the flight clock and the home point', () => {
    const sim = airborne();
    run(sim, 6, FORWARD);

    const state = sim.snapshot();
    expect(state.flightSeconds).toBeCloseTo(6, 6);
    expect(state.homeSet).toBe(true);
    expect([state.homeX, state.homeZ]).toEqual([0, 0]);
  });

  it('can be put back to the start: on the ground, motors off', () => {
    const sim = airborne();
    run(sim, 5, { ...FORWARD, yaw: 1, throttle: 1 });

    sim.reset();

    expect(sim.snapshot()).toEqual(createDroneState());
    expect(sim.interpolate(0)).toMatchObject({ x: 0, y: 0, z: 0, heading: 0 });
  });

  it('can be put straight into a hover at a chosen height', () => {
    const sim = new Simulation();
    sim.reset(120);

    expect(sim.snapshot()).toEqual(createFlyingState(120));
    expect(sim.interpolate(0.5).y).toBe(120);
  });

  it('moves the camera gimbal with the dial, and blends it for drawing', () => {
    const sim = airborne();
    run(sim, 1, { ...HOVER, gimbal: -1 });
    const before = sim.snapshot().gimbalTilt;
    sim.step(SIM_DT, { ...HOVER, gimbal: -1 });
    const after = sim.snapshot().gimbalTilt;

    expect(after).toBeLessThan(before);
    expect(before).toBeLessThan(-0.3);
    expect(sim.interpolate(0.5).gimbalTilt).toBeCloseTo((before + after) / 2, 12);
  });

  it('lets the gimbal look above level only with the upward setting', () => {
    const plain = airborne();
    run(plain, 3, { ...HOVER, gimbal: 1 });
    expect(plain.snapshot().gimbalTilt).toBe(0);

    const upward = new Simulation({ gimbalUpward: true });
    upward.reset(50);
    run(upward, 3, { ...HOVER, gimbal: 1 });
    expect(upward.snapshot().gimbalTilt).toBeGreaterThan(0.4);
  });

  it('reaches exactly the same state at any render rate', () => {
    const TARGET_TICK = SIM_HZ * 30;
    const script = (tick: number): ControlFrame => ({
      ...HOVER,
      pitch: Math.sin(tick * 0.003),
      roll: Math.cos(tick * 0.0021) * 0.6,
      yaw: Math.sin(tick * 0.0013),
      throttle: tick % 900 < 200 ? 0.4 : 0,
    });

    const stateAt = (displayHz: number): SimState => {
      const sim = airborne();
      const captured: { state: SimState | null } = { state: null };
      const loop = new GameLoop({
        step(dt, tick) {
          sim.step(dt, script(tick));
          if (tick + 1 === TARGET_TICK) {
            captured.state = sim.snapshot();
          }
        },
        render(alpha) {
          sim.interpolate(alpha);
        },
      });
      while (captured.state === null) {
        loop.frame(1 / displayHz);
      }
      return captured.state;
    };

    const reference = stateAt(60);
    for (const hz of [30, 144, 240]) {
      expect(stateAt(hz), `${hz} Hz display`).toEqual(reference);
    }
  });
});
