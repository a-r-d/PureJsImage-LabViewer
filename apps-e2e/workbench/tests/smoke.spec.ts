import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

async function openSample(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Try generated calibrated sample' }).click()
  await expect(page.getByRole('img', { name: /Scientific image viewport/ })).toBeVisible()
  await waitForWorkbenchSettled(page)
}

async function waitForWorkbenchSettled(page: Page): Promise<void> {
  const workbench = page.locator('[data-workbench-ready]')
  await expect(workbench).toHaveAttribute('data-workbench-ready', 'true')
  await expect(workbench).toHaveAttribute('data-render-settled', 'true')
  await expect(workbench).toHaveAttribute('data-analysis-settled', 'true')
  await page.evaluate(() => document.fonts.ready)
}

async function centerViewportReadout(page: Page): Promise<string> {
  const canvas = page.getByRole('img', { name: /Scientific image viewport/ })
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return ''
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const value = page.locator('.mock-viewport__readout span').first()
  await expect
    .poll(
      async () => {
        await page.mouse.move(center.x + 1, center.y)
        await page.mouse.move(center.x, center.y)
        return (await value.textContent()) ?? ''
      },
      { timeout: 15_000 },
    )
    .toMatch(/px · .+ · -?\d+(?:\.\d+)?$/)
  return (await value.textContent()) ?? ''
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const storageResetKey = '__pji_playwright_storage_reset__'
    if (window.sessionStorage.getItem(storageResetKey) === null) {
      window.localStorage.clear()
      window.sessionStorage.setItem(storageResetKey, 'true')
    }
    let uuid = 0
    Object.defineProperty(window.crypto, 'randomUUID', {
      configurable: true,
      value: () => {
        uuid += 1
        return `00000000-0000-4000-8000-${uuid.toString().padStart(12, '0')}`
      },
    })
    Object.defineProperties(Date.prototype, {
      toLocaleString: { configurable: true, value: () => 'Jan 15, 2026, 12:00:00 PM' },
      toLocaleTimeString: { configurable: true, value: () => '12:00:00 PM' },
    })
  })
  await page.goto('/')
  await waitForWorkbenchSettled(page)
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

test('@performance keeps pan and zoom outside broad React rendering', async ({ page }) => {
  await openSample(page)
  const canvas = page.getByRole('img', { name: /Scientific image viewport/ })
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return
  await page.waitForTimeout(250)
  const before = await page.evaluate(() => ({ ...window.__PJI_WORKBENCH_METRICS__ }))
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45)
  await page.mouse.wheel(0, -280)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.53, { steps: 7 })
  await page.mouse.up({ button: 'middle' })
  await page.waitForFunction(
    (previousFrames) => window.__PJI_WORKBENCH_METRICS__.viewportFrames > previousFrames,
    before.viewportFrames,
  )
  const after = await page.evaluate(() => ({ ...window.__PJI_WORKBENCH_METRICS__ }))
  expect(after.reactRenders).toBe(before.reactRenders)
  expect(after.viewportFrames).toBeGreaterThan(before.viewportFrames)
  await expect(page.locator('.mock-viewport__readout')).not.toContainText('100%')
})

test('@performance transfers bounded tiles rather than a whole plane', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 720 })
  await openSample(page)
  await page.waitForTimeout(300)
  const metrics = await page.evaluate(() => ({ ...window.__PJI_WORKBENCH_METRICS__ }))
  expect(metrics.firstTileMilliseconds).not.toBeNull()
  expect(metrics.largestTilePixels).toBeLessThanOrEqual(256 * 256)
  expect(metrics.tilePixelsTransferred).toBeGreaterThan(0)
  expect(metrics.tilePixelsTransferred).toBeLessThan(metrics.datasetPixels)
  expect(metrics.sourceBytes).toBeGreaterThan(0)
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

