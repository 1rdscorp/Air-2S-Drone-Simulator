/**
 * Frame-rate statistics over the most recent display frames.
 * Measures the display only; it has no effect on the simulation.
 */
export class FrameStats {
  private readonly frames: number[] = [];
  private total = 0;

  /** @param windowSeconds how much recent time the averages cover */
  constructor(private readonly windowSeconds = 0.5) {}

  /** Add one display frame that took `frameSeconds`. */
  record(frameSeconds: number): void {
    if (!Number.isFinite(frameSeconds) || frameSeconds <= 0) {
      return;
    }
    this.frames.push(frameSeconds);
    this.total += frameSeconds;
    // Keep at least one frame, so a single very slow frame still shows up.
    while (this.frames.length > 1 && this.total - (this.frames[0] ?? 0) >= this.windowSeconds) {
      this.total -= this.frames.shift() ?? 0;
    }
  }

  /** Display frames per second. */
  get fps(): number {
    return this.total > 0 ? this.frames.length / this.total : 0;
  }

  /** Average time per frame, in milliseconds. */
  get frameMs(): number {
    return this.frames.length > 0 ? (this.total / this.frames.length) * 1000 : 0;
  }

  /** Slowest frame in the window, in milliseconds. */
  get maxFrameMs(): number {
    return this.frames.length > 0 ? Math.max(...this.frames) * 1000 : 0;
  }
}
