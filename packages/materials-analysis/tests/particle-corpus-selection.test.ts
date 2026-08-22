import { describe, expect, it } from 'vitest'

import {
  computeParticleCorpusFeatures,
  selectParticleCorpusHardCases,
} from '../src/particle-corpus-selection.js'

function fixture(
  id: string,
  rectangles: readonly Readonly<{
    left: number
    top: number
    right: number
    bottom: number
    value: number
  }>[],
) {
  const width = 24
  const height = 16
  const labels = new Uint32Array(width * height)
  const image = Float64Array.from({ length: width * height }, (_value, index) => {
    const x = index % width
    return 20 + x * 0.5
  })
  rectangles.forEach((rectangle, index) => {
    for (let y = rectangle.top; y <= rectangle.bottom; y += 1) {
      for (let x = rectangle.left; x <= rectangle.right; x += 1) {
        const offset = y * width + x
        labels[offset] = index + 1
        image[offset] = rectangle.value
      }
    }
  })
  return {
    id,
    features: computeParticleCorpusFeatures({
      id,
      image,
      instanceLabels: labels,
      width,
      height,
      bitDepth: 16,
      channelCount: 1,
    }),
  }
}

describe('particle corpus hard-case selection', () => {
  it('computes the complete deterministic mask-derived feature vector', () => {
    const candidate = fixture('two-near', [
      { left: 0, top: 0, right: 3, bottom: 3, value: 120 },
      { left: 5, top: 1, right: 9, bottom: 4, value: 90 },
    ])

    expect(candidate.features).toMatchObject({
      objectCount: 2,
      foregroundFraction: 36 / (24 * 16),
      objectAreaMedian: 18,
      objectAreaP10: 16.4,
      objectAreaP90: 19.6,
      edgeTouchingInstanceFraction: 0.5,
      bitDepth: 16,
      channelCount: 1,
    })
    expect(candidate.features.nearTouchingGraphDensity1).toBe(0)
    expect(candidate.features.nearTouchingGraphDensity2).toBe(1)
    expect(candidate.features.localBoundaryContrast).toBeGreaterThan(0)
    expect(candidate.features.focusScore).toBeGreaterThan(0)
    expect(candidate.features.estimatedSnr).toBeGreaterThan(0)
  })

  it('selects stable median, extremes, and medoids independent of input order', () => {
    const candidates = [
      fixture('sparse', [{ left: 2, top: 2, right: 4, bottom: 4, value: 70 }]),
      fixture('middle', [
        { left: 2, top: 2, right: 5, bottom: 5, value: 90 },
        { left: 10, top: 7, right: 13, bottom: 10, value: 95 },
      ]),
      fixture('dense', [
        { left: 1, top: 1, right: 5, bottom: 5, value: 120 },
        { left: 7, top: 1, right: 11, bottom: 5, value: 115 },
        { left: 13, top: 1, right: 17, bottom: 5, value: 110 },
        { left: 19, top: 1, right: 23, bottom: 5, value: 105 },
      ]),
      fixture('elongated', [{ left: 3, top: 7, right: 20, bottom: 8, value: 130 }]),
    ]

    const forward = selectParticleCorpusHardCases(candidates, 2)
    const reverse = selectParticleCorpusHardCases([...candidates].reverse(), 2)

    expect(reverse).toEqual(forward)
    expect(forward.map(({ id }) => id)).toEqual([...forward.map(({ id }) => id)].sort())
    expect(forward.some(({ reasons }) => reasons.includes('multivariate-median'))).toBe(true)
    expect(forward.filter(({ reasons }) => reasons.includes('cluster-medoid'))).toHaveLength(2)
    expect(forward.some(({ reasons }) => reasons.includes('objectCount:maximum'))).toBe(true)

    const capped = selectParticleCorpusHardCases(candidates, 2, 3)
    expect(capped).toHaveLength(3)
    expect(capped.some(({ reasons }) => reasons.includes('multivariate-median'))).toBe(true)
    expect(capped.filter(({ reasons }) => reasons.includes('cluster-medoid'))).toHaveLength(2)
  })

  it('rejects incomplete dimensions, duplicate IDs, and non-finite features', () => {
    expect(() =>
      computeParticleCorpusFeatures({
        id: 'bad',
        image: new Float64Array(3),
        instanceLabels: new Uint32Array(4),
        width: 2,
        height: 2,
        bitDepth: 8,
        channelCount: 1,
      }),
    ).toThrow('dimensions do not match')
    const candidate = fixture('duplicate', [{ left: 2, top: 2, right: 4, bottom: 4, value: 80 }])
    expect(() => selectParticleCorpusHardCases([candidate, candidate])).toThrow('unique')
    expect(() => selectParticleCorpusHardCases([candidate], 2, 2)).toThrow(
      'greater than clusterCount',
    )
    expect(() =>
      selectParticleCorpusHardCases([
        {
          ...candidate,
          features: { ...candidate.features, focusScore: Number.NaN },
        },
      ]),
    ).toThrow('must be finite')
  })

  it('retains degenerate labels in count and area features', () => {
    const image = new Float64Array(9)
    const labels = new Uint32Array(9)
    labels[4] = 17
    const features = computeParticleCorpusFeatures({
      id: 'one-pixel',
      image,
      instanceLabels: labels,
      width: 3,
      height: 3,
      bitDepth: 8,
      channelCount: 1,
    })
    expect(features).toMatchObject({
      objectCount: 1,
      foregroundFraction: 1 / 9,
      objectAreaMedian: 1,
      edgeTouchingInstanceFraction: 0,
    })
  })
})
