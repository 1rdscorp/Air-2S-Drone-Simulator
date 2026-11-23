import { expect, type Page, test } from '@playwright/test';

/** Opens the app with the given address settings and waits for the first drawn frame. */
async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-sim-ready', 'true', {
    timeout: 20_000,
  });
}

/** The names browsers give the devices: Firefox style, as in the owner's report. */
const STICK = '4098-bea8-WINCTRL Orion Joystick Base Metal 2 + JGRIP-F16';
const THROTTLE = '4098-be62-WINCTRL Orion Throttle Base II + F15EX HANDLE';

interface FakeDevice {
  connected: boolean;
  id: string;
  index: number;
  mapping: string;
  timestamp: number;
  axes: number[];
  buttons: { pressed: boolean; touched: boolean; value: number }[];
}

/**
 * Replaces the browser's device list with made-up flight devices that the test moves.
 * They have no standard layout, like a real flight stick. No hardware is involved.
 *
 * The stick has eight axes: 0 and 1 are the stick itself, 2 and 3 a small thumb stick,
 * and axis 6 rests at one end, as an unused slider does.
 */
async function installFlightDevices(
  page: Page,
  options: { throttle?: boolean; standardPad?: boolean } = {},
): Promise<void> {
  await page.addInitScript(
    ({ stickId, throttleId, withThrottle, withPad }) => {
      const make = (id: string, index: number, axes: number[], mapping = ''): FakeDevice => ({
        connected: true,
        id,
        index,
        mapping,
        timestamp: 0,
        axes,
        buttons: Array.from({ length: 32 }, () => ({ pressed: false, touched: false, value: 0 })),
      });
      const devices: Record<string, FakeDevice> = {
        stick: make(stickId, 0, [0, 0, 0, 0, 0, 0, -1, 0]),
      };
      if (withThrottle) {
        // The lever rests pulled back, at one end of its travel.
        devices.throttle = make(throttleId, 1, [-1, 0, 0]);
      }
      if (withPad) {
        devices.pad = make('Test Pad (STANDARD GAMEPAD)', 2, [0, 0, 0, 0], 'standard');
      }
      (window as unknown as { __devices: typeof devices }).__devices = devices;
      navigator.getGamepads = () =>
        Object.values(devices).map((device) =>
          device.connected ? (device as unknown as Gamepad) : null,
        );
    },
    {
      stickId: STICK,
      throttleId: THROTTLE,
      withThrottle: options.throttle ?? false,
      withPad: options.standardPad ?? false,
    },
  );
}

interface Change {
  axes?: Record<number, number>;
  press?: number[];
  connected?: boolean;
}

/** Moves a made-up device: sets axes, holds exactly the given buttons, plugs or unplugs it. */
const move = (page: Page, name: 'stick' | 'throttle' | 'pad', change: Change) =>
  page.evaluate(
    ({ device, next }) => {
      const target = (window as unknown as { __devices: Record<string, FakeDevice> }).__devices[
        device
      ];
      if (!target) throw new Error(`no device called ${device}`);
      for (const [axis, value] of Object.entries(next.axes ?? {})) {
        target.axes[Number(axis)] = value;
      }
      if (next.press) {
        target.buttons.forEach((button, index) => {
          button.pressed = next.press?.includes(index) ?? false;
          button.value = button.pressed ? 1 : 0;
        });
      }
      if (next.connected !== undefined) {
        target.connected = next.connected;
      }
    },
    { device: name, next: change },
  );

const joystick = (page: Page) => page.evaluate(() => window.__sim?.getJoystick());
const input = (page: Page) => page.evaluate(() => window.__sim?.getInput());
const phase = (page: Page) => page.evaluate(() => window.__sim?.getState().phase);
const label = (page: Page) => page.locator('#stick-label');
const setup = (page: Page) => page.locator('#joystick-setup');
const setupText = (page: Page, name: string) =>
  page.locator(`#joystick-setup [data-setup="${name}"]`);

/** Waits until the setup asks the question with this title. */
async function asked(page: Page, title: string): Promise<void> {
  await expect(setupText(page, 'title')).toHaveText(title, { timeout: 15_000 });
  await expect(setup(page)).toHaveAttribute('data-phase', 'waiting', { timeout: 15_000 });
}

/** Answers the question `title` by moving a control, holds it until it is taken, lets go. */
async function answer(
  page: Page,
  title: string,
  device: 'stick' | 'throttle',
  change: Change,
  release: Change | null,
): Promise<void> {
  await asked(page, title);
  await move(page, device, change);
  await expect(setupText(page, 'title')).not.toHaveText(title, { timeout: 15_000 });
  if (release) {
    await move(page, device, release);
  }
}

