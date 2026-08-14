import { MemorySource } from 'purejsimage'
import {
  type ScientificCompanionResolver,
  type ScientificReader,
  ScientificReaderRegistry,
} from 'purejsimage/scientific'
import { aperioSvsReader } from 'purejsimage/scientific/readers/aperio-svs'
import { cbfReader } from 'purejsimage/scientific/readers/cbf'
import { enviReader } from 'purejsimage/scientific/readers/envi'
import { fitsReader } from 'purejsimage/scientific/readers/fits'
import { encodeGsf, gsfReader } from 'purejsimage/scientific/readers/gsf'
import { mrcReader } from 'purejsimage/scientific/readers/mrc'
import { omeTiffReader } from 'purejsimage/scientific/readers/ome-tiff'
import { describe, expect, it } from 'vitest'

interface TiffEntry {
  readonly tag: number
  readonly type: 2 | 3 | 4
  readonly values: readonly number[]
}

function classicTiff(description: string): Uint8Array<ArrayBuffer> {
  const pixels = Uint8Array.of(10, 20, 30, 40, 50, 60)
  const ascii = [...new TextEncoder().encode(description), 0]
  const initial: readonly TiffEntry[] = [
    { tag: 256, type: 4, values: [2] },
    { tag: 257, type: 4, values: [1] },
    { tag: 258, type: 3, values: [8, 8, 8] },
    { tag: 259, type: 3, values: [1] },
    { tag: 262, type: 3, values: [2] },
    { tag: 270, type: 2, values: ascii },
    { tag: 273, type: 4, values: [0] },
    { tag: 277, type: 3, values: [3] },
    { tag: 278, type: 4, values: [1] },
    { tag: 279, type: 4, values: [pixels.byteLength] },
    { tag: 284, type: 3, values: [1] },
  ]
  const entries = [...initial].sort((left, right) => left.tag - right.tag)
  const ifdBytes = 2 + entries.length * 12 + 4
  const externalBytes = entries.reduce((total, entry) => {
    const bytes = entry.values.length * (entry.type === 3 ? 2 : entry.type === 4 ? 4 : 1)
    return total + (bytes > 4 ? bytes : 0)
  }, 0)
  const pixelOffset = 8 + ifdBytes + externalBytes
  const output = new Uint8Array(pixelOffset + pixels.byteLength)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0])
  view.setUint32(4, 8, true)
  view.setUint16(8, entries.length, true)
  let externalOffset = 8 + ifdBytes
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry === undefined) continue
    const offset = 10 + index * 12
    const values = entry.tag === 273 ? [pixelOffset] : entry.values
    const itemBytes = entry.type === 3 ? 2 : entry.type === 4 ? 4 : 1
    const bytes = values.length * itemBytes
    view.setUint16(offset, entry.tag, true)
    view.setUint16(offset + 2, entry.type, true)
    view.setUint32(offset + 4, values.length, true)
    const valueOffset = bytes > 4 ? externalOffset : offset + 8
    if (bytes > 4) {
      view.setUint32(offset + 8, externalOffset, true)
      externalOffset += bytes
    }
    values.forEach((value, valueIndex) => {
      const destination = valueOffset + valueIndex * itemBytes
      if (entry.type === 3) view.setUint16(destination, value, true)
      else if (entry.type === 4) view.setUint32(destination, value, true)
      else output[destination] = value
    })
  }
  view.setUint32(10 + entries.length * 12, 0, true)
  output.set(pixels, pixelOffset)
  return output
}

