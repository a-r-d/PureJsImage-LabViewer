import { describe, expect, it } from 'vitest'

import { agentReferenceCards } from '../src/agent-reference-cards.js'

describe('agent reference cards', () => {
  it('collects source, dataset, ROI, result, and artifact references outside the model answer', () => {
    const cards = agentReferenceCards({
      trace: [
        {
          callId: '1',
          actionId: 'result.summary.read',
          actionVersion: 1,
          projectRevisionBefore: 1,
          projectRevisionAfter: 1,
          approval: 'automatic',
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:00:01.000Z',
          input: { roiId: 'roi-1', name: 'Particle field' },
          result: {
            sourceId: 'source-1',
            datasetId: 'dataset-1',
            resultHandleId: 'result-1',
            status: 'completed',
          },
        },
      ],
      artifacts: [
        {
          id: 'preview-1',
          kind: 'image',
          mimeType: 'image/png',
          width: 64,
          height: 48,
          bytes: 12,
          dataUrl: 'data:image/png;base64,QQ==',
          attribution: ['fixture'],
          projectRevision: 1,
        },
      ],
    })
    expect(cards.map(({ kind, id }) => `${kind}:${id}`)).toEqual(
      expect.arrayContaining([
        'action:result.summary.read@1',
        'source:source-1',
        'dataset:dataset-1',
        'roi:roi-1',
        'result:result-1',
        'artifact:preview-1',
      ]),
    )
  })
})
