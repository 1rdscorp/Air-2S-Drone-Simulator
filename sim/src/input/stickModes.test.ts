import { describe, expect, it } from 'vitest';
import { mapSticks, STICK_LAYOUTS } from './stickModes';
import { STICK_MODES, type StickPositions } from './types';

/** A different value on every stick axis, so a mix-up cannot go unnoticed. */
const STICKS: StickPositions = { leftX: 0.1, leftY: 0.2, rightX: 0.3, rightY: 0.4 };

describe('mapSticks', () => {
  it('mode 2: left stick is throttle and yaw, right stick is pitch and roll', () => {
    expect(mapSticks(STICKS, 2)).toEqual({ throttle: 0.2, yaw: 0.1, pitch: 0.4, roll: 0.3 });
  });

  it('mode 1: left stick is pitch and yaw, right stick is throttle and roll', () => {
    expect(mapSticks(STICKS, 1)).toEqual({ pitch: 0.2, yaw: 0.1, throttle: 0.4, roll: 0.3 });
  });

  it('mode 3: left stick is pitch and roll, right stick is throttle and yaw', () => {
    expect(mapSticks(STICKS, 3)).toEqual({ pitch: 0.2, roll: 0.1, throttle: 0.4, yaw: 0.3 });
  });

  it('keeps the sign: forward and right stay positive', () => {
    const mapped = mapSticks({ leftX: -1, leftY: -1, rightX: 1, rightY: 1 }, 2);

    expect(mapped).toEqual({ yaw: -1, throttle: -1, roll: 1, pitch: 1 });
  });

  it('gives all zeros for centred sticks', () => {
    for (const mode of STICK_MODES) {
      expect(mapSticks({ leftX: 0, leftY: 0, rightX: 0, rightY: 0 }, mode)).toEqual({
        roll: 0,
        pitch: 0,
        yaw: 0,
        throttle: 0,
      });
    }
  });
});

describe('STICK_LAYOUTS', () => {
  it('uses each of roll, pitch, yaw and throttle exactly once in every mode', () => {
    for (const mode of STICK_MODES) {
      const functions = Object.values(STICK_LAYOUTS[mode]).sort();

      expect(functions, `mode ${mode}`).toEqual(['pitch', 'roll', 'throttle', 'yaw']);
    }
  });

  it('puts throttle on a vertical axis in every mode', () => {
    for (const mode of STICK_MODES) {
      const layout = STICK_LAYOUTS[mode];

      expect([layout.leftY, layout.rightY], `mode ${mode}`).toContain('throttle');
    }
  });
});
