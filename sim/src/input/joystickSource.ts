import type { GamepadLike, GamepadReader } from './gamepadSource';
import {
  applyMapping,
  guessMapping,
  type JoystickButton,
  type JoystickDevice,
  type JoystickMapping,
  mappedDevices,
} from './joystickMapping';
import type { ControlSource, RawControls } from './types';

/** What the pilot should be told about the flight stick. */
export type JoystickStatus =
  /** No flight stick is plugged in (or the browser has not shown it yet). */
  | 'none'
  /** A stick is there but has not been set up: only left / right and forward / back work. */
  | 'needsSetup'
  | 'ready'
  /** A setup exists, but one of its devices is not plugged in. */
  | 'missingDevice';

/**
 * Flight sticks, throttles and pedals: every game device the browser shows that is not a
 * standard game controller. They are read through a mapping made on the setup screen;
 * until there is one, a cautious guess makes the stick itself work.
 *
 * Browsers only show a device after one of its buttons has been pressed.
 */
export class JoystickSource implements ControlSource {
  readonly id = 'joystick';
  /** Flight sticks return to their centre precisely; a small zone is enough. */
  readonly deadzone = 0.04;
  /** The mapping already says which control does what, in the form of stick mode 2. */
  readonly stickMode = 2;

  /** The setup made by the pilot, or null when there is none. */
  mapping: JoystickMapping | null;

  constructor(
    private readonly readGamepads: GamepadReader,
    mapping: JoystickMapping | null = null,
  ) {
    this.mapping = mapping;
  }

  /** The flight devices plugged in right now. */
  devices(): JoystickDevice[] {
    let pads: ArrayLike<GamepadLike | null>;
    try {
      pads = this.readGamepads();
    } catch {
      return []; // the browser may refuse, for example inside a restricted frame
    }
    const found: JoystickDevice[] = [];
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      // A standard game controller belongs to the gamepad source.
      if (pad?.connected && pad.mapping !== 'standard') {
        found.push({
          id: pad.id,
          axes: Array.from(pad.axes),
          buttons: Array.from(pad.buttons, (button) => button.pressed),
        });
      }
    }
    return found;
  }

  get status(): JoystickStatus {
    return this.resolve(this.devices()).status;
  }

  get connected(): boolean {
    const status = this.status;
    return status === 'ready' || status === 'needsSetup';
  }

  /** Short on purpose: device names of flight sticks are long, and the setup screen shows them. */
  get label(): string {
    return 'Flight stick';
  }

  /** The flight controls the setup in use has a control for; the rest stays with the keyboard. */
  get provides(): ('roll' | 'pitch' | 'yaw' | 'throttle')[] {
    const axes = this.resolve(this.devices()).mapping?.axes ?? {};
    return (['roll', 'pitch', 'yaw', 'throttle'] as const).filter((name) => axes[name]);
  }

  /** Whether the mapping in use gives this job to a button on the stick. */
  hasButton(button: JoystickButton): boolean {
    return this.resolve(this.devices()).mapping?.buttons[button] !== undefined;
  }

  poll(): RawControls | null {
    const devices = this.devices();
    const { mapping, status } = this.resolve(devices);
    if (!mapping || status === 'missingDevice') {
      return null;
    }
    return applyMapping(mapping, devices);
  }

  /** Which mapping applies to the devices that are there, and what to tell the pilot. */
  private resolve(devices: readonly JoystickDevice[]): {
    mapping: JoystickMapping | null;
    status: JoystickStatus;
  } {
    const saved = this.mapping;
    if (saved) {
      const wanted = mappedDevices(saved);
      const present = wanted.filter((id) => devices.some((device) => device.id === id));
      if (present.length === wanted.length) {
        return { mapping: saved, status: 'ready' };
      }
      if (present.length > 0) {
        // Half a setup must not fly: with the throttle unplugged the stick alone would.
        return { mapping: saved, status: 'missingDevice' };
      }
      // None of the saved devices is here; another stick may be. Fall through to the guess.
    }
    const guess = guessMapping(devices);
    if (guess) {
      return { mapping: guess, status: 'needsSetup' };
    }
    return { mapping: null, status: saved ? 'missingDevice' : 'none' };
  }
}

/** The line that tells the pilot about the flight stick; empty when there is nothing to say. */
export function joystickLabelText(status: JoystickStatus): string {
  switch (status) {
    case 'none':
      return '';
    case 'needsSetup':
      return 'Flight stick found · press J to set it up';
    case 'ready':
      return 'Flight stick ready · J to change';
    case 'missingDevice':
      return 'Flight stick not plugged in · J to set up again';
  }
}
