import { scenarioArtifact } from '@pji-workbench/test-corpus'
import { expect, test } from '@playwright/test'
import { attachScenarioEvidence } from './support/scenario-evidence.js'
import { openSample, openWorkbench } from './support/workbench.js'

test.beforeEach(async ({ page }) => {
  await openWorkbench(page)
})

test.afterEach(async ({ page }, testInfo) => {
  await attachScenarioEvidence(page, testInfo, scenarioArtifact('generated.calibrated-particles'), {
    capabilities: ['lifecycle.cancel-crash-cleanup-release'],
  })
})

test('surfaces a Worker crash and provides an explicit restart path', async ({ page }) => {
  await openSample(page)
  await page.evaluate(async () => {
    try {
      await window.__PJI_TEST_CRASH_WORKER__?.()
    } catch {
      // The pending test request is expected to reject when its Worker terminates.
    }
  })
  await expect(page.getByRole('alert')).toContainText('project state is unchanged')
  await page.getByRole('button', { name: 'Restart imaging Worker' }).click()
  await expect(page.getByRole('status', { name: 'Workbench status' })).toContainText('Ready')
})
