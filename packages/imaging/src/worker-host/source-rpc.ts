import { RpcValidationError } from '@pji-workbench/contracts'

export function assertRemoteUrl(input: string): URL {
  const url = new URL(input)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new RpcValidationError(
      'INVALID_PAYLOAD',
      'Remote sources must use HTTPS; HTTP is allowed only for localhost development.',
    )
  }
  url.username = ''
  url.password = ''
  return url
}

export function sourceName(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).at(-1)
  return decodeURIComponent(last ?? 'remote-image')
}

export function sampleValues(width: number, height: number): Float32Array {
  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const wave = 38 * Math.sin(x / 29) + 27 * Math.cos(y / 23)
      const particle = (x * 17 + y * 31) % 137 < 5 ? 105 : 0
      values[y * width + x] = 92 + wave + particle + ((x * 13 + y * 7) % 17)
    }
  }
  return values
}
