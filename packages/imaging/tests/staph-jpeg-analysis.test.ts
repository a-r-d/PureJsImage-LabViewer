import { readFile } from 'node:fs/promises'

import { rpcRequest } from '@pji-workbench/contracts'
import { describe, expect, it } from 'vitest'

import { ImagingWorkerHost } from '../src/index.js'

describe('bundled JPEG analysis', () => {
  it('runs connected-components on the original CDC S. aureus JPEG', async () => {
    const bytes = await readFile(
      new URL('../../../apps/science/public/examples/real/staph-aureus-sem.jpg', import.meta.url),
    )
    const host = new ImagingWorkerHost()
    const file = new File([bytes.slice().buffer as ArrayBuffer], 'staph-aureus-sem.jpg', {
      type: 'image/jpeg',
    })
    const sourceResult = await host.handle(
      rpcRequest('analysis-source', 'source.open-local', {
        generation: 1,
        primaryId: 'file-0',
        files: [
          {
            id: 'file-0',
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: 0,
            blob: file,
          },
        ],
      }),
    )
    expect(sourceResult.response.ok).toBe(true)
    if (!sourceResult.response.ok) return
    const source = sourceResult.response.payload
    const datasetResult = await host.handle(
      rpcRequest('dataset-open', 'dataset.open', {
        documentId: source.documentId,
        datasetId: source.datasets[0]?.id ?? 'missing',
        generation: 1,
      }),
    )
    expect(datasetResult.response.ok).toBe(true)
    if (!datasetResult.response.ok) return
    const dataset = datasetResult.response.payload
    const graph = {
      schemaVersion: 1,
      inputs: [{ name: 'source', valueType: { id: 'purejsimage.scientific.dataset', version: 1 } }],
      nodes: [
        {
          id: 'threshold',
          label: 'Threshold',
          operation: { id: 'purejsimage.analysis.threshold', version: 1 },
          inputs: [{ port: 'dataset', source: { kind: 'input', input: 'source' } }],
          parameters: { mode: 'greater-than', component: 0, threshold: 128 },
        },
        {
          id: 'connected-components',
          label: 'Connected components',
          operation: { id: 'purejsimage.analysis.connected-components', version: 1 },
          inputs: [
            {
              port: 'dataset',
              source: { kind: 'node', nodeId: 'threshold', output: 'dataset' },
            },
          ],
          parameters: { displayAxes: ['x', 'y'], fixedIndices: [], component: 0, connectivity: 8 },
        },
      ],
      outputs: [
        { name: 'mask', source: { kind: 'node', nodeId: 'threshold', output: 'dataset' } },
        {
          name: 'labels',
          source: { kind: 'node', nodeId: 'connected-components', output: 'labels' },
        },
        {
          name: 'objects',
          source: { kind: 'node', nodeId: 'connected-components', output: 'objects' },
        },
      ],
    }
    const executed = await host.handle(
      rpcRequest('exec', 'analysis.execute', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        graph,
      }),
    )
    expect(executed.response.ok, JSON.stringify(executed.response)).toBe(true)
    if (!executed.response.ok) return
    expect(executed.response.payload.outputs.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['mask', 'labels', 'objects']),
    )
    const page = await host.handle(
      rpcRequest('page', 'analysis.table-page', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        resultHandleId: executed.response.payload.resultHandleId,
        output: 'objects',
        offset: 0,
        limit: 10,
      }),
    )
    expect(page.response.ok).toBe(true)
    if (!page.response.ok) return
    expect(page.response.payload.totalRows).toBeGreaterThan(0)
    await host.dispose()
  })
})
