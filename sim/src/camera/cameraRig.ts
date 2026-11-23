import { type PerspectiveCamera, Vector3 } from 'three';
import { AIR_2S_SPECS } from '../drone/air2s.config';
import { lensWorldPosition } from '../drone/droneModel';
import type { DronePose } from '../drone/droneState';

/**
 * The three views.
 *
 *   chase  Behind and above the aircraft, turning with it. The easiest view to fly from.
 *   fpv    The aircraft's own camera: what the pilot sees on the controller's screen.
 *          Stabilised by the gimbal, with the lens's real field of view.
 *   free   A spectator camera that stays on the aircraft but can be moved around it
 *          with the mouse. It does not turn with the aircraft.
 */
export const CAMERA_MODES = ['chase', 'fpv', 'free'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export const CAMERA_MODE_NAMES: Record<CameraMode, string> = {
  chase: 'Chase camera',
  fpv: 'Drone camera',
  free: 'Free camera',
};

const DEG = Math.PI / 180;

/** Chase camera: how far behind and above the aircraft it sits, in metres. */
export const CHASE_DISTANCE_M = 1.7;
export const CHASE_HEIGHT_M = 0.55;
/**
 * The chase camera looks at a point this far ahead of the aircraft and this much above
 * it. That puts the aircraft a little below the middle of the picture.
 */
const CHASE_LOOK_AHEAD_M = 2;
const CHASE_LOOK_HEIGHT_M = 0.05;
/**
 * The chase camera swings round behind the aircraft with a short delay, in seconds, so a
 * turn shows as the aircraft turning in the picture before the view follows.
 */
const CHASE_TURN_DELAY_S = 0.18;

/** Free camera: starting position around the aircraft and the limits the mouse can reach. */
export const FREE_START = { azimuth: 145 * DEG, elevation: 18 * DEG, distance: 1.6 } as const;
export const FREE_LIMITS = {
  minElevation: -10 * DEG,
  maxElevation: 85 * DEG,
  minDistance: 0.5,
  maxDistance: 80,
} as const;
/** The free camera never goes lower than this above the ground, in metres. */
const FREE_MIN_HEIGHT_M = 0.12;
/** The free camera looks at a point this far above the aircraft's underside, in metres. */
const FREE_TARGET_HEIGHT_M = 0.05;

/** Nearest distance each view can draw, in metres. The drone camera sits among the propellers. */
const NEAR_PLANE_M: Record<CameraMode, number> = { chase: 0.1, fpv: 0.03, free: 0.1 };

/** Field of view of the chase and free views, top to bottom, in degrees. */
export const VIEW_FOV_DEG = 55;

/**
 * The drone camera's field of view from side to side, in radians.
 * DJI publishes 88° across the diagonal of the full 3:2 picture; this is the same lens
 * measured across the width.
 */
export function droneCameraHorizontalFov(): number {
  const { fieldOfView, sensorAspect } = AIR_2S_SPECS.camera;
  const halfDiagonal = Math.tan(fieldOfView / 2);
  return 2 * Math.atan((halfDiagonal * sensorAspect) / Math.hypot(sensorAspect, 1));
}

/**
 * The drone camera's field of view from top to bottom, in degrees, for a picture that is
 * `aspect` times as wide as it is high. The width of the view is the lens's; the height
 * follows from the shape of the window.
 */
export function droneCameraVerticalFovDeg(aspect: number): number {
  const halfWidth = Math.tan(droneCameraHorizontalFov() / 2);
  return (2 * Math.atan(halfWidth / aspect) * 180) / Math.PI;
}

const scratch = new Vector3();

/** Places the one real camera according to the chosen view. */
export class CameraRig {
  /** Free camera: compass direction from the aircraft to the camera, height angle, distance. */
  azimuth: number = FREE_START.azimuth;
  elevation: number = FREE_START.elevation;
  distance: number = FREE_START.distance;

  private current: CameraMode;
  /** Direction the chase camera currently looks along; trails the aircraft's heading. */
  private chaseHeading: number | null = null;

  constructor(mode: CameraMode = 'chase') {
    this.current = mode;
  }

  get mode(): CameraMode {
    return this.current;
  }

  set mode(mode: CameraMode) {
    this.current = mode;
    this.snap();
  }

  /** Switches to the next view and returns it. */
  next(): CameraMode {
    const index = CAMERA_MODES.indexOf(this.current);
    this.mode = CAMERA_MODES[(index + 1) % CAMERA_MODES.length] ?? 'chase';
    return this.current;
  }

  /** Makes the next update jump straight into place instead of easing there. */
  snap(): void {
    this.chaseHeading = null;
  }

  /** Free camera: move around the aircraft. Angles in radians. */
  orbit(deltaAzimuth: number, deltaElevation: number): void {
    this.azimuth += deltaAzimuth;
    this.elevation = Math.min(
      Math.max(this.elevation + deltaElevation, FREE_LIMITS.minElevation),
      FREE_LIMITS.maxElevation,
    );
  }

  /** Free camera: move closer (factor below 1) or further away (above 1). */
  zoom(factor: number): void {
    if (Number.isFinite(factor) && factor > 0) {
      this.distance = Math.min(
        Math.max(this.distance * factor, FREE_LIMITS.minDistance),
        FREE_LIMITS.maxDistance,
      );
    }
  }

  /**
   * Places the camera for this display frame. It reads the aircraft's pose and changes
   * only the camera, never the simulation.
   * @param elapsedSeconds real time since the previous display frame
   */
  update(camera: PerspectiveCamera, pose: Readonly<DronePose>, elapsedSeconds: number): void {
    const near = NEAR_PLANE_M[this.current];
    const fov = this.current === 'fpv' ? droneCameraVerticalFovDeg(camera.aspect) : VIEW_FOV_DEG;
    if (camera.near !== near || Math.abs(camera.fov - fov) > 1e-9) {
      camera.near = near;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    switch (this.current) {
      case 'chase':
        this.placeChase(camera, pose, elapsedSeconds);
        break;
      case 'fpv':
        this.placeFpv(camera, pose);
        break;
      case 'free':
        this.placeFree(camera, pose);
        break;
    }
  }

  private placeChase(camera: PerspectiveCamera, pose: Readonly<DronePose>, elapsed: number): void {
    if (this.chaseHeading === null) {
      this.chaseHeading = pose.heading;
    } else {
      const gap = pose.heading - this.chaseHeading;
      const share = 1 - Math.exp(-Math.max(elapsed, 0) / CHASE_TURN_DELAY_S);
      // Close the last sliver outright, so a still aircraft gives a perfectly still picture.
      this.chaseHeading = Math.abs(gap) < 1e-4 ? pose.heading : this.chaseHeading + gap * share;
    }

    // The direction the camera looks along, on the ground: north is -Z, east is +X.
    const forwardX = Math.sin(this.chaseHeading);
    const forwardZ = -Math.cos(this.chaseHeading);
    camera.position.set(
      pose.x - forwardX * CHASE_DISTANCE_M,
      pose.y + CHASE_HEIGHT_M,
      pose.z - forwardZ * CHASE_DISTANCE_M,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(
      pose.x + forwardX * CHASE_LOOK_AHEAD_M,
      pose.y + CHASE_LOOK_HEIGHT_M,
      pose.z + forwardZ * CHASE_LOOK_AHEAD_M,
    );
  }

  /**
   * The aircraft's own camera. It rides on the tilting nose, but the gimbal holds it
   * steady: it looks the way the nose points, the horizon stays level whatever the
   * aircraft does, and only the gimbal tilts it up or down.
   */
  private placeFpv(camera: PerspectiveCamera, pose: Readonly<DronePose>): void {
    lensWorldPosition(pose, camera.position);
    // Heading, then tilt, and never any roll. Three.js turns the other way round, hence the minus.
    camera.rotation.set(pose.gimbalTilt, -pose.heading, 0, 'YXZ');
  }

  private placeFree(camera: PerspectiveCamera, pose: Readonly<DronePose>): void {
    const targetY = pose.y + FREE_TARGET_HEIGHT_M;
    const flat = Math.cos(this.elevation) * this.distance;
    scratch.set(
      pose.x + Math.sin(this.azimuth) * flat,
      Math.max(targetY + Math.sin(this.elevation) * this.distance, FREE_MIN_HEIGHT_M),
      pose.z - Math.cos(this.azimuth) * flat,
    );
    camera.position.copy(scratch);
    camera.up.set(0, 1, 0);
    camera.lookAt(pose.x, targetY, pose.z);
  }
}

/** The line that names the view and says how to change it. */
export function cameraLabelText(mode: CameraMode): string {
  const hint = mode === 'free' ? ' · drag to look around, scroll to zoom' : '';
  return `${CAMERA_MODE_NAMES[mode]}${hint} · V to change`;
}
