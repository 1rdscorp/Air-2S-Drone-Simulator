import { describe, expect, it } from 'vitest';
import {
  applyMapping,
  type AxisBinding,
  describeBinding,
  detectAxisMove,
  detectButtonPress,
  deviceName,
  guessMapping,
  isSteady,
  type JoystickDevice,
  type JoystickMapping,
  LEVER_CENTRE_ZONE,
  leverZone,
  mappedDevices,
  parseMapping,
  readAxis,
  readButton,
} from './joystickMapping';

const STICK = '4098-bea8-WINCTRL Orion Joystick Base Metal 2 + JGRIP-F16';
const THROTTLE = '4098-be62-WINCTRL Orion Throttle Base II + F15EX HANDLE';

/** A made-up device: axes as given, buttons pressed by number. */
function device(id: string, axes: number[], pressed: number[] = [], count = 16): JoystickDevice {
  return { id, axes, buttons: Array.from({ length: count }, (_, i) => pressed.includes(i)) };
}

const axisOn = (id: string, axis: number, more: Partial<AxisBinding> = {}): AxisBinding => ({
  device: id,
  axis,
  invert: false,
  lever: false,
  ...more,
});

describe('leverZone', () => {
  it('reads 0 around the middle of the lever', () => {
    expect(leverZone(0)).toBe(0);
    expect(leverZone(LEVER_CENTRE_ZONE)).toBe(0);
    expect(leverZone(-0.15)).toBe(0);
  });

  it('grows smoothly from the edge of the zone to full at the end of the travel', () => {
    expect(leverZone(0.6)).toBeCloseTo(0.5, 9);
    expect(leverZone(-0.6)).toBeCloseTo(-0.5, 9);
    expect(leverZone(1)).toBe(1);
    expect(leverZone(-1)).toBe(-1);
    expect(leverZone(1.4)).toBe(1);
  });
});

describe('readAxis', () => {
  const devices = [device(STICK, [0.5, -0.25, 0, 1.7, Number.NaN])];

  it('reads the bound axis', () => {
    expect(readAxis(axisOn(STICK, 0), devices)).toBe(0.5);
  });

  it('reverses it when asked', () => {
    expect(readAxis(axisOn(STICK, 1, { invert: true }), devices)).toBe(0.25);
  });

  it('keeps the value inside -1 to 1 and ignores nonsense', () => {
    expect(readAxis(axisOn(STICK, 3), devices)).toBe(1);
    expect(readAxis(axisOn(STICK, 4), devices)).toBe(0);
  });

  it('gives a lever its wide centre zone', () => {
    const lever = [device(THROTTLE, [0.1, 0.6])];

    expect(readAxis(axisOn(THROTTLE, 0, { lever: true }), lever)).toBe(0);
    expect(readAxis(axisOn(THROTTLE, 1, { lever: true }), lever)).toBeCloseTo(0.5, 9);
    expect(readAxis(axisOn(THROTTLE, 1, { lever: true, invert: true }), lever)).toBeCloseTo(
      -0.5,
      9,
    );
  });

  it('reads 0, never minus zero, for a missing device or axis', () => {
    expect(readAxis(axisOn('gone', 0), devices)).toBe(0);
    expect(readAxis(axisOn(STICK, 9), devices)).toBe(0);
    expect(Object.is(readAxis(axisOn(STICK, 2, { invert: true }), devices), 0)).toBe(true);
  });
});

describe('readButton', () => {
  const devices = [device(STICK, [0, 0, 1, -1, 0.3], [4])];

  it('reads a button', () => {
    expect(readButton({ device: STICK, button: 4 }, devices)).toBe(true);
    expect(readButton({ device: STICK, button: 5 }, devices)).toBe(false);
  });

  it('reads an axis pushed to one side as a button: a hat switch or thumb stick', () => {
    expect(readButton({ device: STICK, axis: 2, direction: 1 }, devices)).toBe(true);
    expect(readButton({ device: STICK, axis: 2, direction: -1 }, devices)).toBe(false);
    expect(readButton({ device: STICK, axis: 3, direction: -1 }, devices)).toBe(true);
    expect(readButton({ device: STICK, axis: 4, direction: 1 }, devices)).toBe(false); // only a nudge
  });

  it('is not pressed when the device is missing', () => {
    expect(readButton({ device: 'gone', button: 4 }, devices)).toBe(false);
    expect(readButton({ device: 'gone', axis: 2, direction: 1 }, devices)).toBe(false);
  });
});

