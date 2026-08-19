import { expect, test } from '@playwright/test'
import { openWorkbench, waitForWorkbenchSettled } from './support/workbench.js'

const LOCAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('boots the science workbench and serves the UI lab route', async ({ page }) => {
  await openWorkbench(page)
  await expect(page).toHaveTitle('Materials Workbench')
  await expect(page.getByRole('heading', { level: 1, name: 'PureJsImage Lab' })).toBeVisible()
  await expect(page.locator('[data-workbench-ready]')).toHaveAttribute(
    'data-workbench-ready',
    'true',
  )

  await page.goto('/__ui-lab?theme=dark')
  const lab = page.locator('[data-workbench-ready]')
  await expect(lab).toHaveAttribute('data-workbench-ready', 'true')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PureJsImage Lab · UI system V2')
})

test('opens a bundled example from the gallery', async ({ page }) => {
  test.setTimeout(60_000)
  await openWorkbench(page)
  await page.getByRole('button', { name: 'Examples mode' }).click()
  const gallery = page.getByRole('dialog', { name: 'Example library' })
  await gallery.getByRole('searchbox', { name: 'Search' }).fill('E. coli colony')
  const card = gallery.locator('.example-card').filter({ hasText: 'E. coli colony (real SEM)' })
  await card.getByRole('button', { name: 'Open analyzed example', exact: true }).click()
  await expect(gallery).toBeHidden({ timeout: 30_000 })
  await waitForWorkbenchSettled(page)
  await expect(page.getByRole('img', { name: /Scientific image viewport/u })).toBeVisible()
  await expect(page.getByRole('button', { name: 'e-coli-sem.gsf example' })).toBeVisible()
  await expect(page.locator('.analysis-message, .result-count').first()).toContainText(
    /Analysis completed|Counted \d+|particles counted/u,
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
})

test('opens a local source through the file picker', async ({ page }) => {
  await openWorkbench(page)
  await page.getByLabel('Choose local scientific files').setInputFiles({
    name: 'characterization-pixel.png',
    mimeType: 'image/png',
    buffer: LOCAL_PNG,
  })
  await expect(page.getByRole('img', { name: /Scientific image viewport/u })).toBeVisible({
    timeout: 15_000,
  })
  await waitForWorkbenchSettled(page)
  await expect(
    page.getByRole('button', { name: 'characterization-pixel.png local file' }),
  ).toBeVisible()
})
