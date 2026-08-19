import type { ActionDefinition } from '@pji-workbench/actions'
import type { AgentDecision, AgentPermission } from '@pji-workbench/agent'

export const DOMAIN_IDS = ['gallery', 'science', 'geo', 'medical'] as const
export type DomainId = (typeof DOMAIN_IDS)[number]

export const SOURCE_ADAPTER_KINDS = ['local', 'remote', 'sample', 'bundled'] as const
export type SourceAdapterKind = (typeof SOURCE_ADAPTER_KINDS)[number]

export interface DomainCapabilityFlags {
  readonly localFiles: boolean
  readonly remoteHttps: boolean
  readonly generatedSamples: boolean
  readonly bundledExamples: boolean
  readonly scripts: boolean
  readonly agent: boolean
  readonly particleAnalysis: boolean
  readonly materialsToolbox: boolean
  readonly batch: boolean
  readonly fft: boolean
  readonly surface: boolean
  readonly stack: boolean
  readonly projectPersistence: boolean
}

export interface DomainAgentPolicy {
  readonly enabled: boolean
  readonly liveModelEnabled: boolean
  readonly decisionFor: (permission: AgentPermission) => AgentDecision
}

export interface DomainWorkflowRecipe {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly kind: 'analysis-graph' | 'recipe' | 'script'
}

export interface HeadlessDomainProfile<Context> {
  readonly id: DomainId
  readonly title: string
  readonly description: string
  readonly readerIds: readonly string[]
  readonly sourceAdapters: readonly SourceAdapterKind[]
  readonly exampleScenarioIds: readonly string[]
  readonly workflowRecipes: readonly DomainWorkflowRecipe[]
  readonly actionDefinitions: readonly ActionDefinition<Context>[]
  readonly capabilities: DomainCapabilityFlags
  readonly agentPolicy: DomainAgentPolicy
}

export interface DomainPanelContribution {
  readonly id: string
  readonly title: string
  readonly surface: 'inspector' | 'bottom' | 'dialog' | 'overlay' | 'navigator'
}

export interface DomainRouteContribution {
  readonly path: string
  readonly id: string
  readonly component: string
  readonly title: string
  readonly readyAttribute: string
}

export interface DomainEmptyState {
  readonly kicker: string
  readonly heading: string
  readonly body: string
  readonly primaryActionId: 'source.open-local'
  readonly secondaryAction: 'browse-examples' | 'source.open-remote' | 'workspace.openProject'
}

export interface DomainDefaultLayout {
  readonly inspectorTab: 'info' | 'display' | 'roi' | 'analysis' | 'history' | 'agent'
  readonly bottomTab: 'pipeline' | 'history' | 'histogram' | 'profile' | 'results' | 'log'
}

export interface DomainUiContributions {
  readonly applicationTitle: string
  readonly shellHeading: string
  readonly emptyState: DomainEmptyState
  readonly defaultLayout: DomainDefaultLayout
  readonly panels: readonly DomainPanelContribution[]
  readonly routes: readonly DomainRouteContribution[]
}

export function assertKnownDomainId(id: string): DomainId {
  if ((DOMAIN_IDS as readonly string[]).includes(id)) return id as DomainId
  throw new Error(`Unknown domain id: ${id}`)
}
