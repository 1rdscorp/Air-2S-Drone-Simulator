/** Everything the simulation knows at one moment. Plain numbers only, so it can be copied and compared. */
export interface SimState {
  /** Rotation of the reference cube around the vertical axis, in radians. */
  markerYaw: number;
}

/** How fast the reference cube turns, in radians per second. */
export const MARKER_YAW_RATE = 0.5;

function copyState(target: SimState, source: SimState): void {
  target.markerYaw = source.markerYaw;
}

/**
 * The simulated world. It only changes inside `step`, by a fixed amount of time, so the
 * same sequence of steps always produces the same state.
 *
 * For now the world is just the turning reference cube.
 * TODO(step-05): replace the cube with the drone state and flight model.
 */
export class Simulation {
  private readonly previous: SimState = { markerYaw: 0 };
  private readonly current: SimState = { markerYaw: 0 };
  private readonly blended: SimState = { markerYaw: 0 };

  /** Advance by one fixed step of `dt` seconds. */
  step(dt: number): void {
    copyState(this.previous, this.current);
    this.current.markerYaw += MARKER_YAW_RATE * dt;
  }

  /**
   * State to draw, blended between the previous step (alpha 0) and the current one
   * (alpha 1). Does not change the simulation. The returned object is reused on the
   * next call, so read it and do not keep it.
   */
  interpolate(alpha: number): Readonly<SimState> {
    const t = Math.min(Math.max(alpha, 0), 1);
    this.blended.markerYaw =
      this.previous.markerYaw + (this.current.markerYaw - this.previous.markerYaw) * t;
    return this.blended;
  }

  /** A copy of the current state, safe to keep and compare. */
  snapshot(): SimState {
    return { ...this.current };
  }
}
