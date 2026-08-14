import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('opens the root workbench route', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Materials Workbench')
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Materials Workbench' })).toBeVisible()
  await expect(page.getByText('Local files will be processed in this browser')).toBeVisible()
})

test('@a11y exposes a violation-free bootstrap landmark', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter(
    ({ impact }) => impact === 'critical' || impact === 'serious',
  )
  expect(blocking).toEqual([])
})

test('@visual preserves the deterministic workbench surface', async ({ page }) => {
  await page.goto('/')
  const panel = page.locator('.workbench__panel')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveCSS('border-top-style', 'solid')
  await expect(page.getByText('Bootstrap ready')).toBeVisible()
})

test('@performance reaches an interactive shell within the warm budget', async ({ page }) => {
  await page.goto('/')
  const interactiveMilliseconds = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0]
    return navigation instanceof PerformanceNavigationTiming
      ? navigation.domInteractive
      : Number.POSITIVE_INFINITY
  })
  expect(interactiveMilliseconds).toBeLessThan(1_000)
})
