import { readFile } from 'node:fs/promises'
import { MemorySource } from 'purejsimage'
import {
  rasterSampleBytes,
  readRasterSample,
  type ScientificReader,
  ScientificReaderRegistry,
} from 'purejsimage/scientific'
import { jpegReader } from 'purejsimage/scientific/readers/jpeg'
import { pngReader } from 'purejsimage/scientific/readers/png'
import { tiffReader } from 'purejsimage/scientific/readers/tiff'
import { describe, expect, it } from 'vitest'

import {
  computeParticleCorpusFeatures,
  labelColorInstanceMaskForEvaluation,
  selectParticleCorpusHardCases,
} from '../src/index.js'

const corpusRoot = new URL('../testdata/corpus/', import.meta.url)
const manifestUrl = new URL('manifest.v1.json', corpusRoot)

interface DecodedImage {
  readonly width: number
  readonly height: number
  readonly channels: number
  readonly values: Float64Array
}

async function decode(path: string): Promise<DecodedImage> {
  const bytes = await readFile(new URL(path, corpusRoot))
  const reader: ScientificReader = path.endsWith('.tif')
    ? tiffReader
    : path.endsWith('.jpg')
      ? jpegReader
      : pngReader
  const document = await new ScientificReaderRegistry([reader]).open({
    primary: { id: path, name: path.split('/').at(-1) ?? path, source: new MemorySource(bytes) },
    readerId: reader.descriptor.id,
  })
  try {
    const summary = document.datasets[0]
    if (summary === undefined) throw new Error(`Corpus asset ${path} has no dataset.`)
    const dataset = await document.openDataset(summary.id)
    const xAxis = dataset.descriptor.axes.find(({ id }) => id === 'x')
    const yAxis = dataset.descriptor.axes.find(({ id }) => id === 'y')
    if (xAxis === undefined || yAxis === undefined)
      throw new Error(`Corpus asset ${path} has no XY axes.`)
    const channels = dataset.descriptor.components.length
    const values = new Float64Array(xAxis.length * yAxis.length * channels)
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      x: 0,
      y: 0,
      width: xAxis.length,
      height: yAxis.length,
    })) {
      expect(['uint8', 'uint16']).toContain(block.format.sampleType)
      expect(block.format.channels).toBe(channels)
      const bytesPerSample = rasterSampleBytes(block.format.sampleType)
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      const planeStride = block.planeStride ?? block.stride * block.height
      for (let y = 0; y < block.height; y += 1) {
        for (let x = 0; x < block.width; x += 1) {
          for (let channel = 0; channel < channels; channel += 1) {
            const sourceOffset = block.format.planar
              ? channel * planeStride + y * block.stride + x * bytesPerSample
              : y * block.stride + (x * channels + channel) * bytesPerSample
            const targetOffset = ((block.y + y) * xAxis.length + block.x + x) * channels + channel
            values[targetOffset] = readRasterSample(
              block.data,
              view,
              sourceOffset,
              block.format.sampleType,
            )
          }
        }
      }
      block.release?.()
    }
    return { width: xAxis.length, height: yAxis.length, channels, values }
  } finally {
    await document.close?.()
  }
}

function grayscale(image: DecodedImage): Float64Array {
  return Float64Array.from({ length: image.width * image.height }, (_value, index) => {
    const offset = index * image.channels
    if (image.channels === 1) return image.values[offset] ?? 0
    const red = image.values[offset] ?? 0
    const green = image.values[offset + 1] ?? red
    const blue = image.values[offset + 2] ?? red
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  })
}

describe('checked-in real particle corpus seed', () => {
  it('opens every asset through published readers with manifest-matched dimensions', async () => {
    const manifest: unknown = JSON.parse(await readFile(manifestUrl, 'utf8'))
    if (typeof manifest !== 'object' || manifest === null || !('fixtures' in manifest))
      throw new Error('Particle corpus manifest is malformed.')
    const fixtures = (manifest as { readonly fixtures: readonly unknown[] }).fixtures
    for (const unknownFixture of fixtures) {
      const fixture = unknownFixture as {
        readonly id: string
        readonly image: { readonly path: string }
        readonly dimensions: {
          readonly width: number
          readonly height: number
          readonly channels: number
        }
        readonly labels: {
          readonly instanceMask: { readonly path: string } | null
          readonly semanticMask: { readonly path: string } | null
        }
      }
      const image = await decode(fixture.image.path)
      expect(image.width, fixture.id).toBe(fixture.dimensions.width)
      expect(image.height, fixture.id).toBe(fixture.dimensions.height)
      expect(image.channels, fixture.id).toBe(
        fixture.image.path.endsWith('.jpg') ? 3 : fixture.dimensions.channels,
      )
      for (const mask of [fixture.labels.instanceMask, fixture.labels.semanticMask]) {
        if (mask === null) continue
        const decodedMask = await decode(mask.path)
        expect(decodedMask.width, `${fixture.id}/${mask.path}`).toBe(image.width)
        expect(decodedMask.height, `${fixture.id}/${mask.path}`).toBe(image.height)
      }
    }
  })

  it('preserves all upstream BBBC039 instance identities and freezes hard-case features', async () => {
    const pairs = [
      {
        id: 'bbbc039-preview-a',
        image: 'core/images/bbbc039-example-a.png',
        mask: 'core/masks/bbbc039-example-a-instance.png',
        count: 42,
      },
      {
        id: 'bbbc039-preview-b',
        image: 'core/images/bbbc039-example-b.png',
        mask: 'core/masks/bbbc039-example-b-instance.png',
        count: 59,
      },
    ] as const
    const candidates = []
    for (const pair of pairs) {
      const image = await decode(pair.image)
      const mask = await decode(pair.mask)
      const labels = labelColorInstanceMaskForEvaluation(
        mask.values,
        mask.width,
        mask.height,
        mask.channels,
      )
      expect(new Set(labels.filter((label) => label !== 0)).size, pair.id).toBe(pair.count)
      const candidate = {
        id: pair.id,
        features: computeParticleCorpusFeatures({
          id: pair.id,
          image: grayscale(image),
          instanceLabels: labels,
          width: image.width,
          height: image.height,
          bitDepth: 8,
          channelCount: image.channels,
        }),
      }
      expect(candidate.features.objectCount).toBe(pair.count)
      expect(candidate.features.localBoundaryContrast).toBeGreaterThan(0)
      candidates.push(candidate)
    }
    const selection = selectParticleCorpusHardCases(candidates, 2)
    expect(selection.map(({ id }) => id)).toEqual(['bbbc039-preview-a', 'bbbc039-preview-b'])
    expect(selection.every(({ reasons }) => reasons.length > 0)).toBe(true)
  })

  it('keeps unlabeled asbestos files as decoder smoke tests rather than gold metrics', async () => {
    const nist = await decode('core/images/nist-asbestos-montage.png')
    const usgs = await decode('core/images/usgs-anthophyllite-asbestos-sem.jpg')
    expect(nist).toMatchObject({ width: 2134, height: 2977, channels: 4 })
    expect(usgs).toMatchObject({ width: 1024, height: 1024, channels: 3 })
  })
})
