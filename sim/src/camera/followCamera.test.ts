import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { DronePose } from '../drone/droneState';
import { FOLLOW_DISTANCE_M, FOLLOW_HEIGHT_M, placeFollowCamera } from './followCamera';

const DEG = Math.PI / 180;

function pose(change: Partial<DronePose> = {}): DronePose {
  return { x: 0, y: 10, z: 0, heading: 0, pitch: 0, roll: 0, ...change };
}

function viewDirection(camera: PerspectiveCamera): Vector3 {
  return camera.getWorldDirection(new Vector3());
}

describe('placeFollowCamera', () => {
  it('sits behind and above an aircraft that faces north, looking north', () => {
    const camera = new PerspectiveCamera();
    placeFollowCamera(camera, pose());

    expect(camera.position.x).toBeCloseTo(0, 9);
    expect(camera.position.z).toBeCloseTo(FOLLOW_DISTANCE_M, 9); // south of the aircraft
    expect(camera.position.y).toBeCloseTo(10 + FOLLOW_HEIGHT_M, 9);
    expect(viewDirection(camera).z).toBeLessThan(-0.9);
  });

  it('swings round with the heading: behind is west when the aircraft faces east', () => {
    const camera = new PerspectiveCamera();
    placeFollowCamera(camera, pose({ heading: 90 * DEG }));

    expect(camera.position.x).toBeCloseTo(-FOLLOW_DISTANCE_M, 9);
    expect(camera.position.z).toBeCloseTo(0, 9);
    expect(viewDirection(camera).x).toBeGreaterThan(0.9);
  });

  it('follows the aircraft wherever it is', () => {
    const camera = new PerspectiveCamera();
    placeFollowCamera(camera, pose({ x: 500, y: 80, z: -300, heading: 200 * DEG }));

    const offset = camera.position.clone().sub(new Vector3(500, 80, -300));
    expect(Math.hypot(offset.x, offset.z)).toBeCloseTo(FOLLOW_DISTANCE_M, 9);
    expect(offset.y).toBeCloseTo(FOLLOW_HEIGHT_M, 9);
  });

  it('stays level when the aircraft tilts, so the tilt can be seen', () => {
    const level = new PerspectiveCamera();
    const tilted = new PerspectiveCamera();
    placeFollowCamera(level, pose());
    placeFollowCamera(tilted, pose({ pitch: 25 * DEG, roll: -20 * DEG }));

    expect(tilted.position.distanceTo(level.position)).toBeLessThan(1e-9);
    // angleTo goes through an arc cosine, which is only precise to about 1e-7 near zero.
    expect(tilted.quaternion.angleTo(level.quaternion)).toBeLessThan(1e-6);
  });

  it('keeps the camera above the ground when the aircraft has landed', () => {
    const camera = new PerspectiveCamera();
    placeFollowCamera(camera, pose({ y: 0 }));

    expect(camera.position.y).toBeGreaterThan(0.5);
  });
});