function aperioPyramidFixture(): Uint8Array<ArrayBuffer> {
  const nodes = [
    {
      width: 4,
      height: 4,
      tiled: true,
      description: 'Aperio Image Library v12.4.3 | MPP = 0.5 | AppMag = 20',
      pixels: Uint8Array.from({ length: 4 * 4 * 3 }, (_, index) => index),
    },
    {
      width: 2,
      height: 2,
      tiled: true,
      description: '',
      pixels: Uint8Array.from({ length: 2 * 2 * 3 }, (_, index) => 50 + index),
    },
    {
      width: 2,
      height: 1,
      tiled: false,
      description: 'label',
      pixels: Uint8Array.of(1, 2, 3, 4, 5, 6),
    },
  ] as const
  const entryCounts = nodes.map(
    ({ tiled, description }) => 8 + (tiled ? 4 : 3) + (description.length > 0 ? 1 : 0),
  )
  const ifdOffsets: number[] = []
  let cursor = 8
  for (const count of entryCounts) {
    ifdOffsets.push(cursor)
    cursor += 2 + count * 12 + 4
  }
  const bitsOffsets: number[] = []
  const descriptionOffsets: number[] = []
  for (const node of nodes) {
    bitsOffsets.push(cursor)
    cursor += 6
    descriptionOffsets.push(cursor)
    cursor +=
      node.description.length > 0 ? new TextEncoder().encode(node.description).length + 1 : 0
  }
  const pixelOffsets: number[] = []
  for (const node of nodes) {
    pixelOffsets.push(cursor)
    cursor += node.pixels.byteLength
  }
  const output = new Uint8Array(cursor)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0])
  view.setUint32(4, ifdOffsets[0] ?? 0, true)
  nodes.forEach((node, nodeIndex) => {
    const bitsOffset = bitsOffsets[nodeIndex] ?? 0
    view.setUint16(bitsOffset, 8, true)
    view.setUint16(bitsOffset + 2, 8, true)
    view.setUint16(bitsOffset + 4, 8, true)
    const encodedDescription = new TextEncoder().encode(node.description)
    if (encodedDescription.length > 0) {
      output.set(encodedDescription, descriptionOffsets[nodeIndex] ?? 0)
    }
    const entries: TiffEntry[] = [
      { tag: 256, type: 4, values: [node.width] },
      { tag: 257, type: 4, values: [node.height] },
      { tag: 258, type: 3, values: [bitsOffset] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [2] },
      ...(encodedDescription.length === 0
        ? []
        : [
            {
              tag: 270,
              type: 2 as const,
              values: [descriptionOffsets[nodeIndex] ?? 0, encodedDescription.length + 1],
            },
          ]),
      { tag: 277, type: 3, values: [3] },
      { tag: 284, type: 3, values: [1] },
      ...(node.tiled
        ? [
            { tag: 322, type: 4 as const, values: [node.width] },
            { tag: 323, type: 4 as const, values: [node.height] },
            { tag: 324, type: 4 as const, values: [pixelOffsets[nodeIndex] ?? 0] },
            { tag: 325, type: 4 as const, values: [node.pixels.byteLength] },
          ]
        : [
            { tag: 273, type: 4 as const, values: [pixelOffsets[nodeIndex] ?? 0] },
            { tag: 278, type: 4 as const, values: [node.height] },
            { tag: 279, type: 4 as const, values: [node.pixels.byteLength] },
          ]),
    ].sort((left, right) => left.tag - right.tag)
    const ifdOffset = ifdOffsets[nodeIndex] ?? 0
    view.setUint16(ifdOffset, entries.length, true)
    entries.forEach((entry, entryIndex) => {
      const offset = ifdOffset + 2 + entryIndex * 12
      view.setUint16(offset, entry.tag, true)
      view.setUint16(offset + 2, entry.type, true)
      if (entry.tag === 258) {
        view.setUint32(offset + 4, 3, true)
        view.setUint32(offset + 8, entry.values[0] ?? 0, true)
      } else if (entry.tag === 270) {
        view.setUint32(offset + 4, entry.values[1] ?? 0, true)
        view.setUint32(offset + 8, entry.values[0] ?? 0, true)
      } else {
        view.setUint32(offset + 4, 1, true)
        if (entry.type === 3) view.setUint16(offset + 8, entry.values[0] ?? 0, true)
        else view.setUint32(offset + 8, entry.values[0] ?? 0, true)
      }
    })
    view.setUint32(ifdOffset + 2 + entries.length * 12, ifdOffsets[nodeIndex + 1] ?? 0, true)
    output.set(node.pixels, pixelOffsets[nodeIndex] ?? 0)
  })
  return output
}

