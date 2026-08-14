import {
  type Camera,
  calculateScaleBar,
  fitCameraToBounds,
  type Point,
  panCamera,
  resizeCamera,
  type Size,
  screenToWorld,
  type ViewportRenderer,
  type ViewportRenderFrame,
  worldToScreen,
  zoomCameraAtScreenPoint,
} from '@pji-workbench/viewport'
import { useEffect, useRef } from 'react'

const IMAGE_BOUNDS = { x: 0, y: 0, width: 2_048, height: 1_536 } as const
const CALIBRATION = { unitsPerPixel: 0.42, unit: 'nm' } as const
const ROI_POINTS = [
  { x: 670, y: 470 },
  { x: 1_280, y: 470 },
  { x: 1_280, y: 1_020 },
  { x: 670, y: 1_020 },
] as const

const PARTICLES = Array.from({ length: 95 }, (_, index) => ({
  x: 80 + ((index * 197 + (index % 7) * 43) % 1_880),
  y: 70 + ((index * 113 + (index % 11) * 71) % 1_390),
  radius: 5 + ((index * 17) % 29),
  intensity: 82 + ((index * 31) % 128),
}))

export interface MockViewportApi {
  fit(): void
  oneToOne(): void
}

interface MockViewportProps {
  readonly roiSelected: boolean
  readonly onReady: (api: MockViewportApi | null) => void
}

class CanvasMockRenderer implements ViewportRenderer {
  readonly #canvas: HTMLCanvasElement
  #context: CanvasRenderingContext2D
  #viewport: Size = { width: 1, height: 1 }

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('The mock viewport requires a 2D canvas context.')
    this.#canvas = canvas
    this.#context = context
  }

  configure(viewport: Size): void {
    this.#viewport = viewport
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    this.#canvas.width = Math.max(1, Math.round(viewport.width * ratio))
    this.#canvas.height = Math.max(1, Math.round(viewport.height * ratio))
    this.#context = this.#canvas.getContext('2d') ?? this.#context
    this.#context.setTransform(ratio, 0, 0, ratio, 0, 0)
  }

  render(frame: ViewportRenderFrame): void {
    const context = this.#context
    const { width, height } = this.#viewport
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#050709'
    context.fillRect(0, 0, width, height)

    const topLeft = worldToScreen({ x: 0, y: 0 }, frame.camera, frame.viewport)
    const bottomRight = worldToScreen(
      { x: IMAGE_BOUNDS.width, y: IMAGE_BOUNDS.height },
      frame.camera,
      frame.viewport,
    )
    const imageWidth = bottomRight.x - topLeft.x
    const imageHeight = bottomRight.y - topLeft.y

    context.save()
    context.beginPath()
    context.rect(topLeft.x, topLeft.y, imageWidth, imageHeight)
    context.clip()
    const gradient = context.createLinearGradient(
      topLeft.x,
      topLeft.y,
      bottomRight.x,
      bottomRight.y,
    )
    gradient.addColorStop(0, '#17202a')
    gradient.addColorStop(0.48, '#35414b')
    gradient.addColorStop(1, '#11171c')
    context.fillStyle = gradient
    context.fillRect(topLeft.x, topLeft.y, imageWidth, imageHeight)

    for (const particle of PARTICLES) {
      const position = worldToScreen(particle, frame.camera, frame.viewport)
      const radius = Math.max(1, particle.radius * frame.camera.zoom)
      context.beginPath()
      context.arc(position.x, position.y, radius, 0, Math.PI * 2)
      const value = particle.intensity
      context.fillStyle = `rgb(${value} ${value + 5} ${value + 7} / 78%)`
      context.fill()
      context.strokeStyle = 'rgb(235 242 246 / 22%)'
      context.lineWidth = 0.8
      context.stroke()
    }

    context.globalAlpha = 0.12
    context.strokeStyle = '#c9d4db'
    context.lineWidth = 1
    for (let x = 0; x <= IMAGE_BOUNDS.width; x += 256) {
      const start = worldToScreen({ x, y: 0 }, frame.camera, frame.viewport)
      const end = worldToScreen({ x, y: IMAGE_BOUNDS.height }, frame.camera, frame.viewport)
      context.beginPath()
      context.moveTo(start.x, start.y)
      context.lineTo(end.x, end.y)
      context.stroke()
    }
    context.globalAlpha = 1
    context.restore()

    context.strokeStyle = '#80909b'
    context.lineWidth = 1
    context.strokeRect(topLeft.x, topLeft.y, imageWidth, imageHeight)

    const overlay = frame.overlays[0]
    if (overlay !== undefined) {
      const first = overlay.points[0]
      if (first !== undefined) {
        context.beginPath()
        const start = worldToScreen(first, frame.camera, frame.viewport)
        context.moveTo(start.x, start.y)
        for (const point of overlay.points.slice(1)) {
          const screen = worldToScreen(point, frame.camera, frame.viewport)
          context.lineTo(screen.x, screen.y)
        }
        context.closePath()
        context.fillStyle = overlay.selected ? 'rgb(85 183 239 / 17%)' : 'rgb(85 183 239 / 8%)'
        context.fill()
        context.strokeStyle = overlay.selected ? '#7fd4ff' : '#55b7ef'
        context.lineWidth = overlay.selected ? 2 : 1.25
        context.setLineDash(overlay.selected ? [] : [5, 4])
        context.stroke()
        context.setLineDash([])
      }
    }

    const scale = calculateScaleBar(frame.camera, CALIBRATION)
    const scaleX = Math.max(18, width - scale.screenLength - 22)
    const scaleY = height - 23
    context.strokeStyle = '#f3f6f8'
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(scaleX, scaleY)
    context.lineTo(scaleX + scale.screenLength, scaleY)
    context.stroke()
    context.fillStyle = '#f3f6f8'
    context.font = '11px ui-monospace, monospace'
    context.textAlign = 'center'
    context.fillText(scale.label, scaleX + scale.screenLength / 2, scaleY - 7)
  }

  dispose(): void {
    this.#context.clearRect(0, 0, this.#viewport.width, this.#viewport.height)
  }
}

