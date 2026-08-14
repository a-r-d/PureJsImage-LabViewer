import { expect, test } from '@playwright/test'
import { openSample, openWorkbench, waitForWorkbenchSettled } from './support/workbench.js'

test.beforeEach(async ({ page }) => {
  await openWorkbench(page)
})

test('@visual materials analysis inspector', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).click()
  await expect(page).toHaveScreenshot('workbench-materials-analysis.png', {
    animations: 'disabled',
  })
})

test('@visual empty workspace', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page).toHaveScreenshot('workbench-empty-scientific.png', { animations: 'disabled' })
})

test('@visual opened scientific workspace', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  await waitForWorkbenchSettled(page)
  await expect(page).toHaveScreenshot('workbench-opened-scientific.png', { animations: 'disabled' })
})

test('@visual display controls', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  await page.getByRole('tab', { name: 'Display' }).click()
  await waitForWorkbenchSettled(page)
  await expect(page).toHaveScreenshot('workbench-display-scientific.png', {
    animations: 'disabled',
  })
})

test('@visual agent panel state', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  await page.getByRole('button', { name: 'Show agent panel' }).click()
  await expect(page.getByTestId('agent-panel')).toBeVisible()
  await waitForWorkbenchSettled(page)
  await expect(page).toHaveScreenshot('workbench-agent-scientific.png', { animations: 'disabled' })
})
