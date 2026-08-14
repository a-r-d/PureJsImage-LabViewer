import { scientificDatasetCharacteristics } from 'purejsimage/analysis'
import { normalizeRoi } from 'purejsimage/analysis/roi'
import type { OperationImplementation } from 'purejsimage/operations'
import {
  normalizeScientificDatasetDescriptor,
  numericTileSampleOffset,
  resolveNumericTileSource,
  type ScientificDataset,
} from 'purejsimage/scientific'
import { describe, expect, it } from 'vitest'

import { MATERIALS_OPERATION_IDS } from '../src/catalog.js'
import { segmentationOperationDefinitions } from '../src/segmentation-definitions.js'
import { createSegmentationAnalysisProvider } from '../src/segmentation-provider.js'

const descriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 1,
  sampleType: 'float32',
  axes: [
    { id: 'x', kind: 'space', length: 6, coordinates: { type: 'index' } },
    { id: 'y', kind: 'space', length: 4, coordinates: { type: 'index' } },
  ],
  components: [{ id: 'value', kind: 'intensity' }],
  levels: [
    {
      level: 0,
      axisLengths: [
        { axisId: 'x', length: 6 },
        { axisId: 'y', length: 4 },
      ],
    },
  ],
  capabilities: {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'any-axis-pair' },
  },
})

function tiledDataset(values: Float32Array, reverse: boolean) {
  let releases = 0
  const regions = [
    { x: 0, y: 0, width: 3, height: 2 },
    { x: 3, y: 0, width: 3, height: 2 },
    { x: 0, y: 2, width: 3, height: 2 },
    { x: 3, y: 2, width: 3, height: 2 },
  ]
  if (reverse) regions.reverse()
  const numericTileSource = {
    descriptor,
    directSemantics: {
      sourceSampleType: 'float32' as const,
      nativeSampleType: 'float32' as const,
      componentCount: 1,
      layout: 'interleaved' as const,
      supportedTargetSampleTypes: ['float32' as const, 'float64' as const],
    },
    planRead: () => ({ maximumEmittedTileRetainedBytes: 3 * 2 * 4, delivery: 'covering' as const }),
    async *readNumericTiles(request: { readonly targetSampleType?: 'float32' | 'float64' }) {
      for (const region of regions) {
        const sampleType = request.targetSampleType ?? 'float32'
        const data =
          sampleType === 'float64'
            ? new Float64Array(region.width * region.height)
            : new Float32Array(region.width * region.height)
        for (let y = 0; y < region.height; y += 1)
          for (let x = 0; x < region.width; x += 1)
            data[y * region.width + x] = values[(region.y + y) * 6 + region.x + x] ?? 0
        yield {
          ...region,
          sampleType,
          componentCount: 1,
          layout: 'interleaved' as const,
          rowStrideElements: region.width,
          data,
          release: () => {
            releases += 1
          },
        }
      }
    },
  }
  const dataset = {
    descriptor,
    numericTileSource,
    async *readPlane() {
      yield* []
      throw new Error('The public numeric tile source should be preferred.')
    },
  } as ScientificDataset
  return { dataset, releases: () => releases }
}

async function executeThreshold(
  implementation: OperationImplementation,
  source: ScientificDataset,
): Promise<Float32Array> {
  const definition = segmentationOperationDefinitions.find(
    ({ descriptor: candidate }) => candidate.id === MATERIALS_OPERATION_IDS.thresholdReference,
  )
  if (definition === undefined) throw new Error('Threshold definition is unavailable.')
  const roi = normalizeRoi(
    {
      schemaVersion: 1,
      id: 'whole',
      axisIds: ['x', 'y'],
      fixedIndices: [],
      coordinateSpace: 'pixel',
      geometry: { kind: 'rectangle', x: 0, y: 0, width: 6, height: 4 },
    },
    descriptor,
  )
  const owned = await implementation.execute({
    descriptor: definition.descriptor,
    parameters: {
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      component: 0,
      method: 'otsu',
      polarity: 'light',
      lower: 0,
      upper: 255,
      histogramBins: 16,
      windowRadius: 2,
      sauvolaK: 0.2,
      dynamicRange: 128,
      noDataPolicy: 'background',
    },
    inputs: [source, roi],
    plannedInputCharacteristics: [scientificDatasetCharacteristics(descriptor), {}],
    provider: {
      id: 'test-provider',
      version: 1,
      kind: 'reference',
      buildFingerprint: 'test',
    },
    implementation: implementation.descriptor,
    signal: new AbortController().signal,
  })
  const output = owned[0]?.value as ScientificDataset | undefined
  if (output === undefined) throw new Error('Threshold output is unavailable.')
  const result = new Float32Array(24)
  for await (const tile of resolveNumericTileSource(output).readNumericTiles({
    displayAxes: ['x', 'y'],
    fixedIndices: [],
    resolutionLevel: 0,
    x: 0,
    y: 0,
    width: 6,
    height: 4,
    targetSampleType: 'float32',
  })) {
    for (let y = 0; y < tile.height; y += 1)
      for (let x = 0; x < tile.width; x += 1)
        result[(tile.y + y) * 6 + tile.x + x] = Number(
          tile.data[numericTileSampleOffset(tile, x, y, 0)] ?? 0,
        )
    tile.release()
  }
  for (const value of owned) await value.release()
  return result
}

