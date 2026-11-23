import { expect, type Page, test } from '@playwright/test';

/**
 * The reference test packet, the same bytes as in the RC Probe app's own test
 * (rc-probe/app/src/test/.../TestPacketTest.kt): counter 0x01020304, 5000 ms, sticks
 * left -660 / 660 and right 100 / -1, real stick values, no aircraft.
 */
const REFERENCE_PACKET = [
  0xa5, 0x01, 0x04, 0x03, 0x02, 0x01, 0x88, 0x13, 0x00, 0x00, 0x6c, 0xfd, 0x94, 0x02, 0x64, 0x00,
  0xff, 0xff, 0x01, 0x59,
];

const result = (page: Page, id: string) => page.locator(`#${id}`);

/** Puts a stand-in for a game controller into the page; the test moves it through `window.__pad`. */
async function addFakeGamepad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pad = {
      id: 'Test controller (fake)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 4 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    navigator.getGamepads = () => [pad as unknown as Gamepad];
  });
}

/**
 * Puts a stand-in for Web Bluetooth into the page. Choosing a device always succeeds, and
 * the test then delivers packets by calling `window.__sendPacket(bytes)`.
 */
async function addFakeBluetooth(page: Page, options: { fail?: boolean } = {}): Promise<void> {
  await page.addInitScript((fail) => {
    const characteristic = new EventTarget() as EventTarget & {
      value?: DataView;
      startNotifications?: () => Promise<unknown>;
    };
    characteristic.startNotifications = () => Promise.resolve(characteristic);
    const requested: unknown[] = [];
    const device = Object.assign(new EventTarget(), {
      name: 'Fake RC Probe',
      gatt: {
        connected: true,
        connect: () =>
          fail
            ? Promise.reject(new Error('Connection attempt failed.'))
            : Promise.resolve({
                getPrimaryService: () =>
                  Promise.resolve({ getCharacteristic: () => Promise.resolve(characteristic) }),
              }),
        disconnect: () => undefined,
      },
    });
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        requestDevice: (request: unknown) => {
          requested.push(request);
          return Promise.resolve(device);
        },
      },
    });
    const hooks = window as unknown as {
      __requested: unknown[];
      __sendPacket: (bytes: number[]) => void;
    };
    hooks.__requested = requested;
    hooks.__sendPacket = (bytes) => {
      characteristic.value = new DataView(new Uint8Array(bytes).buffer);
      characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    };
  }, options.fail ?? false);
}

/** Delivers `count` valid packets with rising counters, starting at `first`. */
async function sendPackets(page: Page, first: number, count: number): Promise<void> {
  await page.evaluate(
    ({ first, count }) => {
      const send = (window as unknown as { __sendPacket: (bytes: number[]) => void }).__sendPacket;
      for (let counter = first; counter < first + count; counter++) {
        const bytes = new Array<number>(20).fill(0);
        bytes[0] = 0xa5;
        bytes[1] = 1;
        bytes[2] = counter & 0xff;
        bytes[3] = (counter >> 8) & 0xff;
        bytes[19] = bytes.slice(0, 19).reduce((sum, byte) => sum ^ byte, 0);
        send(bytes);
      }
    },
    { first, count },
  );
}

