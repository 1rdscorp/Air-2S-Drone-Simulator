import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  expect: {
    // Picture comparisons: allow the small differences one machine's software renderer
    // may have from another's, but not a view that has really changed.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        launchOptions: {
          // Set PW_CHROMIUM_PATH to use a browser that is already installed
          // instead of the one downloaded by "playwright install".
          executablePath: process.env.PW_CHROMIUM_PATH ?? undefined,
          // Headless machines have no GPU; draw WebGL in software.
          args: ['--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  // The smoke test runs against the production build, the same files that get deployed.
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
