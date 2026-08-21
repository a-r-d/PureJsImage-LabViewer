import type { JsonValue } from '@pji-workbench/actions'
import { aiJsonParse } from 'ai-json-safe-parse'

import { agentToolName, modelToolInputSchema } from './manifest.js'
import type {
  AgentActionCall,
  AgentModelMessage,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelSummary,
  AgentModelTransport,
  AgentPlan,
  AgentReasoningEffort,
} from './types.js'
import { AgentRuntimeError } from './types.js'

const CHAT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models?supported_parameters=tools&limit=1000'
const MAX_RESPONSE_BYTES = 2 * 1_024 * 1_024
const REASONING_EFFORTS = new Set<AgentReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])
const PLAN_RESPONSE_FORMAT: JsonValue = {
  type: 'json_schema',
  json_schema: {
    name: 'workbench_agent_plan',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        goalSummary: { type: 'string', minLength: 1, maxLength: 4_096 },
        actions: {
          type: 'array',
          maxItems: 32,
          items: {
            type: 'object',
            properties: {
              actionId: { type: 'string', minLength: 1, maxLength: 256 },
              actionVersion: { type: 'integer', minimum: 1 },
              input: { type: 'object' },
              expectedOutput: { type: 'string', minLength: 1, maxLength: 1_024 },
            },
            required: ['actionId', 'actionVersion', 'input', 'expectedOutput'],
            additionalProperties: false,
          },
        },
        approvalsRequired: {
          type: 'array',
          maxItems: 32,
          items: { type: 'string', maxLength: 1_024 },
        },
        stoppingCondition: { type: 'string', minLength: 1, maxLength: 4_096 },
      },
      required: ['goalSummary', 'actions', 'approvalsRequired', 'stoppingCondition'],
      additionalProperties: false,
    },
  },
}

export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5.6-luna'
export const OPENROUTER_RECOMMENDED_MODELS = Object.freeze([
  Object.freeze({ id: DEFAULT_OPENROUTER_MODEL, name: 'OpenAI GPT-5.6 Luna' }),
  Object.freeze({ id: 'google/gemini-3.7-flash', name: 'Google Gemini 3.7 Flash' }),
] as const)

export interface OpenRouterCredentialStore {
  get(): string | undefined
  set(value: string): void
  clear(): void
  has(): boolean
}

/** Session-only BYOK storage. The value is never serialized or exposed through agent tools. */
export class MemoryOpenRouterCredentialStore implements OpenRouterCredentialStore {
  #value: string | undefined

  get(): string | undefined {
    return this.#value
  }

  set(value: string): void {
    const normalized = value.trim()
    if (normalized.length < 8 || normalized.length > 4_096)
      throw new Error('OpenRouter key length is invalid.')
    this.#value = normalized
  }

  clear(): void {
    this.#value = undefined
  }

  has(): boolean {
    return this.#value !== undefined
  }
}

export class OpenRouterTransport implements AgentModelTransport {
  readonly provider = 'openrouter'
  readonly #fetch: typeof fetch
  readonly #credentials: OpenRouterCredentialStore
  readonly #referer: string | undefined
  readonly #title: string
  #models: ReadonlyMap<string, AgentModelSummary> | undefined

  constructor(
    options: Readonly<{
      credentials: OpenRouterCredentialStore
      fetch?: typeof fetch
      referer?: string
      title?: string
    }>,
  ) {
    this.#credentials = options.credentials
    this.#fetch = (options.fetch ?? globalThis.fetch).bind(globalThis)
    this.#referer = options.referer
    this.#title = options.title ?? 'PureJsImage Workbench'
  }

