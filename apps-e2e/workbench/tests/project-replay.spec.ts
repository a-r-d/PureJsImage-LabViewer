import { scenarioArtifact } from '@pji-workbench/test-corpus'
import { expect, test } from '@playwright/test'
import { attachScenarioEvidence } from './support/scenario-evidence.js'
import {
  centerViewportReadout,
  openLegacyAnalysisControls,
  openSample,
  openWorkbench,
  waitForWorkbenchSettled,
} from './support/workbench.js'

test.beforeEach(async ({ page }) => {
  await openWorkbench(page)
})

test.afterEach(async ({ page }, testInfo) => {
  await attachScenarioEvidence(page, testInfo, scenarioArtifact('generated.calibrated-particles'), {
    capabilities: ['project.save-reopen-rebind'],
  })
})

test('saves and numerically replays a semantic project after a browser reload', async ({
  page,
}) => {
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).click()
  await openLegacyAnalysisControls(page)
  await page.getByLabel('Search operations').fill('add constant')
  await page
    .getByRole('button', { name: /Add constant/ })
    .first()
    .click()
  const detail = page.getByRole('region', { name: 'Selected operation' })
  await detail.getByLabel('Constant').fill('10')
  await detail.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText(/Analysis completed in/)).toBeVisible({ timeout: 15_000 })
  await waitForWorkbenchSettled(page)
  const beforeReload = await centerViewportReadout(page)
  await page.getByLabel('Project title').fill('Reloaded SEM project')
  await page.getByLabel('Project title').blur()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()

  await page.reload()

  await expect(page.getByLabel('Project title')).toHaveValue('Reloaded SEM project')
  await expect(page.getByRole('img', { name: /Scientific image viewport/ })).toBeVisible()
  await waitForWorkbenchSettled(page)
  expect(await centerViewportReadout(page)).toBe(beforeReload)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Analysis' }).click()
  await openLegacyAnalysisControls(page)
  await expect(page.getByText(/Replayed saved numerical analysis/)).toBeVisible({ timeout: 15_000 })
})
