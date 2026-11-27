import { Color, DirectionalLight, Fog, HemisphereLight, Scene, SRGBColorSpace } from 'three';
import type { LightingProfile } from '../world/environment';

/**
 * From the spot where the aircraft's shadow falls to the sun light, in metres. The length
 * sets how high the aircraft can fly and still cast a shadow (here: 500 m).
 */
export const SUN_OFFSET = { x: 300, y: 500, z: 200 } as const;
/** Half the width of the ground area that receives the aircraft's shadow, in metres. */
const SHADOW_HALF_SIZE_M = 6;

/** What every place is drawn into: the scene with its sky colour, haze and lights. */
export interface BaseScene {
  scene: Scene;
  /** The sun. Keep its shadow on the aircraft with `aimSunAt`. */
  sun: DirectionalLight;
  /** Light from the sky above and, weaker, from the ground below. */
  skyLight: HemisphereLight;
}

/**
 * The empty stage: sky colour, haze and the two lights. The ground and everything on it
 * belong to the environment that is loaded into it (see `sim/src/world/`).
 * Units are metres, Y is up, north is -Z.
 */
export function createBaseScene(): BaseScene {
  const scene = new Scene();
  scene.background = new Color();
  scene.fog = new Fog(0xffffff, 300, 1800);

  const skyLight = new HemisphereLight(0xffffff, 0x444444, 1);
  skyLight.name = 'sky-light';
  scene.add(skyLight);

  const sun = new DirectionalLight(0xffffff, 1);
  sun.name = 'sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -SHADOW_HALF_SIZE_M;
  sun.shadow.camera.right = SHADOW_HALF_SIZE_M;
  sun.shadow.camera.top = SHADOW_HALF_SIZE_M;
  sun.shadow.camera.bottom = -SHADOW_HALF_SIZE_M;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = Math.hypot(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z) + 50;
  // Without this the shadow camera keeps its built-in size and range, which do not reach the ground.
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  aimSunAt(sun, 0, 0, 0);

  return { scene, sun, skyLight };
}

/**
 * Gives the stage the light and haze of a place.
 * TODO(step-17): the sky and the time of day decide this.
 */
export function applyLighting(base: BaseScene, lighting: LightingProfile): void {
  const [red, green, blue] = lighting.sky;
  const sky = new Color().setRGB(red / 255, green / 255, blue / 255, SRGBColorSpace);
  (base.scene.background as Color).copy(sky);
  const fog = base.scene.fog as Fog;
  fog.color.copy(sky);
  fog.near = lighting.hazeStart;
  fog.far = lighting.hazeEnd;

  base.sun.color.set(lighting.sunColor);
  base.sun.intensity = lighting.sunStrength;
  base.skyLight.color.set(lighting.skyLightColor);
  base.skyLight.groundColor.set(lighting.groundLightColor);
  base.skyLight.intensity = lighting.skyLightStrength;
}

/**
 * Moves the sun light so that its shadow area stays on the aircraft.
 *
 * The light always shines from the same direction. Its small shadow area is centred on
 * the spot where the aircraft's shadow falls, which is not straight below a high
 * aircraft but further along the sunbeam.
 * TODO(step-17): replace with cascaded shadows that follow the camera.
 *
 * @param x,y,z position of the aircraft
 * @param ground height of the surface below it
 */
export function aimSunAt(sun: DirectionalLight, x: number, y: number, z: number, ground = 0): void {
  const height = Math.max(y - ground, 0);
  const shadowX = x - (height * SUN_OFFSET.x) / SUN_OFFSET.y;
  const shadowZ = z - (height * SUN_OFFSET.z) / SUN_OFFSET.y;
  sun.target.position.set(shadowX, ground, shadowZ);
  sun.position.set(shadowX + SUN_OFFSET.x, ground + SUN_OFFSET.y, shadowZ + SUN_OFFSET.z);
  sun.target.updateMatrixWorld();
}
