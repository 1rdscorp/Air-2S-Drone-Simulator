import { describe, expect, it } from 'vitest';
import {
  blendPose,
  copyDroneState,
  createDroneState,
  createFlyingState,
  type DronePose,
  headingDegrees,
  horizontalSpeed,
} from './droneState';

const START_HEIGHT = 8;

const DEG = Math.PI / 180;

describe('createDroneState', () => {
  it('starts on the ground at the origin with the motors off, facing north', () => {
    const state = createDroneState();

    expect(state).toMatchObject({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0 });
    expect(state.phase).toBe('motorsOff');
    expect(state.onGround).toBe(true);
    expect(state.holdActive).toBe(false);
  });

  it('gives a fresh object every time', () => {
    const first = createDroneState();
    first.x = 99;

    expect(createDroneState().x).toBe(0);
  });
});

describe('createFlyingState', () => {
  it('hovers at rest at the given height, holding its position and height', () => {
    const state = createFlyingState(START_HEIGHT);

    expect(state).toMatchObject({ x: 0, y: START_HEIGHT, z: 0, vx: 0, vy: 0, vz: 0, heading: 0 });
    expect(state.phase).toBe('flying');
    expect(state.onGround).toBe(false);
    expect(state.holdActive).toBe(true);
    expect(state.altitudeHoldActive).toBe(true);
    expect(state.holdY).toBe(START_HEIGHT);
  });
});

describe('copyDroneState', () => {
  it('copies every field', () => {
    const source = createFlyingState(START_HEIGHT);
    source.x = 1;
    source.vy = -2;
    source.heading = 3;
    source.phase = 'landing';
    source.stickCommandSeconds = 0.4;
    const target = createDroneState();

    copyDroneState(target, source);

    expect(target).toEqual(source);
    expect(target).not.toBe(source);
  });
});

describe('blendPose', () => {
  const pose = (): DronePose => ({
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    pitch: 0,
    roll: 0,
    gimbalTilt: 0,
  });

  it('gives the first state at 0, the second at 1 and the middle at 0.5', () => {
    const from = createFlyingState(START_HEIGHT);
    const to = createFlyingState(START_HEIGHT);
    Object.assign(to, { x: 10, y: 4, z: -6, heading: 1, pitch: 0.2, roll: -0.4, gimbalTilt: -1 });

    expect(blendPose(pose(), from, to, 0)).toMatchObject({ x: 0, y: START_HEIGHT, z: 0 });
    expect(blendPose(pose(), from, to, 1)).toEqual({
      x: 10,
      y: 4,
      z: -6,
      heading: 1,
      pitch: 0.2,
      roll: -0.4,
      gimbalTilt: -1,
    });
    const middle = blendPose(pose(), from, to, 0.5);
    expect(middle.x).toBeCloseTo(5, 12);
    expect(middle.y).toBeCloseTo((START_HEIGHT + 4) / 2, 12);
    expect(middle.heading).toBeCloseTo(0.5, 12);
    expect(middle.roll).toBeCloseTo(-0.2, 12);
    expect(middle.gimbalTilt).toBeCloseTo(-0.5, 12);
  });

  it('turns smoothly through north, because the heading is not wrapped', () => {
    const from = createDroneState();
    const to = createDroneState();
    from.heading = 359 * DEG;
    to.heading = 361 * DEG;

    expect(headingDegrees(blendPose(pose(), from, to, 0.5).heading)).toBeCloseTo(0, 9);
  });

  it('limits alpha to the range 0 to 1 and leaves the states alone', () => {
    const from = createDroneState();
    const to = createDroneState();
    to.x = 10;

    expect(blendPose(pose(), from, to, 5).x).toBe(10);
    expect(blendPose(pose(), from, to, -5).x).toBe(0);
    expect(from).toEqual(createDroneState());
  });
});

describe('horizontalSpeed', () => {
  it('ignores the vertical speed', () => {
    expect(horizontalSpeed({ vx: 3, vz: -4 })).toBe(5);
  });
});

describe('headingDegrees', () => {
  it('gives a compass bearing from 0 up to 360', () => {
    expect(headingDegrees(0)).toBe(0);
    expect(headingDegrees(90 * DEG)).toBeCloseTo(90, 9);
    expect(headingDegrees(450 * DEG)).toBeCloseTo(90, 9);
    expect(headingDegrees(-90 * DEG)).toBeCloseTo(270, 9);
    expect(headingDegrees(-720 * DEG)).toBeCloseTo(0, 9);
  });
});
