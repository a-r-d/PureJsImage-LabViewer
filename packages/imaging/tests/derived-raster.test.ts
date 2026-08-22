import type {
  DerivedRasterRecipeV1,
  DerivedRasterRuntimeInputV1,
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  RasterTargetGridV1,
  WorkerResponse,
} from '@pji-workbench/contracts'
import { rpcRequest } from '@pji-workbench/contracts'
import { encodeGsf } from 'purejsimage/scientific/readers/gsf'
import { describe, expect, it } from 'vitest'

import { ImagingWorkerHost } from '../src/index.js'
import { fourBandGeoTiffFixture, geoKeyEntries, geoTiffFixture } from './geotiff-fixture.js'

function payload<Kind extends Extract<WorkerResponse, { ok: true }>['kind']>(
  response: WorkerResponse,
  kind: Kind,
): Extract<WorkerResponse, { kind: Kind }>['payload'] {
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
  expect(response.kind).toBe(kind)
  return response.payload as Extract<WorkerResponse, { kind: Kind }>['payload']
}

async function openGrid(
  host: ImagingWorkerHost,
  name: string,
  width: number,
  height: number,
  values: Float32Array,
  generation: number,
): Promise<Readonly<{ source: OpenedSourceDescriptor; dataset: OpenedDatasetDescriptor }>> {
  const bytes = encodeGsf({ width, height, values })
  const file = new File([bytes.slice().buffer as ArrayBuffer], name)
  const source = payload(
    (
      await host.handle(
        rpcRequest(`source-${name}`, 'source.open-local', {
          generation,
          primaryId: 'file-0',
          files: [
            {
              id: 'file-0',
              name,
              size: file.size,
              type: file.type,
              lastModified: file.lastModified,
              blob: file,
            },
          ],
        }),
      )
    ).response,
    'source.opened',
  ) as OpenedSourceDescriptor
  const summary = source.datasets[0]
  if (summary === undefined) throw new Error('Fixture has no dataset')
  const dataset = payload(
    (
      await host.handle(
        rpcRequest(`dataset-${name}`, 'dataset.open', {
          documentId: source.documentId,
          datasetId: summary.id,
          generation,
          sourceId: source.sourceId,
        }),
      )
    ).response,
    'dataset.opened',
  ) as OpenedDatasetDescriptor
  return { source, dataset }
}

async function openGeoGrid(
  host: ImagingWorkerHost,
  name: string,
  width: number,
  height: number,
  values: readonly number[],
): Promise<Readonly<{ source: OpenedSourceDescriptor; dataset: OpenedDatasetDescriptor }>> {
  return openFile(
    host,
    name,
    geoTiffFixture({
      width,
      height,
      pixels: Uint8Array.from(values),
      extraEntries: [
        { tag: 33_550, type: 12, values: [1, 1, 0] },
        { tag: 33_922, type: 12, values: [0, 0, 0, 0, height, 0] },
        ...geoKeyEntries(1, { kind: 'geographic', code: 4_326, name: 'WGS 84' }),
      ],
    }),
  )
}

async function openFile(
  host: ImagingWorkerHost,
  name: string,
  bytes: Uint8Array,
  generation = 1,
): Promise<Readonly<{ source: OpenedSourceDescriptor; dataset: OpenedDatasetDescriptor }>> {
  const file = new File([bytes.slice().buffer as ArrayBuffer], name)
  const source = payload(
    (
      await host.handle(
        rpcRequest(`source-${name}`, 'source.open-local', {
          generation,
          primaryId: 'file-0',
          files: [
            {
              id: 'file-0',
              name,
              size: file.size,
              type: file.type,
              lastModified: file.lastModified,
              blob: file,
            },
          ],
        }),
      )
    ).response,
    'source.opened',
  ) as OpenedSourceDescriptor
  const summary = source.datasets[0]
  if (summary === undefined) throw new Error('Fixture has no dataset')
  const dataset = payload(
    (
      await host.handle(
        rpcRequest(`dataset-${name}`, 'dataset.open', {
          documentId: source.documentId,
          datasetId: summary.id,
          generation,
          sourceId: source.sourceId,
        }),
      )
    ).response,
    'dataset.opened',
  ) as OpenedDatasetDescriptor
  return { source, dataset }
}