  async listModels(signal?: AbortSignal): Promise<readonly AgentModelSummary[]> {
    const key = this.#key()
    const response = await this.#fetch(MODELS_ENDPOINT, {
      headers: this.#headers(key),
      ...(signal === undefined ? {} : { signal }),
    })
    const body = await responseJson(response, key)
    if (!response.ok) throw openRouterFailure(response.status, body, key)
    const root = record(body)
    const data = Array.isArray(root?.['data']) ? root['data'] : []
    const models = data.flatMap((value): AgentModelSummary[] => {
      const item = record(value)
      if (item === undefined || typeof item['id'] !== 'string') return []
      const supportedParameters = Array.isArray(item['supported_parameters'])
        ? item['supported_parameters'].filter((entry): entry is string => typeof entry === 'string')
        : []
      if (!supportedParameters.includes('tools')) return []
      const architecture = record(item['architecture'])
      const reasoning = record(item['reasoning'])
      const supportedReasoningEfforts =
        reasoning?.['supported_efforts'] === null
          ? null
          : Array.isArray(reasoning?.['supported_efforts'])
            ? reasoning['supported_efforts'].filter(isReasoningEffort)
            : undefined
      const inputModalities = Array.isArray(architecture?.['input_modalities'])
        ? architecture['input_modalities'].filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : ['text']
      return [
        {
          id: item['id'],
          name: typeof item['name'] === 'string' ? item['name'] : item['id'],
          ...(typeof item['context_length'] === 'number' && Number.isFinite(item['context_length'])
            ? { contextLength: item['context_length'] }
            : {}),
          supportedParameters,
          inputModalities,
          ...(supportedReasoningEfforts === undefined ? {} : { supportedReasoningEfforts }),
        },
      ]
    })
    this.#models = new Map(models.map((model) => [model.id, model]))
    return models.sort((left, right) => left.name.localeCompare(right.name))
  }

  async complete(request: AgentModelRequest, signal: AbortSignal): Promise<AgentModelResponse> {
    const key = this.#key()
    await this.validateModel(
      request.model,
      {
        imageInput: request.messages.some(messageContainsImage),
        ...(request.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: request.reasoningEffort }),
      },
      signal,
    )
    const started = Date.now()
    const response = await this.#fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: this.#headers(key),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(openRouterMessage),
        ...(request.planningOnly
          ? { response_format: PLAN_RESPONSE_FORMAT }
          : {
              tools: request.manifest.actions.map((action) => ({
                type: 'function',
                function: {
                  name: action.toolName,
                  description: modelToolDescription(action),
                  parameters: modelToolInputSchema(action),
                },
              })),
              tool_choice: 'auto',
              parallel_tool_calls: false,
            }),
        max_tokens: request.maximumTokens,
        ...(request.reasoningEffort === undefined
          ? {}
          : { reasoning: { effort: request.reasoningEffort } }),
      }),
      signal,
    })
    const body = await responseJson(response, key)
    if (!response.ok) {
      if (response.status === 404) this.#models = undefined
      throw openRouterFailure(response.status, body, key)
    }
    const root = record(body)
    const choice = Array.isArray(root?.['choices']) ? record(root['choices'][0]) : undefined
    const providerError = choice === undefined ? root?.['error'] : choice['error']
    if (providerError !== undefined) throw openRouterFailure(response.status, providerError, key)
    const message = record(choice?.['message'])
    if (message === undefined)
      throw new AgentRuntimeError('PROVIDER_ERROR', 'OpenRouter returned no assistant message.')
    const content = typeof message['content'] === 'string' ? message['content'] : ''
    const toolCalls = parseToolCalls(message['tool_calls'], request)
    const usageRecord = record(root?.['usage'])
    const plan = parsePlan(content)
    const promptTokens = finiteInteger(usageRecord?.['prompt_tokens'])
    const completionTokens = finiteInteger(usageRecord?.['completion_tokens'])
    const totalTokens = finiteInteger(usageRecord?.['total_tokens'])
    return {
      provider: 'openrouter',
      model: typeof root?.['model'] === 'string' ? root['model'] : request.model,
      content,
      toolCalls,
      ...(plan === undefined ? {} : { plan }),
      ...(message['reasoning_details'] === undefined
        ? {}
        : { providerDetails: jsonValue(message['reasoning_details']) }),
      latencyMilliseconds: Math.max(0, Date.now() - started),
      ...(usageRecord === undefined
        ? {}
        : {
            usage: {
              ...(promptTokens === undefined ? {} : { promptTokens }),
              ...(completionTokens === undefined ? {} : { completionTokens }),
              ...(totalTokens === undefined ? {} : { totalTokens }),
            },
          }),
    }
  }

  invalidateModelCache(): void {
    this.#models = undefined
  }

  async validateModel(
    model: string,
    requirements: Readonly<{
      imageInput: boolean
      reasoningEffort?: AgentReasoningEffort
    }>,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.#models === undefined) await this.listModels(signal)
    const selectedModel = this.#models?.get(model)
    if (selectedModel === undefined) {
      this.#models = undefined
      throw new AgentRuntimeError(
        'UNSUPPORTED_MODEL',
        `OpenRouter model ${model} does not advertise tool calling support.`,
      )
    }
    if (requirements.imageInput && !selectedModel.inputModalities.includes('image')) {
      this.#models = undefined
      throw new AgentRuntimeError(
        'UNSUPPORTED_MODEL',
        `OpenRouter model ${model} does not advertise image input support required by the approved preview.`,
      )
    }
    if (
      requirements.reasoningEffort !== undefined &&
      selectedModel.supportedReasoningEfforts !== undefined &&
      selectedModel.supportedReasoningEfforts !== null &&
      !selectedModel.supportedReasoningEfforts.includes(requirements.reasoningEffort)
    )
      throw new AgentRuntimeError(
        'UNSUPPORTED_MODEL',
        `OpenRouter model ${model} does not advertise ${requirements.reasoningEffort} reasoning effort support.`,
      )
  }

  #key(): string {
    const key = this.#credentials.get()
    if (key === undefined)
      throw new AgentRuntimeError('PROVIDER_ERROR', 'Paste an OpenRouter key for this session.')
    return key
  }

  #headers(key: string): Readonly<Record<string, string>> {
    return {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': this.#title,
      ...(this.#referer === undefined ? {} : { 'HTTP-Referer': this.#referer }),
    }
  }
}

