import { describe, expect, it } from 'vitest';
import { isStickCommand } from '../drone/flightPhase';
import { DEFAULT_INPUT_SETTINGS, InputManager } from './inputManager';
import { applyDeadzone, shapeAxis } from './shaping';
import {
  BUTTON_IDS,
  type ControlSource,
  noButtonsPressed,
  type RawControls,
  type StickPositions,
} from './types';

const CENTRED: RawControls = {
  leftX: 0,
  leftY: 0,
  rightX: 0,
  rightY: 0,
  gimbal: 0,
  mode: null,
  buttons: {},
};

/** A control source whose readings the test sets directly. */
class FakeSource implements ControlSource {
  connected = true;
  controls: RawControls | null = { ...CENTRED };
  polledAt: number[] = [];

  constructor(
    readonly id: string,
    readonly deadzone = 0,
    readonly label = id,
  ) {}

  set(change: Partial<RawControls>): void {
    this.controls = { ...CENTRED, ...change };
  }

  poll(now: number): RawControls | null {
    this.polledAt.push(now);
    return this.connected ? this.controls : null;
  }
}

function setup(settings = {}): { keyboard: FakeSource; gamepad: FakeSource; input: InputManager } {
  const keyboard = new FakeSource('keyboard');
  const gamepad = new FakeSource('gamepad', 0.1);
  const input = new InputManager([keyboard, gamepad], settings);
  return { keyboard, gamepad, input };
}

describe('InputManager basics', () => {
  it('needs at least one source', () => {
    expect(() => new InputManager([])).toThrow();
  });

  it('starts on the first source with a neutral frame in Normal mode', () => {
    const { input } = setup();

    expect(input.activeSource.id).toBe('keyboard');
    expect(input.frame).toEqual({
      t: 0,
      roll: 0,
      pitch: 0,
      yaw: 0,
      throttle: 0,
      gimbal: 0,
      mode: 'N',
      buttons: noButtonsPressed(),
      connected: true,
    });
  });

  it('uses stick mode 2 and some expo unless told otherwise', () => {
    const { input } = setup();

    expect(input.settings).toEqual(DEFAULT_INPUT_SETTINGS);
    expect(input.settings.stickMode).toBe(2);
  });

  it('polls every source with the current time and stamps the frame with it', () => {
    const { keyboard, gamepad, input } = setup();

    const frame = input.update(1234);

    expect(frame.t).toBe(1234);
    expect(keyboard.polledAt).toEqual([1234]);
    expect(gamepad.polledAt).toEqual([1234]);
    expect(input.frame).toBe(frame);
  });

  it('always lists every button, pressed or not', () => {
    const { keyboard, input } = setup();
    keyboard.set({ buttons: { rth: true, c2: true } });

    const { buttons } = input.update(1);

    expect(Object.keys(buttons).sort()).toEqual([...BUTTON_IDS].sort());
    expect(buttons).toEqual({ ...noButtonsPressed(), rth: true, c2: true });
  });
});

