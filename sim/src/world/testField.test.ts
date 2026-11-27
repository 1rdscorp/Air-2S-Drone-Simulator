import { type BufferGeometry, Group, Mesh, type MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { ENVIRONMENTS, environmentInfo } from './catalogue';
import { ENV_IDS } from './environment';
import {
  AIRCRAFT_MARGIN_M,
  createGridTexture,
  GRID_CELL_M,
  GRID_TEXTURE_PX,
  GROUND_SIZE_M,
  TEST_FIELD_OBSTACLES,
  TestField,
} from './testField';

/** Reads one pixel of a grid texture as [r, g, b, a]. */
function pixelAt(data: Uint8Array, x: number, y: number): number[] {
  const start = (y * GRID_TEXTURE_PX + x) * 4;
  return Array.from(data.subarray(start, start + 4));
}

async function loaded(): Promise<{ field: TestField; root: Group; progress: number[] }> {
  const field = new TestField();
  const root = new Group();
  const progress: number[] = [];
  await field.load({ root, seed: 1, progress: (done) => progress.push(done) });
  return { field, root, progress };
}

const obstacle = (name: string) => {
  const found = TEST_FIELD_OBSTACLES.find((entry) => entry.name === name);
  if (!found) throw new Error(`no obstacle called ${name}`);
  return found;
};

describe('TestField, what is solid', () => {
  const field = new TestField();

  it('is level ground at height 0 where nothing stands', () => {
    expect(field.heightAt(0, 0)).toBe(0);
    expect(field.heightAt(700, -1900)).toBe(0);
  });

  it('starts at the origin facing north, on the ground', () => {
    expect(field.spawn).toEqual({ position: { x: 0, y: 0, z: 0 }, headingDeg: 0 });
    expect(field.heightAt(field.spawn.position.x, field.spawn.position.z)).toBe(0);
  });

  it('has the top of each obstacle as the height above it', () => {
    for (const { name, box } of TEST_FIELD_OBSTACLES) {
      const x = (box.minX + box.maxX) / 2;
      const z = (box.minZ + box.maxZ) / 2;
      expect(field.heightAt(x, z), name).toBe(box.top);
    }
  });

  it('counts an obstacle as wider by the half width of the aircraft', () => {
    const { box } = obstacle('cube');
    const z = (box.minZ + box.maxZ) / 2;

    expect(field.heightAt(box.maxX + AIRCRAFT_MARGIN_M - 0.01, z)).toBe(box.top);
    expect(field.heightAt(box.maxX + AIRCRAFT_MARGIN_M + 0.01, z)).toBe(0);
  });

  it('keeps the four straight lines from the start clear', () => {
    for (let distance = 0; distance <= 500; distance += 0.5) {
      for (const offset of [-5, 0, 5]) {
        expect(field.heightAt(offset, -distance), `north ${distance}`).toBe(0);
        expect(field.heightAt(offset, distance), `south ${distance}`).toBe(0);
        expect(field.heightAt(distance, offset), `east ${distance}`).toBe(0);
        expect(field.heightAt(-distance, offset), `west ${distance}`).toBe(0);
      }
    }
  });

  it('has room to fly between the two gate pillars', () => {
    const left = obstacle('gate-left').box;
    const right = obstacle('gate-right').box;
    const gap = right.minX - left.maxX;
    const middle = (left.maxX + right.minX) / 2;

    expect(gap).toBeGreaterThanOrEqual(5);
    expect(field.heightAt(middle, (left.minZ + left.maxZ) / 2)).toBe(0);
  });

  it('has places to land on at several heights', () => {
    const tops = TEST_FIELD_OBSTACLES.filter((entry) => entry.landingMark).map(
      (entry) => entry.box.top,
    );

    expect(tops.length).toBeGreaterThanOrEqual(3);
    expect(new Set(tops).size).toBe(tops.length);
    for (const { box, landingMark } of TEST_FIELD_OBSTACLES) {
      if (landingMark) {
        expect(Math.min(box.maxX - box.minX, box.maxZ - box.minZ)).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('sees obstacles with a ray at their true size', () => {
    const { box } = obstacle('tower');
    const x = (box.minX + box.maxX) / 2;
    const hit = field.raycast({ x, y: 10, z: 0 }, { x: 0, y: 0, z: -1 }, 500);

    expect(hit?.distance).toBeCloseTo(-box.maxZ, 9);
    expect(field.raycast({ x: 0, y: 50, z: 0 }, { x: 0, y: -1, z: 0 }, 500)?.distance).toBe(50);
  });
});

describe('TestField, what is drawn', () => {
  it('reports its progress and ends at 1', async () => {
    const { progress } = await loaded();

    expect(progress.at(-1)).toBe(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it('draws the ground flat, facing up, with the grid on it', async () => {
    const { root } = await loaded();
    const ground = root.getObjectByName('ground') as Mesh;
    const material = ground.material as MeshStandardMaterial;

    expect(ground.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(ground.position.y).toBe(0);
    expect(ground.receiveShadow).toBe(true);
    expect(material.map?.name).toBe('grid-texture');
    expect(material.map?.repeat.x).toBe(GROUND_SIZE_M / GRID_CELL_M);
  });

  it('has room for a few minutes of flying at full speed', () => {
    // 19 m/s for two minutes from the middle is about 2.3 km.
    expect(GROUND_SIZE_M / 2).toBeGreaterThanOrEqual(2000);
  });

  it('draws every obstacle exactly where it is solid', async () => {
    const { root } = await loaded();

    for (const { name, box } of TEST_FIELD_OBSTACLES) {
      const mesh = root.getObjectByName(`obstacle-${name}`) as Mesh;
      expect(mesh, name).toBeInstanceOf(Mesh);
      expect(mesh.position.x).toBeCloseTo((box.minX + box.maxX) / 2, 9);
      expect(mesh.position.z).toBeCloseTo((box.minZ + box.maxZ) / 2, 9);
      expect(mesh.position.y + mesh.scale.y / 2).toBeCloseTo(box.top, 9);
      expect(mesh.position.y - mesh.scale.y / 2).toBeCloseTo(0, 9);
      expect(mesh.scale.x).toBeCloseTo(box.maxX - box.minX, 9);
      expect(mesh.scale.z).toBeCloseTo(box.maxZ - box.minZ, 9);
      // The aircraft's shadow falls on it; its own shadow waits for Step 17.
      expect(mesh.receiveShadow).toBe(true);
      expect(mesh.castShadow).toBe(false);
    }
  });

  it('paints a landing mark at the start and on everything meant for landing', async () => {
    const { root } = await loaded();
    const marks = root.children.filter((child) => child.name === 'landing-mark');
    const wanted = TEST_FIELD_OBSTACLES.filter((entry) => entry.landingMark);

    expect(marks).toHaveLength(1 + wanted.length);
    expect(marks[0]?.position.toArray()).toEqual([0, 0, 0]);
    for (const { box } of wanted) {
      const onTop = marks.find(
        (mark) =>
          mark.position.y === box.top &&
          Math.abs(mark.position.x - (box.minX + box.maxX) / 2) < 1e-9,
      );
      expect(onTop).toBeDefined();
    }
  });

  it('uses one cube shape for all obstacles', async () => {
    const { root } = await loaded();
    const shapes = new Set(
      TEST_FIELD_OBSTACLES.map(
        ({ name }) => (root.getObjectByName(`obstacle-${name}`) as Mesh).geometry.uuid,
      ),
    );

    expect(shapes.size).toBe(1);
  });

  it('gives everything back when it is disposed of', async () => {
    const { field, root } = await loaded();
    let geometries = 0;
    let materials = 0;
    let textures = 0;
    const seen = new Set<string>();
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const geometry = object.geometry as BufferGeometry;
      const material = object.material as MeshStandardMaterial;
      if (!seen.has(geometry.uuid)) {
        seen.add(geometry.uuid);
        geometry.addEventListener('dispose', () => geometries++);
      }
      if (!seen.has(material.uuid)) {
        seen.add(material.uuid);
        material.addEventListener('dispose', () => materials++);
        material.map?.addEventListener('dispose', () => textures++);
      }
    });
    const made = seen.size;

    field.dispose();

    expect(geometries + materials).toBe(made);
    expect(textures).toBe(1);
    expect(root.children).toHaveLength(0);
    // Disposing twice does no harm.
    expect(() => field.dispose()).not.toThrow();
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

describe('the list of places', () => {
  it('lists every place once, the test field first', () => {
    expect(ENVIRONMENTS.map((entry) => entry.id).sort()).toEqual([...ENV_IDS].sort());
    expect(ENVIRONMENTS[0]?.id).toBe('test');
  });

  it('can build the test field; the others are still to come', () => {
    expect(environmentInfo('test').create?.()).toBeInstanceOf(TestField);
    for (const id of ['mountains', 'ocean', 'beach', 'city'] as const) {
      expect(environmentInfo(id).create, id).toBeNull();
      expect(environmentInfo(id).summary.length).toBeGreaterThan(10);
    }
  });
});