/** Skips the question `title`. */
async function skip(page: Page, title: string): Promise<void> {
  await asked(page, title);
  await page.keyboard.press('Enter');
}

test.describe('flight stick, before it is set up', () => {
  test('is found, and says how to set it up', async ({ page }) => {
    await installFlightDevices(page);
    await open(page);

    await expect(label(page)).toHaveText('Flight stick found · press J to set it up');
    expect(await joystick(page)).toMatchObject({
      status: 'needsSetup',
      mapping: null,
      devices: [STICK],
      setupOpen: false,
    });
  });

  test('flies left / right and forward / back, and nothing else moves the aircraft', async ({
    page,
  }) => {
    await installFlightDevices(page);
    await open(page, '?expo=0');

    await move(page, 'stick', { axes: { 0: 1, 1: -1 } });
    await expect.poll(async () => (await input(page))?.source).toBe('joystick');
    expect((await input(page))?.frame).toMatchObject({ roll: 1, pitch: 1, yaw: 0, throttle: 0 });

    // Every other axis at an end stop: read as a game controller this would spin and climb.
    await move(page, 'stick', { axes: { 0: 0, 1: 0, 2: 1, 3: -1, 4: 1, 5: -1, 6: -1, 7: 1 } });
    await expect.poll(async () => (await input(page))?.frame.roll).toBe(0);
    expect((await input(page))?.frame).toMatchObject({
      roll: 0,
      pitch: 0,
      yaw: 0,
      throttle: 0,
      gimbal: 0,
    });
  });

  test('the keyboard climbs and turns while the stick flies', async ({ page }) => {
    await installFlightDevices(page);
    await open(page, '?expo=0');

    // Right hand on the stick, left hand on W and D.
    await move(page, 'stick', { axes: { 1: -1 } });
    await expect.poll(async () => (await input(page))?.source).toBe('joystick');
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');

    await expect.poll(async () => (await input(page))?.frame.throttle).toBe(1);
    expect((await input(page))?.frame).toMatchObject({ pitch: 1, yaw: 1, roll: 0 });

    // The other way round: the keyboard first, then the stick.
    await move(page, 'stick', { axes: { 1: 0 } });
    await expect.poll(async () => (await input(page))?.frame.pitch).toBe(0);
    await move(page, 'stick', { axes: { 0: 1 } });
    await expect.poll(async () => (await input(page))?.frame.roll).toBe(1);
    expect((await input(page))?.frame).toMatchObject({ throttle: 1, yaw: 1 });

    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyD');
  });

  test('the keyboard takes off while the stick is held', async ({ page }) => {
    await installFlightDevices(page);
    await open(page);
    await expect(page.locator('#flight-status')).toContainText('press T to take off');

    await move(page, 'stick', { axes: { 1: -1 } });
    await expect.poll(async () => (await input(page))?.source).toBe('joystick');
    await page.keyboard.press('KeyT');

    await expect.poll(() => phase(page)).not.toBe('motorsOff');
    expect((await input(page))?.source).toBe('joystick');
  });

  test('is not mistaken for a game controller, and a real one still works', async ({ page }) => {
    await installFlightDevices(page, { standardPad: true });
    await open(page, '?expo=0');

    expect((await joystick(page))?.devices).toEqual([STICK]);

    await move(page, 'pad', { axes: { 0: 1 } });
    await expect.poll(async () => (await input(page))?.source).toBe('gamepad');
    expect((await input(page))?.frame.yaw).toBe(1); // left stick right, in stick mode 2
  });
});

