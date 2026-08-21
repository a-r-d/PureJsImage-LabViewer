import type {
  AgentRuntime,
  OpenRouterTransport,
  OptionalPersistentOpenRouterCredentialStore,
} from '@pji-workbench/agent'
import { AgentConversationShell, SCIENCE_AGENT_COPY } from '@pji-workbench/workbench-react'

const STARTERS = [
  {
    title: 'Count particles',
    prompt:
      'Count and measure the particles in this image. Inspect the result and tell me whether the segmentation looks reliable.',
  },
  {
    title: 'Tune segmentation',
    prompt:
      'Run particle analysis, inspect the labels, and tune the parameters if particles look missed or merged.',
  },
  {
    title: 'Inspect this image',
    prompt:
      'Inspect the current image and its metadata, then suggest the most useful bounded analysis to run.',
  },
  {
    title: 'Explain my results',
    prompt:
      'Explain the current analysis result in plain language, including the calibration, units, assumptions, and limitations.',
  },
] as const

const MODEL_PREFERENCE_KEY = 'purejsimage-lab-agent-model-v1'

export function ScienceAgentPanel({
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
      copy={SCIENCE_AGENT_COPY}
      credentials={credentials}
      modelPreferenceKey={MODEL_PREFERENCE_KEY}
      runtime={runtime}
      starters={STARTERS}
      transport={transport}
    />
  )
}
