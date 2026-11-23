import { describe, expect, it } from 'vitest';
import { applyDeadzone, applyExpo, clampAxis, shapeAxis } from './shaping';

describe('clampAxis', () => {
  it('keeps values inside -1 to 1', () => {
    expect(clampAxis(0.4)).toBe(0.4);
    expect(clampAxis(1.7)).toBe(1);
    expect(clampAxis(-3)).toBe(-1);
  });

  it('turns something that is not a number into 0', () => {
    expect(clampAxis(Number.NaN)).toBe(0);
  });
});

describe('applyDeadzone', () => {
  it('returns 0 inside the deadzone and exactly at its edge', () => {
    expect(applyDeadzone(0, 0.1)).toBe(0);
    expect(applyDeadzone(0.05, 0.1)).toBe(0);
    expect(applyDeadzone(-0.09, 0.1)).toBe(0);
    expect(applyDeadzone(0.1, 0.1)).toBe(0);
  });

  it('still reaches full deflection', () => {
    expect(applyDeadzone(1, 0.1)).toBeCloseTo(1, 12);
    expect(applyDeadzone(-1, 0.1)).toBeCloseTo(-1, 12);
  });

  it('rises smoothly from the edge of the deadzone, without a jump', () => {
    expect(applyDeadzone(0.1001, 0.1)).toBeCloseTo(0, 3);
    expect(applyDeadzone(0.55, 0.1)).toBeCloseTo(0.5, 12);
  });

  it('is the same in both directions', () => {
    for (const value of [0.05, 0.2, 0.5, 0.9]) {
      expect(applyDeadzone(-value, 0.15)).toBeCloseTo(-applyDeadzone(value, 0.15), 12);
    }
  });

  it('never decreases when the stick moves further out', () => {
    let previous = -1;
    for (let value = -1; value <= 1; value += 0.01) {
      const output = applyDeadzone(value, 0.12);
      expect(output).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = output;
    }
  });

  it('changes nothing when the deadzone is 0', () => {
    expect(applyDeadzone(0.37, 0)).toBeCloseTo(0.37, 12);
  });

  it('limits values outside the stick range', () => {
    expect(applyDeadzone(2, 0.1)).toBeCloseTo(1, 12);
    expect(applyDeadzone(-2, 0.1)).toBeCloseTo(-1, 12);
  });

  it('copes with a senseless deadzone setting', () => {
    expect(applyDeadzone(0.5, -1)).toBeCloseTo(0.5, 12);
    expect(applyDeadzone(1, 5)).toBeCloseTo(1, 12);
  });
});

describe('applyExpo', () => {
  it('is a straight line when expo is 0', () => {
    for (const value of [-1, -0.3, 0, 0.5, 1]) {
      expect(applyExpo(value, 0)).toBeCloseTo(value, 12);
    }
  });

  it('is a pure cubic curve when expo is 1', () => {
    expect(applyExpo(0.5, 1)).toBeCloseTo(0.125, 12);
    expect(applyExpo(-0.5, 1)).toBeCloseTo(-0.125, 12);
  });

  it('blends between the two', () => {
    // 70 % of 0.5 plus 30 % of 0.5 cubed
    expect(applyExpo(0.5, 0.3)).toBeCloseTo(0.7 * 0.5 + 0.3 * 0.125, 12);
  });

  it('keeps centre and full deflection where they are', () => {
    for (const expo of [0, 0.3, 0.7, 1]) {
      expect(applyExpo(0, expo)).toBe(0);
      expect(applyExpo(1, expo)).toBeCloseTo(1, 12);
      expect(applyExpo(-1, expo)).toBeCloseTo(-1, 12);
    }
  });

  it('makes the stick less sensitive around the centre', () => {
    expect(Math.abs(applyExpo(0.2, 0.5))).toBeLessThan(0.2);
    expect(Math.abs(applyExpo(-0.2, 0.5))).toBeLessThan(0.2);
  });

  it('is the same in both directions and never decreases', () => {
    let previous = -1;
    for (let value = -1; value <= 1; value += 0.01) {
      const output = applyExpo(value, 0.6);
      expect(output).toBeCloseTo(-applyExpo(-value, 0.6), 12);
      expect(output).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = output;
    }
  });

  it('limits an expo setting outside 0 to 1', () => {
    expect(applyExpo(0.5, -2)).toBeCloseTo(0.5, 12);
    expect(applyExpo(0.5, 9)).toBeCloseTo(0.125, 12);
  });
});

describe('shapeAxis', () => {
  it('applies the deadzone first and then expo', () => {
    // 0.55 with a 0.1 deadzone is 0.5; expo 1 cubes it
    expect(shapeAxis(0.55, 0.1, 1)).toBeCloseTo(0.125, 12);
  });

  it('gives 0 inside the deadzone and 1 at full deflection', () => {
    expect(shapeAxis(0.05, 0.1, 0.3)).toBe(0);
    expect(shapeAxis(1, 0.1, 0.3)).toBeCloseTo(1, 12);
  });
});
