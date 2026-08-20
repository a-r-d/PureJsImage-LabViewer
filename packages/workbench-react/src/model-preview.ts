export interface BoundedPreviewOptions {
  readonly width: number
  readonly height: number
  readonly maxBytes?: number
  readonly maximumPixels?: number
}

export interface BoundedPngPreview {
  readonly mimeType: 'image/png'
  readonly width: number
  readonly height: number
  readonly bytes: number
  readonly dataUrl: string
}

const DEFAULT_MAX_BYTES = 2 * 1_024 * 1_024
const DEFAULT_MAX_PIXELS = 786_432

export async function createBoundedPngPreview(
  source: Blob,
  options: BoundedPreviewOptions,
  signal?: AbortSignal,
): Promise<BoundedPngPreview> {
  const bounds = validateBounds(options)
  signal?.throwIfAborted()
  const bitmap = await createImageBitmap(source)
  try {
    signal?.throwIfAborted()
    return encodeCanvas(drawContained(bitmap, bitmap.width, bitmap.height, bounds), bounds, signal)
  } finally {
    bitmap.close()
  }
}

export async function captureBoundedScreenPreview(
  options: BoundedPreviewOptions,
  signal?: AbortSignal,
): Promise<BoundedPngPreview> {
  const bounds = validateBounds(options)
  signal?.throwIfAborted()
  if (navigator.mediaDevices?.getDisplayMedia === undefined)
    throw new Error('This browser does not support user-approved screen capture.')
  let stream: MediaStream | undefined
  const video = document.createElement('video')
  try {
    stream = await requestDisplayStream(navigator.mediaDevices, signal)
    signal?.throwIfAborted()
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await waitForScreenFrame(video, signal)
    signal?.throwIfAborted()
    return encodeCanvas(
      drawContained(video, video.videoWidth, video.videoHeight, bounds),
      bounds,
      signal,
    )
  } finally {
    video.pause()
    video.srcObject = null
    for (const track of stream?.getTracks() ?? []) track.stop()
  }
}

interface ValidatedBounds {
  readonly width: number
  readonly height: number
  readonly maxBytes: number
}

function validateBounds(options: BoundedPreviewOptions): ValidatedBounds {
  const width = boundedInteger(options.width, 'width', 1_024)
  const height = boundedInteger(options.height, 'height', 1_024)
  const maxBytes = boundedInteger(
    options.maxBytes ?? DEFAULT_MAX_BYTES,
    'maxBytes',
    2 * 1_024 * 1_024,
  )
  const maximumPixels = boundedInteger(
    options.maximumPixels ?? DEFAULT_MAX_PIXELS,
    'maximumPixels',
    DEFAULT_MAX_PIXELS,
  )
  if (width * height > maximumPixels)
    throw new Error(`Model preview exceeds the ${maximumPixels.toLocaleString()}-pixel limit.`)
  return { width, height, maxBytes }
}

function boundedInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`${label} must be an integer from 1 through ${maximum}.`)
  return value
}

function drawContained(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  bounds: ValidatedBounds,
): HTMLCanvasElement {
  if (sourceWidth < 1 || sourceHeight < 1) throw new Error('Preview source dimensions are invalid.')
  const canvas = document.createElement('canvas')
  canvas.width = bounds.width
  canvas.height = bounds.height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('A 2D canvas context is required for model previews.')
  context.fillStyle = '#050709'
  context.fillRect(0, 0, bounds.width, bounds.height)
  const scale = Math.min(bounds.width / sourceWidth, bounds.height / sourceHeight)
  const renderedWidth = Math.max(1, Math.round(sourceWidth * scale))
  const renderedHeight = Math.max(1, Math.round(sourceHeight * scale))
  context.drawImage(
    source,
    Math.round((bounds.width - renderedWidth) / 2),
    Math.round((bounds.height - renderedHeight) / 2),
    renderedWidth,
    renderedHeight,
  )
  return canvas
}

async function encodeCanvas(
  canvas: HTMLCanvasElement,
  bounds: ValidatedBounds,
  signal?: AbortSignal,
): Promise<BoundedPngPreview> {
  const blob = await canvasPng(canvas)
  signal?.throwIfAborted()
  if (blob.size > bounds.maxBytes)
    throw new Error(`Model preview exceeds the ${bounds.maxBytes}-byte limit.`)
  const dataUrl = await blobDataUrl(blob)
  signal?.throwIfAborted()
  return {
    mimeType: 'image/png',
    width: bounds.width,
    height: bounds.height,
    bytes: blob.size,
    dataUrl,
  }
}

function requestDisplayStream(
  mediaDevices: MediaDevices,
  signal: AbortSignal | undefined,
): Promise<MediaStream> {
  const requested = mediaDevices.getDisplayMedia({ video: true, audio: false })
  if (signal === undefined) return requested
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    void requested.then(
      (stream) => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) {
          for (const track of stream.getTracks()) track.stop()
          return
        }
        resolve(stream)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        if (!signal.aborted) reject(error)
      },
    )
  })
}

function waitForScreenFrame(
  video: HTMLVideoElement,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      video.onloadedmetadata = null
      video.onerror = null
      if (error === undefined) resolve()
      else reject(error)
    }
    const abort = () => finish(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    const timeout = window.setTimeout(
      () => finish(new Error('The shared screen did not produce a frame in time.')),
      10_000,
    )
    video.onloadedmetadata = () => {
      if (video.videoWidth < 1 || video.videoHeight < 1) {
        finish(new Error('The shared screen returned invalid dimensions.'))
        return
      }
      void video.play().then(() => finish(), finish)
    }
    video.onerror = () => finish(new Error('The shared screen could not be decoded.'))
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value === null ? reject(new Error('Model preview PNG encoding failed.')) : resolve(value),
      'image/png',
    ),
  )
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Model preview could not be encoded.'))
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Model preview could not be encoded.'))
    reader.readAsDataURL(blob)
  })
}
