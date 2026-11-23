import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { DronePose } from './droneState';
import { applyPose, createDroneStandIn } from './standInMesh';

const DEG = Math.PI / 180;

function pose(change: Partial<DronePose> = {}): DronePose {
  return { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, ...change };
}

/** Where a point of the aircraft ends up in the world. */
function worldPoint(change: Partial<DronePose>, local: Vector3): Vector3 {
  const group = createDroneStandIn();
  applyPose(group, pose(change));
  group.updateMatrixWorld(true);
  return local.clone().applyMatrix4(group.matrixWorld);
}

const NOSE = new Vector3(0, 0, -1);
const RIGHT_SIDE = new Vector3(1, 0, 0);

describe('createDroneStandIn', () => {
  it('has a body, a nose marker and four rotors, and casts shadows', () => {
    const group = createDroneStandIn();
    const names = group.children.map((child) => child.name);

    expect(names.filter((name) => name === 'drone-body')).toHaveLength(1);
    expect(names.filter((name) => name === 'drone-nose')).toHaveLength(1);
    expect(names.filter((name) => name === 'drone-rotor')).toHaveLength(4);
    expect(group.children.every((child) => child.castShadow)).toBe(true);
  });

  it('puts the nose marker at the front, which is north', () => {
    const group = createDroneStandIn();

    expect(group.getObjectByName('drone-nose')?.position.z).toBeLessThan(0);
  });

  it('stands on its underside: nothing reaches below the origin', () => {
    const group = createDroneStandIn();
    for (const child of group.children) {
      expect(child.position.y, child.name).toBeGreaterThan(0);
    }
  });
});

describe('applyPose', () => {
  it('moves the shape to the position of the aircraft', () => {
    const group = createDroneStandIn();
    applyPose(group, pose({ x: 5, y: 12, z: -30 }));

    expect(group.position.toArray()).toEqual([5, 12, -30]);
  });

  it('points the nose north at heading 0 and east at heading 90', () => {
    expect(worldPoint({}, NOSE).z).toBeCloseTo(-1, 9);

    const east = worldPoint({ heading: 90 * DEG }, NOSE);
    expect(east.x).toBeCloseTo(1, 9);
    expect(east.z).toBeCloseTo(0, 9);

    const south = worldPoint({ heading: 180 * DEG }, NOSE);
    expect(south.z).toBeCloseTo(1, 9);
  });

  it('lowers the nose for positive pitch', () => {
    expect(worldPoint({ pitch: 20 * DEG }, NOSE).y).toBeLessThan(-0.3);
    expect(worldPoint({ pitch: -20 * DEG }, NOSE).y).toBeGreaterThan(0.3);
  });

  it('lowers the right side for positive roll', () => {
    expect(worldPoint({ roll: 20 * DEG }, RIGHT_SIDE).y).toBeLessThan(-0.3);
    expect(worldPoint({ roll: -20 * DEG }, RIGHT_SIDE).y).toBeGreaterThan(0.3);
  });

  it('tilts relative to the nose, whatever the heading', () => {
    // Facing east and pitched forward: the nose is east of the centre and below it.
    const nose = worldPoint({ heading: 90 * DEG, pitch: 20 * DEG }, NOSE);

    expect(nose.x).toBeGreaterThan(0.9);
    expect(nose.y).toBeLessThan(-0.3);
    expect(nose.z).toBeCloseTo(0, 9);
  });
});
