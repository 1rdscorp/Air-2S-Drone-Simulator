import type { PerspectiveCamera } from 'three';
import type { DronePose } from '../drone/droneState';

/** How far behind and above the aircraft the camera sits, in metres. */
export const FOLLOW_DISTANCE_M = 2.4;
export const FOLLOW_HEIGHT_M = 0.8;
/**
 * The camera looks at a point this far ahead of the aircraft and this much above it, in
 * metres. That puts the aircraft a little below the middle of the picture.
 */
const LOOK_AHEAD_M = 2;
const LOOK_HEIGHT_M = 0.1;

/**
 * Puts the camera behind the aircraft, looking the way its nose points, so that
 * "stick forward" always flies into the screen.
 *
 * This is the simplest camera that makes the flight visible.
 * TODO(step-07): replace with the chase, gimbal and free cameras.
 */
export function placeFollowCamera(camera: PerspectiveCamera, pose: Readonly<DronePose>): void {
  // The aircraft's forward direction on the ground: north is -Z, east is +X.
  const forwardX = Math.sin(pose.heading);
  const forwardZ = -Math.cos(pose.heading);

  camera.position.set(
    pose.x - forwardX * FOLLOW_DISTANCE_M,
    pose.y + FOLLOW_HEIGHT_M,
    pose.z - forwardZ * FOLLOW_DISTANCE_M,
  );
  camera.lookAt(
    pose.x + forwardX * LOOK_AHEAD_M,
    pose.y + LOOK_HEIGHT_M,
    pose.z + forwardZ * LOOK_AHEAD_M,
  );
}
