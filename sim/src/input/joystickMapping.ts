import { clampAxis } from './shaping';
import { BUTTON_IDS, type ButtonId, type FlightMode, type RawControls } from './types';

/**
 * Flight sticks, throttles and pedals: which of their controls does what.
 *
 * A game controller has a layout every browser knows. A flight stick has not: its axes
 * and buttons arrive as plain numbered lists, different for every model. So the pilot
 * shows the simulator once which control is which (the setup screen), and that mapping
 * is kept. It can use several devices at once, for example a stick and a throttle.
 *
 * Everything in this file is plain data and plain functions.
 */

/** What one device looks like at one moment. */
export interface JoystickDevice {
  /** The name the browser gives the device; also what a mapping remembers it by. */
  id: string;
  axes: readonly number[];
  buttons: readonly boolean[];
}

/** The controls an axis can be given to. */
export const JOYSTICK_AXES = ['roll', 'pitch', 'yaw', 'throttle', 'gimbal'] as const;
export type JoystickAxis = (typeof JOYSTICK_AXES)[number];

/** The jobs a button can be given: the simulator's buttons and the three flight modes. */
export const JOYSTICK_BUTTONS = [...BUTTON_IDS, 'modeC', 'modeN', 'modeS'] as const;
export type JoystickButton = (typeof JOYSTICK_BUTTONS)[number];

const MODE_BUTTONS: [JoystickButton, FlightMode][] = [
  ['modeC', 'C'],
  ['modeN', 'N'],
  ['modeS', 'S'],
];

export interface AxisBinding {
  device: string;
  axis: number;
  /** True when the device's positive direction is the opposite of ours. */
  invert: boolean;
  /**
   * True for a control that stays where it is put, such as a throttle lever. Its middle
   * then gets a wide zone that counts as centred, so "hold" can be found by hand.
   */
  lever: boolean;
}

/** A button, or an axis pushed far enough to one side (a hat switch or a thumb stick). */
export type ButtonBinding =
  { device: string; button: number } | { device: string; axis: number; direction: 1 | -1 };

export interface JoystickMapping {
  version: 1;
  axes: Partial<Record<JoystickAxis, AxisBinding>>;
  buttons: Partial<Record<JoystickButton, ButtonBinding>>;
}

/** Half-width of the centre zone of a lever, of its travel from the middle to one end. */
export const LEVER_CENTRE_ZONE = 0.2;

/** How far an axis must be pushed to count as a pressed button. */
export const AXIS_BUTTON_THRESHOLD = 0.6;

/**
 * A lever's position with a wide centre zone: inside the zone it reads 0, outside it
 * grows smoothly from 0 to full at the end of the travel.
 */
export function leverZone(value: number): number {
  const size = Math.abs(value);
  if (size <= LEVER_CENTRE_ZONE) {
    return 0;
  }
  return (Math.sign(value) * (Math.min(size, 1) - LEVER_CENTRE_ZONE)) / (1 - LEVER_CENTRE_ZONE);
}

function find(devices: readonly JoystickDevice[], id: string): JoystickDevice | undefined {
  return devices.find((device) => device.id === id);
}

/** The value of a bound axis, -1 to 1 in our direction. 0 when the device is missing. */
export function readAxis(binding: AxisBinding, devices: readonly JoystickDevice[]): number {
  const raw = find(devices, binding.device)?.axes[binding.axis];
  if (raw === undefined || !Number.isFinite(raw)) {
    return 0;
  }
  const value = clampAxis(binding.invert ? -raw : raw);
  const result = binding.lever ? leverZone(value) : value;
  return result === 0 ? 0 : result; // never minus zero
}

/** Whether a bound button is held. False when the device is missing. */
export function readButton(binding: ButtonBinding, devices: readonly JoystickDevice[]): boolean {
  const device = find(devices, binding.device);
  if (!device) {
    return false;
  }
  if ('button' in binding) {
    return device.buttons[binding.button] === true;
  }
  const value = device.axes[binding.axis] ?? 0;
  return value * binding.direction >= AXIS_BUTTON_THRESHOLD;
}

