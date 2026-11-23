import {
  blendPose,
  copyDroneState,
  createDroneState,
  createFlyingState,
  type DronePose,
  type DroneState,
  type FlightPhase,
} from '../drone/droneState';
import { stepDrone } from '../drone/flightModel';
import type { ControlFrame } from '../input/types';

/** Everything the simulation knows at one moment. For now that is the aircraft. */
export type SimState = DroneState;

/**
 * The simulated world. It only changes inside `step`, by a fixed amount of time and from
 * the controls it is given, so the same sequence of steps and controls always produces
 * the same flight.
 */
export class Simulation {
  private readonly previous: DroneState = createDroneState();
  private readonly current: DroneState = createDroneState();
  private readonly blended: DronePose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };

  /** Advance by one fixed step of `dt` seconds, flying with the given controls. */
  step(dt: number, controls: ControlFrame): void {
    copyDroneState(this.previous, this.current);
    stepDrone(this.current, controls, dt);
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
   * Puts the aircraft back at the start: on the ground with the motors off.
   * @param height if given, start hovering at this height in metres instead
   */
  reset(height?: number): void {
    const start = height === undefined ? createDroneState() : createFlyingState(height);
    copyDroneState(this.current, start);
    copyDroneState(this.previous, start);
  }
}
