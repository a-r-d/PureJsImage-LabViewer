import type {
  DisplayStatisticsRequest,
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  WorkerResponse,
} from '@pji-workbench/contracts'
import { rpcRequest } from '@pji-workbench/contracts'
import { describe, expect, it } from 'vitest'

import { ImagingWorkerHost } from '../src/index.js'
import {
  fourBandGeoTiffFixture,
  malformedTilePayloadTiffFixture,
  tiledGradientPyramidGeoTiffFixture,
} from './geotiff-fixture.js'

function payload<Kind extends Extract<WorkerResponse, { ok: true }>['kind']>(
  response: WorkerResponse,
  kind: Kind,
): Extract<WorkerResponse, { kind: Kind }>['payload'] {
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
  expect(response.kind).toBe(kind)
  return response.payload as Extract<WorkerResponse, { kind: Kind }>['payload']
}

async function openFixture(
  host: ImagingWorkerHost,
  bytes: Uint8Array,
  name: string,
): Promise<OpenedDatasetDescriptor> {
  const file = new File([bytes.slice().buffer as ArrayBuffer], name)
  const opened = await host.handle(
    rpcRequest(`open-${name}`, 'source.open-local', {
      generation: 1,
      primaryId: 'file-0',
      files: [
        {
          id: 'file-0',
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
          blob: file,
        },
      ],
    }),
  )
  const source = payload(opened.response, 'source.opened') as OpenedSourceDescriptor
  const summary = source.datasets[0]
  if (summary === undefined) throw new Error('Fixture has no dataset')
  const result = await host.handle(
    rpcRequest(`open-${name}-dataset`, 'dataset.open', {
      documentId: source.documentId,
      datasetId: summary.id,
      generation: 1,
    }),
  )
  return payload(result.response, 'dataset.opened') as OpenedDatasetDescriptor
}

async function openFourBand(host: ImagingWorkerHost): Promise<OpenedDatasetDescriptor> {
  return openFixture(host, fourBandGeoTiffFixture(), 'four-band.tif')
}

async function openRemoteFixture(
  host: ImagingWorkerHost,
  url: string,
): Promise<OpenedDatasetDescriptor> {
  const opened = await host.handle(
    rpcRequest(`open-${url}`, 'source.open-remote', { generation: 1, url }),
  )
  const source = payload(opened.response, 'source.opened') as OpenedSourceDescriptor
  const summary = source.datasets[0]
  if (summary === undefined) throw new Error('Fixture has no dataset')
  const result = await host.handle(
    rpcRequest(`open-${url}-dataset`, 'dataset.open', {
      documentId: source.documentId,
      datasetId: summary.id,
      generation: 1,
    }),
  )
  return payload(result.response, 'dataset.opened') as OpenedDatasetDescriptor
}

function displayTileRequest(
  dataset: OpenedDatasetDescriptor,
  id: string,
  region: Readonly<{ x: number; y: number; width: number; height: number }>,
) {
  return rpcRequest(id, 'display.tile.request', {
    tileId: id,
    datasetHandleId: dataset.handleId,
    generation: dataset.generation,
    sourceIdentity: 'fixture:failure',
    sourceRevision: 'fixture-v1',
    layerId: 'failure-layer',
    styleRevision: 'style-v1',
    statisticsRevision: 'manual-v1',
    displayAxes: dataset.selection.displayAxes,
    fixedIndices: dataset.selection.fixedIndices,
    resolutionLevel: 0,
    component: 0,
    mapping: { mode: 'linear', range: 'manual', minimum: 0, maximum: 255 },
    region,
    priority: 'visible',
  })
}

function statisticsRequest(dataset: OpenedDatasetDescriptor): DisplayStatisticsRequest {
  return {
    datasetHandleId: dataset.handleId,
    generation: dataset.generation,
    sourceIdentity: 'fixture:four-band',
    sourceRevision: 'sha256:fixture-v1',
    componentIndices: [0, 1, 2, 3],
    displayAxes: dataset.selection.displayAxes,
    fixedIndices: dataset.selection.fixedIndices,
    resolutionPolicy: { kind: 'reduced-overview' },
    nodataPolicy: { kind: 'exclude' },
    sampleBudget: { maxSamples: 64, maxBytes: 1_024, maxTiles: 4 },
    percentilePolicy: { low: 2, high: 98 },
    scaleOffsetPolicy: {
      kind: 'raw',
      components: [
        { scale: 1, offset: 0 },
        { scale: 1, offset: 0 },
        { scale: 1, offset: 0 },
        { scale: 1, offset: 0 },
      ],
    },
  }
}

