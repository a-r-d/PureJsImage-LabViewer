const encoder = new TextEncoder()

const SPATIAL_CONVENTION = {
  uuid: '689b58e2-cf7b-45e0-9fff-9cfc0883d6b4',
  name: 'spatial',
} as const

const PROJ_CONVENTION = {
  uuid: 'f17cb550-5864-4468-aeb7-f3180cfb622f',
  name: 'proj',
} as const

function uint16Chunk(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(8)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < 4; index += 1) view.setUint16(index * 2, value + index, true)
  return bytes
}

/** Deterministic bundled multidimensional GeoZarr v3 array: time, band, Y, X. */
export function multidimensionalGeoZarrFixture(): ReadonlyMap<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  files.set(
    'zarr.json',
    encoder.encode(
      JSON.stringify({
        zarr_format: 3,
        node_type: 'array',
        shape: [2, 2, 4, 4],
        data_type: 'uint16',
        chunk_grid: { name: 'regular', configuration: { chunk_shape: [1, 1, 2, 2] } },
        chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
        fill_value: 0,
        codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
        dimension_names: ['time', 'band', 'y', 'x'],
        attributes: {
          title: 'Deterministic time-band GeoZarr',
          zarr_conventions: [SPATIAL_CONVENTION, PROJ_CONVENTION],
          'spatial:dimensions': ['y', 'x'],
          'spatial:transform_type': 'affine',
          'spatial:transform': [10, 0, 100, 0, -10, 200],
          'spatial:shape': [4, 4],
          'spatial:registration': 'pixel',
          'proj:code': 'EPSG:4326',
          'proj:wkt2': 'GEOGCRS["WGS 84",ID["EPSG",4326]]',
          'proj:projjson': {
            type: 'GeographicCRS',
            name: 'WGS 84',
            id: { authority: 'EPSG', code: 4326 },
            coordinate_system: {
              axis: [
                {
                  name: 'Geodetic latitude',
                  abbreviation: 'Lat',
                  direction: 'north',
                  unit: { name: 'degree', conversion_factor: 0.0174532925199433 },
                },
                {
                  name: 'Geodetic longitude',
                  abbreviation: 'Lon',
                  direction: 'east',
                  unit: { name: 'degree', conversion_factor: 0.0174532925199433 },
                },
              ],
            },
          },
          units: 'reflectance',
          scale_factor: 0.01,
          add_offset: 1,
        },
      }),
    ),
  )
  for (let time = 0; time < 2; time += 1) {
    for (let band = 0; band < 2; band += 1) {
      for (let y = 0; y < 2; y += 1) {
        for (let x = 0; x < 2; x += 1) {
          files.set(
            `c/${time}/${band}/${y}/${x}`,
            uint16Chunk(time * 1_000 + band * 100 + y * 10 + x),
          )
        }
      }
    }
  }
  return files
}
