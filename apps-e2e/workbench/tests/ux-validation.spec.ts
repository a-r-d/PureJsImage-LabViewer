import { expect, test } from '@playwright/test'
import {
  openLegacyAnalysisControls,
  openSample,
  openWorkbench,
  waitForWorkbenchSettled,
} from './support/workbench.js'

interface UxMetrics {
  readonly events: readonly {
    readonly durationMilliseconds: number
    readonly kind: 'interaction' | 'task'
    readonly name: string
  }[]
  readonly layoutShiftScore: number
}

function readUxMetrics(): UxMetrics {
  const value = Reflect.get(window, '__PJI_UX_METRICS__')
  if (typeof value !== 'object' || value === null) throw new Error('UX metrics were not enabled.')
  return value as UxMetrics
}

test.beforeEach(async ({ page }) => {
  await openWorkbench(page)
})

test('@a11y keeps primary pointer targets at instrument-control size', async ({ page }) => {
  const targets = page.locator(
    '.app-bar button:visible, .mode-rail button:visible, .viewport-toolbar button:visible',
  )
  const sizes = await targets.evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBoundingClientRect()
      return {
        height: bounds.height,
        label: element.getAttribute('aria-label'),
        width: bounds.width,
      }
    }),
  )
  expect(sizes.length).toBeGreaterThan(8)
  for (const size of sizes) {
    expect.soft(size.height, `${size.label ?? 'labeled control'} height`).toBeGreaterThanOrEqual(30)
    expect.soft(size.width, `${size.label ?? 'labeled control'} width`).toBeGreaterThanOrEqual(30)
  }

  await page.getByRole('button', { name: 'Show agent readiness' }).focus()
  const tooltip = page.getByRole('tooltip', { name: 'Show agent readiness' })
  await expect(tooltip).toBeVisible()
  const bounds = await tooltip.boundingBox()
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  expect(bounds).not.toBeNull()
  if (bounds !== null) {
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewportWidth)
  }
})

test('keeps Browse selected for metadata and display inspection', async ({ page }) => {
  await openSample(page)
  const browse = page.getByRole('button', { name: 'Browse mode' })
  await expect(browse).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('tab', { name: 'Display' }).click()
  await expect(browse).toHaveAttribute('aria-pressed', 'true')
})

test('@a11y themes modal surfaces, contains keyboard focus, and restores the trigger', async ({
  page,
}) => {
  const projectsTrigger = page.getByRole('button', { name: 'Projects', exact: true })
  await projectsTrigger.focus()
  await projectsTrigger.click()
  const projects = page.getByRole('dialog', { name: 'Recent projects' })
  const importProject = projects.getByRole('button', { name: 'Import project' })
  await expect(projects).toHaveAttribute('aria-modal', 'true')
  await expect(importProject).toBeFocused()
  await expect
    .poll(() =>
      projects.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          actualBackground: style.backgroundColor,
          actualText: style.color,
          expectedBackground: style.getPropertyValue('--wb-surface'),
          expectedText: style.getPropertyValue('--wb-text'),
        }
      }),
    )
    .toEqual({
      actualBackground: 'rgb(16, 21, 27)',
      actualText: 'rgb(237, 243, 247)',
      expectedBackground: '#10151b',
      expectedText: '#edf3f7',
    })
  await importProject.press('Tab')
  await expect(projects.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(projects).toBeHidden()
  await expect(projectsTrigger).toBeFocused()

  const urlTrigger = page.locator('.app-bar').getByRole('button', { name: 'Open URL' })
  await urlTrigger.focus()
  await urlTrigger.click()
  const remote = page.getByRole('dialog', { name: 'Open remote scientific source' })
  const sourceUrl = remote.getByLabel('Source URL')
  await expect(remote).toHaveAttribute('aria-modal', 'true')
  await expect(sourceUrl).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(remote).toBeHidden()
  await expect(urlTrigger).toBeFocused()
})

