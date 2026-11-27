/**
 * What is solid in the world, as plain numbers: where the ground is and what stands on it.
 *
 * The simulation asks this, never the 3D scene, so a flight is the same on every run and
 * can be tested without drawing anything. An environment builds one of these and then
 * draws what it describes.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Where a ray first meets something solid. */
export interface Hit {
  /** Distance from the ray's origin, in metres. */
  distance: number;
  point: Vec3;
  /** Unit vector pointing away from the surface that was hit. */
  normal: Vec3;
}

export interface CollisionWorld {
  /**
   * Height of the highest surface at (x, z), in metres: the ground, or the top of whatever
   * stands there. The aircraft can stand on it. The world is described from above only,
   * so there is nothing to fly under.
   */
  heightAt(x: number, z: number): number;
  /**
   * The first solid thing along a ray, or null when the way is free for `maxDistance`.
   * @param direction unit vector
   */
  raycast(origin: Vec3, direction: Vec3, maxDistance: number): Hit | null;
}

/** Where a flight starts. */
export interface Spawn {
  x: number;
  z: number;
  /** Direction the aircraft faces, in radians: 0 is north, positive turns right. */
  heading: number;
}

/** What the flight model needs from the world. */
export interface FlightWorld {
  heightAt(x: number, z: number): number;
  spawn: Spawn;
}

/** A solid box standing on the ground, with its sides along the x and z axes. */
export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Height of its top above the ground level of the world, in metres. */
  top: number;
}

/** A box from its centre and size, which is how one thinks of an obstacle. */
export function boxAt(x: number, z: number, width: number, depth: number, height: number): Box {
  return {
    minX: x - width / 2,
    maxX: x + width / 2,
    minZ: z - depth / 2,
    maxZ: z + depth / 2,
    top: height,
  };
}

/**
 * Flat ground with boxes on it.
 *
 * `heightAt` treats every box as wider than it is by `margin` on each side. The aircraft
 * is asked about as a single point, so the margin stands for its own half width: it
 * touches a box when its body does, not only when its centre does.
 */
export class BoxWorld implements CollisionWorld {
  constructor(
    readonly boxes: readonly Box[],
    readonly groundHeight = 0,
    readonly margin = 0,
  ) {}

  heightAt(x: number, z: number): number {
    let height = this.groundHeight;
    const m = this.margin;
    for (const box of this.boxes) {
      if (x >= box.minX - m && x <= box.maxX + m && z >= box.minZ - m && z <= box.maxZ + m) {
        height = Math.max(height, this.groundHeight + box.top);
      }
    }
    return height;
  }

  raycast(origin: Vec3, direction: Vec3, maxDistance: number): Hit | null {
    let nearest: Hit | null = null;
    const consider = (distance: number, normal: Vec3): void => {
      if (distance >= 0 && distance <= maxDistance && (!nearest || distance < nearest.distance)) {
        nearest = {
          distance,
          point: {
            x: origin.x + direction.x * distance,
            y: origin.y + direction.y * distance,
            z: origin.z + direction.z * distance,
          },
          normal,
        };
      }
    };

    // The ground, seen from above.
    if (direction.y < 0 && origin.y >= this.groundHeight) {
      consider((this.groundHeight - origin.y) / direction.y, { x: 0, y: 1, z: 0 });
    }

    for (const box of this.boxes) {
      const hit = rayIntoBox(origin, direction, box, this.groundHeight);
      if (hit) {
        consider(hit.distance, hit.normal);
      }
    }
    return nearest;
  }
}

/**
 * Where a ray enters a box, by the usual method: for each axis find where the ray passes
 * the two faces, and the ray is inside the box between the latest entry and the earliest
 * exit. Null when it misses or starts inside.
 */
function rayIntoBox(
  origin: Vec3,
  direction: Vec3,
  box: Box,
  ground: number,
): { distance: number; normal: Vec3 } | null {
  const axes: [number, number, number, number, Vec3][] = [
    [origin.x, direction.x, box.minX, box.maxX, { x: 1, y: 0, z: 0 }],
    [origin.y, direction.y, ground, ground + box.top, { x: 0, y: 1, z: 0 }],
    [origin.z, direction.z, box.minZ, box.maxZ, { x: 0, y: 0, z: 1 }],
  ];
  let enter = -Infinity;
  let exit = Infinity;
  let normal: Vec3 = { x: 0, y: 1, z: 0 };
  for (const [start, step, low, high, axis] of axes) {
    if (step === 0) {
      if (start < low || start > high) {
        return null; // runs alongside the box, outside it
      }
      continue;
    }
    const first = (low - start) / step;
    const second = (high - start) / step;
    const near = Math.min(first, second);
    if (near > enter) {
      enter = near;
      // The face that is entered looks back along the ray.
      const sign = step > 0 ? -1 : 1;
      normal = { x: axis.x * sign, y: axis.y * sign, z: axis.z * sign };
    }
    exit = Math.min(exit, Math.max(first, second));
  }
  return enter <= exit && enter >= 0 ? { distance: enter, normal } : null;
}

/** Nothing but level ground at height 0, with the start at the origin facing north. */
export const FLAT_WORLD: FlightWorld & CollisionWorld = {
  heightAt: () => 0,
  raycast: (origin, direction, maxDistance) =>
    new BoxWorld([]).raycast(origin, direction, maxDistance),
  spawn: { x: 0, z: 0, heading: 0 },
};
