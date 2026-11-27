import {
  BoxGeometry,
  CircleGeometry,
  Color,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  RingGeometry,
  SRGBColorSpace,
} from 'three';
import { type Box, boxAt, BoxWorld, type Hit, type Vec3 } from './collision';
import { disposeTree } from './dispose';
import type { Environment, LightingProfile, WorldContext } from './environment';

/** Side length of the square ground, in metres. Big enough for a few minutes of flying. */
export const GROUND_SIZE_M = 4000;
/**
 * The ground is cut into this many squares along each side: squares of 200 m. Twenty is
 * enough for the paint on the ground to be drawn right (see `load`); more only costs time.
 */
const GROUND_SEGMENTS = 20;
/** Distance between grid lines, in metres. */
export const GRID_CELL_M = 5;
/** Width and height of the texture that draws one grid cell, in pixels. */
export const GRID_TEXTURE_PX = 256;

/** Colours as [red, green, blue], 0-255, sRGB. */
const GROUND_RGB = [93, 122, 74] as const;
const GRID_LINE_RGB = [44, 62, 34] as const;
/** Line thickness on each side of a cell border, in texture pixels. */
const GRID_LINE_PX = 2;

/**
 * Half the width of the aircraft, in metres. Obstacles count as this much wider, so the
 * aircraft touches them when its body does and not only when its centre does.
 */
export const AIRCRAFT_MARGIN_M = 0.25;

/** Something that stands on the test field. */
export interface Obstacle {
  name: string;
  box: Box;
  /** Colour as a hex number. */
  color: number;
  /** A landing mark on top: the place is meant to be landed on. */
  landingMark?: boolean;
}

/**
 * What stands on the test field. The start is at the origin, facing north.
 *
 * The four straight lines from the start (north, east, south, west) are kept clear for
 * six metres to either side, so flying straight ahead after take-off never hits anything.
 * North is -z, east is +x.
 */
export const TEST_FIELD_OBSTACLES: readonly Obstacle[] = [
  // A cube to fly round and over.
  { name: 'cube', box: boxAt(14, -26, 4, 4, 4), color: 0xc8553d },
  // A low platform to land on.
  { name: 'platform', box: boxAt(18, -9, 6, 6, 1.5), color: 0x7d8597, landingMark: true },
  // A long wall.
  { name: 'wall', box: boxAt(30, -46, 16, 1, 6), color: 0xb08968 },
  // A tall tower: 30 m, for climbing and for judging height.
  { name: 'tower', box: boxAt(-28, -40, 3, 3, 30), color: 0x577590 },
  // Two pillars six metres apart, to fly between.
  { name: 'gate-left', box: boxAt(-17, -22, 1, 1, 8), color: 0xf2c14e },
  { name: 'gate-right', box: boxAt(-10, -22, 1, 1, 8), color: 0xf2c14e },
  // Three steps of rising height, each one to land on.
  { name: 'step-1', box: boxAt(-20, 14, 5, 5, 1), color: 0x6a994e, landingMark: true },
  { name: 'step-2', box: boxAt(-26, 14, 5, 5, 2.5), color: 0x588157, landingMark: true },
  { name: 'step-3', box: boxAt(-32, 14, 5, 5, 4), color: 0x3a5a40, landingMark: true },
  // A row of poles to weave through.
  { name: 'pole-1', box: boxAt(-24, 34, 0.6, 0.6, 6), color: 0xe76f51 },
  { name: 'pole-2', box: boxAt(-14, 34, 0.6, 0.6, 6), color: 0xe76f51 },
  { name: 'pole-3', box: boxAt(14, 34, 0.6, 0.6, 6), color: 0xe76f51 },
  { name: 'pole-4', box: boxAt(24, 34, 0.6, 0.6, 6), color: 0xe76f51 },
];

const LIGHTING: LightingProfile = {
  sky: [156, 196, 232],
  hazeStart: 300,
  hazeEnd: 1800,
  sunColor: 0xfff2dd,
  sunStrength: 2.5,
  skyLightColor: 0xdcecff,
  groundLightColor: 0x4a4436,
  skyLightStrength: 1.2,
};

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
 * A landing mark: a dark disc with a yellow ring and an H, lying flat. It is painted on,
 * not solid: the aircraft stands on whatever is underneath.
 * @param y height of the surface it lies on
 */
