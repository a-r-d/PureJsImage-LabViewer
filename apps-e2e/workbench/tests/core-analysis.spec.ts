import { readFile } from 'node:fs/promises'
import { scenarioArtifact } from '@pji-workbench/test-corpus'
import { expect, test } from '@playwright/test'
import { attachScenarioEvidence } from './support/scenario-evidence.js'
import {
  openLegacyAnalysisControls,
  openSample,
  openWorkbench,
  waitForWorkbenchSettled,
} from './support/workbench.js'

test.beforeEach(async ({ page }) => {
  await openWorkbench(page)
})

test.afterEach(async ({ page }, testInfo) => {
  await attachScenarioEvidence(page, testInfo, scenarioArtifact('generated.touching-particles'), {
    capabilities: [
      'analysis.filters-transforms-background',
      'analysis.threshold-morphology-watershed',
      'export.bounded',
    ],
  })
})

test('previews, commits, plans, and executes threshold connected components', async ({ page }) => {
  test.setTimeout(60_000)
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).click()
  await openLegacyAnalysisControls(page)
  await waitForWorkbenchSettled(page)
  await page.getByLabel('Threshold value').fill('175')
  await page.getByRole('button', { name: 'Preview threshold' }).click()
  await expect(page.getByText(/Preview ready in/)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Apply threshold' }).click()
  await expect(
    page.getByText('Threshold committed as one semantic project revision.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Plan connected components' }).click()
  await expect(page.getByText(/Connected-components plan ready/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run connected components' })).toBeEnabled()
  await page.getByRole('button', { name: 'Run connected components' }).click()
  await expect(page.getByTestId('analysis-results')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('analysis-results')).toContainText(/particles counted|objects/u)
  await expect(page.getByRole('region', { name: 'Paged object measurements' })).toBeVisible()
  const firstLabel = page.getByRole('button', { name: /Select label/ }).first()
  await firstLabel.click()
  await expect(firstLabel).toHaveAttribute('aria-pressed', 'true')
})

test('supports a keyboard-only threshold commit path', async ({ page }) => {
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).focus()
  await page.keyboard.press('Enter')
  await page.getByText('Operation browser and legacy threshold controls', { exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByLabel('Threshold value').focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('175')
  await page.getByRole('button', { name: 'Preview threshold' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Preview ready in/)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Apply threshold' }).focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByText('Threshold committed as one semantic project revision.'),
  ).toBeVisible()
})

test('searches, favorites, previews, cancels, and applies a toolbox operation', async ({
  page,
}) => {
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).click()
  await openLegacyAnalysisControls(page)
  await page.getByLabel('Search operations').fill('unsharp')
  await page
    .getByRole('button', { name: /Unsharp mask/ })
    .first()
    .click()
  const detail = page.getByRole('region', { name: 'Selected operation' })
  await expect(detail.getByRole('heading', { name: 'Unsharp mask' })).toBeVisible()
  await page.getByRole('button', { name: 'Add Unsharp mask to favorites' }).click()
  await detail.getByRole('button', { name: 'Preview' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Preview ready in/)).toBeVisible({ timeout: 15_000 })
  await detail.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText(/Preview cancelled/)).toBeVisible()
  await detail.getByRole('button', { name: 'Apply' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Analysis completed in/)).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Search operations').fill('')
  await page.getByRole('button', { name: 'Recent' }).click()
  await expect(page.getByRole('button', { name: /Unsharp mask/ }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Favorites', exact: true }).click()
  await expect(page.getByRole('button', { name: /Unsharp mask/ }).first()).toBeVisible()
})

test('chains crop and filtering into a line profile and bounded CSV export', async ({ page }) => {
  test.setTimeout(60_000)
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).click()
  await openLegacyAnalysisControls(page)
  await page.getByLabel('Search operations').fill('crop scientific')
  await page
    .getByRole('button', { name: /Crop scientific dataset/ })
    .first()
    .click()
  const detail = page.getByRole('region', { name: 'Selected operation' })
  await detail.getByLabel('x', { exact: true }).fill('0')
  await detail.getByLabel('y', { exact: true }).fill('0')
  await detail.getByLabel('width', { exact: true }).fill('64')
  await detail.getByLabel('height', { exact: true }).fill('64')
  await detail.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText(/Analysis completed in/)).toBeVisible({ timeout: 15_000 })

  await page.getByLabel('Search operations').fill('mean box')
  await page
    .getByRole('button', { name: /Mean \/ box filter/ })
    .first()
    .click()
  await detail.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText(/Analysis completed in/)).toBeVisible({ timeout: 15_000 })

  await page.getByRole('tab', { name: 'ROI' }).click()
  await page.getByRole('button', { name: 'Line', exact: true }).click()
  const canvas = page.getByRole('img', { name: /Scientific image viewport/ })
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Line profile' }).click()
  const results = page.getByTestId('analysis-results')
  await expect(results).toContainText('profile', { timeout: 15_000 })
  const downloadPromise = page.waitForEvent('download')
  await results.getByRole('button', { name: 'Export all CSV' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('purejsimage-analysis.csv')
  const path = await download.path()
  expect(path).not.toBeNull()
  if (path !== null) {
    const csv = await readFile(path, 'utf8')
    expect(csv).toContain('distance')
    expect(csv.trim().split('\n').length).toBeGreaterThan(2)
  }
})
