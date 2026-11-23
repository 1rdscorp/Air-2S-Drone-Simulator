import { expect, type Page, test } from '@playwright/test';

/** Opens the app with the given address settings and waits for the first drawn frame. */
async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-sim-ready', 'true', {
    timeout: 20_000,
  });
}

const audio = (page: Page) => page.evaluate(() => window.__sim?.getAudio());
const label = (page: Page) => page.locator('#sound-label');

/**
 * Browsers allow sound only after a key press or a click. Shift does nothing else in the
 * simulator, so it only starts the sound.
 */
async function allowSound(page: Page): Promise<void> {
  await page.keyboard.press('ShiftLeft');
  await expect.poll(async () => (await audio(page))?.state).toBe('running');
}

interface Controls {
  roll?: number;
  pitch?: number;
  yaw?: number;
  throttle?: number;
  mode?: 'C' | 'N' | 'S';
}

/** Flies for `seconds` of simulated time with the controls held as given, then reads the sound. */
const fly = (page: Page, seconds: number, controls: Controls = {}) =>
  page.evaluate(
    ({ ticks, script }) => {
      window.__sim?.setControls(script);
      window.__sim?.step(ticks);
      return window.__sim?.getAudio();
    },
    { ticks: Math.round(seconds * 120), script: controls },
  );

/** The note of the motors in a hover: two blades at 5900 turns per minute. */
const HOVER_NOTE = 196.7;

test.describe('sound (what the simulator asks for)', () => {
  test('waits for the first key press, and says so', async ({ page }) => {
    await open(page);

    expect((await audio(page))?.state).toBe('waiting');
    await expect(label(page)).toHaveText('Sound starts with your first key press or click');

    await allowSound(page);

    await expect(label(page)).toHaveText('Sound on · M to mute');
    expect((await audio(page))?.muted).toBe(false);
    expect((await audio(page))?.volume).toBe(0.7);
  });

  test('a click starts the sound as well', async ({ page }) => {
    await open(page);

    await page.mouse.click(640, 360);

    await expect.poll(async () => (await audio(page))?.state).toBe('running');
  });

  test('the motor note follows the thrust', async ({ page }) => {
    await open(page, '?paused=1');
    await page.evaluate(() => window.__sim?.reset({ height: 40 }));

    const hover = await fly(page, 0.5);
    expect(hover?.motorRunning).toBe(true);
    expect(hover?.motorFrequency).toBeCloseTo(HOVER_NOTE, 0);
    expect(hover?.motorGain).toBeCloseTo(0.7, 1);
    expect(hover?.airGain).toBe(0);

    const climbing = await fly(page, 2, { throttle: 1 });
    expect(climbing?.motorFrequency).toBeGreaterThan(HOVER_NOTE + 15);

    const descending = await fly(page, 3, { throttle: -1 });
    expect(descending?.motorFrequency).toBeLessThan(HOVER_NOTE - 15);

    await fly(page, 3);
    const fast = await fly(page, 6, { pitch: 1, mode: 'S' });
    expect(fast?.motorFrequency).toBeGreaterThan(HOVER_NOTE + 15);
    expect(fast?.airGain).toBeGreaterThan(0.4);
  });

  test('the motors start, idle and stop with the flight', async ({ page }) => {
    await open(page, '?paused=1');
    const stickCommand = { throttle: -1, yaw: 1, pitch: -1, roll: -1 };

    expect((await fly(page, 0.2))?.motorRunning).toBe(false);

    // Motors started with the stick command: a low idle note.
    const idle = await fly(page, 0.4, stickCommand);
    expect(idle?.motorRunning).toBe(true);
    expect(idle?.motorFrequency).toBeCloseTo(73.3, 0);
    expect(idle?.motorGain).toBeLessThan(0.3);

    // Let go, then the same command again stops them.
    await fly(page, 0.3);
    const stopped = await fly(page, 0.4, stickCommand);
    expect(stopped?.motorRunning).toBe(false);
    expect(stopped?.motorGain).toBe(0);
  });

  test('the aircraft is quieter from farther away, and loudest from its own camera', async ({
    page,
  }) => {
    await open(page, '?paused=1&camera=free');
    await page.evaluate(() => window.__sim?.reset({ height: 30 }));
    const near = (await fly(page, 0.2))?.motorGain ?? 0;

    // Move the free camera well away from the aircraft.
    await page.mouse.move(640, 360);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 600);
    }
    const far = (await fly(page, 0.1))?.motorGain ?? 0;
    expect(far).toBeLessThan(near * 0.6);

    await page.evaluate(() => window.__sim?.setCamera('fpv'));
    const onboard = (await fly(page, 0.1))?.motorGain ?? 0;
    expect(onboard).toBeCloseTo(0.7, 1);
    expect(onboard).toBeGreaterThan(far);
  });

  test('M switches the sound off and on, and the address can start it off', async ({ page }) => {
    await open(page, '?sound=0&volume=0.4');
    await allowSound(page);

    expect(await audio(page)).toMatchObject({ muted: true, silenced: true, volume: 0.4 });
    await expect(label(page)).toHaveText('Sound off · M to switch on');

    await page.keyboard.press('KeyM');
    expect(await audio(page)).toMatchObject({ muted: false, silenced: false });
    await expect(label(page)).toHaveText('Sound on · M to mute');

    await page.keyboard.press('KeyM');
    expect((await audio(page))?.muted).toBe(true);
  });
});