function landingMark(x: number, y: number, z: number, radius: number): Group {
  const mark = new Group();
  mark.name = 'landing-mark';
  // Paint lies on a surface without being part of it. Drawn at exactly the same depth the
  // two would flicker through each other, so each layer of paint is lifted by a few
  // millimetres and pulled towards the viewer a little more than the one below (polygon
  // offset). Both are kept small: anything larger would also cover the feet of an
  // aircraft standing on the mark.
  const paint = (color: number, layer: number): MeshStandardMaterial =>
    new MeshStandardMaterial({
      color,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -layer,
      polygonOffsetUnits: -2 * layer,
    });
  const dark = paint(0x2b2f36, 1);
  const yellow = paint(0xffd166, 2);
  const lift = 0.003;

  const disc = new Mesh(new CircleGeometry(radius, 48), dark);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = lift;
  disc.receiveShadow = true;

  const ring = new Mesh(new RingGeometry(radius * 0.82, radius * 0.94, 48), yellow);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = lift * 2;
  ring.receiveShadow = true;

  // The H: two uprights and a crossbar, as flat slabs.
  const bar = new BoxGeometry(1, 1, 1);
  const stroke = radius * 0.14;
  const half = radius * 0.42;
  const parts: [number, number, number, number][] = [
    [-half * 0.75, 0, stroke, half * 2],
    [half * 0.75, 0, stroke, half * 2],
    [0, 0, half * 1.5, stroke],
  ];
  for (const [px, pz, width, depth] of parts) {
    const slab = new Mesh(bar, yellow);
    slab.scale.set(width, lift, depth);
    slab.position.set(px, lift * 2.5, pz);
    slab.receiveShadow = true;
    mark.add(slab);
  }

  mark.add(disc, ring);
  mark.position.set(x, y, z);
  return mark;
}

/**
 * The test field: flat ground with a grid, a landing pad at the start, and a handful of
 * obstacles to fly round, between and onto. Nothing here is generated from the seed.
 */
export class TestField implements Environment {
  readonly id = 'test';
  readonly name = 'Test Field';
  readonly spawn = { position: { x: 0, y: 0, z: 0 }, headingDeg: 0 };
  readonly lighting = LIGHTING;

  private readonly solid = new BoxWorld(
    TEST_FIELD_OBSTACLES.map((obstacle) => obstacle.box),
    0,
    AIRCRAFT_MARGIN_M,
  );
  /** For rays the boxes are their true size: a ray is a line, not an aircraft. */
  private readonly exact = new BoxWorld(TEST_FIELD_OBSTACLES.map((obstacle) => obstacle.box));
  private root: WorldContext['root'] | null = null;

  load(ctx: WorldContext): Promise<void> {
    this.root = ctx.root;

    // Cut into many squares rather than one huge one: across a triangle kilometres long
    // the depth of each pixel is worked out too coarsely, and paint lying on the ground
    // (the landing mark) disappears into it.
    const ground = new Mesh(
      new PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M, GROUND_SEGMENTS, GROUND_SEGMENTS),
      new MeshStandardMaterial({ map: createGridTexture(), roughness: 1 }),
    );
    ground.name = 'ground';
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ctx.root.add(ground);
    ctx.progress(0.4);

    ctx.root.add(landingMark(0, 0, 0, 1.5));

    // One cube shape for every obstacle, stretched to size.
    const cube = new BoxGeometry(1, 1, 1);
    for (const obstacle of TEST_FIELD_OBSTACLES) {
      const { box } = obstacle;
      const mesh = new Mesh(
        cube,
        new MeshStandardMaterial({ color: new Color(obstacle.color), roughness: 0.85 }),
      );
      mesh.name = `obstacle-${obstacle.name}`;
      mesh.scale.set(box.maxX - box.minX, box.top, box.maxZ - box.minZ);
      mesh.position.set((box.minX + box.maxX) / 2, box.top / 2, (box.minZ + box.maxZ) / 2);
      // An obstacle takes the aircraft's shadow but casts none itself: the sun's shadow area
      // is a few metres wide and follows the aircraft, so all an obstacle could cast is a
      // cut-off piece of shadow that travels along with the aircraft.
      // TODO(step-17): cast shadows once they cover the whole view.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      ctx.root.add(mesh);

      if (obstacle.landingMark) {
        const width = Math.min(box.maxX - box.minX, box.maxZ - box.minZ);
        ctx.root.add(
          landingMark((box.minX + box.maxX) / 2, box.top, (box.minZ + box.maxZ) / 2, width * 0.36),
        );
      }
    }
    ctx.progress(1);
    return Promise.resolve();
  }

  update(): void {
    // Nothing moves on the test field.
  }

  dispose(): void {
    if (this.root) {
      disposeTree(this.root);
      this.root = null;
    }
  }

  heightAt(x: number, z: number): number {
    return this.solid.heightAt(x, z);
  }

  raycast(origin: Vec3, direction: Vec3, maxDistance: number): Hit | null {
    return this.exact.raycast(origin, direction, maxDistance);
  }
}
