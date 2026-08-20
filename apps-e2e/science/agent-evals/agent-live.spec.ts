import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

import { openSample, openWorkbench, waitForWorkbenchSettled } from '../tests/support/workbench.js'

function environment(name: string): string | undefined {
  return process.env[name]
}

const MODEL = environment('PJI_AGENT_EVAL_MODEL') ?? 'openai/gpt-5.6-luna'
const REASONING = environment('PJI_AGENT_EVAL_REASONING_EFFORT') ?? 'high'
const OUTPUT_DIR = environment('PJI_AGENT_EVAL_OUTPUT_DIR')
const RELAY_URL = environment('PJI_AGENT_EVAL_RELAY_URL')
const RELAY_TOKEN = environment('PJI_AGENT_EVAL_RELAY_TOKEN')
const SELECTED_CASES = new Set(
  (environment('PJI_AGENT_EVAL_CASES') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)
const RUN_COST_LIMIT = Number(environment('PJI_AGENT_EVAL_MAX_COST_USD') ?? '0.25')
const CASE_COST_LIMIT = RUN_COST_LIMIT / Math.max(1, SELECTED_CASES.size)
const MAXIMUM_CHAT_REQUESTS = 20
const DUMMY_BROWSER_KEY = 'sk-or-live-eval-node-proxy'

const ALLOWED_TOOLS = new Set([
  'analysis.describe',
  'analysis.particle.execute',
  'analysis.particle.plan',
  'analysis.particle.settings.read',
  'dataset.describe',
  'result.page.read',
  'result.summary.read',
  'source.list',
  'viewport.preview.create',
  'viewport.state.read',
  'workspace.summary.read',
])
const APPROVABLE_TOOLS = new Set(['analysis.particle.execute', 'viewport.preview.create'])

interface ModelRequestRecord {
  readonly responseId: string | null
  readonly model: string
  readonly reasoningEffort: string | null
  readonly hadImage: boolean
  readonly latencyMilliseconds: number
  readonly promptTokens: number | null
  readonly completionTokens: number | null
  readonly totalTokens: number | null
  readonly costUsd: number | null
  readonly returnedTools: readonly string[]
  readonly receivedToolErrors: readonly Readonly<{
    actionId: string | null
    code: string | null
    message: string | null
  }>[]
}

interface ProxyState {
  readonly requests: ModelRequestRecord[]
  totalKnownCostUsd: number
}

interface TurnResult {
  readonly answer: string
  readonly actions: readonly string[]
  readonly approvals: readonly string[]
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function redactedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return RELAY_TOKEN === undefined ? message : message.replaceAll(RELAY_TOKEN, '[redacted]')
}

function receivedToolErrors(requestBody: Readonly<Record<string, unknown>> | undefined) {
  const messages = Array.isArray(requestBody?.['messages']) ? requestBody['messages'] : []
  const errors: Array<{ actionId: string | null; code: string | null; message: string | null }> = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = record(messages[index])
    if (message?.['role'] !== 'tool') break
    const content = stringValue(message['content'])
    if (content === null) continue
    const result = record(JSON.parse(content) as unknown)
    const error = record(result?.['error'])
    if (result?.['ok'] !== false || error === undefined) continue
    errors.unshift({
      actionId: stringValue(result['actionId']),
      code: stringValue(error['code']),
      message: stringValue(error['message']),
    })
  }
  return errors
}

