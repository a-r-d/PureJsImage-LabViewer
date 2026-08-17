import { scenarioArtifact } from '@pji-workbench/test-corpus'
import { expect, test } from '@playwright/test'
import { attachScenarioEvidence } from './support/scenario-evidence.js'
import { openSample, openWorkbench, waitForWorkbenchSettled } from './support/workbench.js'

test.beforeEach(async ({ page }) => {
  await openWorkbench(page)
})

test.afterEach(async ({ page }, testInfo) => {
  await attachScenarioEvidence(page, testInfo, scenarioArtifact('generated.calibrated-particles'), {
    capabilities: ['roi.all-types-and-units'],
  })
})

test('draws and measures an ROI with bounded Worker results', async ({ page }) => {
  await openSample(page)
  await page.getByRole('tab', { name: 'ROI' }).click()
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
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
  await expect(page.getByTestId('analysis-results')).toContainText('1 result')
  await expect(page.getByTestId('analysis-results')).toContainText('statistics')
  await page.getByRole('button', { name: 'Pin result' }).click()
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
})

test('creates every ROI geometry with calibrated measurements', async ({ page }) => {
  await openSample(page)
  await page.getByRole('tab', { name: 'ROI' }).click()
  const canvas = page.getByRole('img', { name: /Scientific image viewport/u })
  const tools = ['line', 'polyline', 'rectangle', 'ellipse', 'polygon', 'point'] as const

  for (const [index, tool] of tools.entries()) {
    const toolButton = page.getByRole('button', { name: tool, exact: true })
    await toolButton.focus()
    await page.keyboard.press('Enter')
    await expect(toolButton).toHaveAttribute('aria-pressed', 'true')
    const box = await canvas.boundingBox()
    if (box === null) throw new Error('Scientific viewport disappeared while drawing ROIs.')
    const start = {
      x: box.x + box.width * (0.32 + index * 0.025),
      y: box.y + box.height * (0.34 + index * 0.025),
    }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 36, start.y + 28)
    await page.mouse.up()
    await expect(
      page.getByRole('list', { name: 'Regions of interest' }).getByRole('listitem'),
    ).toHaveCount(index + 1)
    await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }

  const regions = page.getByRole('list', { name: 'Regions of interest' })
  await expect(regions.getByRole('listitem')).toHaveCount(tools.length)
  for (const kind of ['point', 'line-segment', 'polyline', 'rectangle', 'ellipse', 'polygon'])
    await expect(regions).toContainText(`${kind} ROI`)
  await expect(regions).toContainText('nm')
})

test('calibrates from a known line, measures in physical units, and reloads the override', async ({
  page,
}) => {
  await openSample(page)
  await page.getByRole('tab', { name: 'ROI' }).click()
  await page.getByRole('button', { name: 'Line', exact: true }).click()
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
