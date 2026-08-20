import type {
  ActionAvailability,
  ActionCost,
  ActionExecutionPlan,
  ActionMutability,
  JsonSchema,
  JsonValue,
} from '@pji-workbench/actions'

export type AgentPermission =
  | 'workspace.read'
  | 'workspace.propose'
  | 'analysis.execute'
  | 'compute.expensive'
  | 'network.read'
  | 'network.explicit-hosts'
  | 'network.open-source'
  | 'network.relay'
  | 'source.read-metadata'
  | 'source.read-pixels'
  | 'viewport.read'
  | 'viewport.propose'
  | 'model.preview'
  | 'file.export'
  | 'plugin.install'

export type AgentDecision = 'allow' | 'deny' | 'require-approval'

export interface AgentActionCapability {
  readonly toolName: string
  readonly actionId: string
  readonly actionVersion: number
  readonly title: string
  readonly description: string
  readonly inputSchema: JsonSchema
  readonly outputSchema: JsonSchema
  readonly permissions: readonly string[]
  readonly cost: ActionCost
  readonly mutability: ActionMutability
  readonly cancellable: boolean
  readonly availability: ActionAvailability
}

export interface AgentCapabilityManifest {
  readonly schemaVersion: 1
  readonly projectRevision: number
  readonly actions: readonly AgentActionCapability[]
}

export interface AgentActionCall {
  readonly callId: string
  readonly actionId: string
  readonly actionVersion: number
  readonly projectRevision: number
  readonly input: JsonValue
}

export interface AgentPlanAction {
  readonly actionId: string
  readonly actionVersion: number
  readonly input: JsonValue
  readonly expectedOutput: string
}

export interface AgentPlan {
  readonly goalSummary: string
  readonly actions: readonly AgentPlanAction[]
  readonly approvalsRequired: readonly string[]
  readonly stoppingCondition: string
}

export type AgentMessageContent =
  | string
  | readonly (
      | Readonly<{ type: 'text'; text: string }>
      | Readonly<{ type: 'image'; dataUrl: string }>
    )[]

export type AgentModelMessage =
  | Readonly<{ role: 'system' | 'user'; content: AgentMessageContent }>
  | Readonly<{
      role: 'assistant'
      content: string
      toolCalls?: readonly AgentActionCall[]
      providerDetails?: JsonValue
    }>
  | Readonly<{
      role: 'tool'
      callId: string
      actionId: string
      actionVersion: number
      content: string
    }>

export interface AgentModelRequest {
  readonly model: string
  readonly messages: readonly AgentModelMessage[]
  readonly manifest: AgentCapabilityManifest
  readonly maximumTokens: number
}

export interface AgentModelResponse {
  readonly provider: string
  readonly model: string
  readonly content: string
  readonly toolCalls: readonly AgentActionCall[]
  readonly plan?: AgentPlan
  readonly providerDetails?: JsonValue
  readonly usage?: Readonly<{
    readonly promptTokens?: number
    readonly completionTokens?: number
    readonly totalTokens?: number
  }>
}

export interface AgentModelSummary {
  readonly id: string
  readonly name: string
  readonly contextLength?: number
  readonly supportedParameters: readonly string[]
  readonly inputModalities: readonly string[]
}

export interface AgentModelTransport {
  readonly provider: string
  complete(request: AgentModelRequest, signal: AbortSignal): Promise<AgentModelResponse>
  listModels?(signal?: AbortSignal): Promise<readonly AgentModelSummary[]>
  validateModel?(
    model: string,
    requirements: Readonly<{ imageInput: boolean }>,
    signal: AbortSignal,
  ): Promise<void>
}

export interface AgentPolicyResult {
  readonly decision: AgentDecision
  readonly reason: string
  readonly permissions: readonly string[]
}

export interface AgentPolicy {
  decide(
    capability: AgentActionCapability,
    input: JsonValue,
    context: Readonly<{ projectRevision: number }>,
  ): AgentPolicyResult
}

export interface AgentActionGateway {
  revision(): number
  capabilities(): AgentCapabilityManifest
  context(): JsonValue
  plan(call: AgentActionCall): ActionExecutionPlan
  execute(call: AgentActionCall, signal: AbortSignal): Promise<JsonValue>
  auditContext?(): JsonValue
}

