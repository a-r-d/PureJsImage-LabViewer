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
  await page.getByRole('tab', { name: 'Planned datasets' }).click()
  const plannedResults = await new AxeBuilder({ page }).include('.example-gallery').analyze()
  expect(
    plannedResults.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Example library' })).toBeHidden()
  await expect(examplesTrigger).toBeFocused()
})

test('@a11y project and remote-source dialogs have no serious violations', async ({ page }) => {
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  const projectsResults = await new AxeBuilder({ page }).include('.url-dialog').analyze()
  expect(
    projectsResults.violations.filter(
      ({ impact }) => impact === 'critical' || impact === 'serious',
    ),
  ).toEqual([])
  await page
    .getByRole('dialog', { name: 'Recent projects' })
    .getByRole('button', {
      name: 'Close',
    })
    .click()

  await page.locator('.app-bar').getByRole('button', { name: 'Open URL' }).click()
  const remoteResults = await new AxeBuilder({ page }).include('.url-dialog').analyze()
  expect(
    remoteResults.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([])
})

test('@a11y agent setup and chat have no serious violations', async ({ page }) => {
  await page.getByRole('button', { name: 'Show agent readiness' }).click()
  const settings = page.getByRole('dialog', { name: 'Agent settings' })
  await expect(settings.getByLabel('OpenRouter key')).toBeFocused()
  const settingsResults = await new AxeBuilder({ page })
    .include('.science-agent-settings')
    .analyze()
  expect(
    settingsResults.violations.filter(
      ({ impact }) => impact === 'critical' || impact === 'serious',
    ),
  ).toEqual([])

  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(page.getByLabel('Request or follow-up')).toBeFocused()
  const chatResults = await new AxeBuilder({ page }).include('.science-agent').analyze()
  expect(
    chatResults.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([])

  const settingsTrigger = page.getByRole('button', { name: 'Agent settings' })
  await settingsTrigger.click()
  await page.keyboard.press('Escape')
  await expect(settingsTrigger).toBeFocused()
})