test.describe('flight stick setup', () => {
  test('asks for each control, saves the answers, and the stick then flies', async ({ page }) => {
    await installFlightDevices(page);
    await open(page, '?expo=0');

    await page.keyboard.press('KeyJ');
    await expect(setup(page)).toBeVisible();
    await expect(setupText(page, 'devices')).toContainText(
      'WINCTRL Orion Joystick Base Metal 2 + JGRIP-F16',
    );
    expect((await joystick(page))?.setupOpen).toBe(true);
    // Nothing flies while the setup is open.
    expect(await page.evaluate(() => window.__sim?.paused)).toBe(true);

    await answer(page, 'Fly right', 'stick', { axes: { 0: 1 } }, { axes: { 0: 0 } });
    await expect(setupText(page, 'note')).toHaveText('Got it. Fly right: axis 1');
    await answer(page, 'Fly forward', 'stick', { axes: { 1: -1 } }, { axes: { 1: 0 } });
    // The small thumb stick on the grip: right to turn, up to climb.
    await answer(page, 'Turn right', 'stick', { axes: { 2: 1 } }, { axes: { 2: 0 } });
    await answer(page, 'Climb', 'stick', { axes: { 3: -1 } }, { axes: { 3: 0 } });
    await skip(page, 'Camera up');
    await answer(page, 'Take off and land', 'stick', { press: [4] }, { press: [] });
    await skip(page, 'Flight pause');
    await skip(page, 'Camera level');
    await skip(page, 'Camera straight down');
    await skip(page, 'Cine mode');
    await skip(page, 'Normal mode');
    await answer(page, 'Sport mode', 'stick', { press: [9] }, { press: [] });

    await expect(setup(page)).toHaveAttribute('data-phase', 'summary', { timeout: 15_000 });
    const summary = setupText(page, 'note');
    await expect(summary).toContainText('Fly right: axis 1');
    await expect(summary).toContainText('Fly forward: axis 2 (reversed)');
    await expect(summary).toContainText('Turn right: axis 3');
    await expect(summary).toContainText('Climb: axis 4 (reversed)');
    await expect(summary).toContainText('Camera up: not set');
    await expect(summary).toContainText('Take off and land: button 5');
    await expect(summary).toContainText('springs back to its middle by itself');

    await page.keyboard.press('Enter');
    await expect(setup(page)).toBeHidden();
    await expect(label(page)).toHaveText('Flight stick ready · J to change');
    expect(await page.evaluate(() => window.__sim?.paused)).toBe(false);
    expect(await joystick(page)).toMatchObject({
      status: 'ready',
      setupOpen: false,
      mapping: {
        axes: {
          roll: { device: STICK, axis: 0, invert: false, lever: false },
          pitch: { device: STICK, axis: 1, invert: true, lever: false },
          yaw: { device: STICK, axis: 2, invert: false, lever: false },
          throttle: { device: STICK, axis: 3, invert: true, lever: false },
        },
        buttons: {
          takeoffLand: { device: STICK, button: 4 },
          modeS: { device: STICK, button: 9 },
        },
      },
    });

    // Now everything is on the stick: take off with its button, turn and climb with its
    // thumb stick, change the mode with another button.
    await expect(page.locator('#flight-status')).toContainText('press the take-off button');
    await move(page, 'stick', { press: [4] });
    await expect.poll(() => phase(page)).not.toBe('motorsOff');
    await move(page, 'stick', { press: [9], axes: { 2: 1, 3: -1 } });
    await expect.poll(async () => (await input(page))?.frame.mode).toBe('S');
    expect((await input(page))?.frame).toMatchObject({ yaw: 1, throttle: 1, roll: 0, pitch: 0 });
    expect((await input(page))?.source).toBe('joystick');
    await expect(page.locator('#stick-monitor .sm-status')).toHaveText('Flight stick · Sport');
  });

  test('the setup is remembered the next time the page is opened', async ({ page }) => {
    await installFlightDevices(page);
    await open(page, '?expo=0');
    await page.keyboard.press('KeyJ');
    await answer(page, 'Fly right', 'stick', { axes: { 0: -1 } }, { axes: { 0: 0 } });
    await skip(page, 'Fly forward');
    await answer(page, 'Turn right', 'stick', { axes: { 5: 1 } }, { axes: { 5: 0 } });
    for (const title of ['Climb', 'Camera up', 'Take off and land', 'Flight pause']) {
      await skip(page, title);
    }
    for (const title of ['Camera level', 'Camera straight down', 'Cine mode', 'Normal mode']) {
      await skip(page, title);
    }
    await skip(page, 'Sport mode');
    await expect(setup(page)).toHaveAttribute('data-phase', 'summary', { timeout: 15_000 });
    await page.locator('[data-setup="skip"]').click(); // the Save button
    await expect(label(page)).toHaveText('Flight stick ready · J to change');

    await open(page, '?expo=0');

    await expect(label(page)).toHaveText('Flight stick ready · J to change');
    // This stick reports "right" as negative, which the setup noticed.
    await move(page, 'stick', { axes: { 0: -1, 5: 0.5 } });
    await expect.poll(async () => (await input(page))?.frame.roll).toBe(1);
    expect((await input(page))?.frame.yaw).toBeCloseTo(0.5, 1);
  });

  test('Esc closes it without changing anything, and keys do not reach the aircraft', async ({
    page,
  }) => {
    await installFlightDevices(page);
    await open(page);

    await label(page).click(); // the label opens the setup as well
    await expect(setup(page)).toBeVisible();
    await answer(page, 'Fly right', 'stick', { axes: { 0: 1 } }, { axes: { 0: 0 } });

    await page.keyboard.press('KeyT'); // would take off
    await page.keyboard.press('Digit3'); // would switch to Sport
    await page.keyboard.press('Escape');

    await expect(setup(page)).toBeHidden();
    expect(await joystick(page)).toMatchObject({ status: 'needsSetup', mapping: null });
    expect(await phase(page)).toBe('motorsOff');
    expect((await input(page))?.frame.mode).toBe('N');
    expect(await page.evaluate(() => window.__sim?.paused)).toBe(false);
  });

  test('Backspace goes back one question', async ({ page }) => {
    await installFlightDevices(page);
    await open(page);
    await page.keyboard.press('KeyJ');
    await answer(page, 'Fly right', 'stick', { axes: { 0: 1 } }, { axes: { 0: 0 } });
    await asked(page, 'Fly forward');

    await page.keyboard.press('Backspace');

    await asked(page, 'Fly right');
    await expect(setupText(page, 'note')).toHaveText('');
  });

  test('stays paused afterwards when the simulation was paused before', async ({ page }) => {
    await installFlightDevices(page);
    await open(page, '?paused=1');

    await page.keyboard.press('KeyJ');
    await expect(setup(page)).toBeVisible();
    await page.keyboard.press('Escape');

    expect(await page.evaluate(() => window.__sim?.paused)).toBe(true);
  });

  test('without a flight stick it says how to make one appear', async ({ page }) => {
    await open(page);
    await expect(label(page)).toBeHidden();

    await page.keyboard.press('KeyJ');

    await expect(setupText(page, 'title')).toHaveText('No flight stick found');
    await expect(setupText(page, 'ask')).toContainText('press any button on it');
  });
});