describe('InputManager mapping and shaping', () => {
  const STICKS: StickPositions = { leftX: 0.2, leftY: 0.4, rightX: 0.6, rightY: 0.8 };

  it('maps the sticks by stick mode (expo off)', () => {
    const expectations = {
      1: { pitch: 0.4, yaw: 0.2, throttle: 0.8, roll: 0.6 },
      2: { throttle: 0.4, yaw: 0.2, pitch: 0.8, roll: 0.6 },
      3: { pitch: 0.4, roll: 0.2, throttle: 0.8, yaw: 0.6 },
    } as const;

    for (const stickMode of [1, 2, 3] as const) {
      const { keyboard, input } = setup({ stickMode, expo: 0 });
      keyboard.set(STICKS);

      const frame = input.update(1);

      for (const [axis, value] of Object.entries(expectations[stickMode])) {
        expect(frame[axis as 'roll'], `mode ${stickMode} ${axis}`).toBeCloseTo(value, 12);
      }
    }
  });

  it('applies expo to all four stick axes', () => {
    const { keyboard, input } = setup({ expo: 0.5 });
    keyboard.set(STICKS);

    const frame = input.update(1);

    expect(frame.yaw).toBeCloseTo(shapeAxis(0.2, 0, 0.5), 12);
    expect(frame.throttle).toBeCloseTo(shapeAxis(0.4, 0, 0.5), 12);
    expect(frame.roll).toBeCloseTo(shapeAxis(0.6, 0, 0.5), 12);
    expect(frame.pitch).toBeCloseTo(shapeAxis(0.8, 0, 0.5), 12);
  });

  it("applies the active source's own deadzone", () => {
    const { gamepad, input } = setup({ expo: 0 });
    gamepad.set({ leftX: 0.05, rightX: 0.55, leftY: 1 }); // gamepad deadzone is 0.1

    const frame = input.update(1);

    expect(input.activeSource.id).toBe('gamepad');
    expect(frame.yaw).toBe(0);
    expect(frame.roll).toBeCloseTo(0.5, 12);
    expect(frame.throttle).toBeCloseTo(1, 12);
  });

  it('applies the deadzone but no expo to the gimbal dial', () => {
    const { gamepad, input } = setup({ expo: 1 });
    gamepad.set({ gimbal: 0.55, leftY: 1 });

    expect(input.update(1).gimbal).toBeCloseTo(applyDeadzone(0.55, 0.1), 12);
  });

  it('keeps every output inside -1 to 1 even if a device reports more', () => {
    const { keyboard, input } = setup();
    keyboard.set({ leftX: 5, leftY: -5, rightX: 2, rightY: -2, gimbal: 9 });

    const frame = input.update(1);

    expect(frame).toMatchObject({ yaw: 1, throttle: -1, roll: 1, pitch: -1, gimbal: 1 });
  });

  it('offers the raw and the shaped stick positions for display', () => {
    const { gamepad, input } = setup({ expo: 0 });
    gamepad.set({ leftX: 0.05, leftY: 0.55 });
    input.update(1);

    expect(input.raw).toEqual({ leftX: 0.05, leftY: 0.55, rightX: 0, rightY: 0 });
    expect(input.shaped.leftX).toBe(0);
    expect(input.shaped.leftY).toBeCloseTo(0.5, 12);
  });
});

describe('InputManager and the stick command', () => {
  it('turns "both sticks down and inward" into the same stick command in every stick mode', () => {
    for (const stickMode of [1, 2, 3] as const) {
      const { keyboard, input } = setup({ stickMode });
      keyboard.set({ leftX: 1, leftY: -1, rightX: -1, rightY: -1 });

      const frame = input.update(1);

      expect(isStickCommand(frame), `stick mode ${stickMode}`).toBe(true);
    }
  });

  it('does the same for "both sticks down and outward"', () => {
    for (const stickMode of [1, 2, 3] as const) {
      const { keyboard, input } = setup({ stickMode });
      keyboard.set({ leftX: -1, leftY: -1, rightX: 1, rightY: -1 });

      expect(isStickCommand(input.update(1)), `stick mode ${stickMode}`).toBe(true);
    }
  });

  it('does not see a stick command in ordinary stick positions', () => {
    const { keyboard, input } = setup();
    keyboard.set({ leftX: 1, leftY: -1, rightX: 1, rightY: -1 }); // both sticks to the right

    expect(isStickCommand(input.update(1))).toBe(false);
  });
});

