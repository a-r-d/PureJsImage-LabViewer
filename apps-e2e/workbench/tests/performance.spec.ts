import { scenarioArtifact } from '@pji-workbench/test-corpus'
import { expect, test } from '@playwright/test'
import { attachScenarioEvidence } from './support/scenario-evidence.js'
import { openSample, openWorkbench } from './support/workbench.js'

test.beforeEach(async ({ page }) => {
  await openWorkbench(page)
})

test.afterEach(async ({ page }, testInfo) => {
  await attachScenarioEvidence(page, testInfo, scenarioArtifact('generated.calibrated-particles'), {
    capabilities: ['source.first-useful-tile'],
  })
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
  expect(metrics.largestTilePixels).toBeLessThan(metrics.datasetPixels)
  expect(metrics.tilePixelsTransferred).toBeGreaterThan(0)
  expect(metrics.sourceBytes).toBeGreaterThan(0)
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
