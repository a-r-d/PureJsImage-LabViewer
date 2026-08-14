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

export type GeneratedSampleId =
  | 'generated.calibrated-particles'
  | 'generated.touching-particles'
  | 'generated.periodic-lattice'
  | 'generated.afm-tilted-surface'
  | 'generated.batch-particles'

export interface GeneratedSampleDefinition {
  readonly id: GeneratedSampleId
  readonly width: number
  readonly height: number
  readonly filename: string
  readonly title: string
  readonly xyUnit: string
  readonly xReal: number
  readonly yReal: number
  readonly valueUnit: string
}

const SAMPLE_IDS = new Set<GeneratedSampleId>([
  'generated.calibrated-particles',
  'generated.touching-particles',
  'generated.periodic-lattice',
  'generated.afm-tilted-surface',
  'generated.batch-particles',
])

export function generatedSampleDefinition(input: string | undefined): GeneratedSampleDefinition {
  const legacy = input === undefined || input === 'generated-calibrated-sem'
  const id = legacy ? 'generated.calibrated-particles' : input
  if (!SAMPLE_IDS.has(id as GeneratedSampleId)) throw new Error(`Unknown generated sample: ${id}.`)
  const sampleId = id as GeneratedSampleId
  if (sampleId === 'generated.periodic-lattice')
    return {
      id: sampleId,
      width: 1_024,
      height: 1_024,
      filename: 'periodic-lattice.gsf',
      title: 'Generated calibrated periodic lattice',
      xyUnit: 'nm',
      xReal: 81.92,
      yReal: 81.92,
      valueUnit: 'a.u.',
    }
  if (sampleId === 'generated.afm-tilted-surface')
    return {
      id: sampleId,
      width: 1_024,
      height: 768,
      filename: 'afm-tilted-surface.gsf',
      title: 'Generated calibrated AFM tilted surface',
      xyUnit: 'nm',
      xReal: 2_048,
      yReal: 1_536,
      valueUnit: 'nm',
    }
  return {
    id: sampleId,
    width: 2_048,
    height: 1_536,
    filename:
      sampleId === 'generated.touching-particles'
        ? 'touching-particles.gsf'
        : sampleId === 'generated.batch-particles'
          ? 'batch-particles.gsf'
          : 'sample-sem.gsf',
    title:
      sampleId === 'generated.touching-particles'
        ? 'Generated calibrated touching particles'
        : sampleId === 'generated.batch-particles'
          ? 'Generated repeatable particle batch item'
          : 'Generated calibrated SEM-like surface',
    xyUnit: 'nm',
    xReal: sampleId === 'generated.touching-particles' ? 1_024 : 860.16,
    yReal: sampleId === 'generated.touching-particles' ? 768 : 645.12,
    valueUnit: 'a.u.',
  }
}

function disk(x: number, y: number, centerX: number, centerY: number, radius: number): number {
  const dx = x - centerX
  const dy = y - centerY
  return dx * dx + dy * dy <= radius * radius ? 1 : 0
}

export function sampleValues(
  width: number,
  height: number,
  sampleId: GeneratedSampleId = 'generated.calibrated-particles',
): Float32Array {
  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (sampleId === 'generated.periodic-lattice') {
        values[y * width + x] =
          100 +
          36 * Math.sin((2 * Math.PI * x) / 32) +
          28 * Math.cos((2 * Math.PI * y) / 48) +
          12 * Math.sin((2 * Math.PI * (x + y)) / 96)
      } else if (sampleId === 'generated.afm-tilted-surface') {
        const texture = 0.8 * Math.sin(x / 17) + 0.55 * Math.cos(y / 13)
        const feature = 5 * Math.exp(-((x - width * 0.62) ** 2 + (y - height * 0.42) ** 2) / 12_000)
        values[y * width + x] = 4 + x * 0.006 + y * 0.003 + texture + feature
      } else if (sampleId === 'generated.touching-particles') {
        const background = 38 + 5 * Math.sin(x / 41) + 4 * Math.cos(y / 37)
        const particles =
          disk(x, y, width * 0.42, height * 0.5, 170) +
          disk(x, y, width * 0.55, height * 0.5, 170) +
          disk(x, y, width * 0.72, height * 0.34, 105)
        values[y * width + x] = background + Math.min(1, particles) * 145
      } else {
        const wave = 38 * Math.sin(x / 29) + 27 * Math.cos(y / 23)
        const phase = sampleId === 'generated.batch-particles' ? 11 : 0
        const particle = ((x + phase) * 17 + y * 31) % 137 < 5 ? 105 : 0
        values[y * width + x] = 92 + wave + particle + ((x * 13 + y * 7) % 17)
      }
    }
  }
  return values
}
