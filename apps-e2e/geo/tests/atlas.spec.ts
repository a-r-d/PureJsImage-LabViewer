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

test('supports keyboard navigation, swipe adjustment, and blink timing', async ({ page }) => {
  test.setTimeout(60_000)
  await openRemoteFixture(page)
  await page.getByRole('button', { name: 'Open URL' }).click()
  await page.getByLabel('HTTPS COG URL').fill('http://127.0.0.1:4175/north-up-later.tif')
  await page.getByRole('button', { name: 'Load' }).click()

  const viewport = page.getByRole('img', { name: /Geo raster viewport/u })
  await expect(page.getByRole('button', { name: 'Swipe' })).toBeVisible()
  await page.getByRole('button', { name: 'Swipe' }).click()
  await expect(viewport).toHaveAttribute('data-comparison-mode', 'swipe')
  await expect(viewport).toHaveAttribute('data-swipe-position', '0.5')

  await viewport.focus()
  await viewport.press('Shift+ArrowRight')
  await expect(viewport).toHaveAttribute('data-swipe-position', '0.52')
  await viewport.press('ArrowLeft')
  await viewport.press('+')
  await viewport.press('0')
  await viewport.press('f')
  await viewport.press('1')

  await page.getByLabel('Blink interval').selectOption('250')
  await page.getByRole('button', { name: 'Blink' }).click()
  await expect(viewport).toHaveAttribute('data-comparison-mode', 'blink')
  await expect(page.locator('[data-atlas-settled="true"]')).toBeVisible({ timeout: 45_000 })
})

test('draws a map ROI, plans tiled statistics, runs them, and exports WGS84 GeoJSON', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await openRemoteFixture(page)
  await page.getByRole('tab', { name: 'ROI & Measure' }).click()
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  const viewport = page.getByRole('img', { name: /Geo raster viewport/u })
  const bounds = await viewport.boundingBox()
  if (bounds === null) throw new Error('Expected viewport bounds')
  await page.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.35)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.65)
  await page.mouse.up()
  await expect(page.getByText('Rectangle ROI')).toBeVisible()
  await expect(viewport).toHaveAttribute('data-drawing-tool', 'rectangle')

  await page.getByRole('button', { name: 'Plan zonal statistics' }).click()
  await expect(page.getByTestId('zonal-plan')).toContainText('estimatedTiles')
  await page.getByRole('button', { name: 'Run planned statistics' }).click()
  await expect(page.getByTestId('vector-result')).toContainText('validSampleCount')
  await expect(page.getByTestId('vector-result')).toContainText('originalGeometryPreserved')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export WGS84 GeoJSON' }).click()
  expect((await download).suggestedFilename()).toBe('atlas-rois.geojson')
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
