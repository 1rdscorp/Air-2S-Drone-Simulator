import { describe, expect, it } from 'vitest';
import { type GamepadLike, GamepadSource } from './gamepadSource';

interface FakePad {
  connected: boolean;
  id: string;
  mapping: string;
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}

function fakePad(overrides: Partial<FakePad> = {}): FakePad {
  return {
    connected: true,
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    ...overrides,
  };
}

function press(pad: FakePad, index: number, value = 1): void {
  pad.buttons[index] = { pressed: value > 0.5, value };
}

function sourceFor(...pads: (GamepadLike | null)[]): GamepadSource {
  return new GamepadSource(() => pads);
}

describe('GamepadSource', () => {
  it('is not connected and reports nothing when there is no gamepad', () => {
    const source = sourceFor();

    expect(source.connected).toBe(false);
    expect(source.poll()).toBeNull();
    expect(source.label).toBe('Gamepad');
  });

  it('skips empty slots and gamepads that are not connected', () => {
    const unplugged = fakePad({ connected: false });
    const live = fakePad({ axes: [0.5, 0, 0, 0] });
    const source = sourceFor(null, unplugged, live);

    expect(source.connected).toBe(true);
    expect(source.poll()?.leftX).toBe(0.5);
  });

  it('skips devices without two sticks', () => {
    const source = sourceFor(fakePad({ axes: [0, 0] }));

    expect(source.connected).toBe(false);
    expect(source.poll()).toBeNull();
  });

  it('reads the two sticks, with forward as positive', () => {
    // The browser reports "pulled back" as +1 on the vertical axes.
    const source = sourceFor(fakePad({ axes: [0.25, -1, -0.5, 0.75] }));

    expect(source.poll()).toMatchObject({ leftX: 0.25, leftY: 1, rightX: -0.5, rightY: -0.75 });
  });

  it('reports exactly 0, not minus zero, for centred vertical axes', () => {
    const reading = sourceFor(fakePad()).poll();

    expect(Object.is(reading?.leftY, 0)).toBe(true);
    expect(Object.is(reading?.rightY, 0)).toBe(true);
  });

  it('uses the triggers as the gimbal dial: right up, left down', () => {
    const pad = fakePad();
    press(pad, 7, 0.8);
    expect(sourceFor(pad).poll()?.gimbal).toBeCloseTo(0.8, 12);

    press(pad, 6, 0.3);
    expect(sourceFor(pad).poll()?.gimbal).toBeCloseTo(0.5, 12);

    press(pad, 7, 0);
    expect(sourceFor(pad).poll()?.gimbal).toBeCloseTo(-0.3, 12);
  });

  it('selects the flight mode with the D-pad: left Cine, up Normal, right Sport', () => {
    const cases: [number, string][] = [
      [14, 'C'],
      [12, 'N'],
      [15, 'S'],
    ];
    for (const [button, mode] of cases) {
      const pad = fakePad();
      press(pad, button);
      expect(sourceFor(pad).poll()?.mode, `button ${button}`).toBe(mode);
    }
    expect(sourceFor(fakePad()).poll()?.mode).toBeNull();
  });

  it('maps the face buttons, bumpers and Start', () => {
    const pad = fakePad();
    for (const index of [0, 1, 2, 3, 4, 5, 9]) {
      press(pad, index);
    }

    expect(sourceFor(pad).poll()?.buttons).toEqual({
      takeoffLand: true,
      shutter: true,
      pause: true,
      record: true,
      rth: true,
      c1: true,
      c2: true,
    });
    expect(sourceFor(fakePad()).poll()?.buttons).toEqual({});
  });

  it('copes with a gamepad that has fewer buttons than the standard layout', () => {
    const source = sourceFor(fakePad({ buttons: [{ pressed: true, value: 1 }] }));

    expect(source.poll()).toMatchObject({ gimbal: 0, mode: null, buttons: { shutter: true } });
  });

  it('limits axis values outside the stick range', () => {
    const source = sourceFor(fakePad({ axes: [1.4, -2, Number.NaN, 0] }));

    expect(source.poll()).toMatchObject({ leftX: 1, leftY: 1, rightX: 0 });
  });

  it('shows a short device name', () => {
    expect(sourceFor(fakePad()).label).toBe('Gamepad (Xbox Wireless Controller)');
    expect(sourceFor(fakePad({ id: '' })).label).toBe('Gamepad');
  });

  it('follows a gamepad that is plugged in or removed later', () => {
    const pads: (GamepadLike | null)[] = [null];
    const source = new GamepadSource(() => pads);
    expect(source.connected).toBe(false);

    pads[0] = fakePad();
    expect(source.connected).toBe(true);

    pads[0] = null;
    expect(source.connected).toBe(false);
  });

  it('counts as not connected when the browser refuses to list gamepads', () => {
    const source = new GamepadSource(() => {
      throw new Error('blocked by permissions policy');
    });

    expect(source.connected).toBe(false);
    expect(source.poll()).toBeNull();
  });
});
