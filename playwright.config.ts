import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './apps-e2e/workbench/tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  updateSnapshots: 'none',
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]]
    : [['list'], ['html', { open: 'never' }]],
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.015,
      pathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-{platform}{ext}',
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    locale: 'en-US',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command:
      'corepack pnpm --filter @pji-workbench/app build && corepack pnpm --filter @pji-workbench/app preview --host 127.0.0.1 --port 4173',
    env: {
      MINIFLARE_REGISTRY_PATH: '.wrangler/playwright-registry',
      VITE_APP_ENV: 'test',
      WRANGLER_LOG_PATH: '.wrangler/playwright.log',
      WRANGLER_SEND_METRICS: 'false',
    },
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], deviceScaleFactor: 1 } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], deviceScaleFactor: 1 } },
  ],
})
