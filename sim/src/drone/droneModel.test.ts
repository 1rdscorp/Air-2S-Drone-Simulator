import { Box3, type Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { AIR_2S_SPECS } from './air2s.config';
import {
  animateRotors,
  applyPose,
  createDroneModel,
  LENS_POSITION,
  lensWorldPosition,
  MOTOR_OFFSET,
  PROPELLER_RADIUS,
} from './droneModel';
import { type DronePose, FLIGHT_PHASES } from './droneState';

const DEG = Math.PI / 180;

function pose(change: Partial<DronePose> = {}): DronePose {
  return { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, ...change };
}

/** Where a point of the aircraft ends up in the world. */
function worldPoint(change: Partial<DronePose>, local: Vector3): Vector3 {
  const { root } = createDroneModel();
  applyPose(root, pose(change));
  root.updateMatrixWorld(true);
  return local.clone().applyMatrix4(root.matrixWorld);
}

function named(root: Object3D, name: string): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((object) => {
    if (object.name === name) {
      found.push(object);
    }
  });
  return found;
}

const NOSE = new Vector3(0, 0, -1);
const RIGHT_SIDE = new Vector3(1, 0, 0);

describe('createDroneModel', () => {
  it('is a quadcopter: one body, four arms, four motors, four propellers and a camera', () => {
    const model = createDroneModel();

    expect(named(model.root, 'drone-body')).toHaveLength(1);
    expect(named(model.root, 'drone-arm')).toHaveLength(4);
    expect(named(model.root, 'drone-motor')).toHaveLength(4);
    expect(named(model.root, 'drone-blades')).toHaveLength(4);
    expect(named(model.root, 'drone-propeller-disc')).toHaveLength(4);
    expect(named(model.root, 'drone-camera')).toHaveLength(1);
    expect(model.rotors).toHaveLength(4);
  });

  it('is about as big as the published size, propellers aside', () => {
    const model = createDroneModel();
    for (const rotor of model.rotors) {
      rotor.blades.visible = false;
      rotor.disc.visible = false;
    }
    const size = new Box3().setFromObject(model.root, true).getSize(new Vector3());
    const published = AIR_2S_SPECS.sizeUnfoldedM;

    // Box3 counts hidden parts too, so measure the frame from the motor positions instead.
    expect(2 * (MOTOR_OFFSET.x + 0.014)).toBeCloseTo(published.width, 3);
    expect(2 * (MOTOR_OFFSET.z + 0.014)).toBeCloseTo(published.length, 3);
    expect(size.y).toBeGreaterThan(published.height * 0.8);
    expect(size.y).toBeLessThan(published.height * 1.25);
  });

  it('stands on the ground: its lowest point is at height 0', () => {
    const { root } = createDroneModel();
    const box = new Box3().setFromObject(root, true);

    expect(box.min.y).toBeCloseTo(0, 3);
  });

  it('has its camera and its red marks at the front, and a green mark at the back', () => {
    const { root, gimbal } = createDroneModel();

    expect(gimbal.position.z).toBeLessThan(-AIR_2S_SPECS.sizeUnfoldedM.length * 0.4);
    expect(LENS_POSITION.z).toBeLessThan(gimbal.position.z);
    for (const mark of named(root, 'drone-front-mark')) {
      expect(mark.position.z).toBeLessThan(0);
    }
    expect(named(root, 'drone-front-mark')).toHaveLength(2);
    expect(named(root, 'drone-rear-mark')[0]?.position.z).toBeGreaterThan(0);
  });

  it('puts a propeller over each motor, and neighbours turn opposite ways', () => {
    const model = createDroneModel();
    const motors = named(model.root, 'drone-motor');

    for (const rotor of model.rotors) {
      const over = motors.some(
        (motor) =>
          Math.abs(motor.position.x - rotor.blades.position.x) < 1e-9 &&
          Math.abs(motor.position.z - rotor.blades.position.z) < 1e-9 &&
          rotor.blades.position.y > motor.position.y,
      );
      expect(over).toBe(true);
    }
    const turning = (x: number, z: number): number =>
      model.rotors.find(
        (rotor) =>
          Math.sign(rotor.blades.position.x) === x && Math.sign(rotor.blades.position.z) === z,
      )?.direction ?? 0;
    expect(turning(1, 1)).toBe(-turning(-1, 1));
    expect(turning(1, 1)).toBe(-turning(1, -1));
    expect(turning(1, 1)).toBe(turning(-1, -1));
  });

  it('keeps the propellers of the two sides apart', () => {
    expect(MOTOR_OFFSET.x).toBeGreaterThan(PROPELLER_RADIUS);
  });

  it('casts shadows, except for the see-through propeller discs', () => {
    const model = createDroneModel();

    expect(named(model.root, 'drone-body')[0]?.castShadow).toBe(true);
    expect(named(model.root, 'drone-arm').every((arm) => arm.castShadow)).toBe(true);
    expect(model.rotors.every((rotor) => !rotor.disc.castShadow)).toBe(true);
  });
});

