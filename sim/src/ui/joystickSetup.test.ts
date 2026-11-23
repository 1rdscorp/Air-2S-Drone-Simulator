import { describe, expect, it } from 'vitest';
import type { JoystickDevice } from '../input/joystickMapping';
import { SETUP_STEPS, SETUP_TIMING, SetupSession, summaryLines } from './joystickSetup';

const STICK = '4098-bea8-WINCTRL Orion Joystick Base Metal 2 + JGRIP-F16';
const THROTTLE = '4098-be62-WINCTRL Orion Throttle Base II';

/** Made-up devices the test moves, and a clock it advances. */
class Bench {
  now = 0;
  stick = { axes: [0, 0, 0, 0, 0, 0], pressed: [] as number[] };
  throttle: { axes: number[]; pressed: number[] } | null = null;
  readonly session: SetupSession;

  constructor(options: { withThrottle?: boolean; noDevices?: boolean } = {}) {
    if (options.withThrottle) {
      this.throttle = { axes: [-1, 0], pressed: [] };
    }
    this.plugged = !options.noDevices;
    this.session = new SetupSession(this.now, this.devices());
  }

  plugged: boolean;

  devices(): JoystickDevice[] {
    if (!this.plugged) {
      return [];
    }
    const list: JoystickDevice[] = [this.snapshot(STICK, this.stick)];
    if (this.throttle) {
      list.push(this.snapshot(THROTTLE, this.throttle));
    }
    return list;
  }

  /** Lets time pass in display frames of 16 ms. */
  wait(ms: number): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.now += 16;
      this.session.update(this.now, this.devices());
    }
  }

  /** Waits until the question is on the screen. */
  untilAsked(): void {
    this.wait(SETUP_TIMING.release + SETUP_TIMING.settle + 100);
  }

  /** Moves an axis of the stick, holds it until it is taken, and lets go. */
  answerAxis(axis: number, value: number, on: 'stick' | 'throttle' = 'stick'): void {
    this.untilAsked();
    const target = on === 'stick' ? this.stick : this.throttle;
    if (!target) throw new Error('no throttle on the bench');
    const before = target.axes[axis] ?? 0;
    target.axes[axis] = value;
    this.wait(SETUP_TIMING.holdAxis + 50);
    target.axes[axis] = before;
  }

  answerButton(button: number): void {
    this.untilAsked();
    this.stick.pressed = [button];
    this.wait(SETUP_TIMING.holdButton + 50);
    this.stick.pressed = [];
  }

  skip(): void {
    this.session.skip(this.now, this.devices());
  }

  /** Skips every question that is left. */
  skipRest(): void {
    while (this.session.phase !== 'summary') {
      this.skip();
    }
  }

  private snapshot(id: string, state: { axes: number[]; pressed: number[] }): JoystickDevice {
    return {
      id,
      axes: [...state.axes],
      buttons: Array.from({ length: 20 }, (_, i) => state.pressed.includes(i)),
    };
  }
}

