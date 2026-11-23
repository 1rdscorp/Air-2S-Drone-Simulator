import { expect, type Page, test } from '@playwright/test';

/** Opens the app with the given address settings and waits for the first drawn frame. */
async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-sim-ready', 'true', {
    timeout: 20_000,
  });
}

const input = (page: Page) => page.evaluate(() => window.__sim?.getInput());
const axis = (page: Page, name: 'roll' | 'pitch' | 'yaw' | 'throttle' | 'gimbal') =>
  page.evaluate((key) => window.__sim?.getInput().frame[key] ?? Number.NaN, name);

/** Centre of the yellow dot inside the left or right stick box, relative to that box (0..1). */
async function dotPosition(page: Page, side: 'left' | 'right'): Promise<{ x: number; y: number }> {
  const pad = await page.locator(`[data-stick="${side}"] .sm-pad`).boundingBox();
  const dot = await page.locator(`[data-stick="${side}"] .sm-dot`).boundingBox();
  if (!pad || !dot) {
    throw new Error('stick monitor is not on screen');
  }
  return {
    x: (dot.x + dot.width / 2 - pad.x) / pad.width,
    y: (dot.y + dot.height / 2 - pad.y) / pad.height,
  };
}

/**
 * Replaces the browser's gamepad list with one fake standard gamepad that the test can
 * move through `window.__pad`. No real hardware is involved.
 */
async function installFakeGamepad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pad = {
      connected: false,
      id: 'Test Pad (STANDARD GAMEPAD)',
      index: 0,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    navigator.getGamepads = () => [pad.connected ? (pad as unknown as Gamepad) : null];
  });
}

interface FakePad {
  connected: boolean;
  axes: number[];
  buttons: { pressed: boolean; touched: boolean; value: number }[];
}

const setPad = (page: Page, change: { connected?: boolean; axes?: number[]; press?: number[] }) =>
  page.evaluate((next) => {
    const pad = (window as unknown as { __pad: FakePad }).__pad;
    if (next.connected !== undefined) {
      pad.connected = next.connected;
    }
    if (next.axes) {
      pad.axes = next.axes;
    }
    if (next.press) {
      pad.buttons.forEach((button, index) => {
        const down = next.press?.includes(index) ?? false;
        button.pressed = down;
        button.value = down ? 1 : 0;
      });
    }
  }, change);

test.describe('stick monitor', () => {
  test('is shown by default, hidden with ?sticks=0, and toggled with the I key', async ({
    page,
  }) => {
    await open(page, '?sticks=0');
    await expect(page.locator('#stick-monitor')).toBeHidden();

    await open(page);
    const monitor = page.locator('#stick-monitor');
    await expect(monitor).toBeVisible();
    await expect(monitor).toContainText('Keyboard · Stick mode 2 · Normal');
    await expect(page.locator('[data-stick="left"] figcaption')).toHaveText('Throttle · Yaw');
    await expect(page.locator('[data-stick="right"] figcaption')).toHaveText('Pitch · Roll');

    await page.keyboard.press('KeyI');
    await expect(monitor).toBeHidden();
    await page.keyboard.press('KeyI');
    await expect(monitor).toBeVisible();
  });

  test('starts with both dots in the centre', async ({ page }) => {
    await open(page);

    for (const side of ['left', 'right'] as const) {
      const position = await dotPosition(page, side);
      expect(position.x).toBeCloseTo(0.5, 1);
      expect(position.y).toBeCloseTo(0.5, 1);
    }
  });
});

