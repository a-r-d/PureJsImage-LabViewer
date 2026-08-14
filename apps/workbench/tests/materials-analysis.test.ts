import type { AnalysisTablePage, PlaneSelection } from '@pji-workbench/contracts'
import { describe, expect, it } from 'vitest'

import {
  connectedComponentsGraph,
  statisticsGraph,
  thresholdGraph,
} from '../src/analysis-workflows.js'
import { analysisPageRows } from '../src/MaterialsPanels.js'

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
})
