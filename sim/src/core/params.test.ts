import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, parseParams } from './params';

describe('parseParams', () => {
  it('returns the defaults for an empty address', () => {
    const { params, warnings } = parseParams('');

    expect(params).toEqual(DEFAULT_PARAMS);
    expect(warnings).toEqual([]);
  });

  it('reads the example from the plan', () => {
    const { params, warnings } = parseParams('?env=city&time=21.5&seed=7&quality=low');

    expect(params.env).toBe('city');
    expect(params.timeOfDay).toBe(21.5);
    expect(params.seed).toBe(7);
    expect(params.quality).toBe('low');
    expect(warnings).toEqual([]);
  });

  it('reads the debug settings', () => {
    const { params } = parseParams('?debug=1&paused=true&speed=0.5');

    expect(params.debug).toBe(true);
    expect(params.paused).toBe(true);
    expect(params.speed).toBe(0.5);
  });

  it('treats a bare flag as switched on and 0 as switched off', () => {
    expect(parseParams('?debug').params.debug).toBe(true);
    expect(parseParams('?paused').params.paused).toBe(true);
    expect(parseParams('?debug=0').params.debug).toBe(false);
    expect(parseParams('?paused=off').params.paused).toBe(false);
  });

  it('ignores upper and lower case in names of environments and presets', () => {
    const { params } = parseParams('?env=Mountains&quality=ULTRA');

    expect(params.env).toBe('mountains');
    expect(params.quality).toBe('ultra');
  });

  it('falls back to the default and warns when a value is not understood', () => {
    const { params, warnings } = parseParams(
      '?env=moon&time=25&seed=1.5&quality=best&debug=maybe&speed=fast',
    );

    expect(params).toEqual(DEFAULT_PARAMS);
    expect(warnings).toHaveLength(6);
    expect(warnings[0]).toContain('env="moon"');
  });

  it('rejects values outside their range', () => {
    expect(parseParams('?time=-1').params.timeOfDay).toBeNull();
    expect(parseParams('?seed=-3').params.seed).toBe(DEFAULT_PARAMS.seed);
    expect(parseParams('?speed=0').params.speed).toBe(1);
    expect(parseParams('?speed=100').params.speed).toBe(1);
    expect(parseParams('?time=').params.timeOfDay).toBeNull();
  });

  it('accepts the ends of each range', () => {
    expect(parseParams('?time=0').params.timeOfDay).toBe(0);
    expect(parseParams('?time=24').params.timeOfDay).toBe(24);
    expect(parseParams('?seed=0').params.seed).toBe(0);
    expect(parseParams('?speed=8').params.speed).toBe(8);
  });

  it('reads the control settings', () => {
    const { params, warnings } = parseParams('?stickmode=3&expo=0.6&sticks=0');

    expect(params.stickMode).toBe(3);
    expect(params.expo).toBe(0.6);
    expect(params.sticks).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('uses stick mode 2 with the stick monitor shown unless told otherwise', () => {
    const { params } = parseParams('');

    expect(params.stickMode).toBe(2);
    expect(params.sticks).toBe(true);
    expect(params.expo).toBeGreaterThanOrEqual(0);
    expect(params.expo).toBeLessThanOrEqual(1);
  });

  it('rejects stick modes and expo values that do not exist', () => {
    for (const query of ['?stickmode=4', '?stickmode=0', '?stickmode=two', '?stickmode=2.0']) {
      const { params, warnings } = parseParams(query);
      expect(params.stickMode, query).toBe(2);
      expect(warnings, query).toHaveLength(1);
    }
    expect(parseParams('?expo=1.5').params.expo).toBe(DEFAULT_PARAMS.expo);
    expect(parseParams('?expo=-0.1').params.expo).toBe(DEFAULT_PARAMS.expo);
  });

  it('reads the camera view, and falls back to the chase camera', () => {
    expect(parseParams('').params.camera).toBe('chase');
    expect(parseParams('?camera=fpv').params.camera).toBe('fpv');
    expect(parseParams('?camera=FREE').params.camera).toBe('free');

    const { params, warnings } = parseParams('?camera=helicopter');
    expect(params.camera).toBe('chase');
    expect(warnings).toHaveLength(1);
  });

  it('reads the upward gimbal setting, which is off unless asked for', () => {
    expect(parseParams('').params.gimbalUpward).toBe(false);
    expect(parseParams('?gimbalup=1').params.gimbalUpward).toBe(true);
    expect(parseParams('?gimbalup').params.gimbalUpward).toBe(true);
    expect(parseParams('?gimbalup=0').params.gimbalUpward).toBe(false);
  });

  it('ignores settings it does not know', () => {
    const { params, warnings } = parseParams('?utm_source=x&foo=bar');

    expect(params).toEqual(DEFAULT_PARAMS);
    expect(warnings).toEqual([]);
  });
});