test.describe('keyboard', () => {
  test('W climbs and moves the left dot up; releasing returns to the centre', async ({ page }) => {
    await open(page);

    await page.keyboard.down('KeyW');
    await expect.poll(() => axis(page, 'throttle')).toBe(1);
    expect((await dotPosition(page, 'left')).y).toBeLessThan(0.15);
    expect((await dotPosition(page, 'left')).x).toBeCloseTo(0.5, 1);

    await page.keyboard.up('KeyW');
    await expect.poll(() => axis(page, 'throttle')).toBe(0);
    expect((await dotPosition(page, 'left')).y).toBeCloseTo(0.5, 1);
  });

  test('each stick key drives the right control in stick mode 2', async ({ page }) => {
    await open(page);
    const cases = [
      ['KeyS', 'throttle', -1],
      ['KeyD', 'yaw', 1],
      ['KeyA', 'yaw', -1],
      ['ArrowUp', 'pitch', 1],
      ['ArrowDown', 'pitch', -1],
      ['ArrowRight', 'roll', 1],
      ['ArrowLeft', 'roll', -1],
      ['KeyR', 'gimbal', 1],
      ['KeyF', 'gimbal', -1],
    ] as const;

    for (const [key, control, expected] of cases) {
      await page.keyboard.down(key);
      await expect
        .poll(() => axis(page, control), { message: `${key} -> ${control}` })
        .toBe(expected);
      await page.keyboard.up(key);
      await expect.poll(() => axis(page, control), { message: `${key} released` }).toBe(0);
    }
  });

  test('the right dot follows the arrow keys', async ({ page }) => {
    await open(page);

    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowDown');
    await expect.poll(() => axis(page, 'roll')).toBe(1);
    await expect.poll(() => axis(page, 'pitch')).toBe(-1);

    const position = await dotPosition(page, 'right');
    expect(position.x).toBeGreaterThan(0.85);
    expect(position.y).toBeGreaterThan(0.85);

    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowDown');
  });

  test('stick mode 1 moves pitch to the left stick and throttle to the right', async ({ page }) => {
    await open(page, '?stickmode=1');
    await expect(page.locator('[data-stick="left"] figcaption')).toHaveText('Pitch · Yaw');
    await expect(page.locator('[data-stick="right"] figcaption')).toHaveText('Throttle · Roll');

    await page.keyboard.down('KeyW');
    await expect.poll(() => axis(page, 'pitch')).toBe(1);
    expect(await axis(page, 'throttle')).toBe(0);
    await page.keyboard.up('KeyW');

    await page.keyboard.down('ArrowUp');
    await expect.poll(() => axis(page, 'throttle')).toBe(1);
    await page.keyboard.up('ArrowUp');
  });

  test('1, 2 and 3 select Cine, Normal and Sport, and the choice stays', async ({ page }) => {
    await open(page);
    const status = page.locator('#stick-monitor .sm-status');

    await page.keyboard.press('Digit3');
    await expect(status).toContainText('Sport');
    expect((await input(page))?.frame.mode).toBe('S');

    await page.keyboard.press('Digit1');
    await expect(status).toContainText('Cine');
    await page.keyboard.press('Digit2');
    await expect(status).toContainText('Normal');
  });

  test('buttons light up while their key is held', async ({ page }) => {
    await open(page);
    const pill = page.locator('[data-button="rth"]');
    await expect(pill).not.toHaveClass(/is-on/);

    await page.keyboard.down('KeyH');
    await expect(pill).toHaveClass(/is-on/);
    expect((await input(page))?.frame.buttons.rth).toBe(true);

    await page.keyboard.up('KeyH');
    await expect(pill).not.toHaveClass(/is-on/);
  });

  test('the monitor keeps following the keys while the simulation is paused', async ({ page }) => {
    await open(page, '?paused=1');

    await page.keyboard.down('ArrowLeft');
    await expect.poll(() => axis(page, 'roll')).toBe(-1);
    expect((await dotPosition(page, 'right')).x).toBeLessThan(0.15);
    expect(await page.evaluate(() => window.__sim?.tick)).toBe(0);
    await page.keyboard.up('ArrowLeft');
  });
});

test.describe('gamepad', () => {
  test('takes over when used, and the dots follow its sticks', async ({ page }) => {
    await installFakeGamepad(page);
    await open(page, '?expo=0');
    expect((await input(page))?.source).toBe('keyboard');

    // Left stick fully forward and half right; right stick fully left.
    await setPad(page, { connected: true, axes: [0.5, -1, -1, 0] });

    await expect.poll(async () => (await input(page))?.source).toBe('gamepad');
    await expect(page.locator('#stick-monitor .sm-status')).toContainText('Gamepad (Test Pad)');

    const state = await input(page);
    expect(state?.frame.throttle).toBe(1);
    expect(state?.frame.roll).toBe(-1);
    // 0.5 with the gamepad deadzone of 0.08: (0.5 - 0.08) / 0.92
    expect(state?.frame.yaw).toBeCloseTo(0.4565, 3);

    const left = await dotPosition(page, 'left');
    expect(left.y).toBeLessThan(0.15);
    expect(left.x).toBeGreaterThan(0.6);
    expect((await dotPosition(page, 'right')).x).toBeLessThan(0.15);
  });

  test('ignores small stick drift inside the deadzone', async ({ page }) => {
    await installFakeGamepad(page);
    await open(page);

    await setPad(page, { connected: true, axes: [0, -1, 0, 0] });
    await expect.poll(async () => (await input(page))?.source).toBe('gamepad');
    await setPad(page, { axes: [0.05, -0.04, 0.06, 0] });

    await expect.poll(() => axis(page, 'throttle')).toBe(0);
    const state = await input(page);
    expect(state?.frame).toMatchObject({ roll: 0, pitch: 0, yaw: 0, throttle: 0 });
    expect(state?.raw.leftX).toBeCloseTo(0.05, 6);
  });

  test('buttons, triggers and the D-pad work', async ({ page }) => {
    await installFakeGamepad(page);
    await open(page);

    // Y (return to home), right trigger (gimbal up), D-pad right (Sport).
    await setPad(page, { connected: true, press: [3, 7, 15] });

    await expect.poll(async () => (await input(page))?.frame.buttons.rth).toBe(true);
    const state = await input(page);
    expect(state?.frame.gimbal).toBe(1);
    expect(state?.frame.mode).toBe('S');
    await expect(page.locator('[data-button="rth"]')).toHaveClass(/is-on/);
  });

  test('says "not connected" when the gamepad is unplugged, until the keyboard is used', async ({
    page,
  }) => {
    await installFakeGamepad(page);
    await open(page);
    await setPad(page, { connected: true, axes: [0, -1, 0, 0] });
    await expect.poll(async () => (await input(page))?.source).toBe('gamepad');

    await setPad(page, { connected: false });

    await expect.poll(async () => (await input(page))?.frame.connected).toBe(false);
    expect((await input(page))?.frame.throttle).toBe(0);
    await expect(page.locator('#stick-monitor .sm-status')).toContainText('not connected');

    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await input(page))?.source).toBe('keyboard');
    await expect.poll(async () => (await input(page))?.frame.connected).toBe(true);
    await page.keyboard.up('KeyW');
  });
});
