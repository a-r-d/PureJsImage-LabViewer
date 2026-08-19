interface GeoTiffEntry {
  readonly tag: number
  readonly type: 2 | 3 | 4 | 12
  readonly values: readonly number[]
}

export interface GeoTiffFixtureOptions {
  readonly width: number
  readonly height: number
  readonly components?: number
  readonly pixels: Uint8Array
  readonly extraEntries?: readonly GeoTiffEntry[]
}

const entryBytes = (type: GeoTiffEntry['type']): number =>
  type === 3 ? 2 : type === 4 ? 4 : type === 12 ? 8 : 1

export function geoAsciiEntry(tag: number, value: string): GeoTiffEntry {
  return {
    tag,
    type: 2,
    values: [...new TextEncoder().encode(value), 0],
  }
}

export function geoKeyEntries(
  rasterType: 1 | 2,
  crs:
    | { readonly kind: 'projected' | 'geographic'; readonly code: number; readonly name: string }
    | undefined,
): readonly GeoTiffEntry[] {
  const citation = crs === undefined ? undefined : `${crs.name}|`
  const crsKey = crs?.kind === 'projected' ? 3_072 : 2_048
  const citationKey = crs?.kind === 'projected' ? 3_073 : 2_049
  const keys = [
    1_024,
    0,
    1,
    crs?.kind === 'projected' ? 1 : crs?.kind === 'geographic' ? 2 : 0,
    1_025,
    0,
    1,
    rasterType,
    ...(crs === undefined
      ? []
      : [
          crsKey,
          0,
          1,
          crs.code,
          citationKey,
          34_737,
          new TextEncoder().encode(citation ?? '').byteLength,
          0,
        ]),
  ]
  return [
    { tag: 34_735, type: 3, values: [1, 1, 0, keys.length / 4, ...keys] },
    ...(citation === undefined ? [] : [geoAsciiEntry(34_737, citation)]),
  ]
}

export function geoTiffFixture(options: GeoTiffFixtureOptions): Uint8Array<ArrayBuffer> {
  const components = options.components ?? 1
  const defaults = [
    { tag: 256, type: 4 as const, values: [options.width] },
    { tag: 257, type: 4 as const, values: [options.height] },
    { tag: 258, type: 3 as const, values: Array.from({ length: components }, () => 8) },
    { tag: 259, type: 3 as const, values: [1] },
    { tag: 262, type: 3 as const, values: [1] },
    { tag: 273, type: 4 as const, values: [0] },
    { tag: 277, type: 3 as const, values: [components] },
    { tag: 278, type: 4 as const, values: [options.height] },
    { tag: 279, type: 4 as const, values: [options.pixels.byteLength] },
    { tag: 284, type: 3 as const, values: [1] },
    { tag: 339, type: 3 as const, values: Array.from({ length: components }, () => 1) },
  ]
  const extra = options.extraEntries ?? []
  const overridden = new Set(extra.map((entry) => entry.tag))
  const entries = [...defaults.filter((entry) => !overridden.has(entry.tag)), ...extra].sort(
    (left, right) => left.tag - right.tag,
  )
  const ifdBytes = 2 + entries.length * 12 + 4
  let cursor = 8 + ifdBytes
  const externalOffsets = new Map<GeoTiffEntry, number>()
  for (const entry of entries) {
    const byteLength = entry.values.length * entryBytes(entry.type)
    if (byteLength <= 4) continue
    externalOffsets.set(entry, cursor)
    cursor += byteLength
  }
  const pixelOffset = cursor
  cursor += options.pixels.byteLength
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
  output.set(options.pixels, pixelOffset)
  return output
}

export function scientificTiffFixture(): Uint8Array<ArrayBuffer> {
  return geoTiffFixture({
    width: 2,
    height: 1,
    pixels: Uint8Array.of(8, 9),
  })
}

export function northUpGeoTiffFixture(): Uint8Array<ArrayBuffer> {
  return geoTiffFixture({
    width: 4,
    height: 2,
    pixels: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8),
    extraEntries: [
      { tag: 33_550, type: 12, values: [10, 20, 0] },
      { tag: 33_922, type: 12, values: [0, 0, 0, 100, 200, 0] },
      ...geoKeyEntries(1, { kind: 'geographic', code: 4_326, name: 'WGS 84' }),
      geoAsciiEntry(42_113, '-9999'),
    ],
  })
}

export function rgbGeoTiffFixture(): Uint8Array<ArrayBuffer> {
  return geoTiffFixture({
    width: 2,
    height: 1,
    components: 3,
    pixels: Uint8Array.of(10, 20, 30, 40, 50, 0),
    extraEntries: [
      { tag: 33_550, type: 12, values: [1, 1, 0] },
      { tag: 33_922, type: 12, values: [0, 0, 0, 0, 1, 0] },
      ...geoKeyEntries(1, { kind: 'geographic', code: 4_326, name: 'WGS 84' }),
      geoAsciiEntry(42_113, '0'),
    ],
  })
}

export function missingStripTableTiffFixture(): Uint8Array<ArrayBuffer> {
  return geoTiffFixture({
    width: 2,
    height: 1,
    pixels: Uint8Array.of(1, 2),
    extraEntries: [
      { tag: 273, type: 4, values: [] },
      { tag: 279, type: 4, values: [] },
    ],
  })
}

export function unsupportedCompressionTiffFixture(): Uint8Array<ArrayBuffer> {
  return geoTiffFixture({
    width: 2,
    height: 1,
    pixels: Uint8Array.of(1, 2),
    extraEntries: [{ tag: 259, type: 3, values: [50_002] }],
  })
}

export function rotatedGeoTiffFixture(): Uint8Array<ArrayBuffer> {
  return geoTiffFixture({
    width: 4,
    height: 2,
    pixels: new Uint8Array(8),
    extraEntries: [
      {
        tag: 34_264,
        type: 12,
        values: [2, 0.5, 0, 10, -0.25, -3, 0, 20, 0, 0, 1, 0, 0, 0, 0, 1],
      },
      ...geoKeyEntries(1, {
        kind: 'projected',
        code: 32_618,
        name: 'WGS 84 / UTM zone 18N',
      }),
    ],
  })
}

export function unknownCrsGeoTiffFixture(): Uint8Array<ArrayBuffer> {
  return geoTiffFixture({
    width: 1,
    height: 1,
    pixels: Uint8Array.of(1),
    extraEntries: [
      { tag: 33_550, type: 12, values: [1, 1, 0] },
      { tag: 33_922, type: 12, values: [0, 0, 0, 0, 0, 0] },
      ...geoKeyEntries(1, undefined),
    ],
  })
}
