export interface Point {
  readonly x: number
  readonly y: number
}

export type CameraPoint = Point

export interface Size {
  readonly width: number
  readonly height: number
}

export interface Bounds extends Point, Size {}

export interface Camera {
  readonly center: Point
  /** Screen pixels per world unit. In image space, world units are pixels. */
  readonly zoom: number
}

export interface CameraLimits {
  readonly minZoom: number
  readonly maxZoom: number
  readonly overscroll: number
}

export interface Calibration {
  readonly unitsPerPixel: number
  readonly unit: string
}

export interface ScaleBarDescriptor {
  readonly worldLength: number
  readonly screenLength: number
  readonly label: string
}

export interface RenderTileDescriptor {
  readonly id: string
  readonly bounds: Bounds
  readonly opacity: number
}

export interface PlannedTileRegion extends Bounds {
  readonly column: number
  readonly row: number
  readonly priority: 'visible' | 'near-visible'
}

export interface OverlayDescriptor {
  readonly id: string
  readonly kind: 'rectangle' | 'ellipse' | 'polygon' | 'line'
  readonly points: readonly Point[]
  readonly selected: boolean
  readonly label?: string
}

export interface ViewportRenderFrame {
  readonly camera: Camera
  readonly viewport: Size
  readonly imageBounds: Bounds
  readonly tiles: readonly RenderTileDescriptor[]
  readonly overlays: readonly OverlayDescriptor[]
}

export interface ViewportRenderer {
  configure(viewport: Size): void
  render(frame: ViewportRenderFrame): void
  dispose(): void
}

export interface HitTestTarget {
  readonly id: string
  readonly bounds: Bounds
  readonly priority: number
}

export interface HitTestResult {
  readonly id: string
  readonly worldPoint: Point
}

export type WorldYDirection = 1 | -1
