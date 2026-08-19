/** Deterministic north-up GeoTIFF bytes for the geo E2E range server. */

function geoAsciiEntry(tag, value) {
  return { tag, type: 2, values: [...new TextEncoder().encode(value), 0] }
}

function geoKeyEntries() {
  const citation = 'WGS 84|'
  const keys = [
    1_024,
    0,
    1,
    2,
    1_025,
    0,
    1,
    1,
    2_048,
    0,
    1,
    4_326,
    2_049,
    34_737,
    citation.length,
    0,
  ]
  return [
    { tag: 34_735, type: 3, values: [1, 1, 0, keys.length / 4, ...keys] },
    geoAsciiEntry(34_737, citation),
  ]
}

function entryBytes(type) {
  return type === 3 ? 2 : type === 4 ? 4 : type === 12 ? 8 : 1
}

export function northUpGeoTiffFixture() {
  const width = 4
  const height = 2
  const pixels = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)
  const extraEntries = [
    { tag: 33_550, type: 12, values: [10, 20, 0] },
    { tag: 33_922, type: 12, values: [0, 0, 0, 100, 200, 0] },
    ...geoKeyEntries(),
    geoAsciiEntry(42_113, '-9999'),
  ]
  const defaults = [
    { tag: 256, type: 4, values: [width] },
    { tag: 257, type: 4, values: [height] },
    { tag: 258, type: 3, values: [8] },
    { tag: 259, type: 3, values: [1] },
    { tag: 262, type: 3, values: [1] },
    { tag: 273, type: 4, values: [0] },
    { tag: 277, type: 3, values: [1] },
    { tag: 278, type: 4, values: [height] },
    { tag: 279, type: 4, values: [pixels.byteLength] },
    { tag: 284, type: 3, values: [1] },
    { tag: 339, type: 3, values: [1] },
  ]
  const overridden = new Set(extraEntries.map((entry) => entry.tag))
  const entries = [...defaults.filter((entry) => !overridden.has(entry.tag)), ...extraEntries].sort(
    (left, right) => left.tag - right.tag,
  )
  const ifdBytes = 2 + entries.length * 12 + 4
  let cursor = 8 + ifdBytes
  const externalOffsets = new Map()
  for (const entry of entries) {
    const byteLength = entry.values.length * entryBytes(entry.type)
    if (byteLength <= 4) continue
    externalOffsets.set(entry, cursor)
    cursor += byteLength
  }
  const pixelOffset = cursor
  cursor += pixels.byteLength
  const output = new Uint8Array(cursor)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0])
  view.setUint32(4, 8, true)
  view.setUint16(8, entries.length, true)
  entries.forEach((entry, index) => {
    const offset = 10 + index * 12
    const values = entry.tag === 273 ? [pixelOffset] : entry.values
    const byteLength = values.length * entryBytes(entry.type)
    const externalOffset = externalOffsets.get(entry)
    const valuesOffset = externalOffset ?? offset + 8
    view.setUint16(offset, entry.tag, true)
    view.setUint16(offset + 2, entry.type, true)
    view.setUint32(offset + 4, values.length, true)
    if (externalOffset !== undefined) view.setUint32(offset + 8, externalOffset, true)
    values.forEach((value, valueIndex) => {
      const destination = valuesOffset + valueIndex * entryBytes(entry.type)
      if (entry.type === 3) view.setUint16(destination, value, true)
      else if (entry.type === 4) view.setUint32(destination, value, true)
      else if (entry.type === 12) view.setFloat64(destination, value, true)
      else output[destination] = value
    })
    if (byteLength > 4 && externalOffset === undefined) {
      throw new Error('GeoTIFF fixture lost an external value offset')
    }
  })
  view.setUint32(10 + entries.length * 12, 0, true)
  output.set(pixels, pixelOffset)
  return output
}
