import type {
  AgentModelRequest,
  AgentModelResponse,
  AgentModelSummary,
  AgentModelTransport,
} from './types.js'

export type DeterministicAgentStep =
  | AgentModelResponse
  | Error
  | ((
      request: AgentModelRequest,
      signal: AbortSignal,
    ) => AgentModelResponse | Promise<AgentModelResponse>)

export class DeterministicAgentTransport implements AgentModelTransport {
  readonly provider = 'fake'
  readonly requests: AgentModelRequest[] = []
  readonly #steps: DeterministicAgentStep[]

  constructor(
    steps: readonly DeterministicAgentStep[],
    readonly models: readonly AgentModelSummary[] = [
      {
        id: 'fake/atlas',
        name: 'Deterministic Workbench',
        supportedParameters: ['tools', 'max_tokens'],
        inputModalities: ['text'],
      },
    ],
  ) {
    this.#steps = [...steps]
  }

  async listModels(): Promise<readonly AgentModelSummary[]> {
    return this.models
  }

  async complete(request: AgentModelRequest, signal: AbortSignal): Promise<AgentModelResponse> {
    signal.throwIfAborted()
    this.requests.push(request)
    const step = this.#steps.shift()
    if (step === undefined) throw new Error('Deterministic agent transport has no remaining step.')
    if (step instanceof Error) throw step
    return typeof step === 'function' ? step(request, signal) : step
  }
}
