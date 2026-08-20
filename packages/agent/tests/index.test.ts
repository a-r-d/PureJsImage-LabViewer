import type { ActionDefinition, JsonValue } from '@pji-workbench/actions'
import { WorkbenchActionHost, WorkbenchActionRegistry } from '@pji-workbench/actions'
import { describe, expect, it, vi } from 'vitest'

import {
  type AgentActionCall,
  type AgentActionGateway,
  type AgentModelResponse,
  type AgentPolicy,
  AgentRuntime,
  AgentRuntimeError,
  createAgentCapabilityManifest,
  DEFAULT_OPENROUTER_MODEL,
  DeterministicAgentTransport,
  defaultAgentDecision,
  MemoryOpenRouterCredentialStore,
  OPENROUTER_RECOMMENDED_MODELS,
  OpenRouterTransport,
} from '../src/index.js'

const READ_ACTION: ActionDefinition<{ readonly available: boolean }> = {
  descriptor: {
    schemaVersion: 1,
    id: 'fixture.read',
    version: 1,
    title: 'Read fixture metadata',
    description: 'Return bounded fixture metadata.',
    category: 'fixture',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1, maxLength: 32 } },
      required: ['query'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    mutability: 'read',
    cost: 'trivial',
    permissions: ['workspace.read'],
    cancellable: true,
  },
  availability: ({ available }) =>
    available ? { available: true } : { available: false, reason: 'Fixture is closed.' },
}

const MUTATE_ACTION: ActionDefinition<{ readonly available: boolean }> = {
  descriptor: {
    ...READ_ACTION.descriptor,
    id: 'fixture.mutate',
    title: 'Mutate fixture',
    description: 'Apply a bounded fixture mutation.',
    inputSchema: { type: 'object', additionalProperties: false },
    mutability: 'mutation',
    cost: 'interactive',
    permissions: ['workspace.propose'],
  },
}

const ALLOW_READS: AgentPolicy = {
  decide(capability) {
    return {
      decision: capability.mutability === 'read' ? 'allow' : 'require-approval',
      reason: capability.mutability === 'read' ? 'Bounded read.' : 'Mutation approval.',
      permissions: capability.permissions,
    }
  },
}

function modelResponse(
  toolCalls: readonly AgentActionCall[],
  content = toolCalls.length === 0
    ? 'Done.'
    : '{"goalSummary":"Inspect","actions":[],"approvalsRequired":[],"stoppingCondition":"Done"}',
): AgentModelResponse {
  return {
    provider: 'fake',
    model: 'fake/atlas',
    content,
    toolCalls,
    ...(toolCalls.length === 0
      ? {}
      : {
          plan: {
            goalSummary: 'Inspect',
            actions: [],
            approvalsRequired: [],
            stoppingCondition: 'Done',
          },
        }),
  }
}

function call(
  actionId: 'fixture.read' | 'fixture.mutate',
  input: JsonValue,
  projectRevision = 0,
  callId = 'call-1',
): AgentActionCall {
  return { callId, actionId, actionVersion: 1, projectRevision, input }
}

function fixtureGateway(options: Readonly<{ available?: boolean; largeResult?: boolean }> = {}): {
  readonly gateway: AgentActionGateway
  readonly executions: AgentActionCall[]
  revision(): number
} {
  const context = { available: options.available ?? true }
  const registry = new WorkbenchActionRegistry([READ_ACTION, MUTATE_ACTION])
  let revision = 0
  const executions: AgentActionCall[] = []
  const host = new WorkbenchActionHost(
    registry,
    new Map([
      [
        'fixture.read@1',
        {
          execute: (input: JsonValue) => ({
            query: (input as Readonly<Record<string, JsonValue>>)['query'] ?? null,
            rows: options.largeResult ? 'x'.repeat(128) : ['one', 'two'],
          }),
        },
      ],
      [
        'fixture.mutate@1',
        {
          execute: () => {
            revision += 1
            return { revision }
          },
        },
      ],
    ]),
  )
  const gateway: AgentActionGateway = {
    revision: () => revision,
    capabilities: () =>
      createAgentCapabilityManifest(
        revision,
        registry.list().map((descriptor) => ({
          descriptor,
          availability: registry.availability(descriptor.id, descriptor.version, context),
        })),
      ),
    context: () => ({ project: { revision, title: 'Fixture' } }),
    plan: (entry) => host.plan(entry.actionId, entry.actionVersion, entry.input, context),
    execute: async (entry, signal) => {
      executions.push(entry)
      return host.execute(entry.actionId, entry.actionVersion, entry.input, context, signal)
    },
  }
  return { gateway, executions, revision: () => revision }
}

