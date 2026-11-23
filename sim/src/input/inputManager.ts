import { applyDeadzone, clampAxis, shapeAxis } from './shaping';
import { AXIS_FUNCTIONS, mapSticks, sticksFromFunctions } from './stickModes';
import {
  BUTTON_IDS,
  type ControlFrame,
  type ControlSource,
  type FlightMode,
  neutralFrame,
  noButtonsPressed,
  type RawControls,
  type StickMode,
  type StickPositions,
} from './types';

export interface InputSettings {
  stickMode: StickMode;
  /** Expo curve strength for the sticks, 0 (straight) to 1. */
  expo: number;
}

export const DEFAULT_INPUT_SETTINGS: Readonly<InputSettings> = { stickMode: 2, expo: 0.3 };

/** How far a stick must move before an idle source counts as "being used". */
const ACTIVITY_THRESHOLD = 0.3;

const CENTRED: Readonly<StickPositions> = { leftX: 0, leftY: 0, rightX: 0, rightY: 0 };

function clampSticks(raw: StickPositions): StickPositions {
  return {
    leftX: clampAxis(raw.leftX),
    leftY: clampAxis(raw.leftY),
    rightX: clampAxis(raw.rightX),
    rightY: clampAxis(raw.rightY),
  };
}

function shapeSticks(raw: StickPositions, deadzone: number, expo: number): StickPositions {
  return {
    leftX: shapeAxis(raw.leftX, deadzone, expo),
    leftY: shapeAxis(raw.leftY, deadzone, expo),
    rightX: shapeAxis(raw.rightX, deadzone, expo),
    rightY: shapeAxis(raw.rightY, deadzone, expo),
  };
}

function isInUse(raw: RawControls | null): boolean {
  if (!raw) {
    return false;
  }
  return (
    Math.abs(raw.leftX) > ACTIVITY_THRESHOLD ||
    Math.abs(raw.leftY) > ACTIVITY_THRESHOLD ||
    Math.abs(raw.rightX) > ACTIVITY_THRESHOLD ||
    Math.abs(raw.rightY) > ACTIVITY_THRESHOLD ||
    Math.abs(raw.gimbal) > ACTIVITY_THRESHOLD ||
    raw.mode !== null ||
    BUTTON_IDS.some((id) => raw.buttons[id] === true)
  );
}

/**
 * Turns whatever device the pilot is using into one `ControlFrame`.
 *
 * One source is active at a time and flies the aircraft with its sticks. Another source
 * takes over when the pilot uses it while the active one is idle, so picking up a gamepad
 * or touching the keyboard just works.
 *
 * Buttons, the flight mode and the camera tilt count from every source at any time. A
 * pilot flying with a flight stick can so press T on the keyboard without letting go.
 *
 * A flight stick may have no control for turning or climbing. Whatever it has no control
 * for, or leaves centred, is then taken from another device, and the stick's own controls
 * count while another device is the active one. So the stick flies with the right hand
 * while W, S, A and D climb and turn with the left. Without a flight stick nothing is
 * mixed: one device has all four controls.
 *
 * If the active source loses its device, the frame says `connected: false` with centred
 * sticks and no buttons until the pilot uses another source.
 */
export class InputManager {
  readonly settings: InputSettings;

  private active: ControlSource;
  private mode: FlightMode = 'N';
  private latestFrame: ControlFrame;
  private rawSticks: StickPositions = { ...CENTRED };
  private shapedSticks: StickPositions = { ...CENTRED };

  /**
   * @param sources at least one; the first is active at the start
   */
  constructor(
    private readonly sources: readonly ControlSource[],
    settings: Partial<InputSettings> = {},
  ) {
    const first = sources[0];
    if (!first) {
      throw new Error('InputManager needs at least one control source');
    }
    this.active = first;
    this.settings = { ...DEFAULT_INPUT_SETTINGS, ...settings };
    this.latestFrame = neutralFrame(0, this.mode, first.connected);
  }

