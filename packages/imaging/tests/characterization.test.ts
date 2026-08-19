import { readFile } from 'node:fs/promises'
import type {
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  RpcJsonObject,
  WorkerResponse,
} from '@pji-workbench/contracts'
import { rpcRequest } from '@pji-workbench/contracts'
import {
  MATERIALS_OPERATION_IDS,
  TOOLBOX_DOCUMENTATION,
  TOOLBOX_PRESETS,
} from '@pji-workbench/materials-analysis'
import { enabledExampleScenarios, resolveExampleFixture } from '@pji-workbench/test-corpus'
import { encodeGsf } from 'purejsimage/scientific/readers/gsf'
import { describe, expect, it } from 'vitest'

import {
  ImagingWorkerHost,
  PUREJSIMAGE_PACKAGE_VERSION,
  SUPPORTED_FILE_ACCEPT,
  SUPPORTED_READERS,
} from '../src/index.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableJson(item))
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJson(item)]),
    )
  }
  return value
}

function payload<Kind extends Extract<WorkerResponse, { ok: true }>['kind']>(
  response: WorkerResponse,
  kind: Kind,
): Extract<WorkerResponse, { kind: Kind }>['payload'] {
  if (!response.ok) throw new Error(response.error.message)
  expect(response.kind).toBe(kind)
  return response.payload as Extract<WorkerResponse, { kind: Kind }>['payload']
}

function operationIdentities(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!isRecord(entry) || typeof entry['id'] !== 'string') return undefined
      const version = entry['version']
      const title = entry['title'] ?? entry['name']
      return {
        id: entry['id'],
        ...(typeof version === 'number' ? { version } : {}),
        ...(typeof title === 'string' ? { title } : {}),
      }
    })
    .filter(
      (
        entry,
      ): entry is {
        readonly id: string
        readonly version?: number
        readonly title?: string
      } => entry !== undefined,
    )
    .sort((left, right) => left.id.localeCompare(right.id))
}

async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`./fixtures/characterization/${name}`, import.meta.url), 'utf8'),
  ) as unknown
}

async function openGeneratedValues(host: ImagingWorkerHost, values: Float32Array) {
  const width = 3
  const height = 2
  const bytes = encodeGsf({
    width,
    height,
    values,
    xyUnit: 'nm',
    xReal: width * 0.5,
    yReal: height * 0.75,
  })
  const file = new File([bytes.slice().buffer as ArrayBuffer], 'characterization.gsf')
  const opened = await host.handle(
    rpcRequest('local-open', 'source.open-local', {
      generation: 1,
      primaryId: 'file-0',
      files: [
        {
          id: 'file-0',
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: 0,
          blob: file,
        },
      ],
    }),
  )
  const source = payload(opened.response, 'source.opened') as OpenedSourceDescriptor
  const datasetResponse = await host.handle(
    rpcRequest('dataset-open', 'dataset.open', {
      documentId: source.documentId,
      datasetId: source.datasets[0]?.id ?? 'missing',
      generation: 1,
    }),
  )
  const dataset = payload(datasetResponse.response, 'dataset.opened') as OpenedDatasetDescriptor
  return { source, dataset }
}

