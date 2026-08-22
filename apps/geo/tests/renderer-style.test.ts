import { createGeoRasterLayer } from '@pji-workbench/domain-geo'
import { describe, expect, it } from 'vitest'

import {
  canvasCompositeOperation,
  canvasSmoothingEnabled,
  canvasTileTransform,
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

  it('snaps adjacent north-up tile edges to the same device pixel', () => {
    const left = canvasTileTransform(
      { x: 10.2, y: 20.4 },
      { x: 266.45, y: 20.4 },
      { x: 10.2, y: 276.65 },
      256,
      256,
      1,
    )
    const right = canvasTileTransform(
      { x: 266.45, y: 20.4 },
      { x: 522.7, y: 20.4 },
      { x: 266.45, y: 276.65 },
      256,
      256,
      1,
    )

    expect(left.e + left.a * 256).toBe(right.e)
    expect(left.f).toBe(right.f)
    expect(left.d).toBe(right.d)
  })

  it('preserves the affine transform for rotated tiles', () => {
    expect(
      canvasTileTransform({ x: 10, y: 20 }, { x: 266, y: 24 }, { x: 6, y: 276 }, 256, 256, 2),
    ).toEqual({ a: 2, b: 0.03125, c: -0.03125, d: 2, e: 20, f: 40 })
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
