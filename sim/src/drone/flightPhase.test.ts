import { describe, expect, it } from 'vitest';
import { SIM_DT, SIM_HZ } from '../core/gameLoop';
import { type ButtonId, type ControlFrame, neutralFrame, noButtonsPressed } from '../input/types';
import { FLIGHT_PROCEDURE } from './air2s.config';
import { createDroneState, createFlyingState, type DroneState } from './droneState';
import { stepDrone } from './flightModel';
import { isStickCommand, type Sticks } from './flightPhase';

type Input = Partial<Sticks> & { press?: ButtonId[]; connected?: boolean };

function controls(input: Input = {}): ControlFrame {
  const { press = [], ...sticks } = input;
  const buttons = noButtonsPressed();
  for (const id of press) {
    buttons[id] = true;
  }
  return { ...neutralFrame(0, 'N', true), ...sticks, buttons };
}

/** Flies for `seconds` with the sticks and buttons held as given. */
function run(state: DroneState, seconds: number, input: Input = {}): DroneState {
  const frame = controls(input);
  for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
    stepDrone(state, frame, SIM_DT);
  }
  return state;
}

/** Presses a button briefly and lets go again. */
function tap(state: DroneState, button: ButtonId): DroneState {
  run(state, 0.1, { press: [button] });
  return run(state, 0.1);
}

/** Both sticks down and towards each other (mode 2: left stick down-right, right stick down-left). */
const STICKS_IN: Sticks = { throttle: -1, yaw: 1, pitch: -1, roll: -1 };
/** Both sticks down and away from each other. */
const STICKS_OUT: Sticks = { throttle: -1, yaw: -1, pitch: -1, roll: 1 };

/** On the ground with the motors running. */
function idleState(): DroneState {
  const state = createDroneState();
  run(state, 0.5, STICKS_IN);
  run(state, 0.1);
  expect(state.phase).toBe('idle');
  return state;
}

describe('the stick command', () => {
  it('is both sticks down and inward, or both down and outward', () => {
    expect(isStickCommand(STICKS_IN)).toBe(true);
    expect(isStickCommand(STICKS_OUT)).toBe(true);
  });

  it('is the same stick positions in every stick mode', () => {
    // Mode 3 swaps roll and yaw between the sticks: left down-right is roll +1, right down-left is yaw -1.
    expect(isStickCommand({ throttle: -1, pitch: -1, roll: 1, yaw: -1 })).toBe(true);
  });

  it('is not triggered by anything less', () => {
    const almost: Sticks[] = [
      { throttle: -1, yaw: 1, pitch: -1, roll: 1 }, // both sticks to the same side
      { throttle: -1, yaw: 1, pitch: 0, roll: -1 }, // right stick not down
      { throttle: 0, yaw: 1, pitch: -1, roll: -1 }, // left stick not down
      { throttle: -1, yaw: 0, pitch: -1, roll: -1 }, // left stick not to the side
      { throttle: -0.8, yaw: 0.8, pitch: -0.8, roll: -0.8 }, // not far enough into the corners
      { throttle: 1, yaw: 1, pitch: 1, roll: -1 }, // sticks up instead of down
      { throttle: 0, yaw: 0, pitch: 0, roll: 0 },
    ];
    for (const sticks of almost) {
      expect(isStickCommand(sticks), JSON.stringify(sticks)).toBe(false);
    }
  });
});

describe('motors off, on the ground', () => {
  it('is how the aircraft starts', () => {
    const state = createDroneState();

    expect(state.phase).toBe('motorsOff');
    expect(state.onGround).toBe(true);
    expect(state.y).toBe(0);
  });

  it('ignores the flight sticks completely', () => {
    const state = createDroneState();
    for (const input of [{ throttle: 1 }, { pitch: 1, roll: 1 }, { yaw: -1 }, { throttle: -1 }]) {
      run(state, 3, input);
    }

    expect(state).toEqual(createDroneState());
  });

  it('-> idle: the stick command starts the motors', () => {
    for (const command of [STICKS_IN, STICKS_OUT]) {
      const state = run(createDroneState(), FLIGHT_PROCEDURE.stickCommandHold + 0.05, command);

      expect(state.phase).toBe('idle');
      expect(state.onGround).toBe(true);
    }
  });

  it('needs the stick command to be held for a moment', () => {
    const state = run(createDroneState(), FLIGHT_PROCEDURE.stickCommandHold - 0.05, STICKS_IN);
    expect(state.phase).toBe('motorsOff');

    run(state, 0.5); // let go: the short hold is forgotten
    run(state, FLIGHT_PROCEDURE.stickCommandHold - 0.05, STICKS_IN);
    expect(state.phase).toBe('motorsOff');
  });

  it('-> taking off: the take-off button starts the motors and lifts off', () => {
    const state = run(createDroneState(), 0.2, { press: ['takeoffLand'] });

    expect(state.phase).toBe('takingOff');
    expect(state.onGround).toBe(false);
    expect(state.y).toBeGreaterThan(0);
  });

  it('does nothing for the flight-pause button', () => {
    const state = tap(createDroneState(), 'pause');

    expect(state.phase).toBe('motorsOff');
  });
});