test.describe('stick and throttle together', () => {
  test('a throttle lever is recognised and gets a middle that holds the height', async ({
    page,
  }) => {
    await installFlightDevices(page, { throttle: true });
    await open(page, '?expo=0');
    expect((await joystick(page))?.devices).toEqual([STICK, THROTTLE]);

    await page.keyboard.press('KeyJ');
    await answer(page, 'Fly right', 'stick', { axes: { 0: 1 } }, { axes: { 0: 0 } });
    await answer(page, 'Fly forward', 'stick', { axes: { 1: -1 } }, { axes: { 1: 0 } });
    await skip(page, 'Turn right');
    // The lever is pushed forward and stays there.
    await answer(page, 'Climb', 'throttle', { axes: { 0: 1 } }, null);
    for (const title of ['Camera up', 'Take off and land', 'Flight pause', 'Camera level']) {
      await skip(page, title);
    }
    for (const title of ['Camera straight down', 'Cine mode', 'Normal mode', 'Sport mode']) {
      await skip(page, title);
    }

    await expect(setup(page)).toHaveAttribute('data-phase', 'summary', { timeout: 15_000 });
    await expect(setupText(page, 'note')).toContainText(
      'Climb: WINCTRL Orion Throttle Base II + F15EX HANDLE · axis 1 (lever)',
    );
    await expect(setupText(page, 'note')).toContainText('is a lever that stays where it is put');
    await page.keyboard.press('Enter');
    await expect(label(page)).toHaveText('Flight stick ready · J to change');

    // Lever fully forward climbs, in the middle holds, pulled back descends.
    await move(page, 'stick', { axes: { 1: -1 } });
    await expect.poll(async () => (await input(page))?.source).toBe('joystick');
    await expect.poll(async () => (await input(page))?.frame.throttle).toBe(1);
    await move(page, 'throttle', { axes: { 0: 0.1 } });
    await expect.poll(async () => (await input(page))?.frame.throttle).toBe(0);
    await move(page, 'throttle', { axes: { 0: -1 } });
    await expect.poll(async () => (await input(page))?.frame.throttle).toBe(-1);

    // Unplugging one of the two stops the setup from flying at all.
    await move(page, 'throttle', { connected: false });
    await expect(label(page)).toHaveText('Flight stick not plugged in · J to set up again');
    await expect.poll(async () => (await input(page))?.frame.connected).toBe(false);
    expect((await input(page))?.frame).toMatchObject({ pitch: 0, throttle: 0 });
  });
});