function paddedRemote(bytes: Uint8Array, size = 2 * 1_024 * 1_024): Uint8Array {
  const padded = new Uint8Array(Math.max(size, bytes.byteLength))
  padded.set(bytes)
  return padded
}

function rangeFetch(bytes: Uint8Array): typeof fetch {
  return async (_input, init) => {
    const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
    if (match === undefined || match === null) return new Response(null, { status: 416 })
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: {
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
        etag: '"derived-cog-v1"',
      },
    })
  }
}

async function openRemoteFile(
  host: ImagingWorkerHost,
  url: string,
): Promise<Readonly<{ source: OpenedSourceDescriptor; dataset: OpenedDatasetDescriptor }>> {
  const source = payload(
    (await host.handle(rpcRequest('remote-source', 'source.open-remote', { generation: 1, url })))
      .response,
    'source.opened',
  ) as OpenedSourceDescriptor
  const summary = source.datasets[0]
  if (summary === undefined) throw new Error('Remote fixture has no dataset')
  const dataset = payload(
    (
      await host.handle(
        rpcRequest('remote-dataset', 'dataset.open', {
          documentId: source.documentId,
          datasetId: summary.id,
          generation: source.generation,
          sourceId: source.sourceId,
        }),
      )
    ).response,
    'dataset.opened',
  ) as OpenedDatasetDescriptor
  return { source, dataset }
}

function grid(width: number, height: number, crs = 'EPSG:32618'): RasterTargetGridV1 {
  return {
    schemaVersion: 1,
    crs,
    width,
    height,
    affine: [1, 0, 0, 0, -1, height],
    pixelInterpretation: 'area',
    extent: [0, 0, width, height],
    sampleType: 'float32',
    noData: { kind: 'nan' },
    resampling: 'nearest',
  }
}

function runtimeInput(
  layerId: string,
  opened: Readonly<{ source: OpenedSourceDescriptor; dataset: OpenedDatasetDescriptor }>,
  rasterGrid: RasterTargetGridV1,
): DerivedRasterRuntimeInputV1 {
  return {
    layerId,
    datasetHandleId: opened.dataset.handleId,
    generation: opened.dataset.generation,
    sourceIdentity: JSON.stringify(opened.source.identity),
    sourceRevision: `fixture:${opened.source.source.name}`,
    grid: rasterGrid,
  }
}

function recipe(
  rasterGrid: RasterTargetGridV1,
  inputs: DerivedRasterRecipeV1['inputs'],
  operation: DerivedRasterRecipeV1['operation'],
  alignment: DerivedRasterRecipeV1['alignment'] = 'exact',
): DerivedRasterRecipeV1 {
  return {
    schemaVersion: 1,
    operationVersion: 1,
    operation,
    inputs,
    targetGrid: rasterGrid,
    alignment,
    outputNoData: { kind: 'nan' },
    minimumValidWeight: 0.5,
    limits: {
      maxTilePixels: 65_536,
      maxOutputBytes: 4 * 1_024 * 1_024,
      maxWorkingBytes: 16 * 1_024 * 1_024,
    },
  }
}

const rawInput = (name: string, layerId: string) => ({
  name,
  layerId,
  component: 0,
  valueMode: 'raw' as const,
  scale: 1,
  offset: 0,
  noData: { kind: 'nan' as const },
})

