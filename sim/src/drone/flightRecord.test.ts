import { describe, expect, it } from 'vitest';
import { SIM_DT, SIM_HZ } from '../core/gameLoop';
import { type ButtonId, type ControlFrame, neutralFrame, noButtonsPressed } from '../input/types';
import { FLIGHT_PROCEDURE } from './air2s.config';
import {
  createDroneState,
  createFlyingState,
  distanceFromHome,
  type DroneState,
} from './droneState';
import { stepDrone } from './flightModel';

type Input = Partial<Pick<ControlFrame, 'roll' | 'pitch' | 'yaw' | 'throttle' | 'mode'>> & {
  press?: ButtonId[];
};

function frame(input: Input = {}): ControlFrame {
  const { press = [], ...sticks } = input;
  const buttons = noButtonsPressed();
  for (const id of press) {
    buttons[id] = true;
  }
  return { ...neutralFrame(0, 'N', true), ...sticks, buttons };
}

function run(state: DroneState, seconds: number, input: Input = {}): DroneState {
  const controls = frame(input);
  for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
    stepDrone(state, controls, SIM_DT);
  }
  return state;
}

/** Both sticks down and inward: starts and stops the motors. */
const STICK_COMMAND: Input = { throttle: -1, pitch: -1, yaw: 1, roll: -1 };

describe('home point', () => {
  it('is not set before the motors have been started', () => {
    const state = run(createDroneState(), 5);

    expect(state.homeSet).toBe(false);
    expect(distanceFromHome(state)).toBe(0);
  });

  it('is recorded where the aircraft stands when it takes off', () => {
    const state = createDroneState();
    state.x = 40;
    state.z = -25;

    run(state, 0.1, { press: ['takeoffLand'] });

    expect(state.homeSet).toBe(true);
    expect(state.homeX).toBe(40);
    expect(state.homeZ).toBe(-25);
  });

  it('is recorded when the motors are started with the stick command', () => {
    const state = createDroneState();
    state.x = -7;
    state.z = 3;

    run(state, FLIGHT_PROCEDURE.stickCommandHold + 0.05, STICK_COMMAND);

    expect(state.phase).toBe('idle');
    expect(state.homeSet).toBe(true);
    expect([state.homeX, state.homeZ]).toEqual([-7, 3]);
  });

  it('stays where it is while the aircraft flies away', () => {
    const state = run(createFlyingState(30), 10, { pitch: 1 });

    expect([state.homeX, state.homeZ]).toEqual([0, 0]);
    expect(distanceFromHome(state)).toBeCloseTo(Math.hypot(state.x, state.z), 9);
    expect(distanceFromHome(state)).toBeGreaterThan(100);
  });

  it('measures the distance over the ground, not the height', () => {
    const state = run(createFlyingState(30), 5, { throttle: 1 });

    expect(state.y).toBeGreaterThan(50);
    expect(distanceFromHome(state)).toBeLessThan(0.001);
  });

  it('moves to the new spot when the motors are started again somewhere else', () => {
    const state = createFlyingState(10);
    run(state, 8, { pitch: 1 }); // fly north
    run(state, 0.1, { press: ['takeoffLand'] }); // land there
    run(state, 30);
    expect(state.phase).toBe('motorsOff');
    expect(state.homeZ).toBe(0);
    const landedAt = state.z;
    expect(landedAt).toBeLessThan(-50);

    run(state, 0.1, { press: ['takeoffLand'] });

    expect(state.homeZ).toBe(landedAt);
    expect(distanceFromHome(state)).toBeLessThan(0.001);
  });
});

describe('flight time', () => {
  it('stands at zero while the motors are off', () => {
    const state = run(createDroneState(), 5, { throttle: 1 });

    expect(state.flightSeconds).toBe(0);
  });

  it('counts simulated seconds from the moment the motors start', () => {
    const state = run(createDroneState(), 0.1, { press: ['takeoffLand'] });
    run(state, 9.9);

    expect(state.flightSeconds).toBeCloseTo(10, 6);
  });

  it('also runs while standing on the ground with the motors running', () => {
    const state = run(createDroneState(), FLIGHT_PROCEDURE.stickCommandHold + 0.05, STICK_COMMAND);
    const started = state.flightSeconds;
    run(state, 4);

    expect(state.phase).toBe('idle');
    expect(state.flightSeconds - started).toBeCloseTo(4, 6);
  });

  it('stops when the motors stop and keeps the last value', () => {
    const state = run(createFlyingState(3), 0.1, { press: ['takeoffLand'] });
    run(state, 20);
    expect(state.phase).toBe('motorsOff');
    const atLanding = state.flightSeconds;
    expect(atLanding).toBeGreaterThan(1);

    run(state, 10);

    expect(state.flightSeconds).toBe(atLanding);
  });

  it('starts again from zero at the next motor start', () => {
    const state = run(createFlyingState(3), 0.1, { press: ['takeoffLand'] });
    run(state, 20);
    expect(state.flightSeconds).toBeGreaterThan(1);

    run(state, 0.5, { press: ['takeoffLand'] });

    expect(state.phase).toBe('takingOff');
    expect(state.flightSeconds).toBeCloseTo(0.5, 6);
  });

  it('stops when the motors are cut in the air', () => {
    const state = run(createFlyingState(400), FLIGHT_PROCEDURE.emergencyStopHold + 0.1, {
      ...STICK_COMMAND,
    });
    expect(state.phase).toBe('motorsOff');
    const atStop = state.flightSeconds;

    run(state, 2);

    expect(state.onGround).toBe(false);
    expect(state.flightSeconds).toBe(atStop);
  });
});