function isReasoningEffort(value: unknown): value is AgentReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORTS.has(value as AgentReasoningEffort)
}

function modelToolDescription(action: AgentModelRequest['manifest']['actions'][number]): string {
  const metadata = [
    `Permissions: ${action.permissions.join(', ') || 'none'}.`,
    `Cost: ${action.cost}.`,
    `Mutability: ${action.mutability}.`,
    `Cancellable: ${action.cancellable ? 'yes' : 'no'}.`,
    `Output schema: ${JSON.stringify(action.outputSchema)}.`,
  ].join(' ')
  return `${action.description} ${metadata}`.slice(0, 2_048)
}

function openRouterMessage(message: AgentModelMessage): JsonValue {
  if (message.role === 'system' || message.role === 'user')
    return {
      role: message.role,
      content:
        typeof message.content === 'string'
          ? message.content
          : message.content.map((part) =>
              part.type === 'text'
                ? { type: 'text', text: part.text }
                : { type: 'image_url', image_url: { url: part.dataUrl } },
            ),
    }
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.callId,
      name: agentToolName(message.actionId, message.actionVersion),
      content: message.content,
    }
  }
  if (message.role !== 'assistant')
    throw new AgentRuntimeError('INVALID_MODEL_RESPONSE', 'Unsupported agent message role.')
  return {
    role: 'assistant',
    content: message.content,
    ...(message.toolCalls === undefined
      ? {}
      : {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.callId,
            type: 'function',
            function: {
              name: agentToolName(call.actionId, call.actionVersion),
              arguments: JSON.stringify({
                input: call.input,
              }),
            },
          })),
        }),
    ...(message.providerDetails === undefined
      ? {}
      : { reasoning_details: message.providerDetails }),
  }
}

function messageContainsImage(message: AgentModelMessage): boolean {
  return (
    (message.role === 'system' || message.role === 'user') &&
    typeof message.content !== 'string' &&
    message.content.some((part) => part.type === 'image')
  )
}

function parseToolCalls(value: unknown, request: AgentModelRequest): readonly AgentActionCall[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 1)
    throw new AgentRuntimeError(
      'INVALID_MODEL_RESPONSE',
      'OpenRouter must return at most one sequential tool call per model step.',
    )
  return value.map((entry, index) => {
    const call = record(entry)
    const fn = record(call?.['function'])
    const name = typeof fn?.['name'] === 'string' ? fn['name'] : ''
    const capability = request.manifest.actions.find(({ toolName }) => toolName === name)
    if (capability === undefined)
      throw new AgentRuntimeError(
        'INVALID_MODEL_RESPONSE',
        `OpenRouter requested unknown tool ${name}.`,
      )
    const argumentsText = typeof fn?.['arguments'] === 'string' ? fn['arguments'] : ''
    const parsed = aiJsonParse<unknown>(argumentsText, { mode: 'safe' })
    if (!parsed.success)
      throw new AgentRuntimeError(
        'INVALID_MODEL_RESPONSE',
        `${capability.actionId} arguments are not valid JSON.`,
      )
    const args = record(parsed.data)
    if (args === undefined)
      throw new AgentRuntimeError(
        'INVALID_MODEL_RESPONSE',
        `${capability.actionId} arguments are malformed.`,
      )
    const input = args['input'] === undefined ? flattenedToolInput(args) : jsonValue(args['input'])
    return {
      callId:
        typeof call?.['id'] === 'string' && call['id'].length <= 256
          ? call['id']
          : `openrouter-call-${index + 1}`,
      actionId: capability.actionId,
      actionVersion: capability.actionVersion,
      projectRevision: request.manifest.projectRevision,
      input,
    }
  })
}

