import { describe, expect, it } from 'vitest';
import { KeyboardSource } from './keyboardSource';
import type { RawControls } from './types';

/** Polls for `seconds` at 60 polls per second and returns the last reading. */
function hold(source: KeyboardSource, clock: { ms: number }, seconds: number): RawControls {
  let reading = source.poll(clock.ms);
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    clock.ms += 1000 / 60;
    reading = source.poll(clock.ms);
  }
  return reading;
}

function setup(): { source: KeyboardSource; clock: { ms: number } } {
  const source = new KeyboardSource();
  const clock = { ms: 1000 };
  source.poll(clock.ms);
  return { source, clock };
}

describe('KeyboardSource', () => {
  it('is always connected and needs no deadzone', () => {
    const source = new KeyboardSource();

    expect(source.connected).toBe(true);
    expect(source.deadzone).toBe(0);
    expect(source.id).toBe('keyboard');
  });

  it('reports centred sticks and nothing pressed when no key is held', () => {
    const { source, clock } = setup();

    expect(hold(source, clock, 0.5)).toEqual({
      leftX: 0,
      leftY: 0,
      rightX: 0,
      rightY: 0,
      gimbal: 0,
      mode: null,
      buttons: {},
    });
  });

  it('uses W A S D as the left stick', () => {
    const { source, clock } = setup();

    source.keyDown('KeyW');
    source.keyDown('KeyD');
    const up = hold(source, clock, 1);
    expect(up.leftY).toBe(1);
    expect(up.leftX).toBe(1);

    source.releaseAll();
    source.keyDown('KeyS');
    source.keyDown('KeyA');
    const down = hold(source, clock, 1);
    expect(down.leftY).toBe(-1);
    expect(down.leftX).toBe(-1);
    expect(down.rightX).toBe(0);
    expect(down.rightY).toBe(0);
  });

  it('uses the arrow keys as the right stick', () => {
    const { source, clock } = setup();

    source.keyDown('ArrowUp');
    source.keyDown('ArrowLeft');
    const reading = hold(source, clock, 1);

    expect(reading.rightY).toBe(1);
    expect(reading.rightX).toBe(-1);
    expect(reading.leftX).toBe(0);
    expect(reading.leftY).toBe(0);
  });

  it('uses R and F as the gimbal dial', () => {
    const { source, clock } = setup();

    source.keyDown('KeyR');
    expect(hold(source, clock, 1).gimbal).toBe(1);
    source.keyUp('KeyR');
    source.keyDown('KeyF');
    expect(hold(source, clock, 1).gimbal).toBe(-1);
  });

  it('moves the stick out gradually, so a short tap gives a small deflection', () => {
    const { source, clock } = setup();

    source.keyDown('KeyW');
    const afterTap = hold(source, clock, 0.05).leftY;
    expect(afterTap).toBeGreaterThan(0.1);
    expect(afterTap).toBeLessThan(0.5);

    const afterHold = hold(source, clock, 0.5).leftY;
    expect(afterHold).toBe(1);
  });

  it('returns to the centre after the key is released, faster than it went out', () => {
    const { source, clock } = setup();
    source.keyDown('ArrowRight');
    hold(source, clock, 1);
    source.keyUp('ArrowRight');

    const soonAfter = hold(source, clock, 0.05).rightX;
    expect(soonAfter).toBeGreaterThan(0);
    expect(soonAfter).toBeLessThan(0.75);
    expect(hold(source, clock, 0.3).rightX).toBe(0);
  });

  it('centres the stick when two opposite keys are held', () => {
    const { source, clock } = setup();
    source.keyDown('KeyA');
    source.keyDown('KeyD');

    expect(hold(source, clock, 0.5).leftX).toBe(0);
  });

  it('does not move the sticks during a long gap between polls', () => {
    const { source, clock } = setup();
    source.keyDown('KeyW');

    clock.ms += 60_000; // the tab was in the background for a minute
    const reading = source.poll(clock.ms);

    expect(reading.leftY).toBeLessThanOrEqual(0.5);
  });

  it('selects the flight mode with 1, 2 and 3 while the key is held', () => {
    const { source, clock } = setup();

    source.keyDown('Digit1');
    expect(source.poll(clock.ms).mode).toBe('C');
    source.keyUp('Digit1');
    source.keyDown('Digit2');
    expect(source.poll(clock.ms).mode).toBe('N');
    source.keyUp('Digit2');
    source.keyDown('Digit3');
    expect(source.poll(clock.ms).mode).toBe('S');
    source.keyUp('Digit3');
    expect(source.poll(clock.ms).mode).toBeNull();
  });

  it('reports the buttons that are held', () => {
    const { source, clock } = setup();

    source.keyDown('KeyH');
    source.keyDown('Space');
    expect(source.poll(clock.ms).buttons).toEqual({ rth: true, pause: true });

    source.keyUp('KeyH');
    source.keyUp('Space');
    for (const code of ['KeyC', 'KeyB', 'KeyZ', 'KeyX']) {
      source.keyDown(code);
    }
    expect(source.poll(clock.ms).buttons).toEqual({
      record: true,
      shutter: true,
      c1: true,
      c2: true,
    });
  });

  it('lets go of everything when asked, for example when the window loses focus', () => {
    const { source, clock } = setup();
    source.keyDown('KeyW');
    source.keyDown('KeyH');
    source.keyDown('Digit3');
    hold(source, clock, 1);

    source.releaseAll();
    const reading = hold(source, clock, 1);

    expect(reading.leftY).toBe(0);
    expect(reading.buttons).toEqual({});
    expect(reading.mode).toBeNull();
  });

  it('only claims the keys it uses', () => {
    const source = new KeyboardSource();

    expect(source.handles('KeyW')).toBe(true);
    expect(source.handles('ArrowLeft')).toBe(true);
    expect(source.handles('Space')).toBe(true);
    expect(source.handles('Digit2')).toBe(true);
    // Debug keys and anything else stay free.
    for (const code of ['KeyP', 'KeyI', 'Backquote', 'Period', 'Minus', 'Equal', 'F5', 'Tab']) {
      expect(source.handles(code), code).toBe(false);
    }
  });

  it('ignores keys it does not use', () => {
    const { source, clock } = setup();
    source.keyDown('KeyQ');
    source.keyDown('F5');

    expect(hold(source, clock, 0.5)).toMatchObject({ leftX: 0, leftY: 0, rightX: 0, rightY: 0 });
  });
});
