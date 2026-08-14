import { expect, type Page } from '@playwright/test'

export interface WorkbenchMetrics {
  readonly reactRenders: number
  readonly viewportFrames: number
  readonly tilesTransferred: number
  readonly tileBytesTransferred: number
  readonly tilePixelsTransferred: number
  readonly largestTilePixels: number
  readonly sourceBytes: number
  readonly datasetPixels: number
  readonly firstTileMilliseconds: number | null
  readonly projectId: string
  readonly invocationIds: readonly string[]
}

export async function installDeterministicBrowserState(page: Page): Promise<void> {
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
}

export async function waitForWorkbenchSettled(page: Page): Promise<void> {
  const workbench = page.locator('[data-workbench-ready]')
  await expect(workbench).toHaveAttribute('data-workbench-ready', 'true')
  await expect(workbench).toHaveAttribute('data-render-settled', 'true')
  await expect(workbench).toHaveAttribute('data-analysis-settled', 'true')
  await page.evaluate(() => document.fonts.ready)
}

export async function openWorkbench(page: Page): Promise<void> {
  await installDeterministicBrowserState(page)
  await page.goto('/')
  await waitForWorkbenchSettled(page)
}

export async function openSample(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Try generated calibrated sample' }).click()
  await expect(page.getByRole('img', { name: /Scientific image viewport/u })).toBeVisible()
  await waitForWorkbenchSettled(page)
}

export async function openLegacyAnalysisControls(page: Page): Promise<void> {
  await page.getByText('Operation browser and legacy threshold controls', { exact: true }).click()
}

export async function centerViewportReadout(page: Page): Promise<string> {
  const canvas = page.getByRole('img', { name: /Scientific image viewport/u })
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
    .toMatch(/px · .+ · -?\d+(?:\.\d+)?$/u)
  return (await value.textContent()) ?? ''
}

export async function readWorkbenchMetrics(page: Page): Promise<WorkbenchMetrics> {
  return page.evaluate<WorkbenchMetrics>(() => Reflect.get(window, '__PJI_WORKBENCH_METRICS__'))
}
