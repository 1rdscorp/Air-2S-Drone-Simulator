import {
  blendPose,
  copyDroneState,
  createDroneState,
  createFlyingState,
  type DronePose,
  type DroneState,
  type FlightPhase,
} from '../drone/droneState';
import { type FlightEvent, phaseEvents } from '../drone/flightEvents';
import { DEFAULT_FLIGHT_OPTIONS, type FlightOptions, stepDrone } from '../drone/flightModel';
import type { ControlFrame, FlightMode } from '../input/types';
import { FLAT_WORLD, type FlightWorld } from '../world/collision';

/** Everything the simulation knows at one moment. For now that is the aircraft. */
export type SimState = DroneState;

/** Events nobody collects are dropped, oldest first, beyond this many. */
const MAX_PENDING_EVENTS = 64;

/**
 * The simulated world. It only changes inside `step`, by a fixed amount of time and from
 * the controls it is given, so the same sequence of steps and controls always produces
 * the same flight.
 *
 * What happens on the way (take-off, landing, a mode change, ...) is reported as flight
 * events. They are a report for the pilot's display and never influence the flight.
 */
export class Simulation {
  private readonly previous: DroneState = createDroneState();
  private readonly current: DroneState = createDroneState();
  private readonly blended: DronePose = {
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    pitch: 0,
    roll: 0,
    gimbalTilt: 0,
  };
  private readonly options: FlightOptions;
  private flightWorld: FlightWorld = FLAT_WORLD;
  private readonly pending: FlightEvent[] = [];
  /** Flight mode and connection in the previous step; null before the first step. */
  private lastMode: FlightMode | null = null;
  private lastConnected: boolean | null = null;

  constructor(options: Partial<FlightOptions> = {}) {
    this.options = { ...DEFAULT_FLIGHT_OPTIONS, ...options };
  }

  /** Advance by one fixed step of `dt` seconds, flying with the given controls. */
  step(dt: number, controls: ControlFrame): void {
    copyDroneState(this.previous, this.current);
    stepDrone(this.current, controls, dt, this.options, this.flightWorld);
    const backAtStart = this.previous.phase === 'crashed' && this.current.phase !== 'crashed';
    this.report(controls);
    if (backAtStart) {
      // The aircraft was put back at the start: it must not be drawn half-way there.
      copyDroneState(this.previous, this.current);
    }
  }

  /** The world the aircraft flies in: where the ground is, what is solid, where it starts. */
  get world(): FlightWorld {
    return this.flightWorld;
  }

  /** Changes the world and puts the aircraft at its start, motors off. */
  setWorld(world: FlightWorld): void {
    this.flightWorld = world;
    this.reset();
  }

  /**
   * Hands every flight event since the last call to `handler`, oldest first, and forgets
   * them. Call it after each step to know in which step something happened.
   */
  drainEvents(handler: (event: FlightEvent) => void): void {
    if (this.pending.length === 0) {
      return;
    }
    const events = this.pending.splice(0);
    for (const event of events) {
      handler(event);
    }
  }

  /** The current state itself, for reading only. Use `snapshot` for a copy to keep. */
  get state(): Readonly<SimState> {
    return this.current;
  }

  /**
   * Where to draw the aircraft, blended between the previous step (alpha 0) and the
   * current one (alpha 1). Does not change the simulation. The returned object is reused
   * on the next call, so read it and do not keep it.
   */
  interpolate(alpha: number): Readonly<DronePose> {
    return blendPose(this.blended, this.previous, this.current, alpha);
  }

  /** A copy of the current state, safe to keep and compare. */
  snapshot(): SimState {
    return { ...this.current };
  }

  /** What the aircraft is doing right now. */
  get phase(): FlightPhase {
    return this.current.phase;
  }

  /**
   * Puts the aircraft back at the start of the world: on the ground with the motors off.
   * @param height if given, start hovering this many metres above the start instead
   */
  reset(height?: number): void {
    const { spawn } = this.flightWorld;
    const place = {
      x: spawn.x,
      z: spawn.z,
      heading: spawn.heading,
      ground: this.flightWorld.heightAt(spawn.x, spawn.z),
    };
    const start = height === undefined ? createDroneState(place) : createFlyingState(height, place);
    copyDroneState(this.current, start);
    copyDroneState(this.previous, start);
    this.pending.length = 0;
    this.lastMode = null;
    this.lastConnected = null;
  }

  /** Notes what happened in the step that has just run. */
  private report(controls: ControlFrame): void {
    if (this.lastConnected !== null && controls.connected !== this.lastConnected) {
      this.pending.push({ type: controls.connected ? 'controlRestored' : 'controlLost' });
    }
    this.lastConnected = controls.connected;

    if (this.lastMode !== null && controls.mode !== this.lastMode) {
      this.pending.push({ type: 'modeChanged', mode: controls.mode });
    }
    this.lastMode = controls.mode;

    for (const type of phaseEvents(this.previous, this.current)) {
      this.pending.push({ type });
    }
    if (this.pending.length > MAX_PENDING_EVENTS) {
      this.pending.splice(0, this.pending.length - MAX_PENDING_EVENTS);
    }
  }
}
