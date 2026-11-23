/** Flight modes of the aircraft: Cine, Normal, Sport. */
export const FLIGHT_MODES = ['C', 'N', 'S'] as const;
export type FlightMode = (typeof FLIGHT_MODES)[number];

export const FLIGHT_MODE_NAMES: Record<FlightMode, string> = {
  C: 'Cine',
  N: 'Normal',
  S: 'Sport',
};

/**
 * Buttons a controller can report. "takeoffLand" takes off from the ground and lands from
 * the air. "pause" is the flight pause (brake and hover).
 */
export const BUTTON_IDS = ['takeoffLand', 'rth', 'pause', 'record', 'shutter', 'c1', 'c2'] as const;
export type ButtonId = (typeof BUTTON_IDS)[number];

/**
 * Which stick does what.
 *   Mode 1: left = pitch + yaw,     right = throttle + roll
 *   Mode 2: left = throttle + yaw,  right = pitch + roll   (the usual default)
 *   Mode 3: left = pitch + roll,    right = throttle + yaw
 */
export const STICK_MODES = [1, 2, 3] as const;
export type StickMode = (typeof STICK_MODES)[number];

/**
 * Positions of the two physical sticks, each axis from -1 to 1.
 * X: right is positive. Y: pushed away from the pilot (up / forward) is positive.
 */
export interface StickPositions {
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
}

/** What a control source reports: the physical controls, before any mapping or shaping. */
export interface RawControls extends StickPositions {
  /** Gimbal dial deflection, -1 to 1. Positive tilts the camera up. */
  gimbal: number;
  /** Flight mode the source selects right now, or null when it has nothing to say. */
  mode: FlightMode | null;
  /** Buttons that are held down. A missing entry means not pressed. */
  buttons: Partial<Record<ButtonId, boolean>>;
}

/**
 * What the flight controller receives. It never knows which device produced it.
 * All stick values are -1 to 1, after stick-mode mapping, deadzone and expo.
 */
export interface ControlFrame {
  /** Time the controls were sampled, in milliseconds. */
  t: number;
  /** Positive rolls / flies right. */
  roll: number;
  /** Positive is stick forward: fly forward. */
  pitch: number;
  /** Positive turns right (clockwise seen from above). */
  yaw: number;
  /** Positive climbs, negative descends, zero holds height. */
  throttle: number;
  /** Gimbal dial deflection. Positive tilts the camera up. */
  gimbal: number;
  mode: FlightMode;
  buttons: Record<ButtonId, boolean>;
  /** False when the active control source has lost its device: failsafe behaviour applies. */
  connected: boolean;
}

/** A device that can control the drone: keyboard, gamepad, flight stick, the Bluetooth bridge, a recording. */
export interface ControlSource {
  /** Short stable name, for example 'keyboard' or 'gamepad'. */
  readonly id: string;
  /** Name to show to the pilot. */
  readonly label: string;
  readonly connected: boolean;
  /** Stick travel around the centre that counts as zero, 0 to 1. Depends on the hardware. */
  readonly deadzone: number;
  /**
   * Set by a source that has its own say on which control does what (a flight stick with
   * its mapping). The pilot's stick mode setting is then not applied to it.
   */
  readonly stickMode?: StickMode;
  /**
   * Set by a source that may have controls for only some of roll, pitch, yaw and throttle
   * (a flight stick): the ones it has. The others then come from another device, so a
   * stick can fly while the keyboard climbs and turns. Left out by sources that have all.
   */
  readonly provides?: readonly ('roll' | 'pitch' | 'yaw' | 'throttle')[];
  /**
   * The physical controls right now, or null when the device is not available.
   * @param now current time in milliseconds
   */
  poll(now: number): RawControls | null;
}

export function noButtonsPressed(): Record<ButtonId, boolean> {
  return {
    takeoffLand: false,
    rth: false,
    pause: false,
    record: false,
    shutter: false,
    c1: false,
    c2: false,
  };
}

/** A frame with everything centred and released. */
export function neutralFrame(t: number, mode: FlightMode, connected: boolean): ControlFrame {
  return {
    t,
    roll: 0,
    pitch: 0,
    yaw: 0,
    throttle: 0,
    gimbal: 0,
    mode,
    buttons: noButtonsPressed(),
    connected,
  };
}
