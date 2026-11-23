import type { ButtonId, ControlSource, FlightMode, RawControls } from './types';

type StickAxis = 'leftX' | 'leftY' | 'rightX' | 'rightY' | 'gimbal';

/**
 * Keys, by position on the keyboard (`KeyboardEvent.code`), so the layout is the same on
 * every keyboard language. The keyboard acts as two sticks: W A S D is the left stick,
 * the arrow keys are the right stick. What each stick does depends on the stick mode.
 */
const AXIS_KEYS: Record<string, { axis: StickAxis; direction: 1 | -1 }> = {
  KeyW: { axis: 'leftY', direction: 1 },
  KeyS: { axis: 'leftY', direction: -1 },
  KeyD: { axis: 'leftX', direction: 1 },
  KeyA: { axis: 'leftX', direction: -1 },
  ArrowUp: { axis: 'rightY', direction: 1 },
  ArrowDown: { axis: 'rightY', direction: -1 },
  ArrowRight: { axis: 'rightX', direction: 1 },
  ArrowLeft: { axis: 'rightX', direction: -1 },
  KeyR: { axis: 'gimbal', direction: 1 },
  KeyF: { axis: 'gimbal', direction: -1 },
};

const MODE_KEYS: Record<string, FlightMode> = {
  Digit1: 'C',
  Digit2: 'N',
  Digit3: 'S',
};

const BUTTON_KEYS: Record<string, ButtonId> = {
  KeyT: 'takeoffLand',
  KeyH: 'rth',
  Space: 'pause',
  KeyC: 'record',
  KeyB: 'shutter',
  KeyZ: 'c1',
  KeyX: 'c2',
};

/**
 * One key for the stick command that starts and stops the motors: it pulls both sticks
 * down and towards each other, which on a keyboard would otherwise take four keys at once.
 */
const STICK_COMMAND_KEY = 'KeyK';
const STICK_COMMAND: Record<Exclude<StickAxis, 'gimbal'>, number> = {
  leftX: 1,
  leftY: -1,
  rightX: -1,
  rightY: -1,
};

/**
 * A key is either down or up, but a stick that jumps to full deflection is hard to fly.
 * So a held key moves its stick towards full over a short time, and a short tap gives a
 * small deflection. These are stick travel per second.
 */
const PUSH_RATE = 5;
const RELEASE_RATE = 8;
/** Longest time between two polls that still moves the sticks, in seconds. */
const MAX_POLL_GAP_SECONDS = 0.1;

function approach(value: number, target: number, maxChange: number): number {
  const difference = target - value;
  if (Math.abs(difference) <= maxChange) {
    return target;
  }
  return value + Math.sign(difference) * maxChange;
}

/** The keyboard as a controller. Always available. */
export class KeyboardSource implements ControlSource {
  readonly id = 'keyboard';
  readonly label = 'Keyboard';
  readonly connected = true;
  readonly deadzone = 0;

  private readonly held = new Set<string>();
  /**
   * Keys pressed since the last poll. A quick tap can begin and end between two polls;
   * without this it would never be seen.
   */
  private readonly tapped = new Set<string>();
  private readonly sticks: Record<StickAxis, number> = {
    leftX: 0,
    leftY: 0,
    rightX: 0,
    rightY: 0,
    gimbal: 0,
  };
  private lastPollMs: number | null = null;

  /** True when this source uses the key, so the page should not also act on it. */
  handles(code: string): boolean {
    return (
      code in AXIS_KEYS || code in MODE_KEYS || code in BUTTON_KEYS || code === STICK_COMMAND_KEY
    );
  }

  keyDown(code: string): void {
    if (this.handles(code)) {
      this.held.add(code);
      this.tapped.add(code);
    }
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  /** Lets go of every key. Used when the window loses focus, so no key gets stuck. */
  releaseAll(): void {
    this.held.clear();
    this.tapped.clear();
  }

  /**
   * Starts listening to the keyboard.
   * @returns a function that stops listening again
   */
  attach(target: Window): () => void {
    const isTyping = (event: KeyboardEvent): boolean => {
      const element = event.target;
      return (
        element instanceof HTMLElement &&
        (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
      );
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event)) {
        return;
      }
      if (this.handles(event.code)) {
        this.keyDown(event.code);
        event.preventDefault(); // stops the arrow keys and Space from scrolling the page
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      this.keyUp(event.code);
    };
    const onBlur = (): void => {
      this.releaseAll();
    };

    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('blur', onBlur);
    return () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    };
  }

  poll(now: number): RawControls {
    const elapsed = this.lastPollMs === null ? 0 : (now - this.lastPollMs) / 1000;
    this.lastPollMs = now;
    const seconds = Math.min(Math.max(elapsed, 0), MAX_POLL_GAP_SECONDS);

    // Everything held now, plus anything tapped since the last poll.
    const active = new Set([...this.held, ...this.tapped]);
    this.tapped.clear();

    const targets: Record<StickAxis, number> = {
      leftX: 0,
      leftY: 0,
      rightX: 0,
      rightY: 0,
      gimbal: 0,
    };
    for (const code of active) {
      const key = AXIS_KEYS[code];
      if (key) {
        targets[key.axis] += key.direction; // opposite keys cancel out
      }
    }
    if (active.has(STICK_COMMAND_KEY)) {
      Object.assign(targets, STICK_COMMAND); // takes over both sticks
    }

    for (const axis of Object.keys(targets) as StickAxis[]) {
      const value = this.sticks[axis];
      const target = targets[axis];
      // Returning to centre, or coming back from the other side, is quicker than pushing out.
      const movingOut = target !== 0 && value * target >= 0;
      const rate = movingOut ? PUSH_RATE : RELEASE_RATE;
      this.sticks[axis] = approach(value, target, rate * seconds);
    }

    let mode: FlightMode | null = null;
    const buttons: Partial<Record<ButtonId, boolean>> = {};
    for (const code of active) {
      mode = MODE_KEYS[code] ?? mode;
      const button = BUTTON_KEYS[code];
      if (button) {
        buttons[button] = true;
      }
    }

    return { ...this.sticks, mode, buttons };
  }
}
