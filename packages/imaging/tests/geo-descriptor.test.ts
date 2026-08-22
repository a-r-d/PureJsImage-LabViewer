import type { GeoRasterDescriptor } from 'purejsimage/geo'
import { describe, expect, it } from 'vitest'

import { geoRasterDescriptor } from '../src/descriptor.js'

describe('Geo descriptor RPC projection', () => {
  it('preserves rich CRS, exact integer nodata, bands, axes, levels, and storage metadata', () => {
    const grid = {
      schemaVersion: 1,
      width: 2,
      height: 1,
      spatialDimensions: {
        x: { id: 'x', name: 'Easting', dimensionIndex: 3 },
        y: { id: 'y', name: 'Northing', dimensionIndex: 2 },
      },
      pixelToWorld: [30, 0, 500_000, 0, -30, 4_500_000],
      worldToPixel: [1 / 30, 0, -500_000 / 30, 0, -1 / 30, 4_500_000 / 30],
      worldBounds: { minX: 500_000, minY: 4_499_970, maxX: 500_060, maxY: 4_500_000 },
      wrappedBounds: {
        west: 170,
        south: -10,
        east: -170,
        north: 10,
        crossesAntimeridian: true,
      },
      pixelRegistration: 'pixel-is-point',
      noData: { kind: 'scalar', value: '18446744073709551615' },
      warnings: [
        {
          severity: 'warning',
          code: 'source-bounds-differ',
          message: 'Fixture warning',
          path: 'grid',
        },
      ],
    } as const
    const descriptor = {
      schemaVersion: 1,
      id: 'rich-geo',
      title: 'Rich Geo fixture',
      shape: [2, 3, 1, 2],
      dimensions: [
        { id: 'time', name: 'Time', index: 0, length: 2, kind: 'non-spatial' },
        { id: 'band', name: 'Band', index: 1, length: 3, kind: 'non-spatial' },
        { id: 'y', name: 'Northing', index: 2, length: 1, kind: 'spatial-y' },
        { id: 'x', name: 'Easting', index: 3, length: 2, kind: 'spatial-x' },
      ],
      spatialDimensions: grid.spatialDimensions,
      axes: [
        {
          id: 'time',
          name: 'Acquisition time',
          kind: 'time',
          dimensionIndex: 0,
          length: 2,
          unit: 'day',
          coordinates: { kind: 'values', values: ['2026-01-01', '2026-01-02'] },
        },
        {
          id: 'band',
          kind: 'band',
          dimensionIndex: 1,
          length: 3,
          coordinates: { kind: 'lazy', valueType: 'string' },
          metadata: { role: 'spectral' },
        },
      ],
      sampleType: 'uint64',
      bands: [
        {
          sourceComponentIndex: 0,
          name: 'Near infrared',
          commonName: 'nir',
          description: 'Fixture band',
          colorInterpretation: 'nir',
          wavelength: { center: 860, min: 840, max: 880, unit: 'nm' },
          unit: 'reflectance',
          scale: 0.0001,
          offset: -1,
          noData: '18446744073709551615',
          validRange: ['0', '18446744073709551614'],
          dataType: 'uint64',
          categorical: true,
          categories: [{ value: '18446744073709551615', label: 'No data', color: '#000000' }],
        },
      ],
      levels: [
        {
          id: 'base',
          arrayPath: 'data/0',
          sourcePath: 'fixture.zarr',
          sourceResolutionLevel: 0,
          sourceOrder: 0,
          width: 2,
          height: 1,
          geometry: grid,
          nominalResolution: { x: 30, y: 30, unit: 'metre' },
          downsample: { x: 1, y: 1 },
          storage: {
            organization: 'chunked',
            chunkShape: [1, 1, 1, 2],
            compression: 'zstd',
            byteOrder: 'little-endian',
            metadata: { shardShape: [1, 1, 4, 4] },
          },
        },
      ],
      primaryLevelId: 'base',
      spatialReference: {
        schemaVersion: 1,
        coordinateSystemType: 'compound',
        authority: 'EPSG',
        code: 9999,
        name: 'Fixture compound CRS',
        wkt2: 'COMPOUNDCRS["Fixture"]',
        projJson: { type: 'CompoundCRS', name: 'Fixture compound CRS' },
        horizontalUnit: { name: 'metre', symbol: 'm', conversionToSI: 1 },
        vertical: {
          authority: 'EPSG',
          code: 5703,
          name: 'NAVD88 height',
          wkt2: 'VERTCRS["NAVD88 height"]',
          unit: { name: 'metre', symbol: 'm', conversionToSI: 1 },
        },
        coordinateEpoch: 2020,
        formalAxes: [
          { name: 'Easting', abbreviation: 'E', direction: 'east', order: 0 },
          { name: 'Northing', abbreviation: 'N', direction: 'north', order: 1 },
        ],
        applicationAxes: {
          x: { name: 'X', formalAxisIndex: 0 },
          y: { name: 'Y', formalAxisIndex: 1 },
        },
        evidence: [
          { kind: 'embedded', sourceId: 'fixture', locator: 'metadata/crs', citation: 'fixture' },
        ],
        state: 'complete',
        confidence: 1,
        diagnostics: [],
      },
      grid,
      capabilities: {
        pixelRegionReads: true,
        worldRegionReads: true,
        resolutionLevels: true,
        axisCoordinateReads: true,
        bandSelection: true,
      },
      sourceFormat: { id: 'geozarr', name: 'GeoZarr', version: '3' },
      formatEvidence: { convention: 'fixture' },
      diagnostics: [],
    } as unknown as GeoRasterDescriptor

    const projected = JSON.parse(JSON.stringify(geoRasterDescriptor(descriptor)))
    expect(projected).toMatchObject({
      schemaVersion: 1,
      sampleType: 'uint64',
      spatialReference: {
        wkt2: 'COMPOUNDCRS["Fixture"]',
        projJson: { type: 'CompoundCRS' },
        coordinateEpoch: 2020,
        vertical: { code: 5703, unit: { symbol: 'm' } },
      },
      grid: {
        worldToPixel: grid.worldToPixel,
        wrappedBounds: { crossesAntimeridian: true },
        noData: { kind: 'scalar', value: '18446744073709551615' },
      },
      bands: [
        {
          name: 'Near infrared',
          noData: '18446744073709551615',
          validRange: ['0', '18446744073709551614'],
          categories: [{ value: '18446744073709551615', label: 'No data' }],
        },
      ],
      axes: [
        { id: 'time', kind: 'time' },
        { id: 'band', kind: 'band' },
      ],
      levels: [{ storage: { chunkShape: [1, 1, 1, 2], metadata: { shardShape: [1, 1, 4, 4] } } }],
    })
  })
})
