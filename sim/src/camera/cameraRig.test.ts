import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { lensWorldPosition } from '../drone/droneModel';
import type { DronePose } from '../drone/droneState';
import {
  CAMERA_MODES,
  cameraLabelText,
  CameraRig,
  CHASE_DISTANCE_M,
  CHASE_HEIGHT_M,
  FREE_LIMITS,
  FREE_START,
} from './cameraRig';

const DEG = Math.PI / 180;

function pose(change: Partial<DronePose> = {}): DronePose {
  return { x: 0, y: 10, z: 0, heading: 0, pitch: 0, roll: 0, ...change };
}

function viewDirection(camera: PerspectiveCamera): Vector3 {
  return camera.getWorldDirection(new Vector3());
}

/** How far the camera is rolled sideways: 0 means the horizon is level. */
function horizonTilt(camera: PerspectiveCamera): number {
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  return Math.abs(right.y);
}

function place(rig: CameraRig, change: Partial<DronePose> = {}, elapsed = 0): PerspectiveCamera {
  const camera = new PerspectiveCamera();
  rig.update(camera, pose(change), elapsed);
  return camera;
}

describe('camera modes', () => {
  it('starts with the chase camera unless told otherwise', () => {
    expect(new CameraRig().mode).toBe('chase');
    expect(new CameraRig('fpv').mode).toBe('fpv');
  });

  it('cycles chase -> drone camera -> free -> chase', () => {
    const rig = new CameraRig();

    expect(rig.next()).toBe('fpv');
    expect(rig.next()).toBe('free');
    expect(rig.next()).toBe('chase');
    expect(CAMERA_MODES).toEqual(['chase', 'fpv', 'free']);
  });

  it('names each view and says how to change it', () => {
    expect(cameraLabelText('chase')).toBe('Chase camera · V to change');
    expect(cameraLabelText('fpv')).toBe('Drone camera · V to change');
    expect(cameraLabelText('free')).toBe(
      'Free camera · drag to look around, scroll to zoom · V to change',
    );
  });
});

describe('chase camera', () => {
  it('sits behind and above an aircraft that faces north, looking north', () => {
    const camera = place(new CameraRig('chase'));

    expect(camera.position.x).toBeCloseTo(0, 9);
    expect(camera.position.z).toBeCloseTo(CHASE_DISTANCE_M, 9); // south of the aircraft
    expect(camera.position.y).toBeCloseTo(10 + CHASE_HEIGHT_M, 9);
    expect(viewDirection(camera).z).toBeLessThan(-0.9);
  });

  it('is behind the aircraft whatever way it faces', () => {
    const camera = place(new CameraRig('chase'), { heading: 90 * DEG });

    expect(camera.position.x).toBeCloseTo(-CHASE_DISTANCE_M, 9); // west of an east-facing aircraft
    expect(camera.position.z).toBeCloseTo(0, 9);
    expect(viewDirection(camera).x).toBeGreaterThan(0.9);
  });

  it('follows the aircraft wherever it is', () => {
    const camera = place(new CameraRig('chase'), { x: 500, y: 80, z: -300, heading: 200 * DEG });
    const offset = camera.position.clone().sub(new Vector3(500, 80, -300));

    expect(Math.hypot(offset.x, offset.z)).toBeCloseTo(CHASE_DISTANCE_M, 9);
    expect(offset.y).toBeCloseTo(CHASE_HEIGHT_M, 9);
  });

  it('stays level when the aircraft tilts, so the tilt can be seen', () => {
    const level = place(new CameraRig('chase'));
    const tilted = place(new CameraRig('chase'), { pitch: 25 * DEG, roll: -20 * DEG });

    expect(tilted.position.distanceTo(level.position)).toBeLessThan(1e-9);
    expect(horizonTilt(tilted)).toBeLessThan(1e-9);
  });

  it('swings round behind a turning aircraft with a short delay', () => {
    const rig = new CameraRig('chase');
    const camera = new PerspectiveCamera();
    rig.update(camera, pose(), 0);

    // The aircraft has turned to face east; one frame later the camera is only part of the way.
    rig.update(camera, pose({ heading: 90 * DEG }), 1 / 60);
    const soon = Math.atan2(viewDirection(camera).x, -viewDirection(camera).z) / DEG;
    expect(soon).toBeGreaterThan(2);
    expect(soon).toBeLessThan(45);

    for (let i = 0; i < 300; i++) {
      rig.update(camera, pose({ heading: 90 * DEG }), 1 / 60);
    }
    expect(camera.position.x).toBeCloseTo(-CHASE_DISTANCE_M, 9);
    expect(camera.position.z).toBeCloseTo(0, 9);
  });

  it('ends exactly in place, so a still aircraft gives a still picture', () => {
    const rig = new CameraRig('chase');
    const camera = new PerspectiveCamera();
    rig.update(camera, pose(), 0);
    for (let i = 0; i < 600; i++) {
      rig.update(camera, pose({ heading: 1 }), 1 / 60);
    }
    const settled = camera.position.clone();

    rig.update(camera, pose({ heading: 1 }), 1 / 60);

    expect(camera.position.equals(settled)).toBe(true);
    expect(camera.position.x).toBe(-Math.sin(1) * CHASE_DISTANCE_M);
  });

  it('jumps straight into place when asked to snap', () => {
    const rig = new CameraRig('chase');
    const camera = new PerspectiveCamera();
    rig.update(camera, pose(), 0);

    rig.snap();
    rig.update(camera, pose({ heading: 180 * DEG }), 1 / 60);

    expect(camera.position.z).toBeCloseTo(-CHASE_DISTANCE_M, 9);
  });

  it('keeps the camera above the ground when the aircraft has landed', () => {
    const camera = place(new CameraRig('chase'), { y: 0 });

    expect(camera.position.y).toBeGreaterThan(0.3);
  });
});

