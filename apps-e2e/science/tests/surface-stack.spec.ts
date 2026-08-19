import { scenarioArtifact } from '@pji-workbench/test-corpus'
import { expect, test } from '@playwright/test'
import { attachScenarioEvidence } from './support/scenario-evidence.js'
import { openWorkbench, waitForWorkbenchSettled } from './support/workbench.js'

const afmScenario = scenarioArtifact('generated.afm-tilted-surface')

test.setTimeout(75_000)

test.beforeEach(async ({ page }) => {
  await openWorkbench(page)
})

test('@scenario levels and measures the generated AFM surface', async ({ page }, testInfo) => {
  try {
    await page.getByRole('button', { name: 'Examples mode' }).click()
    const gallery = page.getByRole('dialog', { name: 'Example library' })
    await gallery.getByRole('searchbox', { name: 'Search' }).fill(afmScenario.scenarioTitle)
    await gallery
      .locator('.example-card')
      .filter({ hasText: afmScenario.scenarioTitle })
      .getByRole('button', { name: 'Open example', exact: true })
      .click()
    await waitForWorkbenchSettled(page)
    await page.getByRole('tab', { name: 'Analysis' }).click()
    const materials = page.getByTestId('advanced-materials')
    const surface = materials.locator('details').filter({ hasText: 'AFM/SPM surface workspace' })
    await surface.locator('summary').click()
    await surface
      .locator('select:has(option[value="first-order-plane"])')
      .selectOption('first-order-plane')
    await surface.getByRole('button', { name: 'Plan AFM surface' }).click()
    await expect(materials).toContainText('SURFACE plan admitted', { timeout: 15_000 })
    await surface.getByRole('button', { name: 'Run AFM surface' }).click()
    await waitForWorkbenchSettled(page)
    await expect(page.getByTestId('analysis-results')).toContainText('roughness', {
      timeout: 15_000,
    })
    await expect(page.getByTestId('analysis-results')).toContainText('surfaceProfile')
  } finally {
    await attachScenarioEvidence(page, testInfo, afmScenario, {
      capabilities: ['analysis.afm-leveling-roughness'],
    })
  }
})
