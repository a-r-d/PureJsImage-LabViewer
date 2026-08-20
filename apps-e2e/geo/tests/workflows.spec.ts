import { expect, type Page, test } from '@playwright/test'

import { mockGovernmentCatalogs } from '../support/catalog-mocks.js'
import { dismissDemoPicker } from '../support/demo-picker.js'
import { KENTUCKY_STAC_ROUTE, mockKentuckyStac } from '../support/stac-mock.js'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear()
  })
  await mockGovernmentCatalogs(page)
  await page.goto('/')
  await expect(page.locator('[data-workbench-ready]')).toHaveAttribute(
    'data-workbench-ready',
    'true',
    { timeout: 30_000 },
  )
  await dismissDemoPicker(page)
  await expect(page.getByTestId('workflow-browser')).toBeVisible()
})

test('COG Anatomy opens X-ray and keeps Range telemetry observable during navigation', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await runWorkflowToDecision(page, 'cog-anatomy')
  await chooseOptions(page, 1)
  await expect(page.getByTestId('cog-xray')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('cog-xray')).toContainText(/TIFF|BigTIFF/u)
  await expect(page.getByTestId('cog-xray')).toContainText(/range|bytes|cache/iu)
  const viewport = page.getByRole('img', { name: /Geo raster viewport/u })
  await viewport.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('+')
  await expect(page.locator('.status-bar')).toContainText(/ranges/u)
})

test('Kentucky Through Time opens two dated sources and enters swipe', async ({ page }) => {
  test.setTimeout(60_000)
  await runWorkflowToDecision(page, 'kentucky-through-time')
  await expect(page.getByRole('checkbox', { name: /2019/u })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /2022/u })).toBeVisible()
  await chooseOptions(page, 2)
  await expect(page.getByTestId('workflow-completed')).toContainText('Two-date comparison', {
    timeout: 30_000,
  })
  await page.getByRole('tab', { name: 'Layers' }).click()
  await expect(page.locator('.geo-source-list li')).toHaveCount(2)
  await expect(page.getByRole('img', { name: /Geo raster viewport/u })).toHaveAttribute(
    'data-comparison-mode',
    'swipe',
  )
})

test('Kentucky Through Time refuses incompatible CRS and rolls back both sources', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.unroute(KENTUCKY_STAC_ROUTE)
  await mockKentuckyStac(page, { incompatibleSecondCrs: true })
  await runWorkflowToDecision(page, 'kentucky-through-time')
  await chooseOptions(page, 2)
  await expect(page.getByTestId('workflow-current-step')).toContainText('Failed', {
    timeout: 30_000,
  })
  await expect(
    page.getByText(/cannot be composed in the current native CRS project/iu),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Layers' }).click()
  await expect(page.locator('.geo-source-list li')).toHaveCount(0)
})

test('natural color is metadata-driven and CIR stays hidden without named NIR', async ({
  page,
}) => {
  await page.getByLabel('Workflow').selectOption('natural-color-cir')
  await page.getByRole('button', { name: 'Run workflow' }).click()
  await expect(page.getByRole('group', { name: 'Choose an image' })).toBeVisible()
  await expect(page.getByLabel('Display preset').locator('option')).toHaveText(['Natural color'])
  await chooseOptions(page, 1)
  await expect(page.getByTestId('workflow-completed')).toContainText(
    'Metadata-driven color layer',
    {
      timeout: 30_000,
    },
  )
})

test('Landsat composes separate assets into natural color, CIR, and NDVI', async ({ page }) => {
  test.setTimeout(90_000)
  await runWorkflowToDecision(page, 'usgs-landsat-cincinnati')
  await chooseOptions(page, 1)
  const completed = page.getByTestId('workflow-completed')
  await expect(completed).toContainText('Natural color virtual stack', { timeout: 60_000 })
  await expect(completed).toContainText('Color infrared virtual stack')
  await expect(completed).toContainText('NDVI')
  await expect(completed).toContainText('geo.analysis.virtual_band_stack')
  await expect(completed).toContainText('geo.analysis.normalized_difference')
})

test('explains known provider browser access and relay limitations before starting', async ({
  page,
}) => {
  await page.getByLabel('Workflow').selectOption('usgs-landsat-cincinnati')
  await expect(page.getByText('Provider access note')).toBeVisible()
  await expect(page.getByText(/LandsatLook CORS allows only/iu)).toBeVisible()
  await page.getByText('Ordered workflow plan').click()
  await expect(
    page.getByText(/absence of an approved relay prevents browser access/iu),
  ).toBeVisible()
})

test('Terrain Lab creates hillshade, slope, elevation profile, and summary', async ({ page }) => {
  test.setTimeout(90_000)
  await runWorkflowToDecision(page, 'terrain-lab')
  await chooseOptions(page, 1)
  const completed = page.getByTestId('workflow-completed')
  await expect(completed).toContainText('Hillshade', { timeout: 60_000 })
  await expect(completed).toContainText('Slope')
  await expect(completed).toContainText('Elevation profile')
  await expect(completed).toContainText('Regional elevation summary')
  await expect(completed).toContainText('geo.analysis.line_profile')
})

test('cancellation cleans temporary sources and completed identity replay skips search', async ({
  page,
}) => {
  test.setTimeout(90_000)
  let searches = 0
  page.on('request', (request) => {
    if (request.url().includes('/search')) searches += 1
  })
  await runWorkflowToDecision(page, 'cog-anatomy')
  await chooseOptions(page, 1)
  await expect(page.getByTestId('cog-xray')).toBeVisible({ timeout: 30_000 })
  const searchesBeforeReplay = searches
  await page.getByRole('tab', { name: 'Workflows' }).click()
  await page.getByRole('button', { name: 'Replay' }).click()
  await expect(page.getByTestId('workflow-completed')).toBeVisible({ timeout: 30_000 })
  expect(searches).toBe(searchesBeforeReplay)

  await page.getByRole('tab', { name: 'Layers' }).click()
  const closeButtons = page.getByRole('button', { name: /^Close /u })
  let remaining = await closeButtons.count()
  while (remaining > 0) {
    await closeButtons.nth(remaining - 1).click({ force: true })
    remaining -= 1
    await expect(closeButtons).toHaveCount(remaining)
  }
  await expect(page.locator('.geo-source-list li')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Workflows' }).click()

  await page.getByLabel('Workflow').selectOption('kentucky-through-time')
  await page.getByRole('button', { name: 'Run workflow' }).click()
  await expect(page.getByRole('group', { name: 'Choose two acquisition dates' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('workflow-current-step')).toContainText('Cancelled')
  await page.getByRole('tab', { name: 'Layers' }).click()
  await expect(page.locator('.geo-source-list li')).toHaveCount(0)
})

async function runWorkflowToDecision(page: Page, workflowId: string): Promise<void> {
  await page.getByLabel('Workflow').selectOption(workflowId)
  await page.getByRole('button', { name: 'Run workflow' }).click()
  await expect(page.locator('.geo-workflow-options')).toBeVisible({ timeout: 30_000 })
}

async function chooseOptions(page: Page, count: number): Promise<void> {
  const options = page.locator('.geo-workflow-options input')
  await expect(options.nth(count - 1)).toBeVisible({ timeout: 30_000 })
  for (let index = 0; index < count; index += 1) await options.nth(index).check()
  await page.getByRole('button', { name: 'Continue' }).click()
}
