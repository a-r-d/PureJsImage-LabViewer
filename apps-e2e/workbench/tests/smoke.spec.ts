import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

async function openSample(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Try sample SEM image' }).click()
  await expect(page.getByRole('img', { name: /Mock SEM image viewport/ })).toBeVisible()
  await page.waitForFunction(() => window.__PJI_WORKBENCH_METRICS__.viewportFrames > 0)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('exposes the workbench landmarks and accessible names', async ({ page }) => {
  await expect(page).toHaveTitle('Materials Workbench')
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'PureJsImage Lab' })).toBeVisible()
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
})

test('@performance keeps pan and zoom outside broad React rendering', async ({ page }) => {
  await openSample(page)
  const canvas = page.getByRole('img', { name: /Mock SEM image viewport/ })
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return
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

test('persists theme and panel preferences across reloads', async ({ page }) => {
  await page.getByRole('button', { name: 'Use light theme' }).click()
  await expect(page.locator('.workbench-theme')).toHaveAttribute('data-theme', 'light')
  const splitter = page.getByRole('separator', { name: 'Resize navigator' })
  await splitter.focus()
  await page.keyboard.press('ArrowRight')
  const width = await splitter.getAttribute('aria-valuenow')
  await page.reload()
  await expect(page.locator('.workbench-theme')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('separator', { name: 'Resize navigator' })).toHaveAttribute(
    'aria-valuenow',
    width ?? '',
  )
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
  await expect(page).toHaveScreenshot('workbench-empty.png', { animations: 'disabled' })
})

test('@visual opened mock workspace', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  await expect(page).toHaveScreenshot('workbench-opened-mock.png', { animations: 'disabled' })
})

test('@visual selected ROI state', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  await page.getByRole('button', { name: 'Precipitate field ROI' }).click()
  await expect(page.getByText('59,182 nm²')).toBeVisible()
  await expect(page).toHaveScreenshot('workbench-roi-selected.png', { animations: 'disabled' })
})

test('@visual agent panel state', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Chromium owns the deterministic visual baselines.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  await page.getByRole('button', { name: 'Show agent panel' }).click()
  await expect(page.getByTestId('agent-panel')).toBeVisible()
  await page.getByRole('img', { name: /Mock SEM image viewport/ }).focus()
  await page.mouse.move(720, 500)
  await expect(page).toHaveScreenshot('workbench-agent-panel.png', { animations: 'disabled' })
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
