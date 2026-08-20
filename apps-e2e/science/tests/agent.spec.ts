import { expect, test } from '@playwright/test'

import { openSample, openWorkbench } from './support/workbench.js'

test('fake OpenRouter conversation survives inspector changes and keeps tool context', async ({
  page,
}) => {
  let modelCalls = 0
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
  await openSample(page)
  await page.getByRole('button', { name: 'Show agent readiness' }).click()
  await page.getByLabel('OpenRouter key').fill('sk-or-fake-e2e-key')
  await page.getByRole('button', { name: 'Use for session' }).click()
  await page.getByLabel('Request or follow-up').fill('Inspect this workspace.')
  await page.getByRole('button', { name: 'Start task' }).click()
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
  expect(
    await page.evaluate(() => `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`),
  ).not.toContain('sk-or-fake-e2e-key')
})
