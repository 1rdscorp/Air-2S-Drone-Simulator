import { describe, expect, it } from 'vitest';
import { createDroneState } from '../drone/droneState';
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

describe('Simulation', () => {
  it('starts with the aircraft hovering at rest', () => {
    expect(new Simulation().snapshot()).toEqual(createDroneState());
  });

  it('flies the aircraft with the controls it is given', () => {
    const sim = new Simulation();
    run(sim, 5, FORWARD);

    const state = sim.snapshot();
    expect(state.z).toBeLessThan(-20); // north
    expect(Math.hypot(state.vx, state.vz)).toBeGreaterThan(10);
  });

  it('stays where it is with centred sticks', () => {
    const sim = new Simulation();
    run(sim, 10, HOVER);

    expect(sim.snapshot()).toEqual(createDroneState());
  });

  it('blends between the previous and the current step for drawing', () => {
    const sim = new Simulation();
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
    const sim = new Simulation();
    run(sim, 1, FORWARD);
    const before = sim.snapshot();

    for (const alpha of [0, 0.3, 1, -5, 7]) {
      sim.interpolate(alpha);
    }

    expect(sim.snapshot()).toEqual(before);
  });

  it('hands out snapshots that are independent copies', () => {
    const sim = new Simulation();
    const first = sim.snapshot();
    run(sim, 1, FORWARD);

    expect(first).toEqual(createDroneState());
    expect(sim.snapshot()).not.toEqual(first);
  });

  it('can be put back to the start', () => {
    const sim = new Simulation();
    run(sim, 5, { ...FORWARD, yaw: 1, throttle: 1 });

    sim.reset();

    expect(sim.snapshot()).toEqual(createDroneState());
    expect(sim.interpolate(0)).toMatchObject({ x: 0, z: 0, heading: 0 });
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
      const sim = new Simulation();
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
