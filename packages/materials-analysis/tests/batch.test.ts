import { describe, expect, it } from 'vitest'

import {
  datasetPlaneBatchItems,
  deterministicBatchOutputName,
  enabledCorpusScenarioBatchItems,
  runBatchRecipe,
} from '../src/batch.js'

describe('local batch recipe orchestration', () => {
  it('bounds concurrency, isolates partial failures, and records identities and hashes', async () => {
    let active = 0
    let peak = 0
    const controller = runBatchRecipe(
      [
        { id: 'a', sourceIdentity: 'sha256:a', sourceName: 'First GSF.gsf', input: 1 },
        { id: 'b', sourceIdentity: 'sha256:b', sourceName: 'Second.gsf', input: 2 },
        { id: 'c', sourceIdentity: 'sha256:c', sourceName: 'Third.gsf', input: 3 },
      ],
      {
        runId: 'run-1',
        recipeHash: 'abcdef0123456789',
        concurrency: 2,
        async execute(item) {
          active += 1
          peak = Math.max(peak, active)
          await Promise.resolve()
          active -= 1
          if (item.id === 'b') throw new Error('Known fixture failure')
          return item.input * 10
        },
      },
    )
    const result = await controller.result
    expect(peak).toBe(2)
    expect(result.rows.map(({ status }) => status)).toEqual(['succeeded', 'failed', 'succeeded'])
    expect(result.rows[1]).toMatchObject({
      sourceIdentity: 'sha256:b',
      recipeHash: 'abcdef0123456789',
      error: 'Known fixture failure',
    })
  })

  it('supports queued item cancellation and successful-row resume', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const items = [
      { id: 'a', sourceIdentity: 'a', sourceName: 'A', input: 1 },
      { id: 'b', sourceIdentity: 'b', sourceName: 'B', input: 2 },
    ]
    const first = runBatchRecipe(items, {
      runId: 'run',
      recipeHash: 'abc123',
      concurrency: 1,
      async execute(item) {
        await gate
        return item.input
      },
    })
    expect(first.cancelItem('b')).toBe(true)
    release?.()
    const completed = await first.result
    expect(completed.rows.map(({ status }) => status)).toEqual(['succeeded', 'cancelled'])
    let calls = 0
    const resumed = runBatchRecipe(items, {
      runId: 'run-2',
      recipeHash: 'abc123',
      concurrency: 1,
      resume: completed,
      execute(item) {
        calls += 1
        return Promise.resolve(item.input * 2)
      },
    })
    expect((await resumed.result).rows.map(({ status }) => status)).toEqual([
      'succeeded',
      'succeeded',
    ])
    expect(calls).toBe(1)
  })

  it('creates deterministic bounded output names', () => {
    expect(deterministicBatchOutputName('ÅFM Sample 01.gsf', 'sha256:ABCDEF0123456789', 2)).toBe(
      '0003-afm-sample-01-abcdef012345',
    )
  })

  it('normalizes selected dataset planes and only enabled corpus scenarios for the same runner', async () => {
    const planes = datasetPlaneBatchItems([
      {
        datasetIdentity: 'sha256:first',
        datasetName: 'First dataset',
        dataset: { id: 1 },
        planeIds: ['z-0', 'z-2'],
      },
      {
        datasetIdentity: 'sha256:second',
        datasetName: 'Second dataset',
        dataset: { id: 2 },
        planeIds: ['t-4'],
      },
    ])
    expect(planes.map(({ sourceIdentity }) => sourceIdentity)).toEqual([
      'sha256:first#plane=z-0',
      'sha256:first#plane=z-2',
      'sha256:second#plane=t-4',
    ])
    const scenarios = enabledCorpusScenarioBatchItems([
      { id: 'enabled-a', title: 'Enabled A', enabled: true, integrity: 'sha256:a', input: 1 },
      { id: 'disabled', title: 'Disabled', enabled: false, integrity: 'sha256:b', input: 2 },
      { id: 'enabled-c', title: 'Enabled C', enabled: true, integrity: 'sha256:c', input: 3 },
    ])
    expect(scenarios.map(({ sourceName }) => sourceName)).toEqual(['Enabled A', 'Enabled C'])
    const result = await runBatchRecipe(scenarios, {
      runId: 'corpus-test-mode',
      recipeHash: '1234abcd',
      concurrency: 2,
      execute: (item) => Promise.resolve(item.input * 2),
    }).result
    expect(result.rows.map(({ status }) => status)).toEqual(['succeeded', 'succeeded'])
  })
})
