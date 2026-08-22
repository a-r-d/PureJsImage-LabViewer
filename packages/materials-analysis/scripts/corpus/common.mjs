import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { MemorySource } from 'purejsimage'
import {
  rasterSampleBytes,
  readRasterSample,
  ScientificReaderRegistry,
} from 'purejsimage/scientific'
import { jpegReader } from 'purejsimage/scientific/readers/jpeg'
import { pngReader } from 'purejsimage/scientific/readers/png'
import { tiffReader } from 'purejsimage/scientific/readers/tiff'

export const corpusRoot = new URL('../../testdata/corpus/', import.meta.url)
export const manifestUrl = new URL('manifest.v1.json', corpusRoot)

export async function readManifest() {
  return JSON.parse(await readFile(manifestUrl, 'utf8'))
}

export async function sha256File(url) {
  return createHash('sha256')
    .update(await readFile(url))
    .digest('hex')
}

export async function decodeCorpusImage(path) {
  return decodeImageFile(new URL(path, corpusRoot), path)
}

export async function decodeImageFile(url, name = url.pathname.split('/').at(-1) ?? 'image') {
  const bytes = await readFile(url)
  const lowerName = name.toLowerCase()
  const reader =
    lowerName.endsWith('.tif') || lowerName.endsWith('.tiff')
      ? tiffReader
      : lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')
        ? jpegReader
        : pngReader
  const document = await new ScientificReaderRegistry([reader]).open({
    primary: { id: name, name, source: new MemorySource(bytes) },
    readerId: reader.descriptor.id,
  })
  try {
    const summary = document.datasets[0]
    if (summary === undefined) throw new Error(`Corpus asset ${name} has no dataset.`)
    const dataset = await document.openDataset(summary.id)
    const xAxis = dataset.descriptor.axes.find(({ id }) => id === 'x')
    const yAxis = dataset.descriptor.axes.find(({ id }) => id === 'y')
    if (xAxis === undefined || yAxis === undefined)
      throw new Error(`Corpus asset ${name} has no XY axes.`)
    const channels = dataset.descriptor.components.length
    const values = new Float64Array(xAxis.length * yAxis.length * channels)
    let bitDepth = 0
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      x: 0,
      y: 0,
      width: xAxis.length,
      height: yAxis.length,
    })) {
      const sampleType = block.format.sampleType
      if (!['uint8', 'uint16', 'int8', 'int16'].includes(sampleType))
        throw new Error(`Corpus asset ${name} has unsupported sample type ${sampleType}.`)
      bitDepth = sampleType.endsWith('16') ? 16 : 8
      const bytesPerSample = rasterSampleBytes(sampleType)
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      const planeStride = block.planeStride ?? block.stride * block.height
      for (let y = 0; y < block.height; y += 1) {
        for (let x = 0; x < block.width; x += 1) {
          for (let channel = 0; channel < channels; channel += 1) {
            const sourceOffset = block.format.planar
              ? channel * planeStride + y * block.stride + x * bytesPerSample
              : y * block.stride + (x * channels + channel) * bytesPerSample
            const targetOffset = ((block.y + y) * xAxis.length + block.x + x) * channels + channel
            values[targetOffset] = readRasterSample(block.data, view, sourceOffset, sampleType)
          }
        }
      }
      block.release?.()
    }
    return { width: xAxis.length, height: yAxis.length, channels, bitDepth, values }
  } finally {
    await document.close?.()
  }
}

