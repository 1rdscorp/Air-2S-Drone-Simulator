import {
  type AxisRef,
  type ButtonBinding,
  describeBinding,
  detectAxisMove,
  detectButtonPress,
  deviceName,
  isSteady,
  JOYSTICK_AXES,
  type JoystickAxis,
  type JoystickButton,
  type JoystickDevice,
  type JoystickMapping,
  mappedDevices,
} from '../input/joystickMapping';

/** One question of the setup: which control should do this? */
export type SetupStep =
  | { kind: 'axis'; id: JoystickAxis; title: string; ask: string }
  | { kind: 'button'; id: JoystickButton; title: string; ask: string };

/**
 * The questions, in order. Every axis is asked for in the direction that counts as
 * positive in the simulator (right, forward, up), so the direction of the answer tells
 * whether the device's axis has to be reversed.
 */
export const SETUP_STEPS: readonly SetupStep[] = [
  {
    kind: 'axis',
    id: 'roll',
    title: 'Fly right',
    ask: 'Push the stick to the RIGHT and hold it there.',
  },
  {
    kind: 'axis',
    id: 'pitch',
    title: 'Fly forward',
    ask: 'Push the stick FORWARD, away from you, and hold it there.',
  },
  {
    kind: 'axis',
    id: 'yaw',
    title: 'Turn right',
    ask: 'Move the control you want for turning to the RIGHT and hold it: a small thumb stick, a twist grip, or pedals (right pedal forward).',
  },
  {
    kind: 'axis',
    id: 'throttle',
    title: 'Climb',
    ask: 'Move the control you want for climbing UP or FORWARD and hold it: a small thumb stick or a throttle lever.',
  },
  {
    kind: 'axis',
    id: 'gimbal',
    title: 'Camera up',
    ask: 'Move the control you want for tilting the camera UP and hold it.',
  },
  {
    kind: 'button',
    id: 'takeoffLand',
    title: 'Take off and land',
    ask: 'Press the button you want for take-off and landing.',
  },
  {
    kind: 'button',
    id: 'pause',
    title: 'Flight pause',
    ask: 'Press the button you want for flight pause (stop and hover).',
  },
  {
    kind: 'button',
    id: 'c1',
    title: 'Camera level',
    ask: 'Press the button that should level the camera.',
  },
  {
    kind: 'button',
    id: 'c2',
    title: 'Camera straight down',
    ask: 'Press the button that should point the camera straight down.',
  },
  {
    kind: 'button',
    id: 'modeC',
    title: 'Cine mode',
    ask: 'Press the button for Cine mode (slow).',
  },
  { kind: 'button', id: 'modeN', title: 'Normal mode', ask: 'Press the button for Normal mode.' },
  {
    kind: 'button',
    id: 'modeS',
    title: 'Sport mode',
    ask: 'Press the button for Sport mode (fast).',
  },
  // TODO(step-26): return to home; TODO(step-28): record and photo. They do nothing yet.
];

/**
 * Where the setup is:
 *   noDevice  no flight stick is plugged in (or the browser has not shown it yet)
 *   settling  waiting for every control to be at rest before asking
 *   waiting   the question is on the screen
 *   holding   a control is being moved; it counts once it has been held for a moment
 *   release   the answer was taken; the pilot lets go
 *   summary   all questions asked; the result is shown before it is saved
 */
export type SetupPhase = 'noDevice' | 'settling' | 'waiting' | 'holding' | 'release' | 'summary';

/** How long things take, in milliseconds. */
export const SETUP_TIMING = {
  /** Controls must be at rest this long before a question is asked. */
  settle: 400,
  /** An axis must be held this long to count, a button this long. */
  holdAxis: 350,
  holdButton: 80,
  /** "Got it" stays on the screen at least this long. */
  release: 600,
} as const;

/** A control that stays this far from where it rested, after being let go, is a lever. */
const LEVER_STAYS_AWAY = 0.4;
/** A control that rests this far from its middle is a lever too. */
const LEVER_RESTS_AT_END = 0.6;

