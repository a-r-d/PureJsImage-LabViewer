import { scenarioArtifact } from '@pji-workbench/test-corpus'
import { expect, test } from '@playwright/test'
import { attachScenarioEvidence } from './support/scenario-evidence.js'
import { openSample } from './support/workbench.js'

test.afterEach(async ({ page }, testInfo) => {
  await attachScenarioEvidence(page, testInfo, scenarioArtifact('generated.touching-particles'), {
    capabilities: ['scripts.sandbox-recipe-replay', 'lifecycle.cancel-crash-cleanup-release'],
  })
})

test('authors, typechecks, tests, reviews, and runs a built-in script through lazy Workers', async ({
  page,
}) => {
  const runtimeRequests: string[] = []
  const languageRequests: string[] = []
  page.on('request', (request) => {
    if (/quickjs|wasmfile|\.wasm(?:\?|$)/iu.test(request.url())) runtimeRequests.push(request.url())
    if (/language\.worker/iu.test(request.url())) languageRequests.push(request.url())
  })
  await page.goto('/')
  await expect(page.locator('[data-workbench-ready]')).toHaveAttribute(
    'data-workbench-ready',
    'true',
  )
  expect(runtimeRequests).toEqual([])
  expect(languageRequests).toEqual([])

  await openSample(page)
  await page.getByRole('button', { name: 'Script Studio' }).click()
  const dialog = page.getByRole('dialog', { name: 'Script Studio' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('dedicated Worker and QuickJS runtime')
  await dialog.getByRole('button', { name: /Watershed particle script/u }).click()

  const apiSearch = dialog.getByRole('searchbox', { name: 'Search script API' })
  await apiSearch.fill('batch')
  await expect(dialog.getByText('lab.analysis.requestBatch')).toBeVisible()
  await apiSearch.fill('')

  const editor = dialog.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('lab.')
  await page.keyboard.press('Control+Space')
  await expect(dialog.locator('.cm-tooltip-autocomplete')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')

  await dialog.getByRole('button', { name: 'Typecheck' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toContainText('Typecheck completed without blocking problems.')
  expect(languageRequests.length).toBeGreaterThan(0)

  await dialog.getByRole('button', { name: 'Test', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toContainText('1 deterministic test(s) passed.', { timeout: 15_000 })
  await expect(dialog).toContainText('builtin.watershed-particles.generated · passed')

  await dialog.getByRole('button', { name: 'Run', exact: true }).click()
  const review = dialog.getByRole('alertdialog', { name: 'Capability review' })
  await expect(review).toContainText('analysis.dry-run')
  await review.getByRole('button', { name: 'Approve restricted run' }).click()
  await expect(dialog).toContainText('Sandbox run completed.', { timeout: 15_000 })
  await expect(dialog).toContainText('Action analysis.dry-run@1')
  expect(runtimeRequests.length).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.localStorage.getItem('OPENROUTER_API_KEY'))).toBeNull()

  await dialog.getByRole('button', { name: 'Install locally' }).click()
  await expect(review).toContainText('Review local installation')
  await review.getByRole('button', { name: 'Approve exact snapshot' }).click()
  await expect(dialog).toContainText('Installed this exact local content snapshot.')
  await expect(dialog.getByRole('button', { name: /Watershed particle script/u })).toContainText(
    'installed',
  )
})

test('cancels hostile code without changing the workspace revision', async ({ page }) => {
  await page.goto('/')
  const revision = await page
    .locator('.navigator-footer')
    .getByText(/Revision/u)
    .textContent()
  await page.getByRole('button', { name: 'Script Studio' }).click()
  const dialog = page.getByRole('dialog', { name: 'Script Studio' })
  await expect(dialog).toContainText('Local drafts ready.')
  await dialog.getByRole('button', { name: 'New', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toContainText('Created a local TypeScript draft.')
  const editor = dialog.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(
    "import 'unapproved-module'\nexport async function main() { return import('unapproved-module') }\nglobalThis.__scriptMain = main",
  )
  await dialog.getByRole('button', { name: 'Typecheck' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toContainText(
    'Dynamic import is not available in the restricted script environment.',
  )
  await expect(dialog).toContainText('Module is not permitted: unapproved-module')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(
    'export function main() { while (true) {} }\nglobalThis.__scriptMain = main',
  )
  await dialog.getByRole('button', { name: 'Save draft' }).focus()
  await page.keyboard.press('Enter')
  await dialog.getByRole('button', { name: 'Run', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('alertdialog', { name: 'Capability review' })).toContainText(
    'while',
  )
  await dialog.getByRole('button', { name: 'Approve restricted run' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toContainText('Cancelled active language and sandbox Workers.')
  await dialog.getByRole('button', { name: 'Close Script Studio' }).click()
  await expect(page.locator('.navigator-footer').getByText(/Revision/u)).toHaveText(revision ?? '')
})
