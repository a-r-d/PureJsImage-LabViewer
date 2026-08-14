import type {
  DatasetHandleId,
  DocumentId,
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  RenderTile,
  RpcJsonObject,
  SourceId,
  WorkerResponse,
} from '@pji-workbench/contracts'
import { rpcRequest } from '@pji-workbench/contracts'
import { MATERIALS_OPERATION_IDS } from '@pji-workbench/materials-analysis'
import {
  analysisConnectedComponentsOperationId,
  analysisLineProfileOperationId,
  analysisStatisticsOperationId,
  analysisThresholdOperationId,
  computeAnalysisProjectHashes,
  createBuiltInAnalysisOperationRegistry,
  createBuiltInAnalysisValueTypeRegistry,
  scientificDatasetValueTypeId,
  validateAnalysisProjectV1,
} from 'purejsimage/analysis'
import { roiValueTypeId } from 'purejsimage/analysis/roi'
import type { NormalizedScientificDatasetDescriptor } from 'purejsimage/scientific'
import { encodeGsf } from 'purejsimage/scientific/readers/gsf'
import { describe, expect, it } from 'vitest'

import {
  ImagingWorkerClient,
  ImagingWorkerHost,
  PUREJSIMAGE_PACKAGE_VERSION,
  SUPPORTED_READERS,
} from '../src/index.js'

class FakeWorker extends EventTarget {
  terminated = false
  initialized = 0

  postMessage(message: unknown): void {
    if (
      typeof message === 'object' &&
      message !== null &&
      'kind' in message &&
      message.kind === 'worker.initialize' &&
      'requestId' in message &&
      typeof message.requestId === 'string'
    ) {
      this.initialized += 1
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent('message', {
            data: {
              schemaVersion: 1,
              requestId: message.requestId,
              ok: true,
              kind: 'worker.initialize',
              payload: { readers: SUPPORTED_READERS },
            },
          }),
        ),
      )
    }
  }

  terminate(): void {
    this.terminated = true
  }
}

function payload<Kind extends Extract<WorkerResponse, { ok: true }>['kind']>(
  response: WorkerResponse,
  kind: Kind,
): Extract<WorkerResponse, { kind: Kind }>['payload'] {
  if (!response.ok) throw new Error(response.error.message)
  expect(response.ok).toBe(true)
  expect(response.kind).toBe(kind)
  return response.payload as Extract<WorkerResponse, { kind: Kind }>['payload']
}

async function openGenerated(
  host: ImagingWorkerHost,
  generation = 1,
  sampleId?: string | undefined,
) {
  const openedResponse = await host.handle(
    rpcRequest('sample-open', 'source.open-sample', { generation, sampleId }),
  )
  const source = payload(openedResponse.response, 'source.opened') as OpenedSourceDescriptor
  const summary = source.datasets[0]
  if (summary === undefined) throw new Error('Sample did not expose a dataset')
  const datasetResponse = await host.handle(
    rpcRequest('dataset-open', 'dataset.open', {
      documentId: source.documentId,
      datasetId: summary.id,
      generation,
    }),
  )
  const dataset = payload(datasetResponse.response, 'dataset.opened') as OpenedDatasetDescriptor
  return { source, dataset }
}