async function installLiveOpenRouterProxy(page: Page): Promise<ProxyState> {
  if (RELAY_URL === undefined || RELAY_TOKEN === undefined)
    throw new Error('The local live-eval relay is unavailable.')
  const state: ProxyState = { requests: [], totalKnownCostUsd: 0 }
  await page.route('https://openrouter.ai/api/v1/**', async (route) => {
    const browserRequest = route.request()
    const isChat = browserRequest.url().includes('/chat/completions')
    const bodyText = browserRequest.postData() ?? ''
    if (isChat) {
      if (state.requests.length >= MAXIMUM_CHAT_REQUESTS) {
        await route.fulfill({
          status: 429,
          json: { error: { message: 'The local eval reached its model-request limit.' } },
        })
        return
      }
      if (state.totalKnownCostUsd >= CASE_COST_LIMIT) {
        await route.fulfill({
          status: 429,
          json: { error: { message: 'The local eval reached its known-cost ceiling.' } },
        })
        return
      }
      const requestBody = record(JSON.parse(bodyText) as unknown)
      const reasoning = record(requestBody?.['reasoning'])
      if (requestBody?.['model'] !== MODEL)
        throw new Error('The browser attempted to use a model outside the live eval configuration.')
      if (reasoning?.['effort'] !== REASONING)
        throw new Error('The browser did not request the configured reasoning effort.')
    }

    const startedAt = performance.now()
    const relayResponse = await fetch(RELAY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RELAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ endpoint: isChat ? 'chat' : 'models', body: bodyText }),
    })
    if (!relayResponse.ok) throw new Error('The local live-eval relay rejected the request.')
    const relayPayload = record((await relayResponse.json()) as unknown)
    const responseStatus = finiteNumber(relayPayload?.['status'])
    const responseText = stringValue(relayPayload?.['body'])
    const contentType = stringValue(relayPayload?.['contentType'])
    if (responseStatus === null || responseText === null)
      throw new Error('The local live-eval relay returned a malformed response.')

    if (isChat) {
      const root = record(JSON.parse(responseText) as unknown)
      const usage = record(root?.['usage'])
      const cost = finiteNumber(usage?.['cost'])
      if (cost !== null) state.totalKnownCostUsd += cost
      const choices = Array.isArray(root?.['choices']) ? root['choices'] : []
      const choice = record(choices[0])
      const message = record(choice?.['message'])
      const toolCalls = Array.isArray(message?.['tool_calls']) ? message['tool_calls'] : []
      const returnedTools = toolCalls.flatMap((value) => {
        const fn = record(record(value)?.['function'])
        return typeof fn?.['name'] === 'string' ? [fn['name']] : []
      })
      const requestBody = record(JSON.parse(bodyText) as unknown)
      const reasoning = record(requestBody?.['reasoning'])
      state.requests.push({
        responseId: stringValue(root?.['id']),
        model: stringValue(root?.['model']) ?? MODEL,
        reasoningEffort: stringValue(reasoning?.['effort']),
        hadImage: bodyText.includes('"image_url"'),
        latencyMilliseconds: Math.round(performance.now() - startedAt),
        promptTokens: finiteNumber(usage?.['prompt_tokens']),
        completionTokens: finiteNumber(usage?.['completion_tokens']),
        totalTokens: finiteNumber(usage?.['total_tokens']),
        costUsd: cost,
        returnedTools,
        receivedToolErrors: receivedToolErrors(requestBody),
      })
    }

    await route.fulfill({
      status: responseStatus,
      headers: { 'content-type': contentType ?? 'application/json' },
      body: responseText,
    })
  })
  return state
}

async function openGeneratedExample(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Examples mode' }).click()
  const gallery = page.getByRole('dialog', { name: 'Example library' })
  await gallery.getByRole('searchbox', { name: 'Search' }).fill(title)
  await gallery
    .locator('.example-card')
    .filter({ hasText: title })
    .getByRole('button', { name: 'Open example', exact: true })
    .click()
  await expect(gallery).toBeHidden({ timeout: 30_000 })
  await waitForWorkbenchSettled(page)
}

async function prepareAgent(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Show agent readiness' }).click()
  await expect(page.getByTestId('science-agent-panel')).toBeVisible()
  const settings = page.getByRole('dialog', { name: 'Agent settings' })
  await expect(settings).toBeVisible()
  await settings.getByLabel('OpenRouter key').fill(DUMMY_BROWSER_KEY)
  await settings.getByRole('button', { name: 'Save and continue' }).click()
  await expect(settings).toBeHidden()
  await expect(
    page.getByTestId('science-agent-panel').getByText('Ready', { exact: true }),
  ).toBeVisible()
}

async function currentTraceActions(page: Page): Promise<readonly string[]> {
  return page
    .locator('[aria-labelledby="science-agent-trace-heading"] li[data-agent-action-id]')
    .evaluateAll((items) =>
      items.flatMap((item) => {
        const action = item.getAttribute('data-agent-action-id')
        return action === null ? [] : [action]
      }),
    )
}

