import { scientificDatasetCharacteristics } from 'purejsimage/analysis'
import { normalizeRoi } from 'purejsimage/analysis/roi'
import type { OperationImplementation, OperationJsonObject } from 'purejsimage/operations'
import {
  normalizeScientificDatasetDescriptor,
  numericTileSampleOffset,
  resolveNumericTileSource,
  type ScientificDataset,
} from 'purejsimage/scientific'
import { describe, expect, it } from 'vitest'

import { advancedMaterialsOperationDefinitions } from '../src/advanced-definitions.js'
import { createAdvancedMaterialsProvider } from '../src/advanced-provider.js'
import { MATERIALS_OPERATION_IDS } from '../src/catalog.js'

const width = 16
const height = 16
const frames = 3
const descriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 1,
  sampleType: 'float32',
  axes: [
    {
      id: 'x',
      kind: 'space',
      length: width,
      unit: 'nm',
      coordinates: { type: 'linear', origin: 0, step: 0.5 },
    },
    {
      id: 'y',
      kind: 'space',
      length: height,
      unit: 'nm',
      coordinates: { type: 'linear', origin: 0, step: 0.75 },
    },
    {
      id: 'z',
      kind: 'space',
      length: frames,
      unit: 'nm',
      coordinates: { type: 'linear', origin: 0, step: 2 },
    },
  ],
  components: [{ id: 'height', kind: 'scalar', unit: 'nm' }],
  capabilities: {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'any-axis-pair' },
  },
})

function stackDataset(values: Float32Array): ScientificDataset {
  const numericTileSource = {
    descriptor,
    directSemantics: {
      sourceSampleType: 'float32' as const,
      nativeSampleType: 'float32' as const,
      componentCount: 1,
      layout: 'interleaved' as const,
      supportedTargetSampleTypes: ['float32' as const, 'float64' as const],
    },
    planRead: () => ({
      maximumEmittedTileRetainedBytes: width * height * 8,
      delivery: 'single-exact' as const,
    }),
    async *readNumericTiles(
      request: Readonly<{
        displayAxes: readonly [string, string]
        fixedIndices: readonly Readonly<{ axisId: string; index: number }>[]
        x?: number
        y?: number
        width?: number
        height?: number
        targetSampleType?: 'float32' | 'float64'
        signal?: AbortSignal
      }>,
    ) {
      if (request.displayAxes[0] !== 'x' || request.displayAxes[1] !== 'y')
        throw new Error('Fixture supports x/y reads only.')
      const z = request.fixedIndices.find(({ axisId }) => axisId === 'z')?.index ?? 0
      const x = request.x ?? 0
      const y = request.y ?? 0
      const tileWidth = request.width ?? width
      const tileHeight = request.height ?? height
      const data =
        request.targetSampleType === 'float64'
          ? new Float64Array(tileWidth * tileHeight)
          : new Float32Array(tileWidth * tileHeight)
      for (let localY = 0; localY < tileHeight; localY += 1)
        for (let localX = 0; localX < tileWidth; localX += 1)
          data[localY * tileWidth + localX] =
            values[z * width * height + (y + localY) * width + x + localX] ?? 0
      yield {
        x,
        y,
        width: tileWidth,
        height: tileHeight,
        sampleType: request.targetSampleType ?? 'float32',
        componentCount: 1,
        layout: 'interleaved' as const,
        rowStrideElements: tileWidth,
        data,
        release: () => undefined,
      }
    },
  }
  return {
    descriptor,
    numericTileSource,
    async *readPlane() {
      yield* []
      throw new Error('Fixture expects numeric tile reads.')
    },
  } as ScientificDataset
}

function tiledFftDataset(
  reverse: boolean,
  requests: Array<Readonly<{ x: number; y: number; width: number; height: number }>>,
  releases: { count: number },
): ScientificDataset {
  const values = Float32Array.from({ length: width * height }, (_value, index) => {
    const x = index % width
    const y = Math.floor(index / width)
    return Math.cos((2 * Math.PI * 2 * x) / 8) + Math.sin((2 * Math.PI * y) / 8)
  })
  const numericTileSource = {
    descriptor,
    directSemantics: {
      sourceSampleType: 'float32' as const,
      nativeSampleType: 'float32' as const,
      componentCount: 1,
      layout: 'interleaved' as const,
      supportedTargetSampleTypes: ['float32' as const, 'float64' as const],
    },
    planRead: () => ({
      maximumEmittedTileRetainedBytes: 8 * 8 * 8,
      delivery: 'streamed' as const,
    }),
    async *readNumericTiles(request: Readonly<Record<string, unknown>>) {
      const x = Number(request['x'])
      const y = Number(request['y'])
      const requestedWidth = Number(request['width'])
      const requestedHeight = Number(request['height'])
      requests.push({ x, y, width: requestedWidth, height: requestedHeight })
      const halves = [
        { x, y, width: requestedWidth / 2, height: requestedHeight },
        { x: x + requestedWidth / 2, y, width: requestedWidth / 2, height: requestedHeight },
      ]
      for (const tile of reverse ? halves.reverse() : halves) {
        const data = new Float64Array(tile.width * tile.height)
        for (let localY = 0; localY < tile.height; localY += 1)
          for (let localX = 0; localX < tile.width; localX += 1)
            data[localY * tile.width + localX] =
              values[(tile.y + localY) * width + tile.x + localX] ?? 0
        yield {
          ...tile,
          sampleType: 'float64' as const,
          componentCount: 1,
          layout: 'interleaved' as const,
          rowStrideElements: tile.width,
          data,
          release: () => {
            releases.count += 1
          },
        }
      }
    },
  }
  return {
    descriptor,
    numericTileSource,
    async *readPlane() {
      yield* []
      throw new Error('Fixture expects numeric tile reads.')
    },
  } as ScientificDataset
}

