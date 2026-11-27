/**
 * What the aircraft is doing.
 *
 *   motorsOff  Motors stopped. On the ground this is the resting state; in the air it
 *              means the motors were cut and the aircraft is falling.
 *   idle       Standing on the ground with the motors running, ready to lift off.
 *              This is also where a landing by hand ends.
 *   takingOff  Automatic take-off: climbing to hover height.
 *   flying     Normal flight under the pilot's sticks.
 *   landing    Automatic landing: descending until touchdown, then the motors stop.
 *   crashed    It hit something. The motors are off, it falls to the ground and lies
 *              there for a moment, then it is put back at the start.
 */
export const FLIGHT_PHASES = [
  'motorsOff',
  'idle',
  'takingOff',
  'flying',
  'landing',
  'crashed',
] as const;
export type FlightPhase = (typeof FLIGHT_PHASES)[number];

/** True in the phases in which the motors turn. */
export function motorsRunning(phase: FlightPhase): boolean {
  return phase === 'idle' || phase === 'takingOff' || phase === 'flying' || phase === 'landing';
}

/**
 * Everything the simulation knows about the aircraft at one moment. Plain numbers and
 * flags only, so it can be copied, compared and sent to tests.
 *
 * Axes: x is east, y is up, z is south (north is -z). Units: metres, seconds, radians.
 */
export interface DroneState {
  phase: FlightPhase;
  /**
   * Position. `y` is the height of the aircraft's underside in the world, so the aircraft
   * stands on the ground when `y` equals `groundY`.
   */
  x: number;
  y: number;
  z: number;
  /** Height of the surface straight below the aircraft: the ground, or the top of what stands there. */
  groundY: number;
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
  /** Seconds the stick command (both sticks down and inward or outward) has been held. */
  stickCommandSeconds: number;
  /** False after the stick command has acted, until the sticks have been let go again. */
  stickCommandArmed: boolean;
  /** Seconds the throttle has been held fully down while standing with the motors running. */
  throttleDownSeconds: number;
  /** Whether the take-off / landing and the flight-pause buttons were down in the last step. */
  takeoffButtonWasDown: boolean;
  pauseButtonWasDown: boolean;
  /**
   * Camera tilt against the horizon: 0 is level, negative looks down (-90° is straight
   * down), positive looks up. It does not change when the aircraft tilts.
   */
  gimbalTilt: number;
  /** How fast the camera tilt is changing. */
  gimbalRate: number;
  /** True while a shortcut (recentre, look down) is moving the camera to `gimbalTarget`. */
  gimbalMovingToTarget: boolean;
  gimbalTarget: number;
  /**
   * True from a shortcut that was pressed while the dial was turned, until the dial has
   * been let go: the dial is not listened to meanwhile.
   */
  gimbalDialOverruled: boolean;
  /** Whether the two gimbal shortcut buttons (C1, C2) were down in the last step. */
  c1ButtonWasDown: boolean;
  c2ButtonWasDown: boolean;
  /**
   * Home point: where the aircraft stood when its motors were last started. `homeSet` is
   * false until the motors have been started for the first time.
   */
  homeSet: boolean;
  homeX: number;
  homeZ: number;
  /** Height of the home point. The height shown to the pilot is measured from it. */
  homeY: number;
  /** Flight time: seconds the motors have been running since they were last started. */
  flightSeconds: number;
  /** Seconds a crashed aircraft has been lying on the ground. */
  crashSeconds: number;
}

/** The part of the state that is needed to draw the aircraft. */
export interface DronePose {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
  /** Camera tilt against the horizon; see `DroneState.gimbalTilt`. */
  gimbalTilt: number;
}

/** Where a state starts: on the ground at the origin facing north, unless said otherwise. */
export interface StartPlace {
  x?: number;
  z?: number;
  /** Height of the ground there. */
  ground?: number;
  heading?: number;
}

/** The aircraft at the start: standing on the ground, motors off. */
export function createDroneState(place: StartPlace = {}): DroneState {
  const ground = place.ground ?? 0;
  return {
    phase: 'motorsOff',
    x: place.x ?? 0,
    y: ground,
    z: place.z ?? 0,
    groundY: ground,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: place.heading ?? 0,
    pitch: 0,
    roll: 0,
    yawRate: 0,
    pitchRate: 0,
    rollRate: 0,
    onGround: true,
    holdActive: false,
    holdX: 0,
    holdZ: 0,
    altitudeHoldActive: false,
    holdY: 0,
    stickCommandSeconds: 0,
    stickCommandArmed: true,
    throttleDownSeconds: 0,
    takeoffButtonWasDown: false,
    pauseButtonWasDown: false,
    gimbalTilt: 0,
    gimbalRate: 0,
    gimbalMovingToTarget: false,
    gimbalTarget: 0,
    gimbalDialOverruled: false,
    c1ButtonWasDown: false,
    c2ButtonWasDown: false,
    homeSet: false,
    homeX: place.x ?? 0,
    homeZ: place.z ?? 0,
    homeY: ground,
    flightSeconds: 0,
    crashSeconds: 0,
  };
}

/**
 * The aircraft already in the air: hovering at rest `height` metres above the start.
 * Its home point is straight below it, and its flight clock starts at zero.
 */
export function createFlyingState(height: number, place: StartPlace = {}): DroneState {
  const start = createDroneState(place);
  return {
    ...start,
    phase: 'flying',
    y: start.groundY + height,
    onGround: false,
    holdActive: true,
    holdX: start.x,
    holdZ: start.z,
    altitudeHoldActive: true,
    holdY: start.groundY + height,
    homeSet: true,
  };
}

/** Height above the home point, which is what the pilot is shown; above the ground before there is one. */
export function heightAboveHome(
  state: Pick<DroneState, 'y' | 'homeSet' | 'homeY' | 'groundY'>,
): number {
  return state.y - (state.homeSet ? state.homeY : state.groundY);
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
  out.gimbalTilt = from.gimbalTilt + (to.gimbalTilt - from.gimbalTilt) * t;
  return out;
}

/** Distance over the ground from the aircraft to its home point, in metres. 0 while no home point is set. */
export function distanceFromHome(
  state: Pick<DroneState, 'x' | 'z' | 'homeSet' | 'homeX' | 'homeZ'>,
): number {
  return state.homeSet ? Math.hypot(state.homeX - state.x, state.homeZ - state.z) : 0;
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
