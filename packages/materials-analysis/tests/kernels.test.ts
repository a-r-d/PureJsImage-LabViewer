import { scientificDatasetCharacteristics } from 'purejsimage/analysis'
import {
  normalizeScientificDatasetDescriptor,
  resolveNumericTileSource,
  type ScientificDataset,
} from 'purejsimage/scientific'
import { describe, expect, it } from 'vitest'

import { MATERIALS_OPERATION_IDS } from '../src/catalog.js'
import { materialsOperationDefinitions } from '../src/definitions.js'
import { createDenseScientificDataset } from '../src/dense-dataset.js'
import {
  boxFilterPlane,
  calculatePlanes,
  convolvePlane,
  flipPlane,
  mapPlane,
  multiscaleContrastPlane,
  outlierPlane,
  rotateRightAngle,
  translatePlane,
} from '../src/kernels.js'
import { createMaterialsAnalysisProvider } from '../src/provider.js'

const plane = (width: number, height: number, values: readonly number[]) => ({
  width,
  height,
  components: 1,
  values: Float64Array.from(values),
})

describe('materials reference kernels', () => {
  it('propagates directional calibration through rotation and flip descriptors', () => {
    const descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      sampleType: 'float32',
      axes: [
        {
          id: 'x',
          kind: 'space',
          length: 3,
          unit: 'nm',
          coordinates: { type: 'linear', origin: 10, step: 2 },
        },
        {
          id: 'y',
          kind: 'space',
          length: 2,
          unit: 'µm',
          coordinates: { type: 'lookup', values: [100, 200] },
        },
      ],
      components: [{ id: 'value', kind: 'intensity' }],
      levels: [
        {
          level: 0,
          axisLengths: [
            { axisId: 'x', length: 3 },
            { axisId: 'y', length: 2 },
          ],
        },
      ],
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'any-axis-pair' },
      },
    })
    const infer = (operationId: string, parameters: Readonly<Record<string, unknown>>) => {
      const definition = materialsOperationDefinitions.find(
        ({ descriptor: operation }) => operation.id === operationId,
      )
      const result = definition?.inferOutputShapes?.({
        parameters,
        inputs: [scientificDatasetCharacteristics(descriptor)],
      })
      const characteristics = result?.value?.[0]
      if (
        !result?.valid ||
        typeof characteristics !== 'object' ||
        characteristics === null ||
        Array.isArray(characteristics) ||
        !('descriptor' in characteristics)
      )
        throw new Error(`Output descriptor inference failed: ${JSON.stringify(result)}`)
      return normalizeScientificDatasetDescriptor(characteristics.descriptor)
    }
    const rotated = infer(MATERIALS_OPERATION_IDS.rotateRightAngle, {
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      degrees: 90,
    })
    expect(rotated.axes[0]).toMatchObject({
      id: 'x',
      length: 2,
      unit: 'µm',
      coordinates: { type: 'lookup', values: [200, 100] },
    })
    expect(rotated.axes[1]).toMatchObject({
      id: 'y',
      length: 3,
      unit: 'nm',
      coordinates: { type: 'linear', origin: 10, step: 2 },
    })
    const flipped = infer(MATERIALS_OPERATION_IDS.flip, {
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      direction: 'vertical',
    })
    expect(flipped.axes[1]?.coordinates).toEqual({ type: 'lookup', values: [200, 100] })
  })

  it('performs exact right-angle transforms without changing values', () => {
    const source = plane(3, 2, [1, 2, 3, 4, 5, 6])
    expect([...rotateRightAngle(source, 90).values]).toEqual([4, 1, 5, 2, 6, 3])
    expect([...rotateRightAngle(source, 180).values]).toEqual([6, 5, 4, 3, 2, 1])
    expect([...rotateRightAngle(source, 270).values]).toEqual([3, 6, 2, 5, 1, 4])
    expect([...flipPlane(source, 'horizontal').values]).toEqual([3, 2, 1, 6, 5, 4])
    expect([...flipPlane(source, 'vertical').values]).toEqual([4, 5, 6, 1, 2, 3])
  })

  it('uses explicit translation fill and leaves source immutable', () => {
    const source = plane(3, 2, [1, 2, 3, 4, 5, 6])
    expect([...translatePlane(source, 1, -1, -9).values]).toEqual([-9, 4, 5, -9, -9, -9])
    expect([...source.values]).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('applies normalized box and arbitrary convolution boundary policies', () => {
    const source = plane(3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9])
    const common = {
      boundary: 'clamp' as const,
      constantValue: 0,
      invalidPolicy: 'propagate' as const,
    }
    expect(boxFilterPlane(source, 1, common).values[4]).toBe(5)
    const identity = convolvePlane(source, [0, 0, 0, 0, 1, 0, 0, 0, 0], 3, common)
    expect([...identity.values]).toEqual([...source.values])
  })

  it('propagates invalid samples unless ignore is explicit', () => {
    const source = { ...plane(3, 3, [1, 2, 3, 4, -999, 6, 7, 8, 9]), noDataValue: -999 }
    const propagated = boxFilterPlane(source, 1, {
      boundary: 'clamp',
      constantValue: 0,
      invalidPolicy: 'propagate',
    })
    expect(Number.isNaN(propagated.values[4])).toBe(true)
    const ignored = boxFilterPlane(source, 1, {
      boundary: 'clamp',
      constantValue: 0,
      invalidPolicy: 'ignore',
    })
    expect(ignored.values[4]).toBeCloseTo(5, 12)
  })

  it('keeps the sliding box filter differential-exact across boundaries and invalid policies', () => {
    const source = {
      width: 4,
      height: 3,
      components: 2,
      values: Float64Array.from({ length: 24 }, (_value, index) =>
        index === 7 ? -999 : ((index * 17) % 23) - 11,
      ),
      noDataValue: -999,
    }
    const boundaryCases = [
      { boundary: 'clamp' as const, constantValue: 0 },
      { boundary: 'mirror' as const, constantValue: 0 },
      { boundary: 'constant' as const, constantValue: -3 },
      { boundary: 'constant' as const, constantValue: Number.NaN },
    ]
    for (const boundaryCase of boundaryCases)
      for (const invalidPolicy of ['ignore', 'propagate'] as const) {
        for (const radius of [1, 2, 4]) {
          const options = { ...boundaryCase, invalidPolicy }
          const width = radius * 2 + 1
          const expected = convolvePlane(
            source,
            Array.from({ length: width * width }, () => 1 / (width * width)),
            width,
            options,
          )
          const actual = boxFilterPlane(source, radius, options)
          for (let index = 0; index < expected.values.length; index += 1) {
            const reference = expected.values[index] ?? Number.NaN
            const value = actual.values[index] ?? Number.NaN
            const context = `${boundaryCase.boundary}/${boundaryCase.constantValue}/${invalidPolicy}/${radius}/${index}`
            if (Number.isNaN(reference)) expect(Number.isNaN(value), context).toBe(true)
            else expect(value, context).toBeCloseTo(reference, 12)
          }
        }
      }
  })

  it('despeckles only values beyond the requested threshold', () => {
    const source = plane(3, 3, [1, 1, 1, 1, 100, 1, 1, 1, 1])
    expect(outlierPlane(source, 1, 10).values[4]).toBe(1)
    expect(outlierPlane(source, 1, 200).values[4]).toBe(100)
  })

  it('computes explicit signed and absolute multiscale local contrast', () => {
    const source = plane(
      7,
      7,
      Array.from({ length: 49 }, (_value, index) => (index === 24 ? 9 : 1)),
    )
    const light = multiscaleContrastPlane(source, 1, 2, 'light', 'propagate')
    const dark = multiscaleContrastPlane(source, 1, 2, 'dark', 'propagate')
    const absolute = multiscaleContrastPlane(source, 1, 2, 'absolute', 'propagate')
    expect(light.values[24]).toBeGreaterThan(0)
    expect(dark.values[24]).toBe(0)
    expect(absolute.values[24]).toBe(light.values[24])
    expect(() => multiscaleContrastPlane(source, 2, 2, 'absolute', 'propagate')).toThrow(
      'outer radius must be greater',
    )
  })

  it('executes multiscale contrast through the bounded provider with a conservative plan', async () => {
    const descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      sampleType: 'float32',
      axes: [
        { id: 'x', kind: 'space', length: 7, coordinates: { type: 'index' } },
        { id: 'y', kind: 'space', length: 7, coordinates: { type: 'index' } },
      ],
      components: [{ id: 'value', kind: 'intensity' }],
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'any-axis-pair' },
      },
    })
    const source = createDenseScientificDataset(
      descriptor,
      Float32Array.from({ length: 49 }, (_value, index) => (index === 24 ? 9 : 1)),
    )
    const definition = materialsOperationDefinitions.find(
      ({ descriptor: candidate }) => candidate.id === MATERIALS_OPERATION_IDS.multiscaleContrast,
    )
    const prepared = await createMaterialsAnalysisProvider().prepare()
    const implementation = prepared?.implementations.find(
      ({ descriptor: candidate }) =>
        candidate.operationId === MATERIALS_OPERATION_IDS.multiscaleContrast,
    )
    if (definition === undefined || implementation === undefined)
      throw new Error('Multiscale-contrast provider is unavailable.')
    const parameters = {
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      innerRadius: 1,
      outerRadius: 2,
      polarity: 'light',
      invalidPolicy: 'ignore',
    }
    const request = {
      descriptor: definition.descriptor,
      parameters,
      inputs: [source.dataset],
      inputCharacteristics: [scientificDatasetCharacteristics(descriptor)],
      plannedInputCharacteristics: [scientificDatasetCharacteristics(descriptor)],
      provider: { id: 'test', version: 1, kind: 'reference' as const, buildFingerprint: 'test' },
      implementation: implementation.descriptor,
      signal: new AbortController().signal,
    }
    expect(implementation.estimatePlan(request).peakWorkingBytes).toBe(384 * 384 * 48)
    const owned = await implementation.execute(request)
    const output = owned[0]?.value as ScientificDataset | undefined
    if (output === undefined) throw new Error('Multiscale-contrast output is unavailable.')
    const tiles = resolveNumericTileSource(output).readNumericTiles({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      resolutionLevel: 0,
      x: 0,
      y: 0,
      width: 7,
      height: 7,
      targetSampleType: 'float32',
    })
    for await (const tile of tiles) {
      expect(Number(tile.data[24])).toBeGreaterThan(0)
      tile.release()
    }
    for (const value of owned) await value.release()
    source.release()
  })

  it('cancels deterministic loops and guards image division by zero', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => mapPlane(plane(1, 1, [1]), (value) => value, controller.signal)).toThrow()
    const calculated = calculatePlanes(plane(2, 1, [4, 8]), plane(2, 1, [2, 0]), 'divide')
    expect(calculated.values[0]).toBe(2)
    expect(Number.isNaN(calculated.values[1])).toBe(true)
  })
})