async function datasetValues(dataset: ScientificDataset): Promise<readonly number[]> {
  const values: number[] = []
  const x = dataset.descriptor.axes[0]?.length ?? 0
  const y = dataset.descriptor.axes[1]?.length ?? 0
  for await (const tile of resolveNumericTileSource(dataset).readNumericTiles({
    displayAxes: [dataset.descriptor.axes[0]?.id ?? 'x', dataset.descriptor.axes[1]?.id ?? 'y'],
    fixedIndices: [],
    resolutionLevel: 0,
    x: 0,
    y: 0,
    width: x,
    height: y,
    targetSampleType: 'float64',
  })) {
    values.push(...Array.from(tile.data, Number))
    tile.release()
  }
  return values
}

async function implementation(operationId: string): Promise<OperationImplementation> {
  const prepared = await createAdvancedMaterialsProvider().prepare()
  const found = prepared?.implementations.find(
    ({ descriptor: candidate }) => candidate.operationId === operationId,
  )
  if (found === undefined) throw new Error(`Missing ${operationId} implementation.`)
  return found
}

async function execute(
  operationId: string,
  dataset: ScientificDataset,
  parameters: OperationJsonObject,
  inputs: readonly unknown[] = [dataset],
) {
  const definition = advancedMaterialsOperationDefinitions.find(
    ({ descriptor: candidate }) => candidate.id === operationId,
  )
  if (definition === undefined) throw new Error(`Missing ${operationId} definition.`)
  const selected = await implementation(operationId)
  return selected.execute({
    descriptor: definition.descriptor,
    parameters,
    inputs,
    plannedInputCharacteristics: inputs.map((_input, index) =>
      index === 0 ? scientificDatasetCharacteristics(dataset) : {},
    ),
    provider: { id: 'test', version: 1, kind: 'reference', buildFingerprint: 'test' },
    implementation: selected.descriptor,
    signal: new AbortController().signal,
  })
}

const plane = {
  displayAxes: ['x', 'y'],
  fixedIndices: [{ axisId: 'z', index: 0 }],
  component: 0,
} as const
const stack = { ...plane, stackAxis: 'z', startIndex: 0, endIndex: 2 } as const