test('@a11y keeps example actions visible and native filters on the active theme', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Examples mode' }).click()
  const gallery = page.getByRole('dialog', { name: 'Example library' })
  const firstCard = gallery.locator('.example-card').first()
  const primaryAction = firstCard.getByRole('button', { name: 'Open example' })
  const [cardBounds, actionBounds] = await Promise.all([
    firstCard.boundingBox(),
    primaryAction.boundingBox(),
  ])
  expect(cardBounds).not.toBeNull()
  expect(actionBounds).not.toBeNull()
  if (cardBounds !== null && actionBounds !== null) {
    expect(actionBounds.y).toBeGreaterThanOrEqual(cardBounds.y)
    expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(
      cardBounds.y + cardBounds.height,
    )
  }

  const readyTab = gallery.getByRole('tab', { name: 'Ready examples' })
  const plannedTab = gallery.getByRole('tab', { name: 'Planned datasets' })
  await readyTab.focus()
  await readyTab.press('ArrowRight')
  await expect(plannedTab).toBeFocused()
  await expect(plannedTab).toHaveAttribute('aria-selected', 'true')
  await plannedTab.press('ArrowLeft')
  await expect(readyTab).toBeFocused()
  await expect(readyTab).toHaveAttribute('aria-selected', 'true')

  const modality = gallery.getByLabel('Modality')
  expect(
    await modality.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        background: style.backgroundColor,
        color: style.color,
        expectedBackground: style.getPropertyValue('--wb-surface-raised'),
        expectedColor: style.getPropertyValue('--wb-text'),
      }
    }),
  ).toEqual({
    background: 'rgb(23, 30, 38)',
    color: 'rgb(237, 243, 247)',
    expectedBackground: '#171e26',
    expectedColor: '#edf3f7',
  })
})

test('@a11y remains usable at a 200-percent-equivalent CSS viewport', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 })
  await page.reload()
  await waitForWorkbenchSettled(page)
  await expect(page.getByRole('heading', { name: /Start with an original file/ })).toBeVisible()
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  await openSample(page)
  await expect(page.getByRole('img', { name: /Scientific image viewport/u })).toBeVisible()
})

test('@a11y keeps the example catalog operable at a 200-percent-equivalent viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 450 })
  await page.reload()
  await waitForWorkbenchSettled(page)
  await page.getByRole('button', { name: 'Examples mode' }).click()
  const gallery = page.getByRole('dialog', { name: 'Example library' })
  const results = gallery.locator('.example-gallery__results')
  await expect(gallery).toBeVisible()
  await expect
    .poll(async () => (await results.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(80)
  const openExample = gallery
    .locator('.example-card')
    .first()
    .getByRole('button', { name: 'Open example' })
  await openExample.scrollIntoViewIfNeeded()
  await expect(openExample).toBeVisible()
  expect(
    await gallery.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(0)

  await gallery.getByRole('tab', { name: 'Planned datasets' }).click()
  await expect(gallery.getByRole('button', { name: 'Browse ready examples' })).toBeVisible()
})

test('@a11y honors reduced motion for interactive shell controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true,
  )
  const timing = await page
    .locator('.mode-rail__button')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element)
      const seconds = (value: string): number =>
        Math.max(...value.split(',').map((part) => Number.parseFloat(part) || 0))
      return {
        animationSeconds: seconds(style.animationDuration),
        transitionSeconds: seconds(style.transitionDuration),
      }
    })
  expect(timing.animationSeconds).toBeLessThanOrEqual(0.000_001)
  expect(timing.transitionSeconds).toBeLessThanOrEqual(0.000_001)
})

test('@performance records local task, interaction, and layout-stability evidence', async ({
  browserName,
  page,
}) => {
  test.setTimeout(60_000)
  await openSample(page)
  await page.getByRole('tab', { name: 'ROI' }).click()
  await page.getByRole('button', { name: 'rectangle', exact: true }).click()
  const canvas = page.getByRole('img', { name: /Scientific image viewport/u })
  const box = await canvas.boundingBox()
  if (box === null) throw new Error('Scientific viewport was unavailable.')
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.42)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.56)
  await page.mouse.up()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await page.mouse.wheel(0, -220)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.52, { steps: 3 })
  await page.mouse.up({ button: 'middle' })
  await canvas.focus()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('tab', { name: 'Analysis' }).click()
  await openLegacyAnalysisControls(page)
  await page.getByRole('button', { name: 'Preview threshold' }).click()
  await expect(page.getByText(/Preview ready in/u)).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(50)

  const metrics = await page.evaluate(readUxMetrics)
  const names = new Set(metrics.events.map(({ name }) => name))
  for (const name of [
    'source.open',
    'inspector.tab',
    'roi.create',
    'viewport.zoom',
    'viewport.pan',
    'threshold.preview',
  ]) {
    expect(names, `${name} evidence`).toContain(name)
  }
  for (const event of metrics.events.filter(({ kind }) => kind === 'interaction')) {
    expect.soft(event.durationMilliseconds, `${event.name} next paint`).toBeLessThan(250)
  }
  if (browserName === 'chromium') expect(metrics.layoutShiftScore).toBeLessThanOrEqual(0.1)
})

test('supports narrow and wide desktop layouts without page overflow', async ({ page }) => {
  for (const viewport of [
    { width: 960, height: 720 },
    { width: 1_280, height: 720 },
    { width: 1_440, height: 900 },
    { width: 1_920, height: 1_080 },
  ]) {
    await page.setViewportSize(viewport)
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(0)
    await expect(page.getByRole('main')).toBeVisible()
  }
})
