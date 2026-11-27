import { expect, type Page, test } from '@playwright/test';

/** Opens the app with the given address settings and waits for the first drawn frame. */
async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-sim-ready', 'true', {
    timeout: 20_000,
  });
}

const world = (page: Page) => page.evaluate(() => window.__sim?.getWorld());
const state = (page: Page) => page.evaluate(() => window.__sim?.getState());
const toasts = (page: Page) => page.locator('#hud .hud-toast');
const menu = (page: Page) => page.locator('#world-menu');
const row = (page: Page, id: string) => page.locator(`#world-menu [data-env="${id}"]`);

interface Controls {
  roll?: number;
  pitch?: number;
  yaw?: number;
  throttle?: number;
  mode?: 'C' | 'N' | 'S';
  buttons?: { takeoffLand?: boolean };
}

/** Flies for `seconds` of simulated time with the controls held as given, then returns the state. */
const fly = (page: Page, seconds: number, controls: Controls = {}) =>
  page.evaluate(
    ({ ticks, script }) => {
      window.__sim?.setControls(script);
      window.__sim?.step(ticks);
      return window.__sim?.getState();
    },
    { ticks: Math.round(seconds * 120), script: controls },
  );

/**
 * Flies on with the controls held, `chunk` seconds at a time, until the aircraft is in the
 * given flight phase or `maxSeconds` have passed. Returns the state it stopped at.
 */
async function flyUntil(
  page: Page,
  phase: string,
  maxSeconds: number,
  controls: Controls = {},
  chunk = 0.25,
) {
  let now = await state(page);
  for (let t = 0; t < maxSeconds && now?.phase !== phase; t += chunk) {
    now = await fly(page, chunk, controls);
  }
  return now;
}

test.describe('the place to fly', () => {
  test('starts in the test field, at its start, and names it', async ({ page }) => {
    await open(page);

    expect(await world(page)).toMatchObject({ id: 'test', name: 'Test Field', status: 'ready' });
    await expect(page.locator('#world-label')).toHaveText('Test Field · E to change');
    await expect(page.locator('#loading-screen')).toBeHidden();
    expect(await state(page)).toMatchObject({ phase: 'motorsOff', x: 0, y: 0, z: 0, groundY: 0 });
  });

  test('a place that is not built yet is answered with the test field and a note', async ({
    page,
  }) => {
    await open(page, '?env=mountains&paused=1');

    expect((await world(page))?.id).toBe('test');
    await expect(toasts(page)).toHaveText(['Mountains is not built yet · this is the Test Field']);
  });

  test('loading the place again and again leaves nothing behind on the graphics card', async ({
    page,
  }) => {
    await open(page, '?paused=1');
    // One short flight first: the spinning propellers are first drawn when the motors run,
    // and that is one more shape on the card which has nothing to do with the place.
    await fly(page, 0.2, { buttons: { takeoffLand: true } });
    const before = (await world(page))?.memory;
    expect(before?.geometries).toBeGreaterThan(5);
    expect(before?.textures).toBeGreaterThan(0);

    for (let i = 0; i < 10; i++) {
      // Fly a little in between, as a pilot would.
      await fly(page, 0.2, { buttons: { takeoffLand: true } });
      expect(await page.evaluate(() => window.__sim?.setEnvironment('test'))).toBe(true);
      const now = await world(page);
      expect(now?.status).toBe('ready');
      expect(now?.memory, `after switch ${i + 1}`).toEqual(before);
    }

    // And the place is whole: there is still exactly one of it in the picture.
    expect(await state(page)).toMatchObject({ phase: 'motorsOff', x: 0, y: 0, z: 0 });
  });

  test('changing the place starts a new flight there', async ({ page }) => {
    await open(page, '?paused=1');
    await page.evaluate(() => window.__sim?.reset({ height: 30 }));
    await fly(page, 0.1);
    await fly(page, 3, { pitch: 1, mode: 'S' });
    expect((await state(page))?.z).toBeLessThan(-10);
    await expect(toasts(page)).toHaveCount(1);

    await page.evaluate(() => window.__sim?.setEnvironment('test'));

    expect(await state(page)).toMatchObject({
      phase: 'motorsOff',
      x: 0,
      y: 0,
      z: 0,
      homeSet: false,
    });
    await expect(toasts(page)).toHaveCount(0);
  });
});

