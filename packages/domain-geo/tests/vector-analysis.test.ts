import { describe, expect, it } from 'vitest'

import {
  CRS_EPSG_3857,
  CRS_EPSG_4326,
  exportGeoJson,
  measureGeoArea,
  measureGeoDistance,
  parseGeoJson,
  registerCrsDefinition,
} from '../src/index.js'

const square = {
  kind: 'polygon' as const,
  rings: [
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ],
  ],
}

describe('bounded GeoJSON', () => {
  it('imports WGS84 polygons with holes and multipolygons', () => {
    const parsed = parseGeoJson(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'hole',
            properties: { name: 'Donut', score: 4 },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [10, 0],
                  [10, 10],
                  [0, 10],
                  [0, 0],
                ],
                [
                  [2, 2],
                  [2, 4],
                  [4, 4],
                  [4, 2],
                  [2, 2],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [
                  [
                    [20, 20],
                    [21, 20],
                    [21, 21],
                    [20, 21],
                    [20, 20],
                  ],
                ],
                [
                  [
                    [30, 30],
                    [31, 30],
                    [31, 31],
                    [30, 31],
                    [30, 30],
                  ],
                ],
              ],
            },
            properties: null,
          },
        ],
      }),
      { now: () => '2026-08-20T12:00:00.000Z' },
    )
    expect(parsed.issues).toEqual([])
    expect(parsed.coordinateCount).toBe(20)
    expect(parsed.rois[0]).toMatchObject({
      id: 'geojson:hole',
      name: 'Donut',
      crs: CRS_EPSG_4326,
      geometry: { kind: 'polygon', rings: [expect.any(Array), expect.any(Array)] },
      provenance: { kind: 'imported', format: 'RFC7946-GeoJSON' },
    })
    expect(parsed.rois[1]?.geometry.kind).toBe('multi-polygon')
  })

  it('requires confirmation and a definition for legacy CRS', () => {
    const document = JSON.stringify({
      type: 'Feature',
      crs: { type: 'name', properties: { name: 'EPSG:3857' } },
      geometry: { type: 'Point', coordinates: [100, 200] },
      properties: {},
    })
    const refused = parseGeoJson(document)
    expect(refused.requiresConfirmation).toBe(true)
    expect(refused.issues[0]?.code).toBe('LEGACY_CRS_REQUIRES_CONFIRMATION')
    const missing = parseGeoJson(document, { legacyCrs: { confirmed: true } })
    expect(missing.issues[0]?.code).toBe('UNSUPPORTED_CRS')
    const accepted = parseGeoJson(document, {
      legacyCrs: { confirmed: true, definition: CRS_EPSG_3857 },
      now: () => '2026-08-20T12:00:00.000Z',
    })
    expect(accepted.rois[0]).toMatchObject({
      crs: CRS_EPSG_3857,
      provenance: {
        kind: 'imported',
        format: 'legacy-crs-GeoJSON',
        legacyCrs: 'EPSG:3857',
        interpretationConfirmed: true,
      },
    })
  })

  it('enforces feature, coordinate, byte, nesting, property, and pollution limits', () => {
    const feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {},
    }
    expect(
      parseGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [feature, feature] }), {
        limits: { maxFeatures: 1 },
      }).issues[0]?.code,
    ).toBe('LIMIT_EXCEEDED')
    expect(
      parseGeoJson(
        JSON.stringify({
          type: 'MultiPoint',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        }),
        { limits: { maxTotalCoordinates: 1 } },
      ).issues[0]?.code,
    ).toBe('LIMIT_EXCEEDED')
    expect(
      parseGeoJson(JSON.stringify(feature), { limits: { maxDocumentBytes: 5 } }).issues[0]?.code,
    ).toBe('LIMIT_EXCEEDED')
    expect(
      parseGeoJson(
        JSON.stringify({ ...feature, properties: { nested: { nested: { nested: true } } } }),
        { limits: { maxNesting: 2 } },
      ).issues[0]?.code,
    ).toBe('LIMIT_EXCEEDED')
    expect(
      parseGeoJson(JSON.stringify({ ...feature, properties: { value: 'oversized' } }), {
        limits: { maxPropertyBytes: 4 },
      }).issues[0]?.code,
    ).toBe('LIMIT_EXCEEDED')
    expect(
      parseGeoJson(
        '{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]},"properties":{"__proto__":{"polluted":true}}}',
      ).issues[0]?.code,
    ).toBe('FORBIDDEN_KEY')
  })

  it('rejects self-intersections by default and can retain them with an explicit warning', () => {
    const bowtie = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 4],
          [0, 4],
          [4, 0],
          [0, 0],
        ],
      ],
    })
    expect(parseGeoJson(bowtie).issues[0]?.code).toBe('SELF_INTERSECTION')
    const allowed = parseGeoJson(bowtie, { selfIntersection: 'allow-with-warning' })
    expect(allowed.rois).toHaveLength(1)
    expect(allowed.issues[0]).toMatchObject({ code: 'SELF_INTERSECTION', severity: 'warning' })
  })
})