describe('idle: on the ground with the motors running', () => {
  it('stays on the ground while the sticks are centred or only steer', () => {
    const state = idleState();
    run(state, 5, { pitch: 1, roll: -1, yaw: 1 });

    expect(state.phase).toBe('idle');
    expect(state).toMatchObject({ x: 0, y: 0, z: 0, heading: 0, onGround: true });
  });

  it('-> flying: throttle up lifts off', () => {
    const state = run(idleState(), 2, { throttle: 1 });

    expect(state.phase).toBe('flying');
    expect(state.onGround).toBe(false);
    expect(state.y).toBeGreaterThan(5);
  });

  it('-> taking off: the take-off button', () => {
    const state = run(idleState(), 0.2, { press: ['takeoffLand'] });

    expect(state.phase).toBe('takingOff');
  });

  it('-> motors off: the stick command again', () => {
    const state = run(idleState(), FLIGHT_PROCEDURE.stickCommandHold + 0.05, STICKS_IN);

    expect(state.phase).toBe('motorsOff');
  });

  it('does not stop the motors again while the starting stick command is still held', () => {
    const state = createDroneState();
    run(state, 2, STICKS_IN);

    expect(state.phase).toBe('idle');
  });

  it('-> motors off: throttle held fully down', () => {
    const state = idleState();

    run(state, FLIGHT_PROCEDURE.throttleDownStopHold - 0.2, { throttle: -1 });
    expect(state.phase).toBe('idle');

    run(state, 0.4, { throttle: -1 });
    expect(state.phase).toBe('motorsOff');
  });

  it('starts counting again if the throttle is let go in between', () => {
    const state = idleState();
    run(state, 2, { throttle: -1 });
    run(state, 0.2);
    run(state, 2, { throttle: -1 });

    expect(state.phase).toBe('idle');
  });
});

describe('taking off', () => {
  it('-> flying: climbs to hover height and holds it', () => {
    const state = tap(createDroneState(), 'takeoffLand');
    run(state, 8);

    expect(state.phase).toBe('flying');
    expect(state.y).toBeCloseTo(FLIGHT_PROCEDURE.takeoffHeight, 2);
    expect(Math.abs(state.vy)).toBeLessThan(0.001);
    expect(state.altitudeHoldActive).toBe(true);
  });

  it('takes a few seconds, not an instant', () => {
    const state = tap(createDroneState(), 'takeoffLand');
    run(state, 0.3);
    expect(state.phase).toBe('takingOff');

    let seconds = 0.5;
    while (state.phase === 'takingOff' && seconds < 20) {
      run(state, 0.1);
      seconds += 0.1;
    }
    expect(seconds).toBeGreaterThan(1);
    expect(seconds).toBeLessThan(6);
  });

  it('never climbs noticeably past hover height', () => {
    const state = tap(createDroneState(), 'takeoffLand');
    let highest = 0;
    for (let i = 0; i < 10 * SIM_HZ; i++) {
      stepDrone(state, controls(), SIM_DT);
      highest = Math.max(highest, state.y);
    }

    expect(highest).toBeLessThan(FLIGHT_PROCEDURE.takeoffHeight + 0.05);
  });

  it('takes off the same way in every flight mode', () => {
    const heights = (['C', 'N', 'S'] as const).map((mode) => {
      const state = createDroneState();
      const frame = controls();
      frame.mode = mode;
      frame.buttons.takeoffLand = true;
      for (let i = 0; i < SIM_HZ; i++) {
        stepDrone(state, frame, SIM_DT);
      }
      expect(state.phase, mode).toBe('takingOff'); // still climbing after one second
      return state.y;
    });

    expect(heights[0]).toBe(heights[1]);
    expect(heights[2]).toBe(heights[1]);
  });

  it('goes straight up: the flight sticks are ignored until it is done', () => {
    const state = tap(createDroneState(), 'takeoffLand');
    while (state.phase === 'takingOff') {
      run(state, 0.05, { pitch: 1, roll: 1, yaw: 1, throttle: -0.5 });
    }

    expect(Math.hypot(state.x, state.z)).toBeLessThan(0.05);
    expect(Math.abs(state.heading)).toBeLessThan(0.05);
    expect(state.y).toBeGreaterThan(1);
  });

  it('does not take off again while the button is simply held', () => {
    const state = run(createDroneState(), 10, { press: ['takeoffLand'] });

    expect(state.phase).toBe('flying');
  });

  it('-> landing: the button again', () => {
    const state = tap(createDroneState(), 'takeoffLand');
    run(state, 0.3);
    tap(state, 'takeoffLand');

    expect(state.phase).toBe('landing');
  });

  it('-> flying: flight pause stops the climb where it is', () => {
    const state = tap(createDroneState(), 'takeoffLand');
    run(state, 0.3);
    tap(state, 'pause');
    run(state, 5);

    expect(state.phase).toBe('flying');
    expect(state.y).toBeLessThan(FLIGHT_PROCEDURE.takeoffHeight - 0.1);
    expect(state.y).toBeGreaterThan(0.1);
  });
});

