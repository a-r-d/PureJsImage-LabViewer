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
      pathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-linux{ext}',
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @pji-workbench/app preview --host 127.0.0.1 --port 4173',
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
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