describe('Atlas display RPCs', () => {
  it('uses one deterministic range across adjacent source tiles and the overview pyramid', async () => {
    const host = new ImagingWorkerHost()
    const dataset = await openFixture(
      host,
      tiledGradientPyramidGeoTiffFixture(),
      'tiled-gradient-pyramid.tif',
    )
    expect(dataset.dataset.levels.map(({ level }) => level)).toEqual([0, 1])
    const request: DisplayStatisticsRequest = {
      datasetHandleId: dataset.handleId,
      generation: dataset.generation,
      sourceIdentity: 'fixture:tiled-gradient',
      sourceRevision: 'sha256:gradient-v1',
      componentIndices: [0, 1, 2],
      displayAxes: dataset.selection.displayAxes,
      fixedIndices: dataset.selection.fixedIndices,
      resolutionPolicy: { kind: 'reduced-overview' },
      nodataPolicy: { kind: 'exclude' },
      sampleBudget: { maxSamples: 3_072, maxBytes: 16_384, maxTiles: 9 },
      percentilePolicy: { low: 2, high: 98 },
      scaleOffsetPolicy: {
        kind: 'raw',
        components: [
          { scale: 1, offset: 0 },
          { scale: 1, offset: 0 },
          { scale: 1, offset: 0 },
        ],
      },
    }
    const statistics = payload(
      (await host.handle(rpcRequest('gradient-statistics', 'display.statistics.request', request)))
        .response,
      'display.statistics.ready',
    )
    expect(statistics).toMatchObject({ overview: 1, sampledTiles: 9, cached: false })
    expect(statistics.sampleCoverage).toBeGreaterThan(0)
    expect(statistics.sampleCoverage).toBeLessThanOrEqual(1)
    const channelRanges = Object.fromEntries(
      statistics.components.map(({ component, minimum, maximum }) => [
        String(component),
        { minimum, maximum },
      ]),
    )
    const display = async (id: string, x: number, overview = 0) =>
      payload(
        (
          await host.handle(
            rpcRequest(id, 'display.tile.request', {
              tileId: id,
              datasetHandleId: dataset.handleId,
              generation: dataset.generation,
              sourceIdentity: request.sourceIdentity,
              sourceRevision: request.sourceRevision,
              layerId: 'gradient-layer',
              styleRevision: 'rgb-nearest-v1',
              statisticsRevision: statistics.statisticsRevision,
              displayAxes: dataset.selection.displayAxes,
              fixedIndices: dataset.selection.fixedIndices,
              resolutionLevel: overview,
              component: 0,
              mapping: {
                mode: 'linear',
                range: 'manual',
                bands: { red: 0, green: 1, blue: 2 },
                channelRanges,
              },
              region: { x, y: 16, width: 1, height: 1 },
              priority: 'visible',
            }),
          )
        ).response,
        'display.tile.ready',
      )
    const left = await display('gradient-left', 63)
    const right = await display('gradient-right', 64)
    const overview = await display('gradient-overview', 32, 1)
    expect(left.statisticsRevision).toBe(statistics.statisticsRevision)
    expect(right.statisticsRevision).toBe(statistics.statisticsRevision)
    expect(Math.abs((right.rgba[0] ?? 0) - (left.rgba[0] ?? 0))).toBeLessThanOrEqual(2)
    expect(Math.abs((overview.rgba[0] ?? 0) - (right.rgba[0] ?? 0))).toBeLessThanOrEqual(2)
    await host.dispose()
  })

  it('uses cached deterministic statistics for a fixed display mapping', async () => {
    const host = new ImagingWorkerHost()
    const dataset = await openFourBand(host)
    const request = statisticsRequest(dataset)
    const first = payload(
      (await host.handle(rpcRequest('statistics-1', 'display.statistics.request', request)))
        .response,
      'display.statistics.ready',
    )
    const second = payload(
      (await host.handle(rpcRequest('statistics-2', 'display.statistics.request', request)))
        .response,
      'display.statistics.ready',
    )
    expect(first).toMatchObject({ cached: false, overview: 0, sampledTiles: 1 })
    expect(first.components).toHaveLength(4)
    expect(second).toMatchObject({ cached: true, statisticsRevision: first.statisticsRevision })
    expect(first.sampleCoverage).toBe(1)

    const ranges = Object.fromEntries(
      first.components.map((component) => [
        String(component.component),
        { minimum: component.minimum, maximum: component.maximum },
      ]),
    )
    const tileResult = await host.handle(
      rpcRequest('display-tile', 'display.tile.request', {
        tileId: 'fixed-range-tile',
        datasetHandleId: dataset.handleId,
        generation: dataset.generation,
        sourceIdentity: 'fixture:four-band',
        sourceRevision: 'sha256:fixture-v1',
        layerId: 'layer-1',
        styleRevision: 'style-1',
        statisticsRevision: first.statisticsRevision,
        displayAxes: dataset.selection.displayAxes,
        fixedIndices: dataset.selection.fixedIndices,
        resolutionLevel: 0,
        component: 0,
        mapping: {
          mode: 'linear',
          range: 'manual',
          bands: { red: 0, green: 1, blue: 2 },
          channelRanges: ranges,
        },
        region: { x: 0, y: 0, width: 1, height: 1 },
        priority: 'visible',
      }),
    )
    const tile = payload(tileResult.response, 'display.tile.ready')
    expect(tile).toMatchObject({
      tileId: 'fixed-range-tile',
      sourceRevision: 'sha256:fixture-v1',
      styleRevision: 'style-1',
      statisticsRevision: first.statisticsRevision,
      overview: 0,
    })
    expect(tile.rgba).toHaveLength(4)
    expect(tile).not.toHaveProperty('values')
    expect(tile).not.toHaveProperty('bandValues')
    await host.dispose()
  })

  it('samples every native component with exact identities and coordinates', async () => {
    const host = new ImagingWorkerHost()
    const dataset = await openFourBand(host)
    const result = await host.handle(
      rpcRequest('sample-point', 'raster.sample_point', {
        datasetHandleId: dataset.handleId,
        generation: dataset.generation,
        sourceIdentity: 'fixture:four-band',
        layerId: 'layer-4b',
        displayAxes: dataset.selection.displayAxes,
        fixedIndices: dataset.selection.fixedIndices,
        pixel: { x: 1, y: 0 },
        projectMapCoordinate: { x: 1, y: 1 },
      }),
    )
    const sample = payload(result.response, 'raster.point_sampled')
    expect(sample).toMatchObject({
      sourceIdentity: 'fixture:four-band',
      layerId: 'layer-4b',
      pixel: { x: 1, y: 0 },
      projectMapCoordinate: { x: 1, y: 1 },
    })
    expect(sample.components).toHaveLength(4)
    expect(sample.components.map(({ value }) => value)).toEqual([50, 60, 70, 80])
    await host.dispose()
  })

  it('surfaces a transient tile read and allows the same display request to succeed on retry', async () => {
    const bytes = tiledGradientPyramidGeoTiffFixture({
      width: 512,
      height: 256,
      tileWidth: 128,
    })
    let failTileReads = false
    const host = new ImagingWorkerHost({
      fetch: async (_input, init) => {
        if (failTileReads) return new Response(null, { status: 503 })
        const range = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
        if (range === null || range === undefined) return new Response(null, { status: 416 })
        const start = Number(range[1])
        const end = Math.min(Number(range[2]), bytes.byteLength - 1)
        return new Response(bytes.slice(start, end + 1), {
          status: 206,
          headers: {
            'accept-ranges': 'bytes',
            'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
            etag: '"transient-gradient-v1"',
          },
        })
      },
    })
    const dataset = await openRemoteFixture(host, 'https://fixtures.invalid/transient.tif')
    failTileReads = true
    const first = await host.handle(
      displayTileRequest(dataset, 'transient-first', { x: 511, y: 255, width: 1, height: 1 }),
    )
    expect(first.response).toMatchObject({ ok: false, error: { retryable: true } })
    failTileReads = false
    const retried = await host.handle(
      displayTileRequest(dataset, 'transient-retry', { x: 511, y: 255, width: 1, height: 1 }),
    )
    expect(payload(retried.response, 'display.tile.ready').rgba).toHaveLength(4)
    await host.dispose()
  })

  it('reports a malformed decoder payload as a permanent display failure', async () => {
    const host = new ImagingWorkerHost()
    const dataset = await openFixture(
      host,
      malformedTilePayloadTiffFixture(),
      'malformed-tile-payload.tif',
    )
    const result = await host.handle(
      displayTileRequest(dataset, 'permanent-decoder', { x: 0, y: 0, width: 1, height: 1 }),
    )
    expect(result.response).toMatchObject({
      ok: false,
      error: { code: 'MALFORMED_METADATA', retryable: false },
    })
    await host.dispose()
  })
})
