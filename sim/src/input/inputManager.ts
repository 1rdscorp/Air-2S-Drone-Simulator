import { applyDeadzone, clampAxis, shapeAxis } from './shaping';
import { mapSticks } from './stickModes';
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
 * One source is active at a time. Another source takes over when the pilot uses it while
 * the active one is idle, so picking up a gamepad or touching the keyboard just works.
 * If the active source loses its device, the frame says `connected: false` with centred
 * sticks until the pilot uses another source.
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

    if (raw.mode !== null) {
      this.mode = raw.mode;
    }

    const { deadzone } = this.active;
    const { expo, stickMode } = this.settings;
    this.rawSticks = {
      leftX: clampAxis(raw.leftX),
      leftY: clampAxis(raw.leftY),
      rightX: clampAxis(raw.rightX),
      rightY: clampAxis(raw.rightY),
    };
    this.shapedSticks = {
      leftX: shapeAxis(raw.leftX, deadzone, expo),
      leftY: shapeAxis(raw.leftY, deadzone, expo),
      rightX: shapeAxis(raw.rightX, deadzone, expo),
      rightY: shapeAxis(raw.rightY, deadzone, expo),
    };

    const buttons = noButtonsPressed();
    for (const id of BUTTON_IDS) {
      buttons[id] = raw.buttons[id] === true;
    }

    this.latestFrame = {
      t: now,
      ...mapSticks(this.shapedSticks, stickMode),
      gimbal: applyDeadzone(raw.gimbal, deadzone),
      mode: this.mode,
      buttons,
      connected: true,
    };
    return this.latestFrame;
  }
}
