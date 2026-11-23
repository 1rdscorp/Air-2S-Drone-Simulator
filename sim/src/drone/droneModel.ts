import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Euler,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { AIR_2S_SPECS } from './air2s.config';
import type { DronePose, FlightPhase } from './droneState';

/**
 * The aircraft as a 3D shape: an original, simple folding quadcopter built from basic
 * solids. It is sized to the published outer dimensions, but it copies no DJI artwork,
 * logo or exact shape.
 *
 * The model's origin is the point where it touches the ground, and its nose points to -Z
 * (north). All measurements are in metres.
 */
export interface DroneModel {
  /** The whole aircraft. Move and turn it with `applyPose`. */
  root: Group;
  /** The camera pod under the nose. `applyPose` keeps it level and tilts it with the gimbal. */
  gimbal: Group;
  rotors: Rotor[];
}

export interface Rotor {
  /** The two blades and the hub; turns around the vertical axis. */
  blades: Group;
  /** A see-through disc shown instead of the blades when they spin too fast to see. */
  disc: Mesh;
  /** 1 or -1: neighbouring rotors turn in opposite directions. */
  direction: 1 | -1;
}

const { length: LENGTH, width: WIDTH, height: HEIGHT } = AIR_2S_SPECS.sizeUnfoldedM;

const MOTOR_RADIUS = 0.014;
/** Where the four motors sit, measured from the centre. They just fit the published size. */
export const MOTOR_OFFSET = {
  x: WIDTH / 2 - MOTOR_RADIUS,
  z: LENGTH / 2 - MOTOR_RADIUS,
} as const;
/** Radius of a propeller. */
export const PROPELLER_RADIUS = 0.088;

const BODY_BOTTOM = 0.018;
const BODY_HEIGHT = 0.042;
const MOTOR_HEIGHT = 0.02;
const MOTOR_TOP = HEIGHT - 0.011;

/**
 * Where the camera lens is, in the model's own coordinates. The drone camera (first
 * person view) looks out from here.
 */
export const LENS_POSITION = new Vector3(0, 0.024, -(LENGTH / 2 + 0.022));

/** Turns per second of the propellers while the motors idle on the ground. */
const IDLE_TURNS_PER_SECOND = 6;
/** Angle at which stopped blades rest, so the four of them do not look machine-aligned. */
const PARKED_ANGLE = 0.5;

function box(
  width: number,
  height: number,
  depth: number,
  material: MeshStandardMaterial,
  name: string,
): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
  mesh.name = name;
  return mesh;
}

/** A thin bar from one point to another. */
function bar(from: Vector3, to: Vector3, thickness: number, material: MeshStandardMaterial): Mesh {
  const arm = box(thickness * 1.6, thickness, from.distanceTo(to), material, 'drone-arm');
  arm.position.copy(from).add(to).multiplyScalar(0.5);
  arm.lookAt(to);
  return arm;
}

