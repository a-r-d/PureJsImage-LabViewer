import { expect, test } from '@playwright/test'

import { openSample, openWorkbench, waitForWorkbenchSettled } from './support/workbench.js'

const KEY_STORAGE = 'purejsimage-lab-openrouter-key-v1'

test('fake OpenRouter conversation survives inspector changes and keeps tool context', async ({
  page,
}) => {
  let modelCalls = 0
  let releaseFirstModel: (() => void) | undefined
  const firstModelGate = new Promise<void>((resolve) => {
    releaseFirstModel = resolve
  })
  await page.route('https://openrouter.ai/api/v1/**', async (route) => {
    if (route.request().url().includes('/models?')) {
      await route.fulfill({
        json: {
          data: [
            {
              id: 'openai/gpt-5.6-luna',
              name: 'Fake GPT-5.6 Luna',
              supported_parameters: ['tools'],
              architecture: { input_modalities: ['text', 'image'] },
            },
          ],
        },
      })
      return
    }

    const body = route.request().postDataJSON() as {
      readonly messages: readonly Readonly<{ role: string; content: unknown }>[]
    }
    const bodyText = JSON.stringify(body)
    if (modelCalls === 0) {
      const systemContent = body.messages.find(({ role }) => role === 'system')?.content
      const revisionMatch =
        typeof systemContent === 'string' ? /"revision":(\d+)/u.exec(systemContent) : null
      expect(revisionMatch).not.toBeNull()
      const projectRevision = Number(revisionMatch?.[1] ?? -1)
      await firstModelGate
      await route.fulfill({
        json: {
          model: 'openai/gpt-5.6-luna',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  goalSummary: 'Inspect the open scientific workspace',
                  actions: [
                    {
                      actionId: 'workspace.summary.read',
                      actionVersion: 1,
                      input: {},
                      expectedOutput: 'A bounded workspace summary',
                    },
                  ],
                  approvalsRequired: [],
                  stoppingCondition: 'The workspace revision is known.',
                }),
                tool_calls: [
                  {
                    id: 'workspace-summary-1',
                    type: 'function',
                    function: {
                      name: 'workspace__summary__read__v1',
                      arguments: JSON.stringify({ projectRevision, input: {} }),
                    },
                  },
                ],
              },
            },
          ],
        },
      })
    } else if (modelCalls === 1) {
      expect(bodyText).toContain('workspace-summary-1')
      expect(bodyText).toContain('sourceCount')
      await route.fulfill({
        json: {
          model: 'openai/gpt-5.6-luna',
          choices: [{ message: { content: 'The bounded scientific workspace was inspected.' } }],
        },
      })
    } else {
      expect(bodyText).toContain('The bounded scientific workspace was inspected.')
      expect(bodyText).toContain('What did you inspect?')
      await route.fulfill({
        json: {
          model: 'openai/gpt-5.6-luna',
          choices: [
            {
              message: {
                content: 'I inspected the bounded workspace summary through its semantic action.',
              },
            },
          ],
        },
      })
    }
    modelCalls += 1
  })

  await openWorkbench(page)
  await page.getByRole('button', { name: 'Show agent readiness' }).click()
  const settings = page.getByRole('dialog', { name: 'Agent settings' })
  await expect(settings).toBeVisible()
  await settings.getByLabel('OpenRouter key').fill('sk-or-fake-e2e-key')
  await settings.getByLabel('Remember on this browser').check()
  await settings.getByRole('button', { name: 'Save and continue' }).click()
  await expect(settings).toBeHidden()
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), KEY_STORAGE))
    .toBe('sk-or-fake-e2e-key')

  await page.reload()
  await waitForWorkbenchSettled(page)
  await openSample(page)
  await page.getByRole('button', { name: 'Show agent readiness' }).click()
  await expect(settings).toBeHidden()
  await page.getByRole('button', { name: 'Agent settings' }).click()
  await expect(settings.getByText('OpenRouter connected')).toBeVisible()
  await expect(settings.getByLabel('Tool-capable model')).toHaveValue('openai/gpt-5.6-luna')
  await settings.getByRole('button', { name: 'Close agent settings' }).click()
  await page.getByRole('button', { name: /Count particles/u }).click()
  await expect(page.getByLabel('Request or follow-up')).toHaveValue(/Count and measure/u)
  await page.getByLabel('Request or follow-up').fill('Inspect this workspace.')
  await page.getByLabel('Request or follow-up').press('Enter')
  await expect(page.getByText('Inspect this workspace.')).toBeVisible()
  await expect(page.getByLabel('Request or follow-up')).toHaveValue('')
  if (releaseFirstModel === undefined) throw new Error('The first model gate was unavailable.')
  releaseFirstModel()
  await expect(page.getByText('The bounded scientific workspace was inspected.')).toBeVisible()

  await page.getByRole('tab', { name: 'Analysis' }).click()
  await page.getByRole('tab', { name: 'Agent' }).click()
  await expect(page.getByText('The bounded scientific workspace was inspected.')).toBeVisible()

  await page.getByLabel('Request or follow-up').fill('What did you inspect?')
  await page.getByRole('button', { name: 'Send follow-up' }).click()
  await expect(
    page.getByText('I inspected the bounded workspace summary through its semantic action.'),
  ).toBeVisible()
  await expect(page.getByText(/2 completed turns/u)).toBeVisible()
  expect(modelCalls).toBe(3)
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(
    'sk-or-fake-e2e-key',
  )
})