test('saves and numerically replays a semantic project after a browser reload', async ({
  page,
}) => {
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).click()
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
  await expect(page.getByText(/Replayed saved numerical analysis/)).toBeVisible({ timeout: 15_000 })
  await waitForWorkbenchSettled(page)
  expect(await centerViewportReadout(page)).toBe(beforeReload)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
})

test('draws and measures an ROI with bounded Worker results', async ({ page }) => {
  await openSample(page)
  await page.getByRole('tab', { name: 'ROI' }).click()
  await page.getByRole('button', { name: 'rectangle', exact: true }).click()
  const canvas = page.getByRole('img', { name: /Scientific image viewport/ })
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.58)
  await page.mouse.up()
  await expect(
    page.getByRole('list', { name: 'Regions of interest' }).getByRole('listitem'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Statistics' }).click()
  await expect(page.getByTestId('analysis-results')).toContainText('1 bounded outputs')
  await expect(page.getByTestId('analysis-results')).toContainText('statistics')
  await page.getByRole('button', { name: 'Pin result' }).click()
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
})

test('previews, commits, plans, and executes threshold connected components', async ({ page }) => {
  test.setTimeout(60_000)
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).click()
  await waitForWorkbenchSettled(page)
  await page.getByLabel('Threshold value').fill('175')
  await page.getByRole('button', { name: 'Preview threshold' }).click()
  await expect(page.getByText(/Preview ready in/)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Apply threshold' }).click()
  await expect(
    page.getByText('Threshold committed as one semantic project revision.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Plan connected components' }).click()
  await expect(page.getByText(/Connected-components plan ready/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run connected components' })).toBeEnabled()
  await page.getByRole('button', { name: 'Run connected components' }).click()
  await expect(page.getByTestId('analysis-results')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('analysis-results')).toContainText(/objects/)
  await expect(page.getByRole('region', { name: 'Paged object measurements' })).toBeVisible()
  const firstLabel = page.getByRole('button', { name: /Select label/ }).first()
  await firstLabel.click()
  await expect(firstLabel).toHaveAttribute('aria-pressed', 'true')
})

test('supports a keyboard-only threshold commit path', async ({ page }) => {
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).focus()
  await page.keyboard.press('Enter')
  await page.getByLabel('Threshold value').focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('175')
  await page.getByRole('button', { name: 'Preview threshold' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Preview ready in/)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Apply threshold' }).focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByText('Threshold committed as one semantic project revision.'),
  ).toBeVisible()
})

test('searches, favorites, previews, cancels, and applies a toolbox operation', async ({
  page,
}) => {
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).click()
  await page.getByLabel('Search operations').fill('unsharp')
  await page
    .getByRole('button', { name: /Unsharp mask/ })
    .first()
    .click()
  const detail = page.getByRole('region', { name: 'Selected operation' })
  await expect(detail.getByRole('heading', { name: 'Unsharp mask' })).toBeVisible()
  await page.getByRole('button', { name: 'Add Unsharp mask to favorites' }).click()
  await detail.getByRole('button', { name: 'Preview' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Preview ready in/)).toBeVisible({ timeout: 15_000 })
  await detail.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText(/Preview cancelled/)).toBeVisible()
  await detail.getByRole('button', { name: 'Apply' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Analysis completed in/)).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Search operations').fill('')
  await page.getByRole('button', { name: 'Recent' }).click()
  await expect(page.getByRole('button', { name: /Unsharp mask/ }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Favorites', exact: true }).click()
  await expect(page.getByRole('button', { name: /Unsharp mask/ }).first()).toBeVisible()
})

test('chains crop and filtering into a line profile and bounded CSV export', async ({ page }) => {
  test.setTimeout(60_000)
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).click()
  await page.getByLabel('Search operations').fill('crop scientific')
  await page
    .getByRole('button', { name: /Crop scientific dataset/ })
    .first()
    .click()
  const detail = page.getByRole('region', { name: 'Selected operation' })
  await detail.getByLabel('x', { exact: true }).fill('0')
  await detail.getByLabel('y', { exact: true }).fill('0')
  await detail.getByLabel('width', { exact: true }).fill('64')
  await detail.getByLabel('height', { exact: true }).fill('64')
  await detail.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText(/Analysis completed in/)).toBeVisible({ timeout: 15_000 })

  await page.getByLabel('Search operations').fill('mean box')
  await page
    .getByRole('button', { name: /Mean \/ box filter/ })
    .first()
    .click()
  await detail.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText(/Analysis completed in/)).toBeVisible({ timeout: 15_000 })

  await page.getByRole('tab', { name: 'ROI' }).click()
  await page.getByRole('button', { name: 'line', exact: true }).click()
  const canvas = page.getByRole('img', { name: /Scientific image viewport/ })
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Line profile' }).click()
  const results = page.getByTestId('analysis-results')
  await expect(results).toContainText('profile', { timeout: 15_000 })
  const downloadPromise = page.waitForEvent('download')
  await results.getByRole('button', { name: 'Export all CSV' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('purejsimage-analysis.csv')
  const path = await download.path()
  expect(path).not.toBeNull()
  if (path !== null) {
    const csv = await readFile(path, 'utf8')
    expect(csv).toContain('distance')
    expect(csv.trim().split('\n').length).toBeGreaterThan(2)
  }
})

test('calibrates from a known line, measures in physical units, and reloads the override', async ({
  page,
}) => {
  await openSample(page)
  await page.getByRole('tab', { name: 'ROI' }).click()
  await page.getByRole('button', { name: 'line', exact: true }).click()
  const canvas = page.getByRole('img', { name: /Scientific image viewport/ })
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5)
  await page.mouse.up()
  await page.getByLabel('Known line distance').fill('10')
  await page.getByRole('button', { name: 'Calibrate from selected line' }).click()
  await expect(page.getByRole('status', { name: 'Workbench status' })).toContainText(
    'project known-line override',
  )
  await expect(page.getByRole('list', { name: 'Regions of interest' })).toContainText('10.00 nm')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.reload()
  await waitForWorkbenchSettled(page)
  await expect(page.getByRole('status', { name: 'Workbench status' })).toContainText(
    'project known-line override',
  )
})

