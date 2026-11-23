import { expect, type Page, test } from '@playwright/test';

/** Opens the app with the given address settings and waits for the first drawn frame. */
async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-sim-ready', 'true', {
    timeout: 20_000,
  });
}

const camera = (page: Page) => page.evaluate(() => window.__sim?.getCamera());
const state = (page: Page) => page.evaluate(() => window.__sim?.getState());

/**
 * Puts the aircraft into one fixed, repeatable moment of flight: 8 m up, flying a banked
 * right turn. Every picture test starts from here.
 */
async function flyToFixedMoment(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__sim?.reset({ height: 8 });
    window.__sim?.setControls({ pitch: 0.8, roll: 0.35, yaw: 0.25 });
    window.__sim?.step(360);
  });
}

/** Hides the text on top of the 3D view, so pictures compare the view itself and not fonts. */
async function hideOverlays(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      '#debug-overlay, #status-badge, #flight-status, #camera-label, #stick-monitor, #build-label { visibility: hidden !important; }',
  });
}

test.describe('camera views', () => {
  test('starts with the chase camera, and V goes through the three views', async ({ page }) => {
    await open(page);
    const label = page.locator('#camera-label');

    expect((await camera(page))?.mode).toBe('chase');
    await expect(label).toHaveText('Chase camera · V to change');

    await page.keyboard.press('KeyV');
    expect((await camera(page))?.mode).toBe('fpv');
    await expect(label).toHaveText('Drone camera · V to change');

    await page.keyboard.press('KeyV');
    expect((await camera(page))?.mode).toBe('free');
    await expect(label).toContainText('Free camera · drag to look around');

    await page.keyboard.press('KeyV');
    expect((await camera(page))?.mode).toBe('chase');
  });

  test('the view can be chosen in the address', async ({ page }) => {
    await open(page, '?camera=fpv');
    expect((await camera(page))?.mode).toBe('fpv');

    await open(page, '?camera=free&debug=1');
    expect((await camera(page))?.mode).toBe('free');
    await expect(page.locator('#debug-overlay')).toContainText(/Camera\s+Free camera/);
  });

  test('the chase camera stays behind the aircraft as it turns', async ({ page }) => {
    await open(page, '?paused=1');
    await page.evaluate(() => {
      window.__sim?.reset({ height: 10 });
      window.__sim?.setControls({ yaw: 1 });
      window.__sim?.step(120); // about a quarter turn to the right
    });

    const drone = await state(page);
    const view = await camera(page);
    const heading = drone?.heading ?? 0;
    const behind = [
      (drone?.x ?? 0) - Math.sin(heading) * 1.7,
      (drone?.z ?? 0) + Math.cos(heading) * 1.7,
    ];

    expect(heading).toBeGreaterThan(1);
    expect(view?.position[0]).toBeCloseTo(behind[0] ?? 0, 3);
    expect(view?.position[2]).toBeCloseTo(behind[1] ?? 0, 3);
    expect(view?.position[1]).toBeGreaterThan(drone?.y ?? 0);
  });

  test('the drone camera sits on the aircraft and looks where its nose points', async ({
    page,
  }) => {
    await open(page, '?paused=1&camera=fpv');
    await flyToFixedMoment(page);

    const drone = await state(page);
    const view = await camera(page);
    const distance = Math.hypot(
      (view?.position[0] ?? 0) - (drone?.x ?? 0),
      (view?.position[1] ?? 0) - (drone?.y ?? 0),
      (view?.position[2] ?? 0) - (drone?.z ?? 0),
    );

    expect(distance).toBeLessThan(0.2);
    expect(view?.direction[0]).toBeCloseTo(Math.sin(drone?.heading ?? 0), 6);
    expect(view?.direction[2]).toBeCloseTo(-Math.cos(drone?.heading ?? 0), 6);
    expect(view?.direction[1]).toBeCloseTo(0, 6); // level, although the aircraft is tilted
    expect(Math.abs(drone?.pitch ?? 0)).toBeGreaterThan(0.1);
  });

  test('the free camera is moved with the mouse: drag to look around, scroll to zoom', async ({
    page,
  }) => {
    await open(page, '?paused=1&camera=free');
    await flyToFixedMoment(page);
    const before = await camera(page);

    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.mouse.move(540, 300, { steps: 5 });
    await page.mouse.up();
    const dragged = await camera(page);
    expect(dragged?.free.azimuthDeg).toBeGreaterThan((before?.free.azimuthDeg ?? 0) + 20);
    expect(dragged?.free.elevationDeg).toBeLessThan((before?.free.elevationDeg ?? 0) - 10);

    await page.mouse.wheel(0, 600);
    const zoomedOut = await camera(page);
    expect(zoomedOut?.free.distance).toBeGreaterThan((dragged?.free.distance ?? 0) * 1.5);

    await page.mouse.wheel(0, -1200);
    expect((await camera(page))?.free.distance).toBeLessThan(zoomedOut?.free.distance ?? 0);
  });

  test('the mouse does nothing in the chase view', async ({ page }) => {
    await open(page, '?paused=1');
    const before = await camera(page);

    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.mouse.move(400, 200, { steps: 5 });
    await page.mouse.up();
    await page.mouse.wheel(0, 800);

    expect(await camera(page)).toEqual(before);
  });

  test('the aircraft is not moved by changing the view', async ({ page }) => {
    await open(page, '?paused=1');
    await flyToFixedMoment(page);
    const before = await state(page);

    for (const mode of ['fpv', 'free', 'chase'] as const) {
      await page.evaluate((next) => window.__sim?.setCamera(next), mode);
    }

    expect(await state(page)).toEqual(before);
  });
});

test.describe('camera pictures', () => {
  // Each picture is compared with a reference picture stored next to this file.
  // To renew the references after an intended change: npx playwright test --update-snapshots
  for (const mode of ['chase', 'fpv', 'free'] as const) {
    test(`the ${mode} view of a fixed moment of flight`, async ({ page }) => {
      await open(page, `?paused=1&camera=${mode}`);
      await flyToFixedMoment(page);
      await hideOverlays(page);

      await expect(page).toHaveScreenshot(`${mode}-view.png`);
    });
  }

  test('the model on the ground, seen by the free camera', async ({ page }) => {
    await open(page, '?paused=1&camera=free');
    await hideOverlays(page);
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, -600); // move in close

    await expect(page).toHaveScreenshot('model-on-the-ground.png');
  });
});
