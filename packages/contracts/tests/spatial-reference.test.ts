import { describe, expect, it } from 'vitest'
import {
  normalizeSpatialReference,
  type SpatialReference,
  SpatialReferenceError,
  spatialReferenceFacts,
} from '../src/index.js'

const ROTATED_AFFINE = [2, 0.5, 10, -0.25, -3, 20] as const

const rotated: SpatialReference = {
  crs: {
    kind: 'projected',
    authority: 'EPSG',
    code: 32_618,
    name: 'WGS 84 / UTM zone 18N',
  },
  pixelInterpretation: 'pixel-is-area',
  pixelToModel: ROTATED_AFFINE,
  modelToPixel: [0.48, 0.08, -6.4, -0.04, -0.32, 6.8],
  bounds: { minX: 10, minY: 13, maxX: 19, maxY: 20 },
  metadata: {
    'purejsimage:geotiff': {
      citation: 'WGS 84 / UTM zone 18N',
      modelType: 1,
    },
  },
}

describe('spatial reference contract', () => {
  it('round-trips JSON without reducing a six-parameter affine to independent scales', () => {
    const normalized = normalizeSpatialReference(rotated, { componentCount: 1 })
    const wire = JSON.parse(JSON.stringify(normalized)) as SpatialReference
    expect(normalizeSpatialReference(wire, { componentCount: 1 })).toEqual(normalized)
    expect(wire.pixelToModel).toEqual(ROTATED_AFFINE)
    expect(wire.pixelToModel?.[1]).not.toBe(0)
    expect(wire.pixelToModel?.[3]).not.toBe(0)
    expect(() =>
      normalizeSpatialReference({ ...rotated, pixelToModel: [10, -20] }, { componentCount: 1 }),
    ).toThrow(SpatialReferenceError)
  })

  it('keeps unknown CRS identity and extra CRS metadata', () => {
    const normalized = normalizeSpatialReference(
      {
        crs: { kind: 'unknown', wkt: 'LOCAL_CS["unregistered"]' },
        pixelInterpretation: 'pixel-is-area',
        pixelToModel: [1, 0, 0, 0, -1, 0],
      },
      { componentCount: 1 },
    )
    expect(normalized.crs).toEqual({ kind: 'unknown' })
    expect(normalized.metadata?.['purejsimage:crs-extra']).toEqual({
      wkt: 'LOCAL_CS["unregistered"]',
    })
    const facts = spatialReferenceFacts(normalized)
    expect(facts.some(({ label, value }) => label === 'CRS' && value.includes('Unknown'))).toBe(
      true,
    )
    expect(facts.some(({ label }) => label === 'CRS metadata')).toBe(true)
    expect(JSON.stringify(facts)).toContain('LOCAL_CS')
  })

  it('exposes inspector facts from the typed spatial reference, not scale-only labels', () => {
    const facts = spatialReferenceFacts(normalizeSpatialReference(rotated, { componentCount: 1 }))
    expect(facts.find(({ label }) => label === 'Pixel to model')?.value).toBe(
      '[2, 0.5, 10, -0.25, -3, 20]',
    )
    expect(facts.find(({ label }) => label === 'CRS')?.value).toContain('EPSG:32618')
    expect(facts.some(({ value }) => value === '10 /px' || value === '2 × -3')).toBe(false)
  })
})
