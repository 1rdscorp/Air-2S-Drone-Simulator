/** Simulation steps per second. The simulation always advances by exactly 1 / SIM_HZ. */
export const SIM_HZ = 120;
/** Length of one simulation step, in seconds. */
export const SIM_DT = 1 / SIM_HZ;

export const MIN_TIME_SCALE = 0.05;
export const MAX_TIME_SCALE = 8;

/**
 * Longest real time a single display frame may add, in seconds. A longer gap (the tab was
 * in the background, the machine stalled) is cut, so the simulation slows down instead of
 * trying to catch up with hundreds of steps at once.
 */
export const MAX_FRAME_SECONDS = 0.25;

export interface GameLoopHandlers {
  /**
   * Advance the simulation by exactly one fixed step.
   * @param dt always SIM_DT
   * @param tick index of the step being computed, starting at 0
   */
  step(dt: number, tick: number): void;
  /**
   * Draw one frame. Must not change simulation state.
   * @param alpha 0..1, how far display time is between the previous and the current
   *   simulation state. 0 draws the previous state, 1 the current one.
   */
  render(alpha: number): void;
}

/**
 * Fixed-step game loop.
 *
 * Display frames arrive at any rate (30, 60, 144 Hz, irregular). The loop collects the
 * elapsed real time and spends it in whole steps of SIM_DT, so the simulation sees the
 * same sequence of steps whatever the display does. What is left over becomes `alpha`,
 * which the renderer uses to blend between the last two states for smooth motion.
 */
export class GameLoop {
  paused = false;

  private scale = 1;
  /** Simulation time that has been collected but not simulated yet, in seconds. */
  private accumulator = 0;
  private alpha = 0;
  private ticks = 0;

  constructor(private readonly handlers: GameLoopHandlers) {}

  /** Number of simulation steps completed so far. */
  get tick(): number {
    return this.ticks;
  }

  /** Simulated time in seconds. Derived from the tick count, so it never drifts. */
  get simTime(): number {
    return this.ticks * SIM_DT;
  }

  /** Simulation speed relative to real time: 1 is real time, 0.5 is half speed. */
  get timeScale(): number {
    return this.scale;
  }

  set timeScale(value: number) {
    if (Number.isFinite(value)) {
      this.scale = Math.min(Math.max(value, MIN_TIME_SCALE), MAX_TIME_SCALE);
    }
  }

  /**
   * Call once per display frame.
   * @param elapsedSeconds real time since the previous display frame
   * @returns number of simulation steps that ran
   */
  frame(elapsedSeconds: number): number {
    let steps = 0;
    if (!this.paused) {
      const elapsed = Number.isFinite(elapsedSeconds)
        ? Math.min(Math.max(elapsedSeconds, 0), MAX_FRAME_SECONDS)
        : 0;
      this.accumulator += elapsed * this.scale;
      while (this.accumulator >= SIM_DT) {
        this.runStep();
        this.accumulator -= SIM_DT;
        steps++;
      }
      this.alpha = this.accumulator / SIM_DT;
    }
    this.handlers.render(this.alpha);
    return steps;
  }

  /**
   * Run exactly `count` steps right now, paused or not, without drawing. Used by tests
   * and by single-stepping. Afterwards the newest state is the one that gets drawn.
   */
  advance(count = 1): void {
    const steps = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    for (let i = 0; i < steps; i++) {
      this.runStep();
    }
    this.accumulator = 0;
    this.alpha = 1;
  }

  private runStep(): void {
    this.handlers.step(SIM_DT, this.ticks);
    this.ticks++;
  }
}
