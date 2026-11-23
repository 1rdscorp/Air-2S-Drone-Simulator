import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../core/params';
import { type DebugInfo, formatDebugText, formatDrone, formatTimeScale } from './debugOverlay';

const INFO: DebugInfo = {
  fps: 59.94,
  frameMs: 16.683,
  maxFrameMs: 21.04,
  drawCalls: 5,
  triangles: 1234567,
  tick: 1200,
  simTime: 10,
  timeScale: 1,
  paused: false,
  inputSource: 'Keyboard',
  drone: { height: 12.04, speed: 14.96, climbRate: 0, headingDeg: 45.2, onGround: false },
  params: DEFAULT_PARAMS,
};

describe('formatDebugText', () => {
  it('shows frame rate, frame time, draw calls and triangles', () => {
    const text = formatDebugText(INFO);

    expect(text).toMatch(/FPS\s+60/);
    expect(text).toMatch(/Frame\s+16\.7 ms \(max 21\.0\)/);
    expect(text).toMatch(/Draw calls\s+5/);
    expect(text).toMatch(/Triangles\s+1,234,567/);
  });

  it('shows the simulation clock and speed', () => {
    const text = formatDebugText(INFO);

    expect(text).toContain('120 Hz · tick 1200 · 10.00 s');
    expect(text).toMatch(/Speed\s+1×/);
    expect(text).not.toContain('paused');
  });

  it('shows which control device is in use and the stick mode', () => {
    expect(formatDebugText(INFO)).toMatch(/Input\s+Keyboard · stick mode 2/);
  });

  it('says when the simulation is paused', () => {
    const text = formatDebugText({ ...INFO, paused: true, timeScale: 0.25 });

    expect(text).toMatch(/Speed\s+0\.25× · paused/);
  });

  it('shows the address settings, with a dash for the ones not given', () => {
    const withDefaults = formatDebugText(INFO);
    expect(withDefaults).toMatch(/Env\s+–/);
    expect(withDefaults).toMatch(/Seed\s+1/);

    const withValues = formatDebugText({
      ...INFO,
      params: { ...DEFAULT_PARAMS, env: 'city', timeOfDay: 21.5, seed: 7, quality: 'low' },
    });
    expect(withValues).toMatch(/Env\s+city/);
    expect(withValues).toMatch(/Time of day\s+21\.5 h/);
    expect(withValues).toMatch(/Seed\s+7/);
    expect(withValues).toMatch(/Quality\s+low/);
  });

  it('lines the values up in one column', () => {
    const valueColumns = formatDebugText(INFO)
      .split('\n')
      .slice(0, 4)
      .map((line) => line.search(/\s{2}\S/));

    expect(new Set(valueColumns).size).toBe(1);
  });
});

describe('formatDrone', () => {
  it('shows height, speed, climb rate and heading', () => {
    expect(formatDrone(INFO.drone)).toBe('12.0 m · 15.0 m/s · climb +0.0 m/s · 045°');
    expect(formatDebugText(INFO)).toMatch(/Drone\s+12\.0 m · 15\.0 m\/s/);
  });

  it('marks climbing and descending clearly, and never shows minus zero', () => {
    const base = INFO.drone;

    expect(formatDrone({ ...base, climbRate: 6 })).toContain('climb +6.0 m/s');
    expect(formatDrone({ ...base, climbRate: -6 })).toContain('climb −6.0 m/s');
    expect(formatDrone({ ...base, climbRate: -0.001 })).toContain('climb +0.0 m/s');
  });

  it('shows the heading as three digits from 000 to 359', () => {
    const base = INFO.drone;

    expect(formatDrone({ ...base, headingDeg: 0 })).toContain('000°');
    expect(formatDrone({ ...base, headingDeg: 7.4 })).toContain('007°');
    expect(formatDrone({ ...base, headingDeg: 359.7 })).toContain('000°');
    expect(formatDrone({ ...base, headingDeg: 270 })).toContain('270°');
  });

  it('says when the aircraft stands on the ground', () => {
    const landed = { height: 0, speed: 0, climbRate: 0, headingDeg: 0, onGround: true };

    expect(formatDrone(landed)).toBe('0.0 m · 0.0 m/s · climb +0.0 m/s · 000° · on the ground');
  });
});

describe('formatTimeScale', () => {
  it('drops needless zeros', () => {
    expect(formatTimeScale(1)).toBe('1×');
    expect(formatTimeScale(0.5)).toBe('0.5×');
    expect(formatTimeScale(0.25)).toBe('0.25×');
    expect(formatTimeScale(8)).toBe('8×');
  });
});
