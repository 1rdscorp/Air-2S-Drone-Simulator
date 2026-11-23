import { DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createBaseScene,
  createGridTexture,
  GRID_CELL_M,
  GRID_TEXTURE_PX,
  GROUND_SIZE_M,
} from './baseScene';

/** Reads one pixel of a grid texture as [r, g, b, a]. */
function pixelAt(data: Uint8Array, x: number, y: number): number[] {
  const start = (y * GRID_TEXTURE_PX + x) * 4;
  return Array.from(data.subarray(start, start + 4));
}

describe('createBaseScene', () => {
  it('contains a sun, a sky light, a ground and a marker', () => {
    const { scene } = createBaseScene();

    expect(scene.getObjectByName('sun')).toBeInstanceOf(DirectionalLight);
    expect(scene.getObjectByName('sky-light')).toBeInstanceOf(HemisphereLight);
    expect(scene.getObjectByName('ground')).toBeInstanceOf(Mesh);
    expect(scene.getObjectByName('marker')).toBeInstanceOf(Mesh);
  });

  it('lays the ground flat, facing up', () => {
    const { scene } = createBaseScene();
    const ground = scene.getObjectByName('ground');

    expect(ground?.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(ground?.position.y).toBe(0);
  });

  it('draws the grid on the ground, one texture repeat per cell', () => {
    const { scene } = createBaseScene();
    const ground = scene.getObjectByName('ground') as Mesh;
    const material = ground.material as MeshStandardMaterial;

    expect(material.map?.name).toBe('grid-texture');
    expect(material.map?.repeat.x).toBe(GROUND_SIZE_M / GRID_CELL_M);
    expect(material.map?.repeat.y).toBe(GROUND_SIZE_M / GRID_CELL_M);
  });

  it('casts the marker shadow onto the ground', () => {
    const { scene, marker } = createBaseScene();

    expect(scene.getObjectByName('sun')?.castShadow).toBe(true);
    expect(marker.castShadow).toBe(true);
    expect(scene.getObjectByName('ground')?.receiveShadow).toBe(true);
  });

  it('stands the 1 m marker on the ground', () => {
    const { marker } = createBaseScene();

    expect(marker.position.y).toBeCloseTo(0.5);
  });
});

describe('createGridTexture', () => {
  it('uses a whole number of grid cells', () => {
    expect(Number.isInteger(GROUND_SIZE_M / GRID_CELL_M)).toBe(true);
  });

  it('has a darker line on every border and plain ground in the middle', () => {
    const data = createGridTexture().image.data as Uint8Array;
    const last = GRID_TEXTURE_PX - 1;
    const middle = GRID_TEXTURE_PX / 2;

    const groundPixel = pixelAt(data, middle, middle);
    const borderPixels = [
      pixelAt(data, 0, middle),
      pixelAt(data, last, middle),
      pixelAt(data, middle, 0),
      pixelAt(data, middle, last),
    ];

    const brightness = (pixel: number[]): number =>
      (pixel[0] ?? 0) + (pixel[1] ?? 0) + (pixel[2] ?? 0);
    for (const border of borderPixels) {
      expect(brightness(border)).toBeLessThan(brightness(groundPixel));
      expect(border[3]).toBe(255);
    }
  });
});
