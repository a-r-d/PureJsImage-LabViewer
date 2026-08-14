import { scientificDatasetCharacteristics } from 'purejsimage/analysis'
import { normalizeScientificDatasetDescriptor } from 'purejsimage/scientific'
import { describe, expect, it } from 'vitest'

import { MATERIALS_OPERATION_IDS } from '../src/catalog.js'
import { materialsOperationDefinitions } from '../src/definitions.js'
import {
  boxFilterPlane,
  calculatePlanes,
  convolvePlane,
  flipPlane,
  mapPlane,
  outlierPlane,
  rotateRightAngle,
  translatePlane,
} from '../src/kernels.js'

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

  it('despeckles only values beyond the requested threshold', () => {
    const source = plane(3, 3, [1, 1, 1, 1, 100, 1, 1, 1, 1])
    expect(outlierPlane(source, 1, 10).values[4]).toBe(1)
    expect(outlierPlane(source, 1, 200).values[4]).toBe(100)
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
