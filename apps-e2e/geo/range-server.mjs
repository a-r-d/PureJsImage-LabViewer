import http from 'node:http'
import { northUpGeoTiffFixture } from './support/geotiff-fixture.mjs'

const tiff = northUpGeoTiffFixture()
const bytes = new Uint8Array(256 * 1024)
bytes.set(tiff)
const port = 4175
const host = '127.0.0.1'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'range',
  'access-control-expose-headers': 'accept-ranges, content-range, content-length, etag',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
}

const server = http.createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors)
    response.end()
    return
  }
  const url = new URL(request.url ?? '/', `http://${host}`)
  if (url.pathname === '/health') {
    response.writeHead(204, cors)
    response.end()
    return
  }
  if (url.pathname !== '/north-up.tif' && url.pathname !== '/north-up-later.tif') {
    response.writeHead(404, cors)
    response.end()
    return
  }
  const range = request.headers.range
  const match = typeof range === 'string' ? /^bytes=(\d+)-(\d+)$/u.exec(range) : null
  if (match === null) {
    response.writeHead(416, {
      ...cors,
      'accept-ranges': 'bytes',
      'content-range': `bytes */${bytes.byteLength}`,
    })
    response.end()
    return
  }
  const start = Number(match[1])
  const end = Math.min(Number(match[2]), bytes.byteLength - 1)
  const slice = bytes.subarray(start, end + 1)
  response.writeHead(206, {
    ...cors,
    'accept-ranges': 'bytes',
    'content-type': 'image/tiff',
    'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
    'content-length': String(slice.byteLength),
    etag:
      url.pathname === '/north-up-later.tif'
        ? '"atlas-e2e-north-up-later-v1"'
        : '"atlas-e2e-north-up-v1"',
  })
  response.end(slice)
})

server.listen(port, host, () => {
  process.stdout.write(`geo-range-server ${host}:${port} ${bytes.byteLength} bytes\n`)
})
