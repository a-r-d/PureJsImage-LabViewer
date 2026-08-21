import { describe, expect, it } from 'vitest'

import {
  agentEvalChildEnvironment,
  parseAgentEvalArgs,
  selectedAgentEvalCases,
  summarizeAgentEvalReports,
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
      'particle-quality-required',
      'fft-spacing',
      'surface-roughness',
      'stack-drift',
    ])
    expect(selectedAgentEvalCases(parseAgentEvalArgs(['--suite', 'safety'], {}))).toEqual([
      'untrusted-metadata',
    ])
    expect(selectedAgentEvalCases(parseAgentEvalArgs(['--suite', 'ome-zarr'], {}))).toEqual([
      'ome-zarr-open-v2',
      'ome-zarr-open-v3-sharded',
      'ome-zarr-select-plane',
      'ome-zarr-authored-channels',
      'ome-zarr-chunks-vs-shards',
      'ome-zarr-fetch-telemetry',
      'ome-zarr-label-dataset',
      'ome-zarr-unsupported-codec',
      'ome-zarr-cancel-open',
      'ome-zarr-rebind-directory',
      'ome-zarr-bounded-preview',
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

  it('aggregates pass@1, cost, and failure categories across repetitions', () => {
    const summary = summarizeAgentEvalReports([
      { caseId: 'sem-particle-count', passed: true, knownCostUsd: 0.1 },
      { caseId: 'sem-particle-count', passed: false, knownCostUsd: 0.2, failure: 'count' },
      { caseId: 'sem-particle-count', passed: false, knownCostUsd: 0.3, failure: 'count' },
    ])
    expect(summary).toHaveLength(1)
    expect(summary[0]).toMatchObject({
      caseId: 'sem-particle-count',
      passAt1: 1 / 3,
      repetitions: 3,
      commonFailures: ['count'],
    })
    expect(summary[0]?.meanCostUsd).toBeCloseTo(0.2, 10)
  })
})
