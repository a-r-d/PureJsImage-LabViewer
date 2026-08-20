import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './apps-e2e/science/agent-evals',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 12 * 60_000,
  outputDir: '.local/agent-evals/playwright',
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    locale: 'en-US',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command:
      'corepack pnpm --filter @pji-workbench/science build && corepack pnpm --filter @pji-workbench/science preview --host 127.0.0.1 --port 4173',
    env: {
      MINIFLARE_REGISTRY_PATH: '.wrangler/agent-eval-registry',
      VITE_APP_ENV: 'test',
      WRANGLER_LOG_PATH: '.wrangler/agent-eval.log',
      WRANGLER_SEND_METRICS: 'false',
    },
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } }],
})
