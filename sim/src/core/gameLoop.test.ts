import { describe, expect, it } from 'vitest';
import { GameLoop, MAX_FRAME_SECONDS, MAX_TIME_SCALE, MIN_TIME_SCALE, SIM_DT } from './gameLoop';

/**
 * A small system that is sensitive to step size: a damped spring pushed by an input force.
 * If it were stepped with the display frame time, 30 Hz and 60 Hz would give different results.
 */
interface Spring {
  position: number;
  velocity: number;
}

function stepSpring(state: Spring, dt: number, force: number): void {
  const acceleration = force - 40 * state.position - 1.5 * state.velocity;
  state.velocity += acceleration * dt;
  state.position += state.velocity * dt;
}

/** The "pilot input": a fixed script that depends only on the tick number. */
function scriptedForce(tick: number): number {
  return Math.sin(tick * 0.031) * 8 + (tick % 240 < 60 ? 5 : -2);
}

/** Runs the loop with the given display frame times and returns the state after `targetTick` steps. */
function stateAtTick(frameSeconds: (frameIndex: number) => number, targetTick: number): Spring {
  const state: Spring = { position: 0, velocity: 0 };
  const captured: { state: Spring | null } = { state: null };

  const loop = new GameLoop({
    step(dt, tick) {
      stepSpring(state, dt, scriptedForce(tick));
      if (tick + 1 === targetTick) {
        captured.state = { ...state };
      }
    },
    render() {},
  });

  for (let frame = 0; captured.state === null; frame++) {
    loop.frame(frameSeconds(frame));
    if (frame > 1_000_000) {
      throw new Error('target tick was never reached');
    }
  }
  return captured.state;
}

/** Repeatable pseudo-random frame times between 4 ms and 40 ms. */
function irregularFrames(seed: number): (frameIndex: number) => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return 0.004 + (value / 4294967296) * 0.036;
  };
}

describe('GameLoop determinism', () => {
  const TARGET_TICK = 120 * 20; // 20 simulated seconds

  it('gives exactly the same state at any render rate', () => {
    const reference = stateAtTick(() => 1 / 60, TARGET_TICK);

    for (const hz of [24, 30, 50, 60, 75, 90, 120, 144, 165, 240, 360]) {
      expect(
        stateAtTick(() => 1 / hz, TARGET_TICK),
        `${hz} Hz display`,
      ).toEqual(reference);
    }
  });

  it('gives exactly the same state with irregular frame times', () => {
    const reference = stateAtTick(() => 1 / 60, TARGET_TICK);

    for (const seed of [1, 2, 3, 4, 5]) {
      expect(stateAtTick(irregularFrames(seed), TARGET_TICK), `seed ${seed}`).toEqual(reference);
    }
  });

  it('gives exactly the same state when frames stall and get cut', () => {
    const reference = stateAtTick(() => 1 / 60, TARGET_TICK);
    const withStalls = (frame: number): number => (frame % 50 === 49 ? 3 : 1 / 60);

    expect(stateAtTick(withStalls, TARGET_TICK)).toEqual(reference);
  });

  it('would not be the same if the simulation used the display frame time (control test)', () => {
    // Proves the spring really is sensitive to step size, so the tests above mean something.
    const HALF_A_SECOND = 0.5;
    const runVariableStep = (hz: number): Spring => {
      const state: Spring = { position: 0, velocity: 0 };
      for (let i = 0; i < hz * HALF_A_SECOND; i++) {
        stepSpring(state, 1 / hz, 5);
      }
      return state;
    };

    const difference = Math.abs(runVariableStep(30).position - runVariableStep(120).position);
    // The fixed-step results above are equal to the last bit; here the gap is about 0.0007.
    expect(difference).toBeGreaterThan(1e-4);
  });
});