describe('flying', () => {
  it('stays flying with centred sticks', () => {
    const state = run(createFlyingState(20), 30);

    expect(state.phase).toBe('flying');
    expect(state.y).toBe(20);
  });

  it('-> landing: the take-off / landing button', () => {
    const state = tap(createFlyingState(20), 'takeoffLand');

    expect(state.phase).toBe('landing');
  });

  it('-> idle: touching the ground by hand leaves the motors running', () => {
    const state = run(createFlyingState(2), 2.5, { throttle: -1 });

    expect(state.phase).toBe('idle');
    expect(state).toMatchObject({ y: 0, vy: 0, onGround: true });
  });

  it('-> motors off: landing by hand and keeping the throttle down', () => {
    const state = run(createFlyingState(2), 6, { throttle: -1 });

    expect(state.phase).toBe('motorsOff');
    expect(state.onGround).toBe(true);
  });

  it('does nothing for the flight-pause button', () => {
    const state = tap(createFlyingState(20), 'pause');

    expect(state.phase).toBe('flying');
  });
});

describe('landing', () => {
  it('-> motors off: descends, touches down gently and stops the motors', () => {
    const state = tap(createFlyingState(20), 'takeoffLand');
    let touchdownSpeed = 0;
    for (let i = 0; i < 60 * SIM_HZ && state.phase === 'landing'; i++) {
      touchdownSpeed = state.vy;
      stepDrone(state, controls(), SIM_DT);
    }

    expect(state.phase).toBe('motorsOff');
    expect(state).toMatchObject({ y: 0, vy: 0, onGround: true });
    expect(touchdownSpeed).toBeLessThan(0);
    expect(touchdownSpeed).toBeGreaterThan(-1);
  });

  it('comes down at a steady speed high up and slows near the ground', () => {
    const state = tap(createFlyingState(60), 'takeoffLand');
    run(state, 4);
    expect(state.vy).toBeCloseTo(-FLIGHT_PROCEDURE.landingSpeed, 1);

    while (state.y > 1) {
      run(state, 0.05);
    }
    expect(state.vy).toBeGreaterThan(-1.2);
    expect(state.vy).toBeLessThan(0);
  });

  it('lets the pilot steer and turn on the way down, but not climb', () => {
    const state = tap(createFlyingState(40), 'takeoffLand');

    run(state, 3, { pitch: 1, throttle: 1 });
    expect(state.z).toBeLessThan(-10);
    expect(state.vy).toBeLessThan(-2);

    run(state, 2, { yaw: 1, throttle: 1 });
    expect(state.heading).toBeGreaterThan(1);
    expect(state.vy).toBeLessThan(-2);
    expect(state.phase).toBe('landing');
  });

  it('-> flying: the button again cancels the landing', () => {
    const state = tap(createFlyingState(30), 'takeoffLand');
    run(state, 3);
    tap(state, 'takeoffLand');
    run(state, 5);

    expect(state.phase).toBe('flying');
    expect(Math.abs(state.vy)).toBeLessThan(0.01);
    expect(state.y).toBeGreaterThan(10);
  });

  it('-> flying: flight pause cancels the landing too', () => {
    const state = tap(createFlyingState(30), 'takeoffLand');
    run(state, 3);
    tap(state, 'pause');

    expect(state.phase).toBe('flying');
  });
});