describe('InputManager choosing the source', () => {
  it('switches to a source when the pilot uses it while the active one is idle', () => {
    const { gamepad, input } = setup();

    gamepad.set({ rightY: 0.9 });
    input.update(1);

    expect(input.activeSource.id).toBe('gamepad');
  });

  it('switches on a button press or a mode selection too', () => {
    const first = setup();
    first.gamepad.set({ buttons: { rth: true } });
    first.input.update(1);
    expect(first.input.activeSource.id).toBe('gamepad');

    const second = setup();
    second.gamepad.set({ mode: 'S' });
    second.input.update(1);
    expect(second.input.activeSource.id).toBe('gamepad');
  });

  it('does not switch for a slightly off-centre stick', () => {
    const { gamepad, input } = setup();

    gamepad.set({ leftX: 0.2 }); // stick drift
    input.update(1);

    expect(input.activeSource.id).toBe('keyboard');
  });

  it('does not take the controls away from a source that is in use', () => {
    const { keyboard, gamepad, input } = setup({ expo: 0 });

    keyboard.set({ leftY: 1 });
    gamepad.set({ leftY: -1 });
    const frame = input.update(1);

    expect(input.activeSource.id).toBe('keyboard');
    expect(frame.throttle).toBe(1);
  });

  it('switches back when the pilot returns to the first source', () => {
    const { keyboard, gamepad, input } = setup();
    gamepad.set({ leftY: 1 });
    input.update(1);

    gamepad.set({});
    keyboard.set({ rightX: 1 });
    input.update(2);

    expect(input.activeSource.id).toBe('keyboard');
  });

  it('stays on the last used source while everything is idle', () => {
    const { gamepad, input } = setup();
    gamepad.set({ leftY: 1 });
    input.update(1);

    gamepad.set({});
    input.update(2);
    input.update(3);

    expect(input.activeSource.id).toBe('gamepad');
  });
});

describe('InputManager when the device is lost', () => {
  it('reports "not connected" with centred sticks, and does not fall back by itself', () => {
    const { gamepad, input } = setup();
    gamepad.set({ leftY: 1, buttons: { record: true } });
    input.update(1);

    gamepad.connected = false;
    const frame = input.update(2);

    expect(input.activeSource.id).toBe('gamepad');
    expect(frame).toMatchObject({
      t: 2,
      connected: false,
      roll: 0,
      pitch: 0,
      yaw: 0,
      throttle: 0,
      gimbal: 0,
      buttons: noButtonsPressed(),
    });
    expect(input.raw).toEqual({ leftX: 0, leftY: 0, rightX: 0, rightY: 0 });
  });

  it('carries on when the pilot uses another source', () => {
    const { keyboard, gamepad, input } = setup();
    gamepad.set({ leftY: 1 });
    input.update(1);
    gamepad.connected = false;
    input.update(2);

    keyboard.set({ leftY: 1 });
    const frame = input.update(3);

    expect(input.activeSource.id).toBe('keyboard');
    expect(frame.connected).toBe(true);
    expect(frame.throttle).toBe(1);
  });

  it('carries on when the device comes back', () => {
    const { gamepad, input } = setup();
    gamepad.set({ leftY: 1 });
    input.update(1);
    gamepad.connected = false;
    input.update(2);

    gamepad.connected = true;
    const frame = input.update(3);

    expect(frame.connected).toBe(true);
    expect(frame.throttle).toBe(1);
  });
});

describe('InputManager flight mode', () => {
  it('keeps the selected mode after the key or switch is released', () => {
    const { keyboard, input } = setup();

    keyboard.set({ mode: 'S' });
    expect(input.update(1).mode).toBe('S');

    keyboard.set({});
    expect(input.update(2).mode).toBe('S');

    keyboard.set({ mode: 'C' });
    expect(input.update(3).mode).toBe('C');
  });

  it('keeps the mode when the pilot changes to another device', () => {
    const { keyboard, gamepad, input } = setup();
    keyboard.set({ mode: 'S' });
    input.update(1);
    keyboard.set({});

    gamepad.set({ leftY: 1 });
    const frame = input.update(2);

    expect(input.activeSource.id).toBe('gamepad');
    expect(frame.mode).toBe('S');
  });

  it('keeps the mode while the device is lost', () => {
    const { gamepad, input } = setup();
    gamepad.set({ mode: 'C' });
    input.update(1);

    gamepad.connected = false;

    expect(input.update(2).mode).toBe('C');
  });
});