describe('GameLoop stepping', () => {
  function countingLoop(): { loop: GameLoop; steps: () => number; alphas: number[] } {
    let steps = 0;
    const alphas: number[] = [];
    const loop = new GameLoop({
      step: () => {
        steps++;
      },
      render: (alpha) => {
        alphas.push(alpha);
      },
    });
    return { loop, steps: () => steps, alphas };
  }

  it('always steps by SIM_DT and numbers the ticks from 0', () => {
    const seen: { dt: number; tick: number }[] = [];
    const loop = new GameLoop({ step: (dt, tick) => seen.push({ dt, tick }), render() {} });

    loop.frame(0.1);

    expect(seen.length).toBe(12);
    expect(seen.every((entry) => entry.dt === SIM_DT)).toBe(true);
    expect(seen.map((entry) => entry.tick)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('runs about 120 steps per second of real time', () => {
    for (const hz of [30, 60, 144]) {
      const { loop, steps } = countingLoop();
      for (let i = 0; i < hz * 10; i++) {
        loop.frame(1 / hz);
      }
      expect(Math.abs(steps() - 1200), `${hz} Hz display`).toBeLessThanOrEqual(1);
    }
  });

  it('reports simulated time from the tick count', () => {
    const { loop } = countingLoop();
    loop.advance(600);

    expect(loop.tick).toBe(600);
    expect(loop.simTime).toBe(5);
  });

  it('draws once per frame with alpha between 0 and 1', () => {
    const { loop, alphas } = countingLoop();
    for (let i = 0; i < 500; i++) {
      loop.frame(1 / 144);
    }

    expect(alphas.length).toBe(500);
    expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...alphas)).toBeLessThan(1);
  });

  it('cuts a very long frame instead of catching up', () => {
    const { loop, steps } = countingLoop();
    loop.frame(10);

    expect(steps()).toBe(Math.round(MAX_FRAME_SECONDS / SIM_DT));
  });

  it('ignores negative and invalid frame times', () => {
    const { loop, steps } = countingLoop();
    loop.frame(-1);
    loop.frame(Number.NaN);
    loop.frame(Number.POSITIVE_INFINITY);

    expect(steps()).toBe(0);
  });
});

describe('GameLoop pause and time scale', () => {
  function countingLoop(): { loop: GameLoop; steps: () => number; renders: () => number } {
    let steps = 0;
    let renders = 0;
    const loop = new GameLoop({
      step: () => {
        steps++;
      },
      render: () => {
        renders++;
      },
    });
    return { loop, steps: () => steps, renders: () => renders };
  }

  it('does not step while paused but keeps drawing', () => {
    const { loop, steps, renders } = countingLoop();
    loop.paused = true;
    for (let i = 0; i < 60; i++) {
      loop.frame(1 / 60);
    }

    expect(steps()).toBe(0);
    expect(renders()).toBe(60);
  });

  it('does not jump ahead after a pause', () => {
    const { loop, steps } = countingLoop();
    loop.frame(0.1);
    const before = steps();

    loop.paused = true;
    for (let i = 0; i < 600; i++) {
      loop.frame(1 / 60);
    }
    loop.paused = false;
    loop.frame(1 / 60);

    expect(steps() - before).toBeLessThanOrEqual(3);
  });

  it('can advance an exact number of steps while paused, and then draws the newest state', () => {
    const alphas: number[] = [];
    let steps = 0;
    const loop = new GameLoop({
      step: () => {
        steps++;
      },
      render: (alpha) => {
        alphas.push(alpha);
      },
    });
    loop.paused = true;

    loop.advance(7);
    loop.frame(1 / 60);

    expect(steps).toBe(7);
    expect(loop.tick).toBe(7);
    expect(alphas.at(-1)).toBe(1);
  });

  it('runs twice as many steps at 2x and half as many at 0.5x', () => {
    const run = (scale: number): number => {
      const { loop, steps } = countingLoop();
      loop.timeScale = scale;
      for (let i = 0; i < 600; i++) {
        loop.frame(1 / 60);
      }
      return steps();
    };

    expect(Math.abs(run(1) - 1200)).toBeLessThanOrEqual(1);
    expect(Math.abs(run(2) - 2400)).toBeLessThanOrEqual(1);
    expect(Math.abs(run(0.5) - 600)).toBeLessThanOrEqual(1);
  });

  it('keeps the time scale inside its limits', () => {
    const { loop } = countingLoop();

    loop.timeScale = 1000;
    expect(loop.timeScale).toBe(MAX_TIME_SCALE);
    loop.timeScale = 0;
    expect(loop.timeScale).toBe(MIN_TIME_SCALE);
    loop.timeScale = Number.NaN;
    expect(loop.timeScale).toBe(MIN_TIME_SCALE);
  });
});