async function openGeneratedValues(
  host: ImagingWorkerHost,
  width: number,
  height: number,
  values: Float32Array,
  calibrated = true,
) {
  const bytes = encodeGsf({
    width,
    height,
    values,
    ...(calibrated ? { xyUnit: 'nm', xReal: width * 0.5, yReal: height * 0.75 } : {}),
  })
  const file = new File([bytes.slice().buffer as ArrayBuffer], 'analysis-fixture.gsf')
  const sourceResult = await host.handle(
    rpcRequest('analysis-source', 'source.open-local', {
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
  const source = payload(sourceResult.response, 'source.opened') as OpenedSourceDescriptor
  const datasetResult = await host.handle(
    rpcRequest('analysis-dataset', 'dataset.open', {
      documentId: source.documentId,
      datasetId: source.datasets[0]?.id ?? 'missing',
      generation: 1,
    }),
  )
  return payload(datasetResult.response, 'dataset.opened') as OpenedDatasetDescriptor
}

function connectedComponentsGraph(connectivity: 4 | 8): RpcJsonObject {
  return {
    schemaVersion: 1,
    inputs: [{ name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } }],
    nodes: [
      {
        id: 'threshold',
        operation: { id: analysisThresholdOperationId, version: 1 },
        inputs: [{ port: 'dataset', source: { kind: 'input', input: 'source' } }],
        parameters: { mode: 'greater-than', component: 0, threshold: 5 },
      },
      {
        id: 'objects',
        operation: { id: analysisConnectedComponentsOperationId, version: 1 },
        inputs: [
          {
            port: 'dataset',
            source: { kind: 'node', nodeId: 'threshold', output: 'dataset' },
          },
        ],
        parameters: {
          displayAxes: ['x', 'y'],
          fixedIndices: [],
          component: 0,
          connectivity,
        },
      },
    ],
    outputs: [
      { name: 'labels', source: { kind: 'node', nodeId: 'objects', output: 'labels' } },
      { name: 'objects', source: { kind: 'node', nodeId: 'objects', output: 'objects' } },
    ],
  }
}

function particleWorkflowGraph(): RpcJsonObject {
  const plane = { displayAxes: ['x', 'y'], fixedIndices: [], component: 0 }
  return {
    schemaVersion: 1,
    inputs: [
      { name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } },
      { name: 'selection', valueType: { id: roiValueTypeId, version: 1 } },
    ],
    nodes: [
      {
        id: 'threshold',
        operation: { id: MATERIALS_OPERATION_IDS.thresholdReference, version: 1 },
        inputs: [
          { port: 'dataset', source: { kind: 'input', input: 'source' } },
          { port: 'roi', source: { kind: 'input', input: 'selection' } },
        ],
        parameters: {
          ...plane,
          method: 'manual',
          polarity: 'light',
          lower: 50,
          upper: 200,
          histogramBins: 64,
          windowRadius: 3,
          sauvolaK: 0.2,
          dynamicRange: 128,
          noDataPolicy: 'background',
        },
      },
      {
        id: 'fill',
        operation: { id: MATERIALS_OPERATION_IDS.binaryFillHoles, version: 1 },
        inputs: [
          { port: 'dataset', source: { kind: 'node', nodeId: 'threshold', output: 'mask' } },
        ],
        parameters: { ...plane, radius: 1, minimumSize: 1, connectivity: 8 },
      },
      {
        id: 'components',
        operation: { id: analysisConnectedComponentsOperationId, version: 1 },
        inputs: [{ port: 'dataset', source: { kind: 'node', nodeId: 'fill', output: 'dataset' } }],
        parameters: { ...plane, connectivity: 8 },
      },
      {
        id: 'particles',
        operation: { id: MATERIALS_OPERATION_IDS.particleAnalysis, version: 1 },
        inputs: [
          {
            port: 'labels',
            source: { kind: 'node', nodeId: 'components', output: 'labels' },
          },
          { port: 'source', source: { kind: 'input', input: 'source' } },
          { port: 'roi', source: { kind: 'input', input: 'selection' } },
        ],
        parameters: {
          ...plane,
          sourceComponent: 0,
          edgePolicy: 'exclude',
          minimumArea: 2,
          maximumArea: 1_000,
          minimumCircularity: 0,
          maximumCircularity: 1,
          minimumAspectRatio: 1,
          maximumAspectRatio: 100,
          minimumSolidity: 0,
          maximumSolidity: 1,
        },
      },
    ],
    outputs: [
      { name: 'mask', source: { kind: 'node', nodeId: 'fill', output: 'dataset' } },
      {
        name: 'labels',
        source: { kind: 'node', nodeId: 'particles', output: 'filteredLabels' },
      },
      { name: 'objects', source: { kind: 'node', nodeId: 'particles', output: 'objects' } },
      { name: 'summary', source: { kind: 'node', nodeId: 'particles', output: 'summary' } },
      {
        name: 'distribution',
        source: { kind: 'node', nodeId: 'particles', output: 'distribution' },
      },
    ],
  }
}

async function requestTile(
  host: ImagingWorkerHost,
  dataset: OpenedDatasetDescriptor,
  generation = dataset.generation,
): Promise<RenderTile> {
  const result = await host.handle(
    rpcRequest(`tile-${generation}`, 'tile.request', {
      tileId: `tile-${generation}`,
      datasetHandleId: dataset.handleId,
      generation,
      displayAxes: dataset.selection.displayAxes,
      fixedIndices: dataset.selection.fixedIndices,
      resolutionLevel: dataset.selection.resolutionLevel,
      component: 0,
      mapping: { mode: 'linear', range: 'auto' },
      region: { x: 384, y: 256, width: 128, height: 96 },
      priority: 'visible',
    }),
  )
  return payload(result.response, 'tile.ready') as RenderTile
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
        etag: '"generated-gsf-v1"',
      },
    })
  }
}

