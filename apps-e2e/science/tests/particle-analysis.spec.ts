import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { scenarioArtifact } from '@pji-workbench/test-corpus'
import { expect, test } from '@playwright/test'
import { attachScenarioEvidence } from './support/scenario-evidence.js'
import { openSample, openWorkbench, waitForWorkbenchSettled } from './support/workbench.js'

test.beforeEach(async ({ page }) => {
  await openWorkbench(page)
})

test.afterEach(async ({ page }, testInfo) => {
  await attachScenarioEvidence(page, testInfo, scenarioArtifact('generated.calibrated-particles'), {
    capabilities: ['analysis.components-filtering-measurements', 'results.linked-selection'],
  })
})

test('completes the keyboard-guided particle workflow with linked results and recipe replay', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openSample(page)
  await page.getByRole('tab', { name: 'Analysis' }).focus()
  await page.keyboard.press('Enter')
  const workflow = page.getByRole('region', { name: 'Particle analysis', exact: true })
  await expect(workflow).toBeVisible()
  await expect(workflow.getByLabel('Visible particle operation graph')).toContainText(
    'Connected components',
  )
  const run = workflow.getByRole('button', { name: 'Run particle analysis' })
  await expect(run).toBeDisabled()

  await workflow.getByRole('button', { name: 'Preview histogram and mask' }).focus()
  await page.keyboard.press('Enter')
  await expect(workflow.getByText(/Preview ready in/)).toBeVisible({ timeout: 30_000 })
  await expect(run).toBeDisabled()

  await workflow.getByRole('button', { name: 'Dry-run full workflow' }).focus()
  await page.keyboard.press('Enter')
  await expect(workflow.getByText(/Particle workflow plan is ready/)).toBeVisible({
    timeout: 30_000,
  })
  await expect(run).toBeEnabled()
  await run.focus()
  await page.keyboard.press('Enter')
  await expect(workflow.getByText(/Counted \d+ particles in|Analysis completed in/u)).toBeVisible({
    timeout: 60_000,
  })

  const results = page.getByTestId('analysis-results')
  const particleTable = results
    .getByRole('region', { name: 'Paged object measurements' })
    .getByRole('table')
  await expect(particleTable).toBeVisible()
  await expect(
    results.getByRole('region', { name: 'Complete particle size distribution' }),
  ).toBeVisible()
  const firstLabel = results.getByRole('button', { name: /Select label/ }).first()
  await firstLabel.focus()
  await page.keyboard.press('Enter')
  await expect(firstLabel).toHaveAttribute('aria-pressed', 'true')
  await workflow.getByLabel('Overlay view').selectOption('numbered')

  const headers = await particleTable.locator('thead th').allTextContents()
  const boundingXColumn = headers.findIndex((header) => header.startsWith('boundingX'))
  const boundingYColumn = headers.findIndex((header) => header.startsWith('boundingY'))
  const boundingWidthColumn = headers.findIndex((header) => header.startsWith('boundingWidth'))
  const boundingHeightColumn = headers.findIndex((header) => header.startsWith('boundingHeight'))
  expect(boundingXColumn).toBeGreaterThanOrEqual(0)
  expect(boundingYColumn).toBeGreaterThanOrEqual(0)
  expect(boundingWidthColumn).toBeGreaterThanOrEqual(0)
  expect(boundingHeightColumn).toBeGreaterThanOrEqual(0)
  const firstRow = particleTable.locator('tbody tr').first()
  const boundingX = Number(await firstRow.locator('td').nth(boundingXColumn).textContent())
  const boundingY = Number(await firstRow.locator('td').nth(boundingYColumn).textContent())
  const boundingWidth = Number(await firstRow.locator('td').nth(boundingWidthColumn).textContent())
  const boundingHeight = Number(
    await firstRow.locator('td').nth(boundingHeightColumn).textContent(),
  )
  const targetLabel = (await firstLabel.getAttribute('aria-label'))?.replace('Select label ', '')
  expect(targetLabel).toMatch(/^\d+$/u)
  await page.getByRole('button', { name: 'Fit image' }).click()
  await waitForWorkbenchSettled(page)
  const canvas = page.getByRole('img', { name: /Scientific image viewport/ })
  const canvasBox = await canvas.boundingBox()
  expect(canvasBox).not.toBeNull()
  if (canvasBox !== null) {
    const fittedCenterX = Number(await canvas.getAttribute('data-camera-center-x'))
    const fittedCenterY = Number(await canvas.getAttribute('data-camera-center-y'))
    const fittedZoom = Number(await canvas.getAttribute('data-camera-zoom'))
    await page.mouse.move(
      canvasBox.x +
        canvasBox.width / 2 +
        (boundingX + boundingWidth / 2 - fittedCenterX) * fittedZoom,
      canvasBox.y +
        canvasBox.height / 2 +
        (boundingY + boundingHeight / 2 - fittedCenterY) * fittedZoom,
    )
    await page.mouse.wheel(0, -1_500)
    await waitForWorkbenchSettled(page)
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-overlay-tile-count')), {
        message: `overlay=${await canvas.getAttribute('data-analysis-overlay')} view=${await canvas.getAttribute('data-analysis-overlay-view')} status=${await page.locator('.mock-viewport__readout').textContent()}`,
      })
      .toBeGreaterThan(0)
    const cameraCenterX = Number(await canvas.getAttribute('data-camera-center-x'))
    const cameraCenterY = Number(await canvas.getAttribute('data-camera-center-y'))
    const cameraZoom = Number(await canvas.getAttribute('data-camera-zoom'))
    expect(cameraZoom).toBeGreaterThan(1)
    await canvas.click({ position: { x: 4, y: 4 } })
    await expect(firstLabel).toHaveAttribute('aria-pressed', 'false')
    await waitForWorkbenchSettled(page)
    let linkedFromViewport = false
    for (let y = boundingY; y < boundingY + boundingHeight && !linkedFromViewport; y += 1) {
      for (let x = boundingX; x < boundingX + boundingWidth; x += 1) {
        await canvas.click({
          position: {
            x: canvasBox.width / 2 + (x + 0.5 - cameraCenterX) * cameraZoom,
            y: canvasBox.height / 2 + (y + 0.5 - cameraCenterY) * cameraZoom,
          },
        })
        linkedFromViewport = (await canvas.getAttribute('data-last-hit-label')) === targetLabel
        if (linkedFromViewport) break
      }
    }
    expect({
      linkedFromViewport,
      lastHitLabel: await canvas.getAttribute('data-last-hit-label'),
      targetLabel,
    }).toEqual({ linkedFromViewport: true, lastHitLabel: targetLabel, targetLabel })
    await expect(firstLabel).toHaveAttribute('aria-pressed', 'true')
  }

  const firstDownloadPromise = page.waitForEvent('download')
  await results.getByRole('button', { name: 'Export all CSV' }).click()
  const firstDownload = await firstDownloadPromise
  const firstPath = await firstDownload.path()
  expect(firstPath).not.toBeNull()
  const secondDownloadPromise = page.waitForEvent('download')
  await results.getByRole('button', { name: 'Export all CSV' }).click()
  const secondDownload = await secondDownloadPromise
  const secondPath = await secondDownload.path()
  expect(secondPath).not.toBeNull()
  if (firstPath !== null && secondPath !== null) {
    const firstCsv = await readFile(firstPath, 'utf8')
    const secondCsv = await readFile(secondPath, 'utf8')
    expect(firstCsv).toBe(secondCsv)
    expect(firstCsv).toContain('pixelArea')
    expect(firstCsv).toContain('physicalArea')
  }

  const recipeDownloadPromise = page.waitForEvent('download')
  await workflow.getByRole('button', { name: 'Save recipe JSON' }).click()
  const recipeDownload = await recipeDownloadPromise
  expect(recipeDownload.suggestedFilename()).toBe('particle-analysis.recipe.json')
  const recipePath = await recipeDownload.path()
  expect(recipePath).not.toBeNull()
  if (recipePath !== null) {
    const recipe = JSON.parse(await readFile(recipePath, 'utf8')) as {
      readonly operations?: readonly { readonly actionId?: string }[]
    }
    expect(recipe.operations?.[0]?.actionId).toBe('analysis.graph.request-execute')
  }
  await workflow.getByRole('button', { name: 'Open recipe in Scripts' }).click()
  const scriptDialog = page.getByRole('dialog', { name: 'Script Studio' })
  await expect(scriptDialog).toContainText('Recipe')
  await expect(scriptDialog).toContainText('analysis.graph.request-execute')
  await expect(scriptDialog).toContainText('"actionVersion": 1')

  const accessibility = await new AxeBuilder({ page }).include('.particle-workflow').analyze()
  expect(
    accessibility.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([])
  await scriptDialog.getByRole('button', { name: 'Close Script Studio' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved locally')).toBeVisible()
  await page.reload()
  await waitForWorkbenchSettled(page)
  await page.getByRole('tab', { name: 'Pipeline' }).click()
  await expect(page.getByRole('region', { name: 'Analysis output' })).toContainText(
    'Filter and measure particles',
  )
})
