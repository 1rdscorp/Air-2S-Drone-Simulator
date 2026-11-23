import { describe, expect, it } from 'vitest';
import type { GamepadLike } from './gamepadSource';
import type { JoystickMapping } from './joystickMapping';
import { joystickLabelText, JoystickSource } from './joystickSource';
import {
  browserStorage,
  JOYSTICK_STORAGE_KEY,
  loadJoystickMapping,
  type MappingStorage,
  saveJoystickMapping,
} from './joystickStorage';

const STICK = 'WINCTRL Orion Joystick Base Metal 2 + JGRIP-F16 (Vendor: 4098 Product: bea8)';
const THROTTLE = 'WINCTRL Orion Throttle Base II (Vendor: 4098 Product: be62)';

function pad(id: string, axes: number[], pressed: number[] = [], mapping = ''): GamepadLike {
  return {
    connected: true,
    id,
    mapping,
    axes,
    buttons: Array.from({ length: 12 }, (_, i) => ({
      pressed: pressed.includes(i),
      value: pressed.includes(i) ? 1 : 0,
    })),
  };
}

const TWO_DEVICES: JoystickMapping = {
  version: 1,
  axes: {
    roll: { device: STICK, axis: 0, invert: false, lever: false },
    pitch: { device: STICK, axis: 1, invert: true, lever: false },
    throttle: { device: THROTTLE, axis: 0, invert: true, lever: true },
  },
  buttons: { takeoffLand: { device: STICK, button: 1 } },
};

describe('JoystickSource', () => {
  it('has nothing to report without a flight stick', () => {
    const source = new JoystickSource(() => []);

    expect(source.status).toBe('none');
    expect(source.connected).toBe(false);
    expect(source.poll()).toBeNull();
    expect(source.devices()).toEqual([]);
  });

  it('leaves standard game controllers to the gamepad source', () => {
    const source = new JoystickSource(() => [
      pad('Xbox Controller (STANDARD GAMEPAD)', [1, 1, 1, 1], [], 'standard'),
    ]);

    expect(source.status).toBe('none');
    expect(source.poll()).toBeNull();
  });

  it('skips empty slots and devices that are not connected', () => {
    const unplugged = { ...pad(STICK, [0, 0]), connected: false };
    const source = new JoystickSource(() => [null, unplugged]);

    expect(source.devices()).toEqual([]);
  });

  it('flies a stick that was never set up on its first two axes only', () => {
    // Axis 7 rests at one end, as a slider or lever would.
    const source = new JoystickSource(() => [pad(STICK, [0.5, -1, 0, 0, 0, 0, 0, -1])]);

    expect(source.status).toBe('needsSetup');
    expect(source.connected).toBe(true);
    expect(source.poll()).toMatchObject({ rightX: 0.5, rightY: 1, leftX: 0, leftY: 0, gimbal: 0 });
    expect(source.hasButton('takeoffLand')).toBe(false);
  });

  it('uses the saved setup, across both devices', () => {
    const source = new JoystickSource(
      () => [pad(STICK, [0.2, 0.4], [1]), pad(THROTTLE, [-1])],
      TWO_DEVICES,
    );

    expect(source.status).toBe('ready');
    expect(source.poll()).toMatchObject({
      rightX: 0.2,
      rightY: -0.4,
      leftY: 1,
      buttons: { takeoffLand: true },
    });
    expect(source.hasButton('takeoffLand')).toBe(true);
    expect(source.hasButton('pause')).toBe(false);
  });

  it('says which flight controls it has, so that the keyboard can do the rest', () => {
    const unset = new JoystickSource(() => [pad(STICK, [0, 0, 0, 0])]);
    expect(unset.provides).toEqual(['roll', 'pitch']);

    const both = new JoystickSource(() => [pad(STICK, [0, 0]), pad(THROTTLE, [0])], TWO_DEVICES);
    expect(both.provides).toEqual(['roll', 'pitch', 'throttle']);

    expect(new JoystickSource(() => []).provides).toEqual([]);
  });

  it('does not fly with half a setup: one of its devices unplugged', () => {
    const source = new JoystickSource(() => [pad(STICK, [1, 1])], TWO_DEVICES);

    expect(source.status).toBe('missingDevice');
    expect(source.connected).toBe(false);
    expect(source.poll()).toBeNull();
  });

  it('falls back to the guess when a different stick is plugged in', () => {
    const source = new JoystickSource(() => [pad('Other Stick', [0.3, 0])], TWO_DEVICES);

    expect(source.status).toBe('needsSetup');
    expect(source.poll()).toMatchObject({ rightX: 0.3 });
  });

  it('says the saved stick is missing when nothing is plugged in', () => {
    expect(new JoystickSource(() => [], TWO_DEVICES).status).toBe('missingDevice');
  });

  it('follows a new setup at once', () => {
    const source = new JoystickSource(() => [pad(STICK, [0, 0, 0.7])]);
    source.mapping = {
      version: 1,
      axes: { yaw: { device: STICK, axis: 2, invert: false, lever: false } },
      buttons: {},
    };

    expect(source.status).toBe('ready');
    expect(source.poll()).toMatchObject({ leftX: 0.7, rightX: 0 });
  });

  it('counts as absent when the browser refuses to list devices', () => {
    const source = new JoystickSource(() => {
      throw new Error('not allowed');
    });

    expect(source.status).toBe('none');
    expect(source.poll()).toBeNull();
  });

  it('brings its own layout, has a small centre zone and a short name', () => {
    const source = new JoystickSource(() => []);

    expect(source.id).toBe('joystick');
    expect(source.stickMode).toBe(2);
    expect(source.deadzone).toBeLessThan(0.08);
    expect(source.label).toBe('Flight stick');
  });
});

describe('joystickLabelText', () => {
  it('says what the pilot can do about the flight stick', () => {
    expect(joystickLabelText('none')).toBe('');
    expect(joystickLabelText('needsSetup')).toBe('Flight stick found · press J to set it up');
    expect(joystickLabelText('ready')).toBe('Flight stick ready · J to change');
    expect(joystickLabelText('missingDevice')).toContain('not plugged in');
  });
});

describe('saving the setup', () => {
  function memory(): MappingStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
  }

  it('reads back what was saved', () => {
    const storage = memory();

    expect(loadJoystickMapping(storage)).toBeNull();
    expect(saveJoystickMapping(storage, TWO_DEVICES)).toBe(true);
    expect(loadJoystickMapping(storage)).toEqual(TWO_DEVICES);
    expect(storage.data.has(JOYSTICK_STORAGE_KEY)).toBe(true);
  });

  it('treats damaged data as no setup', () => {
    const storage = memory();
    storage.data.set(JOYSTICK_STORAGE_KEY, '{not json');
    expect(loadJoystickMapping(storage)).toBeNull();

    storage.data.set(JOYSTICK_STORAGE_KEY, '{"version":9}');
    expect(loadJoystickMapping(storage)).toBeNull();
  });

  it('carries on when the browser keeps nothing', () => {
    const refusing: MappingStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    };

    expect(loadJoystickMapping(refusing)).toBeNull();
    expect(saveJoystickMapping(refusing, TWO_DEVICES)).toBe(false);
    expect(loadJoystickMapping(null)).toBeNull();
    expect(saveJoystickMapping(null, TWO_DEVICES)).toBe(false);
  });

  it('has no browser storage outside a browser', () => {
    expect(browserStorage()).toBeNull();
  });
});
