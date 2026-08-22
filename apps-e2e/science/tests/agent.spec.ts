import { expect, test } from '@playwright/test'

import { openSample, openWorkbench, waitForWorkbenchSettled } from './support/workbench.js'

const KEY_STORAGE = 'purejsimage-lab-openrouter-key-v1'

test('agent can expand to a modal surface and the results pane can fully collapse', async ({
  page,
}) => {
  await openWorkbench(page)
  await page.evaluate(({ key }) => localStorage.setItem(key, 'sk-or-fake-layout-key'), {
    key: KEY_STORAGE,
  })
  await page.reload()
  await waitForWorkbenchSettled(page)
  await page.getByRole('button', { name: 'Collapse results panel' }).click()
  await expect
    .poll(() =>
      page
        .locator('.workbench')
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--bottom-panel-height').trim(),
        ),
    )
    .toBe('36px')

  await page.getByRole('tab', { name: 'Agent' }).click()
  await page.getByRole('button', { name: 'Expand agent view' }).click()
  await expect(page.getByRole('region', { name: 'Lab Assistant agent workspace' })).toHaveClass(
    /science-agent--expanded/u,
  )
  await expect(page.getByRole('button', { name: 'Exit expanded agent view' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: 'Lab Assistant agent workspace' })).not.toHaveClass(
    /science-agent--expanded/u,
  )

  await page.getByRole('button', { name: 'Expand results panel' }).click()
  await expect
    .poll(() =>
      page
        .locator('.workbench')
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--bottom-panel-height').trim(),
        ),
    )
    .toBe('188px')
})

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
              context_length: 400_000,
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
          usage: {
            prompt_tokens: 8_000,
            completion_tokens: 500,
            total_tokens: 8_500,
            cost: 0.01,
          },
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
          usage: {
            prompt_tokens: 10_000,
            completion_tokens: 600,
            total_tokens: 10_600,
            cost: 0.012,
          },
          choices: [{ message: { content: 'The bounded scientific workspace was inspected.' } }],
        },
      })
    } else {
      expect(bodyText).toContain('The bounded scientific workspace was inspected.')
      expect(bodyText).toContain('What did you inspect?')
      await route.fulfill({
        json: {
          model: 'openai/gpt-5.6-luna',
          usage: {
            prompt_tokens: 12_000,
            completion_tokens: 700,
            total_tokens: 12_700,
            cost: 0.015,
          },
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
  const usage = page.getByLabel(/Latest request context:/u)
  await expect(usage).toHaveText('ctx 3% · $0.037')
  await expect(usage).toHaveAttribute('title', /30,000 prompt tokens/u)
  await expect(usage).toHaveAttribute('title', /Provider-reported session cost: \$0\.037000 USD/u)
  expect(modelCalls).toBe(3)
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(
    'sk-or-fake-e2e-key',
  )
})

test('agent writes and runs a custom local analysis without an approval prompt', async ({
  page,
}) => {
  let modelCalls = 0
  const scriptId = 'local.agent-dataset-inventory'
  const source = `import { lab } from '@lab/api'

export async function main() {
  const workspace = await lab.workspace.getSummary()
  const datasets = (await lab.datasets.list()) as readonly unknown[]
  return {
    customAnalysis: 'dataset-inventory',
    revision: (workspace as { revision?: unknown }).revision,
    datasetCount: datasets.length,
  }
}

globalThis.__scriptMain = main
`
  await page.route('https://openrouter.ai/api/v1/**', async (route) => {
    if (route.request().url().includes('/models?')) {
      await route.fulfill({
        json: {
          data: [
            {
              id: 'openai/gpt-5.6-luna',
              name: 'Fake GPT-5.6 Luna',
              context_length: 400_000,
              supported_parameters: ['tools'],
              architecture: { input_modalities: ['text', 'image'] },
            },
          ],
        },
      })
      return
    }

    const body = route.request().postDataJSON() as {
      readonly messages: readonly Readonly<{
        role: string
        content: unknown
        tool_call_id?: string
      }>[]
    }
    const systemContent = body.messages.find(({ role }) => role === 'system')?.content
    const revisionMatch =
      typeof systemContent === 'string' ? /"revision":(\d+)/u.exec(systemContent) : null
    expect(revisionMatch).not.toBeNull()
    const projectRevision = Number(revisionMatch?.[1] ?? -1)
    const toolResult = (callId: string): string => {
      const message = body.messages.find(({ tool_call_id: id }) => id === callId)
      expect(message).toBeDefined()
      expect(typeof message?.content).toBe('string')
      return String(message?.content)
    }
    const actionResult = (callId: string): unknown => {
      const envelope = JSON.parse(toolResult(callId)) as { readonly result?: unknown }
      expect(envelope.result).toBeDefined()
      return envelope.result
    }
    if (modelCalls === 0) {
      await route.fulfill({
        json: {
          model: 'openai/gpt-5.6-luna',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  goalSummary: 'Run a custom local dataset inventory analysis',
                  actions: [
                    {
                      actionId: 'script.create_draft',
                      actionVersion: 1,
                      input: { id: scriptId, title: 'Dataset inventory', source },
                      expectedOutput: 'A content-addressed local script draft',
                    },
                    {
                      actionId: 'script.typecheck',
                      actionVersion: 1,
                      input: { id: scriptId, expectedDigest: 'from creation result' },
                      expectedOutput: 'No blocking language problems',
                    },
                    {
                      actionId: 'script.execute',
                      actionVersion: 1,
                      input: { id: scriptId, expectedDigest: 'from creation result' },
                      expectedOutput: 'A completed sandbox outcome with provenance',
                    },
                  ],
                  approvalsRequired: [],
                  stoppingCondition: 'The completed sandbox output is inspected and reported.',
                }),
                tool_calls: [
                  {
                    id: 'script-create-1',
                    type: 'function',
                    function: {
                      name: 'script__create_draft__v1',
                      arguments: JSON.stringify({
                        projectRevision,
                        input: { id: scriptId, title: 'Dataset inventory', source },
                      }),
                    },
                  },
                ],
              },
            },
          ],
        },
      })
    } else if (modelCalls === 1) {
      const created = actionResult('script-create-1') as { readonly digest?: unknown }
      expect(created.digest).toMatch(/^[a-f0-9]{64}$/u)
      await route.fulfill({
        json: {
          model: 'openai/gpt-5.6-luna',
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'script-typecheck-1',
                    type: 'function',
                    function: {
                      name: 'script__typecheck__v1',
                      arguments: JSON.stringify({
                        projectRevision,
                        input: { id: scriptId, expectedDigest: created.digest },
                      }),
                    },
                  },
                ],
              },
            },
          ],
        },
      })
    } else if (modelCalls === 2) {
      const checked = actionResult('script-typecheck-1') as {
        readonly digest?: unknown
        readonly problems?: readonly unknown[]
      }
      expect(checked.digest).toMatch(/^[a-f0-9]{64}$/u)
      expect(checked.problems).toEqual([])
      await route.fulfill({
        json: {
          model: 'openai/gpt-5.6-luna',
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'script-execute-1',
                    type: 'function',
                    function: {
                      name: 'script__execute__v1',
                      arguments: JSON.stringify({
                        projectRevision,
                        input: { id: scriptId, expectedDigest: checked.digest },
                      }),
                    },
                  },
                ],
              },
            },
          ],
        },
      })
    } else {
      const executed = actionResult('script-execute-1') as {
        readonly status?: unknown
        readonly output?: Readonly<{ customAnalysis?: unknown; datasetCount?: unknown }>
        readonly provenance?: unknown
      }
      expect(executed.status).toBe('completed')
      expect(executed.output).toMatchObject({
        customAnalysis: 'dataset-inventory',
        datasetCount: 1,
      })
      expect(executed.provenance).toBeDefined()
      await route.fulfill({
        json: {
          model: 'openai/gpt-5.6-luna',
          choices: [
            {
              message: {
                content:
                  'Custom local analysis completed in the sandbox. It inspected 1 open dataset, and the run returned bounded provenance.',
              },
            },
          ],
        },
      })
    }
    modelCalls += 1
  })

  await openWorkbench(page)
  await page.evaluate(({ key }) => localStorage.setItem(key, 'sk-or-fake-script-key'), {
    key: KEY_STORAGE,
  })
  await page.reload()
  await waitForWorkbenchSettled(page)
  await openSample(page)
  await page.getByRole('button', { name: 'Show agent readiness' }).click()
  await page
    .getByLabel('Request or follow-up')
    .fill('Write and run a custom analysis that inventories the open datasets, then report it.')
  await page.getByLabel('Request or follow-up').press('Enter')

  await expect(
    page.getByText(
      'Custom local analysis completed in the sandbox. It inspected 1 open dataset, and the run returned bounded provenance.',
    ),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
  expect(modelCalls).toBe(4)
})
