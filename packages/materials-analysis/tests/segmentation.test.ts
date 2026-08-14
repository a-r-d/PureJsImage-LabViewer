import { scientificDatasetCharacteristics } from 'purejsimage/analysis'
import { normalizeScientificDatasetDescriptor } from 'purejsimage/scientific'
import { describe, expect, it } from 'vitest'

import { MATERIALS_OPERATION_IDS } from '../src/catalog.js'
import type { DensePlane } from '../src/kernels.js'
import {
  applyThreshold,
  binaryMorphology,
  euclideanDistanceTransform,
  referenceThreshold,
  thresholdHistogram,
  watershedSeparate,
} from '../src/segmentation.js'
import { segmentationOperationDefinitions } from '../src/segmentation-definitions.js'
import { createSegmentationAnalysisProvider } from '../src/segmentation-provider.js'

function plane(width: number, height: number, values: readonly number[]): DensePlane {
  return { width, height, components: 1, values: Float64Array.from(values) }
}

function componentCount(mask: Uint8Array, width: number, height: number): number {
  const visited = new Uint8Array(mask.length)
  const queue = new Uint32Array(mask.length)
  let count = 0
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || visited[start] !== 0) continue
    count += 1
    let head = 0
    let tail = 1
    queue[0] = start
    visited[start] = 1
    while (head < tail) {
      const index = queue[head] ?? 0
      head += 1
      const x = index % width
      const y = Math.floor(index / width)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const next = ny * width + nx
        if (mask[next] === 0 || visited[next] !== 0) continue
        visited[next] = 1
        queue[tail] = next
        tail += 1
      }
    }
  }
  return count
}

describe('reference threshold methods', () => {
  const fixture = plane(8, 1, [0, 0, 1, 2, 10, 11, 12, 12])

  it('returns deterministic reference thresholds for global methods', () => {
    const histogram = thresholdHistogram(fixture, 0, 16)
    const values = Float64Array.from(fixture.values)
    expect(referenceThreshold('otsu', histogram, values)).toBeCloseTo(2.25, 8)
    expect(referenceThreshold('triangle', histogram, values)).toBeCloseTo(2.625, 8)
    expect(referenceThreshold('yen', histogram, values)).toBeCloseTo(2.25, 8)
    expect(referenceThreshold('li', histogram, values)).toBeCloseTo(4.3959325949, 8)
    expect(referenceThreshold('mean', histogram, values)).toBeCloseTo(6, 1)
  })

  it('supports manual bounds, polarity, ROI, no-data, and foreground fraction', () => {
    const selected = Uint8Array.of(0, 1, 1, 1, 1, 1, 1, 0)
    const result = applyThreshold(
      fixture,
      0,
      {
        method: 'manual',
        polarity: 'light',
        lower: 10,
        upper: 11,
        histogramBins: 16,
        windowRadius: 1,
        sauvolaK: 0.2,
        dynamicRange: 128,
        noDataPolicy: 'background',
      },
      selected,
    )
    expect([...result.mask]).toEqual([0, 0, 0, 0, 1, 1, 0, 0])
    expect(result.foregroundCount / result.selectedCount).toBeCloseTo(1 / 3)
  })

  it('adapts to an uneven background with bounded Sauvola neighborhoods', () => {
    const values = Array.from({ length: 49 }, (_value, index) => {
      const x = index % 7
      const y = Math.floor(index / 7)
      return x * 8 + (x === 2 && y === 3 ? 40 : 0) + (x === 5 && y === 3 ? 40 : 0)
    })
    const result = applyThreshold(plane(7, 7, values), 0, {
      method: 'sauvola',
      polarity: 'light',
      lower: 0,
      upper: 255,
      histogramBins: 32,
      windowRadius: 1,
      sauvolaK: 0.2,
      dynamicRange: 128,
      noDataPolicy: 'background',
    })
    expect(result.mask[3 * 7 + 2]).toBe(1)
    expect(result.mask[3 * 7 + 5]).toBe(1)
  })
})

