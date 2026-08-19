import { expect, test } from '@playwright/test'

import { KENTUCKY_STAC_ROUTE, mockKentuckyStac } from '../support/stac-mock.js'

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
  await expect(page.getByTestId('catalog-status')).toHaveText(/\d+ collections/u, {
    timeout: 15_000,
  })
})

test('searches a mocked Kentucky collection and opens a COG asset as a layer', async ({ page }) => {
  await expect(page.getByTestId('catalog-panel')).toBeVisible()
  await page.getByRole('button', { name: 'Kentucky Through Time' }).click()
  await expect(page.getByTestId('catalog-status')).toHaveText(/^\d+ of \d+ items$/u, {
    timeout: 15_000,
  })
  await page.getByRole('button', { name: /N082E280_2019_6IN_cog/u }).click()
  await page.getByRole('button', { name: 'Open as layer' }).click()
  await expect(page.getByRole('img', { name: /Geo raster viewport/u })).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole('tab', { name: 'Layers' }).click()
  await expect(page.getByTestId('catalog-provenance')).toContainText('orthos-phase2')
  await expect(page.getByTestId('catalog-provenance')).toContainText('CC-BY-4.0')
  await expect(page.getByTestId('catalog-provenance')).not.toContainText('X-Amz-Signature')
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

test('shows a catalog error when the STAC API is unavailable', async ({ page }) => {
  await page.unroute(KENTUCKY_STAC_ROUTE)
  await page.route(KENTUCKY_STAC_ROUTE, (route) => route.abort('failed'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Refresh catalog' }).click()
  await expect(page.getByTestId('catalog-panel').getByText('Catalog unavailable')).toBeVisible()
})
