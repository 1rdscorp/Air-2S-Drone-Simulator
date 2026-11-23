import { clampAxis } from './shaping';
import type { ButtonId, ControlSource, FlightMode, RawControls } from './types';

/** The parts of a browser `Gamepad` that this source reads. */
export interface GamepadLike {
  readonly connected: boolean;
  readonly id: string;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}

/** Returns the gamepads the browser knows about, like `navigator.getGamepads()`. */
export type GamepadReader = () => ArrayLike<GamepadLike | null>;

/**
 * Button numbers of the browser's "standard" gamepad layout (Xbox-style names).
 * https://w3c.github.io/gamepad/#remapping
 */
const BUTTON = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  leftBumper: 4,
  rightBumper: 5,
  leftTrigger: 6,
  rightTrigger: 7,
  dpadUp: 12,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

const BUTTON_MAP: Record<ButtonId, number> = {
  shutter: BUTTON.a,
  pause: BUTTON.b,
  record: BUTTON.x,
  rth: BUTTON.y,
  c1: BUTTON.leftBumper,
  c2: BUTTON.rightBumper,
};

const MODE_MAP: [number, FlightMode][] = [
  [BUTTON.dpadLeft, 'C'],
  [BUTTON.dpadUp, 'N'],
  [BUTTON.dpadRight, 'S'],
];

/**
 * A standard game controller (Xbox, PlayStation and similar) through the browser's
 * Gamepad API. Browsers only show a gamepad after one of its buttons has been pressed.
 *
 *   Left / right stick   the two control sticks
 *   Triggers             gimbal: right tilts up, left tilts down
 *   D-pad left/up/right  Cine / Normal / Sport
 *   A, B, X, Y           shutter, flight pause, record, return to home
 *   Bumpers              C1, C2
 */
export class GamepadSource implements ControlSource {
  readonly id = 'gamepad';
  /** Typical game-controller sticks do not return exactly to the centre. */
  readonly deadzone = 0.08;

  constructor(private readonly readGamepads: GamepadReader) {}

  get connected(): boolean {
    return this.find() !== null;
  }

  get label(): string {
    const pad = this.find();
    if (!pad) {
      return 'Gamepad';
    }
    // Browser names look like "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e ...)".
    const name = pad.id.replace(/\s*\(.*$/, '').trim();
    return name ? `Gamepad (${name})` : 'Gamepad';
  }

  poll(): RawControls | null {
    const pad = this.find();
    if (!pad) {
      return null;
    }

    const axis = (index: number): number => clampAxis(pad.axes[index] ?? 0);
    const pressed = (index: number): boolean => pad.buttons[index]?.pressed ?? false;
    const amount = (index: number): number => clampAxis(pad.buttons[index]?.value ?? 0);

    let mode: FlightMode | null = null;
    for (const [index, flightMode] of MODE_MAP) {
      if (pressed(index)) {
        mode = flightMode;
      }
    }

    const buttons: Partial<Record<ButtonId, boolean>> = {};
    for (const [id, index] of Object.entries(BUTTON_MAP) as [ButtonId, number][]) {
      if (pressed(index)) {
        buttons[id] = true;
      }
    }

    return {
      leftX: axis(0),
      // The browser reports "stick pulled back" as positive; we want forward positive.
      leftY: -axis(1) || 0,
      rightX: axis(2),
      rightY: -axis(3) || 0,
      gimbal: amount(BUTTON.rightTrigger) - amount(BUTTON.leftTrigger),
      mode,
      buttons,
    };
  }

  /** The first connected gamepad that has two sticks. */
  private find(): GamepadLike | null {
    let pads: ArrayLike<GamepadLike | null>;
    try {
      pads = this.readGamepads();
    } catch {
      return null; // the browser may refuse, for example inside a restricted frame
    }
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (pad?.connected && pad.axes.length >= 4) {
        return pad;
      }
    }
    return null;
  }
}
