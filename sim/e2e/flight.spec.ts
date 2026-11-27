import { expect, type Page, test } from '@playwright/test';

/** Opens the app with the given address settings and waits for the first drawn frame. */
async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-sim-ready', 'true', {
    timeout: 20_000,
  });
}

const state = (page: Page) => page.evaluate(() => window.__sim?.getState());
const phase = (page: Page) => page.evaluate(() => window.__sim?.getState().phase);

interface Controls {
  roll?: number;
  pitch?: number;
  yaw?: number;
  throttle?: number;
  mode?: 'C' | 'N' | 'S';
  buttons?: { takeoffLand?: boolean; pause?: boolean };
}

/** Flies for `seconds` of simulated time with the controls held as given, then returns the state. */
const fly = (page: Page, seconds: number, controls: Controls) =>
  page.evaluate(
    ({ ticks, script }) => {
      window.__sim?.setControls(script);
      window.__sim?.step(ticks);
      return window.__sim?.getState();
    },
    { ticks: Math.round(seconds * 120), script: controls },
  );

/** Opens the app paused, with the aircraft already hovering at `height` metres. */
async function openHovering(page: Page, height: number, query = '?paused=1'): Promise<void> {
  await open(page, query);
  await page.evaluate((h) => window.__sim?.reset({ height: h }), height);
}

const STICK_COMMAND = { throttle: -1, yaw: 1, pitch: -1, roll: -1 };

test.describe('take-off and landing (simulated time)', () => {
  test('starts on the ground with the motors off, and the sticks do nothing', async ({ page }) => {
    await open(page, '?paused=1');

    expect(await state(page)).toMatchObject({ phase: 'motorsOff', y: 0, onGround: true });
    await expect(page.locator('#flight-status')).toHaveText('Motors off · press T to take off');

    const later = await fly(page, 5, { pitch: 1, throttle: 1, yaw: 1 });
    expect(later).toMatchObject({ phase: 'motorsOff', x: 0, y: 0, z: 0, heading: 0 });
  });

  test('the take-off button climbs to about 1.2 m and hovers', async ({ page }) => {
    await open(page, '?paused=1');

    const rising = await fly(page, 0.5, { buttons: { takeoffLand: true } });
    expect(rising?.phase).toBe('takingOff');
    await expect(page.locator('#flight-status')).toHaveText('Taking off…');

    const hovering = await fly(page, 8, {});
    expect(hovering?.phase).toBe('flying');
    expect(hovering?.y).toBeGreaterThan(1.15);
    expect(hovering?.y).toBeLessThan(1.25);
    expect(hovering?.speed).toBeLessThan(0.001);
    await expect(page.locator('#flight-status')).toHaveText(
      'Flying · Normal mode · press T to land',
    );
  });

  test('the stick command starts the motors; throttle up then lifts off', async ({ page }) => {
    await open(page, '?paused=1');

    expect((await fly(page, 0.5, STICK_COMMAND))?.phase).toBe('idle');
    await expect(page.locator('#flight-status')).toContainText('Motors on');

    await fly(page, 0.2, {});
    const airborne = await fly(page, 2, { throttle: 1 });
    expect(airborne?.phase).toBe('flying');
    expect(airborne?.y).toBeGreaterThan(5);
  });

  test('the landing button brings it down and stops the motors', async ({ page }) => {
    await openHovering(page, 15);

    expect((await fly(page, 0.2, { buttons: { takeoffLand: true } }))?.phase).toBe('landing');
    await expect(page.locator('#flight-status')).toHaveText('Landing… · press T to cancel');

    const down = await fly(page, 30, {});
    expect(down).toMatchObject({ phase: 'motorsOff', y: 0, onGround: true });
  });

  test('landing by hand leaves the motors on until the throttle is held down', async ({ page }) => {
    await openHovering(page, 2);

    // The last metres are slow, however far down the stick is: about two seconds from 2 m.
    expect((await fly(page, 2.5, { throttle: -1 }))?.phase).toBe('idle');
    expect((await fly(page, 4, { throttle: -1 }))?.phase).toBe('motorsOff');
  });

  test('holding the stick command in flight cuts the motors and the aircraft falls', async ({
    page,
  }) => {
    await openHovering(page, 150);

    expect((await fly(page, 1.5, STICK_COMMAND))?.phase).toBe('flying');
    const cut = await fly(page, 1, STICK_COMMAND);
    expect(cut).toMatchObject({ phase: 'motorsOff', onGround: false });
    await expect(page.locator('#flight-status')).toHaveText('Motors stopped · falling');

    // A fall from that height is a crash. The wreck lies there for a moment, and then the
    // aircraft is put back at the start.
    const wreck = await fly(page, 7, {});
    expect(wreck).toMatchObject({ phase: 'crashed', y: 0, onGround: true });
    await expect(page.locator('#flight-status')).toHaveText(
      'Crashed · back at the start in a moment',
    );

    const back = await fly(page, 4, {});
    expect(back).toMatchObject({ phase: 'motorsOff', x: 0, y: 0, z: 0, onGround: true });
  });
});

test.describe('flight modes (simulated time)', () => {
  test('each mode reaches its own top speed', async ({ page }) => {
    await openHovering(page, 30);

    expect((await fly(page, 40, { pitch: 1, mode: 'S' }))?.speed).toBeCloseTo(19, 1);
    expect((await fly(page, 40, { pitch: 1, mode: 'C' }))?.speed).toBeCloseTo(5, 1);
    expect((await fly(page, 40, { pitch: 1, mode: 'N' }))?.speed).toBeCloseTo(15, 1);
  });
});

