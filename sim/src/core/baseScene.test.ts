import { DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  aimSunAt,
  createBaseScene,
  createGridTexture,
  GRID_CELL_M,
  GRID_TEXTURE_PX,
  GROUND_SIZE_M,
  SUN_OFFSET,
} from './baseScene';

/** Reads one pixel of a grid texture as [r, g, b, a]. */
function pixelAt(data: Uint8Array, x: number, y: number): number[] {
  const start = (y * GRID_TEXTURE_PX + x) * 4;
  return Array.from(data.subarray(start, start + 4));
}

describe('createBaseScene', () => {
  it('contains a sun, a sky light and a ground', () => {
    const { scene, sun } = createBaseScene();

    expect(scene.getObjectByName('sun')).toBe(sun);
    expect(sun).toBeInstanceOf(DirectionalLight);
    expect(scene.getObjectByName('sky-light')).toBeInstanceOf(HemisphereLight);
    expect(scene.getObjectByName('ground')).toBeInstanceOf(Mesh);
  });

  it('lays the ground flat, facing up, at height 0', () => {
    const { scene } = createBaseScene();
    const ground = scene.getObjectByName('ground');

    expect(ground?.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(ground?.position.y).toBe(0);
  });

  it('has room for a few minutes of flying at full speed', () => {
    // 19 m/s for two minutes from the middle is about 2.3 km.
    expect(GROUND_SIZE_M / 2).toBeGreaterThanOrEqual(2000);
  });

  it('draws the grid on the ground, one texture repeat per cell', () => {
    const { scene } = createBaseScene();
    const ground = scene.getObjectByName('ground') as Mesh;
    const material = ground.material as MeshStandardMaterial;

    expect(material.map?.name).toBe('grid-texture');
    expect(material.map?.repeat.x).toBe(GROUND_SIZE_M / GRID_CELL_M);
    expect(material.map?.repeat.y).toBe(GROUND_SIZE_M / GRID_CELL_M);
  });

  it('sets up the shadow area so that it really reaches from the light to the ground', () => {
    const { sun } = createBaseScene();
    const lightToGround = sun.position.distanceTo(sun.target.position);

    // The projection matrix must be the one for the configured range, not the built-in default.
    const expected = sun.shadow.camera.clone();
    expected.updateProjectionMatrix();
    expect(sun.shadow.camera.projectionMatrix.equals(expected.projectionMatrix)).toBe(true);
    expect(sun.shadow.camera.far).toBeGreaterThan(lightToGround);
  });

  it('lets the sun cast shadows onto the ground', () => {
    const { scene, sun } = createBaseScene();

    expect(sun.castShadow).toBe(true);
    expect(scene.getObjectByName('ground')?.receiveShadow).toBe(true);
    expect(sun.target.parent).toBe(scene);
  });
});

describe('aimSunAt', () => {
  const direction = (sun: DirectionalLight): Vector3 =>
    sun.target.position.clone().sub(sun.position).normalize();

  it('always shines from the same direction', () => {
    const { sun } = createBaseScene();
    const atStart = direction(sun);

    aimSunAt(sun, 800, 120, -300);

    expect(direction(sun).distanceTo(atStart)).toBeLessThan(1e-9);
  });

  it('aims straight below an aircraft that stands on the ground', () => {
    const { sun } = createBaseScene();
    aimSunAt(sun, 50, 0, -20);

    expect(sun.target.position.toArray()).toEqual([50, 0, -20]);
    expect(sun.position.toArray()).toEqual([50 + SUN_OFFSET.x, SUN_OFFSET.y, -20 + SUN_OFFSET.z]);
  });

  it('keeps a high aircraft exactly on the line between the light and its shadow spot', () => {
    const { sun } = createBaseScene();
    const aircraft = new Vector3(100, 150, 40);
    aimSunAt(sun, aircraft.x, aircraft.y, aircraft.z);

    const toAircraft = aircraft.clone().sub(sun.position).normalize();
    expect(toAircraft.distanceTo(direction(sun))).toBeLessThan(1e-9);
    expect(sun.target.position.y).toBe(0);
  });

  it('keeps the aircraft between the light and the ground up to 500 m', () => {
    const { sun } = createBaseScene();
    aimSunAt(sun, 0, 499, 0);

    expect(sun.position.y).toBeGreaterThan(499);
    const distance = sun.position.distanceTo(new Vector3(0, 499, 0));
    expect(distance).toBeGreaterThan(sun.shadow.camera.near);
    expect(sun.position.distanceTo(sun.target.position)).toBeLessThan(sun.shadow.camera.far);
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
