import { describe, expect, it } from 'vitest'

import {
  agentEvalChildEnvironment,
  parseAgentEvalArgs,
  selectedAgentEvalCases,
} from './run-science-agent-evals.mjs'

describe('live scientific agent eval launcher', () => {
  it('defaults to Luna with high reasoning and requires an explicit live flag', () => {
    expect(parseAgentEvalArgs([], {})).toMatchObject({
      confirmed: false,
      suite: 'smoke',
      model: 'openai/gpt-5.6-luna',
      reasoning: 'high',
      maxCostUsd: 0.25,
    })
    expect(parseAgentEvalArgs(['--confirm-live'], {}).confirmed).toBe(true)
  })

  it('selects bounded suites and individual known cases', () => {
    expect(selectedAgentEvalCases(parseAgentEvalArgs(['--suite', 'analysis'], {}))).toEqual([
      'sem-particle-count',
      'split-touching-particles',
    ])
    expect(
      selectedAgentEvalCases(
        parseAgentEvalArgs(['--case=split-touching-particles', '--max-cost-usd=0.4'], {}),
      ),
    ).toEqual(['split-touching-particles'])
  })

  it('removes the real OpenRouter key from every Playwright child environment', () => {
    const child = agentEvalChildEnvironment(
      { OPENROUTER_API_KEY: 'must-not-survive', PATH: '/bin' },
      { PJI_AGENT_EVAL_RELAY_TOKEN: 'ephemeral' },
    )
    expect(child).toEqual({ PATH: '/bin', PJI_AGENT_EVAL_RELAY_TOKEN: 'ephemeral' })
  })
})
