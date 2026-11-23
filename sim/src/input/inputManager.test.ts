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

describe('buttons, mode and camera tilt from every device', () => {
  it('counts a button on another device while the active one flies', () => {
    const { keyboard, gamepad, input } = setup();
    gamepad.set({ rightY: 1 });
    input.update(0);
    expect(input.activeSource).toBe(gamepad);

    // The pilot holds the stick and presses T on the keyboard.
    keyboard.set({ buttons: { takeoffLand: true } });
    const frame = input.update(16);

    expect(input.activeSource).toBe(gamepad);
    expect(frame.pitch).toBeGreaterThan(0.5);
    expect(frame.buttons.takeoffLand).toBe(true);
    expect(frame.buttons.pause).toBe(false);
  });

  it('takes a flight mode chosen on another device', () => {
    const { keyboard, gamepad, input } = setup();
    gamepad.set({ rightX: 1 });
    input.update(0);

    keyboard.set({ mode: 'S' });
    expect(input.update(16).mode).toBe('S');
    expect(input.activeSource).toBe(gamepad);

    keyboard.set({});
    expect(input.update(32).mode).toBe('S');
  });

  it('prefers the active device when both choose a mode', () => {
    const { keyboard, gamepad, input } = setup();
    gamepad.set({ rightX: 1 });
    input.update(0);
    expect(input.activeSource).toBe(gamepad);

    gamepad.set({ rightX: 1, mode: 'C' });
    keyboard.set({ mode: 'S' });

    expect(input.update(16).mode).toBe('C');
  });

  it('tilts the camera from another device while the active one leaves it alone', () => {
    const { keyboard, gamepad, input } = setup();
    gamepad.set({ rightY: 1 });
    input.update(0);

    keyboard.set({ gimbal: -1 });
    expect(input.update(16).gimbal).toBe(-1);

    gamepad.set({ rightY: 1, gimbal: 0.5 });
    expect(input.update(32).gimbal).toBeCloseTo(applyDeadzone(0.5, 0.1), 9);
  });

  it('does not let another device move the sticks', () => {
    const { keyboard, gamepad, input } = setup({ expo: 0 });
    gamepad.set({ rightY: 1 });
    input.update(0);

    keyboard.set({ leftY: 1, rightX: 1, buttons: { pause: true } });
    const frame = input.update(16);

    expect(frame.throttle).toBe(0);
    expect(frame.roll).toBe(0);
    expect(frame.buttons.pause).toBe(true);
  });

  it('counts nothing from anywhere while the active device is lost', () => {
    const { keyboard, gamepad, input } = setup();
    gamepad.set({ rightY: 1 });
    input.update(0);
    gamepad.connected = false;

    // A key that was already held does not take over; nothing comes through.
    const frame = input.update(16);
    expect(frame.connected).toBe(false);
    expect(frame.buttons).toEqual(noButtonsPressed());

    keyboard.set({ buttons: { takeoffLand: true } });
    const next = input.update(32);
    expect(input.activeSource).toBe(keyboard);
    expect(next.connected).toBe(true);
    expect(next.buttons.takeoffLand).toBe(true);
  });
});

describe('a device with its own layout', () => {
  class FlightStick extends FakeSource {
    readonly stickMode = 2;
  }

  it('is read in its own layout, whatever stick mode the pilot has chosen', () => {
    const keyboard = new FakeSource('keyboard');
    const stick = new FlightStick('joystick');
    const input = new InputManager([keyboard, stick], { stickMode: 1, expo: 0 });
    expect(input.stickMode).toBe(1);

    stick.set({ leftY: 1, rightY: 0.5 });
    const frame = input.update(0);

    expect(input.activeSource).toBe(stick);
    expect(input.stickMode).toBe(2);
    expect(frame.throttle).toBe(1); // mode 2: left stick up is climb
    expect(frame.pitch).toBe(0.5);
  });

  it("leaves the pilot's stick mode in force for the other devices", () => {
    const keyboard = new FakeSource('keyboard');
    const stick = new FlightStick('joystick');
    const input = new InputManager([keyboard, stick], { stickMode: 1, expo: 0 });

    keyboard.set({ leftY: 1 });
    const frame = input.update(0);

    expect(input.stickMode).toBe(1);
    expect(frame.pitch).toBe(1); // mode 1: left stick up is forward
  });
});

