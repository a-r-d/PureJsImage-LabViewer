import { expect, test } from '@playwright/test'

test('lazy-loads and executes the built-in script through the dedicated QuickJS Worker', async ({
  page,
}) => {
  const runtimeRequests: string[] = []
  page.on('request', (request) => {
    if (/quickjs|wasmfile|\.wasm(?:\?|$)/iu.test(request.url())) runtimeRequests.push(request.url())
  })
  await page.goto('/')
  await expect(page.locator('[data-workbench-ready]')).toHaveAttribute(
    'data-workbench-ready',
    'true',
  )
  expect(runtimeRequests).toEqual([])

  await page.getByRole('button', { name: 'Scripts sandbox proof' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sandbox script proof' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Dedicated Worker + QuickJS-WASM')
  await expect(dialog).toContainText('analysis.dry-run')
  await expect(dialog.getByText(/sha256:[a-f0-9]{64}/u)).toBeVisible()
  await dialog.getByRole('button', { name: 'Validate contract' }).click()
  await expect(dialog).toContainText('Contract validation ready.')

  await dialog.getByRole('button', { name: 'Run in sandbox' }).click()
  await expect(dialog.getByText('completed', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(dialog).toContainText('Generated calibrated particles')
  await expect(dialog).toContainText('workspace.getSummary → workspace.summary.read@1 · allowed')
  await expect(dialog).toContainText('rois.propose → roi.create@1 · allowed')
  await expect(dialog).toContainText('proposal:roi-1')
  expect(runtimeRequests.length).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.localStorage.getItem('OPENROUTER_API_KEY'))).toBeNull()
})

test('exposes termination control and leaves workspace revision unchanged', async ({ page }) => {
  await page.goto('/')
  const revision = await page
    .locator('.navigator-footer')
    .getByText(/Revision/u)
    .textContent()
  await page.getByRole('button', { name: 'Scripts sandbox proof' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sandbox script proof' })
  await expect(dialog.getByRole('button', { name: 'Cancel and terminate Worker' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Run in sandbox' }).click()
  await expect(dialog.getByText('completed', { exact: true })).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Close Scripts sandbox' }).click()
  await expect(page.locator('.navigator-footer').getByText(/Revision/u)).toHaveText(revision ?? '')
})
