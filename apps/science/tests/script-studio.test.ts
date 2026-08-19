import { normalizeStudioDocument } from '@pji-workbench/plugin-sdk'
import { describe, expect, it } from 'vitest'

import {
  approvedExecutionApi,
  boundedLineDiff,
  createStudioRecord,
  documentText,
} from '../src/features/scripts/studio-operations.js'

describe('Script Studio operations', () => {
  it('creates identity-bound records and bounded review diffs', async () => {
    const document = await normalizeStudioDocument({
      schemaVersion: 1,
      kind: 'analysis-script',
      id: 'local.test-script',
      title: 'Test script',
      language: 'typescript',
      source: 'export function main() { return 1 }',
      manifest: {
        scriptApiVersion: 1,
        requestedCapabilities: [],
        pureJsImageCompatibility: '*',
        workbenchCompatibility: '*',
        entrypoint: 'main',
        deterministic: true,
      },
      tests: [],
      integrity: { algorithm: 'sha256', digest: '0'.repeat(64) },
    })
    const record = await createStudioRecord(document)
    expect(record.savedDocument.integrity).toEqual(record.document.integrity)
    expect(documentText(record.document)).toContain('main')
    expect(boundedLineDiff('before', 'after')).toEqual(['- 1: before', '+ 1: after'])
  })

  it('truncates hostile large diffs deterministically', () => {
    const before = Array.from({ length: 1_000 }, (_, index) => `before-${index}`).join('\n')
    const after = Array.from({ length: 1_000 }, (_, index) => `after-${index}`).join('\n')
    const diff = boundedLineDiff(before, after)
    expect(diff).toHaveLength(401)
    expect(diff.at(-1)).toContain('truncated')
  })

  it('changes only graph execution to approved execute mode', () => {
    const api = {
      schemaVersion: 1 as const,
      scriptApiVersion: 1 as const,
      endpoints: [
        {
          api: 'analysis.execute',
          actionId: 'analysis.graph.request-execute',
          actionVersion: 1,
          permission: 'analysis.execute' as const,
          mode: 'dry-run' as const,
          description: 'Execute a graph after approval.',
        },
        {
          api: 'rois.create',
          actionId: 'roi.create',
          actionVersion: 1,
          permission: 'roi.propose' as const,
          mode: 'dry-run' as const,
          description: 'Propose an ROI.',
        },
      ],
      declaration: 'declare module "@lab/api" {}',
      moduleSource: 'export const lab = globalThis.__labApi',
    }
    const approved = approvedExecutionApi(api)
    expect(approved.endpoints.map(({ mode }) => mode)).toEqual(['execute', 'dry-run'])
    expect(api.endpoints.map(({ mode }) => mode)).toEqual(['dry-run', 'dry-run'])
  })
})
