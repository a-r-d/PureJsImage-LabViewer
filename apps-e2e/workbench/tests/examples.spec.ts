import { scenarioTestArtifacts } from '@pji-workbench/test-corpus'
import { expect, test } from '@playwright/test'
import { attachScenarioEvidence } from './support/scenario-evidence.js'
import { openWorkbench, waitForWorkbenchSettled } from './support/workbench.js'

const prScenarios = scenarioTestArtifacts(['pr'])

test.beforeEach(async ({ page }) => {
  await openWorkbench(page)
})

test('the validated PR scenario artifact set exactly drives the enabled gallery', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Examples mode' }).click()
  const gallery = page.getByRole('dialog', { name: 'Example library' })
  await expect(gallery).toContainText(`${prScenarios.length} ready`)
  await expect(gallery.locator('.example-card')).toHaveCount(prScenarios.length)

  for (const artifact of prScenarios) {
    const card = gallery.locator('.example-card').filter({ hasText: artifact.scenarioTitle })
    await expect(card).toHaveCount(1)
    await expect(card).toContainText(artifact.metadata.modality)
    await expect(card).toContainText(artifact.fixture.format)
    await expect(card).toContainText(artifact.metadata.calibration)
    await expect(card).toContainText(artifact.metadata.licenseId)
  }
})

for (const artifact of prScenarios) {
  test(`@scenario opens ${artifact.scenarioId} from its normalized artifact`, async ({
    page,
  }, testInfo) => {
    try {
      await page.getByRole('button', { name: 'Examples mode' }).click()
      const gallery = page.getByRole('dialog', { name: 'Example library' })
      await gallery.getByRole('searchbox', { name: 'Search' }).fill(artifact.scenarioTitle)
      const card = gallery.locator('.example-card').filter({ hasText: artifact.scenarioTitle })
      await card.getByRole('button', { name: 'Open', exact: true }).click()
      await expect(gallery).toBeHidden()
      await waitForWorkbenchSettled(page)
      await expect(page.getByRole('img', { name: /Scientific image viewport/u })).toBeVisible()
      const sourceName = artifact.fixture.files[0]
      if (sourceName !== undefined)
        await expect(page.getByRole('button', { name: `${sourceName} sample` })).toBeVisible()
      await expect(page.getByRole('status', { name: 'Workbench status' })).toContainText(
        artifact.metadata.calibration.split(' · ')[0] ?? artifact.metadata.calibration,
      )

      const metrics = await page.evaluate(() => Reflect.get(window, '__PJI_WORKBENCH_METRICS__'))
      expect(metrics.sourceBytes).toBeLessThanOrEqual(artifact.budgets.maxSourceBytes)
      expect(metrics.firstTileMilliseconds).not.toBeNull()
      expect(metrics.firstTileMilliseconds).toBeLessThanOrEqual(
        artifact.budgets.maxFirstUsefulTileMilliseconds,
      )
    } finally {
      await attachScenarioEvidence(page, testInfo, artifact, {
        capabilities: [
          'source.reader-dataset',
          'source.axes-components-calibration-metadata',
          'source.first-useful-tile',
        ],
      })
    }
  })
}
