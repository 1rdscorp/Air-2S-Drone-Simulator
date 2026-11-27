import { type Material, Mesh, type Object3D, Texture } from 'three';

/**
 * Frees everything below `root` that takes up memory on the graphics card: geometries,
 * materials, and the textures the materials use. Each is freed once, however many
 * objects share it.
 */
export function disposeTree(root: Object3D): void {
  const done = new Set<{ dispose(): void }>();
  const free = (thing: { dispose(): void } | null | undefined): void => {
    if (thing && !done.has(thing)) {
      done.add(thing);
      thing.dispose();
    }
  };

  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    free(object.geometry as { dispose(): void });
    const materials = (
      Array.isArray(object.material) ? object.material : [object.material]
    ) as Material[];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) {
          free(value);
        }
      }
      free(material);
    }
  });
  root.clear();
}
