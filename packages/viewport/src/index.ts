export interface CameraPoint {
  readonly x: number
  readonly y: number
}

export function translateCamera(point: CameraPoint, delta: CameraPoint): CameraPoint {
  return { x: point.x + delta.x, y: point.y + delta.y }
}
