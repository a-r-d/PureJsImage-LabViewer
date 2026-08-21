import { createImageLibrary, MemorySource } from 'purejsimage'
import { bmpCodec } from 'purejsimage/codecs/bmp'
import { jpegCodec } from 'purejsimage/codecs/jpeg'
import { resolveNumericTileSource, ScientificReaderRegistry } from 'purejsimage/scientific'
import { jpegReader } from 'purejsimage/scientific/readers/jpeg'
import { describe, expect, it } from 'vitest'

import {
  cacheCodecAdapterPlane,
  usesCodecAdapterReader,
  wrapCodecAdapterDataset,
} from '../src/codec-plane-cache.js'

function encodedBmp(width = 64, height = 48): Uint8Array<ArrayBuffer> {
  const rowBytes = width * 3 + ((4 - ((width * 3) % 4)) % 4)
  const pixels = new Uint8Array(rowBytes * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (height - 1 - y) * rowBytes + x * 3
      pixels[offset] = 80
      pixels[offset + 1] = y * 4
      pixels[offset + 2] = x * 3
    }
  }
  const output = new Uint8Array(54 + pixels.byteLength)
  const view = new DataView(output.buffer)
  output.set([0x42, 0x4d])
  view.setUint32(2, output.byteLength, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, pixels.byteLength, true)
  output.set(pixels, 54)
  return output
}

async function encodedJpeg(): Promise<Uint8Array> {
  const images = createImageLibrary({ codecs: [bmpCodec, jpegCodec] })
  return (await images.open(encodedBmp())).jpeg({ quality: 95 }).toUint8Array()
}

describe('codec adapter plane cache', () => {
  it('identifies ordinary codec scientific readers', () => {
    expect(usesCodecAdapterReader('purejsimage/jpeg')).toBe(true)
    expect(usesCodecAdapterReader('purejsimage/gsf')).toBe(false)
  })

  it('serves interior JPEG tiles after an origin decode', async () => {
    const bytes = await encodedJpeg()
    const document = await new ScientificReaderRegistry([jpegReader]).open({
      primary: { id: 'jpeg', name: 'pattern.jpg', source: new MemorySource(bytes) },
    })
    const dataset = await document.openDataset(document.datasets[0]?.id ?? 'image')
    const cached = cacheCodecAdapterPlane(
      resolveNumericTileSource(dataset, { targetSampleType: 'float32' }),
    )
    const tiles = []
    for await (const tile of cached.readNumericTiles({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      x: 16,
      y: 16,
      width: 16,
      height: 16,
      targetSampleType: 'float32',
    })) {
      tiles.push(tile)
    }
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toMatchObject({ x: 16, y: 16, width: 16, height: 16 })
    expect(tiles[0]?.data.some((value) => value > 0)).toBe(true)
    tiles[0]?.release()
    await document.close?.()
  })

  it('serves interior JPEG plane reads for analysis through a wrapped dataset', async () => {
    const bytes = await encodedJpeg()
    const document = await new ScientificReaderRegistry([jpegReader]).open({
      primary: { id: 'jpeg', name: 'pattern.jpg', source: new MemorySource(bytes) },
    })
    const dataset = wrapCodecAdapterDataset(
      await document.openDataset(document.datasets[0]?.id ?? 'image'),
      'purejsimage/jpeg',
    )
    const blocks = []
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      x: 16,
      y: 16,
      width: 16,
      height: 16,
    })) {
      blocks.push(block)
    }
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ x: 16, y: 16, width: 16, height: 16 })
    expect(blocks[0]?.data.some((value) => value > 0)).toBe(true)
    await document.close?.()
  })

  it('reuses a shared numeric plane cache for analysis reads', async () => {
    const bytes = await encodedJpeg()
    const document = await new ScientificReaderRegistry([jpegReader]).open({
      primary: { id: 'jpeg', name: 'pattern.jpg', source: new MemorySource(bytes) },
    })
    const dataset = await document.openDataset(document.datasets[0]?.id ?? 'image')
    const numeric = cacheCodecAdapterPlane(
      resolveNumericTileSource(dataset, { targetSampleType: 'float32' }),
    )
    const wrapped = wrapCodecAdapterDataset(dataset, 'purejsimage/jpeg', numeric)
    const tiles = []
    for await (const tile of numeric.readNumericTiles({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      x: 0,
      y: 0,
      width: 8,
      height: 8,
      targetSampleType: 'float32',
    })) {
      tiles.push(tile)
    }
    const blocks = []
    for await (const block of wrapped.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      x: 0,
      y: 0,
      width: 8,
      height: 8,
    })) {
      blocks.push(block)
    }
    expect(tiles).toHaveLength(1)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.data[0]).toBe(Math.round(tiles[0]?.data[0] ?? Number.NaN))
    tiles[0]?.release()
    await document.close?.()
  })
})