function mrcFixture(): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(1_032)
  const view = new DataView(output.buffer)
  const integer = (offset: number, value: number): void => view.setInt32(offset, value, true)
  const real = (offset: number, value: number): void => view.setFloat32(offset, value, true)
  integer(0, 2)
  integer(4, 2)
  integer(8, 1)
  integer(12, 1)
  integer(28, 2)
  integer(32, 2)
  integer(36, 1)
  real(40, 0.84)
  real(44, 0.84)
  real(48, 0.42)
  real(52, 90)
  real(56, 90)
  real(60, 90)
  integer(64, 1)
  integer(68, 2)
  integer(72, 3)
  output.set(new TextEncoder().encode('MAP '), 208)
  output.set([0x44, 0x44, 0, 0], 212)
  ;[10, 20, 30, 40].forEach((value, index) => {
    view.setInt16(1_024 + index * 2, value, true)
  })
  return output
}

function cbfFixture(): Uint8Array<ArrayBuffer> {
  const binary = Uint8Array.of(1, 2, 3, 4)
  const header = new TextEncoder().encode(`###CBF: VERSION 1.5
data_test
_array_data.data
;
--CIF-BINARY-FORMAT-SECTION--
Content-Type: application/octet-stream; conversions="x-CBF_BYTE_OFFSET"
Content-Transfer-Encoding: BINARY
X-Binary-Size: 4
X-Binary-ID: 1
X-Binary-Element-Type: "signed 32-bit integer"
X-Binary-Element-Byte-Order: LITTLE_ENDIAN
X-Binary-Number-of-Elements: 4
X-Binary-Size-Fastest-Dimension: 2
X-Binary-Size-Second-Dimension: 2
X-Binary-Size-Padding: 0

`)
  const marker = Uint8Array.of(0x0c, 0x1a, 0x04, 0xd5)
  const footer = new TextEncoder().encode('\n--CIF-BINARY-FORMAT-SECTION----\n;\n')
  const output = new Uint8Array(header.length + marker.length + binary.length + footer.length)
  output.set(header)
  output.set(marker, header.length)
  output.set(binary, header.length + marker.length)
  output.set(footer, header.length + marker.length + binary.length)
  return output
}

function fitsFixture(): Uint8Array<ArrayBuffer> {
  const card = (keyword: string, value?: string | number | boolean): string => {
    if (value === undefined) return keyword.padEnd(80, ' ')
    const text = typeof value === 'boolean' ? (value ? 'T' : 'F') : String(value)
    return `${keyword.padEnd(8, ' ')}= ${text.padStart(20, ' ')}`.padEnd(80, ' ')
  }
  const cards = [
    card('SIMPLE', true),
    card('BITPIX', 16),
    card('NAXIS', 2),
    card('NAXIS1', 2),
    card('NAXIS2', 2),
    card('END'),
  ]
  const output = new Uint8Array(5_760)
  output.fill(0x20, 0, 2_880)
  output.set(new TextEncoder().encode(cards.join('')))
  const view = new DataView(output.buffer)
  ;[1, 2, 3, 4].forEach((value, index) => {
    view.setInt16(2_880 + index * 2, value, false)
  })
  return output
}

