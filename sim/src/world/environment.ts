import type { Object3D } from 'three';
import type { CollisionWorld, Vec3 } from './collision';

/** The places to fly. `test` is the plain test field. */
export const ENV_IDS = ['test', 'mountains', 'city', 'ocean', 'beach'] as const;
export type EnvId = (typeof ENV_IDS)[number];

/** Light and haze of a place. TODO(step-17): the sky and time of day take this over. */
export interface LightingProfile {
  /** Colour of the sky as [red, green, blue], 0 to 255. The haze fades into it. */
  sky: readonly [number, number, number];
  /** Distance at which the haze starts and where it hides everything, in metres. */
  hazeStart: number;
  hazeEnd: number;
  /** Colour and strength of the sunlight. */
  sunColor: number;
  sunStrength: number;
  /** Light from the sky above and bounced light from the ground below, and their strength. */
  skyLightColor: number;
  groundLightColor: number;
  skyLightStrength: number;
}

/** What an environment is given to build itself with. */
export interface WorldContext {
  /** Everything that is drawn goes in here. The world manager puts it into the scene. */
  root: Object3D;
  /** Seed for everything generated: the same seed gives the same place. */
  seed: number;
  /** Tells the loading screen how far the loading is, 0 to 1. */
  progress(done: number): void;
}

/** What an environment is told every frame. */
export interface FrameState {
  /** Simulated time in seconds. Anything that moves must depend on this, never on real time. */
  simTime: number;
  camera: Vec3;
  aircraft: Vec3;
}

/**
 * A place to fly. It says what is solid (`heightAt`, `raycast`), draws itself into the
 * root it is given, and gives everything back in `dispose`.
 */
export interface Environment extends CollisionWorld {
  readonly id: EnvId;
  /** Name shown to the pilot. */
  readonly name: string;
  /** Builds the place. May take a while; report how far it is with `ctx.progress`. */
  load(ctx: WorldContext): Promise<void>;
  /** Called for every drawn frame, for whatever moves in the place. */
  update(frame: FrameState): void;
  /** Frees every geometry, material and texture the place made. */
  dispose(): void;
  /** Where a flight starts. */
  readonly spawn: { position: Vec3; headingDeg: number };
  readonly lighting: LightingProfile;
}

/** An entry in the list of places: what the pilot is shown before it is built. */
export interface EnvironmentInfo {
  id: EnvId;
  name: string;
  /** One line about the place. */
  summary: string;
  /** Makes the place, or null when it has not been built yet (a later step). */
  create: (() => Environment) | null;
}
