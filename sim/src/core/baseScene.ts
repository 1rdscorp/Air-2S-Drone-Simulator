import {
  BoxGeometry,
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

/** Side length of the square ground, in metres. */
export const GROUND_SIZE_M = 400;
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
  /** 1 m reference cube standing on the ground at the origin. */
  marker: Mesh;
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
 * The first scene of the project: sky colour, sun, and a ground with a grid.
 * Units are metres, Y is up, north is -Z.
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
  scene.fog = new Fog(skyColor, 80, GROUND_SIZE_M / 2);

  const skyLight = new HemisphereLight(0xdcecff, 0x4a4436, 1.2);
  skyLight.name = 'sky-light';
  scene.add(skyLight);

  const sun = new DirectionalLight(0xfff2dd, 2.5);
  sun.name = 'sun';
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -20;
  sun.shadow.camera.right = 20;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 150;
  scene.add(sun);

  const ground = new Mesh(
    new PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M),
    new MeshStandardMaterial({ map: createGridTexture(), roughness: 1 }),
  );
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const marker = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 }),
  );
  marker.name = 'marker';
  marker.position.y = 0.5;
  marker.castShadow = true;
  scene.add(marker);

  return { scene, marker };
}