test.describe('flight in Normal mode (simulated time, exact stick values)', () => {
  test('hovers without drifting', async ({ page }) => {
    await openHovering(page, 2);

    const later = await fly(page, 30, {});
    expect(later).toMatchObject({ x: 0, y: 2, z: 0, speed: 0, vy: 0, phase: 'flying' });
  });

  test('reaches 15 m/s forward, flying north with the nose down', async ({ page }) => {
    await openHovering(page, 2);

    const cruising = await fly(page, 20, { pitch: 1 });

    expect(cruising?.speed).toBeCloseTo(15, 1);
    expect(cruising?.z).toBeLessThan(-200);
    expect(cruising?.x).toBeCloseTo(0, 3);
    expect(cruising?.pitch).toBeGreaterThan(0.3);
    expect(cruising?.y).toBeCloseTo(2, 6);
  });

  test('climbs and descends at 6 m/s', async ({ page }) => {
    await openHovering(page, 2);

    const climbing = await fly(page, 10, { throttle: 1 });
    expect(climbing?.vy).toBeCloseTo(6, 2);
    expect(climbing?.y).toBeGreaterThan(50);

    const descending = await fly(page, 5, { throttle: -1 });
    expect(descending?.vy).toBeCloseTo(-6, 2);
  });

  test('turns at 90 degrees per second', async ({ page }) => {
    await openHovering(page, 2);

    const turning = await fly(page, 5, { yaw: 1 });

    expect(((turning?.yawRate ?? 0) * 180) / Math.PI).toBeCloseTo(90, 1);
    expect(turning?.speed).toBeCloseTo(0, 6);
  });

  test('brakes and holds its position after the sticks are released', async ({ page }) => {
    await openHovering(page, 2);
    await fly(page, 15, { pitch: 1 });

    const stopped = await fly(page, 15, {});
    expect(stopped?.speed).toBeLessThan(0.001);
    expect(stopped?.holdActive).toBe(true);

    const oneMinuteLater = await fly(page, 60, {});
    expect(oneMinuteLater?.z).toBeCloseTo(stopped?.z ?? Number.NaN, 3);
    expect(oneMinuteLater?.x).toBeCloseTo(stopped?.x ?? Number.NaN, 3);
  });

  test('can be put back to the start', async ({ page }) => {
    await openHovering(page, 2);
    await fly(page, 10, { pitch: 1, yaw: 0.5, throttle: 0.5 });

    const afterReset = await page.evaluate(() => {
      window.__sim?.setControls(null);
      window.__sim?.reset();
      return window.__sim?.getState();
    });

    expect(afterReset).toMatchObject({ phase: 'motorsOff', x: 0, y: 0, z: 0, speed: 0 });
  });
});

test.describe('flying with the keyboard (real time)', () => {
  test('T takes off, the arrow keys fly, and T lands again', async ({ page }) => {
    test.slow();
    await open(page);
    expect(await phase(page)).toBe('motorsOff');

    await page.keyboard.press('KeyT');
    await expect.poll(() => phase(page), { timeout: 30_000 }).toBe('flying');
    expect((await state(page))?.y).toBeGreaterThan(1);

    await page.keyboard.down('ArrowUp');
    await expect
      .poll(async () => (await state(page))?.speed ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(3);
    expect((await state(page))?.z).toBeLessThan(0);
    await page.keyboard.up('ArrowUp');

    await page.keyboard.press('KeyT');
    await expect.poll(() => phase(page)).toBe('landing');
    await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('motorsOff');
    expect((await state(page))?.onGround).toBe(true);
  });

  test('K (the stick command) starts the motors, and W lifts off', async ({ page }) => {
    await open(page);

    await page.keyboard.down('KeyK');
    await expect.poll(() => phase(page), { timeout: 20_000 }).toBe('idle');
    await page.keyboard.up('KeyK');

    await page.keyboard.down('KeyW');
    await expect
      .poll(async () => (await state(page))?.y ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(3);
    await page.keyboard.up('KeyW');
    expect(await phase(page)).toBe('flying');
  });

  test('1 / 2 / 3 change the flight mode shown in the status line', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__sim?.reset({ height: 20 }));
    const status = page.locator('#flight-status');

    await page.keyboard.press('Digit3');
    await expect(status).toContainText('Sport mode');
    await page.keyboard.press('Digit1');
    await expect(status).toContainText('Cine mode');
    await page.keyboard.press('Digit2');
    await expect(status).toContainText('Normal mode');
  });

  test('Backspace puts the aircraft back on the ground at the start', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__sim?.reset({ height: 20 }));
    await page.keyboard.down('ArrowUp');
    await expect
      .poll(async () => Math.abs((await state(page))?.z ?? 0), { timeout: 20_000 })
      .toBeGreaterThan(1);
    await page.keyboard.up('ArrowUp');

    await page.keyboard.press('Backspace');

    await expect.poll(() => phase(page)).toBe('motorsOff');
    expect(await state(page)).toMatchObject({ y: 0, z: 0, onGround: true });
  });

  test('the debug overlay shows the phase, height, speed and heading', async ({ page }) => {
    await open(page, '?debug=1&paused=1');
    const overlay = page.locator('#debug-overlay');

    await expect(overlay).toContainText(
      'Drone        motors off · 0.0 m · 0.0 m/s · climb +0.0 m/s · 000°',
    );

    await page.evaluate(() => window.__sim?.reset({ height: 2 }));
    await fly(page, 20, { pitch: 1 });
    await expect(overlay).toContainText('flying · 2.0 m · 15.0 m/s');
  });
});
