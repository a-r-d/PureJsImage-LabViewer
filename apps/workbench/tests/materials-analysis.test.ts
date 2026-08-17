import type {
  AnalysisExecutionResponse,
  AnalysisTablePage,
  PlaneSelection,
} from '@pji-workbench/contracts'
import { describe, expect, it } from 'vitest'
import { surfaceProfileEndpoints } from '../src/AdvancedMaterialsWorkflows.js'
import {
  appendDatasetAnalysisGraph,
  connectedComponentsGraph,
  lineProfileGraph,
  statisticsGraph,
  thresholdGraph,
} from '../src/analysis-workflows.js'
import {
  analysisPageRows,
  analysisResultHeadline,
  formatRoughnessHeadline,
  frequencyPeakAnnotations,
  shouldShowResultPreview,
} from '../src/MaterialsPanels.js'
import { displayRangeFromTile } from '../src/ScientificViewport.js'

const selection: PlaneSelection = {
  displayAxes: ['x', 'y'],
  fixedIndices: [],
  resolutionLevel: 0,
}

describe('materials analysis UI contracts', () => {
  it('builds public-operation graphs without display mapping inputs', () => {
    const threshold = thresholdGraph({ component: 2, threshold: 17, mode: 'greater-than' })
    expect(threshold.nodes[0]).toMatchObject({
      operation: { id: 'purejsimage.analysis.threshold', version: 1 },
      parameters: { component: 2, threshold: 17, mode: 'greater-than' },
    })
    expect(JSON.stringify(threshold)).not.toContain('mapping')
    expect(
      connectedComponentsGraph({
        component: 2,
        threshold: 17,
        mode: 'greater-than',
        selection,
        connectivity: 8,
      }).nodes,
    ).toHaveLength(2)
    expect(statisticsGraph(selection, 0).inputs.map(({ name }) => name)).toEqual([
      'source',
      'selection',
    ])
  })

  it('attaches a line profile to a multi-output FFT graph through the magnitude dataset', () => {
    const fft = {
      schemaVersion: 1 as const,
      inputs: [{ name: 'source', valueType: { id: 'purejsimage.scientific.dataset', version: 1 } }],
      nodes: [
        {
          id: 'materials-fft-workspace',
          label: '2D FFT workspace',
          operation: { id: 'pji-workbench.materials.frequency.fft2d', version: 1 },
          inputs: [{ port: 'dataset', source: { kind: 'input' as const, input: 'source' } }],
          parameters: {},
        },
      ],
      outputs: [
        {
          name: 'magnitude',
          source: { kind: 'node' as const, nodeId: 'materials-fft-workspace', output: 'magnitude' },
        },
        {
          name: 'peaks',
          source: { kind: 'node' as const, nodeId: 'materials-fft-workspace', output: 'peaks' },
        },
      ],
    }
    const attached = appendDatasetAnalysisGraph(fft, lineProfileGraph(selection, 0), 'magnitude')
    expect(attached.outputs.map(({ name }) => name)).toEqual(['magnitude', 'profile'])
    expect(attached.nodes.some(({ id }) => id === 'profile')).toBe(true)
  })

  it('materializes only the current page when totalRows is 100,000', () => {
    const page: AnalysisTablePage = {
      offset: 49_950,
      rowCount: 50,
      totalRows: 100_000,
      columns: [
        {
          name: 'label',
          kind: 'numeric',
          values: Array.from({ length: 50 }, (_value, index) => 49_951 + index),
        },
      ],
    }
    const visible = analysisPageRows(page)
    expect(visible).toHaveLength(50)
    expect(visible[0]).toEqual({ label: 49_951 })
    expect(JSON.stringify(page).length).toBeLessThan(2_000)
  })

  it('omits the DC beam-center peak and labels remaining peaks with d-spacing', () => {
    const page: AnalysisTablePage = {
      offset: 0,
      rowCount: 3,
      totalRows: 3,
      columns: [
        { name: 'x', kind: 'numeric', values: [128, 160, 96] },
        { name: 'y', kind: 'numeric', values: [128, 128, 128] },
        { name: 'radialFrequency', kind: 'numeric', unit: '1/nm', values: [0, 0.125, 0.125] },
        { name: 'frequencyX', kind: 'numeric', values: [0, 0.125, -0.125] },
        { name: 'frequencyY', kind: 'numeric', values: [0, 0, 0] },
        { name: 'dSpacing', kind: 'numeric', unit: 'nm', values: [Number.NaN, 8, 8] },
      ],
    }
    expect(frequencyPeakAnnotations(page)).toEqual([
      { x: 160, y: 128, label: 'd=8.00 nm' },
      { x: 96, y: 128, label: '' },
    ])
  })

  it('hides the coarse result preview when a real series plot already exists', () => {
    const execution: AnalysisExecutionResponse = {
      resultHandleId: 'profile-result' as AnalysisExecutionResponse['resultHandleId'],
      outputs: [
        {
          kind: 'result',
          name: 'profile',
          summary: { kind: 'profile', preview: { value: [1, 2, 3] } },
        },
      ],
      provenance: {},
      elapsedMilliseconds: 12,
    }
    expect(
      shouldShowResultPreview(execution, [
        { name: 'profile', data: { rowCount: 3, truncated: false, columns: [] } },
      ]),
    ).toBe(false)
    expect(shouldShowResultPreview(execution, undefined)).toBe(true)
  })

  it('formats AFM roughness as the results headline', () => {
    const execution: AnalysisExecutionResponse = {
      resultHandleId: 'surface-result' as AnalysisExecutionResponse['resultHandleId'],
      outputs: [
        { kind: 'dataset', name: 'corrected', descriptor: {} },
        {
          kind: 'result',
          name: 'roughness',
          summary: {
            kind: 'collection',
            preview: {
              Ra: { preview: 1.25, unit: 'nm' },
              Rq: { preview: 1.5, unit: 'nm' },
              Rz: { preview: 4, unit: 'nm' },
            },
          },
        },
      ],
      provenance: {},
      elapsedMilliseconds: 40,
    }
    expect(formatRoughnessHeadline(execution)).toBe('Rq 1.500 nm · Ra 1.250 nm · Rz 4.000 nm')
    expect(
      analysisResultHeadline({
        busy: false,
        tableOffset: 0,
        execution,
      }),
    ).toBe('Rq 1.500 nm · Ra 1.250 nm · Rz 4.000 nm')
  })

  it('drops a singleton DC/hot-pixel bin from display auto-range', () => {
    const histogram = Array.from({ length: 64 }, (_value, index) => (index === 63 ? 1 : 40))
    histogram[20] = 400
    expect(displayRangeFromTile({ minimum: 0, maximum: 16 }, histogram)).toEqual({
      minimum: 0,
      maximum: 15.75,
    })
    expect(
      displayRangeFromTile(
        { minimum: 0, maximum: 255 },
        Array.from({ length: 64 }, () => 100),
      ),
    ).toEqual({ minimum: 0, maximum: 255 })
  })

  it('defaults the AFM height profile to the included rectangle, not a 256-pixel corner', () => {
    expect(surfaceProfileEndpoints(1024, 768)).toEqual({
      profileX0: 0,
      profileY0: 0,
      profileX1: 1023,
      profileY1: 767,
    })
    expect(surfaceProfileEndpoints(1024, 768, { x: 10, y: 20, width: 200, height: 80 })).toEqual({
      profileX0: 10,
      profileY0: 20,
      profileX1: 209,
      profileY1: 99,
    })
  })
})