describe('animateRotors', () => {
  it('shows still blades when the motors are off', () => {
    const model = createDroneModel();
    animateRotors(model, 'motorsOff', 0);
    const parked = model.rotors.map((rotor) => rotor.blades.rotation.y);

    animateRotors(model, 'motorsOff', 12.5);

    for (const [index, rotor] of model.rotors.entries()) {
      expect(rotor.blades.visible).toBe(true);
      expect(rotor.disc.visible).toBe(false);
      expect(rotor.blades.rotation.y).toBe(parked[index]);
    }
  });

  it('turns the blades visibly while the motors idle on the ground', () => {
    const model = createDroneModel();
    animateRotors(model, 'idle', 1);
    const before = model.rotors.map((rotor) => rotor.blades.rotation.y);

    animateRotors(model, 'idle', 1.01);

    for (const [index, rotor] of model.rotors.entries()) {
      expect(rotor.blades.visible).toBe(true);
      expect(rotor.disc.visible).toBe(false);
      const turned = rotor.blades.rotation.y - (before[index] ?? 0);
      expect(Math.abs(turned)).toBeGreaterThan(0.1);
      expect(Math.sign(turned)).toBe(rotor.direction);
    }
  });

  it('shows see-through discs instead of blades in powered flight', () => {
    const model = createDroneModel();
    for (const phase of ['takingOff', 'flying', 'landing'] as const) {
      animateRotors(model, phase, 3);

      expect(
        model.rotors.every((rotor) => rotor.disc.visible),
        phase,
      ).toBe(true);
      expect(
        model.rotors.every((rotor) => !rotor.blades.visible),
        phase,
      ).toBe(true);
    }
  });

  it('looks the same for the same phase and time, whatever happened before', () => {
    const first = createDroneModel();
    const second = createDroneModel();
    for (const phase of FLIGHT_PHASES) {
      animateRotors(first, phase, 99);
    }

    animateRotors(first, 'idle', 4.2);
    animateRotors(second, 'idle', 4.2);

    expect(first.rotors.map((rotor) => rotor.blades.rotation.y)).toEqual(
      second.rotors.map((rotor) => rotor.blades.rotation.y),
    );
  });
});

describe('applyPose', () => {
  it('moves the model to the position of the aircraft', () => {
    const { root } = createDroneModel();
    applyPose(root, pose({ x: 5, y: 12, z: -30 }));

    expect(root.position.toArray()).toEqual([5, 12, -30]);
  });

  it('points the nose north at heading 0 and east at heading 90', () => {
    expect(worldPoint({}, NOSE).z).toBeCloseTo(-1, 9);

    const east = worldPoint({ heading: 90 * DEG }, NOSE);
    expect(east.x).toBeCloseTo(1, 9);
    expect(east.z).toBeCloseTo(0, 9);
  });

  it('lowers the nose for positive pitch and the right side for positive roll', () => {
    expect(worldPoint({ pitch: 20 * DEG }, NOSE).y).toBeLessThan(-0.3);
    expect(worldPoint({ pitch: -20 * DEG }, NOSE).y).toBeGreaterThan(0.3);
    expect(worldPoint({ roll: 20 * DEG }, RIGHT_SIDE).y).toBeLessThan(-0.3);
    expect(worldPoint({ roll: -20 * DEG }, RIGHT_SIDE).y).toBeGreaterThan(0.3);
  });

  it('tilts relative to the nose, whatever the heading', () => {
    const nose = worldPoint({ heading: 90 * DEG, pitch: 20 * DEG }, NOSE);

    expect(nose.x).toBeGreaterThan(0.9);
    expect(nose.y).toBeLessThan(-0.3);
    expect(nose.z).toBeCloseTo(0, 9);
  });
});

describe('lensWorldPosition', () => {
  it('is where the lens of the model really is, for any pose', () => {
    const poses: Partial<DronePose>[] = [
      {},
      { x: 40, y: 12, z: -7 },
      { heading: 130 * DEG },
      { pitch: 25 * DEG, roll: -15 * DEG, heading: -40 * DEG, y: 3 },
    ];
    for (const change of poses) {
      const expected = worldPoint(change, LENS_POSITION);
      const actual = lensWorldPosition(pose(change), new Vector3());

      expect(actual.distanceTo(expected), JSON.stringify(change)).toBeLessThan(1e-9);
    }
  });

  it('is at the front of the aircraft and moves down when the nose dips', () => {
    const level = lensWorldPosition(pose({ y: 10 }), new Vector3());
    const dipped = lensWorldPosition(pose({ y: 10, pitch: 30 * DEG }), new Vector3());

    expect(level.z).toBeLessThan(-0.05);
    expect(dipped.y).toBeLessThan(level.y - 0.02);
  });
});
