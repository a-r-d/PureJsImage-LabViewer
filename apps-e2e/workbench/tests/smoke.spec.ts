import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

async function openSample(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Try generated calibrated sample' }).click()
  await expect(page.getByRole('img', { name: /Scientific image viewport/ })).toBeVisible()
  await page.waitForFunction(() => window.__PJI_WORKBENCH_METRICS__.tilesTransferred > 0)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
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
  await expect(page).toHaveScreenshot('workbench-opened-scientific.png', { animations: 'disabled' })
})

test('@visual display controls', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  await page.getByRole('tab', { name: 'Display' }).click()
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