describe('SetupSession', () => {
  it('asks for the five axes first, then for the buttons', () => {
    expect(SETUP_STEPS.map((step) => step.id)).toEqual([
      'roll',
      'pitch',
      'yaw',
      'throttle',
      'gimbal',
      'takeoffLand',
      'pause',
      'c1',
      'c2',
      'modeC',
      'modeN',
      'modeS',
    ]);
  });

  it('waits for the controls to be at rest before it asks', () => {
    const bench = new Bench();
    expect(bench.session.phase).toBe('settling');
    expect(bench.session.step?.id).toBe('roll');

    // The stick is still being moved about: no question yet.
    for (let i = 0; i < 40; i++) {
      bench.stick.axes[0] = i % 2 === 0 ? 0.3 : -0.3;
      bench.wait(16);
    }
    expect(bench.session.phase).toBe('settling');

    bench.stick.axes[0] = 0;
    bench.wait(SETUP_TIMING.settle + 50);
    expect(bench.session.phase).toBe('waiting');
  });

  it('takes a control only after it has been held for a moment', () => {
    const bench = new Bench();
    bench.untilAsked();

    bench.stick.axes[0] = 1;
    bench.wait(100);
    expect(bench.session.phase).toBe('holding');
    expect(bench.session.progress(bench.now)).toBeGreaterThan(0.1);
    expect(bench.session.mapping.axes.roll).toBeUndefined();

    // Let go too early: nothing is taken and the question stays.
    bench.stick.axes[0] = 0;
    bench.wait(50);
    expect(bench.session.phase).toBe('waiting');
    expect(bench.session.step?.id).toBe('roll');

    bench.stick.axes[0] = 1;
    bench.wait(SETUP_TIMING.holdAxis + 50);
    expect(bench.session.mapping.axes.roll).toEqual({
      device: STICK,
      axis: 0,
      invert: false,
      lever: false,
    });
    expect(bench.session.phase).toBe('release');
    expect(bench.session.captured).toBe('Fly right: axis 1');
    expect(bench.session.step?.id).toBe('pitch');
  });

  it('works out from the direction of the movement whether an axis is reversed', () => {
    const bench = new Bench();
    bench.answerAxis(0, -1); // this stick reports "right" as negative
    bench.answerAxis(1, -1); // forward is negative on every stick
    bench.answerAxis(3, 1);

    expect(bench.session.mapping.axes.roll?.invert).toBe(true);
    expect(bench.session.mapping.axes.pitch).toMatchObject({ axis: 1, invert: true });
    expect(bench.session.mapping.axes.yaw).toMatchObject({ axis: 3, invert: false });
  });

  it('does not offer an axis twice', () => {
    const bench = new Bench();
    bench.answerAxis(0, 1);
    bench.untilAsked();

    // The pilot pushes the same axis again for "fly forward": it is not taken.
    bench.stick.axes[0] = 1;
    bench.wait(1000);
    expect(bench.session.step?.id).toBe('pitch');
    expect(bench.session.mapping.axes.pitch).toBeUndefined();
  });

  it('goes through all questions to a complete setup', () => {
    const bench = new Bench();
    bench.answerAxis(0, 1);
    bench.answerAxis(1, -1);
    bench.answerAxis(2, 1); // thumb stick left / right
    bench.answerAxis(3, -1); // thumb stick up
    bench.answerAxis(5, 1);
    for (const button of [0, 1, 2, 3, 4, 5, 6]) {
      bench.answerButton(button);
    }
    bench.untilAsked();

    expect(bench.session.phase).toBe('summary');
    expect(bench.session.step).toBeNull();
    expect(bench.session.mapping).toEqual({
      version: 1,
      axes: {
        roll: { device: STICK, axis: 0, invert: false, lever: false },
        pitch: { device: STICK, axis: 1, invert: true, lever: false },
        yaw: { device: STICK, axis: 2, invert: false, lever: false },
        throttle: { device: STICK, axis: 3, invert: true, lever: false },
        gimbal: { device: STICK, axis: 5, invert: false, lever: false },
      },
      buttons: {
        takeoffLand: { device: STICK, button: 0 },
        pause: { device: STICK, button: 1 },
        c1: { device: STICK, button: 2 },
        c2: { device: STICK, button: 3 },
        modeC: { device: STICK, button: 4 },
        modeN: { device: STICK, button: 5 },
        modeS: { device: STICK, button: 6 },
      },
    });
  });

  it('lets controls be skipped, and has nothing to save when all were', () => {
    const bench = new Bench();
    bench.answerAxis(0, 1);
    bench.untilAsked();
    bench.skip(); // no control for "fly forward"
    expect(bench.session.step?.id).toBe('yaw');
    bench.skipRest();

    expect(bench.session.mapping.axes).toEqual({
      roll: { device: STICK, axis: 0, invert: false, lever: false },
    });
    expect(bench.session.hasAnything).toBe(true);

    const nothing = new Bench();
    nothing.skipRest();
    expect(nothing.session.hasAnything).toBe(false);
  });

  it('goes back one question and forgets its answer', () => {
    const bench = new Bench();
    bench.answerAxis(0, 1);
    bench.answerAxis(1, -1);
    bench.untilAsked();
    expect(bench.session.step?.id).toBe('yaw');

    bench.session.back(bench.now, bench.devices());
    expect(bench.session.step?.id).toBe('pitch');
    expect(bench.session.mapping.axes.pitch).toBeUndefined();
    expect(bench.session.mapping.axes.roll).toBeDefined();

    // The axis is free again and can be given a job.
    bench.answerAxis(1, -1);
    expect(bench.session.mapping.axes.pitch).toMatchObject({ axis: 1 });
  });

  it('goes back from the summary to the last question', () => {
    const bench = new Bench();
    bench.skipRest();
    bench.session.back(bench.now, bench.devices());

    expect(bench.session.phase).not.toBe('summary');
    expect(bench.session.step?.id).toBe('modeS');
  });

  it('does not offer a button twice, nor a flight axis as a button', () => {
    const bench = new Bench();
    bench.answerAxis(0, 1);
    for (let i = 0; i < 4; i++) bench.skip();
    bench.answerButton(7);
    expect(bench.session.mapping.buttons.takeoffLand).toEqual({ device: STICK, button: 7 });

    bench.untilAsked();
    bench.stick.pressed = [7]; // the same button for flight pause
    bench.wait(500);
    bench.stick.pressed = [];
    bench.stick.axes[0] = 1; // the roll axis, pushed right over
    bench.wait(500);
    bench.stick.axes[0] = 0;

    expect(bench.session.step?.id).toBe('pause');
    expect(bench.session.mapping.buttons.pause).toBeUndefined();
  });

  it('takes a hat switch pushed to one side as a button', () => {
    const bench = new Bench();
    for (let i = 0; i < 5; i++) bench.skip();
    bench.untilAsked();
    bench.stick.axes[5] = -1;
    bench.wait(SETUP_TIMING.holdButton + 50);

    expect(bench.session.mapping.buttons.takeoffLand).toEqual({
      device: STICK,
      axis: 5,
      direction: -1,
    });
  });

  it('recognises a throttle lever: it rests at one end and stays where it is put', () => {
    const bench = new Bench({ withThrottle: true });
    for (let i = 0; i < 3; i++) bench.skip();
    expect(bench.session.step?.id).toBe('throttle');

    bench.untilAsked();
    if (!bench.throttle) throw new Error('no throttle');
    bench.throttle.axes[0] = 1; // pushed forward, and left there
    bench.wait(SETUP_TIMING.holdAxis + 50);
    bench.untilAsked();

    expect(bench.session.mapping.axes.throttle).toEqual({
      device: THROTTLE,
      axis: 0,
      invert: false,
      lever: true,
    });
  });

  it('does not take a sprung thumb stick for a lever, and lets the pilot overrule it', () => {
    const bench = new Bench();
    for (let i = 0; i < 3; i++) bench.skip();
    bench.answerAxis(3, -1);
    bench.skipRest();
    expect(bench.session.mapping.axes.throttle?.lever).toBe(false);

    bench.session.toggleThrottleLever();
    expect(bench.session.mapping.axes.throttle?.lever).toBe(true);
    bench.session.toggleThrottleLever();
    expect(bench.session.mapping.axes.throttle?.lever).toBe(false);
  });

  it('waits for a flight stick when none is plugged in, then starts by itself', () => {
    const bench = new Bench({ noDevices: true });
    expect(bench.session.phase).toBe('noDevice');
    bench.wait(500);
    expect(bench.session.phase).toBe('noDevice');

    bench.plugged = true;
    bench.wait(SETUP_TIMING.settle + 100);
    expect(bench.session.phase).toBe('waiting');
    expect(bench.session.step?.id).toBe('roll');
  });

  it('holds on when the stick is unplugged in the middle', () => {
    const bench = new Bench();
    bench.answerAxis(0, 1);
    bench.plugged = false;
    bench.wait(100);
    expect(bench.session.phase).toBe('noDevice');

    bench.plugged = true;
    bench.wait(SETUP_TIMING.settle + 100);
    expect(bench.session.step?.id).toBe('pitch');
    expect(bench.session.mapping.axes.roll).toBeDefined();
  });
});

describe('summaryLines', () => {
  it('names a single device once, then lists every job', () => {
    const bench = new Bench();
    bench.answerAxis(0, 1);
    bench.answerAxis(1, -1);
    bench.skipRest();

    expect(summaryLines(bench.session.mapping).slice(0, 4)).toEqual([
      'WINCTRL Orion Joystick Base Metal 2 + JGRIP-F16',
      'Fly right: axis 1',
      'Fly forward: axis 2 (reversed)',
      'Turn right: not set',
    ]);
    expect(summaryLines(bench.session.mapping)).toHaveLength(SETUP_STEPS.length + 1);
  });

  it('names the device on every line when there are two', () => {
    const lines = summaryLines({
      version: 1,
      axes: {
        roll: { device: STICK, axis: 0, invert: false, lever: false },
        throttle: { device: THROTTLE, axis: 0, invert: false, lever: true },
      },
      buttons: {},
    });

    expect(lines).toHaveLength(SETUP_STEPS.length);
    expect(lines[0]).toBe('Fly right: WINCTRL Orion Joystick Base Metal 2 + JGRIP-F16 · axis 1');
    expect(lines[3]).toBe('Climb: WINCTRL Orion Throttle Base II · axis 1 (lever)');
  });
});