describe('drone camera (first person view)', () => {
  it('looks out from the lens of the aircraft', () => {
    const where = { x: 30, y: 25, z: -12, heading: 70 * DEG, pitch: 20 * DEG, roll: 10 * DEG };
    const camera = place(new CameraRig('fpv'), where);

    const lens = lensWorldPosition(pose(where), new Vector3());
    expect(camera.position.distanceTo(lens)).toBeLessThan(1e-9);
  });

  it('looks the way the nose points', () => {
    expect(viewDirection(place(new CameraRig('fpv'))).z).toBeCloseTo(-1, 9);

    const east = viewDirection(place(new CameraRig('fpv'), { heading: 90 * DEG }));
    expect(east.x).toBeCloseTo(1, 9);
    expect(east.z).toBeCloseTo(0, 9);
  });

  it('keeps the horizon level and the view straight ahead however the aircraft tilts', () => {
    const camera = place(new CameraRig('fpv'), { pitch: 30 * DEG, roll: -25 * DEG });

    expect(horizonTilt(camera)).toBeLessThan(1e-9);
    expect(viewDirection(camera).y).toBeCloseTo(0, 9);
  });

  it('turns with the aircraft at once, without the delay of the chase camera', () => {
    const rig = new CameraRig('fpv');
    const camera = new PerspectiveCamera();
    rig.update(camera, pose(), 0);
    rig.update(camera, pose({ heading: 90 * DEG }), 1 / 60);

    expect(viewDirection(camera).x).toBeCloseTo(1, 9);
  });

  it('can draw things closer than the other views, because it sits among the propellers', () => {
    const fpv = place(new CameraRig('fpv'));
    const chase = place(new CameraRig('chase'));

    expect(fpv.near).toBeLessThan(chase.near);
  });
});

describe('free camera', () => {
  it('looks at the aircraft from its starting spot', () => {
    const camera = place(new CameraRig('free'));
    const toAircraft = new Vector3(0, 10.05, 0).sub(camera.position);

    expect(toAircraft.length()).toBeCloseTo(FREE_START.distance, 6);
    expect(viewDirection(camera).distanceTo(toAircraft.normalize())).toBeLessThan(1e-9);
  });

  it('follows the position of the aircraft but does not turn with it', () => {
    const rig = new CameraRig('free');
    const here = place(rig);
    const moved = place(rig, { x: 100, y: 40, z: -60 });
    const turned = place(rig, { x: 100, y: 40, z: -60, heading: 170 * DEG, roll: 20 * DEG });

    const shift = moved.position.clone().sub(here.position);
    expect(shift.distanceTo(new Vector3(100, 30, -60))).toBeLessThan(1e-9);
    expect(turned.position.distanceTo(moved.position)).toBeLessThan(1e-9);
    expect(turned.quaternion.angleTo(moved.quaternion)).toBeLessThan(1e-6);
  });

  it('moves round the aircraft when the pilot drags', () => {
    const rig = new CameraRig('free');
    rig.azimuth = 0;
    rig.elevation = 0;
    rig.distance = 5;

    expect(place(rig).position.z).toBeCloseTo(-5, 9); // azimuth 0: north of the aircraft

    rig.orbit(90 * DEG, 0);
    const east = place(rig).position;
    expect(east.x).toBeCloseTo(5, 9);
    expect(east.z).toBeCloseTo(0, 9);

    rig.orbit(0, 30 * DEG);
    expect(place(rig).position.y).toBeCloseTo(10.05 + 2.5, 9);
  });

  it('stops at its highest and lowest viewing angle', () => {
    const rig = new CameraRig('free');

    rig.orbit(0, 500 * DEG);
    expect(rig.elevation).toBe(FREE_LIMITS.maxElevation);
    rig.orbit(0, -500 * DEG);
    expect(rig.elevation).toBe(FREE_LIMITS.minElevation);
  });

  it('zooms between its nearest and furthest distance', () => {
    const rig = new CameraRig('free');

    rig.zoom(0.5);
    expect(rig.distance).toBeCloseTo(FREE_START.distance / 2, 9);
    rig.zoom(1e-6);
    expect(rig.distance).toBe(FREE_LIMITS.minDistance);
    rig.zoom(1e9);
    expect(rig.distance).toBe(FREE_LIMITS.maxDistance);

    rig.zoom(Number.NaN);
    rig.zoom(-2);
    expect(rig.distance).toBe(FREE_LIMITS.maxDistance);
  });

  it('never goes under the ground', () => {
    const rig = new CameraRig('free');
    rig.orbit(0, -500 * DEG);
    rig.zoom(1e9);

    expect(place(rig, { y: 0 }).position.y).toBeGreaterThan(0.1);
  });

  it('keeps its place when the pilot changes to another view and back', () => {
    const rig = new CameraRig('free');
    rig.orbit(40 * DEG, 10 * DEG);
    rig.zoom(2);
    const before = place(rig).position.clone();

    rig.next();
    rig.next();
    rig.next();

    expect(rig.mode).toBe('free');
    expect(place(rig).position.distanceTo(before)).toBeLessThan(1e-9);
  });
});
