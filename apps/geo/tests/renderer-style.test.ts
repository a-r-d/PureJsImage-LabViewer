import { createGeoRasterLayer } from '@pji-workbench/domain-geo'
import { describe, expect, it } from 'vitest'

import {
  canvasCompositeOperation,
  canvasSmoothingEnabled,
  displayStyleRevision,
  orderedDisplayLayers,
} from '../src/GeoViewport.js'

describe('Atlas renderer style policy', () => {
  it('maps every public blend and resample mode to the Canvas policy', () => {
    expect(
      (['normal', 'multiply', 'screen', 'lighten', 'darken'] as const).map((mode) =>
        canvasCompositeOperation(mode),
      ),
    ).toEqual(['source-over', 'multiply', 'screen', 'lighten', 'darken'])
    expect(canvasSmoothingEnabled('nearest')).toBe(false)
    expect(canvasSmoothingEnabled('bilinear')).toBe(true)
  })

  it('orders equal z-index layers stably and revisions order-affecting fields', () => {
    const first = createGeoRasterLayer({ id: 'first', sourceId: 'source', label: 'First' })
    const second = createGeoRasterLayer({ id: 'second', sourceId: 'source', label: 'Second' })
    expect(orderedDisplayLayers([second, first]).map(({ id }) => id)).toEqual(['second', 'first'])
    expect(
      orderedDisplayLayers([
        { ...first, zIndex: 2 },
        { ...second, zIndex: 1 },
      ]).map(({ id }) => id),
    ).toEqual(['second', 'first'])
    expect(displayStyleRevision(first)).not.toBe(
      displayStyleRevision({ ...first, blendMode: 'multiply' }),
    )
    expect(displayStyleRevision(first)).not.toBe(displayStyleRevision({ ...first, zIndex: 2 }))
    expect(displayStyleRevision(first)).not.toBe(
      displayStyleRevision({ ...first, style: { ...first.style, resample: 'bilinear' } }),
    )
  })
})
