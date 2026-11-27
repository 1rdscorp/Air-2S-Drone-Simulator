import { MODE_LIMITS, PROPULSION_CHOSEN } from '../drone/air2s.config';
import { type DroneState, motorsRunning } from '../drone/droneState';
import type { FlightEvent } from '../drone/flightEvents';

/**
 * What the aircraft sounds like, worked out from the simulation state.
 *
 * Nothing here makes a sound: these functions only say which frequencies and how loud.
 * The audio engine (`audioEngine.ts`) turns that into sound in the browser. Keeping the
 * two apart means the sound can be tested without a loudspeaker.
 *
 * All sound is generated; there are no recordings.
 */

/** The four motors in the order front left, front right, rear left, rear right. */
export type PerMotor = [number, number, number, number];

export interface MotorSound {
  /** False while the motors are stopped. */
  running: boolean;
  /** Average motor speed in turns per minute. */
  rpm: number;
  /**
   * The note of each motor in hertz: how often a blade passes per second. A two-blade
   * propeller at 5900 turns per minute gives 197 Hz.
   */
  frequencies: PerMotor;
  /** Loudness next to the aircraft, 0 to 1. */
  level: number;
}

/** Air rushing past the aircraft. */
export interface AirSound {
  /** Loudness next to the aircraft, 0 to 1. */
  level: number;
  /** Where the rushing noise is centred, in hertz: higher when faster. */
  frequency: number;
}

/** Where the listener is relative to the aircraft. The listener is the camera. */
export interface Listener {
  /** Distance to the aircraft in metres. */
  distance: number;
  /** Where the aircraft is from left (-1) to right (1). */
  pan: number;
}

/** Everything the audio engine needs for one moment. */
export interface SoundFrame {
  motorRunning: boolean;
  motorFrequencies: PerMotor;
  /** Loudness of the motors at the listener, 0 to 1. */
  motorGain: number;
  /** Loudness of the rushing air at the listener, 0 to 1. */
  airGain: number;
  airFrequency: number;
  /** Distance dulls a sound: everything above this many hertz is taken away. */
  cutoff: number;
  pan: number;
}

