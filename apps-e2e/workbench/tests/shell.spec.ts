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

test('exposes the workbench landmarks and local-first source controls', async ({ page }) => {
  await expect(page).toHaveTitle('Materials Workbench')
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'PureJsImage Lab' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open files' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open URL' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Project contents' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Image viewport' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Inspector' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Analysis output' })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Workbench status' })).toContainText(
    'Files stay on this device',
  )
})

test('supports keyboard tab navigation and splitter resizing', async ({ page }) => {
  await openSample(page)
  const inspectorSplitter = page.getByRole('separator', { name: 'Resize inspector' })
  await inspectorSplitter.focus()
  const previous = Number(await inspectorSplitter.getAttribute('aria-valuenow'))
  await page.keyboard.press('ArrowLeft')
  await expect(inspectorSplitter).toHaveAttribute('aria-valuenow', String(previous - 16))

  const infoTab = page.getByRole('tab', { name: 'Info' })
  await infoTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Display' })).toHaveAttribute('aria-selected', 'true')

  const navigatorSplitter = page.getByRole('separator', { name: 'Resize navigator' })
  const box = await navigatorSplitter.boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return
  const beforeDrag = Number(await navigatorSplitter.getAttribute('aria-valuenow'))
  await page.mouse.move(box.x + box.width / 2, box.y + 30)
  await page.mouse.down()
  await page.mouse.move(box.x + 42, box.y + 30)
  await page.mouse.up()
  await expect(navigatorSplitter).toHaveAttribute('aria-valuenow', String(beforeDrag + 40))
})

test('opens, filters, closes, and restores focus around the command palette', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Open command palette' })
  await trigger.focus()
  await page.keyboard.press('Control+K')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  const search = page.getByRole('textbox', { name: 'Search commands' })
  await expect(search).toBeFocused()
  await search.fill('theme')
  await expect(page.getByRole('option', { name: /Toggle color theme/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()
  await expect(trigger).toBeFocused()

  await page.keyboard.press('Control+K')
  await page.getByRole('textbox', { name: 'Search commands' }).fill('theme')
  await page.getByRole('option', { name: /Toggle color theme/ }).click()
  await expect(palette).toBeHidden()
  await expect(page.locator('.workbench-theme')).toHaveAttribute('data-theme', 'light')
})

test('persists theme, panel preferences, and source names without file contents', async ({
  page,
}) => {
  await openSample(page)
  await page.getByRole('button', { name: 'Use light theme' }).click()
  await expect(page.locator('.workbench-theme')).toHaveAttribute('data-theme', 'light')
  const splitter = page.getByRole('separator', { name: 'Resize navigator' })
  await splitter.focus()
  await page.keyboard.press('ArrowRight')
  const width = await splitter.getAttribute('aria-valuenow')
  const persisted = await page.evaluate(() => ({ ...localStorage }))
  expect(JSON.stringify(persisted)).not.toContain('Generated calibrated SEM-like surface')
  await page.reload()
  await expect(page.locator('.workbench-theme')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('separator', { name: 'Resize navigator' })).toHaveAttribute(
    'aria-valuenow',
    width ?? '',
  )
  await expect(page.getByText('sample-sem.gsf')).toBeVisible()
  await expect(page.getByText('rebind required')).toBeVisible()
})

test('collapses the navigator on a narrow desktop while preserving the viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 720 })
  await expect(page.getByRole('region', { name: 'Workspace navigator' })).toBeHidden()
  await expect(page.getByRole('region', { name: 'Image viewport' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Inspector' })).toBeVisible()
})