test('@a11y analysis controls and results have no serious violations', async ({ page }) => {
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).click()
  const results = await new AxeBuilder({ page }).analyze()
  expect(
    results.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([])
})

test('@visual materials analysis inspector', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).click()
  await expect(page).toHaveScreenshot('workbench-materials-analysis.png', {
    animations: 'disabled',
  })
})

test('collapses the navigator on a narrow desktop while preserving the viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 720 })
  await expect(page.getByRole('region', { name: 'Workspace navigator' })).toBeHidden()
  await expect(page.getByRole('region', { name: 'Image viewport' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Inspector' })).toBeVisible()
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
})

test('@visual empty workspace', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page).toHaveScreenshot('workbench-empty-scientific.png', { animations: 'disabled' })
})

test('@visual opened scientific workspace', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  await waitForWorkbenchSettled(page)
  await expect(page).toHaveScreenshot('workbench-opened-scientific.png', { animations: 'disabled' })
})

test('@visual display controls', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  await page.getByRole('tab', { name: 'Display' }).click()
  await waitForWorkbenchSettled(page)
  await expect(page).toHaveScreenshot('workbench-display-scientific.png', {
    animations: 'disabled',
  })
})

test('@visual agent panel state', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  await page.getByRole('button', { name: 'Show agent panel' }).click()
  await expect(page.getByTestId('agent-panel')).toBeVisible()
  await waitForWorkbenchSettled(page)
  await expect(page).toHaveScreenshot('workbench-agent-scientific.png', { animations: 'disabled' })
})

test('@performance reaches an interactive shell within the warm budget', async ({ page }) => {
  const interactiveMilliseconds = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0]
    return navigation instanceof PerformanceNavigationTiming
      ? navigation.domInteractive
      : Number.POSITIVE_INFINITY
  })
  expect(interactiveMilliseconds).toBeLessThan(1_000)
})
