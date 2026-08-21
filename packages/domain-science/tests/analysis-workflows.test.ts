import { describe, expect, it } from 'vitest'

import { stackAxesForSelection, stackAxisForSelection } from '../src/analysis-workflows.js'

describe('stack axis selection', () => {
  const axes = [
    { id: 'axis0', kind: 'index', length: 64 },
    { id: 'axis1', kind: 'index', length: 64 },
    { id: 'axis2', kind: 'index', length: 8 },
  ] as const

  it('picks the non-display axis even when every axis is kind index', () => {
    expect(stackAxisForSelection(axes, ['axis0', 'axis1'])).toMatchObject({
      id: 'axis2',
      length: 8,
    })
    expect(stackAxesForSelection(axes, ['axis0', 'axis1']).map(({ id }) => id)).toEqual(['axis2'])
  })
})