test.describe('the list of places', () => {
  test('E opens it: every place is listed, the ones not built yet cannot be chosen', async ({
    page,
  }) => {
    await open(page);

    await page.keyboard.press('KeyE');

    await expect(menu(page)).toBeVisible();
    expect((await world(page))?.menuOpen).toBe(true);
    await expect(page.locator('#world-menu .wm-name')).toHaveText([
      'Test Field',
      'Mountains',
      'Ocean',
      'Beach',
      'City',
    ]);
    await expect(row(page, 'test')).toBeEnabled();
    await expect(row(page, 'test')).toHaveClass(/is-current/);
    await expect(row(page, 'test')).toHaveClass(/is-highlighted/);
    for (const id of ['mountains', 'ocean', 'beach', 'city']) {
      await expect(row(page, id)).toBeDisabled();
      await expect(row(page, id)).toContainText('Not built yet');
    }
  });

  test('nothing flies while it is open, and Esc closes it', async ({ page }) => {
    await open(page);
    await page.keyboard.press('KeyE');
    expect(await page.evaluate(() => window.__sim?.paused)).toBe(true);

    await page.keyboard.press('KeyT'); // would take off
    await page.keyboard.press('ArrowDown'); // moves in the list; does not fly backward
    await page.keyboard.press('Escape');

    await expect(menu(page)).toBeHidden();
    expect(await page.evaluate(() => window.__sim?.paused)).toBe(false);
    expect((await state(page))?.phase).toBe('motorsOff');
    expect((await world(page))?.menuOpen).toBe(false);
  });

  test('the arrow keys pass over places that are not built yet', async ({ page }) => {
    await open(page);
    await page.keyboard.press('KeyE');

    await page.keyboard.press('ArrowDown');
    await expect(row(page, 'test')).toHaveClass(/is-highlighted/);
    await page.keyboard.press('ArrowUp');
    await expect(row(page, 'test')).toHaveClass(/is-highlighted/);
  });

  test('Enter, a number or a click chooses a place and loads it', async ({ page }) => {
    await open(page, '?paused=1');
    const flyAway = async (): Promise<void> => {
      await page.evaluate(() => window.__sim?.reset({ height: 12 }));
      expect((await state(page))?.phase).toBe('flying');
    };

    await flyAway();
    await page.keyboard.press('KeyE');
    await page.keyboard.press('Enter');
    await expect(menu(page)).toBeHidden();
    await expect.poll(async () => (await state(page))?.phase).toBe('motorsOff');

    await flyAway();
    await page.keyboard.press('KeyE');
    await page.keyboard.press('Digit1');
    await expect.poll(async () => (await state(page))?.phase).toBe('motorsOff');

    await flyAway();
    await page.locator('#world-label').click(); // the label opens the list as well
    await row(page, 'test').click();
    await expect(menu(page)).toBeHidden();
    await expect.poll(async () => (await state(page))?.phase).toBe('motorsOff');

    // It was paused before the list was opened, and it still is.
    expect(await page.evaluate(() => window.__sim?.paused)).toBe(true);
    expect((await world(page))?.status).toBe('ready');
  });

  test('the number of a place that is not built yet does nothing', async ({ page }) => {
    await open(page);
    await page.keyboard.press('KeyE');

    await page.keyboard.press('Digit2');

    await expect(menu(page)).toBeVisible();
    expect((await world(page))?.id).toBe('test');
  });
});

test.describe('obstacles on the test field', () => {
  test('flying into the cube is a crash, and the aircraft is put back at the start', async ({
    page,
  }) => {
    await open(page, '?paused=1');
    await page.evaluate(() => window.__sim?.reset({ height: 2.5 }));
    // The cube stands 14 m east and 26 m north of the start.
    await fly(page, 2, { roll: 1 });
    await fly(page, 3);
    const beside = await state(page);
    expect(beside?.x).toBeGreaterThan(12);
    expect(beside?.x).toBeLessThan(16.2);

    await flyUntil(page, 'crashed', 8, { pitch: 0.6 });
    const wreck = await fly(page, 1.5); // time to fall and come to rest

    expect(wreck).toMatchObject({ phase: 'crashed', y: 0, onGround: true });
    expect(wreck?.z).toBeGreaterThan(-24.3); // in front of the cube, not inside it
    expect(wreck?.z).toBeLessThan(-23);
    expect(wreck?.roll).toBeGreaterThan(0.3); // lying tipped over
    await expect(toasts(page)).toHaveText(['Crashed']);
    await expect(toasts(page).first()).toHaveClass(/is-warning/);
    await expect(page.locator('#flight-status')).toHaveText(
      'Crashed · back at the start in a moment',
    );

    await flyUntil(page, 'motorsOff', 5);

    expect(await state(page)).toMatchObject({ phase: 'motorsOff', x: 0, y: 0, z: 0, roll: 0 });
    await expect(toasts(page).last()).toHaveText('Back at the start');
    await expect(page.locator('#flight-status')).toContainText('Motors off');
  });

  test('the platform can be landed on, and the display shows its height', async ({ page }) => {
    await open(page, '?paused=1');
    await page.evaluate(() => window.__sim?.reset({ height: 8 }));
    // The platform is 18 m east and 9 m north, and 1.5 m high.
    let now = await fly(page, 0.1);
    for (let i = 0; i < 20; i++) {
      const east = Math.max(-1, Math.min(1, (18 - (now?.x ?? 0)) / 6));
      const north = Math.max(-1, Math.min(1, ((now?.z ?? 0) + 9) / 6));
      now = await fly(page, 0.5, { roll: east, pitch: north, mode: 'C' });
    }
    await fly(page, 3);
    const above = await state(page);
    expect(Math.abs((above?.x ?? 0) - 18)).toBeLessThan(2);
    expect(Math.abs((above?.z ?? 0) + 9)).toBeLessThan(2);
    expect(above?.groundY).toBe(1.5);

    await fly(page, 0.1, { buttons: { takeoffLand: true } });
    await flyUntil(page, 'motorsOff', 15, {}, 1);

    expect(await state(page)).toMatchObject({
      phase: 'motorsOff',
      y: 1.5,
      onGround: true,
      roll: 0,
    });
    await expect(page.locator('#hud [data-hud="height"]')).toHaveText('1.5');
    await expect(toasts(page).last()).toHaveText('Landed · motors off');
  });

  test('coming down by hand is slowed near the ground and ends in a gentle landing', async ({
    page,
  }) => {
    await open(page, '?paused=1');
    await page.evaluate(() => window.__sim?.reset({ height: 40 }));

    const high = await fly(page, 3, { throttle: -1 });
    expect(high?.vy).toBeLessThan(-5.5);

    const down = await fly(page, 12, { throttle: -1 });
    expect(down).toMatchObject({ y: 0, onGround: true, roll: 0 });
    expect(down?.phase).not.toBe('crashed');
  });
});