/** Every device a mapping uses, each once. */
export function mappedDevices(mapping: JoystickMapping): string[] {
  const ids = new Set<string>();
  for (const binding of Object.values(mapping.axes)) {
    ids.add(binding.device);
  }
  for (const binding of Object.values(mapping.buttons)) {
    ids.add(binding.device);
  }
  return [...ids];
}

/**
 * Reads the devices through a mapping. The four flight controls come out as the two
 * sticks of stick mode 2 (left: throttle and yaw, right: pitch and roll), which is the
 * form every control source reports in.
 */
export function applyMapping(
  mapping: JoystickMapping,
  devices: readonly JoystickDevice[],
): RawControls {
  const axis = (name: JoystickAxis): number => {
    const binding = mapping.axes[name];
    return binding ? readAxis(binding, devices) : 0;
  };
  const held = (name: JoystickButton): boolean => {
    const binding = mapping.buttons[name];
    return binding ? readButton(binding, devices) : false;
  };

  const buttons: Partial<Record<ButtonId, boolean>> = {};
  for (const id of BUTTON_IDS) {
    if (held(id)) {
      buttons[id] = true;
    }
  }
  let mode: FlightMode | null = null;
  for (const [button, flightMode] of MODE_BUTTONS) {
    if (held(button)) {
      mode = flightMode;
    }
  }

  return {
    leftX: axis('yaw'),
    leftY: axis('throttle'),
    rightX: axis('roll'),
    rightY: axis('pitch'),
    gimbal: axis('gimbal'),
    mode,
    buttons,
  };
}

/**
 * A first guess for a stick that has not been set up: left / right and forward / back on
 * its first two axes, which is what every joystick does. Nothing else is guessed: an
 * unknown axis may be a lever resting at one end, and would fly the aircraft by itself.
 */
export function guessMapping(devices: readonly JoystickDevice[]): JoystickMapping | null {
  const stick = devices.find((device) => device.axes.length >= 2);
  if (!stick) {
    return null;
  }
  return {
    version: 1,
    axes: {
      roll: { device: stick.id, axis: 0, invert: false, lever: false },
      // Browsers report "pulled back" as positive; forward is positive here.
      pitch: { device: stick.id, axis: 1, invert: true, lever: false },
    },
    buttons: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 256;
}

function parseAxisBinding(value: unknown): AxisBinding | null {
  if (!isRecord(value) || typeof value.device !== 'string' || !isIndex(value.axis)) {
    return null;
  }
  return {
    device: value.device,
    axis: value.axis,
    invert: value.invert === true,
    lever: value.lever === true,
  };
}

function parseButtonBinding(value: unknown): ButtonBinding | null {
  if (!isRecord(value) || typeof value.device !== 'string') {
    return null;
  }
  if (isIndex(value.button)) {
    return { device: value.device, button: value.button };
  }
  if (isIndex(value.axis) && (value.direction === 1 || value.direction === -1)) {
    return { device: value.device, axis: value.axis, direction: value.direction };
  }
  return null;
}

/**
 * Checks a mapping that was read back from storage. Anything that is not understood is
 * left out; null when nothing usable remains.
 */
export function parseMapping(value: unknown): JoystickMapping | null {
  if (!isRecord(value) || value.version !== 1) {
    return null;
  }
  const mapping: JoystickMapping = { version: 1, axes: {}, buttons: {} };
  if (isRecord(value.axes)) {
    for (const name of JOYSTICK_AXES) {
      const binding = parseAxisBinding(value.axes[name]);
      if (binding) {
        mapping.axes[name] = binding;
      }
    }
  }
  if (isRecord(value.buttons)) {
    for (const name of JOYSTICK_BUTTONS) {
      const binding = parseButtonBinding(value.buttons[name]);
      if (binding) {
        mapping.buttons[name] = binding;
      }
    }
  }
  const empty = Object.keys(mapping.axes).length === 0 && Object.keys(mapping.buttons).length === 0;
  return empty ? null : mapping;
}

/**
 * A device name fit to show. Browsers wrap the name in their own numbers:
 * Firefox "4098-bea8-WINCTRL Orion Joystick Base", Chrome "WINCTRL Orion Joystick Base
 * (Vendor: 4098 Product: bea8)".
 */
export function deviceName(id: string): string {
  const name = id
    .replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '')
    .replace(/\s*\((?:STANDARD GAMEPAD\s*)?Vendor:.*\)\s*$/i, '')
    .trim();
  return name || 'Flight stick';
}

