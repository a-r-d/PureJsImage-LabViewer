import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './apps-e2e/geo/tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  updateSnapshots: 'none',
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  outputDir: 'test-results/geo',
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report-geo' }],
        ['json', { outputFile: 'test-results/geo/results.json' }],
      ]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-geo' }]],
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.015,
      pathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-{platform}{ext}',
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:4174',
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    locale: 'en-US',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  webServer: [
    {
      command:
        'corepack pnpm --filter @pji-workbench/geo build && corepack pnpm --filter @pji-workbench/geo preview --host 127.0.0.1 --port 4174',
      env: {
        MINIFLARE_REGISTRY_PATH: '.wrangler/playwright-geo-registry',
        VITE_APP_ENV: 'test',
        WRANGLER_LOG_PATH: '.wrangler/playwright-geo.log',
        WRANGLER_SEND_METRICS: 'false',
      },
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node apps-e2e/geo/range-server.mjs',
      url: 'http://127.0.0.1:4175/health',
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], deviceScaleFactor: 1 } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], deviceScaleFactor: 1 } },
  ],
})