describe('advanced materials provider integration', () => {
  it('reads only the admitted FFT ROI, releases every input tile, and is tile-order invariant', async () => {
    const roi = normalizeRoi(
      {
        schemaVersion: 1,
        id: 'fft-roi',
        axisIds: ['x', 'y'],
        fixedIndices: [{ axisId: 'z', index: 0 }],
        coordinateSpace: 'pixel',
        geometry: { kind: 'rectangle', x: 4, y: 4, width: 8, height: 8 },
      },
      descriptor,
    )
    const parameters = {
      ...plane,
      roiX: 4,
      roiY: 4,
      roiWidth: 8,
      roiHeight: 8,
      spectrumDisplay: 'raw',
      radialBins: 8,
      azimuthalBins: 16,
      azimuthalMinimumRadius: 0,
      azimuthalMaximumRadius: 1,
      peakThreshold: 0,
      minimumPeakDistance: 1,
      maximumPeaks: 8,
      maskKind: 'none',
      minimumRadius: 0,
      maximumRadius: 0.5,
      notchX: 0,
      notchY: 0,
      notchRadius: 0.02,
    }
    const firstRequests: Array<Readonly<{ x: number; y: number; width: number; height: number }>> =
      []
    const secondRequests: Array<Readonly<{ x: number; y: number; width: number; height: number }>> =
      []
    const firstReleases = { count: 0 }
    const secondReleases = { count: 0 }
    const firstDataset = tiledFftDataset(false, firstRequests, firstReleases)
    const first = await execute(MATERIALS_OPERATION_IDS.fft2d, firstDataset, parameters, [
      firstDataset,
      roi,
    ])
    const secondDataset = tiledFftDataset(true, secondRequests, secondReleases)
    const second = await execute(MATERIALS_OPERATION_IDS.fft2d, secondDataset, parameters, [
      secondDataset,
      roi,
    ])
    expect(firstRequests).toEqual([{ x: 4, y: 4, width: 8, height: 8 }])
    expect(secondRequests).toEqual(firstRequests)
    expect(firstReleases.count).toBe(2)
    expect(secondReleases.count).toBe(2)
    expect(await datasetValues(first[0]?.value as ScientificDataset)).toEqual(
      await datasetValues(second[0]?.value as ScientificDataset),
    )
    for (const owned of [...first, ...second]) await owned.release()
  })

  it('materializes bounded sum projection and per-frame statistics', async () => {
    const values = Float32Array.from(
      { length: width * height * frames },
      (_value, index) => Math.floor(index / (width * height)) + 1,
    )
    const dataset = stackDataset(values)
    const projected = await execute(MATERIALS_OPERATION_IDS.stackSumProjection, dataset, stack)
    const output = projected[0]?.value as ScientificDataset
    for await (const tile of resolveNumericTileSource(output).readNumericTiles({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      resolutionLevel: 0,
      x: 0,
      y: 0,
      width,
      height,
      targetSampleType: 'float32',
    })) {
      expect(Number(tile.data[numericTileSampleOffset(tile, 4, 5, 0)])).toBe(6)
      tile.release()
    }
    const statistics = await execute(MATERIALS_OPERATION_IDS.stackStatistics, dataset, stack)
    expect(statistics[0]?.value).toMatchObject({ kind: 'table', rowCount: 3 })
    for (const owned of [...projected, ...statistics]) await owned.release()
  })

  it('aligns translated frames and returns explicit drift tolerance rows', async () => {
    const reference = new Float32Array(width * height)
    for (let y = 4; y < 10; y += 1)
      for (let x = 3; x < 9; x += 1) reference[y * width + x] = 1 + ((x + y) % 4)
    const values = new Float32Array(width * height * frames)
    values.set(reference)
    for (let frame = 1; frame < frames; frame += 1)
      for (let y = 0; y < height; y += 1)
        for (let x = 0; x < width; x += 1)
          values[frame * width * height + y * width + x] =
            reference[
              ((y - frame + height) % height) * width + ((x - 2 * frame + width) % width)
            ] ?? 0
    const result = await execute(MATERIALS_OPERATION_IDS.stackAlignment, stackDataset(values), {
      ...stack,
      referenceIndex: 0,
      maximumShift: 4,
      minimumPeakRatio: 1.2,
      edgePolicy: 'crop-overlap',
      fillValue: 0,
    })
    const aligned = result[0]?.value
    if (aligned === undefined) throw new Error('Aligned dataset is unavailable.')
    expect((aligned as ScientificDataset).descriptor.axes.map(({ length }) => length)).toEqual([
      8, 8, 3,
    ])
    expect(result[1]?.value).toMatchObject({ kind: 'table', rowCount: 3 })
    for (const owned of result) await owned.release()
  })

  it('preserves raw height values while fitting and analyzing an admitted AFM surface', async () => {
    const values = Float32Array.from({ length: width * height * frames }, (_value, index) => {
      const local = index % (width * height)
      return 10 + 0.5 * (local % width) - 0.25 * Math.floor(local / width)
    })
    const original = values.slice()
    const dataset = stackDataset(values)
    const roi = normalizeRoi(
      {
        schemaVersion: 1,
        id: 'surface',
        axisIds: ['x', 'y'],
        fixedIndices: [{ axisId: 'z', index: 0 }],
        coordinateSpace: 'pixel',
        geometry: { kind: 'rectangle', x: 0, y: 0, width, height },
      },
      descriptor,
    )
    const corrected = await execute(
      MATERIALS_OPERATION_IDS.surfaceCorrect,
      dataset,
      {
        ...plane,
        correction: 'first-order-plane',
        polynomialDegree: 1,
      },
      [dataset, roi],
    )
    expect(values).toEqual(original)
    const output = corrected[0]?.value as ScientificDataset
    const analyzed = await execute(
      MATERIALS_OPERATION_IDS.surfaceAnalyze,
      output,
      {
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        component: 0,
        histogramBins: 32,
        profileX0: 0,
        profileY0: 0,
        profileX1: 15,
        profileY1: 15,
        profileSamples: 16,
        grainMethod: 'otsu',
        grainPolarity: 'light',
        grainLower: 0,
        grainUpper: 1,
      },
      [output, normalizeRoi({ ...roi, fixedIndices: [] }, output.descriptor)],
    )
    expect(analyzed[0]?.value).toMatchObject({ kind: 'histogram' })
    expect(analyzed[1]?.value).toMatchObject({ kind: 'collection' })
    expect(analyzed[2]?.value).toMatchObject({ kind: 'profile' })
    expect(analyzed[3]?.value).toMatchObject({ descriptor: expect.any(Object) })
    for (const owned of [...analyzed, ...corrected]) await owned.release()
  })
})
