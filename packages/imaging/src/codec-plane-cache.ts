import {
  type NumericTile,
  type NumericTileReadRequest,
  type NumericTileSource,
  resolveNumericTileSource,
  type ScientificDataset,
  type ScientificPlaneReadRequest,
} from 'purejsimage/scientific'

const CODEC_ADAPTER_READER_IDS = new Set([
  'purejsimage/jpeg',
  'purejsimage/png',
  'purejsimage/webp',
  'purejsimage/bmp',
  'purejsimage/jp2',
])

export function usesCodecAdapterReader(readerId: string): boolean {
  return CODEC_ADAPTER_READER_IDS.has(readerId)
}

/**
 * JPEG and the other codec adapters can decode from the origin as 16-row bands
 * but reject many interior tiled requests. Cache one origin-decoded plane and
 * crop viewport tiles and analysis plane reads from it.
 */
export function wrapCodecAdapterDataset(
  dataset: ScientificDataset,
  readerId: string,
): ScientificDataset {
  if (!usesCodecAdapterReader(readerId)) return dataset
  const cached = cacheCodecAdapterPlane(
    resolveNumericTileSource(dataset, { targetSampleType: 'float32' }),
  )
  return {
    descriptor: dataset.descriptor,
    async *readPlane(request: Readonly<ScientificPlaneReadRequest>) {
      for await (const tile of cached.readNumericTiles(request)) {
        try {
          yield numericTileToUint8RasterBlock(tile)
        } finally {
          tile.release()
        }
      }
    },
    ...(dataset.readSeries === undefined
      ? {}
      : {
          readSeries: (request) => {
            const readSeries = dataset.readSeries
            if (readSeries === undefined) throw new Error('Codec adapter lost its series reader')
            return readSeries.call(dataset, request)
          },
        }),
  }
}

export function cacheCodecAdapterPlane(source: NumericTileSource): NumericTileSource {
  let plane: Promise<CachedPlane> | undefined

  const load = (request: Readonly<NumericTileReadRequest>): Promise<CachedPlane> => {
    plane ??= materializePlane(source, request)
    return plane
  }

  return {
    descriptor: source.descriptor,
    ...(source.directSemantics === undefined ? {} : { directSemantics: source.directSemantics }),
    async *readNumericTiles(request) {
      const cached = await load(request)
      yield cropPlane(cached, request)
    },
  }
}

interface CachedPlane {
  readonly width: number
  readonly height: number
  readonly componentCount: number
  readonly data: Float32Array
}

async function materializePlane(
  source: NumericTileSource,
  request: Readonly<NumericTileReadRequest>,
): Promise<CachedPlane> {
  const width = axisLength(source, request.displayAxes[0])
  const height = axisLength(source, request.displayAxes[1])
  const componentCount = source.descriptor.components.length
  const data = new Float32Array(width * height * componentCount)
  for await (const tile of source.readNumericTiles({
    ...request,
    x: 0,
    y: 0,
    width,
    height,
    targetSampleType: 'float32',
  })) {
    copyBand(data, width, tile)
    tile.release()
  }
  return { width, height, componentCount, data }
}

function axisLength(source: NumericTileSource, axisId: string): number {
  const axis = source.descriptor.axes.find((candidate) => candidate.id === axisId)
  if (axis === undefined) throw new Error(`Missing axis ${axisId}`)
  return axis.length
}

function copyBand(plane: Float32Array, planeWidth: number, tile: NumericTile): void {
  if (!(tile.data instanceof Float32Array)) {
    throw new Error('Codec plane cache expected float32 tiles')
  }
  const components = tile.componentCount
  const rowElements = tile.width * components
  for (let row = 0; row < tile.height; row += 1) {
    const sourceStart = tile.rowStrideElements * row
    const destination = ((tile.y + row) * planeWidth + tile.x) * components
    plane.set(tile.data.subarray(sourceStart, sourceStart + rowElements), destination)
  }
}

function cropPlane(plane: CachedPlane, request: Readonly<NumericTileReadRequest>): NumericTile {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const width = request.width ?? plane.width - x
  const height = request.height ?? plane.height - y
  const components = plane.componentCount
  const data = new Float32Array(width * height * components)
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * plane.width + x) * components
    data.set(
      plane.data.subarray(sourceStart, sourceStart + width * components),
      row * width * components,
    )
  }
  return {
    x,
    y,
    width,
    height,
    sampleType: 'float32',
    componentCount: components,
    layout: 'interleaved',
    rowStrideElements: width * components,
    data,
    release: () => undefined,
  }
}

function numericTileToUint8RasterBlock(tile: NumericTile) {
  if (!(tile.data instanceof Float32Array)) {
    throw new Error('Codec plane cache expected float32 tiles')
  }
  const channels = tile.componentCount
  const stride = tile.width * channels
  const data = new Uint8Array(tile.height * stride)
  for (let row = 0; row < tile.height; row += 1) {
    const sourceStart = tile.rowStrideElements * row
    const destination = row * stride
    for (let index = 0; index < stride; index += 1) {
      const value = tile.data[sourceStart + index] ?? 0
      data[destination + index] = value < 0 ? 0 : value > 255 ? 255 : Math.round(value)
    }
  }
  return {
    x: tile.x,
    y: tile.y,
    width: tile.width,
    height: tile.height,
    stride,
    format: { sampleType: 'uint8' as const, channels, planar: false },
    data,
  }
}