describe('unambiguous measurements', () => {
  it('measures projected metres and subtracts polygon holes', () => {
    const area = measureGeoArea(
      {
        ...square,
        rings: [
          ...square.rings,
          [
            { x: 2, y: 2 },
            { x: 4, y: 2 },
            { x: 4, y: 4 },
            { x: 2, y: 4 },
            { x: 2, y: 2 },
          ],
        ],
      },
      CRS_EPSG_3857,
    )
    expect(area).toMatchObject({
      mode: 'planar',
      method: 'planar-cartesian',
      native: { value: 96, unit: 'metre²' },
    })
    expect(
      measureGeoDistance(
        {
          kind: 'line',
          points: [
            { x: 0, y: 0 },
            { x: 3, y: 4 },
          ],
        },
        CRS_EPSG_3857,
      ).native,
    ).toEqual({ value: 5, unit: 'metre' })
  })

  it('distinguishes international feet from US survey feet', () => {
    const crs = { kind: 'projected' as const, name: 'Local feet' }
    const line = {
      kind: 'line' as const,
      points: [
        { x: 0, y: 0 },
        { x: 1_000, y: 0 },
      ],
    }
    const international = measureGeoDistance(line, crs, { planarUnit: 'international-foot' })
    const survey = measureGeoDistance(line, crs, { planarUnit: 'us-survey-foot' })
    expect(international.converted[0]?.value).toBe(304.8)
    expect(survey.converted[0]?.value).toBeCloseTo(304.800609601, 9)
  })

  it('records explicit WGS84 geodesic line and area methods', () => {
    const distance = measureGeoDistance(
      {
        kind: 'line',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
      CRS_EPSG_4326,
    )
    expect(distance.native.value).toBeCloseTo(111_319.49, 1)
    expect(distance).toMatchObject({
      mode: 'geodesic',
      method: 'vincenty-inverse-wgs84',
      ellipsoid: 'WGS84',
    })
    const area = measureGeoArea(
      {
        kind: 'polygon',
        rings: [
          [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
            { x: 0, y: 0 },
          ],
        ],
      },
      CRS_EPSG_4326,
    )
    expect(area.native.value).toBeGreaterThan(12_000_000_000)
    expect(area.method).toBe('wgs84-authalic-sphere-area')
  })

  it('refuses to apply WGS84 geodesic methods to an unidentified geographic CRS', () => {
    expect(() =>
      measureGeoDistance(
        {
          kind: 'line',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
        { kind: 'geographic', name: 'Unidentified geographic coordinates' },
      ),
    ).toThrow('requires EPSG:4326 geometry')
  })
})

describe('GeoJSON export', () => {
  it('transforms native project geometry to WGS84 and warns for approximate transforms', () => {
    registerCrsDefinition('EPSG:32618', '+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs')
    const parsed = parseGeoJson(
      JSON.stringify({
        type: 'Point',
        crs: { type: 'name', properties: { name: 'EPSG:32618' } },
        coordinates: [583_960, 4_505_256],
      }),
      {
        legacyCrs: {
          confirmed: true,
          definition: { kind: 'projected', authority: 'EPSG', code: 32618 },
        },
        now: () => '2026-08-20T12:00:00.000Z',
      },
    )
    const roi = parsed.rois[0]
    if (roi === undefined) throw new Error('Expected projected ROI')
    const exported = exportGeoJson([roi], {
      transformAccuracy: { kind: 'approximate', note: 'Grid shift unavailable.' },
    })
    expect(exported.compliant).toBe(true)
    expect(exported.format).toBe('RFC7946-GeoJSON')
    expect(exported.warnings).toEqual(['Grid shift unavailable.'])
    expect(exported.document).not.toHaveProperty('crs')
    const coordinates = (
      exported.document['features'] as unknown as { geometry: { coordinates: number[] } }[]
    )[0]?.geometry.coordinates
    expect(coordinates?.[0]).toBeCloseTo(-74, 1)
    expect(coordinates?.[1]).toBeCloseTo(40.69, 1)
  })
})
