import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { AIR_2S_SPECS } from './air2s.config';
import type { DronePose } from './droneState';

/**
 * A simple shape that stands in for the aircraft until the real model exists: a body in
 * the published size, a dark block that marks the nose, and four rotor discs.
 * TODO(step-07): replace with the drone model.
 *
 * The group's origin is the aircraft's underside, and its nose points to -Z (north).
 */
export function createDroneStandIn(): Group {
  const { length, width, height } = AIR_2S_SPECS.sizeUnfoldedM;
  const group = new Group();
  group.name = 'drone';
  // Heading first, then the forward tilt, then the sideways tilt.
  group.rotation.order = 'YXZ';

  const bodyMaterial = new MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 });
  const darkMaterial = new MeshStandardMaterial({ color: 0x22262b, roughness: 0.8 });

  const body = new Mesh(new BoxGeometry(width * 0.5, height, length), bodyMaterial);
  body.name = 'drone-body';
  body.position.y = height / 2;

  const nose = new Mesh(new BoxGeometry(width * 0.3, height * 0.7, length * 0.3), darkMaterial);
  nose.name = 'drone-nose';
  nose.position.set(0, height / 2, -length * 0.6);

  group.add(body, nose);

  const rotorGeometry = new CylinderGeometry(width * 0.27, width * 0.27, 0.008, 20);
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const rotor = new Mesh(rotorGeometry, darkMaterial);
      rotor.name = 'drone-rotor';
      rotor.position.set(side * width * 0.5, height + 0.01, end * length * 0.55);
      group.add(rotor);
    }
  }

  group.traverse((object) => {
    object.castShadow = true;
  });
  return group;
}

/**
 * Moves and turns a drone shape to match the simulated aircraft.
 * Three.js turns counter-clockwise for positive angles, the aircraft's heading and tilts
 * are the other way round, hence the minus signs.
 */
export function applyPose(group: Group, pose: Readonly<DronePose>): void {
  group.position.set(pose.x, pose.y, pose.z);
  group.rotation.set(-pose.pitch, -pose.heading, -pose.roll);
}