describe('segmentation provider tile invariance', () => {
  it('is invariant to concurrent source tile order and releases every source tile exactly once', async () => {
    const prepared = await createSegmentationAnalysisProvider().prepare()
    const implementation = prepared?.implementations.find(
      ({ descriptor: candidate }) =>
        candidate.operationId === MATERIALS_OPERATION_IDS.thresholdReference,
    )
    if (implementation === undefined) throw new Error('Threshold implementation is unavailable.')
    const values = Float32Array.from({ length: 24 }, (_value, index) =>
      index % 6 < 3 ? 10 + index * 0.01 : 100 + index * 0.01,
    )
    const forward = tiledDataset(values, false)
    const reverse = tiledDataset(values, true)
    const [forwardResult, reverseResult] = await Promise.all([
      executeThreshold(implementation, forward.dataset),
      executeThreshold(implementation, reverse.dataset),
    ])
    expect(forwardResult).toEqual(reverseResult)
    expect(forward.releases()).toBe(4)
    expect(reverse.releases()).toBe(4)
  })

  it('retains included labels in the materialized particle output', async () => {
    const prepared = await createSegmentationAnalysisProvider().prepare()
    const implementation = prepared?.implementations.find(
      ({ descriptor: candidate }) =>
        candidate.operationId === MATERIALS_OPERATION_IDS.particleAnalysis,
    )
    const definition = segmentationOperationDefinitions.find(
      ({ descriptor: candidate }) => candidate.id === MATERIALS_OPERATION_IDS.particleAnalysis,
    )
    if (implementation === undefined || definition === undefined)
      throw new Error('Particle implementation is unavailable.')
    const labels = tiledDataset(
      Float32Array.of(0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0),
      false,
    )
    const source = tiledDataset(
      Float32Array.from({ length: 24 }, () => 10),
      false,
    )
    const roi = normalizeRoi(
      {
        schemaVersion: 1,
        id: 'whole',
        axisIds: ['x', 'y'],
        fixedIndices: [],
        coordinateSpace: 'pixel',
        geometry: { kind: 'rectangle', x: 0, y: 0, width: 6, height: 4 },
      },
      descriptor,
    )
    const owned = await implementation.execute({
      descriptor: definition.descriptor,
      parameters: {
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        component: 0,
        sourceComponent: 0,
        edgePolicy: 'exclude',
        minimumArea: 0,
        maximumArea: 100,
        minimumCircularity: 0,
        maximumCircularity: 1,
        minimumAspectRatio: 1,
        maximumAspectRatio: 100,
        minimumSolidity: 0,
        maximumSolidity: 1,
      },
      inputs: [labels.dataset, source.dataset, roi],
      plannedInputCharacteristics: [
        scientificDatasetCharacteristics(descriptor),
        scientificDatasetCharacteristics(descriptor),
        {},
      ],
      provider: {
        id: 'test-provider',
        version: 1,
        kind: 'reference',
        buildFingerprint: 'test',
      },
      implementation: implementation.descriptor,
      signal: new AbortController().signal,
    })
    const output = owned[0]?.value as ScientificDataset | undefined
    if (output === undefined) throw new Error('Particle output is unavailable.')
    const result = new Float32Array(24)
    for await (const tile of resolveNumericTileSource(output).readNumericTiles({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      resolutionLevel: 0,
      x: 0,
      y: 0,
      width: 6,
      height: 4,
      targetSampleType: 'float32',
    })) {
      for (let y = 0; y < tile.height; y += 1)
        for (let x = 0; x < tile.width; x += 1)
          result[(tile.y + y) * 6 + tile.x + x] = Number(
            tile.data[numericTileSampleOffset(tile, x, y, 0)] ?? 0,
          )
      tile.release()
    }
    expect([...result]).toContain(1)
    for (const value of owned) await value.release()
  })
})
