import { describe, expect, it } from 'vitest'

import { agentAnswerPresentation, agentUsagePresentation } from '../src/AgentConversationShell.js'

describe('agent answer presentation', () => {
  it('keeps concise responses visible and folds unusually long responses behind a bounded preview', () => {
    expect(agentAnswerPresentation('A concise result.')).toEqual({
      folded: false,
      preview: 'A concise result.',
    })
    const long = `# Result\n\n${'Measured evidence and limitation. '.repeat(60)}`
    const presentation = agentAnswerPresentation(long)
    expect(presentation.folded).toBe(true)
    expect(presentation.preview.length).toBeLessThanOrEqual(521)
    expect(presentation.preview.endsWith('…')).toBe(true)
  })
})

describe('agent usage presentation', () => {
  it('keeps current context and complete provider cost compact', () => {
    expect(
      agentUsagePresentation({
        modelCalls: 3,
        promptTokens: 24_000,
        completionTokens: 2_100,
        totalTokens: 26_100,
        latestPromptTokens: 12_000,
        contextLength: 400_000,
        costUsd: 0.03738417,
        costComplete: true,
      }),
    ).toMatchObject({
      compact: 'ctx 3% · $0.037',
      description: expect.stringContaining('12,000 of 400,000 tokens'),
    })
  })

  it('labels incomplete or unavailable provider accounting honestly', () => {
    expect(
      agentUsagePresentation({
        modelCalls: 2,
        promptTokens: 1_500,
        completionTokens: 200,
        totalTokens: 1_700,
        latestPromptTokens: 900,
        costUsd: 0.01,
        costComplete: false,
      }),
    ).toMatchObject({ compact: 'ctx 900 · $0.010+' })
    expect(agentUsagePresentation(undefined)).toBeUndefined()
  })
})
