import { expect, type Page, test } from '@playwright/test';

/** Opens the app with the given address settings and waits for the first drawn frame. */
async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-sim-ready', 'true', {
    timeout: 20_000,
  });
}

const state = (page: Page) => page.evaluate(() => window.__sim?.getState());

interface Sticks {
  roll?: number;
  pitch?: number;
  yaw?: number;
  throttle?: number;
}

/** Flies for `seconds` of simulated time with the sticks held where given, then returns the state. */
const fly = (page: Page, seconds: number, sticks: Sticks) =>
  page.evaluate(
    ({ ticks, controls }) => {
      window.__sim?.setControls(controls);
      window.__sim?.step(ticks);
      return window.__sim?.getState();
    },
    { ticks: Math.round(seconds * 120), controls: sticks },
  );

test.describe('flight in Normal mode (simulated time, exact stick values)', () => {
  test('starts in a steady hover 2 m above the ground, facing north', async ({ page }) => {
    await open(page, '?paused=1');

    const atStart = await state(page);
    expect(atStart).toMatchObject({ x: 0, y: 2, z: 0, speed: 0, headingDeg: 0, onGround: false });

    const later = await fly(page, 30, {});
    expect(later).toMatchObject({ x: 0, y: 2, z: 0, speed: 0, vy: 0 });
  });

  test('reaches 15 m/s forward, flying north with the nose down', async ({ page }) => {
    await open(page, '?paused=1');

    const cruising = await fly(page, 20, { pitch: 1 });

    expect(cruising?.speed).toBeCloseTo(15, 1);
    expect(cruising?.z).toBeLessThan(-200);
    expect(cruising?.x).toBeCloseTo(0, 3);
    expect(cruising?.pitch).toBeGreaterThan(0.3);
    expect(cruising?.y).toBeCloseTo(2, 6);
  });

  test('climbs and descends at 6 m/s', async ({ page }) => {
    await open(page, '?paused=1');

    const climbing = await fly(page, 10, { throttle: 1 });
    expect(climbing?.vy).toBeCloseTo(6, 2);
    expect(climbing?.y).toBeGreaterThan(50);

    const descending = await fly(page, 5, { throttle: -1 });
    expect(descending?.vy).toBeCloseTo(-6, 2);
  });

  test('turns at 90 degrees per second', async ({ page }) => {
    await open(page, '?paused=1');

    const turning = await fly(page, 5, { yaw: 1 });

    expect(((turning?.yawRate ?? 0) * 180) / Math.PI).toBeCloseTo(90, 1);
    expect(turning?.speed).toBeCloseTo(0, 6);
  });

  test('brakes and holds its position after the sticks are released', async ({ page }) => {
    await open(page, '?paused=1');
    await fly(page, 15, { pitch: 1 });

    const stopped = await fly(page, 15, {});
    expect(stopped?.speed).toBeLessThan(0.001);
    expect(stopped?.holdActive).toBe(true);

    const oneMinuteLater = await fly(page, 60, {});
    expect(oneMinuteLater?.z).toBeCloseTo(stopped?.z ?? Number.NaN, 3);
    expect(oneMinuteLater?.x).toBeCloseTo(stopped?.x ?? Number.NaN, 3);
  });

  test('stops on the ground and lifts off again', async ({ page }) => {
    await open(page, '?paused=1');

    const landed = await fly(page, 3, { throttle: -1 });
    expect(landed).toMatchObject({ y: 0, vy: 0, onGround: true });

    const airborne = await fly(page, 2, { throttle: 1 });
    expect(airborne?.onGround).toBe(false);
    expect(airborne?.y).toBeGreaterThan(5);
  });

  test('can be put back to the start', async ({ page }) => {
    await open(page, '?paused=1');
    await fly(page, 10, { pitch: 1, yaw: 0.5, throttle: 0.5 });

    const afterReset = await page.evaluate(() => {
      window.__sim?.setControls(null);
      window.__sim?.reset();
      return window.__sim?.getState();
    });

    expect(afterReset).toMatchObject({ x: 0, y: 2, z: 0, speed: 0, headingDeg: 0 });
  });
});

test.describe('flying with the keyboard (real time)', () => {
  test('arrow up flies forward, and letting go stops the aircraft', async ({ page }) => {
    await open(page);

    await page.keyboard.down('ArrowUp');
    await expect
      .poll(async () => (await state(page))?.speed ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(3);
    const moving = await state(page);
    expect(moving?.z).toBeLessThan(0);
    expect(moving?.pitch).toBeGreaterThan(0);

    await page.keyboard.up('ArrowUp');
    await expect
      .poll(async () => (await state(page))?.speed ?? 99, { timeout: 30_000 })
      .toBeLessThan(0.05);
  });

  test('W climbs, D turns right', async ({ page }) => {
    await open(page);

    await page.keyboard.down('KeyW');
    await expect
      .poll(async () => (await state(page))?.y ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(3);
    await page.keyboard.up('KeyW');

    await page.keyboard.down('KeyD');
    await expect
      .poll(async () => (await state(page))?.heading ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(0.3);
    await page.keyboard.up('KeyD');
  });

  test('Backspace puts the aircraft back at the start', async ({ page }) => {
    await open(page);
    await page.keyboard.down('KeyW');
    await expect
      .poll(async () => (await state(page))?.y ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(3);
    await page.keyboard.up('KeyW');

    await page.keyboard.press('Backspace');

    await expect.poll(async () => (await state(page))?.y ?? 0).toBeCloseTo(2, 1);
    expect((await state(page))?.z).toBeCloseTo(0, 1);
  });

  test('the debug overlay shows height, speed and heading', async ({ page }) => {
    await open(page, '?debug=1&paused=1');

    await expect(page.locator('#debug-overlay')).toContainText(
      'Drone        2.0 m · 0.0 m/s · climb +0.0 m/s · 000°',
    );

    await fly(page, 20, { pitch: 1 });
    await expect(page.locator('#debug-overlay')).toContainText('15.0 m/s');
  });
});
