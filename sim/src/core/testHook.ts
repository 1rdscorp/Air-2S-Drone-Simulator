import type { AudioSnapshot } from '../audio/audioEngine';
import type { CameraMode } from '../camera/cameraRig';
import type { JoystickMapping } from '../input/joystickMapping';
import type { JoystickStatus } from '../input/joystickSource';
import type { ButtonId, ControlFrame, StickMode, StickPositions } from '../input/types';
import type { SimParams } from './params';
import type { SimState } from './simulation';

/** Simulation state plus the loop counters and a few handy derived values, as plain data. */
export interface SimSnapshot extends SimState {
  tick: number;
  /** Simulated time in seconds. */
  time: number;
  /** Speed over the ground in m/s. */
  speed: number;
  /** Heading as a compass bearing, 0 (north) up to 360 degrees. */
  headingDeg: number;
}

/** Stick positions and buttons a test can set directly. Anything left out is centred or released. */
export type ScriptedControls = Partial<
  Pick<ControlFrame, 'roll' | 'pitch' | 'yaw' | 'throttle' | 'gimbal' | 'mode' | 'connected'>
> & { buttons?: Partial<Record<ButtonId, boolean>> };

export interface SimStatsSnapshot {
  fps: number;
  frameMs: number;
  maxFrameMs: number;
  drawCalls: number;
  triangles: number;
}

/** What the input layer is producing right now. */
export interface InputSnapshot {
  /** Id of the control source in use, for example 'keyboard' or 'gamepad'. */
  source: string;
  stickMode: StickMode;
  expo: number;
  /** The controls the flight controller receives. */
  frame: ControlFrame;
  /** Stick positions as the device reports them. */
  raw: StickPositions;
  /** Stick positions after deadzone and expo. */
  shaped: StickPositions;
}

/** The flight stick: whether one is there, and the setup in use. */
export interface JoystickSnapshot {
  status: JoystickStatus;
  /** The setup saved by the pilot, or null when there is none. */
  mapping: JoystickMapping | null;
  /** Names of the flight devices the browser shows. */
  devices: string[];
  /** True while the setup screen is open. */
  setupOpen: boolean;
}

/** Where the view is right now. */
export interface CameraSnapshot {
  mode: CameraMode;
  /** Camera position in the world, [x, y, z] in metres. */
  position: [number, number, number];
  /** Unit vector the camera looks along, [x, y, z]. */
  direction: [number, number, number];
  /** Free camera settings: direction from the aircraft in degrees, height angle in degrees, distance in metres. */
  free: { azimuthDeg: number; elevationDeg: number; distance: number };
}

/**
 * `window.__sim`: a small remote control for automated tests and for the browser console.
 * It drives the same loop the app uses; it is not a second way to run the simulation.
 */
export interface SimHook {
  /** App version from package.json. */
  readonly version: string;
  /** Settings read from the page address. */
  readonly params: Readonly<SimParams>;
  /** Number of simulation steps completed. */
  readonly tick: number;
  /** Simulated time in seconds. */
  readonly time: number;
  readonly paused: boolean;
  /** Simulation speed relative to real time. */
  timeScale: number;
  pause(): void;
  resume(): void;
  /** Runs exactly `count` simulation steps (default 1) and draws a frame. Works while paused. */
  step(count?: number): void;
  /**
   * Puts the aircraft back at the start: on the ground with the motors off.
   * With `height`, it starts hovering at that many metres instead.
   */
  reset(options?: { height?: number }): void;
  /**
   * Flies with these stick positions instead of the pilot's, until called with `null`.
   * Values go straight to the flight controller: no stick mode, deadzone or expo.
   */
  setControls(controls: ScriptedControls | null): void;
  /** A copy of the current simulation state. */
  getState(): SimSnapshot;
  /** Frame-rate and renderer numbers from the most recent frames. */
  getStats(): SimStatsSnapshot;
  /** A copy of the current controls and which device they come from. */
  getInput(): InputSnapshot;
  /** Switches the view and draws a frame. */
  setCamera(mode: CameraMode): void;
  /** Where the view is right now. */
  getCamera(): CameraSnapshot;
  /** What the sound is doing right now, with the loudness measured at the output. */
  getAudio(): AudioSnapshot;
  /** The flight stick and its setup. */
  getJoystick(): JoystickSnapshot;
}

declare global {
  interface Window {
    __sim?: SimHook;
  }
}

export function installTestHook(hook: SimHook): void {
  window.__sim = hook;
}
