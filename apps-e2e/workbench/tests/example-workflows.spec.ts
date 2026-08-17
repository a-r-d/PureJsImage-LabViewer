import { expect, test } from '@playwright/test'
import { openWorkbench } from './support/workbench.js'

test.beforeEach(async ({ page }) => {
  await openWorkbench(page)
})

test('browses, filters, opens, and prepares verified example workflows without network', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Examples mode' }).click()
  const gallery = page.getByRole('dialog', { name: 'Example library' })
  await expect(gallery).toContainText('9 ready')
  await expect(gallery.locator('.example-card')).toHaveCount(9)
  await gallery.getByRole('searchbox', { name: 'Search' }).fill('roughness')
  const afm = gallery.locator('.example-card').filter({ hasText: 'Tilted AFM surface' })
  await expect(afm).toContainText('CC0-1.0')
  const openExample = afm.getByRole('button', { name: 'Open example', exact: true })
  const [cardBounds, actionBounds] = await Promise.all([
    afm.boundingBox(),
    openExample.boundingBox(),
  ])
  expect(cardBounds).not.toBeNull()
  expect(actionBounds).not.toBeNull()
  if (cardBounds !== null && actionBounds !== null) {
    expect(actionBounds.y).toBeGreaterThanOrEqual(cardBounds.y)
    expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(
      cardBounds.y + cardBounds.height,
    )
  }
  await openExample.click()
  await expect(gallery).toBeHidden()
  await expect(page.getByRole('button', { name: 'afm-tilted-surface.gsf sample' })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Workbench status' })).toContainText('2 nm/px')
  await page.getByLabel('Project title').fill('AFM corpus replay')
  await page.getByLabel('Project title').blur()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'afm-tilted-surface.gsf sample' })).toBeVisible()
  await expect(page.getByRole('img', { name: /Scientific image viewport/ })).toBeVisible()
  await page.getByRole('button', { name: 'New', exact: true }).click()

  await page.getByRole('button', { name: 'Examples mode' }).click()
  await expect(
    gallery.locator('.example-card').filter({ hasText: 'Tilted AFM surface' }),
  ).toContainText('Recent')
  await gallery.getByRole('searchbox', { name: 'Search' }).fill('radial peaks')
  const fft = gallery.locator('.example-card').filter({ hasText: 'Periodic lattice and FFT' })
  await fft.getByRole('button', { name: 'Run workflow' }).click()
  const studio = page.getByRole('dialog', { name: 'Script Studio' })
  await expect(studio).toBeVisible()
  await expect(studio.locator('.script-studio__artifact[aria-pressed="true"]')).toContainText(
    'FFT radial-profile script',
  )
  await expect(studio.getByLabel('Test fixture')).toHaveValue('generated.periodic-lattice')
  await studio.getByRole('button', { name: 'Close Script Studio' }).click()

  await page.getByRole('button', { name: 'Examples mode' }).click()
  await gallery.getByRole('tab', { name: 'Planned datasets' }).click()
  await expect(gallery).toContainText('Planned datasets are not available to open yet.')
  await expect(gallery.getByRole('button', { name: 'Browse ready examples' })).toBeVisible()
  await gallery.getByRole('searchbox', { name: 'Search' }).fill('Aperio')
  const aperio = gallery.locator('.example-card').filter({ hasText: 'Aperio CMU-1 whole slide' })
  await expect(aperio).toContainText('scheduled')
  await expect(aperio).toContainText('Not available:')
  await expect(aperio.getByRole('button', { name: 'Open example', exact: true })).toHaveCount(0)
})