type Answer =
  { kind: 'axis'; axis: AxisRef; direction: 1 | -1 } | { kind: 'button'; binding: ButtonBinding };

function sameAnswer(a: Answer | null, b: Answer | null): boolean {
  if (!a || !b || a.kind !== b.kind) {
    return false;
  }
  if (a.kind === 'axis' && b.kind === 'axis') {
    return (
      a.axis.device === b.axis.device && a.axis.axis === b.axis.axis && a.direction === b.direction
    );
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The setup itself, without a screen: it is told the time and what the devices report,
 * and works out which control the pilot means. Kept apart from the page so that every
 * path through it can be tested with made-up devices.
 */
export class SetupSession {
  private index = 0;
  private current: SetupPhase = 'settling';
  private phaseSince: number;
  private steadySince: number;
  private steadySample: readonly JoystickDevice[];
  private rest: readonly JoystickDevice[] = [];
  private candidate: Answer | null = null;
  private heldSince = 0;
  private lastCaptured: string | null = null;
  /** The axis taken in the step before, to see whether it springs back: [job, where it rested]. */
  private watchLever: { id: JoystickAxis; ref: AxisRef; rest: number } | null = null;
  private readonly result: JoystickMapping = { version: 1, axes: {}, buttons: {} };

  constructor(now: number, devices: readonly JoystickDevice[]) {
    this.phaseSince = now;
    this.steadySince = now;
    this.steadySample = devices;
    if (devices.length === 0) {
      this.current = 'noDevice';
    }
  }

  get phase(): SetupPhase {
    return this.current;
  }

  /** The question on the screen, or null on the summary. */
  get step(): SetupStep | null {
    return this.current === 'summary' ? null : (SETUP_STEPS[this.index] ?? null);
  }

  get stepNumber(): number {
    return Math.min(this.index + 1, SETUP_STEPS.length);
  }

  /** How far the control has been held towards being taken, 0 to 1. */
  progress(now: number): number {
    if (this.current !== 'holding' || !this.candidate) {
      return 0;
    }
    const needed = this.candidate.kind === 'axis' ? SETUP_TIMING.holdAxis : SETUP_TIMING.holdButton;
    return Math.min((now - this.heldSince) / needed, 1);
  }

  /** What was taken in the last answered step, in words. */
  get captured(): string | null {
    return this.lastCaptured;
  }

  /** The mapping so far; complete once the phase is 'summary'. */
  get mapping(): JoystickMapping {
    return this.result;
  }

  /** True when at least one control has been given a job. */
  get hasAnything(): boolean {
    return Object.keys(this.result.axes).length + Object.keys(this.result.buttons).length > 0;
  }

  /** Call for every frame with the time in milliseconds and what the devices report. */
  update(now: number, devices: readonly JoystickDevice[]): void {
    if (this.current === 'summary') {
      return;
    }
    if (devices.length === 0) {
      this.enter('noDevice', now);
      return;
    }
    if (this.current === 'noDevice') {
      this.startSettling(now, devices);
    }

    // Keep track of how long everything has been at rest.
    if (!isSteady(this.steadySample, devices)) {
      this.steadySample = devices;
      this.steadySince = now;
    }

    switch (this.current) {
      case 'release':
        if (now - this.phaseSince >= SETUP_TIMING.release) {
          this.startSettling(now, devices);
        }
        break;

      case 'settling':
        if (now - this.steadySince >= SETUP_TIMING.settle) {
          this.decideLever(devices);
          this.rest = devices;
          this.enter('waiting', now);
        }
        break;

      case 'waiting': {
        const found = this.detect(devices);
        if (found) {
          this.candidate = found;
          this.heldSince = now;
          this.enter('holding', now);
        }
        break;
      }

      case 'holding': {
        const found = this.detect(devices);
        if (!sameAnswer(found, this.candidate)) {
          this.candidate = null;
          this.enter('waiting', now);
        } else if (this.progress(now) >= 1 && this.candidate) {
          this.take(this.candidate);
          this.enter('release', now);
        }
        break;
      }
    }
  }

  /** Leaves the current control without a job and goes on. */
  skip(now: number, devices: readonly JoystickDevice[]): void {
    if (this.current === 'summary') {
      return;
    }
    this.clearStep();
    this.lastCaptured = null;
    this.advance(now, devices);
  }

  /** Goes back one question, forgetting its answer. */
  back(now: number, devices: readonly JoystickDevice[]): void {
    if (this.current === 'summary') {
      this.index = SETUP_STEPS.length - 1;
    } else if (this.index > 0) {
      this.index--;
    } else {
      return;
    }
    this.clearStep();
    this.lastCaptured = null;
    this.watchLever = null;
    this.startSettling(now, devices);
  }

  /** On the summary: says whether the climb control is a lever that stays where it is put. */
  toggleThrottleLever(): void {
    const throttle = this.result.axes.throttle;
    if (throttle) {
      throttle.lever = !throttle.lever;
    }
  }

  private detect(devices: readonly JoystickDevice[]): Answer | null {
    const step = SETUP_STEPS[this.index];
    if (!step) {
      return null;
    }
    const taken = this.takenAxes();
    if (step.kind === 'axis') {
      const move = detectAxisMove(this.rest, devices, taken);
      return move
        ? {
            kind: 'axis',
            axis: { device: move.device, axis: move.axis },
            direction: move.direction,
          }
        : null;
    }
    const binding = detectButtonPress(this.rest, devices, taken);
    if (!binding) {
      return null;
    }
    // A button that already has a job is not offered again.
    const used = Object.values(this.result.buttons).some(
      (other) => JSON.stringify(other) === JSON.stringify(binding),
    );
    return used ? null : { kind: 'button', binding };
  }

  private take(answer: Answer): void {
    const step = SETUP_STEPS[this.index];
    if (!step) {
      return;
    }
    if (answer.kind === 'axis' && step.kind === 'axis') {
      const binding = { ...answer.axis, invert: answer.direction < 0, lever: false };
      this.result.axes[step.id] = binding;
      const rested =
        this.rest.find((device) => device.id === answer.axis.device)?.axes[answer.axis.axis] ?? 0;
      this.watchLever =
        step.id === 'throttle' || step.id === 'gimbal'
          ? { id: step.id, ref: answer.axis, rest: rested }
          : null;
      this.lastCaptured = `${step.title}: ${describeBinding(binding, false)}`;
    } else if (answer.kind === 'button' && step.kind === 'button') {
      this.result.buttons[step.id] = answer.binding;
      this.watchLever = null;
      this.lastCaptured = `${step.title}: ${describeBinding(answer.binding, false)}`;
    }
    this.candidate = null;
    this.index++;
  }

  /**
   * Once things are at rest again: a control that did not come back to where it rested,
   * or that rests at one end, is a lever and gets the wide centre zone.
   */
  private decideLever(devices: readonly JoystickDevice[]): void {
    const watch = this.watchLever;
    this.watchLever = null;
    const binding = watch ? this.result.axes[watch.id] : undefined;
    if (!watch || !binding) {
      return;
    }
    const value = devices.find((device) => device.id === watch.ref.device)?.axes[watch.ref.axis];
    if (value === undefined) {
      return;
    }
    binding.lever =
      Math.abs(value - watch.rest) > LEVER_STAYS_AWAY || Math.abs(watch.rest) > LEVER_RESTS_AT_END;
  }

  private takenAxes(): AxisRef[] {
    return JOYSTICK_AXES.flatMap((name) => {
      const binding = this.result.axes[name];
      return binding ? [{ device: binding.device, axis: binding.axis }] : [];
    });
  }

  private clearStep(): void {
    const step = SETUP_STEPS[this.index];
    if (step?.kind === 'axis') {
      delete this.result.axes[step.id];
    } else if (step?.kind === 'button') {
      delete this.result.buttons[step.id];
    }
    this.candidate = null;
  }

  private advance(now: number, devices: readonly JoystickDevice[]): void {
    this.index++;
    this.watchLever = null;
    this.startSettling(now, devices);
  }

  private startSettling(now: number, devices: readonly JoystickDevice[]): void {
    if (this.index >= SETUP_STEPS.length) {
      this.decideLever(devices);
      this.enter('summary', now);
      return;
    }
    this.steadySample = devices;
    this.steadySince = now;
    this.enter(devices.length === 0 ? 'noDevice' : 'settling', now);
  }

  private enter(phase: SetupPhase, now: number): void {
    if (phase !== this.current) {
      this.current = phase;
      this.phaseSince = now;
    }
  }
}

/**
 * The summary: every job with the control it was given, in the order they were asked.
 * With a single device its name is said once at the top instead of on every line.
 */
export function summaryLines(mapping: JoystickMapping): string[] {
  const devices = mappedDevices(mapping);
  const single = devices.length === 1;
  const lines = SETUP_STEPS.map((step) => {
    const binding = step.kind === 'axis' ? mapping.axes[step.id] : mapping.buttons[step.id];
    return `${step.title}: ${binding ? describeBinding(binding, !single) : 'not set'}`;
  });
  return single && devices[0] ? [deviceName(devices[0]), ...lines] : lines;
}

export interface JoystickSetupHost {
  /** The flight devices plugged in right now. */
  devices(): JoystickDevice[];
  /** Called with the finished mapping when the pilot saves it. */
  onSave(mapping: JoystickMapping): void;
  /** Called when the screen opens and when it closes, whatever the outcome. */
  onOpenChange(open: boolean): void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/**
 * The setup screen for flight sticks: one question at a time ("push the stick to the
 * right"), answered by moving the control. While it is open it takes the keyboard:
 * Enter skips a control or saves, Backspace goes back, Esc closes without saving.
 */
export class JoystickSetupScreen {
  private session: SetupSession | null = null;
  private readonly counter: HTMLElement;
  private readonly title: HTMLElement;
  private readonly ask: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly note: HTMLElement;
  private readonly live: HTMLElement;
  private readonly skipButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;
  private shown = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly host: JoystickSetupHost,
  ) {
    root.replaceChildren();
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Flight stick setup');

    const panel = element('div', 'js-panel');
    const head = element('header', 'js-head');
    head.append(element('h2', 'js-heading', 'Flight stick setup'));
    this.counter = element('span', 'js-counter');
    head.append(this.counter);

    this.title = element('p', 'js-title');
    this.title.dataset.setup = 'title';
    this.ask = element('p', 'js-ask');
    this.ask.dataset.setup = 'ask';
    const track = element('div', 'js-track');
    this.bar = element('i', 'js-bar');
    track.append(this.bar);
    this.note = element('p', 'js-note');
    this.note.dataset.setup = 'note';
    this.live = element('pre', 'js-live');
    this.live.dataset.setup = 'devices';

    const foot = element('footer', 'js-foot');
    this.skipButton = element('button', 'js-button');
    this.skipButton.type = 'button';
    this.skipButton.dataset.setup = 'skip';
    this.backButton = element('button', 'js-button js-quiet', 'Back (Backspace)');
    this.backButton.type = 'button';
    this.backButton.dataset.setup = 'back';
    const cancel = element('button', 'js-button js-quiet', 'Close without saving (Esc)');
    cancel.type = 'button';
    cancel.dataset.setup = 'cancel';
    foot.append(this.skipButton, this.backButton, cancel);

    panel.append(head, this.title, this.ask, track, this.note, this.live, foot);
    root.append(panel);

    this.skipButton.addEventListener('click', () => {
      this.confirm();
    });
    this.backButton.addEventListener('click', () => {
      this.back();
    });
    cancel.addEventListener('click', () => {
      this.close();
    });
  }

  get isOpen(): boolean {
    return this.session !== null;
  }

  open(now: number): void {
    if (this.session) {
      return;
    }
    this.session = new SetupSession(now, this.host.devices());
    this.root.hidden = false;
    this.host.onOpenChange(true);
    this.update(now);
  }

  close(): void {
    if (!this.session) {
      return;
    }
    this.session = null;
    this.root.hidden = true;
    this.shown = '';
    this.host.onOpenChange(false);
  }

  /**
   * Handles a key while the screen is open.
   * @returns true when the key was meant for the screen and must go nowhere else
   */
  handleKey(code: string, now: number): boolean {
    if (!this.session) {
      return false;
    }
    switch (code) {
      case 'Enter':
      case 'NumpadEnter':
        this.confirm(now);
        break;
      case 'Backspace':
        this.back(now);
        break;
      case 'Escape':
        this.close();
        break;
      case 'KeyL':
        if (this.session.phase === 'summary') {
          this.session.toggleThrottleLever();
        }
        break;
    }
    // Every other key is swallowed as well: nothing flies while the setup is open.
    return true;
  }

  /** Call for every frame while the screen is open. */
  update(now: number): void {
    const session = this.session;
    if (!session) {
      return;
    }
    const devices = this.host.devices();
    session.update(now, devices);
    this.render(session, now, devices);
  }

  private confirm(now = performance.now()): void {
    const session = this.session;
    if (!session) {
      return;
    }
    if (session.phase !== 'summary') {
      session.skip(now, this.host.devices());
      return;
    }
    if (session.hasAnything) {
      this.host.onSave(session.mapping);
    }
    this.close();
  }

  private back(now = performance.now()): void {
    this.session?.back(now, this.host.devices());
  }

  private render(session: SetupSession, now: number, devices: readonly JoystickDevice[]): void {
    const step = session.step;
    const lines = devices.map((device) => {
      const axes = device.axes
        .slice(0, 12)
        .map((value) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`)
        .join(' ');
      const pressed = device.buttons.flatMap((down, index) => (down ? [index + 1] : []));
      return `${deviceName(device.id)}\n  axes     ${axes || '–'}\n  buttons  ${pressed.join(' ') || '–'}`;
    });

    let title: string;
    let ask: string;
    let note = session.captured ? `Got it. ${session.captured}` : '';
    let confirmLabel = 'Skip this control (Enter)';
    if (session.phase === 'noDevice') {
      title = 'No flight stick found';
      ask =
        'Plug it in and press any button on it. Browsers only show a stick after a button press.';
      note = '';
    } else if (session.phase === 'summary') {
      title = 'Done';
      ask = session.hasAnything
        ? 'Check the list, then save it.'
        : 'No control was set, so there is nothing to save.';
      const throttle = session.mapping.axes.throttle;
      note = [
        ...summaryLines(session.mapping),
        ...(throttle
          ? [
              '',
              `The climb control ${throttle.lever ? 'is a lever that stays where it is put: its middle means "hold height"' : 'springs back to its middle by itself'}. Press L to change this.`,
            ]
          : []),
      ].join('\n');
      confirmLabel = session.hasAnything ? 'Save (Enter)' : 'Close (Enter)';
    } else {
      title = step?.title ?? '';
      ask = step?.ask ?? '';
      if (session.phase === 'release') {
        ask = 'Now let go.';
      } else if (session.phase === 'settling') {
        ask = `${ask}\nFirst let go of everything…`;
      }
    }

    const counter =
      session.phase === 'summary' ? '' : `${session.stepNumber} of ${SETUP_STEPS.length}`;
    const progress = session.progress(now);
    const signature = [session.phase, counter, title, ask, note, confirmLabel].join('|');
    if (signature !== this.shown) {
      this.shown = signature;
      this.root.dataset.phase = session.phase;
      this.counter.textContent = counter;
      this.title.textContent = title;
      this.ask.textContent = ask;
      this.note.textContent = note;
      this.skipButton.textContent = confirmLabel;
    }
    this.bar.style.width = `${Math.round(progress * 100)}%`;
    const live = lines.join('\n');
    if (this.live.textContent !== live) {
      this.live.textContent = live;
    }
  }
}
