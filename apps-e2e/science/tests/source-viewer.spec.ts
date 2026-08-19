import { scenarioArtifact } from '@pji-workbench/test-corpus'
import { expect, test } from '@playwright/test'
import { attachScenarioEvidence } from './support/scenario-evidence.js'
import { openSample, openWorkbench } from './support/workbench.js'

test.beforeEach(async ({ page }) => {
  await openWorkbench(page)
})

test.afterEach(async ({ page }, testInfo) => {
  await attachScenarioEvidence(page, testInfo, scenarioArtifact('generated.calibrated-particles'), {
    capabilities: [
      'source.reader-dataset',
      'source.axes-components-calibration-metadata',
      'viewport.navigation-value-readout',
    ],
  })
})

test('opens a real worker-hosted sample with calibrated numeric cursor values', async ({
  page,
}) => {
  await openSample(page)
  await expect(page.getByText('Gwyddion Simple Field', { exact: true })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Workbench status' })).toContainText('0.42 nm/px')
  const canvas = page.getByRole('img', { name: /Scientific image viewport/ })
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.mock-viewport__readout')).toContainText('nm')
  await expect(page.locator('.mock-viewport__readout')).toContainText('bounded tiles')
  await page.getByRole('tab', { name: 'Display' }).click()
  await expect(page.getByLabel('Component')).toHaveValue('0')
  await expect(page.getByLabel('Plane axes')).toHaveCount(0)
})

test('rejects insecure remote URLs with range guidance and retains the workspace', async ({
  page,
}) => {
  await openSample(page)
  await page.getByRole('button', { name: 'Open URL' }).click()
  await page.getByLabel('Source URL').fill('http://example.com/image.mrc')
  await page.getByRole('button', { name: 'Open URL', exact: true }).last().click()
  await expect(page.getByRole('alert')).toContainText('Remote sources must use HTTPS')
  await expect(page.getByRole('alert')).toContainText('previous workspace remains unchanged')
  await expect(page.getByRole('img', { name: /Scientific image viewport/ })).toBeVisible()
})