describe('agent capability and policy foundation', () => {
  it('generates model tools from current action definitions and availability', () => {
    const fixture = fixtureGateway({ available: false })
    const manifest = fixture.gateway.capabilities()

    expect(manifest.projectRevision).toBe(0)
    expect(manifest.actions.map(({ actionId }) => actionId)).toEqual([
      'fixture.mutate',
      'fixture.read',
    ])
    expect(manifest.actions.find(({ actionId }) => actionId === 'fixture.read')).toMatchObject({
      toolName: 'fixture__read__v1',
      availability: { available: false, reason: 'Fixture is closed.' },
      mutability: 'read',
      permissions: ['workspace.read'],
    })
  })

  it('allows bounded reads and gates side effects', () => {
    expect(defaultAgentDecision('workspace.read')).toBe('allow')
    expect(defaultAgentDecision('analysis.execute')).toBe('require-approval')
  })
})

describe('model-independent agent runtime', () => {
  it('preserves bounded history across user turns and can reset the conversation', async () => {
    const fixture = fixtureGateway()
    const transport = new DeterministicAgentTransport([
      modelResponse([], 'First turn complete.'),
      (request) => {
        expect(request.messages).toEqual(
          expect.arrayContaining([
            { role: 'user', content: 'First request' },
            expect.objectContaining({ role: 'assistant', content: 'First turn complete.' }),
            { role: 'user', content: 'Follow up' },
          ]),
        )
        return modelResponse([call('fixture.read', { query: 'follow-up' })])
      },
      modelResponse([], 'Second turn complete.'),
    ])
    const runtime = new AgentRuntime({ transport, gateway: fixture.gateway, policy: ALLOW_READS })

    await runtime.start('First request', 'fake/atlas')
    await runtime.start('Follow up', 'fake/atlas')

    expect(fixture.executions).toHaveLength(1)
    expect(runtime.getSnapshot()).toMatchObject({
      conversationTurnCount: 2,
      finalText: 'Second turn complete.',
      conversation: [
        {
          request: 'First request',
          answer: 'First turn complete.',
          model: 'fake/atlas',
        },
        {
          request: 'Follow up',
          answer: 'Second turn complete.',
          model: 'fake/atlas',
        },
      ],
    })
    runtime.resetConversation()
    expect(runtime.getSnapshot()).toMatchObject({
      status: 'idle',
      conversation: [],
      conversationTurnCount: 0,
      conversationMessageCount: 0,
    })
  })

  it('does not retain failed turns and evicts whole old turns at conversation limits', async () => {
    const fixture = fixtureGateway()
    const transport = new DeterministicAgentTransport([
      modelResponse([], 'Remembered answer.'),
      modelResponse([call('fixture.read', {})]),
      (request) => {
        expect(JSON.stringify(request.messages)).toContain('Remembered request')
        expect(JSON.stringify(request.messages)).not.toContain('Failed request')
        return modelResponse([], 'Replacement answer.')
      },
      (request) => {
        expect(JSON.stringify(request.messages)).not.toContain('Remembered request')
        expect(JSON.stringify(request.messages)).toContain('Replacement request')
        return modelResponse([], 'Final answer.')
      },
    ])
    const runtime = new AgentRuntime({
      transport,
      gateway: fixture.gateway,
      policy: ALLOW_READS,
      limits: { maximumConversationMessages: 2 },
    })

    await runtime.start('Remembered request', 'fake/atlas')
    await expect(runtime.start('Failed request', 'fake/atlas')).rejects.toMatchObject({
      code: 'ACTION_VALIDATION_FAILED',
    })
    await runtime.start('Replacement request', 'fake/atlas')
    await runtime.start('Final request', 'fake/atlas')
    expect(runtime.getSnapshot().conversationTurnCount).toBe(1)
    expect(runtime.getSnapshot().conversation).toEqual([
      expect.objectContaining({ request: 'Final request', answer: 'Final answer.' }),
    ])
  })

  it('executes only through the gateway, records a plan, and bounds table results', async () => {
    const fixture = fixtureGateway()
    const transport = new DeterministicAgentTransport([
      modelResponse([call('fixture.read', { query: 'Kentucky' })]),
      modelResponse([], 'The bounded metadata was inspected.'),
    ])
    const runtime = new AgentRuntime({
      transport,
      gateway: fixture.gateway,
      policy: ALLOW_READS,
      limits: { maximumResultArrayItems: 1 },
    })

    const audit = await runtime.start('Inspect Kentucky metadata', 'fake/atlas')

    expect(fixture.executions).toHaveLength(1)
    expect(audit.plan?.goalSummary).toBe('Inspect')
    expect(audit.trace[0]).toMatchObject({
      actionId: 'fixture.read',
      actionVersion: 1,
      approval: 'automatic',
    })
    expect(audit.trace[0]?.result).toMatchObject({
      rows: { returned: 1, total: 2, hasMore: true },
    })
    expect(runtime.getSnapshot()).toMatchObject({
      status: 'completed',
      finalText: 'The bounded metadata was inspected.',
    })
  })

  it('pauses mutations for local approval and replays approved actions without a model call', async () => {
    const original = fixtureGateway()
    const runtime = new AgentRuntime({
      transport: new DeterministicAgentTransport([
        modelResponse([call('fixture.mutate', {})]),
        modelResponse([], 'Mutation completed.'),
      ]),
      gateway: original.gateway,
      policy: ALLOW_READS,
    })
    const run = runtime.start('Mutate the fixture', 'fake/atlas')
    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe('awaiting-approval'))
    const approvalId = runtime.getSnapshot().approval?.id
    if (approvalId === undefined) throw new Error('Expected approval request')
    runtime.approve(approvalId)
    const audit = await run

    expect(audit.approvals[0]?.decision).toBe('approved')
    expect(audit.trace[0]?.approval).toBe('approved')
    const replayTarget = fixtureGateway()
    const replayTransport = new DeterministicAgentTransport([])
    const replayRuntime = new AgentRuntime({
      transport: replayTransport,
      gateway: replayTarget.gateway,
      policy: ALLOW_READS,
    })
    const replayed = await replayRuntime.replay(audit)
    expect(replayed).toHaveLength(1)
    expect(replayTarget.revision()).toBe(1)
    expect(replayTransport.requests).toHaveLength(0)
  })

  it('records approval denial without executing the action', async () => {
    const fixture = fixtureGateway()
    const runtime = new AgentRuntime({
      transport: new DeterministicAgentTransport([modelResponse([call('fixture.mutate', {})])]),
      gateway: fixture.gateway,
      policy: ALLOW_READS,
    })
    const run = runtime.start('Mutate the fixture', 'fake/atlas')
    await vi.waitFor(() => expect(runtime.getSnapshot().approval).toBeDefined())
    runtime.deny(runtime.getSnapshot().approval?.id ?? '')

    await expect(run).rejects.toMatchObject({ code: 'APPROVAL_DENIED' })
    expect(fixture.executions).toHaveLength(0)
    expect(runtime.getSnapshot().audit?.approvals[0]?.decision).toBe('denied')
  })

  it.each([
    {
      name: 'malformed tool input',
      fixture: fixtureGateway(),
      entry: call('fixture.read', {}),
      code: 'ACTION_VALIDATION_FAILED',
    },
    {
      name: 'unavailable action',
      fixture: fixtureGateway({ available: false }),
      entry: call('fixture.read', { query: 'x' }),
      code: 'ACTION_UNAVAILABLE',
    },
    {
      name: 'stale project revision',
      fixture: fixtureGateway(),
      entry: call('fixture.read', { query: 'x' }, 9),
      code: 'STALE_PROJECT_REVISION',
    },
  ])('refuses $name', async ({ fixture, entry, code }) => {
    const runtime = new AgentRuntime({
      transport: new DeterministicAgentTransport([modelResponse([entry])]),
      gateway: fixture.gateway,
      policy: ALLOW_READS,
    })
    await expect(runtime.start('Run failure fixture', 'fake/atlas')).rejects.toMatchObject({ code })
    expect(fixture.executions).toHaveLength(0)
  })

  it('bounds tool-result bytes before returning data to the model', async () => {
    const fixture = fixtureGateway({ largeResult: true })
    const runtime = new AgentRuntime({
      transport: new DeterministicAgentTransport([
        modelResponse([call('fixture.read', { query: 'large' })]),
      ]),
      gateway: fixture.gateway,
      policy: ALLOW_READS,
      limits: { maximumToolResultBytes: 32 },
    })
    await expect(runtime.start('Read large fixture', 'fake/atlas')).rejects.toMatchObject({
      code: 'TOOL_OUTPUT_TOO_LARGE',
    })
  })

  it('refuses oversized model context before contacting the provider', async () => {
    const fixture = fixtureGateway()
    const transport = new DeterministicAgentTransport([modelResponse([], 'unused')])
    const runtime = new AgentRuntime({
      transport,
      gateway: {
        ...fixture.gateway,
        context: () =>
          Object.fromEntries(
            Array.from({ length: 20 }, (_, index) => [`text${index}`, 'x'.repeat(20_000)]),
          ) as JsonValue,
      },
      policy: ALLOW_READS,
    })

    await expect(runtime.start('Inspect oversized context', 'fake/atlas')).rejects.toMatchObject({
      code: 'CONTEXT_TOO_LARGE',
    })
    expect(transport.requests).toHaveLength(0)
  })

  it('stops at the model-step limit', async () => {
    const fixture = fixtureGateway()
    const runtime = new AgentRuntime({
      transport: new DeterministicAgentTransport([
        modelResponse([call('fixture.read', { query: 'one' }, 0, 'call-1')]),
        modelResponse([call('fixture.read', { query: 'two' }, 0, 'call-2')]),
      ]),
      gateway: fixture.gateway,
      policy: ALLOW_READS,
      limits: { maximumModelSteps: 2 },
    })
    await expect(runtime.start('Keep inspecting', 'fake/atlas')).rejects.toMatchObject({
      code: 'MAXIMUM_STEPS',
    })
  })

  it('retries bounded retryable provider failures and reports exhaustion', async () => {
    const fixture = fixtureGateway()
    const failure = () => new AgentRuntimeError('PROVIDER_ERROR', 'provider unavailable', true)
    const runtime = new AgentRuntime({
      transport: new DeterministicAgentTransport([failure(), failure(), failure()]),
      gateway: fixture.gateway,
      policy: ALLOW_READS,
      limits: { maximumProviderRetries: 2 },
    })
    await expect(runtime.start('Inspect metadata', 'fake/atlas')).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
    expect(runtime.getSnapshot().audit).toMatchObject({ retries: 2 })
  })

  it('supports explicit cancellation and timeout', async () => {
    const pendingTransport = () =>
      new DeterministicAgentTransport([
        (_request, signal) =>
          new Promise<AgentModelResponse>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
      ])
    const cancelled = new AgentRuntime({
      transport: pendingTransport(),
      gateway: fixtureGateway().gateway,
      policy: ALLOW_READS,
    })
    const cancelledRun = cancelled.start('Wait for cancellation', 'fake/atlas')
    await vi.waitFor(() => expect(cancelled.getSnapshot().status).toBe('requesting-model'))
    cancelled.cancel()
    await expect(cancelledRun).rejects.toMatchObject({ code: 'ABORTED' })

    const timedOut = new AgentRuntime({
      transport: pendingTransport(),
      gateway: fixtureGateway().gateway,
      policy: ALLOW_READS,
      limits: { timeoutMilliseconds: 5 },
    })
    await expect(timedOut.start('Wait for timeout', 'fake/atlas')).rejects.toMatchObject({
      code: 'TIMEOUT',
    })
  })
})

