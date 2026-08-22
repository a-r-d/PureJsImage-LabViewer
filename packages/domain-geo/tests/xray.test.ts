import type {
  CogInspectionReport,
  DatasetDescriptor,
  OpenedSourceDescriptor,
  SourceId,
  WorkerDiagnostics,
} from '@pji-workbench/contracts'
import { COG_INSPECTION_METADATA_KEY } from '@pji-workbench/contracts'
import { describe, expect, it } from 'vitest'

import {
  buildCogXrayReport,
  CRS_EPSG_3857,
  CRS_EPSG_4326,
  classifyGeoOpenError,
  displayMappingFromStyle,
  formatGeoCursorReadout,
} from '../src/index.js'

const inspection: CogInspectionReport = {
  container: 'TIFF',
  byteOrder: 'little-endian',
  topLevelDirectoryCount: 1,
  likelyCog: false,
  issues: [
    {
      code: 'STRIPED_IMAGE',
      severity: 'warning',
      message: 'Full-resolution IFD uses strips',
    },
  ],
  directories: [
    {
      index: 0,
      path: 'IFD0',
      role: 'image',
      offset: 8,
      width: 4,
      height: 2,
      subIfdOffsets: [128],
      tiled: false,
      tileCount: 0,
      compression: { id: 1, name: 'None', status: 'fully-tested' },
      samplesPerPixel: 1,
      bitsPerSample: [8],
      sampleFormats: [1],
      planar: false,
    },
  ],
}

describe('geo open errors', () => {
  it('distinguishes CORS, missing Range, layout, compression, and malformed metadata', () => {
    expect(
      classifyGeoOpenError({ code: 'CORS_FAILED', message: 'blocked', retryable: true }).kind,
    ).toBe('cors')
    expect(
      classifyGeoOpenError({ code: 'RANGE_UNSUPPORTED', message: '200', retryable: true }).kind,
    ).toBe('range')
    expect(
      classifyGeoOpenError({ code: 'UNSUPPORTED_LAYOUT', message: 'strips', retryable: false })
        .title,
    ).toMatch(/layout/i)
    expect(
      classifyGeoOpenError({
        code: 'UNSUPPORTED_COMPRESSION',
        message: 'jpegxl',
        retryable: false,
      }).kind,
    ).toBe('unsupported-compression')
    expect(
      classifyGeoOpenError({
        code: 'MALFORMED_METADATA',
        message: 'truncated',
        retryable: false,
      }).kind,
    ).toBe('malformed-metadata')
    expect(
      classifyGeoOpenError({
        code: 'SOURCE_OPEN_FAILED',
        message: 'HTTP 403 Request has expired',
        retryable: true,
      }).kind,
    ).toBe('expired-url')
  })
})

