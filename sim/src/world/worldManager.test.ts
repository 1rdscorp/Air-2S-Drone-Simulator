import { BoxGeometry, Mesh, MeshBasicMaterial, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import type { Hit } from './collision';
import { disposeTree } from './dispose';
import type { Environment, EnvironmentInfo, WorldContext } from './environment';
import { WorldManager } from './worldManager';

const LIGHTING = {
  sky: [0, 0, 0] as const,
  hazeStart: 1,
  hazeEnd: 2,
  sunColor: 0,
  sunStrength: 1,
  skyLightColor: 0,
  groundLightColor: 0,
  skyLightStrength: 1,
};

/** A made-up place: a few boxes, a load that the test finishes or fails by hand. */
class FakePlace implements Environment {
  readonly name: string;
  readonly spawn = { position: { x: 0, y: 0, z: 0 }, headingDeg: 0 };
  readonly lighting = LIGHTING;
  disposed = 0;
  updates = 0;
  context: WorldContext | null = null;
  private finish: (() => void) | null = null;
  private fail: ((error: Error) => void) | null = null;

  constructor(
    readonly id: Environment['id'],
    private readonly manual = false,
  ) {
    this.name = `Fake ${id}`;
  }

  load(ctx: WorldContext): Promise<void> {
    this.context = ctx;
    for (let i = 0; i < 3; i++) {
      ctx.root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
    }
    if (!this.manual) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.finish = resolve;
      this.fail = reject;
    });
  }

  done(): void {
    this.finish?.();
  }

  breakDown(message: string): void {
    this.fail?.(new Error(message));
  }

  update(): void {
    this.updates++;
  }

  dispose(): void {
    this.disposed++;
    if (this.context) {
      disposeTree(this.context.root);
    }
  }

  heightAt(): number {
    return 0;
  }

  raycast(): Hit | null {
    return null;
  }
}

interface Bench {
  scene: Scene;
  manager: WorldManager;
  made: FakePlace[];
  log: string[];
}

function bench(manual: ('test' | 'city')[] = []): Bench {
  const scene = new Scene();
  const made: FakePlace[] = [];
  const log: string[] = [];
  const make = (id: 'test' | 'city') => (): Environment => {
    const place = new FakePlace(id, manual.includes(id));
    made.push(place);
    return place;
  };
  const catalogue: EnvironmentInfo[] = [
    { id: 'test', name: 'Test Field', summary: '', create: make('test') },
    { id: 'city', name: 'City', summary: '', create: make('city') },
    { id: 'ocean', name: 'Ocean', summary: '', create: null },
  ];
  const manager = new WorldManager(scene, catalogue, {
    onLoading: (name, progress) => log.push(`loading ${name} ${progress}`),
    onReady: (environment) => log.push(`ready ${environment.id}`),
    onFailed: (name, message) => log.push(`failed ${name}: ${message}`),
  });
  return { scene, manager, made, log };
}

const FRAME = { simTime: 0, camera: { x: 0, y: 0, z: 0 }, aircraft: { x: 0, y: 0, z: 0 } };