test.describe('controller check page', () => {
  test('opens without errors and says what this browser can do', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/controller-check.html');

    await expect(page.locator('h1')).toHaveText('Controller check');
    await expect(page.locator('.safety')).toContainText('switch the aircraft OFF');
    await expect(result(page, 'has-gamepad')).toHaveText('supported');
    await expect(result(page, 'gamepad-result')).toHaveText('NOT SEEN SO FAR');
    await expect(result(page, 'gamepad-list')).toHaveText('No game controller seen so far.');
    await expect(result(page, 'bluetooth-result')).toHaveText('NOT RUN');
    await expect(result(page, 'report')).toContainText('GAME CONTROLLERS: none seen');
    await expect(page.locator('#download')).toHaveAttribute('href', 'rc-probe.apk');
    expect(errors).toEqual([]);
  });

  test('is reachable from the address next to the simulator', async ({ page }) => {
    await page.goto('/controller-check.html');
    await page.getByRole('link', { name: 'Back to the simulator' }).click();

    await expect(page.locator('canvas#view')).toBeVisible();
  });

  test('shows a game controller, and passes once its sticks are seen moving', async ({ page }) => {
    await addFakeGamepad(page);
    await page.goto('/controller-check.html');

    await expect(result(page, 'gamepad-result')).toContainText('CONTROLLER LISTED');
    await expect(result(page, 'gamepad-list')).toContainText('Test controller (fake)');
    await expect(result(page, 'gamepad-list')).toContainText('4 axes, 4 buttons');
    await expect(result(page, 'gamepad-list')).toContainText('sticks moved:  not yet');

    await page.evaluate(() => {
      const pad = (window as unknown as { __pad: { axes: number[] } }).__pad;
      pad.axes = [0.8, -0.5, 0, 0];
    });

    await expect(result(page, 'gamepad-result')).toHaveText('PASS · sticks seen moving');
    await expect(result(page, 'gamepad-list')).toContainText('0.80  -0.50');
    await expect(result(page, 'report')).toContainText(
      'GAME CONTROLLERS: Test controller (fake) - sticks moved: YES',
    );
  });

  test('lists the buttons that arrive as keys', async ({ page }) => {
    await page.goto('/controller-check.html');
    await expect(result(page, 'keys')).toHaveText('none');

    await page.keyboard.press('KeyC');
    await page.keyboard.press('Enter');
    await page.keyboard.press('KeyC');

    await expect(result(page, 'keys')).toHaveText('KeyC, Enter');
    await expect(result(page, 'report')).toContainText('KEYS RECEIVED: KeyC, Enter');
  });

  test('reads the reference packet of the RC Probe app', async ({ page }) => {
    await page.goto('/controller-check.html');

    const decoded = await page.evaluate((bytes) => {
      const check = (
        window as unknown as { __controllerCheck: { decodePacket: (view: DataView) => unknown } }
      ).__controllerCheck;
      const damaged = [...bytes];
      damaged[12] = (damaged[12] ?? 0) ^ 0x10;
      return {
        good: check.decodePacket(new DataView(new Uint8Array(bytes).buffer)),
        damaged: check.decodePacket(new DataView(new Uint8Array(damaged).buffer)),
        short: check.decodePacket(new DataView(new Uint8Array(bytes.slice(0, 19)).buffer)),
      };
    }, REFERENCE_PACKET);

    expect(decoded.good).toEqual({
      counter: 0x01020304,
      elapsedMs: 5000,
      leftX: -660,
      leftY: 660,
      rightX: 100,
      rightY: -1,
      sticksReal: true,
      aircraft: false,
    });
    expect(decoded.damaged).toBeNull();
    expect(decoded.short).toBeNull();
  });

  test('Bluetooth link test: connects, counts packets and notices missing ones', async ({
    page,
  }) => {
    await addFakeBluetooth(page);
    await page.goto('/controller-check.html');
    await expect(result(page, 'has-bluetooth')).toHaveText('supported');

    await page.locator('#connect').click();
    await expect(result(page, 'bluetooth-status')).toContainText(
      'State: connected (Fake RC Probe)',
    );
    await expect(result(page, 'bluetooth-result')).toContainText('LISTENING');
    // The page asks for the RC Probe test service, so only the controller is offered.
    expect(
      await page.evaluate(() => (window as unknown as { __requested: unknown[] }).__requested),
    ).toEqual([{ filters: [{ services: ['6a1e0001-7d0c-4b7a-9c53-a25c0de5ad01'] }] }]);

    await sendPackets(page, 0, 10);
    await sendPackets(page, 13, 5); // packets 10, 11 and 12 never arrive
    await page.evaluate((bytes) => {
      const hooks = window as unknown as { __sendPacket: (bytes: number[]) => void };
      hooks.__sendPacket([...bytes.slice(0, 19), 0x00]); // wrong check byte
    }, REFERENCE_PACKET);

    await expect(result(page, 'bluetooth-status')).toContainText(
      'Packets received: 15, missed: 3, damaged: 1',
    );
    await expect(result(page, 'bluetooth-status')).toContainText('no stick values in the packets');
    await expect(page.locator('#connect')).toBeDisabled();
    await expect(page.locator('#disconnect')).toBeEnabled();
  });

  test('Bluetooth link test: shows real stick values and warns about an aircraft', async ({
    page,
  }) => {
    await addFakeBluetooth(page);
    await page.goto('/controller-check.html');
    await page.locator('#connect').click();
    await expect(result(page, 'bluetooth-status')).toContainText('State: connected');

    await page.evaluate((bytes) => {
      const hooks = window as unknown as { __sendPacket: (bytes: number[]) => void };
      hooks.__sendPacket(bytes);
      const withAircraft = [...bytes];
      withAircraft[2] = (withAircraft[2] ?? 0) + 1; // next counter
      withAircraft[18] = 0x03; // real sticks, and an aircraft is connected
      withAircraft[19] = withAircraft.slice(0, 19).reduce((sum, byte) => sum ^ byte, 0);
      hooks.__sendPacket(withAircraft);
    }, REFERENCE_PACKET);

    await expect(result(page, 'bluetooth-status')).toContainText(
      'Sticks: left -660 / 660, right 100 / -1 (real values',
    );
    await expect(result(page, 'bluetooth-status')).toContainText('AN AIRCRAFT IS CONNECTED');
    await expect(result(page, 'report')).toContainText('AN AIRCRAFT IS CONNECTED');
  });

  test('Bluetooth link test: passes at 50 packets per second, fails when too slow', async ({
    page,
  }) => {
    await addFakeBluetooth(page);
    await page.clock.install();
    await page.goto('/controller-check.html');
    await page.locator('#connect').click();
    await expect(result(page, 'bluetooth-status')).toContainText('State: connected');

    // Six seconds at 50 packets per second, on the page's own clock.
    let counter = 0;
    for (let tick = 0; tick < 60; tick++) {
      await sendPackets(page, counter, 5);
      counter += 5;
      await page.clock.runFor(100);
    }
    await expect(result(page, 'bluetooth-result')).toHaveText('PASS · 50 packets per second');

    // Then only 10 packets per second.
    for (let tick = 0; tick < 30; tick++) {
      await sendPackets(page, counter, 1);
      counter += 1;
      await page.clock.runFor(100);
    }
    await expect(result(page, 'bluetooth-result')).toHaveText('TOO SLOW · 10 packets per second');
    await expect(result(page, 'report')).toContainText('BLUETOOTH LINK: TOO SLOW');
  });

  test('Bluetooth link test: a failed connection is reported with its reason', async ({ page }) => {
    await addFakeBluetooth(page, { fail: true });
    await page.goto('/controller-check.html');

    await page.locator('#connect').click();

    await expect(result(page, 'bluetooth-result')).toHaveText('FAIL · could not connect');
    await expect(result(page, 'bluetooth-status')).toContainText(
      'Problem: Connection attempt failed.',
    );
    await expect(page.locator('#connect')).toBeEnabled();
  });

  test('without Web Bluetooth the link test says where to run it', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: undefined });
    });
    await page.goto('/controller-check.html');

    await expect(result(page, 'has-bluetooth')).toContainText('NOT supported here');
    await expect(page.locator('#connect')).toBeDisabled();
    await expect(result(page, 'bluetooth-note')).toContainText('Chrome or Edge on the PC');
  });
});
