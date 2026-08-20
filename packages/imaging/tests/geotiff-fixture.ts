interface GeoTiffEntry {
  readonly tag: number
  readonly type: 2 | 3 | 4 | 12
  readonly values: readonly number[]
}

export interface GeoTiffDirectoryFixture {
  readonly width: number
  readonly height: number
  readonly components?: number
  readonly pixels: Uint8Array
  readonly extraEntries?: readonly GeoTiffEntry[]
  readonly tiles?: Readonly<{
    width: number
    height: number
    byteCounts: readonly number[]
  }>
}

export interface GeoTiffFixtureOptions extends GeoTiffDirectoryFixture {
  readonly overview?: GeoTiffDirectoryFixture
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
  const directories = [options, ...(options.overview === undefined ? [] : [options.overview])]
  const entriesFor = (
    directory: GeoTiffDirectoryFixture,
    subIfdOffset: number | undefined,
  ): GeoTiffEntry[] => {
    const components = directory.components ?? 1
    const layoutEntries: readonly GeoTiffEntry[] =
      directory.tiles === undefined
        ? [
            { tag: 273, type: 4, values: [0] },
            { tag: 278, type: 4, values: [directory.height] },
            { tag: 279, type: 4, values: [directory.pixels.byteLength] },
          ]
        : [
            { tag: 322, type: 4, values: [directory.tiles.width] },
            { tag: 323, type: 4, values: [directory.tiles.height] },
            { tag: 324, type: 4, values: directory.tiles.byteCounts.map(() => 0) },
            { tag: 325, type: 4, values: directory.tiles.byteCounts },
          ]
    const defaults: readonly GeoTiffEntry[] = [
      { tag: 256, type: 4, values: [directory.width] },
      { tag: 257, type: 4, values: [directory.height] },
      { tag: 258, type: 3, values: Array.from({ length: components }, () => 8) },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      ...layoutEntries,
      { tag: 277, type: 3, values: [components] },
      { tag: 284, type: 3, values: [1] },
      { tag: 339, type: 3, values: Array.from({ length: components }, () => 1) },
      ...(subIfdOffset === undefined
        ? []
        : [{ tag: 330, type: 4 as const, values: [subIfdOffset] }]),
    ]
    const extra = directory.extraEntries ?? []
    const overridden = new Set(extra.map((entry) => entry.tag))
    return [...defaults.filter((entry) => !overridden.has(entry.tag)), ...extra].sort(
      (left, right) => left.tag - right.tag,
    )
  }
  const placeholders = directories.map((directory, index) =>
    entriesFor(directory, index === 0 && directories.length > 1 ? 0 : undefined),
  )
  const directoryOffsets: number[] = []
  let cursor = 8
  for (const entries of placeholders) {
    directoryOffsets.push(cursor)
    cursor += 2 + entries.length * 12 + 4
  }
  const entriesByDirectory = directories.map((directory, index) =>
    entriesFor(directory, index === 0 && directories.length > 1 ? directoryOffsets[1] : undefined),
  )
  const externalOffsets = new Map<GeoTiffEntry, number>()
  for (const entries of entriesByDirectory) {
    for (const entry of entries) {
      const byteLength = entry.values.length * entryBytes(entry.type)
      if (byteLength <= 4) continue
      externalOffsets.set(entry, cursor)
      cursor += byteLength
    }
  }
  const pixelOffsets: number[] = []
  for (const directory of directories) {
    pixelOffsets.push(cursor)
    cursor += directory.pixels.byteLength
  }
  const output = new Uint8Array(cursor)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0])
  view.setUint32(4, directoryOffsets[0] ?? 8, true)
  for (let directoryIndex = 0; directoryIndex < directories.length; directoryIndex += 1) {
    const directory = directories[directoryIndex]
    const entries = entriesByDirectory[directoryIndex] ?? []
    const directoryOffset = directoryOffsets[directoryIndex] ?? 0
    const pixelOffset = pixelOffsets[directoryIndex] ?? 0
    if (directory === undefined) continue
    view.setUint16(directoryOffset, entries.length, true)
    entries.forEach((entry, index) => {
      const offset = directoryOffset + 2 + index * 12
      let values = entry.tag === 273 ? [pixelOffset] : entry.values
      if (entry.tag === 324 && directory.tiles !== undefined) {
        let tileOffset = pixelOffset
        values = directory.tiles.byteCounts.map((byteCount) => {
          const current = tileOffset
          tileOffset += byteCount
          return current
        })
      }
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
    view.setUint32(directoryOffset + 2 + entries.length * 12, 0, true)
    output.set(directory.pixels, pixelOffset)
    if (directory.tiles !== undefined) {
      const total = directory.tiles.byteCounts.reduce((sum, value) => sum + value, 0)
      if (total !== directory.pixels.byteLength) {
        throw new Error('GeoTIFF tile byte counts do not match the pixel payload')
      }
    }
  }
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

export function fourBandGeoTiffFixture(): Uint8Array<ArrayBuffer> {
  return geoTiffFixture({
    width: 2,
    height: 1,
    components: 4,
    pixels: Uint8Array.of(10, 20, 30, 40, 50, 60, 70, 80),
    extraEntries: [
      { tag: 33_550, type: 12, values: [1, 1, 0] },
      { tag: 33_922, type: 12, values: [0, 0, 0, 0, 1, 0] },
      ...geoKeyEntries(1, { kind: 'geographic', code: 4_326, name: 'WGS 84' }),
    ],
  })
}

export function tiledGradientPyramidGeoTiffFixture(
  fixture: Readonly<{ width?: number; height?: number; tileWidth?: number }> = {},
): Uint8Array<ArrayBuffer> {
  const width = fixture.width ?? 192
  const height = fixture.height ?? 64
  const tileWidth = fixture.tileWidth ?? 64
  if (width % tileWidth !== 0 || width % 2 !== 0 || height % 2 !== 0) {
    throw new Error('Gradient fixture dimensions must align to tiles and the 2x overview')
  }
  const components = 3
  const tiles = Array.from({ length: width / tileWidth }, (_, tileIndex) => {
    const pixels = new Uint8Array(tileWidth * height * components)
    for (let y = 0; y < height; y += 1) {
      for (let localX = 0; localX < tileWidth; localX += 1) {
        const x = tileIndex * tileWidth + localX
        const offset = (y * tileWidth + localX) * components
        pixels[offset] = x % 256
        pixels[offset + 1] = y % 256
        pixels[offset + 2] = (x + y) % 256
      }
    }
    return pixels
  })
  const overviewWidth = width / 2
  const overviewHeight = height / 2
  const overview = new Uint8Array(overviewWidth * overviewHeight * components)
  for (let y = 0; y < overviewHeight; y += 1) {
    for (let x = 0; x < overviewWidth; x += 1) {
      const offset = (y * overviewWidth + x) * components
      overview[offset] = (x * 2) % 256
      overview[offset + 1] = (y * 2) % 256
      overview[offset + 2] = (x * 2 + y * 2) % 256
    }
  }
  return geoTiffFixture({
    width,
    height,
    components,
    pixels: concatenate(tiles),
    tiles: {
      width: tileWidth,
      height,
      byteCounts: tiles.map(({ byteLength }) => byteLength),
    },
    extraEntries: [
      { tag: 33_550, type: 12, values: [1, 1, 0] },
      { tag: 33_922, type: 12, values: [0, 0, 0, 0, height, 0] },
      ...geoKeyEntries(1, { kind: 'geographic', code: 4_326, name: 'WGS 84' }),
    ],
    overview: {
      width: overviewWidth,
      height: overviewHeight,
      components,
      pixels: overview,
      extraEntries: [{ tag: 254, type: 4, values: [1] }],
    },
  })
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
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

export function malformedTilePayloadTiffFixture(): Uint8Array<ArrayBuffer> {
  return geoTiffFixture({
    width: 2,
    height: 1,
    pixels: Uint8Array.of(1),
    extraEntries: [{ tag: 279, type: 4, values: [2] }],
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