describe('COG X-ray and readout', () => {
  it('builds an inspector report from descriptor, inspection, and range diagnostics', () => {
    const source = {
      sourceId: 'source-1' as SourceId,
      documentId: 'document-1',
      generation: 1,
      identity: {},
      source: {
        kind: 'remote' as const,
        name: 'north-up.tif',
        size: 1_000,
        url: 'https://x/n.tif',
      },
      reader: { id: 'purejsimage/tiff', version: '1.0.0', format: 'TIFF' },
      metadata: { [COG_INSPECTION_METADATA_KEY]: inspection },
      datasets: [],
    } as unknown as OpenedSourceDescriptor
    const dataset = {
      id: 'series-0',
      identity: {},
      sampleType: 'uint8',
      axes: [
        { id: 'x', kind: 'spatial', length: 4, coordinates: { type: 'index' } },
        { id: 'y', kind: 'spatial', length: 2, coordinates: { type: 'index' } },
      ],
      components: [{ id: '0', kind: 'intensity' }],
      levels: [
        {
          level: 0,
          axisLengths: [
            { axisId: 'x', length: 4 },
            { axisId: 'y', length: 2 },
          ],
        },
      ],
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'any-axis-pair' },
      },
      spatialReference: {
        crs: CRS_EPSG_4326,
        pixelInterpretation: 'pixel-is-area',
        pixelToModel: [10, 0, 100, 0, -20, 200],
        noData: { kind: 'scalar', value: -9_999 },
      },
    } satisfies DatasetDescriptor
    const diagnostics: WorkerDiagnostics = {
      epoch: 1,
      sources: [
        {
          id: source.sourceId,
          kind: 'remote',
          size: 1_000,
          revision: 1,
          rangeRequests: 4,
          rangeBytesFetched: 120,
          rangeCacheBytes: 64,
          rangeCacheHits: 2,
          rangeCacheMisses: 2,
          openDatasets: 1,
        },
      ],
      aggregate: {
        openSources: 1,
        openDatasets: 1,
        pendingRequests: 0,
        rangeCacheBytes: 64,
        tileRuntimeBytes: 0,
      },
      pendingRequests: 0,
      tileRuntime: null,
      releases: { documents: 0, datasets: 0, tiles: 1, runtimes: 0 },
      limits: {
        maxOpenSources: 8,
        maxDatasetsPerSource: 8,
        maxRangeCacheBytes: 32 * 1_024 * 1_024,
        maxTileRuntimeBytes: 192 * 1_024 * 1_024,
        maxInFlightRequests: 32,
      },
    }
    const report = buildCogXrayReport({
      source,
      dataset,
      diagnostics,
      activeOverview: 0,
    })
    expect(report.container).toBe('TIFF')
    expect(report.byteOrder).toBe('little-endian')
    expect(report.width).toBe(4)
    expect(report.bandCount).toBe(1)
    expect(report.compression?.name).toBe('None')
    expect(report.subIfdCount).toBe(1)
    expect(report.rangeRequests).toBe(4)
    expect(report.percentFetched).toBe(12)
    expect(report.activeOverview).toBe(0)
    expect(report.issues[0]?.code).toBe('STRIPED_IMAGE')
  })

  it('reports unique object coverage, not transferred bytes, as percent fetched', () => {
    const source = {
      sourceId: 'source-1' as SourceId,
      documentId: 'document-1',
      generation: 1,
      identity: {},
      source: {
        kind: 'remote' as const,
        name: 'north-up.tif',
        size: 1_000,
        url: 'https://x/n.tif',
      },
      reader: { id: 'purejsimage/tiff', version: '1.0.0', format: 'TIFF' },
      metadata: {},
      datasets: [],
    } as unknown as OpenedSourceDescriptor
    const dataset = {
      id: 'series-0',
      identity: {},
      sampleType: 'uint8',
      axes: [
        { id: 'x', kind: 'spatial', length: 4, coordinates: { type: 'index' } },
        { id: 'y', kind: 'spatial', length: 2, coordinates: { type: 'index' } },
      ],
      components: [{ id: '0', kind: 'intensity' }],
      levels: [],
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'any-axis-pair' },
      },
    } satisfies DatasetDescriptor
    const diagnostics: WorkerDiagnostics = {
      epoch: 1,
      sources: [
        {
          id: source.sourceId,
          kind: 'remote',
          size: 1_000,
          revision: 1,
          rangeRequests: 604,
          rangeBytesFetched: 2_292,
          rangeCacheBytes: 80,
          rangeCacheHits: 40,
          rangeCacheMisses: 564,
          uniqueBytes: 80,
          openDatasets: 1,
        },
      ],
      aggregate: {
        openSources: 1,
        openDatasets: 1,
        pendingRequests: 0,
        rangeCacheBytes: 80,
        tileRuntimeBytes: 0,
      },
      pendingRequests: 0,
      tileRuntime: null,
      releases: { documents: 0, datasets: 0, tiles: 0, runtimes: 0 },
      limits: {
        maxOpenSources: 8,
        maxDatasetsPerSource: 8,
        maxRangeCacheBytes: 32 * 1_024 * 1_024,
        maxTileRuntimeBytes: 192 * 1_024 * 1_024,
        maxInFlightRequests: 32,
      },
    }
    const report = buildCogXrayReport({
      source,
      dataset,
      diagnostics,
      activeOverview: 0,
    })
    expect(report.bytesFetched).toBe(2_292)
    expect(report.percentFetched).toBe(8)
  })

  it('does not treat the GeoZarr root metadata size as the complete store size', () => {
    const source = {
      sourceId: 'source-zarr' as SourceId,
      documentId: 'document-zarr',
      generation: 1,
      identity: {},
      source: {
        kind: 'geo-zarr-remote' as const,
        name: 'fixture.zarr',
        size: 843,
        url: 'https://x/fixture.zarr/',
      },
      reader: { id: 'purejsimage/geo/geozarr', version: '1.0.0', format: 'GeoZarr' },
      metadata: {},
      datasets: [],
    } as unknown as OpenedSourceDescriptor
    const dataset = {
      id: 'array-0',
      identity: {},
      sampleType: 'uint16',
      axes: [
        { id: 'x', kind: 'spatial', length: 4, coordinates: { type: 'index' } },
        { id: 'y', kind: 'spatial', length: 4, coordinates: { type: 'index' } },
      ],
      components: [{ id: '0', kind: 'intensity' }],
      levels: [],
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'any-axis-pair' },
      },
    } satisfies DatasetDescriptor
    const diagnostics = {
      epoch: 1,
      sources: [
        {
          id: source.sourceId,
          kind: 'geo-zarr-remote' as const,
          size: 843,
          revision: 1,
          rangeRequests: 15,
          rangeBytesFetched: 879,
          rangeCacheBytes: 512,
          rangeCacheHits: 11,
          rangeCacheMisses: 4,
          openDatasets: 1,
        },
      ],
      aggregate: {
        openSources: 1,
        openDatasets: 1,
        pendingRequests: 0,
        rangeCacheBytes: 512,
        tileRuntimeBytes: 0,
      },
      pendingRequests: 0,
      tileRuntime: null,
      releases: { documents: 0, datasets: 0, tiles: 0, runtimes: 0 },
      limits: {
        maxOpenSources: 8,
        maxDatasetsPerSource: 8,
        maxRangeCacheBytes: 32 * 1_024 * 1_024,
        maxTileRuntimeBytes: 192 * 1_024 * 1_024,
        maxInFlightRequests: 32,
      },
    } satisfies WorkerDiagnostics

    expect(buildCogXrayReport({ source, dataset, diagnostics, activeOverview: 0 })).toMatchObject({
      rangeRequests: 15,
      bytesFetched: 879,
      percentFetched: undefined,
    })
  })

  it('includes WGS84 when the source CRS can be transformed', () => {
    const geographic = formatGeoCursorReadout({
      pixel: { x: 1.5, y: 0.5 },
      world: { x: 115, y: 180 },
      crs: CRS_EPSG_4326,
      bands: [{ name: 'B0', value: 7 }],
    })
    expect(geographic).toContain('px 1.50, 0.50')
    expect(geographic).toContain('WGS84')
    expect(geographic).toContain('B0=7.0000')
    const projected = formatGeoCursorReadout({
      pixel: { x: 0, y: 0 },
      world: { x: 0, y: 0 },
      crs: CRS_EPSG_3857,
      bands: [],
    })
    expect(projected).toContain('WGS84')
  })

  it('maps raster style onto the Worker display contract', () => {
    expect(
      displayMappingFromStyle(
        {
          mapping: { red: 2, green: 1, blue: 0 },
          stretch: 'percentile',
          percentileLow: 2,
          percentileHigh: 98,
          gamma: 1.2,
          nodataTransparent: true,
          resample: 'nearest',
        },
        -9999,
      ),
    ).toMatchObject({
      mode: 'linear',
      range: 'auto',
      stretch: 'percentile',
      gamma: 1.2,
      nodata: -9999,
      nodataTransparent: true,
      bands: { red: 2, green: 1, blue: 0 },
    })
  })
})