async function smoke(
  reader: ScientificReader,
  name: string,
  bytes: Uint8Array,
  companions?: ScientificCompanionResolver,
): Promise<readonly string[]> {
  const document = await new ScientificReaderRegistry([reader]).open({
    primary: { id: 'primary', name, source: new MemorySource(bytes) },
    ...(companions === undefined ? {} : { companions }),
    readerId: reader.descriptor.id,
  })
  expect(document.datasets.length).toBeGreaterThan(0)
  const summary = document.datasets[0]
  if (summary === undefined) throw new Error('Fixture has no dataset')
  const dataset = await document.openDataset(summary.id)
  const pair =
    dataset.descriptor.capabilities.planeReads.kind === 'ordered-axis-pairs'
      ? dataset.descriptor.capabilities.planeReads.pairs[0]
      : (['x', 'y'] as const)
  if (pair === undefined) throw new Error('Fixture has no plane pair')
  const fixedIndices = dataset.descriptor.axes
    .filter(({ id }) => id !== pair[0] && id !== pair[1])
    .map(({ id }) => ({ axisId: id, index: 0 }))
  const blocks = []
  for await (const block of dataset.readPlane({
    displayAxes: pair,
    fixedIndices,
    x: 0,
    y: 0,
    width: Math.min(2, summary.descriptor.axes.find(({ id }) => id === pair[0])?.length ?? 1),
    height: Math.min(2, summary.descriptor.axes.find(({ id }) => id === pair[1])?.length ?? 1),
  })) {
    blocks.push(block)
    block.release?.()
  }
  expect(blocks.length).toBeGreaterThan(0)
  await document.close?.()
  return document.datasets.map(({ id }) => id)
}

describe('published scientific readers', () => {
  it('opens deterministic GSF, MRC/CCP4, CBF/imgCIF, and FITS fixtures', async () => {
    await expect(
      smoke(gsfReader, 'surface.gsf', encodeGsf({ width: 2, height: 2, values: [1, 2, 3, 4] })),
    ).resolves.toEqual(['surface'])
    await expect(smoke(mrcReader, 'volume.mrc', mrcFixture())).resolves.toEqual(['volume'])
    await expect(smoke(cbfReader, 'detector.cbf', cbfFixture())).resolves.toEqual([
      'detector-frame',
    ])
    await expect(smoke(fitsReader, 'image.fits', fitsFixture())).resolves.toEqual(['hdu-0'])
  })

  it('opens an ENVI header with its generated companion data', async () => {
    const header = new TextEncoder().encode(`ENVI
samples = 2
lines = 2
bands = 1
header offset = 0
file type = ENVI Standard
data type = 1
interleave = bsq
byte order = 0
data file = scene.bin`)
    const data = Uint8Array.of(1, 2, 3, 4)
    await expect(
      smoke(enviReader, 'scene.hdr', header, {
        resolve: async () => ({ id: 'data', name: 'scene.bin', source: new MemorySource(data) }),
      }),
    ).resolves.toEqual(['raster'])
  })

  it('enumerates multiple OME datasets and opens a generated Aperio slide', async () => {
    const image = (index: number) => `<Image ID="Image:${index}"><Pixels ID="Pixels:${index}"
      DimensionOrder="XYCZT" Type="uint8" SizeX="2" SizeY="1" SizeZ="1" SizeC="3" SizeT="1">
      <Channel ID="Channel:${index}" SamplesPerPixel="3"/><TiffData IFD="0" PlaneCount="1"/>
      </Pixels></Image>`
    const ome = classicTiff(`<OME>${image(0)}${image(1)}</OME>`)
    await expect(smoke(omeTiffReader, 'multiple.ome.tiff', ome)).resolves.toEqual([
      'image-0',
      'image-1',
    ])
    const aperio = aperioPyramidFixture()
    const ids = await smoke(aperioSvsReader, 'generated.svs', aperio)
    expect(ids).toEqual(['pyramid', 'associated/label'])
    const aperioDocument = await new ScientificReaderRegistry([aperioSvsReader]).open({
      primary: { id: 'slide', name: 'generated.svs', source: new MemorySource(aperio) },
      readerId: aperioSvsReader.descriptor.id,
    })
    expect(aperioDocument.datasets[0]?.descriptor.levels.map(({ level }) => level)).toEqual([0, 1])
  })
})
