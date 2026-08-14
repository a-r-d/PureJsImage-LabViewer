export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as const
export const SCRIPT_API_VERSION = 1 as const

export const PLUGIN_LIMITS = Object.freeze({
  identifierCharacters: 128,
  titleCharacters: 256,
  descriptionCharacters: 4_096,
  sourceBytes: 256 * 1024,
  manifestBytes: 32 * 1024,
  capabilities: 32,
  tests: 64,
  testValueBytes: 64 * 1024,
  messageBytes: 256 * 1024,
  provenanceReferences: 128,
})

export type PluginJsonPrimitive = boolean | number | string | null
export type PluginJsonValue =
  | PluginJsonPrimitive
  | readonly PluginJsonValue[]
  | { readonly [key: string]: PluginJsonValue }

export type PluginEntryKind = 'recipe' | 'trusted-module' | 'sandboxed-module'

export type ScriptCapability =
  | 'analysis.catalog'
  | 'analysis.dry-run'
  | 'analysis.execute'
  | 'dataset.read-descriptor'
  | 'file.export'
  | 'network.explicit-hosts'
  | 'result.read-page'
  | 'result.read-summary'
  | 'roi.propose'
  | 'roi.read'
  | 'source.read-metadata'
  | 'ui.propose'
  | 'viewport.propose'
  | 'viewport.read'
  | 'workspace.propose'
  | 'workspace.read'

export interface ContentIntegrityV1 {
  readonly algorithm: 'sha256'
  readonly digest: string
}

export interface CompatibilityRangeV1 {
  readonly pureJsImage: string
  readonly workbench: string
}

export interface PluginManifestV1 {
  readonly schemaVersion: typeof PLUGIN_MANIFEST_SCHEMA_VERSION
  readonly id: string
  readonly version: string
  readonly title: string
  readonly description: string
  readonly author?: string
  readonly license?: string
  readonly entryKind: PluginEntryKind
  readonly requestedCapabilities: readonly ScriptCapability[]
  readonly compatibility: CompatibilityRangeV1
  readonly integrity?: ContentIntegrityV1
}

export interface RecipeOperationReferenceV1 {
  readonly actionId: string
  readonly actionVersion: number
  readonly input: PluginJsonValue
}

export interface RecipeDocumentV1 {
  readonly schemaVersion: 1
  readonly kind: 'recipe'
  readonly id: string
  readonly version: string
  readonly title: string
  readonly description?: string
  readonly operations: readonly RecipeOperationReferenceV1[]
  readonly requestedCapabilities: readonly ScriptCapability[]
  readonly compatibility: CompatibilityRangeV1
  readonly integrity: ContentIntegrityV1
}

export interface AnalysisScriptManifestV1 {
  readonly scriptApiVersion: typeof SCRIPT_API_VERSION
  readonly requestedCapabilities: readonly ScriptCapability[]
  readonly pureJsImageCompatibility: string
  readonly workbenchCompatibility: string
  readonly entrypoint: 'main'
  readonly deterministic: boolean
}

export interface AnalysisScriptTestV1 {
  readonly id: string
  readonly title: string
  readonly fixtureId: string
  readonly expected: PluginJsonValue
}

export interface AnalysisScriptDocumentV1 {
  readonly schemaVersion: 1
  readonly kind: 'analysis-script'
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly language: 'typescript' | 'javascript'
  readonly source: string
  readonly manifest: AnalysisScriptManifestV1
  readonly tests: readonly AnalysisScriptTestV1[]
  readonly integrity: ContentIntegrityV1
}

export interface ScriptPermissionGrantV1 {
  readonly schemaVersion: 1
  readonly scriptId: string
  readonly sourceDigest: string
  readonly grantedCapabilities: readonly ScriptCapability[]
  readonly deniedCapabilities: readonly ScriptCapability[]
}

export interface LocalPluginInstallationV1 {
  readonly schemaVersion: 1
  readonly pluginId: string
  readonly pluginVersion: string
  readonly contentDigest: string
  readonly installedKind: 'recipe' | 'sandboxed-script'
  readonly permissionGrant: ScriptPermissionGrantV1
  readonly enabled: boolean
}

