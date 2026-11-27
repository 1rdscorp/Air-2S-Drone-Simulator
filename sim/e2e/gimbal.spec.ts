import { expect, type Page, test } from '@playwright/test';

/** Opens the app with the given address settings and waits for the first drawn frame. */
async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-sim-ready', 'true', {
    timeout: 20_000,
  });
}

const DEG = Math.PI / 180;

/** Camera tilt against the horizon in degrees: 0 is level, -90 is straight down. */
const tiltDeg = (page: Page) =>
  page.evaluate(() => ((window.__sim?.getState().gimbalTilt ?? Number.NaN) * 180) / Math.PI);

const camera = (page: Page) => page.evaluate(() => window.__sim?.getCamera());

interface Controls {
  gimbal?: number;
  pitch?: number;
  roll?: number;
  yaw?: number;
  buttons?: { c1?: boolean; c2?: boolean };
}

/** Runs `seconds` of simulated time with the controls held as given. */
const run = (page: Page, seconds: number, controls: Controls) =>
  page.evaluate(
    ({ ticks, script }) => {
      window.__sim?.setControls(script);
      window.__sim?.step(ticks);
      return window.__sim?.getState();
    },
    { ticks: Math.round(seconds * 120), script: controls },
  );

/** Opens the drone camera view, paused, with the aircraft hovering at 8 m. */
async function openHovering(page: Page, query = ''): Promise<void> {
  await open(page, `?paused=1&camera=fpv${query}`);
  await page.evaluate(() => window.__sim?.reset({ height: 8 }));
}

/** Hides the text on top of the 3D view, so pictures compare the view itself and not fonts. */
async function hideOverlays(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      '#hud, #debug-overlay, #status-badge, #flight-status, #world-label, #camera-label, #sound-label, #stick-label, #stick-monitor, #build-label { visibility: hidden !important; }',
  });
}

test.describe('gimbal (simulated time)', () => {
  test('starts level, and the dial tilts the camera down and back up', async ({ page }) => {
    await openHovering(page);
    expect(await tiltDeg(page)).toBe(0);

    await run(page, 1, { gimbal: -1 });
    const down = await tiltDeg(page);
    expect(down).toBeLessThan(-30);
    expect(down).toBeGreaterThan(-60);

    await run(page, 0.5, { gimbal: 1 });
    expect(await tiltDeg(page)).toBeGreaterThan(down);
  });

  test('stops at straight down and at level', async ({ page }) => {
    await openHovering(page);

    await run(page, 6, { gimbal: -1 });
    expect(await tiltDeg(page)).toBeCloseTo(-90, 6);

    await run(page, 6, { gimbal: 1 });
    expect(await tiltDeg(page)).toBe(0);
  });

  test('can look up to +24° with ?gimbalup=1', async ({ page }) => {
    await openHovering(page, '&gimbalup=1');

    await run(page, 6, { gimbal: 1 });

    expect(await tiltDeg(page)).toBeCloseTo(24, 6);
  });

  test('the shortcuts look straight down and recentre', async ({ page }) => {
    await openHovering(page);

    await run(page, 0.1, { buttons: { c2: true } });
    await run(page, 3, {});
    expect(await tiltDeg(page)).toBeCloseTo(-90, 6);

    await run(page, 0.1, { buttons: { c1: true } });
    await run(page, 3, {});
    expect(await tiltDeg(page)).toBe(0);
  });

  test('the drone camera looks where the gimbal points, with a level horizon, in a banked turn', async ({
    page,
  }) => {
    await openHovering(page);
    await run(page, 0.9, { gimbal: -1 });
    const state = await run(page, 3, { pitch: 0.8, roll: 0.5, yaw: 0.3 });
    const view = await camera(page);
    const tilt = state?.gimbalTilt ?? 0;
    const heading = state?.heading ?? 0;

    expect(Math.abs(state?.roll ?? 0)).toBeGreaterThan(5 * DEG); // the aircraft is banked
    expect(tilt).toBeLessThan(-20 * DEG);
    // Direction = heading turned down by the gimbal tilt, and nothing from the bank.
    expect(view?.direction[1]).toBeCloseTo(Math.sin(tilt), 6);
    expect(view?.direction[0]).toBeCloseTo(Math.sin(heading) * Math.cos(tilt), 6);
    expect(view?.direction[2]).toBeCloseTo(-Math.cos(heading) * Math.cos(tilt), 6);
  });

  test('the debug overlay shows the gimbal tilt', async ({ page }) => {
    await openHovering(page, '&debug=1');
    await expect(page.locator('#debug-overlay')).toContainText('Drone camera · gimbal 0°');

    await run(page, 6, { gimbal: -1 });
    await expect(page.locator('#debug-overlay')).toContainText('Drone camera · gimbal −90°');
  });
});

test.describe('gimbal keys (real time)', () => {
  test('F tilts down, R tilts up, X looks straight down, Z recentres', async ({ page }) => {
    test.slow();
    await open(page, '?camera=fpv');

    await page.keyboard.down('KeyF');
    await expect.poll(() => tiltDeg(page), { timeout: 20_000 }).toBeLessThan(-10);
    await page.keyboard.up('KeyF');
    const afterF = await tiltDeg(page);

    await page.keyboard.down('KeyR');
    await expect.poll(() => tiltDeg(page), { timeout: 20_000 }).toBeGreaterThan(afterF + 3);
    await page.keyboard.up('KeyR');
    // The keyboard's dial takes a moment to spring back to its middle, and a dial that is
    // still turned overrules a shortcut. Wait for it, as a hand would, before pressing X.
    await expect
      .poll(() => page.evaluate(() => window.__sim?.getInput().frame.gimbal), { timeout: 20_000 })
      .toBe(0);

    await page.keyboard.press('KeyX');
    await expect.poll(() => tiltDeg(page), { timeout: 30_000 }).toBeCloseTo(-90, 3);

    await page.keyboard.press('KeyZ');
    await expect.poll(() => tiltDeg(page), { timeout: 30_000 }).toBe(0);
  });
});

test.describe('gimbal pictures', () => {
  // Compared with reference pictures stored next to this file; see CLAUDE.md, "Picture tests".
  // Holding the dial down for 0.9 s leaves the camera 45° below the horizon once it has come to rest.
  for (const [name, seconds, degrees] of [
    ['looking-45-degrees-down', 0.9, -45],
    ['looking-straight-down', 6, -90],
  ] as const) {
    test(`the drone camera ${name.replaceAll('-', ' ')}, in a banked turn`, async ({ page }) => {
      await openHovering(page);
      await run(page, seconds, { gimbal: -1 });
      await run(page, 3, { pitch: 0.8, roll: 0.35, yaw: 0.25 });
      expect(Math.abs((await tiltDeg(page)) - degrees)).toBeLessThan(1);
      await hideOverlays(page);

      await expect(page).toHaveScreenshot(`${name}.png`);
    });
  }
});