describe('science imaging characterization', () => {
  it('keeps the reviewed reader registry', async () => {
    const fixture = await readFixture('science-reader-registry.json')
    expect(
      stableJson({
        schemaVersion: 1,
        application: 'science-workbench',
        pureJsImagePackageVersion: PUREJSIMAGE_PACKAGE_VERSION,
        accept: SUPPORTED_FILE_ACCEPT,
        readers: SUPPORTED_READERS,
      }),
    ).toEqual(fixture)
    const initialized = await new ImagingWorkerHost().handle(
      rpcRequest('initialize', 'worker.initialize', null),
    )
    expect(payload(initialized.response, 'worker.initialize')).toMatchObject({
      readers: SUPPORTED_READERS,
    })
  })

  it('keeps the reviewed analysis catalog identities', async () => {
    const fixture = await readFixture('science-analysis-operations.json')
    const host = new ImagingWorkerHost()
    const opened = await host.handle(
      rpcRequest('sample-open', 'source.open-sample', { generation: 1 }),
    )
    const source = payload(opened.response, 'source.opened') as OpenedSourceDescriptor
    const datasetResponse = await host.handle(
      rpcRequest('dataset-open', 'dataset.open', {
        documentId: source.documentId,
        datasetId: source.datasets[0]?.id ?? 'missing',
        generation: 1,
      }),
    )
    const dataset = payload(datasetResponse.response, 'dataset.opened') as OpenedDatasetDescriptor
    const catalog = await host.handle(
      rpcRequest('analysis-catalog', 'analysis.catalog', {
        datasetHandleId: dataset.handleId,
        generation: 1,
      }),
    )
    const capabilities = payload(catalog.response, 'analysis.catalog').capabilities
    expect(
      stableJson({
        schemaVersion: 1,
        application: 'science-workbench',
        operations: operationIdentities(capabilities['operationDescriptors']),
        documentationOperationIds: TOOLBOX_DOCUMENTATION.map(({ operationId }) => operationId),
        presetIds: TOOLBOX_PRESETS.map(({ id }) => id),
        materialsOperationIds: Object.values(MATERIALS_OPERATION_IDS),
        enabledBundledExampleIds: enabledExampleScenarios()
          .filter(({ source: exampleSource }) => exampleSource.kind === 'bundled')
          .map(({ id }) => id),
        enabledExampleIds: enabledExampleScenarios().map(({ id }) => id),
      }),
    ).toEqual(fixture)
    await host.dispose()
  })

  it('opens a local scientific source through the Worker', async () => {
    const host = new ImagingWorkerHost()
    const { source, dataset } = await openGeneratedValues(
      host,
      Float32Array.from([1, 2, 3, 4, 5, 6]),
    )
    expect(source.source.kind).toBe('local')
    expect(source.source.name).toBe('characterization.gsf')
    expect(source.reader.id).toBe('purejsimage/gsf')
    expect(dataset.dataset.axes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'x', length: 3, unit: 'nm' }),
        expect.objectContaining({ id: 'y', length: 2, unit: 'nm' }),
      ]),
    )
    await host.dispose()
  })

  it('opens a bundled real-data example through the Worker', async () => {
    const resolution = resolveExampleFixture('cdc.ecoli-sem')
    expect(resolution.locator.kind).toBe('bundled')
    if (resolution.locator.kind !== 'bundled') return
    const bytes = await readFile(
      new URL(`../../../apps/science/public/${resolution.locator.path}`, import.meta.url),
    )
    const host = new ImagingWorkerHost({
      baseUrl: 'https://workbench.invalid/',
      fetch: async () => new Response(bytes),
    })
    const opened = await host.handle(
      rpcRequest('bundled-open', 'source.open-bundled', {
        generation: 1,
        path: resolution.locator.path,
        name: resolution.locator.name,
        size: resolution.locator.size,
        sha256: resolution.locator.sha256,
        mediaType: resolution.locator.mediaType,
      }),
    )
    const bundled = payload(opened.response, 'source-bundled.opened')
    expect(bundled.source.source).toMatchObject({
      kind: 'bundled',
      name: 'e-coli-sem.gsf',
      size: resolution.locator.size,
    })
    expect(bundled.source.reader.id).toBe('purejsimage/gsf')
    expect(bundled.dataset.dataset.axes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'x', length: 700 }),
        expect.objectContaining({ id: 'y', length: 475 }),
      ]),
    )
    await host.dispose()
  })

  it('executes a trusted analysis graph through the Worker', async () => {
    const host = new ImagingWorkerHost()
    const { dataset } = await openGeneratedValues(host, Float32Array.from([1, 2, 3, 4, 5, 6]))
    const graph: RpcJsonObject = {
      schemaVersion: 1,
      inputs: [{ name: 'source', valueType: { id: 'purejsimage.scientific.dataset', version: 1 } }],
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
      rpcRequest('analysis-execute', 'analysis.execute', {
        datasetHandleId: dataset.handleId,
        generation: dataset.generation,
        graph,
      }),
    )
    const execution = payload(executeResult.response, 'analysis.executed')
    expect(execution.outputs[0]?.kind).toBe('dataset')
    const tileResult = await host.handle(
      rpcRequest('analysis-tile', 'analysis.dataset-tile', {
        datasetHandleId: dataset.handleId,
        generation: dataset.generation,
        resultHandleId: execution.resultHandleId,
        output: 'dataset',
        tileId: 'characterization-preview',
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
    await host.dispose()
  })
})
