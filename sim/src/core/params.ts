import { CAMERA_MODES, type CameraMode } from '../camera/cameraRig';
import { DEFAULT_INPUT_SETTINGS } from '../input/inputManager';
import { STICK_MODES, type StickMode } from '../input/types';
import { ENV_IDS, type EnvId } from '../world/environment';
import { MAX_TIME_SCALE, MIN_TIME_SCALE } from './gameLoop';

/** Quality presets from docs/PLAN.md. TODO(step-20): take these from the quality settings. */
export const QUALITY_IDS = ['low', 'medium', 'high', 'ultra'] as const;
export type QualityId = (typeof QUALITY_IDS)[number];

/**
 * Settings read from the page address, for example
 * `?env=city&time=21.5&seed=7&quality=low&debug=1&paused=1&speed=0.5&stickmode=2&sound=0`.
 * They make any view repeatable, which screenshots and tests rely on.
 */
export interface SimParams {
  /** The place to fly in at the start; the test field when left out. */
  env: EnvId | null;
  /** Time of day in hours, 0 to 24. Not used yet. TODO(step-17) */
  timeOfDay: number | null;
  /** Seed for everything generated. Not used yet. TODO(step-11) */
  seed: number;
  /** Graphics quality preset. Not used yet. TODO(step-20) */
  quality: QualityId | null;
  /** Show the debug overlay at start. */
  debug: boolean;
  /** Start with the simulation paused. */
  paused: boolean;
  /** Simulation speed relative to real time. */
  speed: number;
  /** Which stick does what: 1, 2 or 3. Address name: `stickmode`. */
  stickMode: StickMode;
  /** Stick expo curve strength, 0 to 1. */
  expo: number;
  /** Show the stick monitor at start. */
  sticks: boolean;
  /** View at start: chase, fpv (the drone's own camera) or free. */
  camera: CameraMode;
  /** Lets the camera gimbal tilt above level, up to +24°. Address name: `gimbalup`. */
  gimbalUpward: boolean;
  /** Start with the sound on. The M key switches it while flying. */
  sound: boolean;
  /** Overall loudness, 0 to 1. */
  volume: number;
}

export const DEFAULT_PARAMS: Readonly<SimParams> = {
  env: null,
  timeOfDay: null,
  seed: 1,
  quality: null,
  debug: false,
  paused: false,
  speed: 1,
  stickMode: DEFAULT_INPUT_SETTINGS.stickMode,
  expo: DEFAULT_INPUT_SETTINGS.expo,
  sticks: true,
  camera: 'chase',
  gimbalUpward: false,
  sound: true,
  volume: 0.7,
};

export interface ParsedParams {
  params: SimParams;
  /** One message for every value that was not understood and replaced by its default. */
  warnings: string[];
}

const TRUE_WORDS = ['', '1', 'true', 'on', 'yes'];
const FALSE_WORDS = ['0', 'false', 'off', 'no'];

/** Reads the simulator settings from a query string such as `location.search`. */
export function parseParams(search: string): ParsedParams {
  const query = new URLSearchParams(search);
  const params: SimParams = { ...DEFAULT_PARAMS };
  const warnings: string[] = [];

  const reject = (name: string, value: string, expected: string): void => {
    warnings.push(`Ignored ${name}="${value}": expected ${expected}.`);
  };

  const oneOf = <T extends string>(name: string, allowed: readonly T[]): T | null => {
    const raw = query.get(name);
    if (raw === null) {
      return null;
    }
    const value = raw.trim().toLowerCase();
    const match = allowed.find((item) => item === value);
    if (match === undefined) {
      reject(name, raw, `one of ${allowed.join(', ')}`);
      return null;
    }
    return match;
  };

  const numberBetween = (name: string, min: number, max: number): number | null => {
    const raw = query.get(name);
    if (raw === null) {
      return null;
    }
    const value = raw.trim() === '' ? Number.NaN : Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      reject(name, raw, `a number from ${min} to ${max}`);
      return null;
    }
    return value;
  };

  const flag = (name: string, fallback: boolean): boolean => {
    const raw = query.get(name);
    if (raw === null) {
      return fallback;
    }
    const value = raw.trim().toLowerCase();
    if (TRUE_WORDS.includes(value)) {
      return true;
    }
    if (FALSE_WORDS.includes(value)) {
      return false;
    }
    reject(name, raw, '1 or 0');
    return fallback;
  };

  params.env = oneOf('env', ENV_IDS);
  params.quality = oneOf('quality', QUALITY_IDS);
  params.timeOfDay = numberBetween('time', 0, 24);

  const seed = numberBetween('seed', 0, 0xffffffff);
  if (seed !== null) {
    if (Number.isInteger(seed)) {
      params.seed = seed;
    } else {
      reject('seed', String(seed), 'a whole number');
    }
  }

  params.speed = numberBetween('speed', MIN_TIME_SCALE, MAX_TIME_SCALE) ?? DEFAULT_PARAMS.speed;
  params.debug = flag('debug', DEFAULT_PARAMS.debug);
  params.paused = flag('paused', DEFAULT_PARAMS.paused);

  const stickModeRaw = query.get('stickmode');
  if (stickModeRaw !== null) {
    const match = STICK_MODES.find((mode) => String(mode) === stickModeRaw.trim());
    if (match === undefined) {
      reject('stickmode', stickModeRaw, `one of ${STICK_MODES.join(', ')}`);
    } else {
      params.stickMode = match;
    }
  }
  params.expo = numberBetween('expo', 0, 1) ?? DEFAULT_PARAMS.expo;
  params.sticks = flag('sticks', DEFAULT_PARAMS.sticks);
  params.camera = oneOf('camera', CAMERA_MODES) ?? DEFAULT_PARAMS.camera;
  params.gimbalUpward = flag('gimbalup', DEFAULT_PARAMS.gimbalUpward);
  params.sound = flag('sound', DEFAULT_PARAMS.sound);
  params.volume = numberBetween('volume', 0, 1) ?? DEFAULT_PARAMS.volume;

  return { params, warnings };
}