export type AgentRunStatus =
  | 'idle'
  | 'building-context'
  | 'requesting-model'
  | 'awaiting-approval'
  | 'executing-tool'
  | 'awaiting-tool-result'
  | 'summarizing'
  | 'completed'
  | 'cancelled'
  | 'failed'

export interface AgentApprovalRequest {
  readonly id: string
  readonly call: AgentActionCall
  readonly title: string
  readonly reason: string
  readonly permissions: readonly string[]
  readonly cost: ActionCost
  readonly mutability: ActionMutability
}

export interface AgentActionTrace {
  readonly callId: string
  readonly actionId: string
  readonly actionVersion: number
  readonly input: JsonValue
  readonly projectRevisionBefore: number
  readonly projectRevisionAfter: number
  readonly approval: 'automatic' | 'approved'
  readonly result: JsonValue
  readonly startedAt: string
  readonly completedAt: string
}

export interface AgentArtifact {
  readonly id: string
  readonly kind: 'image'
  readonly mimeType: string
  readonly bytes: number
  readonly width?: number
  readonly height?: number
  readonly dataUrl: string
  readonly attribution: readonly string[]
  readonly projectRevision: number
}

export interface AgentAuditRecord {
  readonly schemaVersion: 1
  readonly id: string
  readonly userRequest: string
  readonly provider: string
  readonly model: string
  readonly initialProjectRevision: number
  readonly plan?: AgentPlan
  readonly approvals: readonly Readonly<{
    id: string
    callId: string
    decision: 'approved' | 'denied'
    at: string
  }>[]
  readonly trace: readonly AgentActionTrace[]
  readonly artifactIds: readonly string[]
  readonly failures: readonly Readonly<{ code: string; message: string; at: string }>[]
  readonly retries: number
  readonly context: JsonValue
  readonly startedAt: string
  readonly completedAt?: string
}

export interface AgentConversationTurn {
  readonly id: string
  readonly request: string
  readonly answer: string
  readonly model: string
  readonly completedAt: string
}

export interface AgentRuntimeSnapshot {
  readonly status: AgentRunStatus
  readonly activeTaskId?: string
  readonly model?: string
  readonly plan?: AgentPlan
  readonly approval?: AgentApprovalRequest
  readonly trace: readonly AgentActionTrace[]
  readonly artifacts: readonly AgentArtifact[]
  readonly finalText?: string
  readonly error?: Readonly<{ code: string; message: string }>
  readonly audit?: AgentAuditRecord
  readonly conversation: readonly AgentConversationTurn[]
  readonly conversationTurnCount: number
  readonly conversationMessageCount: number
}

export interface AgentRuntimeLimits {
  readonly maximumModelSteps: number
  readonly maximumToolCalls: number
  readonly maximumTokens: number
  readonly maximumToolResultBytes: number
  readonly maximumConcurrentTasks: number
  readonly timeoutMilliseconds: number
  readonly maximumProviderRetries: number
  readonly maximumResultArrayItems: number
  readonly maximumConversationMessages: number
  readonly maximumConversationBytes: number
}

export class AgentRuntimeError extends Error {
  constructor(
    readonly code:
      | 'ABORTED'
      | 'ACTION_EXECUTION_FAILED'
      | 'ACTION_UNAVAILABLE'
      | 'ACTION_VALIDATION_FAILED'
      | 'APPROVAL_DENIED'
      | 'CONCURRENT_TASK_LIMIT'
      | 'CONTEXT_TOO_LARGE'
      | 'INVALID_MODEL_RESPONSE'
      | 'MAXIMUM_STEPS'
      | 'MAXIMUM_TOOL_CALLS'
      | 'POLICY_DENIED'
      | 'PROVIDER_ERROR'
      | 'STALE_PROJECT_REVISION'
      | 'TIMEOUT'
      | 'TOOL_OUTPUT_TOO_LARGE'
      | 'UNSUPPORTED_MODEL',
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'AgentRuntimeError'
  }
}
