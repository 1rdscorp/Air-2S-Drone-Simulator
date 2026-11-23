import { expect, type Locator, type Page, test } from '@playwright/test';

/** Opens the app with the given address settings and waits for the first drawn frame. */
async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-sim-ready', 'true', {
    timeout: 20_000,
  });
}

/** Opens the app paused, with the aircraft already hovering at `height` metres. */
async function openHovering(page: Page, height: number): Promise<void> {
  await open(page, '?paused=1');
  await page.evaluate((h) => window.__sim?.reset({ height: h }), height);
}

const state = (page: Page) => page.evaluate(() => window.__sim?.getState());

interface Controls {
  roll?: number;
  pitch?: number;
  yaw?: number;
  throttle?: number;
  gimbal?: number;
  mode?: 'C' | 'N' | 'S';
  connected?: boolean;
  buttons?: { takeoffLand?: boolean; pause?: boolean };
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

/** One value of the flight display, by its `data-hud` name. */
const hud = (page: Page, name: string): Locator => page.locator(`#hud [data-hud="${name}"]`);

/** The number a value of the flight display shows. The display uses a real minus sign. */
async function hudNumber(page: Page, name: string): Promise<number> {
  const text = (await hud(page, name).textContent()) ?? '';
  return Number.parseFloat(text.replace('−', '-'));
}

const toasts = (page: Page): Locator => page.locator('#hud .hud-toast');

const STICK_COMMAND = { throttle: -1, yaw: 1, pitch: -1, roll: -1 };

test.describe('flight display', () => {
  test('on the ground before the first start', async ({ page }) => {
    await open(page, '?paused=1');

    await expect(page.locator('#hud')).toBeVisible();
    await expect(hud(page, 'mode')).toHaveText('Normal');
    await expect(hud(page, 'time')).toHaveText('00:00');
    await expect(hud(page, 'battery')).toHaveText('100%');
    await expect(hud(page, 'height')).toHaveText('0.0');
    await expect(hud(page, 'distance')).toHaveText('–'); // no home point yet
    await expect(hud(page, 'speed')).toHaveText('0.0');
    await expect(hud(page, 'climb')).toHaveText('0.0');
    await expect(hud(page, 'gimbal')).toHaveText('0°');
    await expect(hud(page, 'heading')).toHaveText('000°');
    await expect(hud(page, 'compass-point')).toHaveText('N');
    await expect(hud(page, 'compass-home')).toBeHidden();
    await expect(hud(page, 'home-direction')).toBeHidden();
    await expect(toasts(page)).toHaveCount(0);
  });

  test('height, speed, distance and flight time follow the flight', async ({ page }) => {
    await openHovering(page, 20);
    await expect(hud(page, 'height')).toHaveText('20.0');
    await expect(hud(page, 'distance')).toHaveText('0'); // hovering over the home point
    await expect(hud(page, 'time')).toHaveText('00:00');

    const flown = await fly(page, 10, { pitch: 1 });

    expect(flown?.speed).toBeGreaterThan(14);
    expect(await hudNumber(page, 'speed')).toBeCloseTo(flown?.speed ?? 0, 1);
    expect(await hudNumber(page, 'height')).toBeCloseTo(flown?.y ?? 0, 1);
    // Flying north from the home point at the origin: the distance is how far north.
    const distance = Math.hypot(flown?.x ?? 0, flown?.z ?? 0);
    expect(distance).toBeGreaterThan(100);
    await expect(hud(page, 'distance')).toHaveText(String(Math.round(distance)));
    await expect(hud(page, 'time')).toHaveText('00:10');
  });

  test('climb rate shows its sign', async ({ page }) => {
    await openHovering(page, 50);

    await fly(page, 4, { throttle: 1 });
    await expect(hud(page, 'climb')).toHaveText('+6.0');

    await fly(page, 4, { throttle: -1 });
    await expect(hud(page, 'climb')).toHaveText('−6.0');

    await fly(page, 4);
    await expect(hud(page, 'climb')).toHaveText('0.0');
    expect(await hudNumber(page, 'height')).toBeCloseTo((await state(page))?.y ?? 0, 1);
  });

  test('the compass follows the heading', async ({ page }) => {
    await openHovering(page, 20);
    const tape = hud(page, 'compass').locator('.hud-tape > g');
    const before = await tape.getAttribute('transform');

    const turned = await fly(page, 1.2, { yaw: 1 }); // 90°/s in Normal mode
    const heading = Math.round(turned?.headingDeg ?? 0);

    expect(heading).toBeGreaterThan(80);
    expect(heading).toBeLessThan(120);
    await expect(hud(page, 'heading')).toHaveText(`${String(heading).padStart(3, '0')}°`);
    await expect(hud(page, 'compass-point')).toHaveText('E');
    expect(await tape.getAttribute('transform')).not.toBe(before);

    // Turning left past north reads 3xx, not a negative number.
    const left = await fly(page, 3, { yaw: -1 });
    expect(left?.headingDeg).toBeGreaterThan(180);
    await expect(hud(page, 'heading')).toHaveText(`${Math.round(left?.headingDeg ?? 0)}°`);
  });

  test('the horizon tilts with the aircraft', async ({ page }) => {
    await openHovering(page, 30);
    const attitude = hud(page, 'attitude');
    await expect(attitude).toHaveAttribute('data-pitch', '0.0');
    await expect(attitude).toHaveAttribute('data-roll', '0.0');

    // Full forward and right: nose down, right side down.
    const flown = await fly(page, 1, { pitch: 1, roll: 1 });
    const degrees = 180 / Math.PI;

    const pitch = Number(await attitude.getAttribute('data-pitch'));
    const roll = Number(await attitude.getAttribute('data-roll'));
    expect(pitch).toBeGreaterThan(10);
    expect(roll).toBeGreaterThan(10);
    expect(pitch).toBeCloseTo((flown?.pitch ?? 0) * degrees, 1);
    expect(roll).toBeCloseTo((flown?.roll ?? 0) * degrees, 1);

    // Banking right turns the horizon left; nose down moves it up.
    const transform = await attitude.locator('g[clip-path] > g').getAttribute('transform');
    expect(transform).toMatch(/^rotate\(-\d+\.\d\) translate\(0 -\d+\.\d\)$/);
  });

  test('the home marks point back to where the flight started', async ({ page }) => {
    await openHovering(page, 20);
    const onRim = hud(page, 'home-direction');
    const onTape = hud(page, 'compass-home');
    await expect(onRim).toBeHidden(); // straight above home there is no direction to it
    await expect(onTape).toBeHidden();

    // Fly north: home is now straight behind, and off the end of the compass tape.
    await fly(page, 6, { pitch: 1 });
    await fly(page, 4);
    await expect(onRim).toBeVisible();
    expect(Math.abs(Number(await onRim.getAttribute('data-direction')))).toBe(180);
    await expect(onTape).toBeVisible();
    await expect(onTape).toContainText('H');
    expect(await onTape.textContent()).not.toBe('H');

    // Turn right by 90°: home is to the right.
    const turned = await fly(page, 1, { yaw: 1 });
    await fly(page, 3);
    const settled = await state(page);
    expect(settled?.headingDeg).toBeGreaterThan(60);
    const direction = Number(await onRim.getAttribute('data-direction'));
    expect(direction).toBeCloseTo(180 - (settled?.headingDeg ?? 0), 0);
    expect(direction).toBeGreaterThan(45);
    expect(turned?.headingDeg).toBeGreaterThan(30);

    // Turn until the nose points south, at home: the mark is at the top and on the tape.
    await fly(page, 1.4, { yaw: 1 });
    await fly(page, 3);
    const facingHome = await state(page);
    expect(Math.abs((facingHome?.headingDeg ?? 0) - 180)).toBeLessThan(40);
    await expect(onTape).toHaveText('H');
    expect(Math.abs(Number(await onRim.getAttribute('data-direction')))).toBeLessThan(40);
  });

  test('the flight mode and the camera tilt are shown', async ({ page }) => {
    await openHovering(page, 20);
    await fly(page, 0.1);

    await fly(page, 0.1, { mode: 'S' });
    await expect(hud(page, 'mode')).toHaveText('Sport');
    await expect(hud(page, 'mode')).toHaveAttribute('data-mode', 'S');
    await expect(toasts(page)).toHaveText(['Sport mode · up to 19 m/s']);

    await fly(page, 0.1, { mode: 'C' });
    await expect(hud(page, 'mode')).toHaveText('Cine');
    await expect(toasts(page)).toHaveText(['Cine mode · up to 5 m/s']);

    const tilted = await fly(page, 1, { mode: 'C', gimbal: -1 });
    const degrees = Math.round(((tilted?.gimbalTilt ?? 0) * 180) / Math.PI);
    expect(degrees).toBeLessThan(-30);
    await expect(hud(page, 'gimbal')).toHaveText(`−${Math.abs(degrees)}°`);
  });

  test('messages tell the take-off and the landing, and go away again', async ({ page }) => {
    await open(page, '?paused=1');

    await fly(page, 0.1, { buttons: { takeoffLand: true } });
    await expect(toasts(page)).toHaveText(['Home point recorded', 'Taking off']);
    await expect(hud(page, 'distance')).toHaveText('0'); // the home point exists now

    await fly(page, 3);
    await expect(toasts(page)).toHaveText([
      'Home point recorded',
      'Take-off complete · hovering at 1.2 m',
    ]);
    await expect(hud(page, 'height')).toHaveText('1.2');

    // Messages last a few simulated seconds.
    await fly(page, 1.5);
    await expect(toasts(page)).toHaveText(['Take-off complete · hovering at 1.2 m']);
    await fly(page, 4);
    await expect(toasts(page)).toHaveCount(0);

    await fly(page, 0.1, { buttons: { takeoffLand: true } });
    await expect(toasts(page)).toHaveText(['Landing']);
    await fly(page, 3); // from 1.2 m the landing takes about two seconds
    await expect(toasts(page)).toHaveText(['Landed · motors off']);
    await expect(hud(page, 'height')).toHaveText('0.0');

    // The flight clock stopped with the motors.
    const landedAt = await hud(page, 'time').textContent();
    expect(landedAt).not.toBe('00:00');
    await fly(page, 5);
    await expect(hud(page, 'time')).toHaveText(landedAt ?? '');
  });

  test('an emergency stop and a lost controller are shown as warnings', async ({ page }) => {
    await openHovering(page, 40);

    await fly(page, 0.1);
    await fly(page, 0.5, { connected: false });
    await expect(toasts(page)).toHaveText(['Controller connection lost · hovering']);
    await expect(toasts(page).first()).toHaveClass(/is-warning/);
    await fly(page, 0.5);
    await expect(toasts(page)).toHaveText(['Controller connected again']);
    await expect(toasts(page).first()).not.toHaveClass(/is-warning/);

    await fly(page, 2.2, STICK_COMMAND);
    await expect(toasts(page).last()).toHaveText('Emergency stop · motors cut');
    await expect(toasts(page).last()).toHaveClass(/is-warning/);
    expect(await hudNumber(page, 'climb')).toBeLessThan(0);

    await fly(page, 6);
    await expect(toasts(page).last()).toHaveText('The aircraft hit the ground');
    await expect(hud(page, 'height')).toHaveText('0.0');
  });

  test('putting the aircraft back at the start clears the display', async ({ page }) => {
    await openHovering(page, 20);
    await fly(page, 0.1);
    await fly(page, 3, { pitch: 1, mode: 'S' });
    await expect(toasts(page)).toHaveCount(1);
    expect(await hudNumber(page, 'distance')).toBeGreaterThan(20);

    await page.keyboard.press('Backspace');

    await expect(toasts(page)).toHaveCount(0);
    await expect(hud(page, 'distance')).toHaveText('–');
    await expect(hud(page, 'time')).toHaveText('00:00');
    await expect(hud(page, 'height')).toHaveText('0.0');
  });
});

test.describe('flight display (real time, keyboard)', () => {
  test('pressing T takes off, and the display counts up to hover height', async ({ page }) => {
    await open(page);
    await expect(hud(page, 'height')).toHaveText('0.0');

    await page.keyboard.press('KeyT');

    // On a slow machine the take-off may already be over when the message is read.
    await expect(toasts(page).last()).toHaveText(/^(Taking off|Take-off complete)/);
    await expect(hud(page, 'height')).toHaveText('1.2', { timeout: 20_000 });
    await expect(toasts(page).last()).toHaveText('Take-off complete · hovering at 1.2 m');
    await expect(hud(page, 'distance')).toHaveText('0');
    await expect(hud(page, 'time')).not.toHaveText('00:00', { timeout: 20_000 });
  });

  test('the number keys change the mode shown', async ({ page }) => {
    await open(page);

    await page.keyboard.press('Digit3');
    await expect(hud(page, 'mode')).toHaveText('Sport');
    await expect(toasts(page)).toHaveText(['Sport mode · up to 19 m/s']);

    await page.keyboard.press('Digit1');
    await expect(hud(page, 'mode')).toHaveText('Cine');
  });
});
