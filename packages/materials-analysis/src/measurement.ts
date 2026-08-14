export interface Calibration2D {
  readonly x: number
  readonly y: number
  readonly unit: string
}

export interface Point2D {
  readonly x: number
  readonly y: number
}

export interface PolygonMeasurement {
  readonly pixelArea: number
  readonly physicalArea: number
  readonly pixelPerimeter: number
  readonly physicalPerimeter: number
  readonly pixelCentroid: Point2D
  readonly physicalCentroid: Point2D
  readonly unit: string
}

const METERS_PER_UNIT: Readonly<Record<string, number>> = Object.freeze({
  m: 1,
  cm: 1e-2,
  mm: 1e-3,
  um: 1e-6,
  µm: 1e-6,
  nm: 1e-9,
  pm: 1e-12,
  Å: 1e-10,
  angstrom: 1e-10,
})

export function convertCalibration(calibration: Calibration2D, targetUnit: string): Calibration2D {
  const sourceFactor = METERS_PER_UNIT[calibration.unit]
  const targetFactor = METERS_PER_UNIT[targetUnit]
  if (sourceFactor === undefined || targetFactor === undefined)
    throw new Error(`Unsupported length-unit conversion: ${calibration.unit} to ${targetUnit}.`)
  return {
    x: (calibration.x * sourceFactor) / targetFactor,
    y: (calibration.y * sourceFactor) / targetFactor,
    unit: targetUnit,
  }
}

export function measurePolygon(
  points: readonly Point2D[],
  calibration: Calibration2D,
): PolygonMeasurement {
  if (points.length < 3) throw new Error('A polygon measurement needs at least three points.')
  if (
    !Number.isFinite(calibration.x) ||
    calibration.x <= 0 ||
    !Number.isFinite(calibration.y) ||
    calibration.y <= 0
  )
    throw new Error('Calibration spacing must be finite and positive.')
  let twiceArea = 0
  let centroidX = 0
  let centroidY = 0
  let pixelPerimeter = 0
  let physicalPerimeter = 0
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    const next = points[(index + 1) % points.length]
    if (point === undefined || next === undefined) continue
    const cross = point.x * next.y - next.x * point.y
    twiceArea += cross
    centroidX += (point.x + next.x) * cross
    centroidY += (point.y + next.y) * cross
    const dx = next.x - point.x
    const dy = next.y - point.y
    pixelPerimeter += Math.hypot(dx, dy)
    physicalPerimeter += Math.hypot(dx * calibration.x, dy * calibration.y)
  }
  if (twiceArea === 0) throw new Error('A polygon measurement cannot have zero area.')
  const signedArea = twiceArea / 2
  const pixelArea = Math.abs(signedArea)
  const pixelCentroid = {
    x: centroidX / (6 * signedArea),
    y: centroidY / (6 * signedArea),
  }
  return {
    pixelArea,
    physicalArea: pixelArea * calibration.x * calibration.y,
    pixelPerimeter,
    physicalPerimeter,
    pixelCentroid,
    physicalCentroid: {
      x: pixelCentroid.x * calibration.x,
      y: pixelCentroid.y * calibration.y,
    },
    unit: calibration.unit,
  }
}
