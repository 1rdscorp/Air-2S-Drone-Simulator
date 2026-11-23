import type { SimParams } from './params';
import type { SimState } from './simulation';

/** Simulation state plus the loop counters, as plain data. */
export interface SimSnapshot extends SimState {
  tick: number;
  /** Simulated time in seconds. */
  time: number;
}

export interface SimStatsSnapshot {
  fps: number;
  frameMs: number;
  maxFrameMs: number;
  drawCalls: number;
  triangles: number;
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
  /** A copy of the current simulation state. */
  getState(): SimSnapshot;
  /** Frame-rate and renderer numbers from the most recent frames. */
  getStats(): SimStatsSnapshot;
}

declare global {
  interface Window {
    __sim?: SimHook;
  }
}

export function installTestHook(hook: SimHook): void {
  window.__sim = hook;
}