function parsePlan(content: string): AgentPlan | undefined {
  const trimmed = content.trim()
  if (trimmed.length === 0 || trimmed.length > 64 * 1_024) return undefined
  const parsed = aiJsonParse<unknown>(trimmed, { mode: 'safe' })
  if (!parsed.success) return undefined
  const root = record(parsed.data)
  const candidate = record(root?.['plan']) ?? root
  if (
    candidate === undefined ||
    typeof candidate['goalSummary'] !== 'string' ||
    !Array.isArray(candidate['actions']) ||
    !Array.isArray(candidate['approvalsRequired']) ||
    typeof candidate['stoppingCondition'] !== 'string' ||
    candidate['actions'].length > 32
  )
    return undefined
  const actions = candidate['actions'].flatMap((entry) => {
    const action = record(entry)
    if (
      action === undefined ||
      typeof action['actionId'] !== 'string' ||
      !Number.isSafeInteger(action['actionVersion']) ||
      action['input'] === undefined ||
      typeof action['expectedOutput'] !== 'string'
    )
      return []
    return [
      {
        actionId: action['actionId'],
        actionVersion: action['actionVersion'] as number,
        input: jsonValue(action['input']),
        expectedOutput: action['expectedOutput'].slice(0, 1_024),
      },
    ]
  })
  if (actions.length !== candidate['actions'].length) return undefined
  return {
    goalSummary: candidate['goalSummary'].slice(0, 4_096),
    actions,
    approvalsRequired: candidate['approvalsRequired']
      .filter((entry): entry is string => typeof entry === 'string')
      .slice(0, 32)
      .map((entry) => entry.slice(0, 1_024)),
    stoppingCondition: candidate['stoppingCondition'].slice(0, 4_096),
  }
}

async function responseJson(response: Response, key: string): Promise<unknown> {
  const text = await readBoundedResponseText(response)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new AgentRuntimeError(
      'PROVIDER_ERROR',
      redact(`OpenRouter returned malformed JSON (${response.status}).`, key),
    )
  }
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES)
    throw new AgentRuntimeError('PROVIDER_ERROR', 'OpenRouter response exceeded 2 MiB.')
  const reader = response.body?.getReader()
  if (reader === undefined) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES)
      throw new AgentRuntimeError('PROVIDER_ERROR', 'OpenRouter response exceeded 2 MiB.')
    return text
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value === undefined) continue
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new AgentRuntimeError('PROVIDER_ERROR', 'OpenRouter response exceeded 2 MiB.')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function openRouterFailure(status: number, value: unknown, key: string): AgentRuntimeError {
  const root = record(value)
  const error = record(root?.['error']) ?? root
  const metadata = record(error?.['metadata'])
  const availability = record(error?.['availability'])
  const type =
    typeof metadata?.['error_type'] === 'string'
      ? metadata['error_type']
      : typeof error?.['error_type'] === 'string'
        ? error['error_type']
        : 'provider_error'
  const code =
    availability?.['code'] === 'model_not_found' || type === 'model_not_found'
      ? 'UNSUPPORTED_MODEL'
      : 'PROVIDER_ERROR'
  const retryable =
    availability?.['retryable'] === true ||
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    type === 'provider_overloaded' ||
    type === 'provider_unavailable' ||
    type === 'timeout'
  const message =
    typeof error?.['message'] === 'string'
      ? redact(error['message'], key).slice(0, 1_024)
      : `OpenRouter request failed (${status}).`
  return new AgentRuntimeError(code, `${type}: ${message}`, retryable)
}

function redact(value: string, key: string): string {
  return value
    .split(key)
    .join('[REDACTED]')
    .replaceAll(/sk-or-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]')
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

function flattenedToolInput(args: Readonly<Record<string, unknown>>): JsonValue {
  return jsonValue(
    Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'projectRevision')),
  )
}

function jsonValue(value: unknown, depth = 0): JsonValue {
  if (depth > 32) throw new AgentRuntimeError('INVALID_MODEL_RESPONSE', 'JSON exceeds depth limit.')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((item) => jsonValue(item, depth + 1))
  const object = record(value)
  if (object === undefined)
    throw new AgentRuntimeError('INVALID_MODEL_RESPONSE', 'Value is not JSON-safe.')
  const result: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(object)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor')
      throw new AgentRuntimeError('INVALID_MODEL_RESPONSE', 'JSON contains a forbidden key.')
    result[key] = jsonValue(item, depth + 1)
  }
  return result
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