export function createDroneModel(): DroneModel {
  const root = new Group();
  root.name = 'drone';
  // Heading first, then the forward tilt, then the sideways tilt.
  root.rotation.order = 'YXZ';

  const shell = new MeshStandardMaterial({ color: 0xa9aeb4, roughness: 0.55 });
  const dark = new MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.7 });
  const propeller = new MeshStandardMaterial({ color: 0x16181a, roughness: 0.6 });
  const glass = new MeshStandardMaterial({ color: 0x05070a, roughness: 0.15, metalness: 0.4 });
  const frontMark = new MeshStandardMaterial({ color: 0xd93025, roughness: 0.5 });
  const rearMark = new MeshStandardMaterial({ color: 0x1e8e3e, roughness: 0.5 });
  const blur = new MeshStandardMaterial({
    color: 0x16181a,
    roughness: 0.6,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });

  // ---- Body: a rounded fuselage, flattened a little, with a dark battery cover on top.
  const bodyRadius = 0.03;
  const fuselage = new Mesh(
    new CapsuleGeometry(bodyRadius, LENGTH - 0.01 - 2 * bodyRadius, 3, 10),
    shell,
  );
  fuselage.name = 'drone-body';
  fuselage.rotation.x = Math.PI / 2; // lay the capsule along the nose-to-tail axis
  fuselage.scale.set(1.15, 1, BODY_HEIGHT / (2 * bodyRadius));
  fuselage.position.y = BODY_BOTTOM + BODY_HEIGHT / 2;

  const cover = box(0.046, 0.006, LENGTH * 0.5, dark, 'drone-battery-cover');
  cover.position.set(0, BODY_BOTTOM + BODY_HEIGHT, LENGTH * 0.1);

  const rearFoot = box(0.05, BODY_BOTTOM + 0.004, 0.012, dark, 'drone-foot');
  rearFoot.position.set(0, (BODY_BOTTOM + 0.004) / 2, LENGTH * 0.33);

  const rearLight = box(0.022, 0.006, 0.004, rearMark, 'drone-rear-mark');
  rearLight.position.set(0, BODY_BOTTOM + BODY_HEIGHT * 0.55, LENGTH / 2 - 0.004);

  root.add(fuselage, cover, rearFoot, rearLight);

  // ---- Camera pod under the nose.
  const gimbal = new Group();
  gimbal.name = 'drone-gimbal';
  gimbal.position.set(0, LENS_POSITION.y, LENS_POSITION.z + 0.016);
  const pod = box(0.03, 0.026, 0.026, dark, 'drone-camera');
  const lens = new Mesh(new CylinderGeometry(0.009, 0.009, 0.008, 16), glass);
  lens.name = 'drone-lens';
  lens.rotation.x = Math.PI / 2; // face forward
  lens.position.z = -0.016;
  gimbal.add(pod, lens);
  root.add(gimbal);

  // ---- Four arms, motors, legs and propellers. Front arms leave the body high, rear arms low.
  const rotors: Rotor[] = [];
  const motorGeometry = new CylinderGeometry(MOTOR_RADIUS, MOTOR_RADIUS, MOTOR_HEIGHT, 14);
  const hubGeometry = new CylinderGeometry(0.006, 0.006, 0.008, 10);
  const bladeGeometry = new BoxGeometry(PROPELLER_RADIUS * 2, 0.002, 0.014);
  const discGeometry = new CylinderGeometry(PROPELLER_RADIUS, PROPELLER_RADIUS, 0.001, 32);

  for (const side of [-1, 1] as const) {
    for (const end of [-1, 1] as const) {
      const isFront = end === -1;
      const motorCentre = new Vector3(
        side * MOTOR_OFFSET.x,
        MOTOR_TOP - MOTOR_HEIGHT / 2,
        end * MOTOR_OFFSET.z,
      );
      const armStart = new Vector3(
        side * 0.03,
        BODY_BOTTOM + BODY_HEIGHT * (isFront ? 0.75 : 0.45),
        end * LENGTH * 0.3,
      );
      root.add(bar(armStart, motorCentre, 0.011, isFront ? shell : dark));

      const motor = new Mesh(motorGeometry, dark);
      motor.name = 'drone-motor';
      motor.position.copy(motorCentre);
      root.add(motor);

      if (isFront) {
        // The front legs carry the aircraft; a red mark on each shows which end is the front.
        const legHeight = MOTOR_TOP - MOTOR_HEIGHT;
        const leg = box(0.008, legHeight, 0.012, dark, 'drone-leg');
        leg.position.set(motorCentre.x, legHeight / 2, motorCentre.z);
        const mark = box(0.01, 0.008, 0.004, frontMark, 'drone-front-mark');
        mark.position.set(motorCentre.x, legHeight * 0.6, motorCentre.z - 0.008);
        root.add(leg, mark);
      }

      const blades = new Group();
      blades.name = 'drone-blades';
      blades.position.set(motorCentre.x, MOTOR_TOP + 0.004, motorCentre.z);
      const hub = new Mesh(hubGeometry, propeller);
      const blade = new Mesh(bladeGeometry, propeller);
      blade.position.y = 0.003;
      blades.add(hub, blade);

      const disc = new Mesh(discGeometry, blur);
      disc.name = 'drone-propeller-disc';
      disc.position.set(motorCentre.x, MOTOR_TOP + 0.007, motorCentre.z);
      disc.visible = false;

      root.add(blades, disc);
      // Diagonal pairs turn the same way, neighbours the opposite way.
      rotors.push({ blades, disc, direction: side * end === 1 ? 1 : -1 });
    }
  }

  root.traverse((object) => {
    object.castShadow = true;
  });
  for (const rotor of rotors) {
    rotor.disc.castShadow = false; // a see-through disc should not throw a solid shadow
  }

  const model: DroneModel = { root, gimbal, rotors };
  animateRotors(model, 'motorsOff', 0);
  return model;
}

const bodyTurn = new Quaternion();
const cameraTurn = new Quaternion();
const cameraAngles = new Euler(0, 0, 0, 'YXZ');

/**
 * Moves and turns the aircraft shape to match the simulated aircraft, and points its
 * camera pod: level against the horizon whatever the aircraft does, tilted only by the
 * gimbal.
 *
 * Three.js turns counter-clockwise for positive angles, the aircraft's heading and tilts
 * are the other way round, hence the minus signs.
 */
export function applyPose(model: DroneModel, pose: Readonly<DronePose>): void {
  model.root.position.set(pose.x, pose.y, pose.z);
  model.root.rotation.set(-pose.pitch, -pose.heading, -pose.roll);

  // The pod sits on the tilting body, so undo the body's tilt and then add the gimbal's.
  bodyTurn.setFromEuler(model.root.rotation).invert();
  cameraTurn.setFromEuler(cameraAngles.set(pose.gimbalTilt, -pose.heading, 0));
  model.gimbal.quaternion.copy(bodyTurn).multiply(cameraTurn);
}

const lensRotation = new Euler(0, 0, 0, 'YXZ');

/** Where the camera lens is in the world, for the drone camera view. */
export function lensWorldPosition(pose: Readonly<DronePose>, out: Vector3): Vector3 {
  lensRotation.set(-pose.pitch, -pose.heading, -pose.roll);
  out.copy(LENS_POSITION).applyEuler(lensRotation);
  out.x += pose.x;
  out.y += pose.y;
  out.z += pose.z;
  return out;
}

/**
 * Shows the propellers for the current flight phase. This only changes how the model
 * looks; it depends on nothing but the phase and the simulated time, so the same moment
 * always looks the same.
 *
 *   motors off          blades standing still
 *   idle on the ground  blades turning slowly enough to see
 *   in powered flight   blades too fast to see: a see-through disc instead
 */
export function animateRotors(model: DroneModel, phase: FlightPhase, simTime: number): void {
  const blurred = phase === 'takingOff' || phase === 'flying' || phase === 'landing';
  const turned = phase === 'idle' ? simTime * IDLE_TURNS_PER_SECOND * 2 * Math.PI : PARKED_ANGLE;

  for (const rotor of model.rotors) {
    rotor.disc.visible = blurred;
    rotor.blades.visible = !blurred;
    rotor.blades.rotation.y = rotor.direction * turned;
  }
}