export const SOUND_TUNING = {
  /** How much louder or quieter the motors get with thrust: loudness follows speed to this power. */
  loudnessExponent: 1.5,
  /** Loudness of the motors in a hover, next to the aircraft. */
  hoverLevel: 0.7,
  /** Share of extra thrust at the top climb speed (and of less thrust in a full descent). */
  climbLoad: 0.25,
  /** The four motors never turn at exactly the same speed; this gives the typical buzz. */
  detune: [-0.012, 0.008, 0.015, -0.006] as PerMotor,
  /** How much a motor speeds up or slows down while the aircraft tips or turns, per rad/s. */
  rateMix: 0.012,
  /** Speed at which the rushing air is at full loudness, in m/s. */
  airFullSpeed: 20,
  airLevel: 0.8,
  /** Up to this distance, in metres, a sound is at full loudness. */
  nearDistance: 2,
  /** How quickly loudness falls with distance beyond that. */
  rolloff: 0.6,
  /** Highest frequency let through next to the aircraft, in hertz. */
  nearCutoff: 9000,
  /** Distance in metres at which that has halved. */
  cutoffHalfDistance: 40,
  /** How far to one side a sound can go, 0 to 1. */
  panWidth: 0.8,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Thrust the motors give, relative to a hover (1). A tilted aircraft needs more thrust to
 * stay up; climbing takes more and descending less.
 */
export function motorLoad(state: Pick<DroneState, 'pitch' | 'roll' | 'vy'>): number {
  const tilt = Math.cos(state.pitch) * Math.cos(state.roll);
  const climb = clamp(state.vy / MODE_LIMITS.N.maxAscent, -1, 1) * SOUND_TUNING.climbLoad;
  return clamp(1 / Math.max(tilt, 0.3) + climb, 0.3, 2.4);
}

/** The motors' speed, note and loudness for the state the aircraft is in. */
export function motorSound(state: Readonly<DroneState>): MotorSound {
  const { blades, idleRpm, hoverRpm, maxRpm } = PROPULSION_CHOSEN;
  if (!motorsRunning(state.phase)) {
    return { running: false, rpm: 0, frequencies: [0, 0, 0, 0], level: 0 };
  }

  // Thrust grows with the square of the motor speed, so speed grows with its square root.
  const rpm =
    state.phase === 'idle' ? idleRpm : clamp(hoverRpm * Math.sqrt(motorLoad(state)), 0, maxRpm);

  // To tip forward the rear motors speed up, to tip right the left ones, and to turn one
  // diagonal pair. Standing on the ground nothing tips or turns.
  const mix = SOUND_TUNING.rateMix;
  const forward = state.pitchRate * mix;
  const right = state.rollRate * mix;
  const turn = state.yawRate * mix;
  const speeds: PerMotor = [
    1 - forward + right + turn,
    1 - forward - right - turn,
    1 + forward + right - turn,
    1 + forward - right + turn,
  ];

  const frequencies = speeds.map(
    (speed, motor) => (rpm * speed * (1 + (SOUND_TUNING.detune[motor] ?? 0)) * blades) / 60,
  ) as PerMotor;

  return {
    running: true,
    rpm,
    frequencies,
    level: clamp(
      SOUND_TUNING.hoverLevel * Math.pow(rpm / hoverRpm, SOUND_TUNING.loudnessExponent),
      0,
      1,
    ),
  };
}

/**
 * Air rushing past the aircraft: silent at rest, loud at top speed and in a fall.
 * TODO(step-19): measure the speed against the wind, so a hover in wind is heard too.
 */
export function airSound(state: Pick<DroneState, 'vx' | 'vy' | 'vz'>): AirSound {
  const speed = Math.hypot(state.vx, state.vy, state.vz);
  const share = clamp(speed / SOUND_TUNING.airFullSpeed, 0, 1.5);
  return {
    level: clamp(SOUND_TUNING.airLevel * share * share, 0, 1),
    frequency: 300 + 60 * Math.min(speed, 40),
  };
}

/** How much of a sound's loudness is left at this distance, 0 to 1. */
export function distanceGain(distance: number): number {
  const beyond = Math.max(distance, SOUND_TUNING.nearDistance) - SOUND_TUNING.nearDistance;
  return SOUND_TUNING.nearDistance / (SOUND_TUNING.nearDistance + SOUND_TUNING.rolloff * beyond);
}

/** The highest frequency that still reaches the listener at this distance, in hertz. */
export function distanceCutoff(distance: number): number {
  return SOUND_TUNING.nearCutoff / (1 + Math.max(distance, 0) / SOUND_TUNING.cutoffHalfDistance);
}

/**
 * Where the camera hears the aircraft.
 * @param offset from the camera to the aircraft, in metres
 * @param right unit vector pointing to the right of the picture
 */
export function listenerAt(
  offset: readonly [number, number, number],
  right: readonly [number, number, number],
): Listener {
  const distance = Math.hypot(offset[0], offset[1], offset[2]);
  const sideways = offset[0] * right[0] + offset[1] * right[1] + offset[2] * right[2];
  // Closer than a metre the direction jumps about; treat it as straight ahead.
  const pan = distance < 1 ? 0 : clamp(sideways / distance, -1, 1) * SOUND_TUNING.panWidth;
  return { distance, pan };
}

/** Puts it all together: what reaches the listener right now. */
export function soundFrame(state: Readonly<DroneState>, listener: Listener): SoundFrame {
  const motor = motorSound(state);
  const air = airSound(state);
  const loudness = distanceGain(listener.distance);
  return {
    motorRunning: motor.running,
    motorFrequencies: motor.frequencies,
    motorGain: motor.level * loudness,
    airGain: air.level * loudness,
    airFrequency: air.frequency,
    cutoff: distanceCutoff(listener.distance),
    pan: listener.pan,
  };
}

// ---- Short tones for things that happen in the flight -------------------------------------

export type ToneShape = 'sine' | 'triangle' | 'square';

/** One note of a tone. Times are in seconds from the start of the tone. */
export interface ToneNote {
  frequency: number;
  /** Frequency the note slides to by its end; leave out for a steady note. */
  slideTo?: number;
  start: number;
  duration: number;
  shape: ToneShape;
  /** Loudness, 0 to 1. */
  level: number;
}

export interface ToneSpec {
  /** Name of the tone, for tests and for telling tones apart. */
  name: string;
  notes: ToneNote[];
}

/** A run of equally long notes, one after the other. */
function melody(
  name: string,
  frequencies: number[],
  options: { length?: number; gap?: number; shape?: ToneShape; level?: number } = {},
): ToneSpec {
  const { length = 0.09, gap = 0.03, shape = 'sine', level = 0.5 } = options;
  return {
    name,
    notes: frequencies.map((frequency, index) => ({
      frequency,
      start: index * (length + gap),
      duration: length,
      shape,
      level,
    })),
  };
}

/** A dull knock: a low note that drops quickly. */
function thud(name: string, from: number, duration: number, level: number): ToneSpec {
  return {
    name,
    notes: [{ frequency: from, slideTo: from / 3, start: 0, duration, shape: 'sine', level }],
  };
}

/**
 * The tone for a flight event, or null when the event needs none: starting, stopping and
 * lifting off are heard in the motors themselves.
 *
 * Rising notes mean "going up" or "good", falling notes "coming down" or "lost", and the
 * harsh square notes are warnings.
 */
export function toneForEvent(event: FlightEvent): ToneSpec | null {
  switch (event.type) {
    case 'takeoffStarted':
      return melody('takeoffStarted', [659, 880], { shape: 'triangle' });
    case 'takeoffComplete':
      return melody('takeoffComplete', [1047], { length: 0.14, level: 0.4 });
    case 'takeoffStopped':
      return melody('takeoffStopped', [587, 587], { level: 0.4 });
    case 'landingStarted':
      return melody('landingStarted', [880, 659], { shape: 'triangle' });
    case 'landingCancelled':
      return melody('landingCancelled', [587, 587], { level: 0.4 });
    case 'landed':
      return melody('landed', [784, 659, 523], { level: 0.45 });
    case 'touchedDown':
      return thud('touchedDown', 110, 0.12, 0.5);
    case 'hitGround':
      return thud('hitGround', 150, 0.3, 0.9);
    case 'crashed':
      // A hard knock, then two falling warning notes.
      return {
        name: 'crashed',
        notes: [
          { frequency: 190, slideTo: 45, start: 0, duration: 0.35, shape: 'square', level: 0.7 },
          { frequency: 440, start: 0.42, duration: 0.14, shape: 'square', level: 0.3 },
          { frequency: 311, start: 0.6, duration: 0.22, shape: 'square', level: 0.3 },
        ],
      };
    case 'backAtStart':
      return melody('backAtStart', [523, 659], { level: 0.35 });
    case 'motorsCut':
      return melody('motorsCut', [988, 988, 988, 988], {
        length: 0.12,
        gap: 0.08,
        shape: 'square',
        level: 0.35,
      });
    case 'controlLost':
      return melody('controlLost', [740, 622, 494], { shape: 'square', level: 0.3 });
    case 'controlRestored':
      return melody('controlRestored', [494, 740], { level: 0.45 });
    case 'modeChanged': {
      // The faster the mode, the higher the note. Sport gets two.
      const notes = { C: [440], N: [554], S: [740, 932] }[event.mode ?? 'N'];
      return melody(`mode${event.mode ?? 'N'}`, notes, { length: 0.06, gap: 0.02, level: 0.4 });
    }
    case 'homePointSet':
    case 'motorsStarted':
    case 'motorsStopped':
    case 'liftedOff':
      return null;
  }
}

/** How long a tone lasts from its first note to the end of its last, in seconds. */
export function toneLength(tone: ToneSpec): number {
  return Math.max(0, ...tone.notes.map((note) => note.start + note.duration));
}
