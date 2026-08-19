#!/usr/bin/env node
/**
 * Opt-in Node probes for Atlas government raster catalogs. Not part of CI.
 *
 *   pnpm geo:probe-catalogs
 *   pnpm geo:probe-catalogs --json
 */
const json = process.argv.includes('--json')

const TARGETS = [
  {
    id: 'noaa-pr-cudem-stac',
    href: 'https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/NCEI_third_Topobathy_PuertoRico_9524/stac/catalog.json',
    kind: 'json',
  },
  {
    id: 'noaa-pr-cudem-tif',
    href: 'https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/NCEI_third_Topobathy_PuertoRico_9524/ncei13_n17x75_w065x75_2022v1.tif',
    kind: 'raster',
  },
  {
    id: 'noaa-palm-coast-tif',
    href: 'https://coastalimagery.blob.core.windows.net/digitalcoast/PalmCoastFL_RGBN_2024_10213/456000e3342000n.tif',
    kind: 'raster',
  },
  {
    id: 'landsat-stac',
    href: 'https://landsatlook.usgs.gov/stac-server/',
    kind: 'json',
  },
  {
    id: 'tnm-datasets',
    href: 'https://tnmaccess.nationalmap.gov/api/v1/datasets',
    kind: 'json',
  },
  {
    id: 'tnm-cincinnati-13',
    href: 'https://tnmaccess.nationalmap.gov/api/v1/products?datasets=National%20Elevation%20Dataset%20(NED)%201%2F3%20arc-second&bbox=-84.6,39.05,-84.4,39.2&max=1&outputFormat=json',
    kind: 'json',
  },
]

async function probe(target) {
  const started = Date.now()
  const result = {
    id: target.id,
    href: target.href,
    kind: target.kind,
    at: new Date().toISOString(),
  }
  try {
    const head = await fetch(target.href, { method: 'HEAD' })
    result.headStatus = head.status
    result.headAllowOrigin = head.headers.get('access-control-allow-origin')
    result.headExpose = head.headers.get('access-control-expose-headers')
    result.headLength = head.headers.get('content-length')
    result.headType = head.headers.get('content-type')
  } catch (error) {
    result.headError = error instanceof Error ? error.message : String(error)
  }
  try {
    const range = await fetch(target.href, {
      method: 'GET',
      headers: { Range: 'bytes=0-65535' },
    })
    const bytes = new Uint8Array(await range.arrayBuffer())
    result.rangeStatus = range.status
    result.rangeAllowOrigin = range.headers.get('access-control-allow-origin')
    result.rangeExpose = range.headers.get('access-control-expose-headers')
    result.rangeContentRange = range.headers.get('content-range')
    result.rangeEncoding = range.headers.get('content-encoding')
    result.bytesRead = bytes.byteLength
    result.tiffMagic = tiffMagic(bytes)
    result.elapsedMs = Date.now() - started
  } catch (error) {
    result.rangeError = error instanceof Error ? error.message : String(error)
    result.elapsedMs = Date.now() - started
  }
  return result
}

function tiffMagic(bytes) {
  if (bytes.byteLength < 4) return 'too-short'
  const ii = bytes[0] === 0x49 && bytes[1] === 0x49
  const mm = bytes[0] === 0x4d && bytes[1] === 0x4d
  if (ii && bytes[2] === 0x2a && bytes[3] === 0x00) return 'classic-tiff-le'
  if (ii && bytes[2] === 0x2b && bytes[3] === 0x00) return 'bigtiff-le'
  if (mm && bytes[2] === 0x00 && bytes[3] === 0x2a) return 'classic-tiff-be'
  if (bytes[0] === 0x7b) return 'json'
  return `unknown-${bytes[0]?.toString(16)}-${bytes[1]?.toString(16)}`
}

const rows = []
for (const target of TARGETS) {
  rows.push(await probe(target))
}

if (json) {
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
} else {
  for (const row of rows) {
    process.stdout.write(
      `${row.id}\n  GET Range ${row.rangeStatus ?? row.rangeError} magic=${row.tiffMagic ?? '-'} ACAO=${row.rangeAllowOrigin ?? row.headAllowOrigin ?? '-'} Content-Range=${row.rangeContentRange ?? '-'}\n`,
    )
  }
}