describe('derived geo raster RPC', () => {
  it('keeps Geo analysis disabled in the default Science Worker profile', async () => {
    const host = new ImagingWorkerHost()
    const target = grid(1, 1)
    const input = rawInput('source', 'source')
    const result = await host.handle(
      rpcRequest('science-derived', 'geo.analysis.dry_run', {
        layerId: 'derived',
        recipe: recipe(target, [input], {
          kind: 'linear-combination',
          terms: [{ input: 'source', coefficient: 1 }],
          constant: 0,
        }),
        inputs: [
          {
            layerId: 'source',
            datasetHandleId: 'missing' as never,
            generation: 1,
            sourceIdentity: 'fixture',
            sourceRevision: '1',
            grid: target,
          },
        ],
      }),
    )
    expect(result.response).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Geo analysis requires the Geo Worker profile' },
    })
    await host.dispose()
  })

  it('fails explicitly instead of rounding declared 64-bit integer sources', async () => {
    const host = new ImagingWorkerHost({ profile: 'geo' })
    const opened = await openGrid(
      host,
      'integer64-source.gsf',
      2,
      2,
      Float32Array.of(1, 2, 3, 4),
      1,
    )
    const target = grid(2, 2)
    const input = rawInput('source', 'source')
    const result = await host.handle(
      rpcRequest('integer64-dry-run', 'geo.analysis.dry_run', {
        layerId: 'integer64-layer',
        recipe: recipe(target, [input], {
          kind: 'linear-combination',
          terms: [{ input: 'source', coefficient: 1 }],
          constant: 0,
        }),
        inputs: [
          {
            ...runtimeInput('source', opened, target),
            grid: { ...target, sampleType: 'int64' },
          },
        ],
      }),
    )
    expect(result.response).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_PAYLOAD',
        message: expect.stringContaining('do not support exact int64 sources'),
      },
    })
    await host.dispose()
  })

  it('masks polygon holes across tile boundaries and excludes nodata', async () => {
    const host = new ImagingWorkerHost({ profile: 'geo' })
    const width = 300
    const height = 2
    const values = Float32Array.from({ length: width * height }, (_, index) => index)
    values[250] = Number.NaN
    const opened = await openGrid(host, 'zonal.gsf', width, height, values, 1)
    const target = grid(width, height)
    const input = rawInput('source', 'source')
    const result = payload(
      (
        await host.handle(
          rpcRequest('zonal-mask', 'geo.analysis.region_statistics', {
            layerId: 'zonal-mask',
            recipe: recipe(target, [input], {
              kind: 'linear-combination',
              terms: [{ input: 'source', coefficient: 1 }],
              constant: 0,
            }),
            inputs: [runtimeInput('source', opened, target)],
            region: { x: 240, y: 0, width: 60, height: 2 },
            component: 0,
            mask: {
              pixelInterpretation: 'pixel-is-area',
              polygons: [
                [
                  [
                    { x: 250, y: 0 },
                    { x: 270, y: 0 },
                    { x: 270, y: 2 },
                    { x: 250, y: 2 },
                    { x: 250, y: 0 },
                  ],
                  [
                    { x: 255, y: 0 },
                    { x: 265, y: 0 },
                    { x: 265, y: 2 },
                    { x: 255, y: 2 },
                    { x: 255, y: 0 },
                  ],
                ],
              ],
            },
          }),
        )
      ).response,
      'geo.analysis.region_statistics',
    )
    expect(result).toMatchObject({
      count: 19,
      invalidCount: 1,
      excludedByMask: 100,
      visitedTiles: 2,
    })
    await host.dispose()
  })

  it('derives a normalized difference from two bands of one four-band raster', async () => {
    const host = new ImagingWorkerHost({ profile: 'geo' })
    const opened = await openFile(host, 'four-band.tif', fourBandGeoTiffFixture())
    const target = {
      ...grid(2, 1, 'EPSG:4326'),
      affine: [1, 0, 0, 0, 1, 0] as const,
      extent: [0, 0, 2, 1] as const,
    }
    const left = { ...rawInput('nir', 'four-band'), component: 3 }
    const right = { ...rawInput('red', 'four-band'), component: 2 }
    const runtime = runtimeInput('four-band', opened, target)
    const request = {
      layerId: 'four-band-nd',
      recipe: recipe(target, [left, right], {
        kind: 'normalized-difference' as const,
        left: 'nir',
        right: 'red',
      }),
      inputs: [runtime, runtime],
      region: { x: 0, y: 0, width: 2, height: 1 },
      component: 0,
    }
    const statistics = payload(
      (await host.handle(rpcRequest('four-band-nd', 'geo.analysis.region_statistics', request)))
        .response,
      'geo.analysis.region_statistics',
    )
    expect(statistics.count).toBe(2)
    expect(statistics.mean).toBeCloseTo((10 / 70 + 10 / 150) / 2, 6)

    const firstKey = payload(
      (await host.handle(rpcRequest('four-band-plan', 'geo.analysis.dry_run', request))).response,
      'geo.analysis.dry_run',
    ).cacheKey
    const changedKey = payload(
      (
        await host.handle(
          rpcRequest('four-band-plan-changed', 'geo.analysis.dry_run', {
            ...request,
            inputs: request.inputs.map((input) => ({
              ...input,
              sourceRevision: 'fixture:changed-validator',
            })),
          }),
        )
      ).response,
      'geo.analysis.dry_run',
    ).cacheKey
    expect(changedKey).not.toBe(firstKey)
    const changedPolicyKey = payload(
      (
        await host.handle(
          rpcRequest('four-band-plan-policy', 'geo.analysis.dry_run', {
            ...request,
            recipe: { ...request.recipe, minimumValidWeight: 0.75 },
          }),
        )
      ).response,
      'geo.analysis.dry_run',
    ).cacheKey
    expect(changedPolicyKey).not.toBe(firstKey)
    await host.dispose()
  })

  it('does not fetch a complete remote GeoTIFF to evaluate a derived region', async () => {
    const bytes = paddedRemote(fourBandGeoTiffFixture())
    const host = new ImagingWorkerHost({ profile: 'geo', fetch: rangeFetch(bytes) })
    const opened = await openRemoteFile(host, 'https://fixtures.invalid/four-band.tif')
    const target = {
      ...grid(2, 1, 'EPSG:4326'),
      affine: [1, 0, 0, 0, 1, 0] as const,
      extent: [0, 0, 2, 1] as const,
    }
    const runtime = runtimeInput('remote-four-band', opened, target)
    const statistics = payload(
      (
        await host.handle(
          rpcRequest('remote-derived', 'geo.analysis.region_statistics', {
            layerId: 'remote-derived',
            recipe: recipe(
              target,
              [
                { ...rawInput('nir', 'remote-four-band'), component: 3 },
                { ...rawInput('red', 'remote-four-band'), component: 2 },
              ],
              { kind: 'normalized-difference', left: 'nir', right: 'red' },
            ),
            inputs: [runtime, runtime],
            region: { x: 0, y: 0, width: 2, height: 1 },
            component: 0,
          }),
        )
      ).response,
      'geo.analysis.region_statistics',
    )
    expect(statistics.count).toBe(2)
    const diagnostics = host.diagnostics(opened.source.sourceId)
    expect(diagnostics.sources[0]?.rangeBytesFetched).toBeLessThan(bytes.byteLength)
    await host.dispose()
  })

  it('evaluates a normalized difference on demand and reports a stable identity', async () => {
    const host = new ImagingWorkerHost({ profile: 'geo' })
    const left = await openGrid(host, 'left.gsf', 2, 2, Float32Array.of(3, 6, 9, 12), 1)
    const right = await openGrid(host, 'right.gsf', 2, 2, Float32Array.of(1, 2, 3, 4), 2)
    const target = grid(2, 2)
    const request = {
      layerId: 'derived-nd',
      recipe: recipe(target, [rawInput('left', 'left'), rawInput('right', 'right')], {
        kind: 'normalized-difference' as const,
        left: 'left',
        right: 'right',
      }),
      inputs: [runtimeInput('left', left, target), runtimeInput('right', right, target)],
    }

    const dryRun = payload(
      (await host.handle(rpcRequest('dry-run', 'geo.analysis.dry_run', request))).response,
      'geo.analysis.dry_run',
    )
    expect(dryRun).toMatchObject({ valid: true, estimatedTiles: 1 })
    expect(dryRun.sources).toHaveLength(2)

    const statistics = payload(
      (
        await host.handle(
          rpcRequest('statistics', 'geo.analysis.region_statistics', {
            ...request,
            region: { x: 0, y: 0, width: 2, height: 2 },
            component: 0,
          }),
        )
      ).response,
      'geo.analysis.region_statistics',
    )
    expect(statistics.cacheKey).toBe(dryRun.cacheKey)
    expect(statistics).toMatchObject({ count: 4, invalidCount: 0, minimum: 0.5, maximum: 0.5 })
    expect(statistics.mean).toBeCloseTo(0.5, 7)

    const difference = payload(
      (
        await host.handle(
          rpcRequest('difference', 'geo.analysis.region_statistics', {
            ...request,
            recipe: recipe(target, [rawInput('left', 'left'), rawInput('right', 'right')], {
              kind: 'raster-difference',
              minuend: 'left',
              subtrahend: 'right',
            }),
            region: { x: 0, y: 0, width: 2, height: 2 },
            component: 0,
          }),
        )
      ).response,
      'geo.analysis.region_statistics',
    )
    expect(difference.mean).toBe(5)
    await host.dispose()
  })

  it('refuses mismatched grids unless resampling and cross-CRS transforms are explicit', async () => {
    const host = new ImagingWorkerHost({ profile: 'geo' })
    const opened = await openGrid(host, 'mismatch.gsf', 2, 2, Float32Array.of(1, 2, 3, 4), 1)
    const sourceGrid = grid(2, 2, 'EPSG:4326')
    const target = grid(4, 4, 'EPSG:3857')
    const base = {
      layerId: 'derived-refusal',
      inputs: [runtimeInput('source', opened, sourceGrid)],
    }
    const exact = await host.handle(
      rpcRequest('exact-refusal', 'geo.analysis.dry_run', {
        ...base,
        recipe: recipe(target, [rawInput('source', 'source')], {
          kind: 'band-math',
          expression: 'source',
          divideByZero: 'nodata',
          nonFinite: 'nodata',
        }),
      }),
    )
    expect(exact.response).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })

    const resample = await host.handle(
      rpcRequest('transform-refusal', 'geo.analysis.dry_run', {
        ...base,
        recipe: recipe(
          target,
          [rawInput('source', 'source')],
          {
            kind: 'band-math',
            expression: 'source',
            divideByZero: 'nodata',
            nonFinite: 'nodata',
          },
          'resample',
        ),
      }),
    )
    expect(resample.response).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    await host.dispose()
  })

  it('preserves explicit virtual-stack band order', async () => {
    const host = new ImagingWorkerHost({ profile: 'geo' })
    const first = await openGrid(host, 'first.gsf', 2, 1, Float32Array.of(10, 20), 1)
    const second = await openGrid(host, 'second.gsf', 2, 1, Float32Array.of(30, 40), 2)
    const target = grid(2, 1)
    const scaledSecond = {
      ...rawInput('second', 'second'),
      valueMode: 'scaled' as const,
      scale: 2,
      offset: 5,
    }
    const request = {
      layerId: 'stack',
      recipe: recipe(target, [rawInput('first', 'first'), scaledSecond], {
        kind: 'virtual-band-stack' as const,
        bands: ['second', 'first'],
      }),
      inputs: [runtimeInput('first', first, target), runtimeInput('second', second, target)],
      region: { x: 0, y: 0, width: 2, height: 1 },
      component: 0,
    }
    const firstBand = payload(
      (await host.handle(rpcRequest('stack-first', 'geo.analysis.region_statistics', request)))
        .response,
      'geo.analysis.region_statistics',
    )
    const secondBand = payload(
      (
        await host.handle(
          rpcRequest('stack-second', 'geo.analysis.region_statistics', {
            ...request,
            component: 1,
          }),
        )
      ).response,
      'geo.analysis.region_statistics',
    )
    expect(firstBand.mean).toBe(75)
    expect(secondBand.mean).toBe(15)
    await host.dispose()
  })

  it('resamples only with an explicit policy and declared cross-CRS transform', async () => {
    const descriptor = {
      id: 'fixture.identity-inverse',
      version: '1',
      accuracy: { kind: 'exact' as const },
    }
    const host = new ImagingWorkerHost({
      profile: 'geo',
      rasterTransforms: {
        implementationIdentity: 'fixture-transform@1',
        supports: (candidate) => candidate.id === descriptor.id,
        transform: (_candidate, _sourceCrs, _targetCrs, coordinate) => coordinate,
      },
    })
    const opened = await openGeoGrid(host, 'resample.tif', 2, 2, [1, 2, 3, 4])
    const sourceGrid = grid(2, 2, 'EPSG:4326')
    const sameCrsTarget = {
      ...grid(4, 4, 'EPSG:4326'),
      affine: [0.5, 0, 0, 0, -0.5, 2] as const,
      extent: [0, 0, 2, 2] as const,
      resampling: 'bilinear' as const,
    }
    const sameCrsRequest = {
      layerId: 'same-crs-resampled',
      recipe: recipe(
        sameCrsTarget,
        [rawInput('source', 'source')],
        {
          kind: 'band-math' as const,
          expression: 'source',
          divideByZero: 'nodata' as const,
          nonFinite: 'nodata' as const,
        },
        'resample',
      ),
      inputs: [runtimeInput('source', opened, sourceGrid)],
      region: { x: 0, y: 0, width: 4, height: 4 },
      component: 0,
    }
    const sameCrs = payload(
      (
        await host.handle(
          rpcRequest('same-crs-statistics', 'geo.analysis.region_statistics', sameCrsRequest),
        )
      ).response,
      'geo.analysis.region_statistics',
    )
    expect(sameCrs.count).toBeGreaterThan(0)
    expect(sameCrs.mean).toBeCloseTo(2.5, 1)
    const sourceLimited = await host.handle(
      rpcRequest('same-crs-source-limit', 'geo.analysis.region_statistics', {
        ...sameCrsRequest,
        recipe: {
          ...sameCrsRequest.recipe,
          limits: { ...sameCrsRequest.recipe.limits, maxSourcePixels: 1 },
        },
      }),
    )
    expect(sourceLimited.response).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_EXCEEDED' },
    })

    const target = {
      ...grid(4, 4, 'EPSG:3857'),
      affine: [0.5, 0, 0, 0, -0.5, 2] as const,
      extent: [0, 0, 2, 2] as const,
      resampling: 'bilinear' as const,
    }
    const input = { ...rawInput('source', 'source'), transform: descriptor }
    const request = {
      layerId: 'resampled',
      recipe: recipe(
        target,
        [input],
        {
          kind: 'band-math',
          expression: 'source',
          divideByZero: 'nodata',
          nonFinite: 'nodata',
        },
        'resample',
      ),
      inputs: [runtimeInput('source', opened, sourceGrid)],
    }
    const dryRun = payload(
      (await host.handle(rpcRequest('transform-plan', 'geo.analysis.dry_run', request))).response,
      'geo.analysis.dry_run',
    )
    expect(dryRun.transformRequirements).toEqual([
      {
        layerId: 'source',
        sourceCrs: 'EPSG:4326',
        targetCrs: 'EPSG:3857',
        descriptor,
      },
    ])
    expect(dryRun.execution).toMatchObject({
      engine: 'purejsimage/geo',
      packageVersion: '0.16.0',
      cacheSchemaVersion: 2,
      inputs: [
        {
          relationship: 'different-crs',
          transform: {
            descriptorId: descriptor.id,
            descriptorVersion: descriptor.version,
            transformIdentity: 'proj4-compatible:EPSG:4326->EPSG:3857',
            implementationIdentity: 'fixture-transform@1',
          },
        },
      ],
    })
    const statistics = payload(
      (
        await host.handle(
          rpcRequest('transform-statistics', 'geo.analysis.region_statistics', {
            ...request,
            region: { x: 0, y: 0, width: 4, height: 4 },
            component: 0,
          }),
        )
      ).response,
      'geo.analysis.region_statistics',
    )
    expect(statistics.count).toBeGreaterThan(0)
    expect(statistics.mean).toBeCloseTo(2.5, 1)
    await host.dispose()
  })

  it('bounds nonlinear inverse reprojection across the requested tile interior', async () => {
    const descriptor = {
      id: 'fixture.interior-bulge-inverse',
      version: '1',
      accuracy: { kind: 'exact' as const },
    }
    const host = new ImagingWorkerHost({
      profile: 'geo',
      rasterTransforms: {
        implementationIdentity: 'fixture-nonlinear@1',
        supports: (candidate) => candidate.id === descriptor.id,
        transform(_candidate, sourceCrs, targetCrs, coordinate) {
          const bulge = 6 * Math.sin((Math.PI * (coordinate[1] - 0.5)) / 3)
          if (sourceCrs === 'EPSG:3857' && targetCrs === 'EPSG:4326')
            return [coordinate[0] + bulge, coordinate[1]]
          return [coordinate[0] - bulge, coordinate[1]]
        },
      },
    })
    const opened = await openGeoGrid(
      host,
      'nonlinear.tif',
      12,
      4,
      Array.from({ length: 48 }, () => 1),
    )
    const sourceGrid = grid(12, 4, 'EPSG:4326')
    const target = { ...grid(4, 4, 'EPSG:3857'), resampling: 'bilinear' as const }
    const input = { ...rawInput('source', 'source'), transform: descriptor }
    const statistics = payload(
      (
        await host.handle(
          rpcRequest('nonlinear-statistics', 'geo.analysis.region_statistics', {
            layerId: 'nonlinear',
            recipe: recipe(
              target,
              [input],
              {
                kind: 'band-math',
                expression: 'source',
                divideByZero: 'nodata',
                nonFinite: 'nodata',
              },
              'resample',
            ),
            inputs: [runtimeInput('source', opened, sourceGrid)],
            region: { x: 0, y: 0, width: 4, height: 4 },
            component: 0,
          }),
        )
      ).response,
      'geo.analysis.region_statistics',
    )
    expect(statistics).toMatchObject({ count: 16, invalidCount: 0, mean: 1 })
    await host.dispose()
  })

  it('uses a source halo so terrain profiles agree across tile boundaries', async () => {
    const host = new ImagingWorkerHost({ profile: 'geo' })
    const width = 8
    const height = 8
    const values = Float32Array.from({ length: width * height }, (_, index) => {
      const x = index % width
      const y = Math.floor(index / width)
      return x * 2 + y * 3
    })
    const opened = await openGrid(host, 'terrain.gsf', width, height, values, 1)
    const target = grid(width, height)
    const scaledElevation = {
      ...rawInput('elevation', 'elevation'),
      valueMode: 'scaled' as const,
      scale: 2,
      offset: 0,
    }
    const request = {
      layerId: 'terrain-slope',
      recipe: recipe(target, [scaledElevation], {
        kind: 'terrain' as const,
        operation: 'slope' as const,
        input: 'elevation',
        xSpacing: 1,
        ySpacing: 1,
        xUnit: { kind: 'metre' as const },
        yUnit: { kind: 'metre' as const },
        verticalUnit: { kind: 'metre' as const },
        rowDirection: 'north' as const,
        edge: 'clamp' as const,
        slopeUnit: 'degrees' as const,
        azimuthDegrees: 315,
        altitudeDegrees: 45,
      }),
      inputs: [runtimeInput('elevation', opened, target)],
      component: 0,
      resampling: 'nearest' as const,
    }
    const profile = async (id: string, startX: number, endX: number, sampleCount: number) =>
      payload(
        (
          await host.handle(
            rpcRequest(id, 'geo.analysis.line_profile', {
              ...request,
              start: { x: startX, y: 3 },
              end: { x: endX, y: 3 },
              sampleCount,
            }),
          )
        ).response,
        'geo.analysis.line_profile',
      )
    const whole = await profile('terrain-whole', 0, 7, 8)
    const left = await profile('terrain-left', 0, 3, 4)
    const right = await profile('terrain-right', 4, 7, 4)
    expect([...left.values, ...right.values]).toEqual([...whole.values])
    expect([...whole.valid]).toEqual(Array.from({ length: 8 }, () => 1))
    expect(whole.values[3]).toBeCloseTo((Math.atan(Math.hypot(4, 6)) * 180) / Math.PI, 5)
    await host.dispose()
  })
})