describe('PureJsImage Worker host', () => {
  it('composes the trusted materials catalog and renders a bounded derived preview tile', async () => {
    const host = new ImagingWorkerHost()
    const dataset = await openGeneratedValues(host, 3, 2, Float32Array.from([1, 2, 3, 4, 5, 6]))
    const catalogResult = await host.handle(
      rpcRequest('materials-catalog', 'analysis.catalog', {
        datasetHandleId: dataset.handleId,
        generation: dataset.generation,
      }),
    )
    const catalog = payload(catalogResult.response, 'analysis.catalog')
    const descriptors = catalog.capabilities['operationDescriptors']
    expect(Array.isArray(descriptors)).toBe(true)
    expect(catalog.documentation.length).toBeGreaterThan(20)
    expect(catalog.presets.length).toBeGreaterThan(2)

    const graph: RpcJsonObject = {
      schemaVersion: 1,
      inputs: [{ name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } }],
      nodes: [
        {
          id: 'add',
          operation: { id: MATERIALS_OPERATION_IDS.addConstant, version: 1 },
          inputs: [{ port: 'dataset', source: { kind: 'input', input: 'source' } }],
          parameters: {
            displayAxes: dataset.selection.displayAxes,
            fixedIndices: dataset.selection.fixedIndices,
            value: 2,
          },
        },
      ],
      outputs: [{ name: 'dataset', source: { kind: 'node', nodeId: 'add', output: 'dataset' } }],
    }
    const executeResult = await host.handle(
      rpcRequest('materials-execute', 'analysis.execute', {
        datasetHandleId: dataset.handleId,
        generation: dataset.generation,
        graph,
      }),
    )
    const execution = payload(executeResult.response, 'analysis.executed')
    expect(execution.outputs[0]?.kind).toBe('dataset')
    const tileResult = await host.handle(
      rpcRequest('materials-tile', 'analysis.dataset-tile', {
        datasetHandleId: dataset.handleId,
        generation: dataset.generation,
        resultHandleId: execution.resultHandleId,
        output: 'dataset',
        tileId: 'materials-preview',
        displayAxes: dataset.selection.displayAxes,
        fixedIndices: dataset.selection.fixedIndices,
        resolutionLevel: 0,
        component: 0,
        mapping: { mode: 'linear', range: 'manual', minimum: 0, maximum: 10 },
        region: { x: 0, y: 0, width: 3, height: 2 },
        priority: 'visible',
      }),
    )
    const tile = payload(tileResult.response, 'analysis.dataset-tile')
    expect([...tile.values]).toEqual([3, 4, 5, 6, 7, 8])

    const filterGraph: RpcJsonObject = {
      ...graph,
      nodes: [
        {
          id: 'box',
          operation: { id: MATERIALS_OPERATION_IDS.box, version: 1 },
          inputs: [{ port: 'dataset', source: { kind: 'input', input: 'source' } }],
          parameters: {
            displayAxes: dataset.selection.displayAxes,
            fixedIndices: dataset.selection.fixedIndices,
            radius: 1,
            boundary: 'clamp',
            constantValue: 0,
            invalidPolicy: 'propagate',
          },
        },
      ],
      outputs: [{ name: 'dataset', source: { kind: 'node', nodeId: 'box', output: 'dataset' } }],
    }
    const filterExecutionResult = await host.handle(
      rpcRequest('materials-filter-execute', 'analysis.execute', {
        datasetHandleId: dataset.handleId,
        generation: dataset.generation,
        graph: filterGraph,
      }),
    )
    const filterExecution = payload(filterExecutionResult.response, 'analysis.executed')
    const filterTileResult = await host.handle(
      rpcRequest('materials-filter-tile', 'analysis.dataset-tile', {
        datasetHandleId: dataset.handleId,
        generation: dataset.generation,
        resultHandleId: filterExecution.resultHandleId,
        output: 'dataset',
        tileId: 'materials-filter-preview',
        displayAxes: dataset.selection.displayAxes,
        fixedIndices: dataset.selection.fixedIndices,
        resolutionLevel: 0,
        component: 0,
        mapping: { mode: 'linear', range: 'manual', minimum: 0, maximum: 10 },
        region: { x: 0, y: 0, width: 3, height: 2 },
        priority: 'visible',
      }),
    )
    const filtered = payload(filterTileResult.response, 'analysis.dataset-tile')
    expect([...filtered.values]).toEqual(
      expect.arrayContaining([
        expect.closeTo(7 / 3, 5),
        expect.closeTo(3, 5),
        expect.closeTo(11 / 3, 5),
        expect.closeTo(10 / 3, 5),
        expect.closeTo(4, 5),
        expect.closeTo(14 / 3, 5),
      ]),
    )
    await host.dispose()
  })

  it('executes and releases a bounded threshold-to-object-table workflow through public APIs', async () => {
    const host = new ImagingWorkerHost()
    const values = new Float32Array(8 * 8)
    for (const [x, y] of [
      [0, 0],
      [0, 1],
      [5, 5],
      [6, 5],
    ] as const) {
      values[y * 8 + x] = 10
    }
    const dataset = await openGeneratedValues(host, 8, 8, values)
    const catalog = await host.handle(
      rpcRequest('analysis-catalog', 'analysis.catalog', {
        datasetHandleId: dataset.handleId,
        generation: 1,
      }),
    )
    const capabilities = payload(catalog.response, 'analysis.catalog').capabilities
    expect(capabilities['operationDescriptors']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: analysisThresholdOperationId }),
        expect.objectContaining({ id: analysisConnectedComponentsOperationId }),
      ]),
    )
    const graph = connectedComponentsGraph(4)
    const dryRun = await host.handle(
      rpcRequest('analysis-plan', 'analysis.dry-run', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        graph,
      }),
    )
    expect(payload(dryRun.response, 'analysis.dry-run')).toMatchObject({ valid: true })
    const executed = await host.handle(
      rpcRequest('analysis-execute', 'analysis.execute', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        graph,
      }),
    )
    const execution = payload(executed.response, 'analysis.executed')
    expect(execution.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'dataset', name: 'labels' }),
        expect.objectContaining({ kind: 'result', name: 'objects' }),
      ]),
    )
    expect(JSON.stringify(execution)).not.toContain('pixelCount":{"0"')

    const pageResult = await host.handle(
      rpcRequest('analysis-page', 'analysis.table-page', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        resultHandleId: execution.resultHandleId,
        output: 'objects',
        offset: 0,
        limit: 1,
        sort: { column: 'pixelArea', direction: 'descending' },
      }),
    )
    const page = payload(pageResult.response, 'analysis.table-page')
    expect(page).toMatchObject({ rowCount: 1, totalRows: 2 })
    expect(page.columns.find(({ name }) => name === 'physicalArea')?.unit).toBe('nm²')

    const overlayResult = await host.handle(
      rpcRequest('analysis-overlay', 'analysis.overlay-tile', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        resultHandleId: execution.resultHandleId,
        output: 'labels',
        tileId: 'labels-0',
        selection: dataset.selection,
        component: 0,
        region: { x: 0, y: 0, width: 8, height: 8 },
      }),
    )
    const overlay = payload(overlayResult.response, 'analysis.overlay-tile')
    expect(new Set(overlay.labels).size).toBe(3)
    const pageLabel = page.columns.find(({ name }) => name === 'label')?.values[0]
    expect(overlay.labels).toContain(pageLabel)
    expect(overlay.rgba).toHaveLength(8 * 8 * 4)

    const released = await host.handle(
      rpcRequest('analysis-release', 'analysis.release', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        resultHandleId: execution.resultHandleId,
      }),
    )
    expect(released.response).toMatchObject({ ok: true, kind: 'analysis.released' })
    const stale = await host.handle(
      rpcRequest('analysis-stale-page', 'analysis.table-page', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        resultHandleId: execution.resultHandleId,
        output: 'objects',
        offset: 0,
        limit: 1,
      }),
    )
    expect(stale.response).toMatchObject({ ok: false, error: { code: 'STALE_ID' } })

    const cancelledExecution = host.handle(
      rpcRequest('analysis-cancelled-execution', 'analysis.execute', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        graph,
      }),
    )
    const cancellation = await host.handle(
      rpcRequest('cancel-analysis-execution', 'request.cancel', {
        targetRequestId: 'analysis-cancelled-execution',
      }),
    )
    expect(cancellation.response).toMatchObject({
      ok: true,
      payload: { found: true },
    })
    await expect(cancelledExecution).resolves.toMatchObject({
      response: { ok: false, error: { code: 'ABORTED' } },
    })
    await host.dispose()
  })

  it('runs the guided particle graph with calibrated measurements and tile-invariant linked overlays', async () => {
    const host = new ImagingWorkerHost()
    const width = 32
    const height = 24
    const values = Float32Array.from(
      { length: width * height },
      (_value, index) => 10 + (index % width) * 0.1,
    )
    const paint = (left: number, top: number, objectWidth: number, objectHeight: number): void => {
      for (let y = top; y < top + objectHeight; y += 1)
        for (let x = left; x < left + objectWidth; x += 1) values[y * width + x] = 100
    }
    paint(4, 4, 3, 3)
    paint(12, 3, 5, 1)
    paint(12, 7, 5, 1)
    paint(12, 4, 1, 3)
    paint(16, 4, 1, 3)
    paint(21, 14, 3, 3)
    paint(23, 16, 3, 3)
    paint(0, 18, 2, 3)
    const dataset = await openGeneratedValues(host, width, height, values)
    const roi = {
      schemaVersion: 1,
      id: 'whole-plane',
      axisIds: ['x', 'y'],
      fixedIndices: [],
      coordinateSpace: 'pixel',
      geometry: { kind: 'rectangle', x: 0, y: 0, width, height },
    } as unknown as RpcJsonObject
    const graph = particleWorkflowGraph()
    const planned = await host.handle(
      rpcRequest('particle-plan', 'analysis.dry-run', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        graph,
        roi,
      }),
    )
    const particlePlan = payload(planned.response, 'analysis.dry-run')
    if (!particlePlan.valid) throw new Error(JSON.stringify(particlePlan.issues))
    const executed = await host.handle(
      rpcRequest('particle-execute', 'analysis.execute', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        graph,
        roi,
      }),
    )
    const execution = payload(executed.response, 'analysis.executed')
    const pageResult = await host.handle(
      rpcRequest('particle-page', 'analysis.table-page', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        resultHandleId: execution.resultHandleId,
        output: 'objects',
        offset: 0,
        limit: 20,
      }),
    )
    const page = payload(pageResult.response, 'analysis.table-page')
    expect(page.totalRows).toBe(3)
    expect(page.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'pixelArea',
        'physicalArea',
        'pixelMajorAxis',
        'majorAxis',
        'orientationRadians',
        'circularity',
        'solidity',
        'intensityMean',
        'integratedIntensity',
      ]),
    )
    expect(page.columns.find(({ name }) => name === 'physicalArea')?.unit).toBe('nm²')
    expect(page.columns.find(({ name }) => name === 'majorAxis')?.unit).toBe('nm')

    const overlayRequest = (id: string, x: number, overlayWidth: number) =>
      host.handle(
        rpcRequest(id, 'analysis.overlay-tile', {
          datasetHandleId: dataset.handleId,
          generation: 1,
          resultHandleId: execution.resultHandleId,
          output: 'labels',
          tileId: id,
          selection: dataset.selection,
          component: 0,
          view: 'outline',
          region: { x, y: 0, width: overlayWidth, height },
        }),
      )
    const whole = payload(
      (await overlayRequest('particle-outline-whole', 0, width)).response,
      'analysis.overlay-tile',
    )
    const left = payload(
      (await overlayRequest('particle-outline-left', 0, width / 2)).response,
      'analysis.overlay-tile',
    )
    const right = payload(
      (await overlayRequest('particle-outline-right', width / 2, width / 2)).response,
      'analysis.overlay-tile',
    )
    const splitAlpha = new Uint8Array(width * height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width / 2; x += 1) {
        splitAlpha[y * width + x] = left.rgba[(y * (width / 2) + x) * 4 + 3] ?? 0
        splitAlpha[y * width + width / 2 + x] = right.rgba[(y * (width / 2) + x) * 4 + 3] ?? 0
      }
    }
    expect([...splitAlpha]).toEqual(
      Array.from({ length: width * height }, (_value, index) => whole.rgba[index * 4 + 3] ?? 0),
    )
    const tableLabels = page.columns.find(({ name }) => name === 'label')?.values ?? []
    for (const label of tableLabels) {
      expect(typeof label).toBe('number')
      expect([...whole.labels]).toContain(label)
    }
    const numberedResult = await host.handle(
      rpcRequest('particle-numbered', 'analysis.overlay-tile', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        resultHandleId: execution.resultHandleId,
        output: 'labels',
        tableOutput: 'objects',
        tileId: 'particle-numbered',
        selection: dataset.selection,
        component: 0,
        view: 'numbered',
        region: { x: 0, y: 0, width, height },
      }),
    )
    const numbered = payload(numberedResult.response, 'analysis.overlay-tile')
    expect(numbered.view).toBe('numbered')
    expect(numbered.annotations).toHaveLength(3)
    const distributionResult = await host.handle(
      rpcRequest('particle-distribution', 'analysis.series-export', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        resultHandleId: execution.resultHandleId,
        output: 'distribution',
        maxRows: 20,
      }),
    )
    expect(payload(distributionResult.response, 'analysis.series-export')).toMatchObject({
      rowCount: 3,
      truncated: false,
    })
    await host.dispose()
  })

  it('normalizes ROI measurements and returns exact bounded statistics and line-profile summaries', async () => {
    const host = new ImagingWorkerHost()
    const dataset = await openGeneratedValues(
      host,
      4,
      4,
      Float32Array.from({ length: 16 }, (_value, index) => index + 1),
    )
    const rectangle = {
      schemaVersion: 1,
      id: 'rectangle',
      axisIds: ['x', 'y'],
      fixedIndices: [],
      coordinateSpace: 'pixel',
      geometry: { kind: 'rectangle', x: 1, y: 1, width: 2, height: 2 },
    } as unknown as RpcJsonObject
    const normalized = await host.handle(
      rpcRequest('normalize-roi', 'analysis.normalize-roi', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        roi: rectangle,
      }),
    )
    expect(payload(normalized.response, 'analysis.roi-normalized')).toMatchObject({ valid: true })
    const statisticsGraph = {
      schemaVersion: 1,
      inputs: [
        { name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } },
        { name: 'selection', valueType: { id: roiValueTypeId, version: 1 } },
      ],
      nodes: [
        {
          id: 'statistics',
          operation: { id: analysisStatisticsOperationId, version: 1 },
          inputs: [
            { port: 'dataset', source: { kind: 'input', input: 'source' } },
            { port: 'roi', source: { kind: 'input', input: 'selection' } },
          ],
          parameters: {
            displayAxes: ['x', 'y'],
            fixedIndices: [],
            component: 0,
            percentiles: [50],
            percentileMaxSamples: 64,
            emptyPolicy: 'error',
          },
        },
      ],
      outputs: [
        {
          name: 'statistics',
          source: { kind: 'node', nodeId: 'statistics', output: 'statistics' },
        },
      ],
    } as unknown as RpcJsonObject
    const statisticsResult = await host.handle(
      rpcRequest('execute-statistics', 'analysis.execute', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        graph: statisticsGraph,
        roi: rectangle,
      }),
    )
    const statistics = payload(statisticsResult.response, 'analysis.executed')
    const statisticsSummary = statistics.outputs.find(({ name }) => name === 'statistics')
    expect(statisticsSummary).toMatchObject({ kind: 'result' })
    if (statisticsSummary?.kind !== 'result') throw new Error('Statistics summary missing')
    expect(statisticsSummary.summary['dimensions']).toEqual({ results: 8 })
    const preview = statisticsSummary.summary['preview'] as Readonly<Record<string, RpcJsonObject>>
    expect(preview['count']?.['preview']).toBe(4)
    expect(preview['mean']?.['preview']).toBe(8.5)

    const line = {
      schemaVersion: 1,
      id: 'line',
      axisIds: ['x', 'y'],
      fixedIndices: [],
      coordinateSpace: 'pixel',
      geometry: {
        kind: 'line-segment',
        start: { x: 0.5, y: 0.5 },
        end: { x: 3.5, y: 0.5 },
      },
    } as unknown as RpcJsonObject
    const profileGraph = {
      schemaVersion: 1,
      inputs: [
        { name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } },
        { name: 'selection', valueType: { id: roiValueTypeId, version: 1 } },
      ],
      nodes: [
        {
          id: 'profile',
          operation: { id: analysisLineProfileOperationId, version: 1 },
          inputs: [
            { port: 'dataset', source: { kind: 'input', input: 'source' } },
            { port: 'roi', source: { kind: 'input', input: 'selection' } },
          ],
          parameters: {
            displayAxes: ['x', 'y'],
            fixedIndices: [],
            component: 0,
            components: [0],
            interpolation: 'nearest',
            spacing: 1,
            spacingSpace: 'pixel',
            maxSamples: 16,
            outside: 'error',
            invalidPolicy: 'nan',
          },
        },
      ],
      outputs: [
        { name: 'profile', source: { kind: 'node', nodeId: 'profile', output: 'profile' } },
      ],
    } as unknown as RpcJsonObject
    const profileResult = await host.handle(
      rpcRequest('execute-profile', 'analysis.execute', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        graph: profileGraph,
        roi: line,
      }),
    )
    const profile = payload(profileResult.response, 'analysis.executed')
    const profileSummary = profile.outputs.find(({ name }) => name === 'profile')
    if (profileSummary?.kind !== 'result') throw new Error('Profile summary missing')
    expect(profileSummary.summary['preview']).toMatchObject({
      distance: [0, 1, 2, 3],
      value: [1, 2, 3, 4],
    })
    const exportResult = await host.handle(
      rpcRequest('export-profile', 'analysis.series-export', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        resultHandleId: profile.resultHandleId,
        output: 'profile',
        maxRows: 16,
      }),
    )
    const exported = payload(exportResult.response, 'analysis.series-export')
    expect(exported).toMatchObject({ rowCount: 4, truncated: false })
    expect(exported.columns.map(({ values }) => values)).toEqual([
      [0, 1, 2, 3],
      [1, 2, 3, 4],
    ])
    await host.dispose()
  })

  it('distinguishes diagonal particles under exact 4/8 connectivity semantics', async () => {
    const host = new ImagingWorkerHost()
    const values = new Float32Array(3 * 3)
    values[0] = 10
    values[4] = 10
    const dataset = await openGeneratedValues(host, 3, 3, values)
    const counts: number[] = []
    for (const connectivity of [4, 8] as const) {
      const executed = await host.handle(
        rpcRequest(`diagonal-${connectivity}`, 'analysis.execute', {
          datasetHandleId: dataset.handleId,
          generation: 1,
          graph: connectedComponentsGraph(connectivity),
        }),
      )
      const execution = payload(executed.response, 'analysis.executed')
      const pageResult = await host.handle(
        rpcRequest(`diagonal-page-${connectivity}`, 'analysis.table-page', {
          datasetHandleId: dataset.handleId,
          generation: 1,
          resultHandleId: execution.resultHandleId,
          output: 'objects',
          offset: 0,
          limit: 10,
        }),
      )
      counts.push(payload(pageResult.response, 'analysis.table-page').totalRows)
      await host.handle(
        rpcRequest(`diagonal-release-${connectivity}`, 'analysis.release', {
          datasetHandleId: dataset.handleId,
          generation: 1,
          resultHandleId: execution.resultHandleId,
        }),
      )
    }
    expect(counts).toEqual([2, 1])
    await host.dispose()
  })

  it('keeps missing calibration explicit and returns pixel-only object measurements', async () => {
    const host = new ImagingWorkerHost()
    const dataset = await openGeneratedValues(host, 2, 2, Float32Array.of(10, 0, 0, 0), false)
    const executed = await host.handle(
      rpcRequest('uncalibrated-execution', 'analysis.execute', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        graph: connectedComponentsGraph(4),
      }),
    )
    const execution = payload(executed.response, 'analysis.executed')
    const pageResult = await host.handle(
      rpcRequest('uncalibrated-page', 'analysis.table-page', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        resultHandleId: execution.resultHandleId,
        output: 'objects',
        offset: 0,
        limit: 10,
      }),
    )
    const page = payload(pageResult.response, 'analysis.table-page')
    expect(page.columns.map(({ name }) => name)).toContain('pixelArea')
    expect(page.columns.map(({ name }) => name)).not.toContain('physicalArea')
    await host.dispose()
  })

  it('accepts the persisted analysis slice through the public PureJsImage project validator', async () => {
    const host = new ImagingWorkerHost()
    const { source, dataset } = await openGenerated(host)
    const graph = { schemaVersion: 1 as const, inputs: [], nodes: [], outputs: [] }
    const bindings = []
    const hashes = await computeAnalysisProjectHashes({ graph, bindings })
    // The RPC descriptor is a bounded JSON projection of this public PureJsImage descriptor.
    const descriptor = dataset.dataset as unknown as NormalizedScientificDatasetDescriptor
    const validation = await validateAnalysisProjectV1(
      {
        schemaVersion: 1,
        graph,
        roiSet: { schemaVersion: 1, rois: [] },
        bindings,
        sourceReferences: [
          { id: 'source-1', identity: source.identity, locatorHint: { kind: 'sample' } },
        ],
        createdWith: { packageVersion: '0.10.0', buildFingerprint: 'workbench-test' },
        hashes,
      },
      {
        operations: createBuiltInAnalysisOperationRegistry(),
        valueTypes: createBuiltInAnalysisValueTypeRegistry(descriptor),
        roi: { descriptor },
      },
    )
    expect(validation.valid).toBe(true)
    expect(validation.issues).toEqual([])
  })

  it('pins the package and exposes the seven explicit reader descriptors', async () => {
    expect(PUREJSIMAGE_PACKAGE_VERSION).toBe('0.10.0')
    expect(SUPPORTED_READERS.map(({ id }) => id)).toEqual([
      'purejsimage/gsf',
      'purejsimage/envi',
      'purejsimage/fits',
      'purejsimage/mrc',
      'purejsimage/cbf',
      'purejsimage/ome-tiff',
      'purejsimage/aperio-svs',
    ])
    const initialized = await new ImagingWorkerHost().handle(
      rpcRequest('initialize', 'worker.initialize', null),
    )
    expect(payload(initialized.response, 'worker.initialize')).toMatchObject({
      readers: SUPPORTED_READERS,
    })
  })

  it('opens a calibrated sample and returns only a bounded quantitative render tile', async () => {
    const host = new ImagingWorkerHost()
    const { source, dataset } = await openGenerated(host)
    expect(source.reader.id).toBe('purejsimage/gsf')
    expect(dataset.dataset.axes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'x',
          unit: 'nm',
          coordinates: { type: 'linear', step: 0.42, origin: 0 },
        }),
      ]),
    )
    const tile = await requestTile(host, dataset)
    expect(tile).toMatchObject({ width: 128, height: 96, generation: 1 })
    expect(tile.rgba).toHaveLength(128 * 96 * 4)
    expect(tile.values).toHaveLength(128 * 96)
    expect(tile.histogram).toHaveLength(64)
    expect(tile.values.some((value) => value !== tile.values[0])).toBe(true)
    const diagnostics = host.diagnostics()
    expect(diagnostics.tileRuntime).toMatchObject({ enabled: true })
    expect(diagnostics.releases.tiles).toBe(1)
    await host.dispose()
  })

  it('resolves every enabled generated corpus source without repository-relative fixtures', async () => {
    const cases = [
      ['generated.calibrated-particles', 'sample-sem.gsf', 0.42],
      ['generated.touching-particles', 'touching-particles.gsf', 0.5],
      ['generated.periodic-lattice', 'periodic-lattice.gsf', 0.08],
      ['generated.afm-tilted-surface', 'afm-tilted-surface.gsf', 2],
      ['generated.batch-particles', 'batch-particles.gsf', 0.42],
    ] as const
    for (const [sampleId, filename, step] of cases) {
      const host = new ImagingWorkerHost()
      const { source, dataset } = await openGenerated(host, 1, sampleId)
      expect(source.source.name).toBe(filename)
      expect(dataset.dataset.axes).toContainEqual(
        expect.objectContaining({
          id: 'x',
          unit: 'nm',
          coordinates: { type: 'linear', step, origin: 0 },
        }),
      )
      await host.dispose()
    }
  })

  it('refuses unknown generated corpus source IDs', async () => {
    const response = await new ImagingWorkerHost().handle(
      rpcRequest('unknown-sample', 'source.open-sample', {
        generation: 1,
        sampleId: 'generated.unknown',
      }),
    )
    expect(response.response).toMatchObject({
      ok: false,
      error: {
        code: 'SOURCE_OPEN_FAILED',
        message: 'Unknown generated sample: generated.unknown.',
      },
    })
  })

  it('rejects stale IDs, returns structured malformed-message errors, and crashes only on the test hook', async () => {
    const host = new ImagingWorkerHost()
    const { dataset } = await openGenerated(host)
    const stale = await host.handle(
      rpcRequest('stale', 'tile.request', {
        tileId: 'stale',
        datasetHandleId: dataset.handleId,
        generation: 0,
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        resolutionLevel: 0,
        component: 0,
        mapping: { mode: 'linear', range: 'auto' },
        region: { x: 0, y: 0, width: 16, height: 16 },
        priority: 'visible',
      }),
    )
    expect(stale.response).toMatchObject({ ok: false, error: { code: 'STALE_ID' } })
    const malformed = await host.handle({ nonsense: true })
    expect(malformed.response).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } })
    await expect(host.handle(rpcRequest('crash', 'worker.test-crash', null))).rejects.toThrow(
      'Intentional worker crash test',
    )
    await host.dispose()
  })

  it('closes dataset runtime and document handles exactly once', async () => {
    const host = new ImagingWorkerHost()
    const { source, dataset } = await openGenerated(host)
    const datasetClosed = await host.handle(
      rpcRequest('close-dataset', 'dataset.close', {
        handleId: dataset.handleId,
        generation: source.generation,
      }),
    )
    expect(datasetClosed.response).toMatchObject({ ok: true, kind: 'dataset.closed' })
    const sourceClosed = await host.handle(
      rpcRequest('close-source', 'source.close', {
        sourceId: source.sourceId,
        generation: source.generation,
      }),
    )
    expect(sourceClosed.response).toMatchObject({ ok: true, kind: 'source.closed' })
    expect(host.diagnostics().releases).toEqual({
      documents: 1,
      datasets: 1,
      tiles: 0,
      runtimes: 1,
    })
    await host.dispose()
    expect(host.diagnostics().releases).toEqual({
      documents: 1,
      datasets: 1,
      tiles: 0,
      runtimes: 1,
    })
  })

  it('keeps local and HTTP Range tiles identical without fetching the complete source', async () => {
    const width = 1_024
    const height = 1_024
    const values = Float32Array.from({ length: width * height }, (_, index) => index % 997)
    const bytes = encodeGsf({ width, height, values, xyUnit: 'nm', xReal: 512, yReal: 512 })
    const remoteHost = new ImagingWorkerHost({ fetch: rangeFetch(bytes) })
    const openedRemote = await remoteHost.handle(
      rpcRequest('remote-open', 'source.open-remote', {
        generation: 1,
        url: 'https://fixtures.invalid/generated.gsf',
      }),
    )
    const remoteSource = payload(openedRemote.response, 'source.opened') as OpenedSourceDescriptor
    const remoteDatasetResponse = await remoteHost.handle(
      rpcRequest('remote-dataset', 'dataset.open', {
        documentId: remoteSource.documentId as DocumentId,
        datasetId: remoteSource.datasets[0]?.id ?? 'missing',
        generation: 1,
      }),
    )
    const remoteDataset = payload(
      remoteDatasetResponse.response,
      'dataset.opened',
    ) as OpenedDatasetDescriptor
    const remoteTile = await requestTile(remoteHost, remoteDataset)
    const remoteDiagnostics = remoteHost.diagnostics()
    expect(remoteDiagnostics.source?.rangeRequests).toBeGreaterThan(0)
    expect(remoteDiagnostics.source?.rangeBytesFetched).toBeLessThan(bytes.byteLength)

    const localHost = new ImagingWorkerHost()
    const file = new File([bytes.slice().buffer as ArrayBuffer], 'generated.gsf')
    const openedLocal = await localHost.handle(
      rpcRequest('local-open', 'source.open-local', {
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
    const localSource = payload(openedLocal.response, 'source.opened') as OpenedSourceDescriptor
    const localDatasetResponse = await localHost.handle(
      rpcRequest('local-dataset', 'dataset.open', {
        documentId: localSource.documentId,
        datasetId: localSource.datasets[0]?.id ?? 'missing',
        generation: 1,
      }),
    )
    const localDataset = payload(
      localDatasetResponse.response,
      'dataset.opened',
    ) as OpenedDatasetDescriptor
    const localTile = await requestTile(localHost, localDataset)
    expect(Array.from(remoteTile.values)).toEqual(Array.from(localTile.values))
    await remoteHost.dispose()
    await localHost.dispose()
  })

  it('returns CORS/range guidance when a remote server ignores ranges', async () => {
    const host = new ImagingWorkerHost({
      fetch: async () => new Response('whole file', { status: 200 }),
    })
    const result = await host.handle(
      rpcRequest('bad-range', 'source.open-remote', {
        generation: 1,
        url: 'https://fixtures.invalid/no-range.mrc',
      }),
    )
    expect(result.response).toMatchObject({
      ok: false,
      error: { code: 'CORS_OR_RANGE_UNAVAILABLE', guidance: expect.stringContaining('Range') },
    })
  })

  it('cancels an in-flight tile through its explicit request ID', async () => {
    const width = 1_024
    const height = 1_024
    const bytes = encodeGsf({
      width,
      height,
      values: Float32Array.from({ length: width * height }, (_, index) => index),
    })
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const fetcher: typeof fetch = async (_input, init) => {
      const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
      if (match === undefined || match === null) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const end = Math.min(Number(match[2]), bytes.byteLength - 1)
      if (start > 2 * 1_024 * 1_024) {
        markStarted?.()
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
      }
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${bytes.byteLength}` },
      })
    }
    const host = new ImagingWorkerHost({ fetch: fetcher })
    const sourceResult = await host.handle(
      rpcRequest('open-cancellable', 'source.open-remote', {
        generation: 1,
        url: 'https://fixtures.invalid/cancellable.gsf',
      }),
    )
    const source = payload(sourceResult.response, 'source.opened') as OpenedSourceDescriptor
    const datasetResult = await host.handle(
      rpcRequest('open-cancellable-dataset', 'dataset.open', {
        documentId: source.documentId,
        datasetId: source.datasets[0]?.id ?? 'missing',
        generation: 1,
      }),
    )
    const dataset = payload(datasetResult.response, 'dataset.opened') as OpenedDatasetDescriptor
    const tilePromise = host.handle(
      rpcRequest('slow-tile', 'tile.request', {
        tileId: 'slow-tile',
        datasetHandleId: dataset.handleId,
        generation: 1,
        displayAxes: dataset.selection.displayAxes,
        fixedIndices: dataset.selection.fixedIndices,
        resolutionLevel: 0,
        component: 0,
        mapping: { mode: 'linear', range: 'auto' },
        region: { x: 0, y: 800, width: 128, height: 96 },
        priority: 'visible',
      }),
    )
    await started
    const cancelled = await host.handle(
      rpcRequest('cancel-slow-tile', 'request.cancel', { targetRequestId: 'slow-tile' }),
    )
    expect(cancelled.response).toMatchObject({
      ok: true,
      kind: 'request.cancelled',
      payload: { found: true },
    })
    await expect(tilePromise).resolves.toMatchObject({
      response: { ok: false, error: { code: 'ABORTED' } },
    })
    await host.dispose()
  })

  it('executes the calibrated FFT workspace through public extension and Worker contracts', async () => {
    const width = 32
    const height = 32
    const values = Float32Array.from({ length: width * height }, (_value, index) =>
      Math.cos((2 * Math.PI * 4 * (index % width)) / width),
    )
    const host = new ImagingWorkerHost()
    const dataset = await openGeneratedValues(host, width, height, values)
    const roi = {
      schemaVersion: 1,
      id: 'fft-roi',
      axisIds: ['x', 'y'],
      fixedIndices: [],
      coordinateSpace: 'pixel',
      geometry: { kind: 'rectangle', x: 0, y: 0, width, height },
    } as unknown as RpcJsonObject
    const graph = {
      schemaVersion: 1,
      inputs: [
        { name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } },
        { name: 'selection', valueType: { id: roiValueTypeId, version: 1 } },
      ],
      nodes: [
        {
          id: 'fft',
          operation: { id: MATERIALS_OPERATION_IDS.fft2d, version: 1 },
          inputs: [
            { port: 'dataset', source: { kind: 'input', input: 'source' } },
            { port: 'roi', source: { kind: 'input', input: 'selection' } },
          ],
          parameters: {
            displayAxes: ['x', 'y'],
            fixedIndices: [],
            component: 0,
            roiX: 0,
            roiY: 0,
            roiWidth: width,
            roiHeight: height,
            spectrumDisplay: 'raw',
            radialBins: 32,
            azimuthalBins: 36,
            azimuthalMinimumRadius: 0,
            azimuthalMaximumRadius: 2,
            peakThreshold: 400,
            minimumPeakDistance: 2,
            maximumPeaks: 8,
            maskKind: 'bandpass',
            minimumRadius: 0.05,
            maximumRadius: 0.25,
            notchX: 0,
            notchY: 0,
            notchRadius: 0.02,
          },
        },
      ],
      outputs: [
        { name: 'magnitude', source: { kind: 'node', nodeId: 'fft', output: 'magnitude' } },
        { name: 'radialProfile', source: { kind: 'node', nodeId: 'fft', output: 'radialProfile' } },
        { name: 'peaks', source: { kind: 'node', nodeId: 'fft', output: 'peaks' } },
        {
          name: 'frequencySummary',
          source: { kind: 'node', nodeId: 'fft', output: 'frequencySummary' },
        },
      ],
    } as unknown as RpcJsonObject
    const dryRunResponse = await host.handle(
      rpcRequest('fft-plan', 'analysis.dry-run', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        graph,
        roi,
      }),
    )
    expect(payload(dryRunResponse.response, 'analysis.dry-run')).toMatchObject({ valid: true })
    const executedResponse = await host.handle(
      rpcRequest('fft-execute', 'analysis.execute', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        graph,
        roi,
      }),
    )
    const execution = payload(executedResponse.response, 'analysis.executed')
    expect(execution.outputs.map(({ name }) => name)).toEqual([
      'magnitude',
      'radialProfile',
      'peaks',
      'frequencySummary',
    ])
    const peakPageResponse = await host.handle(
      rpcRequest('fft-peaks', 'analysis.table-page', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        resultHandleId: execution.resultHandleId,
        output: 'peaks',
        offset: 0,
        limit: 10,
      }),
    )
    const peaks = payload(peakPageResponse.response, 'analysis.table-page')
    expect(peaks.totalRows).toBe(2)
    expect(peaks.columns.map(({ name }) => name)).toContain('dSpacing')
    const radialResponse = await host.handle(
      rpcRequest('fft-radial', 'analysis.series-export', {
        datasetHandleId: dataset.handleId,
        generation: 1,
        resultHandleId: execution.resultHandleId,
        output: 'radialProfile',
        maxRows: 64,
      }),
    )
    expect(payload(radialResponse.response, 'analysis.series-export')).toMatchObject({
      rowCount: 32,
    })
    await host.dispose()
  })

  it('keeps opaque ID types distinct at compile time', () => {
    const ids: readonly [SourceId, DocumentId, DatasetHandleId] = [
      'source' as SourceId,
      'document' as DocumentId,
      'dataset' as DatasetHandleId,
    ]
    expect(ids).toHaveLength(3)
  })

  it('restarts with a new Worker and reinitializes the protocol', async () => {
    const workers: FakeWorker[] = []
    const client = new ImagingWorkerClient(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker as unknown as Worker
    })
    await client.initialize()
    await client.restart()
    expect(workers).toHaveLength(2)
    expect(workers[0]).toMatchObject({ terminated: true, initialized: 1 })
    expect(workers[1]).toMatchObject({ terminated: false, initialized: 1 })
    client.dispose()
  })
})