describe('OpenRouter transport', () => {
  it('defines the requested default, recommended alternative, and accepts validated custom IDs', () => {
    expect(DEFAULT_OPENROUTER_MODEL).toBe('openai/gpt-5.6-luna')
    expect(OPENROUTER_RECOMMENDED_MODELS.map(({ id }) => id)).toEqual([
      'openai/gpt-5.6-luna',
      'google/gemini-3.7-flash',
    ])
  })

  it('uses session-only credentials, tool-capable models, and sequential tool calls', async () => {
    const requests: Array<{ readonly url: string; readonly body?: string }> = []
    const bodies = [
      { data: [{ id: 'fixture/tools', name: 'Fixture Tools', supported_parameters: ['tools'] }] },
      {
        model: 'fixture/tools',
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'or-call-1',
                  type: 'function',
                  function: {
                    name: 'fixture__read__v1',
                    arguments: '{"projectRevision":0,"input":{"query":"Kentucky"}}',
                  },
                },
              ],
            },
          },
        ],
      },
    ]
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      })
      return Response.json(bodies.shift() ?? {})
    }
    const credentials = new MemoryOpenRouterCredentialStore()
    credentials.set('sk-or-session-fixture')
    const transport = new OpenRouterTransport({ credentials, fetch: fetcher })
    const manifest = fixtureGateway().gateway.capabilities()

    const response = await transport.complete(
      {
        model: 'fixture/tools',
        messages: [{ role: 'user', content: 'Inspect Kentucky' }],
        manifest,
        maximumTokens: 512,
      },
      new AbortController().signal,
    )

    expect(requests[0]?.url).toContain('supported_parameters=tools')
    const requestBody = JSON.parse(requests[1]?.body ?? '{}') as Record<string, unknown>
    expect(requestBody).toMatchObject({
      model: 'fixture/tools',
      parallel_tool_calls: false,
      max_tokens: 512,
    })
    expect(JSON.stringify(requestBody)).toContain('Permissions: workspace.read')
    expect(JSON.stringify(requestBody)).toContain('Output schema:')
    expect(response.toolCalls[0]).toMatchObject({
      actionId: 'fixture.read',
      actionVersion: 1,
      projectRevision: 0,
      input: { query: 'Kentucky' },
    })
    expect(JSON.stringify(requests)).not.toContain('sk-or-session-fixture')
    credentials.clear()
    expect(credentials.has()).toBe(false)
  })

  it('invokes a browser fetch implementation with the global receiver', async () => {
    const credentials = new MemoryOpenRouterCredentialStore()
    credentials.set('sk-or-session-fixture')
    const fetcher = function (this: unknown): Promise<Response> {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(
        Response.json({
          data: [
            {
              id: 'fixture/tools',
              supported_parameters: ['tools'],
              architecture: { input_modalities: ['text'] },
            },
          ],
        }),
      )
    } as typeof fetch
    const transport = new OpenRouterTransport({ credentials, fetch: fetcher })

    await expect(transport.listModels()).resolves.toEqual([
      expect.objectContaining({ id: 'fixture/tools' }),
    ])
  })

  it('rejects models that do not advertise tool calling', async () => {
    const credentials = new MemoryOpenRouterCredentialStore()
    credentials.set('sk-or-session-fixture')
    const fetcher: typeof fetch = async () => Response.json({ data: [] })
    const transport = new OpenRouterTransport({ credentials, fetch: fetcher })

    await expect(
      transport.complete(
        {
          model: 'fixture/no-tools',
          messages: [{ role: 'user', content: 'Inspect' }],
          manifest: fixtureGateway().gateway.capabilities(),
          maximumTokens: 128,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MODEL' })
  })

  it('sends approved images as multimodal input and rejects text-only models', async () => {
    const requests: string[] = []
    const credentials = new MemoryOpenRouterCredentialStore()
    credentials.set('sk-or-session-fixture')
    const responses = [
      {
        data: [
          {
            id: 'fixture/vision',
            name: 'Fixture Vision',
            supported_parameters: ['tools'],
            architecture: { input_modalities: ['text', 'image'] },
          },
        ],
      },
      { model: 'fixture/vision', choices: [{ message: { content: 'Visible.' } }] },
    ]
    const transport = new OpenRouterTransport({
      credentials,
      fetch: async (_input, init) => {
        if (typeof init?.body === 'string') requests.push(init.body)
        return Response.json(responses.shift() ?? {})
      },
    })
    await transport.complete(
      {
        model: 'fixture/vision',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect this bounded preview.' },
              { type: 'image', dataUrl: 'data:image/png;base64,AAAA' },
            ],
          },
        ],
        manifest: fixtureGateway().gateway.capabilities(),
        maximumTokens: 128,
      },
      new AbortController().signal,
    )
    expect(JSON.parse(requests[0] ?? '{}')).toMatchObject({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect this bounded preview.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
      ],
    })

    const textOnly = new OpenRouterTransport({
      credentials,
      fetch: async () =>
        Response.json({
          data: [
            {
              id: 'fixture/text',
              supported_parameters: ['tools'],
              architecture: { input_modalities: ['text'] },
            },
          ],
        }),
    })
    await expect(
      textOnly.complete(
        {
          model: 'fixture/text',
          messages: [
            { role: 'user', content: [{ type: 'image', dataUrl: 'data:image/png;base64,AAAA' }] },
          ],
          manifest: fixtureGateway().gateway.capabilities(),
          maximumTokens: 128,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MODEL' })
  })
})