describe('WorldManager', () => {
  it('starts with no place at all', () => {
    const { manager, scene } = bench();

    expect(manager.status).toBe('empty');
    expect(manager.current).toBeNull();
    expect(scene.children).toHaveLength(0);
  });

  it('builds a place, puts it into the scene and says when it is ready', async () => {
    const { manager, scene, log } = bench();

    expect(await manager.load('test', 7)).toBe(true);

    expect(manager.status).toBe('ready');
    expect(manager.current?.id).toBe('test');
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]?.name).toBe('environment-test');
    expect(scene.children[0]?.children).toHaveLength(3);
    expect(log).toEqual(['loading Test Field 0', 'ready test']);
  });

  it('hands the seed to the place', async () => {
    const { manager, made } = bench();
    await manager.load('test', 4711);

    expect(made[0]?.context?.seed).toBe(4711);
  });

  it('is loading, with nothing in the scene, until the place is built', async () => {
    const { manager, scene, made, log } = bench(['city']);
    const loading = manager.load('city', 1);

    expect(manager.loading).toBe(true);
    expect(manager.current).toBeNull();
    expect(scene.children).toHaveLength(0);

    made[0]?.context?.progress(0.5);
    made[0]?.context?.progress(7); // nonsense is limited to 1
    made[0]?.done();
    expect(await loading).toBe(true);

    expect(manager.status).toBe('ready');
    expect(log).toEqual(['loading City 0', 'loading City 0.5', 'loading City 1', 'ready city']);
  });

  it('frees the old place before the new one is built', async () => {
    const { manager, scene, made } = bench();
    await manager.load('test', 1);
    await manager.load('city', 1);

    expect(made[0]?.disposed).toBe(1);
    expect(made[1]?.disposed).toBe(0);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]?.name).toBe('environment-city');
  });

  it('leaves exactly one place in the scene however often it is switched', async () => {
    const { manager, scene, made } = bench();

    for (let i = 0; i < 10; i++) {
      await manager.load(i % 2 === 0 ? 'city' : 'test', 1);
      expect(scene.children).toHaveLength(1);
    }

    expect(made).toHaveLength(10);
    expect(made.filter((place) => place.disposed === 1)).toHaveLength(9);
    expect(made.at(-1)?.disposed).toBe(0);
  });

  it('reloads the same place from scratch', async () => {
    const { manager, made } = bench();
    await manager.load('test', 1);
    await manager.load('test', 1);

    expect(made).toHaveLength(2);
    expect(made[0]?.disposed).toBe(1);
    expect(manager.current).toBe(made[1]);
  });

  it('drops a load that was overtaken by a later one', async () => {
    const { manager, scene, made, log } = bench(['city']);
    const slow = manager.load('city', 1);
    const quick = manager.load('test', 1);

    expect(await quick).toBe(true);
    made[0]?.done(); // the city finishes late
    expect(await slow).toBe(false);

    expect(manager.current?.id).toBe('test');
    expect(made[0]?.disposed).toBe(1);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]?.name).toBe('environment-test');
    expect(log.filter((line) => line.startsWith('ready'))).toEqual(['ready test']);
  });

  it('refuses a place that has not been built yet, and keeps the current one', async () => {
    const { manager, log } = bench();
    await manager.load('test', 1);

    expect(await manager.load('ocean', 1)).toBe(false);

    expect(manager.current?.id).toBe('test');
    expect(manager.status).toBe('ready');
    expect(log.at(-1)).toBe('failed Ocean: This place has not been built yet.');
    expect(manager.isAvailable('ocean')).toBe(false);
    expect(manager.isAvailable('test')).toBe(true);
  });

  it('says so when a place cannot be built, and frees what it had made', async () => {
    const { manager, scene, made, log } = bench(['city']);
    const loading = manager.load('city', 1);
    made[0]?.breakDown('out of memory');

    expect(await loading).toBe(false);
    expect(manager.status).toBe('failed');
    expect(manager.current).toBeNull();
    expect(made[0]?.disposed).toBe(1);
    expect(scene.children).toHaveLength(0);
    expect(log.at(-1)).toBe('failed City: out of memory');
  });

  it('passes every frame on to the place', async () => {
    const { manager, made } = bench();
    manager.update(FRAME); // no place yet: nothing happens
    await manager.load('test', 1);
    manager.update(FRAME);
    manager.update(FRAME);

    expect(made[0]?.updates).toBe(2);
  });

  it('can be emptied', async () => {
    const { manager, scene, made } = bench();
    await manager.load('test', 1);
    manager.unload();

    expect(manager.status).toBe('empty');
    expect(manager.current).toBeNull();
    expect(scene.children).toHaveLength(0);
    expect(made[0]?.disposed).toBe(1);
  });
});

describe('disposeTree', () => {
  it('frees a shared geometry and material once, and empties the tree', () => {
    const scene = new Scene();
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshBasicMaterial();
    let freed = 0;
    geometry.addEventListener('dispose', () => freed++);
    material.addEventListener('dispose', () => freed++);
    scene.add(new Mesh(geometry, material), new Mesh(geometry, material));

    disposeTree(scene);

    expect(freed).toBe(2);
    expect(scene.children).toHaveLength(0);
  });
});
