import { describe, expect, it } from 'vitest'

import {
  detectFrequencyPeaks,
  fft2d,
  frequencySpectrum,
  inverseFft2d,
  isEfficientFftLength,
  phaseCorrelation,
  radialFrequencyProfile,
} from '../src/frequency.js'

describe('frequency-domain reference algorithms', () => {
  it('finds an exact synthetic sinusoidal lattice frequency and preserves inverse complex values', () => {
    const width = 32
    const height = 16
    const cycles = 4
    const source = Float64Array.from({ length: width * height }, (_value, index) =>
      Math.cos((2 * Math.PI * cycles * (index % width)) / width),
    )
    const transform = fft2d(source, width, height)
    const inverse = inverseFft2d(transform)
    expect([...inverse.real]).toEqual(expect.arrayContaining([expect.any(Number)]))
    for (let index = 0; index < source.length; index += 1) {
      expect(inverse.real[index]).toBeCloseTo(source[index] ?? 0, 9)
      expect(inverse.imaginary[index]).toBeCloseTo(0, 9)
    }
    const magnitude = frequencySpectrum(transform, { mode: 'magnitude', centered: true })
    const peaks = detectFrequencyPeaks(magnitude, width, height, {
      threshold: width * height * 0.4,
      minimumDistance: 2,
      maximumPeaks: 4,
      calibration: { xSpacing: 0.25, ySpacing: 0.5, spatialUnit: 'nm' },
    })
    expect(peaks).toHaveLength(2)
    expect(peaks.map(({ radialFrequency }) => radialFrequency)).toEqual([
      expect.closeTo(0.5, 10),
      expect.closeTo(0.5, 10),
    ])
    expect(peaks.map(({ dSpacing }) => dSpacing)).toEqual([
      expect.closeTo(2, 10),
      expect.closeTo(2, 10),
    ])
  })

  it('produces tile-order-independent radial integration', () => {
    const values = Float64Array.from({ length: 24 * 20 }, (_value, index) => index % 17)
    const first = radialFrequencyProfile(values, 24, 20, 32)
    const second = radialFrequencyProfile(values.slice(), 24, 20, 32)
    expect(first.axis).toEqual(second.axis)
    expect(first.values).toEqual(second.values)
    expect(first.counts).toEqual(second.counts)
  })

  it('places a calibrated synthetic diffraction ring in the expected radial bin', () => {
    const width = 32
    const height = 32
    const values = Float64Array.from({ length: width * height }, (_value, index) => {
      const x = (index % width) - width / 2
      const y = Math.floor(index / width) - height / 2
      return Math.abs(Math.hypot(x, y) - 6) < 0.6 ? 10 : 0
    })
    const profile = radialFrequencyProfile(values, width, height, 64, {
      xSpacing: 0.5,
      ySpacing: 0.5,
      spatialUnit: 'nm',
    })
    let maximumIndex = 0
    for (let index = 1; index < profile.values.length; index += 1)
      if ((profile.values[index] ?? 0) > (profile.values[maximumIndex] ?? 0)) maximumIndex = index
    expect(profile.axisUnit).toBe('1/nm')
    expect(profile.axis[maximumIndex]).toBeCloseTo(6 / (width * 0.5), 1)
  })

  it('refuses impractical direct transforms while admitting radix-2 axes', () => {
    expect(isEfficientFftLength(512)).toBe(true)
    expect(isEfficientFftLength(1024)).toBe(true)
    expect(isEfficientFftLength(513)).toBe(false)
    expect(() => fft2d(new Float64Array(513), 513, 1)).toThrow(/power-of-two/u)
  })

  it('recovers known integer translations through normalized phase correlation', () => {
    const width = 32
    const height = 32
    const reference = new Float64Array(width * height)
    for (let y = 6; y < 13; y += 1)
      for (let x = 8; x < 17; x += 1) reference[y * width + x] = 1 + ((x + y) % 3)
    const moving = new Float64Array(width * height)
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1)
        moving[y * width + x] =
          reference[((y - 3 + height) % height) * width + ((x + 5) % width)] ?? 0
    const result = phaseCorrelation(reference, moving, width, height, {
      maximumShift: 8,
      minimumPeakRatio: 2,
    })
    expect(result.accepted).toBe(true)
    expect(result.offsetX).toBe(5)
    expect(result.offsetY).toBe(-3)
  })

  it('checks cancellation during global transforms', () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))
    expect(() => fft2d(new Float64Array(64 * 64), 64, 64, controller.signal)).toThrow()
  })
})
