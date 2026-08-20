import { expect, test } from '@playwright/test'

import { mockGovernmentCatalogs } from '../support/catalog-mocks.js'
import { dismissDemoPicker } from '../support/demo-picker.js'
import { KENTUCKY_STAC_ROUTE } from '../support/stac-mock.js'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const storageResetKey = '__pji_playwright_storage_reset__'
    if (window.sessionStorage.getItem(storageResetKey) === null) {
      window.localStorage.clear()
      window.sessionStorage.setItem(storageResetKey, 'true')
    }
  })
  await mockGovernmentCatalogs(page)
  await page.goto('/')
  await expect(page.locator('[data-workbench-ready]')).toHaveAttribute(
    'data-workbench-ready',
    'true',
    { timeout: 30_000 },
  )
  await dismissDemoPicker(page)
  await expect(page.getByTestId('catalog-status')).toHaveText(/\d+ collections/u, {
    timeout: 15_000,
  })
})

async function selectKentucky(page: import('@playwright/test').Page): Promise<void> {
  await page.getByLabel('Catalog').selectOption('ky-from-above')
  await expect(page.getByTestId('catalog-status')).toHaveText(/\d+ collections/u, {
    timeout: 15_000,
  })
}

async function openReadyTile(page: import('@playwright/test').Page, name: RegExp): Promise<void> {
  const tile = page.getByRole('button', { name })
  await expect(tile).toBeEnabled({ timeout: 15_000 })
  await tile.click({ force: true })
}

test('searches a mocked Kentucky collection and opens a COG asset as a layer', async ({ page }) => {
  test.setTimeout(60_000)
  let delayedFirstRange = false
  await page.route('http://127.0.0.1:4175/north-up.tif', async (route) => {
    if (!delayedFirstRange) {
      delayedFirstRange = true
      await new Promise((resolve) => {
        setTimeout(resolve, 600)
      })
    }
    await route.continue()
  })
  await expect(page.getByTestId('catalog-panel')).toBeVisible()
  await selectKentucky(page)
  await page.getByRole('button', { name: 'Kentucky Through Time' }).click()
  await expect(page.getByTestId('catalog-status')).toHaveText(/^\d+ of \d+ items$/u, {
    timeout: 15_000,
  })
  await expect(page.getByText('Click a Ready tile to open it in the map')).toBeVisible()
  await openReadyTile(page, /Open N082E280_2019_6IN_cog/u)
  await expect(page.getByTestId('geo-opening')).toBeVisible()
  await expect(page.getByRole('img', { name: /Geo raster viewport/u })).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole('tab', { name: 'Layers' }).click()
  await expect(page.getByTestId('catalog-provenance')).toContainText('orthos-phase2')
  await expect(page.getByTestId('catalog-provenance')).toContainText('CC-BY-4.0')
  await expect(page.getByTestId('catalog-provenance')).not.toContainText('X-Amz-Signature')
})

test('empty-state Search runs a catalog search', async ({ page }) => {
  await page.getByRole('button', { name: 'Search NOAA Digital Coast' }).click()
  await expect(page.getByTestId('catalog-status')).toHaveText(/^\d+ of \d+ items$/u, {
    timeout: 15_000,
  })
  await expect(
    page.getByRole('button', { name: /Open ncei13_n17x75_w065x75_2022v1/u }),
  ).toHaveCount(1)
})

test('opens a catalog asset from a shareable deep link', async ({ page }) => {
  await page.goto(
    '/#v=1&catalog=ky-from-above&collection=orthos-phase2&item=N082E280_2019_6IN_cog.tif&asset=data&inspect=1',
  )
  await expect(page.getByRole('img', { name: /Geo raster viewport/u })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByTestId('cog-xray')).toBeVisible()
})

test('shows a catalog error when the browser blocks the STAC API', async ({ page }) => {
  await selectKentucky(page)
  await page.unroute(KENTUCKY_STAC_ROUTE)
  await page.route(KENTUCKY_STAC_ROUTE, (route) => route.abort('failed'))
  await page.getByRole('button', { name: 'Refresh catalog' }).click()
  await expect(
    page.getByTestId('catalog-panel').getByText('Browser blocked this catalog'),
  ).toBeVisible()
})

test('opens a mocked NOAA static STAC item from the local range fixture', async ({ page }) => {
  test.setTimeout(60_000)
  await page.getByRole('button', { name: 'NOAA Puerto Rico Terrain' }).click()
  await expect(page.getByTestId('catalog-status')).toHaveText(/^\d+ of \d+ items$/u, {
    timeout: 15_000,
  })
  await openReadyTile(page, /Open ncei13_n17x75_w065x75_2022v1/u)
  await expect(page.getByRole('img', { name: /Geo raster viewport/u })).toBeVisible({
    timeout: 30_000,
  })
})

test('searches mocked Landsat and TNM catalogs without provider branches', async ({ page }) => {
  await page.getByLabel('Catalog').selectOption('usgs-landsat')
  await expect(page.getByTestId('catalog-status')).toHaveText(/\d+ collections/u, {
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'USGS Landsat Cincinnati' }).click()
  await expect(page.getByTestId('catalog-status')).toHaveText(/^\d+ of \d+ items$/u, {
    timeout: 15_000,
  })
  await expect(page.getByRole('button', { name: /Open LC08_L2SP_019033/u })).toBeVisible()
  await page.getByLabel('Catalog').selectOption('usgs-3dep')
  await expect(page.getByTestId('catalog-status')).toHaveText(/\d+ collections/u, {
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'USGS National Terrain' }).click()
  await expect(page.getByTestId('catalog-status')).toHaveText(/^\d+ of \d+ items$/u, {
    timeout: 15_000,
  })
  await expect(page.getByRole('button', { name: /Open 60d2c050d34e84098652891a/u })).toBeVisible()
})

test('opens a curated demo from the launch picker', async ({ page }) => {
  test.setTimeout(60_000)
  await page.getByRole('button', { name: 'Demos' }).click()
  await expect(page.getByRole('dialog', { name: 'Choose a demo' })).toBeVisible()
  await page.getByRole('button', { name: /Kentucky leaf-off ortho/u }).click()
  await expect(page.getByRole('img', { name: /Geo raster viewport/u })).toBeVisible({
    timeout: 30_000,
  })
})
