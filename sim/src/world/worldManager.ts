import { Group, type Scene } from 'three';
import type { EnvId, Environment, EnvironmentInfo, FrameState } from './environment';

/**
 * 'empty': nothing has been loaded yet.
 * 'loading': a place is being built; nothing can be flown.
 * 'ready': a place is there.
 * 'failed': the last place could not be built and there is none to fall back on.
 */
export type WorldStatus = 'empty' | 'loading' | 'ready' | 'failed';

export interface WorldEvents {
  /** A place is being built: its name, and how far it is from 0 to 1. */
  onLoading?(name: string, progress: number): void;
  /** The place is ready to fly in. */
  onReady?(environment: Environment): void;
  /** A place could not be built; `message` is fit to show. */
  onFailed?(name: string, message: string): void;
}

/**
 * Keeps the one place that is flown in: builds it, puts it into the scene, and takes the
 * previous one out again down to the last geometry and texture.
 */
export class WorldManager {
  private environment: Environment | null = null;
  private root: Group | null = null;
  private state: WorldStatus = 'empty';
  /** Counts the loads, so that a load that was overtaken by a newer one knows it. */
  private loads = 0;

  constructor(
    private readonly scene: Scene,
    private readonly catalogue: readonly EnvironmentInfo[],
    private readonly events: WorldEvents = {},
  ) {}

  get status(): WorldStatus {
    return this.state;
  }

  get loading(): boolean {
    return this.state === 'loading';
  }

  /** The place being flown in, or null while there is none. */
  get current(): Environment | null {
    return this.environment;
  }

  /** Whether a place is listed and has been built. */
  isAvailable(id: EnvId): boolean {
    return this.catalogue.some((entry) => entry.id === id && entry.create !== null);
  }

  /**
   * Replaces the current place by another. The old one is freed first, so the two are
   * never in memory together.
   * @returns true when the place is ready, false when it could not be built or the load
   *   was overtaken by a later one
   */
  async load(id: EnvId, seed: number): Promise<boolean> {
    const info = this.catalogue.find((entry) => entry.id === id);
    if (!info?.create) {
      this.events.onFailed?.(info?.name ?? id, 'This place has not been built yet.');
      return false;
    }

    const load = ++this.loads;
    this.unload();
    this.state = 'loading';
    this.events.onLoading?.(info.name, 0);

    const environment = info.create();
    const root = new Group();
    root.name = `environment-${id}`;
    try {
      await environment.load({
        root,
        seed,
        progress: (done) => {
          if (load === this.loads) {
            this.events.onLoading?.(info.name, Math.min(Math.max(done, 0), 1));
          }
        },
      });
    } catch (error) {
      environment.dispose();
      if (load === this.loads) {
        this.state = 'failed';
        this.events.onFailed?.(info.name, error instanceof Error ? error.message : String(error));
      }
      return false;
    }

    if (load !== this.loads) {
      // Another place was asked for meanwhile: this one is not wanted any more.
      environment.dispose();
      return false;
    }
    this.environment = environment;
    this.root = root;
    this.scene.add(root);
    this.state = 'ready';
    this.events.onReady?.(environment);
    return true;
  }

  /** Call for every drawn frame. */
  update(frame: FrameState): void {
    this.environment?.update(frame);
  }

  /** Takes the current place out of the scene and frees it. */
  unload(): void {
    if (this.root) {
      this.scene.remove(this.root);
      this.root = null;
    }
    if (this.environment) {
      this.environment.dispose();
      this.environment = null;
    }
    if (this.state === 'ready') {
      this.state = 'empty';
    }
  }
}
