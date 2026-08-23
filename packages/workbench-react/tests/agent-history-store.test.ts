import { type AgentActionTrace, type AgentRuntimeSnapshot, emptyLedger } from '@pji-workbench/agent'
import { describe, expect, it } from 'vitest'

import {
  agentHistorySessionFromSnapshot,
  InMemoryAgentHistoryStore,
  normalizeAgentHistorySession,
} from '../src/agent-history-store.js'

const metadata = {
  id: 'session-1',
  scope: 'science',
  createdAt: '2026-08-22T20:00:00.000Z',
  updatedAt: '2026-08-22T20:01:00.000Z',
} as const

function runtimeSnapshot(overrides: Partial<AgentRuntimeSnapshot> = {}): AgentRuntimeSnapshot {
  return {
    status: 'idle',
    trace: [],
    artifacts: [],
    conversation: [],
    conversationTurnCount: 0,
    conversationMessageCount: 0,
    grants: [],
    ledger: emptyLedger(),
    ...overrides,
  }
}

describe('agent history persistence', () => {
  it('stores completed responses locally while redacting credential-shaped text', async () => {
    const session = agentHistorySessionFromSnapshot(
      metadata,
      runtimeSnapshot({
        status: 'completed',
        conversation: [
          {
            id: 'turn-1',
            request: 'Inspect this specimen with sk-or-v1-secretvalue123.',
            answer: 'Completed without using Bearer abcdefghijklmnop.',
            model: 'fake/atlas',
            completedAt: '2026-08-22T20:01:00.000Z',
            actions: [],
          },
        ],
        conversationTurnCount: 1,
        conversationMessageCount: 2,
      }),
    )
    if (session === undefined) throw new Error('Expected a persisted session.')
    const store = new InMemoryAgentHistoryStore()
    await store.upsert(session)

    const [saved] = await store.list('science')
    expect(saved?.turns[0]?.request).toContain('[redacted OpenRouter key]')
    expect(saved?.turns[0]?.answer).toContain('Bearer [redacted credential]')
    expect(JSON.stringify(saved)).not.toContain('secretvalue123')
    expect(JSON.stringify(saved)).not.toContain('abcdefghijklmnop')
  })

  it('captures a failed in-flight request and its bounded action identities', () => {
    const trace: AgentActionTrace = {
      callId: 'call-1',
      actionId: 'analysis.particle.execute',
      actionVersion: 1,
      input: {},
      projectRevisionBefore: 1,
      projectRevisionAfter: 2,
      approval: 'automatic',
      result: { resultId: 'result-1' },
      startedAt: '2026-08-22T20:00:10.000Z',
      completedAt: '2026-08-22T20:00:20.000Z',
    }
    const session = agentHistorySessionFromSnapshot(
      metadata,
      runtimeSnapshot({
        status: 'failed',
        model: 'fake/atlas',
        trace: [trace],
        error: { code: 'MAXIMUM_STEPS', message: 'The bounded step limit was reached.' },
      }),
      {
        request: 'Count the particles.',
        turnCount: 0,
        startedAt: '2026-08-22T20:00:00.000Z',
      },
    )
    expect(session).toMatchObject({
      status: 'failed',
      turns: [
        {
          request: 'Count the particles.',
          outcome: 'failed',
          error: { code: 'MAXIMUM_STEPS' },
          actions: [{ actionId: 'analysis.particle.execute', actionVersion: 1 }],
        },
      ],
    })
    expect(JSON.stringify(session)).not.toContain('result-1')
  })

  it('rejects corrupt records at the IndexedDB read boundary', () => {
    expect(() =>
      normalizeAgentHistorySession({
        schemaVersion: 1,
        key: 'science:session-1',
        id: 'session-1',
        scope: 'science',
        title: 'Invalid',
        createdAt: 'not-a-date',
        updatedAt: '2026-08-22T20:01:00.000Z',
        status: 'completed',
        turns: [],
      }),
    ).toThrow('creation time is invalid')
  })
})