  /** The source whose controls are being used. */
  get activeSource(): ControlSource {
    return this.active;
  }

  /** The controls from the most recent `update`. */
  get frame(): ControlFrame {
    return this.latestFrame;
  }

  /** Stick positions as the device reports them, for display. */
  get raw(): Readonly<StickPositions> {
    return this.rawSticks;
  }

  /** Stick positions after deadzone and expo, for display. */
  get shaped(): Readonly<StickPositions> {
    return this.shapedSticks;
  }

  /** The stick mode in use: the active source's own if it has one, else the pilot's setting. */
  get stickMode(): StickMode {
    return this.active.stickMode ?? this.settings.stickMode;
  }

  /**
   * Read all sources and build the current frame. Call once per display frame.
   * @param now current time in milliseconds
   */
  update(now: number): ControlFrame {
    const polled = new Map<ControlSource, RawControls | null>();
    for (const source of this.sources) {
      polled.set(source, source.poll(now));
    }

    if (!isInUse(polled.get(this.active) ?? null)) {
      const taker = this.sources.find((source) => isInUse(polled.get(source) ?? null));
      if (taker) {
        this.active = taker;
      }
    }

    const raw = polled.get(this.active) ?? null;
    if (!raw || !this.active.connected) {
      this.rawSticks = { ...CENTRED };
      this.shapedSticks = { ...CENTRED };
      this.latestFrame = neutralFrame(now, this.mode, false);
      return this.latestFrame;
    }

    // Buttons, mode and camera tilt from the other sources count as well.
    const others: [ControlSource, RawControls][] = [];
    for (const source of this.sources) {
      const controls = polled.get(source);
      if (source !== this.active && controls && source.connected) {
        others.push([source, controls]);
      }
    }

    const selected = raw.mode ?? others.find(([, controls]) => controls.mode !== null)?.[1].mode;
    if (selected) {
      this.mode = selected;
    }

    const { deadzone } = this.active;
    const { expo } = this.settings;
    const stickMode = this.stickMode;
    const rawFunctions = mapSticks(clampSticks(raw), stickMode);
    const functions = mapSticks(shapeSticks(raw, deadzone, expo), stickMode);

    // A flight stick shares the four flight controls with the other devices.
    const has = this.active.provides;
    for (const name of AXIS_FUNCTIONS) {
      if ((!has || has.includes(name)) && functions[name] !== 0) {
        continue; // the active device has this control and is using it
      }
      for (const [source, controls] of others) {
        const partOfAStick = has !== undefined || source.provides !== undefined;
        if (!partOfAStick || (source.provides && !source.provides.includes(name))) {
          continue;
        }
        const layout = source.stickMode ?? this.settings.stickMode;
        const value = mapSticks(shapeSticks(controls, source.deadzone, expo), layout)[name];
        if (value !== 0) {
          functions[name] = value;
          rawFunctions[name] = mapSticks(clampSticks(controls), layout)[name];
          break;
        }
      }
    }
    // Shown as the two sticks of the layout in use, whichever device each value came from.
    this.rawSticks = sticksFromFunctions(rawFunctions, stickMode);
    this.shapedSticks = sticksFromFunctions(functions, stickMode);

    const buttons = noButtonsPressed();
    for (const id of BUTTON_IDS) {
      buttons[id] =
        raw.buttons[id] === true || others.some(([, controls]) => controls.buttons[id] === true);
    }

    let gimbal = applyDeadzone(raw.gimbal, deadzone);
    for (const [source, controls] of others) {
      if (gimbal === 0) {
        gimbal = applyDeadzone(controls.gimbal, source.deadzone);
      }
    }

    this.latestFrame = {
      t: now,
      ...functions,
      gimbal,
      mode: this.mode,
      buttons,
      connected: true,
    };
    return this.latestFrame;
  }
}