describe('applyMapping', () => {
  const mapping: JoystickMapping = {
    version: 1,
    axes: {
      roll: axisOn(STICK, 0),
      pitch: axisOn(STICK, 1, { invert: true }),
      yaw: axisOn(STICK, 3),
      throttle: axisOn(THROTTLE, 0, { lever: true }),
      gimbal: axisOn(THROTTLE, 2),
    },
    buttons: {
      takeoffLand: { device: STICK, button: 2 },
      c2: { device: THROTTLE, button: 7 },
      modeS: { device: THROTTLE, button: 1 },
    },
  };

  it('puts the four flight controls where stick mode 2 has them, from several devices', () => {
    const controls = applyMapping(mapping, [
      device(STICK, [0.3, -0.8, 0, 0.5]),
      device(THROTTLE, [1, 0, -0.4]),
    ]);

    expect(controls).toMatchObject({
      rightX: 0.3, // roll
      rightY: 0.8, // pitch: forward is positive
      leftX: 0.5, // yaw
      leftY: 1, // throttle
      gimbal: -0.4,
      mode: null,
    });
    expect(controls.buttons).toEqual({});
  });

  it('reports buttons and the flight mode buttons', () => {
    const controls = applyMapping(mapping, [
      device(STICK, [0, 0, 0, 0], [2]),
      device(THROTTLE, [0, 0, 0], [1, 7]),
    ]);

    expect(controls.buttons).toEqual({ takeoffLand: true, c2: true });
    expect(controls.mode).toBe('S');
  });

  it('leaves a control that was given no job at rest', () => {
    const onlyRoll: JoystickMapping = { version: 1, axes: { roll: axisOn(STICK, 0) }, buttons: {} };
    const controls = applyMapping(onlyRoll, [device(STICK, [1, 1, 1, 1, 1, 1])]);

    expect(controls).toMatchObject({ rightX: 1, rightY: 0, leftX: 0, leftY: 0, gimbal: 0 });
  });

  it('lists every device it uses once', () => {
    expect(mappedDevices(mapping).sort()).toEqual([STICK, THROTTLE].sort());
  });
});

describe('guessMapping', () => {
  it('uses the first two axes of a stick for left / right and forward / back, nothing else', () => {
    const guess = guessMapping([device(STICK, [0, 0, 0, 0, 0, 0, -1, 0])]);

    expect(guess?.axes).toEqual({
      roll: axisOn(STICK, 0),
      pitch: axisOn(STICK, 1, { invert: true }),
    });
    expect(guess?.buttons).toEqual({});
  });

  it('does not let an unknown axis resting at one end fly the aircraft', () => {
    const devices = [device(STICK, [0, 0, 1, -1, 1, -1, -1, 1])];
    const guess = guessMapping(devices);
    const controls = guess ? applyMapping(guess, devices) : null;

    expect(controls).toMatchObject({ leftX: 0, leftY: 0, rightX: 0, rightY: 0, gimbal: 0 });
  });

  it('has no guess without a device with two axes', () => {
    expect(guessMapping([])).toBeNull();
    expect(guessMapping([device('pedal', [0])])).toBeNull();
  });
});

describe('parseMapping', () => {
  it('accepts what was saved', () => {
    const mapping: JoystickMapping = {
      version: 1,
      axes: {
        roll: axisOn(STICK, 0),
        throttle: axisOn(THROTTLE, 2, { invert: true, lever: true }),
      },
      buttons: {
        takeoffLand: { device: STICK, button: 3 },
        modeC: { device: STICK, axis: 9, direction: -1 },
      },
    };

    expect(parseMapping(JSON.parse(JSON.stringify(mapping)))).toEqual(mapping);
  });

  it('rejects anything that is not a mapping of this version', () => {
    for (const junk of [null, undefined, 7, 'text', [], {}, { version: 2, axes: {} }]) {
      expect(parseMapping(junk)).toBeNull();
    }
  });

  it('leaves out the parts it does not understand and keeps the rest', () => {
    const parsed = parseMapping({
      version: 1,
      axes: {
        roll: { device: STICK, axis: 0 },
        pitch: { device: STICK, axis: -1 },
        yaw: { device: 5, axis: 1 },
        flaps: { device: STICK, axis: 2 },
      },
      buttons: {
        pause: { device: STICK, button: 2.5 },
        c1: { device: STICK, axis: 4, direction: 0 },
        c2: { device: STICK, button: 6 },
      },
    });

    expect(parsed).toEqual({
      version: 1,
      axes: { roll: axisOn(STICK, 0) },
      buttons: { c2: { device: STICK, button: 6 } },
    });
  });

  it('is null when nothing usable is left', () => {
    expect(parseMapping({ version: 1, axes: { roll: 'x' }, buttons: {} })).toBeNull();
  });
});