export async function inspectImageFile(
  url,
  name = url.pathname.split('/').at(-1) ?? 'image',
  options = {},
) {
  const bytes = await readFile(url)
  const lowerName = name.toLowerCase()
  const reader =
    lowerName.endsWith('.tif') || lowerName.endsWith('.tiff')
      ? tiffReader
      : lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')
        ? jpegReader
        : pngReader
  const document = await new ScientificReaderRegistry([reader]).open({
    primary: { id: name, name, source: new MemorySource(bytes) },
    readerId: reader.descriptor.id,
  })
  try {
    const summary = document.datasets[0]
    if (summary === undefined) throw new Error(`Corpus asset ${name} has no dataset.`)
    const dataset = await document.openDataset(summary.id)
    const xAxis = dataset.descriptor.axes.find(({ id }) => id === 'x')
    const yAxis = dataset.descriptor.axes.find(({ id }) => id === 'y')
    if (xAxis === undefined || yAxis === undefined)
      throw new Error(`Corpus asset ${name} has no XY axes.`)
    const channels = dataset.descriptor.components.length
    const uniqueValues = options.collectUniqueValues === true ? new Set() : undefined
    let sampleType
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      x: 0,
      y: 0,
      width: uniqueValues === undefined ? 1 : xAxis.length,
      height: uniqueValues === undefined ? 1 : yAxis.length,
    })) {
      sampleType = block.format.sampleType
      if (uniqueValues !== undefined) {
        const bytesPerSample = rasterSampleBytes(block.format.sampleType)
        const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
        const planeStride = block.planeStride ?? block.stride * block.height
        for (let y = 0; y < block.height; y += 1)
          for (let x = 0; x < block.width; x += 1)
            for (let channel = 0; channel < channels; channel += 1) {
              const offset = block.format.planar
                ? channel * planeStride + y * block.stride + x * bytesPerSample
                : y * block.stride + (x * channels + channel) * bytesPerSample
              uniqueValues.add(readRasterSample(block.data, view, offset, block.format.sampleType))
              if (uniqueValues.size > (options.maximumUniqueValues ?? 256))
                throw new Error(`Corpus asset ${name} exceeds its unique-value budget.`)
            }
      }
      block.release?.()
    }
    if (sampleType === undefined) throw new Error(`Corpus asset ${name} returned no pixel blocks.`)
    return {
      width: xAxis.length,
      height: yAxis.length,
      channels,
      bitDepth: sampleType.endsWith('16') ? 16 : 8,
      sampleType,
      ...(uniqueValues === undefined
        ? {}
        : { uniqueValues: [...uniqueValues].sort((left, right) => left - right) }),
    }
  } finally {
    await document.close?.()
  }
}

export async function decodeBinaryMaskFile(url, name = url.pathname.split('/').at(-1) ?? 'mask') {
  const bytes = await readFile(url)
  const reader = tiffReader
  const document = await new ScientificReaderRegistry([reader]).open({
    primary: { id: name, name, source: new MemorySource(bytes) },
    readerId: reader.descriptor.id,
  })
  try {
    const summary = document.datasets[0]
    if (summary === undefined) throw new Error(`Corpus mask ${name} has no dataset.`)
    const dataset = await document.openDataset(summary.id)
    const xAxis = dataset.descriptor.axes.find(({ id }) => id === 'x')
    const yAxis = dataset.descriptor.axes.find(({ id }) => id === 'y')
    if (xAxis === undefined || yAxis === undefined || dataset.descriptor.components.length !== 1)
      throw new Error(`Corpus mask ${name} must have one XY component.`)
    const mask = new Uint8Array(xAxis.length * yAxis.length)
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      x: 0,
      y: 0,
      width: xAxis.length,
      height: yAxis.length,
    })) {
      const bytesPerSample = rasterSampleBytes(block.format.sampleType)
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let y = 0; y < block.height; y += 1)
        for (let x = 0; x < block.width; x += 1) {
          const value = readRasterSample(
            block.data,
            view,
            y * block.stride + x * bytesPerSample,
            block.format.sampleType,
          )
          if (value !== 0 && value !== 255)
            throw new Error(`Corpus mask ${name} contains a non-binary value.`)
          mask[(block.y + y) * xAxis.length + block.x + x] = value === 0 ? 0 : 1
        }
      block.release?.()
    }
    return { width: xAxis.length, height: yAxis.length, mask }
  } finally {
    await document.close?.()
  }
}

export function grayscale(image) {
  return Float64Array.from({ length: image.width * image.height }, (_value, index) => {
    const offset = index * image.channels
    if (image.channels === 1) return image.values[offset] ?? 0
    const red = image.values[offset] ?? 0
    const green = image.values[offset + 1] ?? red
    const blue = image.values[offset + 2] ?? red
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  })
}

export function alphaIgnoreMask(image) {
  if (image.channels !== 4) return undefined
  return Uint8Array.from({ length: image.width * image.height }, (_value, index) =>
    image.values[index * image.channels + 3] === 0 ? 1 : 0,
  )
}
