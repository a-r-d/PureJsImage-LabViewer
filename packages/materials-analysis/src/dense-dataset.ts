import type {
  NumericArray,
  NumericTile,
  NumericTileSource,
  ScientificDataset,
} from 'purejsimage/scientific'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
} from 'purejsimage/scientific'

import { numericTileRasterBytes } from './provider.js'

export function createDenseScientificDataset(
  descriptorInput: Parameters<typeof normalizeScientificDatasetDescriptor>[0],
  values: NumericArray,
): Readonly<{ dataset: ScientificDataset; release(): void }> {
  const descriptor = normalizeScientificDatasetDescriptor(descriptorInput)
  if (descriptor.components.length !== 1)
    throw new Error('Dense extension datasets currently require one scalar component.')
  const expected = descriptor.axes.reduce((product, axis) => product * axis.length, 1)
  if (!Number.isSafeInteger(expected) || expected !== values.length)
    throw new Error('Dense extension dataset length does not match its descriptor.')
  const strides = new Map<string, number>()
  let stride = 1
  for (const axis of descriptor.axes) {
    strides.set(axis.id, stride)
    stride *= axis.length
  }
  let retained: NumericArray | undefined = values
  const sampleType =
    descriptor.sampleType === 'uint8'
      ? 'uint8'
      : descriptor.sampleType === 'uint32'
        ? 'uint32'
        : 'float32'
  const bytesPerSample = sampleType === 'uint8' ? 1 : 4
  const numericTileSource: NumericTileSource = {
    descriptor,
    directSemantics: {
      sourceSampleType: descriptor.sampleType,
      nativeSampleType: sampleType,
      componentCount: 1,
      layout: 'interleaved',
      supportedTargetSampleTypes: [sampleType],
    },
    planRead(request) {
      const { targetSampleType: _targetSampleType, ...planeRequest } = request
      const normalized = normalizeScientificPlaneReadRequest(descriptor, planeRequest)
      return {
        maximumEmittedTileRetainedBytes: normalized.width * normalized.height * bytesPerSample,
        delivery: 'single-exact',
      }
    },
    async *readNumericTiles(request) {
      const source = retained
      if (source === undefined) throw new Error('Dense extension dataset was released.')
      const { targetSampleType: _targetSampleType, ...planeRequest } = request
      const normalized = normalizeScientificPlaneReadRequest(descriptor, planeRequest)
      const horizontalStride = strides.get(normalized.displayAxes[0])
      const verticalStride = strides.get(normalized.displayAxes[1])
      if (horizontalStride === undefined || verticalStride === undefined)
        throw new Error('Dense extension plane axes are unavailable.')
      let base = 0
      for (const fixed of normalized.fixedIndices) {
        const fixedStride = strides.get(fixed.axisId)
        if (fixedStride === undefined) throw new Error('Dense extension fixed axis is unavailable.')
        base += fixed.index * fixedStride
      }
      const output: NumericArray =
        sampleType === 'uint8'
          ? new Uint8Array(normalized.width * normalized.height)
          : sampleType === 'uint32'
            ? new Uint32Array(normalized.width * normalized.height)
            : new Float32Array(normalized.width * normalized.height)
      for (let y = 0; y < normalized.height; y += 1) {
        normalized.signal?.throwIfAborted()
        for (let x = 0; x < normalized.width; x += 1) {
          const sourceIndex =
            base + (normalized.x + x) * horizontalStride + (normalized.y + y) * verticalStride
          output[y * normalized.width + x] = Number(source[sourceIndex] ?? 0)
        }
      }
      yield {
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
        sampleType,
        componentCount: 1,
        layout: 'interleaved',
        rowStrideElements: normalized.width,
        data: output,
        release: () => undefined,
      } as NumericTile
    },
  }
  const dataset = {
    descriptor,
    numericTileSource,
    async *readPlane(request) {
      for await (const tile of numericTileSource.readNumericTiles(request)) {
        const data = numericTileRasterBytes(tile)
        yield {
          x: tile.x,
          y: tile.y,
          width: tile.width,
          height: tile.height,
          stride: tile.width * bytesPerSample,
          format: { sampleType: tile.sampleType, channels: 1, planar: false },
          data,
          release: tile.release,
        }
      }
    },
  } as ScientificDataset
  return {
    dataset,
    release() {
      retained = undefined
    },
  }
}