export function MockViewport({ roiSelected, onReady }: MockViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const coordinateRef = useRef<HTMLSpanElement>(null)
  const zoomRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const renderer = new CanvasMockRenderer(canvas)
    let viewport: Size = { width: 1, height: 1 }
    let camera: Camera = { center: { x: 1_024, y: 768 }, zoom: 1 }
    let fitted = false
    let frameRequest = 0
    let panning = false
    let spacePressed = false
    let previousPointer: Point = { x: 0, y: 0 }

    const frame = (): ViewportRenderFrame => ({
      camera,
      viewport,
      imageBounds: IMAGE_BOUNDS,
      tiles: [{ id: 'mock-sem-plane', bounds: IMAGE_BOUNDS, opacity: 1 }],
      overlays: [
        {
          id: 'roi-precipitates',
          kind: 'rectangle',
          points: ROI_POINTS,
          selected: roiSelected,
          label: 'Precipitate field',
        },
      ],
    })
    const draw = (): void => {
      cancelAnimationFrame(frameRequest)
      frameRequest = requestAnimationFrame(() => {
        renderer.render(frame())
        if (zoomRef.current !== null)
          zoomRef.current.textContent = `${Math.round(camera.zoom * 100)}%`
        window.__PJI_WORKBENCH_METRICS__.viewportFrames += 1
      })
    }
    const fit = (): void => {
      camera = fitCameraToBounds(IMAGE_BOUNDS, viewport, 32)
      draw()
    }
    const oneToOne = (): void => {
      camera = resizeCamera({ center: camera.center, zoom: 1 }, viewport, viewport, IMAGE_BOUNDS)
      draw()
    }
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const previous = viewport
      viewport = {
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      }
      renderer.configure(viewport)
      camera = fitted
        ? resizeCamera(camera, previous, viewport, IMAGE_BOUNDS)
        : fitCameraToBounds(IMAGE_BOUNDS, viewport, 32)
      fitted = true
      draw()
    })
    resizeObserver.observe(canvas)

    const pointerPosition = (event: Pick<MouseEvent, 'clientX' | 'clientY'>): Point => {
      const bounds = canvas.getBoundingClientRect()
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 1 && !(event.button === 0 && spacePressed)) return
      event.preventDefault()
      panning = true
      previousPointer = pointerPosition(event)
      canvas.setPointerCapture(event.pointerId)
      canvas.setAttribute('data-panning', 'true')
    }
    const handlePointerMove = (event: PointerEvent): void => {
      const point = pointerPosition(event)
      const world = screenToWorld(point, camera, viewport)
      if (coordinateRef.current !== null) {
        coordinateRef.current.textContent = `${Math.round(world.x)}, ${Math.round(world.y)} px · ${(world.x * CALIBRATION.unitsPerPixel).toFixed(1)} ${CALIBRATION.unit}`
      }
      if (panning) {
        camera = panCamera(
          camera,
          { x: point.x - previousPointer.x, y: point.y - previousPointer.y },
          viewport,
          IMAGE_BOUNDS,
        )
        previousPointer = point
        draw()
      }
    }
    const stopPanning = (event: PointerEvent): void => {
      if (!panning) return
      panning = false
      canvas.setAttribute('data-panning', 'false')
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault()
      camera = zoomCameraAtScreenPoint(
        camera,
        pointerPosition(event),
        Math.exp(-event.deltaY * 0.0012),
        viewport,
        IMAGE_BOUNDS,
      )
      draw()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Space') spacePressed = true
      if (
        event.target !== canvas ||
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      )
        return
      event.preventDefault()
      camera = panCamera(
        camera,
        {
          x: event.key === 'ArrowLeft' ? -30 : event.key === 'ArrowRight' ? 30 : 0,
          y: event.key === 'ArrowUp' ? -30 : event.key === 'ArrowDown' ? 30 : 0,
        },
        viewport,
        IMAGE_BOUNDS,
      )
      draw()
    }
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') spacePressed = false
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', stopPanning)
    canvas.addEventListener('pointercancel', stopPanning)
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    onReady({ fit, oneToOne })

    return () => {
      onReady(null)
      cancelAnimationFrame(frameRequest)
      resizeObserver.disconnect()
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', stopPanning)
      canvas.removeEventListener('pointercancel', stopPanning)
      canvas.removeEventListener('wheel', handleWheel)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      renderer.dispose()
    }
  }, [onReady, roiSelected])

  return (
    <div className="mock-viewport">
      <canvas
        aria-describedby="viewport-summary"
        aria-label="Mock SEM image viewport. Use the mouse wheel to zoom, middle mouse or Space plus drag to pan, and arrow keys to pan while focused."
        className="mock-viewport__canvas"
        data-panning="false"
        ref={canvasRef}
        role="img"
        tabIndex={0}
      />
      <div className="mock-viewport__readout" aria-live="off">
        <span ref={coordinateRef}>Move pointer for calibrated coordinates</span>
        <span ref={zoomRef}>100%</span>
      </div>
      <p className="visually-hidden" id="viewport-summary">
        A deterministic 2048 by 1536 pixel scanning electron microscopy sample with a calibrated
        scale of 0.42 nanometers per pixel and one rectangular region of interest.
      </p>
    </div>
  )
}