describe('binary cleanup and watershed', () => {
  it('fills holes, clears edge objects, removes small objects, and outlines', () => {
    const ring = Uint8Array.from([
      1, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0,
    ])
    const filled = binaryMorphology(ring, 5, 5, { kind: 'fill-holes' })
    expect(filled[6]).toBe(1)
    const borderCleared = binaryMorphology(filled, 5, 5, {
      kind: 'clear-border',
      connectivity: 4,
    })
    expect(borderCleared.slice(0, 15)).toEqual(new Uint8Array(15))
    const smallRemoved = binaryMorphology(borderCleared, 5, 5, {
      kind: 'remove-small-objects',
      minimumSize: 3,
      connectivity: 4,
    })
    expect([...smallRemoved]).toEqual(new Array<number>(25).fill(0))
    const outline = binaryMorphology(filled, 5, 5, { kind: 'outline' })
    expect(outline[6]).toBe(0)
  })

  it('computes exact Euclidean foreground distances', () => {
    const mask = Uint8Array.from([
      0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0,
    ])
    const distance = euclideanDistanceTransform(mask, 5, 5)
    expect(distance[2 * 5 + 2]).toBe(2)
    expect(distance[1 * 5 + 1]).toBe(1)
  })

  it('separates a deterministic touching-particle fixture', () => {
    const width = 15
    const height = 9
    const mask = new Uint8Array(width * height)
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1)
        if ((x - 5) ** 2 + (y - 4) ** 2 <= 16 || (x - 9) ** 2 + (y - 4) ** 2 <= 16)
          mask[y * width + x] = 1
    expect(componentCount(mask, width, height)).toBe(1)
    const separated = watershedSeparate(mask, width, height, { minimumPeakDistance: 3 })
    expect(componentCount(separated, width, height)).toBe(2)
  })

  it('honors cancellation checkpoints', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() =>
      euclideanDistanceTransform(new Uint8Array(64 * 64), 64, 64, controller.signal),
    ).toThrow()
  })

  it('hard-refuses a particle plan above its peak-memory admission budget', async () => {
    const prepared = await createSegmentationAnalysisProvider().prepare()
    if (prepared === undefined) throw new Error('Segmentation provider did not prepare.')
    const implementation = prepared.implementations.find(
      ({ descriptor }) => descriptor.operationId === MATERIALS_OPERATION_IDS.particleAnalysis,
    )
    const definition = segmentationOperationDefinitions.find(
      ({ descriptor }) => descriptor.id === MATERIALS_OPERATION_IDS.particleAnalysis,
    )
    if (implementation === undefined || definition === undefined)
      throw new Error('Particle implementation is unavailable.')
    const descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      sampleType: 'float32',
      axes: [
        { id: 'x', kind: 'space', length: 2_048, coordinates: { type: 'index' } },
        { id: 'y', kind: 'space', length: 2_048, coordinates: { type: 'index' } },
      ],
      components: [{ id: 'value', kind: 'intensity' }],
      levels: [
        {
          level: 0,
          axisLengths: [
            { axisId: 'x', length: 2_048 },
            { axisId: 'y', length: 2_048 },
          ],
        },
      ],
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'any-axis-pair' },
      },
    })
    const parameters = {
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      component: 0,
      sourceComponent: 0,
      edgePolicy: 'exclude',
      minimumArea: 0,
      maximumArea: 1_000_000,
      minimumCircularity: 0,
      maximumCircularity: 1,
      minimumAspectRatio: 1,
      maximumAspectRatio: 1_000,
      minimumSolidity: 0,
      maximumSolidity: 1,
    } as const
    const request = {
      descriptor: definition.descriptor,
      parameters,
      inputCharacteristics: [
        scientificDatasetCharacteristics(descriptor),
        scientificDatasetCharacteristics(descriptor),
        { kind: 'roi' },
      ],
      signal: new AbortController().signal,
    }
    expect(implementation.estimatePlan(request).peakWorkingBytes).toBeGreaterThan(
      384 * 1_024 * 1_024,
    )
    expect(implementation.supportsPlan(request)).toBe(false)
  })
})
