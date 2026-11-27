import { describe, expect, it } from 'vitest';
import { boxAt, BoxWorld, FLAT_WORLD, type Vec3 } from './collision';

const DOWN: Vec3 = { x: 0, y: -1, z: 0 };
const NORTH: Vec3 = { x: 0, y: 0, z: -1 };
const EAST: Vec3 = { x: 1, y: 0, z: 0 };

/** A 4 m cube 20 m north of the origin, and a low platform to the east. */
const cube = boxAt(0, -20, 4, 4, 4);
const platform = boxAt(30, 0, 6, 6, 1.5);
const world = new BoxWorld([cube, platform]);

describe('boxAt', () => {
  it('makes a box from its centre and size', () => {
    expect(boxAt(10, -5, 4, 2, 3)).toEqual({ minX: 8, maxX: 12, minZ: -6, maxZ: -4, top: 3 });
  });
});

describe('BoxWorld.heightAt', () => {
  it('is the ground where nothing stands', () => {
    expect(world.heightAt(0, 0)).toBe(0);
    expect(world.heightAt(-500, 700)).toBe(0);
  });

  it('is the top of a box over the whole of it, edges included', () => {
    expect(world.heightAt(0, -20)).toBe(4);
    expect(world.heightAt(2, -22)).toBe(4);
    expect(world.heightAt(30, 3)).toBe(1.5);
    expect(world.heightAt(2.01, -20)).toBe(0);
  });

  it('is the higher top where boxes overlap', () => {
    const stacked = new BoxWorld([boxAt(0, 0, 10, 10, 2), boxAt(0, 0, 2, 2, 9)]);

    expect(stacked.heightAt(0, 0)).toBe(9);
    expect(stacked.heightAt(4, 4)).toBe(2);
  });

  it('measures from the ground level of the world', () => {
    const high = new BoxWorld([cube], 100);

    expect(high.heightAt(50, 50)).toBe(100);
    expect(high.heightAt(0, -20)).toBe(104);
  });

  it('treats boxes as wider by the margin, for the width of the aircraft itself', () => {
    const wide = new BoxWorld([cube], 0, 0.25);

    expect(wide.heightAt(2.2, -20)).toBe(4);
    expect(wide.heightAt(-2.2, -22.2)).toBe(4);
    expect(wide.heightAt(2.3, -20)).toBe(0);
  });
});

describe('BoxWorld.raycast', () => {
  it('finds the ground below', () => {
    const hit = world.raycast({ x: 5, y: 12, z: 5 }, DOWN, 100);

    expect(hit?.distance).toBe(12);
    expect(hit?.point).toEqual({ x: 5, y: 0, z: 5 });
    expect(hit?.normal).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('finds the side of a box ahead, with the face looking back at the ray', () => {
    const hit = world.raycast({ x: 0, y: 2, z: 0 }, NORTH, 100);

    expect(hit?.distance).toBe(18);
    expect(hit?.point).toEqual({ x: 0, y: 2, z: -18 });
    expect(hit?.normal).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('finds the top of a box from above', () => {
    const hit = world.raycast({ x: 30, y: 10, z: 0 }, DOWN, 100);

    expect(hit?.distance).toBe(8.5);
    expect(hit?.normal).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('passes over a box that is lower than the ray', () => {
    expect(world.raycast({ x: 0, y: 5, z: 0 }, NORTH, 100)).toBeNull();
    expect(world.raycast({ x: 0, y: 1, z: 0 }, EAST, 100)?.distance).toBe(27);
  });

  it('gives the nearest of several things in the way', () => {
    const row = new BoxWorld([boxAt(0, -50, 4, 4, 4), boxAt(0, -20, 4, 4, 4)]);

    expect(row.raycast({ x: 0, y: 1, z: 0 }, NORTH, 100)?.distance).toBe(18);
  });

  it('finds nothing beyond the distance asked for, or looking away', () => {
    expect(world.raycast({ x: 0, y: 2, z: 0 }, NORTH, 17.9)).toBeNull();
    expect(world.raycast({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 1 }, 1000)).toBeNull();
    expect(world.raycast({ x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: 0 }, 1000)).toBeNull();
  });

  it('works at an angle', () => {
    const slanted = { x: 0, y: -Math.SQRT1_2, z: -Math.SQRT1_2 };
    const hit = world.raycast({ x: 0, y: 10, z: 0 }, slanted, 100);

    // Coming down at 45 degrees it reaches the ground 10 m north, before the cube.
    expect(hit?.point.z).toBeCloseTo(-10, 9);
    expect(hit?.point.y).toBeCloseTo(0, 9);
  });

  it('does not report a box the ray starts inside', () => {
    expect(world.raycast({ x: 0, y: 2, z: -20 }, NORTH, 1)).toBeNull();
  });
});

describe('FLAT_WORLD', () => {
  it('is level ground with the start at the origin, facing north', () => {
    expect(FLAT_WORLD.heightAt(123, -456)).toBe(0);
    expect(FLAT_WORLD.spawn).toEqual({ x: 0, z: 0, heading: 0 });
    expect(FLAT_WORLD.raycast({ x: 0, y: 3, z: 0 }, DOWN, 10)?.distance).toBe(3);
  });
});