// ---- Finding out which control the pilot is moving (for the setup screen) ----------------

export interface AxisRef {
  device: string;
  axis: number;
}

export interface AxisMove extends AxisRef {
  /** Which way it moved, in the device's own direction. */
  direction: 1 | -1;
  /** How far it moved from where it rested. */
  travel: number;
}

/** How far a control must be moved to be taken as "this one". */
export const DETECT_TRAVEL = 0.5;

const sameAxis = (a: AxisRef, b: AxisRef): boolean => a.device === b.device && a.axis === b.axis;

/**
 * The axis that has moved farthest from where it rested, if any has moved clearly.
 * @param rest the devices as they were before the pilot was asked to move something
 * @param ignore axes that already have a job
 */
export function detectAxisMove(
  rest: readonly JoystickDevice[],
  now: readonly JoystickDevice[],
  ignore: readonly AxisRef[] = [],
): AxisMove | null {
  let best: AxisMove | null = null;
  for (const device of now) {
    const before = find(rest, device.id);
    if (!before) {
      continue;
    }
    device.axes.forEach((value, axis) => {
      const change = value - (before.axes[axis] ?? value);
      const travel = Math.abs(change);
      const ref = { device: device.id, axis };
      if (travel < DETECT_TRAVEL || ignore.some((taken) => sameAxis(taken, ref))) {
        return;
      }
      if (!best || travel > best.travel) {
        best = { ...ref, direction: change > 0 ? 1 : -1, travel };
      }
    });
  }
  return best;
}

/**
 * The button that has been pressed since `rest`, or failing that an axis pushed to one
 * side (a hat switch counts as a button this way).
 * @param ignore axes that already fly the aircraft and must not double as buttons
 */
export function detectButtonPress(
  rest: readonly JoystickDevice[],
  now: readonly JoystickDevice[],
  ignore: readonly AxisRef[] = [],
): ButtonBinding | null {
  for (const device of now) {
    const before = find(rest, device.id);
    if (!before) {
      continue;
    }
    const button = device.buttons.findIndex(
      (pressed, index) => pressed && before.buttons[index] !== true,
    );
    if (button >= 0) {
      return { device: device.id, button };
    }
  }
  const move = detectAxisMove(rest, now, ignore);
  if (!move) {
    return null;
  }
  // Only an axis that ends far out counts, so a hat or thumb stick, not a small nudge.
  const value = find(now, move.device)?.axes[move.axis] ?? 0;
  return value * move.direction >= AXIS_BUTTON_THRESHOLD
    ? { device: move.device, axis: move.axis, direction: move.direction }
    : null;
}

/** True when no axis has changed by more than a hair between two moments. */
export function isSteady(
  before: readonly JoystickDevice[],
  now: readonly JoystickDevice[],
): boolean {
  return now.every((device) => {
    const earlier = find(before, device.id);
    return (
      earlier !== undefined &&
      device.axes.every((value, axis) => Math.abs(value - (earlier.axes[axis] ?? value)) < 0.03)
    );
  });
}

/**
 * What a binding is, in words: "axis 3 (reversed)" or "button 5", with the device's name
 * in front when `withDevice` is set.
 */
export function describeBinding(binding: AxisBinding | ButtonBinding, withDevice = true): string {
  let what: string;
  if ('button' in binding) {
    what = `button ${binding.button + 1}`;
  } else if ('direction' in binding) {
    what = `axis ${binding.axis + 1} pushed ${binding.direction > 0 ? 'one' : 'the other'} way`;
  } else {
    const notes = [binding.invert ? 'reversed' : '', binding.lever ? 'lever' : ''].filter(Boolean);
    what = `axis ${binding.axis + 1}${notes.length ? ` (${notes.join(', ')})` : ''}`;
  }
  return withDevice ? `${deviceName(binding.device)} · ${what}` : what;
}
