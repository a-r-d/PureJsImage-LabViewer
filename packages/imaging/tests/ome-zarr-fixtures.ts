const encoder = new TextEncoder()

export type OmeZarrStoreFiles = ReadonlyMap<string, Uint8Array>

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value)}\n`)
}

function bytes(fill: number, length: number): Uint8Array {
  return Uint8Array.from({ length }, () => fill)
}

const SPACE_AXES_2D = [
  { name: 'y', type: 'space', unit: 'micrometer' },
  { name: 'x', type: 'space', unit: 'micrometer' },
] as const

const VOLUME_AXES = [
  { name: 't', type: 'time', unit: 'second' },
  { name: 'c', type: 'channel' },
  { name: 'z', type: 'space', unit: 'micrometer' },
  { name: 'y', type: 'space', unit: 'micrometer' },
  { name: 'x', type: 'space', unit: 'micrometer' },
] as const

function v2Group(): Uint8Array {
  return jsonBytes({ zarr_format: 2 })
}

function v2Array(shape: readonly number[], chunks = shape): Uint8Array {
  return jsonBytes({
    zarr_format: 2,
    shape,
    chunks,
    dtype: '|u1',
    compressor: null,
    fill_value: 0,
    order: 'C',
    filters: null,
  })
}

function v2MultiscaleAttrs(options: {
  readonly name: string
  readonly axes?: readonly Readonly<{ name: string; type: string; unit?: string }>[]
  readonly path?: string
  readonly omero?: unknown
  readonly extra?: Readonly<Record<string, unknown>>
}): Uint8Array {
  const axes = options.axes ?? VOLUME_AXES
  return jsonBytes({
    multiscales: [
      {
        version: '0.4',
        name: options.name,
        axes,
        datasets: [
          {
            path: options.path ?? '0',
            coordinateTransformations: [{ type: 'scale', scale: axes.map(() => 1) }],
          },
        ],
      },
    ],
    ...(options.omero === undefined ? {} : { omero: options.omero }),
    ...(options.extra ?? {}),
  })
}

function v3Group(ome: unknown): Uint8Array {
  return jsonBytes({
    zarr_format: 3,
    node_type: 'group',
    attributes: { ome },
  })
}

function v3Array(options: {
  readonly shape: readonly number[]
  readonly chunkShape?: readonly number[]
  readonly dimensionNames?: readonly string[]
  readonly codecs?: unknown
}): Uint8Array {
  return jsonBytes({
    zarr_format: 3,
    node_type: 'array',
    shape: options.shape,
    data_type: 'uint8',
    chunk_grid: {
      name: 'regular',
      configuration: { chunk_shape: options.chunkShape ?? options.shape },
    },
    chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
    fill_value: 0,
    codecs: options.codecs ?? [{ name: 'bytes', configuration: { endian: 'little' } }],
    attributes: {},
    dimension_names: options.dimensionNames ?? ['t', 'c', 'z', 'y', 'x'],
  })
}

function v3Ome(options: {
  readonly name: string
  readonly axes?: readonly Readonly<{ name: string; type: string; unit?: string }>[]
  readonly path?: string
  readonly omero?: unknown
  readonly extra?: Readonly<Record<string, unknown>>
}): unknown {
  const axes = options.axes ?? VOLUME_AXES
  return {
    version: '0.5',
    multiscales: [
      {
        name: options.name,
        axes,
        datasets: [
          {
            path: options.path ?? '0',
            coordinateTransformations: [{ type: 'scale', scale: axes.map(() => 1) }],
          },
        ],
      },
    ],
    ...(options.omero === undefined ? {} : { omero: options.omero }),
    ...(options.extra ?? {}),
  }
}

const TWO_CHANNEL_OMERO_V2 = {
  channels: [
    {
      active: true,
      color: 'FF0000',
      label: 'channel-0',
      coefficient: 1,
      inverted: false,
      window: { min: 0, max: 255, start: 10, end: 200 },
    },
    {
      active: true,
      color: '00FF00',
      label: 'channel-1',
      coefficient: 1,
      inverted: false,
      window: { min: 0, max: 255, start: 5, end: 180 },
    },
  ],
  rdefs: { defaultT: 0, defaultZ: 1, model: 'color' },
}

const TWO_CHANNEL_OMERO_V3 = {
  channels: [
    {
      active: true,
      color: 'FF0000',
      label: 'channel-0',
      coefficient: 1,
      inverted: false,
      window: { min: 0, max: 255, start: 10, end: 200 },
    },
    {
      active: true,
      color: '00FF00',
      label: 'channel-1',
      coefficient: 1,
      inverted: false,
      window: { min: 0, max: 255, start: 5, end: 180 },
    },
  ],
  rdefs: { defaultT: 0, defaultZ: 1, model: 'color' },
}

function volumeChunks(prefix: string, format: 2 | 3, fills: readonly number[]): OmeZarrStoreFiles {
  const files = new Map<string, Uint8Array>()
  let index = 0
  for (let channel = 0; channel < 2; channel += 1) {
    for (let z = 0; z < 3; z += 1) {
      const fill = fills[index] ?? 0
      index += 1
      if (format === 2) {
        files.set(`${prefix}/0.${channel}.${z}.0.0`, bytes(fill, 64))
      } else {
        files.set(`${prefix}/c/0/${channel}/${z}/0/0`, bytes(fill, 64))
      }
    }
  }
  return files
}

export function tinyOmeZarrV2Store(): OmeZarrStoreFiles {
  return new Map([
    ['.zgroup', v2Group()],
    ['.zattrs', v2MultiscaleAttrs({ name: 'v2-image', omero: TWO_CHANNEL_OMERO_V2 })],
    ['0/.zarray', v2Array([1, 2, 3, 8, 8], [1, 1, 1, 8, 8])],
    ...volumeChunks('0', 2, [11, 22, 33, 44, 55, 66]),
  ])
}

export function tinyOmeZarrV3Store(): OmeZarrStoreFiles {
  return new Map([
    ['zarr.json', v3Group(v3Ome({ name: 'v3-image', omero: TWO_CHANNEL_OMERO_V3 }))],
    ['0/zarr.json', v3Array({ shape: [1, 2, 3, 8, 8], chunkShape: [1, 1, 1, 8, 8] })],
    ...volumeChunks('0', 3, [11, 22, 33, 44, 55, 66]),
  ])
}

function writeUint64LE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true)
  view.setUint32(offset + 4, 0, true)
}

export function tinyOmeZarrShardedV3Store(): OmeZarrStoreFiles {
  const inner = 16
  const shard = new Uint8Array(inner * 4 + 16 * 4)
  for (let chunk = 0; chunk < 4; chunk += 1) {
    shard.fill(30 + chunk, chunk * inner, chunk * inner + inner)
    const view = new DataView(shard.buffer)
    writeUint64LE(view, 64 + chunk * 16, chunk * inner)
    writeUint64LE(view, 64 + chunk * 16 + 8, inner)
  }
  return new Map([
    [
      'zarr.json',
      v3Group(
        v3Ome({
          name: 'sharded',
          axes: SPACE_AXES_2D,
          omero: {
            channels: [
              {
                active: true,
                color: 'FFFFFF',
                window: { min: 0, max: 255, start: 0, end: 255 },
              },
            ],
            rdefs: { model: 'greyscale' },
          },
        }),
      ),
    ],
    [
      '0/zarr.json',
      v3Array({
        shape: [8, 8],
        chunkShape: [8, 8],
        dimensionNames: ['y', 'x'],
        codecs: [
          {
            name: 'sharding_indexed',
            configuration: {
              chunk_shape: [4, 4],
              codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
              index_codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
              index_location: 'end',
            },
          },
        ],
      }),
    ],
    ['0/c/0/0', shard],
  ])
}

export function tinyOmeZarrLabelStore(): OmeZarrStoreFiles {
  return new Map([
    ['.zgroup', v2Group()],
    ['.zattrs', v2MultiscaleAttrs({ name: 'labeled' })],
    ['0/.zarray', v2Array([1, 2, 3, 8, 8], [1, 1, 1, 8, 8])],
    ...volumeChunks('0', 2, [1, 2, 3, 4, 5, 6]),
    ['labels/.zgroup', v2Group()],
    ['labels/.zattrs', jsonBytes({ labels: ['cells'] })],
    ['labels/cells/.zgroup', v2Group()],
    [
      'labels/cells/.zattrs',
      v2MultiscaleAttrs({
        name: 'cells',
        extra: {
          'image-label': {
            version: '0.4',
            colors: [{ 'label-value': 1, rgba: [255, 0, 0, 255] }],
            source: { image: '../../' },
          },
        },
      }),
    ],
    ['labels/cells/0/.zarray', v2Array([1, 2, 3, 8, 8], [1, 1, 1, 8, 8])],
    ...volumeChunks('labels/cells/0', 2, [1, 1, 1, 0, 0, 0]),
  ])
}

export function tinyOmeZarrPlateStore(): OmeZarrStoreFiles {
  const fieldAttrs = v2MultiscaleAttrs({ name: 'field-0' })
  return new Map([
    ['.zgroup', v2Group()],
    [
      '.zattrs',
      jsonBytes({
        plate: {
          name: 'plate-1',
          field_count: 1,
          acquisitions: [{ id: 0, name: 'acq-0', maximumfieldcount: 1 }],
          rows: [{ name: 'A' }],
          columns: [{ name: '1' }],
          wells: [{ path: 'A/1', rowIndex: 0, columnIndex: 0 }],
        },
      }),
    ],
    ['A/.zgroup', v2Group()],
    ['A/1/.zgroup', v2Group()],
    ['A/1/.zattrs', jsonBytes({ well: { images: [{ path: '0', acquisition: 0 }] } })],
    ['A/1/0/.zgroup', v2Group()],
    ['A/1/0/.zattrs', fieldAttrs],
    ['A/1/0/0/.zarray', v2Array([1, 2, 3, 8, 8], [1, 1, 1, 8, 8])],
    ...volumeChunks('A/1/0/0', 2, [9, 8, 7, 6, 5, 4]),
  ])
}

export function tinyOmeZarrBioformatsStore(): OmeZarrStoreFiles {
  return new Map([
    ['.zgroup', v2Group()],
    ['.zattrs', jsonBytes({ 'bioformats2raw.layout': 3 })],
    ['0/.zgroup', v2Group()],
    ['0/.zattrs', v2MultiscaleAttrs({ name: 'series-0' })],
    ['0/0/.zarray', v2Array([1, 2, 3, 8, 8], [1, 1, 1, 8, 8])],
    ...volumeChunks('0/0', 2, [3, 3, 3, 4, 4, 4]),
  ])
}

export function unsupportedCodecOmeZarrV2Store(): OmeZarrStoreFiles {
  return new Map([
    ['.zgroup', v2Group()],
    ['.zattrs', v2MultiscaleAttrs({ name: 'gzip', axes: SPACE_AXES_2D })],
    [
      '0/.zarray',
      jsonBytes({
        zarr_format: 2,
        shape: [8, 8],
        chunks: [8, 8],
        dtype: '|u1',
        compressor: { id: 'lz4' },
        fill_value: 0,
        order: 'C',
        filters: null,
      }),
    ],
    ['0/0.0', bytes(1, 64)],
  ])
}

export function malformedOmeZarrStore(): OmeZarrStoreFiles {
  return new Map([
    ['.zgroup', v2Group()],
    ['.zattrs', encoder.encode('{not-json')],
  ])
}

export function storeFiles(files: OmeZarrStoreFiles, prefix = ''): File[] {
  const lead = prefix.length === 0 ? '' : `${prefix.replace(/\/+$/u, '')}/`
  return [...files.entries()].map(
    ([path, contents]) =>
      new File([contents.slice().buffer as ArrayBuffer], `${lead}${path}`, {
        type: 'application/octet-stream',
        lastModified: 0,
      }),
  )
}

function crc32(data: Uint8Array): number {
  let crc = 0xffff_ffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      const take = crc & 1
      crc >>>= 1
      if (take === 1) crc ^= 0xedb8_8320
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0
}

export function zipStore(files: OmeZarrStoreFiles, prefix = ''): Uint8Array {
  const entries = [...files.entries()].map(([path, data]) => ({
    path: prefix.length === 0 ? path : `${prefix.replace(/\/+$/u, '')}/${path}`,
    data,
    crc: crc32(data),
  }))
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.path)
    const local = new Uint8Array(30 + name.byteLength + entry.data.byteLength)
    const localView = new DataView(local.buffer)
    local.set([0x50, 0x4b, 0x03, 0x04])
    localView.setUint16(4, 20, true)
    localView.setUint32(14, entry.crc, true)
    localView.setUint32(18, entry.data.byteLength, true)
    localView.setUint32(22, entry.data.byteLength, true)
    localView.setUint16(26, name.byteLength, true)
    local.set(name, 30)
    local.set(entry.data, 30 + name.byteLength)
    localChunks.push(local)
    const central = new Uint8Array(46 + name.byteLength)
    const centralView = new DataView(central.buffer)
    central.set([0x50, 0x4b, 0x01, 0x02])
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint32(16, entry.crc, true)
    centralView.setUint32(20, entry.data.byteLength, true)
    centralView.setUint32(24, entry.data.byteLength, true)
    centralView.setUint16(28, name.byteLength, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centralChunks.push(central)
    offset += local.byteLength
  }
  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  end.set([0x50, 0x4b, 0x05, 0x06])
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  const output = new Uint8Array(offset + centralSize + end.byteLength)
  let cursor = 0
  for (const chunk of localChunks) {
    output.set(chunk, cursor)
    cursor += chunk.byteLength
  }
  for (const chunk of centralChunks) {
    output.set(chunk, cursor)
    cursor += chunk.byteLength
  }
  output.set(end, cursor)
  return output
}

export function storeFetch(
  rootUrl: string,
  files: OmeZarrStoreFiles,
  options: Readonly<{ hideContentRange?: boolean }> = {},
): typeof fetch {
  const root = new URL(rootUrl.endsWith('/') ? rootUrl : `${rootUrl}/`)
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) {
      return new Response(null, { status: 404 })
    }
    const relative = decodeURIComponent(url.pathname.slice(root.pathname.length))
    const body = files.get(relative)
    if (body === undefined) return new Response(null, { status: 404 })
    const method = init?.method ?? 'GET'
    if (method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: {
          'accept-ranges': 'bytes',
          'content-length': String(body.byteLength),
          etag: `"${relative}"`,
        },
      })
    }
    const range = new Headers(init?.headers).get('range')
    const match = range === null ? null : /^bytes=(\d+)-(\d+)$/u.exec(range)
    const start = match?.[1] === undefined ? 0 : Number(match[1])
    const end = match?.[2] === undefined ? body.byteLength - 1 : Number(match[2])
    const slice = body.slice(start, end + 1)
    const headers: Record<string, string> = {
      'accept-ranges': 'bytes',
      'content-length': String(slice.byteLength),
      etag: `"${relative}"`,
    }
    if (!options.hideContentRange) {
      headers['content-range'] = `bytes ${start}-${start + slice.byteLength - 1}/${body.byteLength}`
    }
    return new Response(slice.slice().buffer, { status: range === null ? 200 : 206, headers })
  }
}
