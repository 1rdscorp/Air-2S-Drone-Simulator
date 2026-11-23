import { describe, expect, it } from 'vitest';
import { nextTimeScale, TIME_SCALE_PRESETS } from './debugControls';

describe('nextTimeScale', () => {
  it('steps up and down through the presets', () => {
    expect(nextTimeScale(1, 1)).toBe(2);
    expect(nextTimeScale(1, -1)).toBe(0.5);
    expect(nextTimeScale(0.25, -1)).toBe(0.1);
    expect(nextTimeScale(4, 1)).toBe(8);
  });

  it('stops at the slowest and the fastest preset', () => {
    expect(nextTimeScale(0.1, -1)).toBe(0.1);
    expect(nextTimeScale(8, 1)).toBe(8);
  });

  it('moves to the nearest preset from a speed that is not a preset', () => {
    expect(nextTimeScale(0.7, 1)).toBe(1);
    expect(nextTimeScale(0.7, -1)).toBe(0.5);
    expect(nextTimeScale(3, 1)).toBe(4);
  });

  it('can walk the whole list in both directions', () => {
    let speed: number = TIME_SCALE_PRESETS[0];
    const up = [speed];
    for (let i = 1; i < TIME_SCALE_PRESETS.length; i++) {
      speed = nextTimeScale(speed, 1);
      up.push(speed);
    }
    expect(up).toEqual([...TIME_SCALE_PRESETS]);

    const down = [speed];
    for (let i = 1; i < TIME_SCALE_PRESETS.length; i++) {
      speed = nextTimeScale(speed, -1);
      down.push(speed);
    }
    expect(down).toEqual([...TIME_SCALE_PRESETS].reverse());
  });
});
