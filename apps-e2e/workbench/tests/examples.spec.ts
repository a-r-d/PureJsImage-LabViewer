import { scenarioTestArtifacts } from '@pji-workbench/test-corpus'
import { expect, test } from '@playwright/test'
import { attachScenarioEvidence } from './support/scenario-evidence.js'
import {
  openLegacyAnalysisControls,
  openWorkbench,
  waitForWorkbenchSettled,
} from './support/workbench.js'

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
      await card
        .getByRole('button', {
          name: artifact.initialAnalysis === undefined ? 'Open example' : 'Open analyzed example',
          exact: true,
        })
        .click()
      await expect(gallery).toBeHidden({ timeout: 30_000 })
      await waitForWorkbenchSettled(page)
      await expect(page.getByRole('img', { name: /Scientific image viewport/u })).toBeVisible()
      const sourceName = artifact.fixture.files[0]?.split('/').at(-1)
      if (sourceName !== undefined)
        await expect(
          page.getByRole('button', {
            name: `${sourceName} ${artifact.fixture.kind === 'bundled' ? 'example' : 'generated'}`,
          }),
        ).toBeVisible()
      await expect(page.getByRole('status', { name: 'Workbench status' })).toContainText(
        artifact.fixture.kind === 'bundled'
          ? 'Uncalibrated'
          : (artifact.metadata.calibration.split(' · ')[0] ?? artifact.metadata.calibration),
      )
      if (artifact.initialAnalysis !== undefined) {
        await expect(page.locator('.analysis-message, .result-count').first()).toContainText(
          /Analysis completed|Counted \d+|particles counted/u,
        )
        await expect(page.getByRole('tab', { name: 'Results', exact: true })).toHaveAttribute(
          'aria-selected',
          'true',
        )
      }

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

test('replays a bundled real source and its committed analysis after reload', async ({ page }) => {
  const artifact = prScenarios.find(({ scenarioId }) => scenarioId === 'cdc.ecoli-sem')
  expect(artifact).toBeDefined()
  if (artifact === undefined) return

  await page.getByRole('button', { name: 'Examples mode' }).click()
  const gallery = page.getByRole('dialog', { name: 'Example library' })
  await gallery.getByRole('searchbox', { name: 'Search' }).fill(artifact.scenarioTitle)
  await gallery
    .locator('.example-card')
    .filter({ hasText: artifact.scenarioTitle })
    .getByRole('button', { name: 'Open analyzed example', exact: true })
    .click()
  await expect(gallery).toBeHidden({ timeout: 30_000 })
  await waitForWorkbenchSettled(page)
  await expect(page.locator('.analysis-message, .result-count').first()).toContainText(
    /Analysis completed|Counted \d+|particles counted/u,
  )
  await page.getByLabel('Project title').fill('Reviewed real SEM')
  await page.getByLabel('Project title').blur()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()

  await page.reload()

  await expect(page.getByLabel('Project title')).toHaveValue('Reviewed real SEM')
  await expect(page.getByRole('button', { name: 'e-coli-sem.gsf example' })).toBeVisible()
  await expect(page.getByRole('img', { name: /Scientific image viewport/u })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Workbench status' })).toContainText('Uncalibrated')
  await page.getByRole('tab', { name: 'Analysis' }).click()
  await openLegacyAnalysisControls(page)
  await expect(page.getByText(/Replayed saved numerical analysis/u)).toBeVisible({
    timeout: 15_000,
  })
})
