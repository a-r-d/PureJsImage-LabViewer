import { describe, expect, it } from 'vitest'

import { convertCalibration, measurePolygon } from '../src/measurement.js'

describe('calibrated measurements', () => {
  it('preserves anisotropic geometry in pixel and physical units', () => {
    const measurement = measurePolygon(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 2 },
        { x: 0, y: 2 },
      ],
      { x: 0.5, y: 2, unit: 'nm' },
    )
    expect(measurement.pixelArea).toBe(8)
    expect(measurement.physicalArea).toBe(8)
    expect(measurement.pixelPerimeter).toBe(12)
    expect(measurement.physicalPerimeter).toBe(12)
    expect(measurement.pixelCentroid).toEqual({ x: 2, y: 1 })
    expect(measurement.physicalCentroid).toEqual({ x: 1, y: 2 })
  })

  it('converts supported physical units without converting source pixels', () => {
    const converted = convertCalibration({ x: 500, y: 250, unit: 'nm' }, 'µm')
    expect(converted.x).toBeCloseTo(0.5, 12)
    expect(converted.y).toBeCloseTo(0.25, 12)
    expect(converted.unit).toBe('µm')
  })
})
