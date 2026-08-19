import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

async function openUiLab(page: Page, theme: 'dark' | 'light' = 'dark'): Promise<void> {
  await page.goto(`/__ui-lab?theme=${theme}`)
  const lab = page.locator('[data-workbench-ready]')
  await expect(lab).toHaveAttribute('data-workbench-ready', 'true')
  await expect(lab).toHaveAttribute('data-render-settled', 'true')
  await expect(lab).toHaveAttribute('data-analysis-settled', 'true')
  await page.evaluate(() => document.fonts.ready)
}

test('exposes deterministic design-system states without persistence or source data', async ({
  page,
}) => {
  await openUiLab(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PureJsImage Lab · UI system V2')
  await expect(page.getByRole('button', { name: 'Primary action' })).toBeVisible()
  await expect(page.getByRole('separator', { name: 'UI lab splitter' })).toBeVisible()
  await expect(
    page.getByRole('img', { name: 'Deterministic particle-size distribution' }),
  ).toBeVisible()
  await expect(page.getByText('Approval required', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => ({ ...window.localStorage }))).toEqual({})
})

test('@a11y UI lab has no serious violations in dark and light themes', async ({ page }) => {
  for (const theme of ['dark', 'light'] as const) {
    await openUiLab(page, theme)
    const results = await new AxeBuilder({ page }).analyze()
    expect(
      results.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
    ).toEqual([])
  }
})

test('@visual UI lab dark wide', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openUiLab(page, 'dark')
  await expect(page).toHaveScreenshot('ui-lab-dark-wide.png', { animations: 'disabled' })
})

test('@visual UI lab light wide', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openUiLab(page, 'light')
  await expect(page).toHaveScreenshot('ui-lab-light-wide.png', { animations: 'disabled' })
})

test('@visual UI lab dark narrow', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 960, height: 720 })
  await openUiLab(page, 'dark')
  await expect(page).toHaveScreenshot('ui-lab-dark-narrow.png', {
    animations: 'disabled',
    fullPage: true,
  })
})
