import {
  Color,
  DataTexture,
  DirectionalLight,
  Fog,
  HemisphereLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
} from 'three';

/** Side length of the square ground, in metres. Big enough for a few minutes of flying. */
export const GROUND_SIZE_M = 4000;
/** Distance at which the haze starts and where it hides the ground completely, in metres. */
const HAZE_START_M = 300;
const HAZE_END_M = 1800;
/**
 * From the spot where the aircraft's shadow falls to the sun light, in metres. The length
 * sets how high the aircraft can fly and still cast a shadow (here: 500 m).
 */
export const SUN_OFFSET = { x: 300, y: 500, z: 200 } as const;
/** Half the width of the ground area that receives the aircraft's shadow, in metres. */
const SHADOW_HALF_SIZE_M = 6;
/** Distance between grid lines, in metres. */
export const GRID_CELL_M = 5;
/** Width and height of the texture that draws one grid cell, in pixels. */
export const GRID_TEXTURE_PX = 256;

/** Colours as [red, green, blue], 0-255, sRGB. */
const SKY_RGB = [156, 196, 232] as const;
const GROUND_RGB = [93, 122, 74] as const;
const GRID_LINE_RGB = [44, 62, 34] as const;
/** Line thickness on each side of a cell border, in texture pixels. */
const GRID_LINE_PX = 2;

export interface BaseScene {
  scene: Scene;
  /** The sun. Keep its shadow on the aircraft with `aimSunAt`. */
  sun: DirectionalLight;
}

/**
 * One grid cell as a repeating texture: ground colour with a darker border.
 *
 * The grid is a texture and not line geometry (GridHelper) on purpose: long lines that
 * pass behind the camera are drawn in the wrong place by the software renderer that
 * headless test browsers use.
 */
export function createGridTexture(): DataTexture {
  const size = GRID_TEXTURE_PX;
  const data = new Uint8Array(size * size * 4);
  const isBorder = (i: number): boolean => i < GRID_LINE_PX || i >= size - GRID_LINE_PX;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = isBorder(x) || isBorder(y) ? GRID_LINE_RGB : GROUND_RGB;
      data.set([r, g, b, 255], (y * size + x) * 4);
    }
  }

  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.name = 'grid-texture';
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(GROUND_SIZE_M / GRID_CELL_M, GROUND_SIZE_M / GRID_CELL_M);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8; // keeps the lines sharp at shallow viewing angles
  texture.needsUpdate = true;
  return texture;
}

/**
 * The first scene of the project: sky colour, haze, sun, and a ground with a grid.
 * Units are metres, Y is up, north is -Z.
 * TODO(step-10): becomes the "Test Field" environment.
 */
export function createBaseScene(): BaseScene {
  const skyColor = new Color().setRGB(
    SKY_RGB[0] / 255,
    SKY_RGB[1] / 255,
    SKY_RGB[2] / 255,
    SRGBColorSpace,
  );

  const scene = new Scene();
  scene.background = skyColor;
  scene.fog = new Fog(skyColor, HAZE_START_M, HAZE_END_M);

  const skyLight = new HemisphereLight(0xdcecff, 0x4a4436, 1.2);
  skyLight.name = 'sky-light';
  scene.add(skyLight);

  const sun = new DirectionalLight(0xfff2dd, 2.5);
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

  const ground = new Mesh(
    new PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M),
    new MeshStandardMaterial({ map: createGridTexture(), roughness: 1 }),
  );
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  return { scene, sun };
}

/**
 * Moves the sun light so that its shadow area stays on the aircraft.
 *
 * The light always shines from the same direction. Its small shadow area is centred on
 * the ground spot where the aircraft's shadow falls, which is not straight below a high
 * aircraft but further along the sunbeam.
 * TODO(step-17): replace with cascaded shadows that follow the camera.
 *
 * @param x,y,z position of the aircraft; `y` is its height above the ground
 */
export function aimSunAt(sun: DirectionalLight, x: number, y: number, z: number): void {
  const height = Math.max(y, 0);
  const shadowX = x - (height * SUN_OFFSET.x) / SUN_OFFSET.y;
  const shadowZ = z - (height * SUN_OFFSET.z) / SUN_OFFSET.y;
  sun.target.position.set(shadowX, 0, shadowZ);
  sun.position.set(shadowX + SUN_OFFSET.x, SUN_OFFSET.y, shadowZ + SUN_OFFSET.z);
  sun.target.updateMatrixWorld();
}
