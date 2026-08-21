import type {
  AgentRuntime,
  OpenRouterTransport,
  OptionalPersistentOpenRouterCredentialStore,
} from '@pji-workbench/agent'
import { AgentConversationShell, ATLAS_AGENT_COPY } from '@pji-workbench/workbench-react'

const STARTERS = [
  {
    title: 'Search Kentucky',
    prompt: 'Search the local catalog for Kentucky and open a decoder-ready COG.',
  },
  {
    title: 'Explain telemetry',
    prompt: 'Explain the current COG X-ray telemetry without fetching extra ranges.',
  },
  {
    title: 'Natural color',
    prompt: 'Use named bands to display natural color if the metadata supports it.',
  },
  {
    title: 'Plan NDVI',
    prompt: 'Plan a bounded NDVI derivation and wait for approval before creating the layer.',
  },
] as const

const MODEL_PREFERENCE_KEY = 'purejsimage-atlas-agent-model-v1'

export function AgentPanel({
  runtime,
  credentials,
  transport,
}: {
  readonly runtime: AgentRuntime
  readonly credentials: OptionalPersistentOpenRouterCredentialStore
  readonly transport: OpenRouterTransport
}) {
  return (
    <AgentConversationShell
      copy={ATLAS_AGENT_COPY}
      credentials={credentials}
      modelPreferenceKey={MODEL_PREFERENCE_KEY}
      runtime={runtime}
      starters={STARTERS}
      transport={transport}
    />
  )
}