async function runAgentTurn(
  page: Page,
  prompt: string,
  buttonName: 'Start task' | 'Send follow-up',
): Promise<TurnResult> {
  await page.getByLabel('Request or follow-up').fill(prompt)
  await page.getByRole('button', { name: buttonName }).click()
  const status = page.locator('.science-agent__status')
  await expect(status).not.toContainText(/^completed/u, { timeout: 10_000 })
  const approvals: string[] = []
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    const statusText = ((await status.textContent()) ?? '').trim()
    const approval = page.locator('.science-agent__approval')
    if ((await approval.count()) > 0 && (await approval.isVisible())) {
      const actionId = await approval.getAttribute('data-agent-action-id')
      if (actionId === null || !APPROVABLE_TOOLS.has(actionId)) {
        await approval.getByRole('button', { name: 'Deny' }).click()
        throw new Error(`The model requested unexpected approval for ${actionId ?? 'unknown'}.`)
      }
      if (actionId === 'viewport.preview.create') {
        const inputText =
          (await approval.locator('details').first().locator('pre').textContent()) ?? ''
        const input = record(JSON.parse(inputText) as unknown)
        if (input?.['scope'] !== 'viewport') {
          await approval.getByRole('button', { name: 'Deny' }).click()
          throw new Error(
            'The live eval only approves bounded viewport previews, not screen sharing.',
          )
        }
      }
      approvals.push(actionId)
      await approval.getByRole('button', { name: 'Approve' }).click()
      await page.waitForTimeout(100)
      continue
    }
    if (statusText.startsWith('completed')) {
      const turn = page.locator('.science-agent__conversation > li').last()
      return {
        answer: ((await turn.locator('.agent-message').last().textContent()) ?? '').trim(),
        actions: await currentTraceActions(page),
        approvals,
      }
    }
    if (statusText.startsWith('failed') || statusText.startsWith('cancelled')) {
      const alert = page.getByRole('alert')
      throw new Error(
        `Agent ended ${statusText}: ${((await alert.last().textContent()) ?? '').trim()}`,
      )
    }
    await page.waitForTimeout(250)
  }
  throw new Error('The live agent turn exceeded the ten-minute eval deadline.')
}

function count(actions: readonly string[], actionId: string): number {
  return actions.filter((value) => value === actionId).length
}

function assertAllowedActions(actions: readonly string[]): void {
  const unexpected = actions.filter((action) => !ALLOWED_TOOLS.has(action))
  expect(unexpected, 'agent used only the case allowlist').toEqual([])
}

async function resultCountText(page: Page): Promise<string> {
  await page.getByRole('tab', { name: 'Results', exact: true }).click()
  const result = page.getByTestId('analysis-results').locator('.result-count')
  await expect(result).toContainText(/\d+ particles counted/u)
  return ((await result.textContent()) ?? '').trim()
}

async function writeReport(
  caseId: string,
  state: ProxyState,
  details: Readonly<Record<string, unknown>>,
  failure?: unknown,
): Promise<void> {
  if (OUTPUT_DIR === undefined) return
  await mkdir(OUTPUT_DIR, { recursive: true })
  const report = {
    schemaVersion: 1,
    caseId,
    model: MODEL,
    reasoningEffort: REASONING,
    passed: failure === undefined,
    configuredCaseCostLimitUsd: CASE_COST_LIMIT,
    knownCostUsd: state.totalKnownCostUsd,
    modelRequests: state.requests,
    ...details,
    ...(failure === undefined ? {} : { failure: redactedMessage(failure) }),
  }
  await writeFile(path.join(OUTPUT_DIR, `${caseId}.json`), `${JSON.stringify(report, null, 2)}\n`)
}

function enabled(caseId: string): boolean {
  return environment('PJI_AGENT_EVAL_LIVE') === '1' && SELECTED_CASES.has(caseId)
}