describe('a flight stick shares the flight controls with the other devices', () => {
  /** A stick with controls for roll and pitch only, as before it is set up. */
  class PartStick extends FakeSource {
    readonly stickMode = 2;
    provides: ('roll' | 'pitch' | 'yaw' | 'throttle')[] = ['roll', 'pitch'];
  }

  function bench(): { keyboard: FakeSource; stick: PartStick; input: InputManager } {
    const keyboard = new FakeSource('keyboard');
    const stick = new PartStick('joystick');
    return { keyboard, stick, input: new InputManager([keyboard, stick], { expo: 0 }) };
  }

  it('takes what the stick has no control for from the keyboard', () => {
    const { keyboard, stick, input } = bench();
    stick.set({ rightX: 0.5, rightY: 1 });
    input.update(0);
    expect(input.activeSource).toBe(stick);

    // W and D on the keyboard: climb and turn right (stick mode 2: the left stick).
    keyboard.set({ leftY: 1, leftX: 1 });
    const frame = input.update(16);

    expect(input.activeSource).toBe(stick);
    expect(frame).toMatchObject({ roll: 0.5, pitch: 1, throttle: 1, yaw: 1 });
  });

  it('lets the stick fly while the keyboard is the device in use', () => {
    const { keyboard, stick, input } = bench();
    keyboard.set({ leftY: 1 }); // W held: climbing
    input.update(0);
    expect(input.activeSource).toBe(keyboard);

    stick.set({ rightY: 1, rightX: -0.4 });
    const frame = input.update(16);

    expect(input.activeSource).toBe(keyboard);
    expect(frame).toMatchObject({ throttle: 1, pitch: 1, roll: -0.4, yaw: 0 });
  });

  it('does not take from the stick what it has no control for', () => {
    const { keyboard, stick, input } = bench();
    keyboard.set({ leftY: 1 });
    input.update(0);

    // Stray values where the stick has nothing: they must not turn or climb.
    stick.set({ leftX: 1, leftY: -1, rightY: 0.5 });
    const frame = input.update(16);

    expect(frame.yaw).toBe(0);
    expect(frame.throttle).toBe(1);
    expect(frame.pitch).toBe(0.5);
  });

  it('prefers the active device where both have the control in use', () => {
    const { keyboard, stick, input } = bench();
    stick.set({ rightY: 1 });
    input.update(0);

    keyboard.set({ rightY: -1, leftY: 1 }); // arrow down, and W
    const frame = input.update(16);

    expect(frame.pitch).toBe(1); // the stick's, not the arrow key's
    expect(frame.throttle).toBe(1);
  });

  it("reads the keyboard in the pilot's stick mode and the stick in its own", () => {
    const keyboard = new FakeSource('keyboard');
    const stick = new PartStick('joystick');
    const input = new InputManager([keyboard, stick], { expo: 0, stickMode: 1 });
    stick.set({ rightY: 1 });
    input.update(0);

    // In stick mode 1 the keyboard's right stick up is climb.
    keyboard.set({ rightY: 1, leftX: -1 });
    const frame = input.update(16);

    expect(frame.pitch).toBe(1);
    expect(frame.throttle).toBe(1);
    expect(frame.yaw).toBe(-1);
  });

  it("shows the mixed result as the two sticks of the stick's layout", () => {
    const { keyboard, stick, input } = bench();
    stick.set({ rightY: 1 });
    input.update(0);
    keyboard.set({ leftY: 0.5 });
    input.update(16);

    expect(input.shaped).toEqual({ leftX: 0, leftY: 0.5, rightX: 0, rightY: 1 });
    expect(input.raw).toEqual({ leftX: 0, leftY: 0.5, rightX: 0, rightY: 1 });
  });

  it("gives the keyboard's stick command through while the stick is at rest", () => {
    const { keyboard, stick, input } = bench();
    stick.set({ rightX: 1 });
    input.update(0);
    stick.set({});

    keyboard.set({ leftX: 1, leftY: -1, rightX: -1, rightY: -1 }); // the K key
    const frame = input.update(16);

    expect(isStickCommand(frame)).toBe(true);
  });

  it('takes everything from a stick that has all four controls', () => {
    const { keyboard, stick, input } = bench();
    stick.provides = ['roll', 'pitch', 'yaw', 'throttle'];
    stick.set({ leftX: 0.3, leftY: 0.6, rightX: 0.2, rightY: 1 });
    input.update(0);

    keyboard.set({ leftY: -1 });
    const frame = input.update(16);

    expect(frame).toMatchObject({ yaw: 0.3, throttle: 0.6, roll: 0.2, pitch: 1 });
  });

  it('mixes nothing between keyboard and gamepad when no flight stick is involved', () => {
    const { keyboard, gamepad, input } = setup({ expo: 0 });
    gamepad.set({ rightY: 1 });
    input.update(0);

    keyboard.set({ leftY: 1 });
    const frame = input.update(16);

    expect(frame.pitch).toBeGreaterThan(0.9);
    expect(frame.throttle).toBe(0);
  });
});
