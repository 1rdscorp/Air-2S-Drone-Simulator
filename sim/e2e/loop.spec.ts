import { expect, type Page, test } from '@playwright/test';

/** Opens the app with the given address settings and waits for the first drawn frame. */
async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-sim-ready', 'true', {
    timeout: 20_000,
  });
}

const tick = (page: Page): Promise<number> => page.evaluate(() => window.__sim?.tick ?? -1);

test.describe('game loop', () => {
  test('runs by itself and can be paused and resumed', async ({ page }) => {
    await open(page);

    await expect.poll(() => tick(page)).toBeGreaterThan(10);

    await page.evaluate(() => window.__sim?.pause());
    const pausedAt = await tick(page);
    await page.waitForTimeout(300);
    expect(await tick(page)).toBe(pausedAt);
    await expect(page.locator('#status-badge')).toHaveText('Paused');

    await page.evaluate(() => window.__sim?.resume());
    await expect.poll(() => tick(page)).toBeGreaterThan(pausedAt);
    await expect(page.locator('#status-badge')).toBeHidden();
  });

  test('starts paused with ?paused=1 and steps an exact number of ticks', async ({ page }) => {
    await open(page, '?paused=1');

    expect(await tick(page)).toBe(0);
    await page.waitForTimeout(200);
    expect(await tick(page)).toBe(0);

    const state = await page.evaluate(() => {
      window.__sim?.step(120);
      return window.__sim?.getState();
    });

    expect(state?.tick).toBe(120);
    expect(state?.time).toBe(1);
    expect(state?.markerYaw).toBeCloseTo(0.5, 10);
  });

  test('reaches the same state however the steps are grouped', async ({ page }) => {
    await open(page, '?paused=1');
    const allAtOnce = await page.evaluate(() => {
      window.__sim?.step(600);
      return window.__sim?.getState();
    });

    await open(page, '?paused=1');
    const inPieces = await page.evaluate(() => {
      for (const count of [1, 7, 100, 250, 41, 201]) {
        window.__sim?.step(count);
      }
      return window.__sim?.getState();
    });

    expect(allAtOnce?.tick).toBe(600);
    expect(inPieces).toEqual(allAtOnce);
  });

  test('reads the settings from the address', async ({ page }) => {
    await open(page, '?env=city&time=21.5&seed=7&quality=low&speed=2&paused=1');

    const sim = await page.evaluate(() => ({
      params: window.__sim?.params,
      timeScale: window.__sim?.timeScale,
      paused: window.__sim?.paused,
    }));

    expect(sim.params).toMatchObject({
      env: 'city',
      timeOfDay: 21.5,
      seed: 7,
      quality: 'low',
      speed: 2,
      paused: true,
    });
    expect(sim.timeScale).toBe(2);
    expect(sim.paused).toBe(true);
    await expect(page.locator('#status-badge')).toHaveText('Paused · Speed 2×');
  });
});

test.describe('debug tools', () => {
  test('the overlay is hidden by default and shown with ?debug=1', async ({ page }) => {
    await open(page);
    await expect(page.locator('#debug-overlay')).toBeHidden();

    await open(page, '?debug=1');
    const overlay = page.locator('#debug-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('FPS');
    await expect(overlay).toContainText('Frame');
    await expect(overlay).toContainText(/Draw calls\s+[1-9]/);
    await expect(overlay).toContainText(/Triangles\s+[1-9]/);
    await expect(overlay).toContainText('120 Hz');
  });

  test('reports frame statistics through the test hook', async ({ page }) => {
    await open(page);
    await expect
      .poll(() => page.evaluate(() => window.__sim?.getStats().fps ?? 0))
      .toBeGreaterThan(0);

    const stats = await page.evaluate(() => window.__sim?.getStats());
    expect(stats?.frameMs).toBeGreaterThan(0);
    expect(stats?.drawCalls).toBeGreaterThan(0);
    expect(stats?.triangles).toBeGreaterThan(0);
  });

  test('keyboard shortcuts toggle the overlay, pause, step and change speed', async ({ page }) => {
    await open(page);
    const overlay = page.locator('#debug-overlay');
    const badge = page.locator('#status-badge');

    await page.keyboard.press('Backquote');
    await expect(overlay).toBeVisible();
    await page.keyboard.press('F2');
    await expect(overlay).toBeHidden();

    await page.keyboard.press('KeyP');
    await expect(badge).toHaveText('Paused');
    const pausedAt = await tick(page);

    await page.keyboard.press('Period');
    await page.keyboard.press('Period');
    expect(await tick(page)).toBe(pausedAt + 2);

    await page.keyboard.press('Minus');
    await expect(badge).toHaveText('Paused · Speed 0.5×');
    await page.keyboard.press('Equal');
    await page.keyboard.press('Equal');
    await expect(badge).toHaveText('Paused · Speed 2×');

    await page.keyboard.press('KeyP');
    await expect(badge).toHaveText('Speed 2×');
    await expect.poll(() => tick(page)).toBeGreaterThan(pausedAt + 2);
  });
});