test.describe('sound (what really comes out, in real time)', () => {
  test('the hover is heard at the motor note, and M and pause silence it', async ({ page }) => {
    await open(page);
    await allowSound(page);
    await page.keyboard.press('KeyT');
    await expect
      .poll(async () => page.evaluate(() => window.__sim?.getState().phase), { timeout: 20_000 })
      .toBe('flying');

    // Sound really comes out, and its strongest note is the motors' note.
    await expect
      .poll(async () => (await audio(page))?.level, { timeout: 15_000 })
      .toBeGreaterThan(0.02);
    await expect
      .poll(async () => Math.abs(((await audio(page))?.peakFrequency ?? 0) - HOVER_NOTE), {
        timeout: 15_000,
      })
      .toBeLessThan(12);

    await page.keyboard.press('KeyM');
    await expect
      .poll(async () => (await audio(page))?.level, { timeout: 10_000 })
      .toBeLessThan(0.001);

    await page.keyboard.press('KeyM');
    await expect
      .poll(async () => (await audio(page))?.level, { timeout: 10_000 })
      .toBeGreaterThan(0.02);

    await page.keyboard.press('KeyP');
    expect((await audio(page))?.silenced).toBe(true);
    await expect
      .poll(async () => (await audio(page))?.level, { timeout: 10_000 })
      .toBeLessThan(0.001);
  });

  test('tones mark the take-off and a change of mode', async ({ page }) => {
    await open(page);
    await allowSound(page);
    expect((await audio(page))?.tonesPlayed).toEqual([]);

    await page.keyboard.press('KeyT');
    await expect.poll(async () => (await audio(page))?.tonesPlayed).toContain('takeoffStarted');
    await expect
      .poll(async () => (await audio(page))?.tonesPlayed, { timeout: 20_000 })
      .toContain('takeoffComplete');

    await page.keyboard.press('Digit3');
    await expect.poll(async () => (await audio(page))?.tonesPlayed).toContain('modeS');
  });

  test('no tones are played while the sound is off', async ({ page }) => {
    await open(page, '?sound=0');
    await allowSound(page);

    await page.keyboard.press('KeyT');
    await expect
      .poll(async () => page.evaluate(() => window.__sim?.getState().phase), { timeout: 20_000 })
      .toBe('flying');

    expect((await audio(page))?.tonesPlayed).toEqual([]);
    expect((await audio(page))?.level).toBeLessThan(0.001);
  });
});
