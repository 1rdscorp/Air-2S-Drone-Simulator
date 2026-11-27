import {
  distanceFromHome,
  type DroneState,
  headingDegrees,
  heightAboveHome,
} from '../drone/droneState';
import type { FlightMode } from '../input/types';

const DEGREES = 180 / Math.PI;

/** Closer to home than this, in metres, there is no meaningful direction to it. */
const HOME_DIRECTION_MIN_DISTANCE = 0.5;

/** The numbers on the flight display, in display units (metres, m/s, degrees). */
export interface HudValues {
  mode: FlightMode;
  /** Height above the home point; above the ground until there is one. */
  height: number;
  /** Distance over the ground to the home point; null until a home point exists. */
  distance: number | null;
  /** Speed over the ground. */
  speed: number;
  /** Climb rate; negative is descending. */
  climb: number;
  /** Compass heading, 0 (north) up to 360. */
  heading: number;
  /** Compass bearing from the aircraft to home; null without a home point or on top of it. */
  homeBearing: number | null;
  /**
   * Where home is as seen from the aircraft, -180 to 180: 0 is straight ahead, 90 to the
   * right, ±180 behind. Null when `homeBearing` is.
   */
  homeDirection: number | null;
  /** Nose-down tilt. */
  pitch: number;
  /** Right-side-down tilt. */
  roll: number;
  /** Camera tilt against the horizon; negative looks down. */
  gimbal: number;
  /** Seconds the motors have been running. */
  flightSeconds: number;
  /** Battery charge, 0 to 100. TODO(step-26): the battery model; until then always full. */
  battery: number;
}

/** Brings an angle in degrees into -180 (exclusive) to 180 (inclusive). */
export function wrap180(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** Reads the flight display's numbers off the simulation state. */
export function hudValues(state: Readonly<DroneState>, mode: FlightMode): HudValues {
  const heading = headingDegrees(state.heading);
  const distance = state.homeSet ? distanceFromHome(state) : null;

  let homeBearing: number | null = null;
  let homeDirection: number | null = null;
  if (distance !== null && distance >= HOME_DIRECTION_MIN_DISTANCE) {
    // North is -z and east is +x, so a bearing is measured from -z towards +x.
    const bearing = Math.atan2(state.homeX - state.x, -(state.homeZ - state.z)) * DEGREES;
    homeBearing = bearing < 0 ? bearing + 360 : bearing;
    homeDirection = wrap180(homeBearing - heading);
  }

  return {
    mode,
    height: heightAboveHome(state),
    distance,
    speed: Math.hypot(state.vx, state.vz),
    climb: state.vy,
    heading,
    homeBearing,
    homeDirection,
    pitch: state.pitch * DEGREES,
    roll: state.roll * DEGREES,
    gimbal: state.gimbalTilt * DEGREES,
    flightSeconds: state.flightSeconds,
    battery: 100,
  };
}

/** A number with one decimal that never reads "-0.0". */
function oneDecimal(value: number): string {
  const text = value.toFixed(1);
  return text === '-0.0' ? '0.0' : text;
}

/** Height in metres, for example "12.3". */
export function formatHeight(metres: number): string {
  return oneDecimal(metres);
}

/** Distance with its unit: whole metres up to 999 m, then kilometres. "–" without a home point. */
export function formatDistance(metres: number | null): { value: string; unit: string } {
  if (metres === null) {
    return { value: '–', unit: 'm' };
  }
  if (Math.round(metres) < 1000) {
    return { value: String(Math.round(metres)), unit: 'm' };
  }
  return { value: (metres / 1000).toFixed(2), unit: 'km' };
}

/** Speed in m/s, for example "5.2". */
export function formatSpeed(metresPerSecond: number): string {
  return oneDecimal(metresPerSecond);
}

/** Climb rate in m/s, always with its sign unless it is zero: "+1.5", "−3.0", "0.0". */
export function formatClimb(metresPerSecond: number): string {
  const text = Math.abs(metresPerSecond).toFixed(1);
  if (text === '0.0') {
    return text;
  }
  return `${metresPerSecond > 0 ? '+' : '−'}${text}`;
}

/** Flight time as minutes and seconds, for example "03:07". */
export function formatFlightTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${String(minutes).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

/** Compass heading as three digits, for example "045°". 360 reads "000°". */
export function formatHeading(degrees: number): string {
  return `${String(Math.round(degrees) % 360).padStart(3, '0')}°`;
}

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** The nearest of the eight compass points, for example "NE" for 50°. */
export function compassPoint(degrees: number): string {
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return COMPASS_POINTS[index] ?? 'N';
}

/** Camera tilt for display, for example "−45°" (looking down) or "+10°". Level is "0°". */
export function formatGimbal(degrees: number): string {
  const rounded = Math.round(degrees);
  if (rounded === 0) {
    return '0°';
  }
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}°`;
}

/** Battery charge, for example "100%". */
export function formatBattery(percent: number): string {
  return `${Math.round(Math.min(Math.max(percent, 0), 100))}%`;
}
