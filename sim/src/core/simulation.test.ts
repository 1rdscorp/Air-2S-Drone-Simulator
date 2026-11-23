import { describe, expect, it } from 'vitest';
import { GameLoop, SIM_DT } from './gameLoop';
import { MARKER_YAW_RATE, Simulation, type SimState } from './simulation';

describe('Simulation', () => {
  it('turns the marker at its fixed rate', () => {
    const sim = new Simulation();
    for (let i = 0; i < 120; i++) {
      sim.step(SIM_DT);
    }

    expect(sim.snapshot().markerYaw).toBeCloseTo(MARKER_YAW_RATE, 10);
  });

  it('blends between the previous and the current step for drawing', () => {
    const sim = new Simulation();
    sim.step(SIM_DT);
    sim.step(SIM_DT);
    const previous = MARKER_YAW_RATE * SIM_DT;
    const current = MARKER_YAW_RATE * SIM_DT * 2;

    expect(sim.interpolate(0).markerYaw).toBeCloseTo(previous, 12);
    expect(sim.interpolate(1).markerYaw).toBeCloseTo(current, 12);
    expect(sim.interpolate(0.5).markerYaw).toBeCloseTo((previous + current) / 2, 12);
  });

  it('does not change when it is drawn', () => {
    const sim = new Simulation();
    sim.step(SIM_DT);
    const before = sim.snapshot();

    for (const alpha of [0, 0.3, 1, -5, 7]) {
      sim.interpolate(alpha);
    }

    expect(sim.snapshot()).toEqual(before);
  });

  it('hands out snapshots that are independent copies', () => {
    const sim = new Simulation();
    const first = sim.snapshot();
    sim.step(SIM_DT);

    expect(first.markerYaw).toBe(0);
    expect(sim.snapshot().markerYaw).toBeGreaterThan(0);
  });

  it('reaches exactly the same state at any render rate', () => {
    const TARGET_TICK = 120 * 30;
    const stateAt = (displayHz: number): SimState => {
      const sim = new Simulation();
      const captured: { state: SimState | null } = { state: null };
      const loop = new GameLoop({
        step(dt, tick) {
          sim.step(dt);
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