describe('emergency motor stop', () => {
  it('-> motors off: the stick command held for two seconds in flight cuts the motors', () => {
    const state = createFlyingState(200);

    run(state, FLIGHT_PROCEDURE.emergencyStopHold - 0.2, STICKS_IN);
    expect(state.phase).toBe('flying');

    run(state, 0.4, STICKS_IN);
    expect(state.phase).toBe('motorsOff');
    expect(state.onGround).toBe(false);
  });

  it('does not cut the motors for a short stick command in flight', () => {
    const state = createFlyingState(200);
    run(state, 1, STICKS_IN);
    run(state, 0.5);
    run(state, 1, STICKS_IN);

    expect(state.phase).toBe('flying');
  });

  it('then falls, faster and faster, and stays down', () => {
    const state = run(createFlyingState(200), FLIGHT_PROCEDURE.emergencyStopHold + 0.2, STICKS_IN);
    const heightAtCut = state.y;

    run(state, 1);
    const afterOneSecond = state.vy;
    run(state, 1);
    expect(state.y).toBeLessThan(heightAtCut - 10);
    expect(state.vy).toBeLessThan(afterOneSecond);

    run(state, 30);
    expect(state).toMatchObject({ phase: 'motorsOff', y: 0, vy: 0, onGround: true });
  });

  it('cannot be undone in the air: sticks and buttons do nothing while it falls', () => {
    const state = run(createFlyingState(300), FLIGHT_PROCEDURE.emergencyStopHold + 0.2, STICKS_IN);
    run(state, 0.2);

    run(state, 0.5, { throttle: 1, press: ['takeoffLand'] });
    run(state, 0.2);
    run(state, 0.5, STICKS_IN);

    expect(state.phase).toBe('motorsOff');
    expect(state.vy).toBeLessThan(-5);
  });

  it('works during take-off and during landing as well', () => {
    const landing = tap(createFlyingState(100), 'takeoffLand');
    run(landing, FLIGHT_PROCEDURE.emergencyStopHold + 0.2, STICKS_IN);
    expect(landing.phase).toBe('motorsOff');

    const takingOff = createDroneState();
    run(takingOff, 0.05, { ...STICKS_IN, press: ['takeoffLand'] });
    expect(takingOff.phase).toBe('takingOff');
    run(takingOff, FLIGHT_PROCEDURE.emergencyStopHold + 0.2, STICKS_IN);
    expect(takingOff.phase).toBe('motorsOff');
  });

  it('can be started again from the ground afterwards', () => {
    const state = run(createFlyingState(50), FLIGHT_PROCEDURE.emergencyStopHold + 0.2, STICKS_IN);
    run(state, 20);
    expect(state.onGround).toBe(true);

    tap(state, 'takeoffLand');
    run(state, 8);

    expect(state.phase).toBe('flying');
  });
});

describe('a complete flight', () => {
  it('goes motors off -> taking off -> flying -> landing -> motors off', () => {
    const state = createDroneState();
    const seen: string[] = [state.phase];
    const note = (): void => {
      if (seen.at(-1) !== state.phase) {
        seen.push(state.phase);
      }
    };
    const fly = (seconds: number, input: Input = {}): void => {
      const frame = controls(input);
      for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
        stepDrone(state, frame, SIM_DT);
        note();
      }
    };

    fly(0.1, { press: ['takeoffLand'] });
    fly(8);
    fly(6, { pitch: 1, throttle: 0.5 });
    fly(6);
    fly(0.1, { press: ['takeoffLand'] });
    fly(40);

    expect(seen).toEqual(['motorsOff', 'takingOff', 'flying', 'landing', 'motorsOff']);
    expect(state.onGround).toBe(true);
    expect(state.z).toBeLessThan(-30); // it landed where it flew to, not where it started
  });

  it('ignores every button and the stick command when the controller is lost', () => {
    const state = createDroneState();
    run(state, 3, { ...STICKS_IN, press: ['takeoffLand'], connected: false });

    expect(state).toEqual(createDroneState());
  });
});