test('sem-particle-count uses analysis, visual evidence, and retained follow-up context', async ({
  page,
}) => {
  test.skip(!enabled('sem-particle-count'), 'Live case was not explicitly selected.')
  const proxy = await installLiveOpenRouterProxy(page)
  const details: Record<string, unknown> = {}
  let failure: unknown
  try {
    await openWorkbench(page)
    await openSample(page)
    await prepareAgent(page)
    const first = await runAgentTurn(
      page,
      'Analyze the open calibrated particle sample. Read the current particle settings, dry-run a bounded explicit settings patch, execute only the reviewed plan after approval, inspect the bounded result summary, and create an approved 512 by 384 viewport preview with scope viewport after labels exist. Use both numerical and visual evidence. Report the final particle count, calibration units, and any limitation. Stop after one supported run; do not guess or use screen sharing.',
      'Start task',
    )
    assertAllowedActions(first.actions)
    expect(first.actions).toEqual(
      expect.arrayContaining([
        'analysis.particle.settings.read',
        'analysis.particle.plan',
        'analysis.particle.execute',
        'result.summary.read',
        'viewport.preview.create',
      ]),
    )
    expect(first.approvals).toEqual(
      expect.arrayContaining(['analysis.particle.execute', 'viewport.preview.create']),
    )
    expect(proxy.requests.some(({ hadImage }) => hadImage)).toBe(true)

    const followUp = await runAgentTurn(
      page,
      'Without rerunning, summarize in one concise paragraph what you changed, the counted result, which visual evidence you inspected, and the calibration or units limitation.',
      'Send follow-up',
    )
    assertAllowedActions(followUp.actions)
    expect(count(followUp.actions, 'analysis.particle.execute')).toBe(0)
    expect(count(followUp.actions, 'viewport.preview.create')).toBe(0)
    const countText = await resultCountText(page)
    const counted = /^(\d+)/u.exec(countText)?.[1]
    expect(counted).toBeDefined()
    expect(countText).toBe('10 particles counted')
    expect(`${first.answer} ${followUp.answer}`).toContain(counted)
    expect(followUp.answer.toLowerCase()).toContain('particle')
    expect(followUp.answer).toMatch(/nm|pixel/iu)
    details['actions'] = [...first.actions, ...followUp.actions]
    details['approvals'] = [...first.approvals, ...followUp.approvals]
    details['answers'] = [first.answer, followUp.answer]
    details['uiResult'] = countText
  } catch (error) {
    failure = error
    throw error
  } finally {
    await writeReport('sem-particle-count', proxy, details, failure)
  }
})

test('split-touching-particles iterates from baseline to watershed with two previews', async ({
  page,
}) => {
  test.skip(!enabled('split-touching-particles'), 'Live case was not explicitly selected.')
  const proxy = await installLiveOpenRouterProxy(page)
  const details: Record<string, unknown> = {}
  let failure: unknown
  try {
    await openWorkbench(page)
    await openGeneratedExample(page, 'Touching-particle watershed')
    await prepareAgent(page)
    const turn = await runAgentTurn(
      page,
      'Evaluate whether the three touching synthetic particles are separated. First read settings, dry-run and execute a baseline with watershed false, then inspect its result summary and an approved 512 by 384 viewport preview with scope viewport. Next dry-run and execute a tuned run with watershed true, inspect the new result summary and a second approved viewport preview, and compare the counts and labels. Change only the watershed-related settings needed. Explain whether all three particles are separated and stop if the evidence is clear; never request screen sharing.',
      'Start task',
    )
    assertAllowedActions(turn.actions)
    expect(count(turn.actions, 'analysis.particle.plan')).toBeGreaterThanOrEqual(2)
    expect(count(turn.actions, 'analysis.particle.execute')).toBeGreaterThanOrEqual(2)
    expect(count(turn.actions, 'result.summary.read')).toBeGreaterThanOrEqual(2)
    expect(count(turn.actions, 'viewport.preview.create')).toBeGreaterThanOrEqual(2)
    expect(count(turn.approvals, 'analysis.particle.execute')).toBeGreaterThanOrEqual(2)
    expect(count(turn.approvals, 'viewport.preview.create')).toBe(1)
    expect(proxy.requests.filter(({ hadImage }) => hadImage).length).toBeGreaterThanOrEqual(2)
    const countText = await resultCountText(page)
    const counted = /^(\d+)/u.exec(countText)?.[1]
    expect(counted).toBeDefined()
    expect(countText).toBe('3 particles counted')
    expect(turn.answer).toContain(counted)
    expect(turn.answer).toMatch(/\b2\b/u)
    expect(turn.answer).toMatch(/\b3\b/u)
    expect(turn.answer.toLowerCase()).toContain('watershed')
    details['actions'] = turn.actions
    details['approvals'] = turn.approvals
    details['answers'] = [turn.answer]
    details['uiResult'] = countText
  } catch (error) {
    failure = error
    throw error
  } finally {
    await writeReport('split-touching-particles', proxy, details, failure)
  }
})
