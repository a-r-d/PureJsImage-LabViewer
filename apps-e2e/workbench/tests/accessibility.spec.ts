import AxeBuilder from '@axe-core/playwright'
import { scenarioArtifact } from '@pji-workbench/test-corpus'
import { expect, test } from '@playwright/test'
import { attachScenarioEvidence } from './support/scenario-evidence.js'
import { openSample, openWorkbench } from './support/workbench.js'

test.beforeEach(async ({ page }) => {
  await openWorkbench(page)
})

test.afterEach(async ({ page }, testInfo) => {
  await attachScenarioEvidence(page, testInfo, scenarioArtifact('generated.calibrated-particles'), {
    capabilities: ['accessibility.keyboard'],
  })
})

test('@a11y analysis controls and results have no serious violations', async ({ page }) => {
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).click()
  const results = await new AxeBuilder({ page }).analyze()
  expect(
    results.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([])
})

test('@a11y has no serious violations in empty and opened workspace states', async ({ page }) => {
  const emptyResults = await new AxeBuilder({ page }).analyze()
  expect(
    emptyResults.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([])
  await openSample(page)
  const openedResults = await new AxeBuilder({ page }).analyze()
  expect(
    openedResults.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([])
  const examplesTrigger = page.getByRole('button', { name: 'Examples mode' })
  await examplesTrigger.click()
  await expect(page.getByRole('searchbox', { name: 'Search' })).toBeFocused()
  const galleryResults = await new AxeBuilder({ page }).analyze()
  expect(
    galleryResults.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Example library' })).toBeHidden()
  await expect(examplesTrigger).toBeFocused()
})
