import { describe, expect, it } from 'vitest';
import { AIR_2S_SPECS, DRAG, GRAVITY, NORMAL_LIMITS, NORMAL_TUNING } from './air2s.config';

const DEG = Math.PI / 180;

/** Fastest speed the aircraft can hold at a given tilt: where thrust and drag balance. */
function speedAtTilt(tilt: number): number {
  return Math.sqrt((GRAVITY * Math.tan(tilt)) / DRAG);
}

describe('published Air 2S numbers', () => {
  it('has the published speeds for the three modes', () => {
    expect(AIR_2S_SPECS.maxSpeed).toEqual({ C: 5, N: 15, S: 19 });
    expect(AIR_2S_SPECS.maxAscent).toEqual({ N: 6, S: 6 });
    expect(AIR_2S_SPECS.maxDescent).toEqual({ N: 6, S: 6 });
  });

  it('has the published turn rates and tilt limits', () => {
    expect(AIR_2S_SPECS.maxYawRate.C / DEG).toBeCloseTo(60, 9);
    expect(AIR_2S_SPECS.maxYawRate.N / DEG).toBeCloseTo(90, 9);
    expect(AIR_2S_SPECS.maxYawRate.S / DEG).toBeCloseTo(250, 9);
    expect(AIR_2S_SPECS.maxTilt.N / DEG).toBeCloseTo(25, 9);
    expect(AIR_2S_SPECS.maxTilt.S / DEG).toBeCloseTo(35, 9);
  });

  it('uses the published Normal-mode numbers for flying', () => {
    expect(NORMAL_LIMITS.maxSpeed).toBe(15);
    expect(NORMAL_LIMITS.maxAscent).toBe(6);
    expect(NORMAL_LIMITS.maxDescent).toBe(6);
    expect(NORMAL_LIMITS.maxYawRate / DEG).toBeCloseTo(90, 9);
    expect(NORMAL_LIMITS.maxTilt / DEG).toBeCloseTo(25, 9);
  });
});

describe('drag', () => {
  it('lets the aircraft reach its published top speed inside its published tilt limit', () => {
    // A little above the top speed, so the last metre per second is not endless.
    expect(speedAtTilt(AIR_2S_SPECS.maxTilt.N)).toBeGreaterThan(AIR_2S_SPECS.maxSpeed.N + 0.3);
    expect(speedAtTilt(AIR_2S_SPECS.maxTilt.S)).toBeGreaterThan(AIR_2S_SPECS.maxSpeed.S + 0.2);
  });

  it('is not so weak that the tilt limits would allow far more than the published speeds', () => {
    expect(speedAtTilt(AIR_2S_SPECS.maxTilt.N)).toBeLessThan(AIR_2S_SPECS.maxSpeed.N + 2);
    expect(speedAtTilt(AIR_2S_SPECS.maxTilt.S)).toBeLessThan(AIR_2S_SPECS.maxSpeed.S + 2);
  });
});

describe('tuning', () => {
  it('has only positive, finite values', () => {
    for (const [name, value] of Object.entries(NORMAL_TUNING)) {
      expect(Number.isFinite(value), name).toBe(true);
      expect(value, name).toBeGreaterThan(0);
    }
  });
});
