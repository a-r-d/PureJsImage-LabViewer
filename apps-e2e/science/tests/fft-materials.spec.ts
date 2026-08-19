import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { scenarioArtifact } from '@pji-workbench/test-corpus'
import { expect, test } from '@playwright/test'
import { attachScenarioEvidence } from './support/scenario-evidence.js'
import { openSample, openWorkbench, waitForWorkbenchSettled } from './support/workbench.js'

test.beforeEach(async ({ page }) => {
  await openWorkbench(page)
})

test.afterEach(async ({ page }, testInfo) => {
  await attachScenarioEvidence(page, testInfo, scenarioArtifact('generated.periodic-lattice'), {
    capabilities: ['analysis.fft-profile-d-spacing'],
  })
})

test('runs a bounded FFT workspace with calibrated frequency cursor, peaks, export, and replay', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openSample(page)
  await page.getByRole('tab', { name: 'ROI' }).click()
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  const canvas = page.getByRole('img', { name: /Scientific image viewport/ })
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return
  await page.mouse.move(box.x + box.width / 2 - 45, box.y + box.height / 2 - 45)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 45)
  await page.mouse.up()
  await expect(page.getByRole('list', { name: 'Regions of interest' }).locator('li')).toHaveCount(1)

  await page.getByRole('tab', { name: 'Analysis' }).click()
  const advanced = page.getByRole('region', { name: 'Advanced materials workspaces' })
  await advanced.getByText('FFT and diffraction workspace', { exact: true }).click()
  await advanced.getByLabel('Source ROI').selectOption({ index: 1 })
  const run = advanced.getByRole('button', { name: 'Run FFT workspace' })
  await expect(run).toBeDisabled()
  await advanced.getByRole('button', { name: 'Plan FFT workspace' }).click()
  await expect(advanced.getByText('Plan admitted', { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(run).toBeEnabled()
  await run.click()
  await expect(advanced.getByText(/Analysis completed in/)).toBeVisible({ timeout: 60_000 })
  await waitForWorkbenchSettled(page)

  const results = page.getByTestId('analysis-results')
  await expect(results).toContainText('peaks')
  await expect(results.getByRole('img', { name: 'radialProfile scientific profile' })).toBeVisible()
  await expect(
    results.getByRole('img', { name: 'azimuthalProfile scientific profile' }),
  ).toBeVisible()
  await expect(canvas).toHaveAttribute('data-analysis-annotation-count', /[1-9][0-9]*/u)
  await expect(results.getByRole('region', { name: 'Paged peaks results' })).toBeVisible()
  const exportPromise = page.waitForEvent('download')
  await results.getByRole('button', { name: 'Export all CSV' }).click()
  const download = await exportPromise
  const path = await download.path()
  expect(path).not.toBeNull()
  if (path !== null) {
    const csv = await readFile(path, 'utf8')
    expect(csv).toContain('radialFrequency')
    expect(csv).toContain('dSpacing')
  }

  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.5)
  await expect(page.locator('.mock-viewport__readout')).toContainText('1/nm')
  await expect(page.locator('.mock-viewport__readout')).toContainText('d=')
  const accessibility = await new AxeBuilder({ page }).include('.advanced-materials').analyze()
  expect(
    accessibility.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([])

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.reload()
  await waitForWorkbenchSettled(page)
  await page.getByRole('tab', { name: 'Pipeline' }).click()
  await expect(page.getByRole('region', { name: 'Analysis output' })).toContainText(
    '2D FFT workspace',
  )
})
