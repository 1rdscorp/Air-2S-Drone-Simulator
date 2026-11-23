import { describe, expect, it } from 'vitest';
import { FLIGHT_MODES } from '../input/types';
import {
  AIR_2S_SPECS,
  CINE_CHOSEN,
  DRAG,
  FLIGHT_PROCEDURE,
  GRAVITY,
  MODE_LIMITS,
  MODE_TUNING,
} from './air2s.config';

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
});

describe('mode limits', () => {
  it('uses every published number for Normal and Sport', () => {
    expect(MODE_LIMITS.N).toEqual({
      maxSpeed: 15,
      maxAscent: 6,
      maxDescent: 6,
      maxYawRate: AIR_2S_SPECS.maxYawRate.N,
      maxTilt: AIR_2S_SPECS.maxTilt.N,
    });
    expect(MODE_LIMITS.S).toEqual({
      maxSpeed: 19,
      maxAscent: 6,
      maxDescent: 6,
      maxYawRate: AIR_2S_SPECS.maxYawRate.S,
      maxTilt: AIR_2S_SPECS.maxTilt.S,
    });
  });

  it('uses the published speed and turn rate for Cine, and chosen values for the rest', () => {
    expect(MODE_LIMITS.C.maxSpeed).toBe(5);
    expect(MODE_LIMITS.C.maxYawRate).toBe(AIR_2S_SPECS.maxYawRate.C);
    expect(MODE_LIMITS.C.maxAscent).toBe(CINE_CHOSEN.maxAscent);
    expect(MODE_LIMITS.C.maxDescent).toBe(CINE_CHOSEN.maxDescent);
    expect(MODE_LIMITS.C.maxTilt).toBe(CINE_CHOSEN.maxTilt);
  });

  it('makes Cine the gentlest mode and Sport the fastest', () => {
    for (const key of ['maxSpeed', 'maxYawRate', 'maxTilt'] as const) {
      expect(MODE_LIMITS.C[key], key).toBeLessThan(MODE_LIMITS.N[key]);
      expect(MODE_LIMITS.N[key], key).toBeLessThan(MODE_LIMITS.S[key]);
    }
    expect(MODE_LIMITS.C.maxAscent).toBeLessThan(MODE_LIMITS.N.maxAscent);
  });
});

describe('drag', () => {
  it('lets every mode reach its top speed inside its tilt limit', () => {
    // A little above the top speed, so the last metre per second is not endless.
    expect(speedAtTilt(MODE_LIMITS.C.maxTilt)).toBeGreaterThan(MODE_LIMITS.C.maxSpeed + 0.2);
    expect(speedAtTilt(MODE_LIMITS.N.maxTilt)).toBeGreaterThan(MODE_LIMITS.N.maxSpeed + 0.3);
    expect(speedAtTilt(MODE_LIMITS.S.maxTilt)).toBeGreaterThan(MODE_LIMITS.S.maxSpeed + 0.2);
  });

  it('is not so weak that the published tilt limits would allow far more than the published speeds', () => {
    expect(speedAtTilt(AIR_2S_SPECS.maxTilt.N)).toBeLessThan(AIR_2S_SPECS.maxSpeed.N + 2);
    expect(speedAtTilt(AIR_2S_SPECS.maxTilt.S)).toBeLessThan(AIR_2S_SPECS.maxSpeed.S + 2);
  });
});

describe('tuning', () => {
  it('has only positive, finite values in every mode', () => {
    for (const mode of FLIGHT_MODES) {
      for (const [name, value] of Object.entries(MODE_TUNING[mode])) {
        expect(Number.isFinite(value), `${mode} ${name}`).toBe(true);
        expect(value, `${mode} ${name}`).toBeGreaterThan(0);
      }
    }
  });

  it('makes Cine react more slowly than Normal, and Sport more quickly', () => {
    for (const key of ['velocityGain', 'attitudeFrequency', 'yawGain', 'maxTiltRate'] as const) {
      expect(MODE_TUNING.C[key], key).toBeLessThan(MODE_TUNING.N[key]);
      expect(MODE_TUNING.N[key], key).toBeLessThan(MODE_TUNING.S[key]);
    }
  });
});

describe('take-off, landing and motor timings', () => {
  it('takes off to 1.2 m', () => {
    expect(FLIGHT_PROCEDURE.takeoffHeight).toBe(1.2);
  });

  it('touches down more slowly than it descends', () => {
    expect(FLIGHT_PROCEDURE.landingTouchdownSpeed).toBeLessThan(FLIGHT_PROCEDURE.landingSpeed);
    expect(FLIGHT_PROCEDURE.landingTouchdownSpeed).toBeGreaterThan(0);
  });

  it('needs a much longer hold to cut the motors in the air than to start them on the ground', () => {
    expect(FLIGHT_PROCEDURE.emergencyStopHold).toBeGreaterThan(
      FLIGHT_PROCEDURE.stickCommandHold * 4,
    );
  });
});