describe('deviceName', () => {
  it('takes the numbers off that browsers put around the name', () => {
    expect(deviceName(STICK)).toBe('WINCTRL Orion Joystick Base Metal 2 + JGRIP-F16');
    expect(
      deviceName('WINCTRL Orion Joystick Base Metal 2 + JGRIP-F16 (Vendor: 4098 Product: bea8)'),
    ).toBe('WINCTRL Orion Joystick Base Metal 2 + JGRIP-F16');
    expect(deviceName('Xbox Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe(
      'Xbox Controller',
    );
  });

  it('keeps a name that only looks a little like those numbers', () => {
    expect(deviceName('T-16000M Joystick')).toBe('T-16000M Joystick');
  });

  it('has a plain name for a device without one', () => {
    expect(deviceName('')).toBe('Flight stick');
    expect(deviceName('044f-b10a-')).toBe('Flight stick');
  });
});

describe('detectAxisMove', () => {
  const rest = [device(STICK, [0, 0, 0, 0, -1]), device(THROTTLE, [-1, 0])];

  it('finds nothing while everything is where it rested', () => {
    expect(detectAxisMove(rest, rest)).toBeNull();
  });

  it('finds the axis that was moved, and which way', () => {
    const now = [device(STICK, [0, -0.9, 0, 0, -1]), device(THROTTLE, [-1, 0])];

    expect(detectAxisMove(rest, now)).toEqual({
      device: STICK,
      axis: 1,
      direction: -1,
      travel: 0.9,
    });
  });

  it('measures from where the control rested, so a lever at its end stop counts too', () => {
    const now = [device(STICK, [0, 0, 0, 0, -1]), device(THROTTLE, [0.8, 0])];

    expect(detectAxisMove(rest, now)).toMatchObject({ device: THROTTLE, axis: 0, direction: 1 });
  });

  it('takes the one that moved farthest when several moved', () => {
    const now = [device(STICK, [0.6, 0.95, 0, 0, -1]), device(THROTTLE, [-1, 0])];

    expect(detectAxisMove(rest, now)).toMatchObject({ axis: 1, direction: 1 });
  });

  it('ignores small movements', () => {
    const now = [device(STICK, [0.4, -0.3, 0, 0, -1]), device(THROTTLE, [-1, 0.2])];

    expect(detectAxisMove(rest, now)).toBeNull();
  });

  it('passes over axes that already have a job', () => {
    const now = [device(STICK, [1, 0.7, 0, 0, -1]), device(THROTTLE, [-1, 0])];

    expect(detectAxisMove(rest, now, [{ device: STICK, axis: 0 }])).toMatchObject({ axis: 1 });
    expect(
      detectAxisMove(rest, now, [
        { device: STICK, axis: 0 },
        { device: STICK, axis: 1 },
      ]),
    ).toBeNull();
  });

  it('ignores a device that was not there before', () => {
    expect(detectAxisMove([], [device(STICK, [1, 1])])).toBeNull();
  });
});

describe('detectButtonPress', () => {
  const rest = [device(STICK, [0, 0, 0, 0], [7])];

  it('finds a newly pressed button, not one that was held all along', () => {
    expect(detectButtonPress(rest, [device(STICK, [0, 0, 0, 0], [7])])).toBeNull();
    expect(detectButtonPress(rest, [device(STICK, [0, 0, 0, 0], [7, 3])])).toEqual({
      device: STICK,
      button: 3,
    });
  });

  it('takes a hat switch pushed to one side as a button', () => {
    expect(detectButtonPress(rest, [device(STICK, [0, 0, 0, -1], [7])])).toEqual({
      device: STICK,
      axis: 3,
      direction: -1,
    });
  });

  it('does not take a flight axis as a button, nor a half-pushed one', () => {
    const pushed = [device(STICK, [1, 0, 0, 0], [7])];

    expect(detectButtonPress(rest, pushed, [{ device: STICK, axis: 0 }])).toBeNull();
    expect(detectButtonPress(rest, [device(STICK, [0, 0, 0.55, 0], [7])])).toBeNull();
  });

  it('prefers a real button over an axis that moved at the same time', () => {
    expect(detectButtonPress(rest, [device(STICK, [0, 0, 1, 0], [7, 1])])).toEqual({
      device: STICK,
      button: 1,
    });
  });
});

describe('isSteady', () => {
  it('is true while no axis changes by more than a hair', () => {
    const before = [device(STICK, [0, 0.5, -1])];

    expect(isSteady(before, [device(STICK, [0.01, 0.49, -1])])).toBe(true);
    expect(isSteady(before, [device(STICK, [0.1, 0.5, -1])])).toBe(false);
  });

  it('is false when a device has just appeared', () => {
    expect(isSteady([], [device(STICK, [0, 0])])).toBe(false);
  });
});

describe('describeBinding', () => {
  it('counts axes and buttons from 1, as people do', () => {
    expect(describeBinding(axisOn(STICK, 0), false)).toBe('axis 1');
    expect(describeBinding({ device: STICK, button: 4 }, false)).toBe('button 5');
  });

  it('says when an axis is reversed or a lever', () => {
    expect(describeBinding(axisOn(STICK, 1, { invert: true }), false)).toBe('axis 2 (reversed)');
    expect(describeBinding(axisOn(THROTTLE, 0, { invert: true, lever: true }), false)).toBe(
      'axis 1 (reversed, lever)',
    );
  });

  it('names the device when asked', () => {
    expect(describeBinding({ device: STICK, button: 0 })).toBe(
      'WINCTRL Orion Joystick Base Metal 2 + JGRIP-F16 · button 1',
    );
  });
});