export interface AnalysisScriptTestResultV1 {
  readonly schemaVersion: 1
  readonly testId: string
  readonly status: 'passed' | 'failed' | 'cancelled' | 'limit-exceeded'
  readonly output?: PluginJsonValue
  readonly issues: readonly string[]
}

export interface ScriptProvenanceReferenceV1 {
  readonly kind: 'action' | 'dataset' | 'result' | 'roi' | 'source' | 'workspace'
  readonly id: string
  readonly version?: string
  readonly digest?: string
}

export interface ScriptActionTraceV1 {
  readonly sequence: number
  readonly api: string
  readonly actionId: string
  readonly actionVersion: number
  readonly permission: ScriptCapability
  readonly input: PluginJsonValue
  readonly outcome: 'allowed' | 'denied' | 'failed'
  readonly resultSummary?: PluginJsonValue
}

export interface ScriptRunProvenanceV1 {
  readonly schemaVersion: 1
  readonly scriptId: string
  readonly sourceHash: ContentIntegrityV1
  readonly manifest: AnalysisScriptManifestV1
  readonly permissions: ScriptPermissionGrantV1
  readonly actionTrace: readonly ScriptActionTraceV1[]
  readonly references: readonly ScriptProvenanceReferenceV1[]
  readonly resultSummary?: PluginJsonValue
}

export interface SandboxLimitsV1 {
  readonly memoryBytes: number
  readonly stackBytes: number
  readonly deadlineMilliseconds: number
  readonly sourceBytes: number
  readonly outputBytes: number
  readonly messages: number
  readonly messageBytes: number
  readonly apiCalls: number
  readonly consoleLines: number
}

export interface SandboxStartRequestV1 {
  readonly schemaVersion: 1
  readonly kind: 'sandbox.start'
  readonly requestId: string
  readonly document: AnalysisScriptDocumentV1
  readonly permissionGrant: ScriptPermissionGrantV1
  readonly limits: SandboxLimitsV1
  readonly api: PluginJsonValue
}

export interface SandboxCancelRequestV1 {
  readonly schemaVersion: 1
  readonly kind: 'sandbox.cancel'
  readonly requestId: string
}

export interface SandboxCapabilityResultV1 {
  readonly schemaVersion: 1
  readonly kind: 'sandbox.capability-result'
  readonly requestId: string
  readonly capabilityRequestId: string
  readonly ok: boolean
  readonly value?: PluginJsonValue
  readonly error?: string
}

export interface SandboxReadyEventV1 {
  readonly schemaVersion: 1
  readonly kind: 'sandbox.ready'
}

export interface SandboxExecutingEventV1 {
  readonly schemaVersion: 1
  readonly kind: 'sandbox.executing'
  readonly requestId: string
}

export interface SandboxCapabilityRequestV1 {
  readonly schemaVersion: 1
  readonly kind: 'sandbox.capability-request'
  readonly requestId: string
  readonly capabilityRequestId: string
  readonly api: string
  readonly input: PluginJsonValue
}

export interface SandboxLogEventV1 {
  readonly schemaVersion: 1
  readonly kind: 'sandbox.log'
  readonly requestId: string
  readonly level: 'info' | 'warn' | 'error'
  readonly message: string
}

export interface SandboxCompleteEventV1 {
  readonly schemaVersion: 1
  readonly kind: 'sandbox.complete'
  readonly requestId: string
  readonly status: 'completed' | 'cancelled' | 'failed' | 'limit-exceeded'
  readonly output?: PluginJsonValue
  readonly error?: string
}

export type SandboxHostMessageV1 =
  | SandboxCancelRequestV1
  | SandboxCapabilityResultV1
  | SandboxStartRequestV1
export type SandboxWorkerMessageV1 =
  | SandboxCapabilityRequestV1
  | SandboxCompleteEventV1
  | SandboxExecutingEventV1
  | SandboxLogEventV1
  | SandboxReadyEventV1

export interface ValidationIssue {
  readonly path: string
  readonly message: string
}

export interface ValidationResult<T> {
  readonly ok: boolean
  readonly value?: T
  readonly issues: readonly ValidationIssue[]
}

export interface PluginManifestIdentity {
  readonly schemaVersion: typeof PLUGIN_MANIFEST_SCHEMA_VERSION
  readonly id: string
  readonly version: string
  readonly entryKind: PluginEntryKind
}
