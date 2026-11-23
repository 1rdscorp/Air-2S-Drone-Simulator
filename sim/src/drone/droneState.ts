import { START_HEIGHT } from './air2s.config';

/**
 * Everything the simulation knows about the aircraft at one moment. Plain numbers and
 * flags only, so it can be copied, compared and sent to tests.
 *
 * Axes: x is east, y is up, z is south (north is -z). Units: metres, seconds, radians.
 */
export interface DroneState {
  /** Position. `y` is the height of the aircraft's underside, so 0 means standing on the ground. */
  x: number;
  y: number;
  z: number;
  /** Velocity. */
  vx: number;
  vy: number;
  vz: number;
  /** Heading: 0 is north, positive is turned right (clockwise seen from above). Not wrapped at 360°. */
  heading: number;
  /** Forward tilt: positive is nose down, which accelerates the aircraft forward. */
  pitch: number;
  /** Sideways tilt: positive is right side down, which accelerates the aircraft to the right. */
  roll: number;
  /** How fast heading, pitch and roll are changing. */
  yawRate: number;
  pitchRate: number;
  rollRate: number;
  /** True while the aircraft stands on the ground. */
  onGround: boolean;
  /** Position hold: true once the hover point is fixed, and where it is. */
  holdActive: boolean;
  holdX: number;
  holdZ: number;
  /** Height hold: true once the hover height is fixed, and what it is. */
  altitudeHoldActive: boolean;
  holdY: number;
}

/** The part of the state that is needed to draw the aircraft. */
export interface DronePose {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
}

/** The aircraft at the start: hovering at rest above the origin, facing north. */
export function createDroneState(): DroneState {
  return {
    x: 0,
    y: START_HEIGHT,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: 0,
    pitch: 0,
    roll: 0,
    yawRate: 0,
    pitchRate: 0,
    rollRate: 0,
    onGround: false,
    holdActive: true,
    holdX: 0,
    holdZ: 0,
    altitudeHoldActive: true,
    holdY: START_HEIGHT,
  };
}

export function copyDroneState(target: DroneState, source: DroneState): void {
  Object.assign(target, source);
}

/** Blends two states for drawing: `alpha` 0 gives `from`, 1 gives `to`. */
export function blendPose(
  out: DronePose,
  from: DroneState,
  to: DroneState,
  alpha: number,
): DronePose {
  const t = Math.min(Math.max(alpha, 0), 1);
  out.x = from.x + (to.x - from.x) * t;
  out.y = from.y + (to.y - from.y) * t;
  out.z = from.z + (to.z - from.z) * t;
  out.heading = from.heading + (to.heading - from.heading) * t;
  out.pitch = from.pitch + (to.pitch - from.pitch) * t;
  out.roll = from.roll + (to.roll - from.roll) * t;
  return out;
}

/** Speed over the ground, in m/s. */
export function horizontalSpeed(state: Pick<DroneState, 'vx' | 'vz'>): number {
  return Math.hypot(state.vx, state.vz);
}

/** Heading as a compass bearing from 0 (north) up to, but not including, 360 degrees. */
export function headingDegrees(heading: number): number {
  const degrees = ((heading * 180) / Math.PI) % 360;
  return degrees < 0 ? degrees + 360 : degrees;
}
