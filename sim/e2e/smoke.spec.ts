import { expect, test } from '@playwright/test';

test('the app loads and draws the 3D scene without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });

  await page.goto('/');

  // main.ts sets this after the first frame has been drawn.
  await expect(page.locator('html')).toHaveAttribute('data-sim-ready', 'true', {
    timeout: 20_000,
  });
  await expect(page.locator('#message')).toBeHidden();
  await expect(page.locator('#build-label')).toContainText('Air 2S Drone Simulator');

  const canvas = page.locator('canvas#view');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBe(1280);
  expect(box?.height).toBe(720);

  // A blank canvas would give two identical strips. Sky and ground must differ.
  const strip = { x: 0, width: 1280, height: 40 };
  const sky = await page.screenshot({ clip: { ...strip, y: 20 } });
  const ground = await page.screenshot({ clip: { ...strip, y: 600 } });
  expect(sky.equals(ground)).toBe(false);

  expect(errors).toEqual([]);
});
