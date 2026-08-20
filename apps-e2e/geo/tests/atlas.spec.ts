import { expect, type Page, test } from '@playwright/test'
import { dismissDemoPicker } from '../support/demo-picker.js'
import { mockKentuckyStac } from '../support/stac-mock.js'

const fixtureUrl = 'http://127.0.0.1:4175/north-up.tif'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const storageResetKey = '__pji_playwright_storage_reset__'
    if (window.sessionStorage.getItem(storageResetKey) === null) {
      window.localStorage.clear()
      window.sessionStorage.setItem(storageResetKey, 'true')
    }
  })
  await mockKentuckyStac(page)
  await page.goto('/')
  await expect(page.locator('[data-workbench-ready]')).toHaveAttribute(
    'data-workbench-ready',
    'true',
    { timeout: 30_000 },
  )
  await dismissDemoPicker(page)
})

async function openRemoteFixture(page: Page) {
  await page.getByRole('button', { name: 'Open URL' }).click()
  await page.getByLabel('HTTPS COG URL').fill(fixtureUrl)
  await page.getByRole('button', { name: 'Load' }).click()
  await expect(page.getByRole('img', { name: /Geo raster viewport/u })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.locator('[data-atlas-settled="true"]')).toBeVisible({ timeout: 45_000 })
}

test('opens a remote COG from a local range-capable fixture server', async ({ page }) => {
  test.setTimeout(60_000)
  await openRemoteFixture(page)
  const xray = page.getByTestId('cog-xray')
  await expect(xray).toBeVisible()
  await expect(xray.getByText('TIFF', { exact: true })).toBeVisible()
  await expect(xray.getByText('4 × 2')).toBeVisible()
  await expect(xray.getByText('EPSG 4326', { exact: false })).toBeVisible()
  const fetched = await xray
    .locator('dt', { hasText: 'Source fetched' })
    .locator('xpath=following-sibling::dd[1]')
    .textContent()
  expect(fetched).not.toBe('100.00%')
  const requests = await xray
    .locator('dt', { hasText: 'Range requests' })
    .locator('xpath=following-sibling::dd[1]')
    .textContent()
  expect(Number(requests)).toBeGreaterThan(0)
})

test('@visual atlas inspector and rendered raster', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openRemoteFixture(page)
  await page.evaluate(() => document.fonts.ready)
  const xray = page.getByTestId('cog-xray')
  await expect(page).toHaveScreenshot('atlas-inspector-raster.png', {
    animations: 'disabled',
    mask: [
      xray.locator('dt', { hasText: 'Range requests' }).locator('xpath=following-sibling::dd[1]'),
      xray.locator('dt', { hasText: 'Bytes fetched' }).locator('xpath=following-sibling::dd[1]'),
      xray.locator('dt', { hasText: 'Cache hits' }).locator('xpath=following-sibling::dd[1]'),
      xray.locator('dt', { hasText: 'Cache misses' }).locator('xpath=following-sibling::dd[1]'),
      xray.locator('dt', { hasText: 'Source fetched' }).locator('xpath=following-sibling::dd[1]'),
      page.locator('.status-bar'),
    ],
  })
})
