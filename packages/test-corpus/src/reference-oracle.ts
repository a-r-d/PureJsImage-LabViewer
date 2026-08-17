import type { GeneratedFixtureResolutionV1 } from './manifest.js'

export interface GeneratedReferenceOracleV1 {
  readonly id: GeneratedFixtureResolutionV1['scenarioId']
  readonly width: number
  readonly height: number
  readonly xStep: number
  readonly yStep: number
  readonly unit: string
  readonly originValue: number
  readonly tolerance: number
  readonly samples: readonly Readonly<{ x: number; y: number; value: number }>[]
}

export interface GeneratedReferenceOracleFileV1 {
  readonly schemaVersion: 1
  readonly reference: Readonly<{ implementation: string; version: string }>
  readonly scenarios: readonly GeneratedReferenceOracleV1[]
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed)
  for (const key of Object.keys(value))
    if (!allowedKeys.has(key)) throw new Error(`${label} has unknown ${key}.`)
}

export function validateGeneratedReferenceOracleFile(
  value: unknown,
): GeneratedReferenceOracleFileV1 {
  if (!record(value) || value['schemaVersion'] !== 1 || !record(value['reference']))
    throw new Error('Generated reference oracle header is invalid.')
  rejectUnknownKeys(
    value,
    ['schemaVersion', 'reference', 'scenarios'],
    'Generated reference oracle',
  )
  const reference = value['reference']
  rejectUnknownKeys(reference, ['implementation', 'version'], 'Generated reference identity')
  if (
    typeof reference['implementation'] !== 'string' ||
    reference['implementation'] === '' ||
    typeof reference['version'] !== 'string' ||
    reference['version'] === ''
  )
    throw new Error('Generated reference implementation identity is invalid.')
  if (!Array.isArray(value['scenarios']) || value['scenarios'].length === 0)
    throw new Error('Generated reference scenarios are required.')
  const scenarioIds = new Set<string>()
  const scenarios = value['scenarios'].map((scenario, index) => {
    if (!record(scenario)) throw new Error(`Generated reference scenario ${index} is invalid.`)
    const keys = new Set([
      'id',
      'width',
      'height',
      'xStep',
      'yStep',
      'unit',
      'originValue',
      'tolerance',
      'samples',
    ])
    for (const key of Object.keys(scenario))
      if (!keys.has(key))
        throw new Error(`Generated reference scenario ${index} has unknown ${key}.`)
    const id = scenario['id']
    if (typeof id !== 'string' || !id.startsWith('generated.'))
      throw new Error(`Generated reference scenario ${index} has an invalid ID.`)
    if (scenarioIds.has(id)) throw new Error(`Generated reference scenario ${id} is duplicated.`)
    scenarioIds.add(id)
    for (const key of ['width', 'height'])
      if (
        typeof scenario[key] !== 'number' ||
        !Number.isSafeInteger(scenario[key]) ||
        scenario[key] <= 0
      )
        throw new Error(`Generated reference scenario ${id} has invalid ${key}.`)
    for (const key of ['xStep', 'yStep', 'tolerance'])
      if (
        typeof scenario[key] !== 'number' ||
        !Number.isFinite(scenario[key]) ||
        scenario[key] <= 0
      )
        throw new Error(`Generated reference scenario ${id} has invalid ${key}.`)
    if (typeof scenario['originValue'] !== 'number' || !Number.isFinite(scenario['originValue']))
      throw new Error(`Generated reference scenario ${id} has invalid originValue.`)
    if (typeof scenario['unit'] !== 'string' || scenario['unit'] === '')
      throw new Error(`Generated reference scenario ${id} has an invalid unit.`)
    if (!Array.isArray(scenario['samples']) || scenario['samples'].length < 2)
      throw new Error(`Generated reference scenario ${id} requires checked samples.`)
    for (const [sampleIndex, sample] of scenario['samples'].entries()) {
      if (!record(sample))
        throw new Error(`Generated reference sample ${id}/${sampleIndex} is invalid.`)
      rejectUnknownKeys(
        sample,
        ['x', 'y', 'value'],
        `Generated reference sample ${id}/${sampleIndex}`,
      )
      for (const key of ['x', 'y', 'value'])
        if (typeof sample[key] !== 'number' || !Number.isFinite(sample[key]))
          throw new Error(`Generated reference sample ${id}/${sampleIndex} has invalid ${key}.`)
      const x = sample['x']
      const y = sample['y']
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        x < 0 ||
        x >= (scenario['width'] as number) ||
        y < 0 ||
        y >= (scenario['height'] as number)
      )
        throw new Error(`Generated reference sample ${id}/${sampleIndex} is out of bounds.`)
    }
    const samples = scenario['samples'].map((sample) => {
      const normalized = sample as Readonly<Record<string, number>>
      return Object.freeze({
        x: normalized['x'] ?? 0,
        y: normalized['y'] ?? 0,
        value: normalized['value'] ?? 0,
      })
    })
    return Object.freeze({
      id,
      width: scenario['width'] as number,
      height: scenario['height'] as number,
      xStep: scenario['xStep'] as number,
      yStep: scenario['yStep'] as number,
      unit: scenario['unit'],
      originValue: scenario['originValue'] as number,
      tolerance: scenario['tolerance'] as number,
      samples: Object.freeze(samples),
    })
  })
  return Object.freeze({
    schemaVersion: 1,
    reference: Object.freeze({
      implementation: reference['implementation'],
      version: reference['version'],
    }),
    scenarios: Object.freeze(scenarios),
  })
}

export function independentOriginValue(scenarioId: string): number {
  if (scenarioId === 'generated.calibrated-particles') return 92 + 5
  if (scenarioId === 'generated.touching-particles') return 38 + 4
  if (scenarioId === 'generated.periodic-lattice') return 100 + 28
  if (scenarioId === 'generated.afm-tilted-surface') return 4 + 0.55
  if (scenarioId === 'generated.batch-particles') return 92 + 5
  if (scenarioId === 'generated.drifting-stack') return 8
  throw new Error(`No independent generated reference for ${scenarioId}.`)
}

function disk(x: number, y: number, centerX: number, centerY: number, radius: number): number {
  const dx = x - centerX
  const dy = y - centerY
  return dx * dx + dy * dy <= radius * radius ? 1 : 0
}

function isolatedCalibratedParticle(
  width: number,
  height: number,
  x: number,
  y: number,
  mirror = false,
): number {
  return (
    [
      [0.22, 0.28, 55],
      [0.48, 0.21, 32],
      [0.73, 0.33, 70],
      [0.36, 0.54, 42],
      [0.61, 0.57, 28],
      [0.84, 0.49, 48],
      [0.17, 0.74, 36],
      [0.43, 0.79, 60],
      [0.67, 0.77, 30],
      [0.88, 0.81, 40],
    ] as const
  ).some(([fx, fy, radius]) => {
    const centerX = Math.round(fx * width)
    const mirroredX = mirror ? width - 1 - centerX : centerX
    const centerY = Math.round(fy * height)
    return disk(x, y, mirroredX, centerY, radius) === 1
  })
    ? 140
    : 0
}

export function independentSampleValue(
  scenarioId: string,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  let value: number
  if (scenarioId === 'generated.periodic-lattice')
    value =
      100 +
      36 * Math.sin((2 * Math.PI * x) / 32) +
      28 * Math.cos((2 * Math.PI * y) / 48) +
      12 * Math.sin((2 * Math.PI * (x + y)) / 96)
  else if (scenarioId === 'generated.afm-tilted-surface')
    value =
      4 +
      x * 0.006 +
      y * 0.003 +
      0.8 * Math.sin(x / 17) +
      0.55 * Math.cos(y / 13) +
      5 * Math.exp(-((x - width * 0.62) ** 2 + (y - height * 0.42) ** 2) / 12_000)
  else if (scenarioId === 'generated.touching-particles') {
    const particles =
      disk(x, y, width * 0.42, height * 0.5, 170) +
      disk(x, y, width * 0.55, height * 0.5, 170) +
      disk(x, y, width * 0.72, height * 0.34, 105)
    value = 38 + 5 * Math.sin(x / 41) + 4 * Math.cos(y / 37) + Math.min(1, particles) * 145
  } else if (scenarioId === 'generated.calibrated-particles') {
    value =
      92 +
      8 * Math.sin(x / 29) +
      5 * Math.cos(y / 23) +
      ((x * 13 + y * 7) % 17) +
      isolatedCalibratedParticle(width, height, x, y)
  } else if (scenarioId === 'generated.batch-particles') {
    value =
      92 +
      8 * Math.sin(x / 29) +
      5 * Math.cos(y / 23) +
      ((x * 13 + y * 7) % 17) +
      isolatedCalibratedParticle(width, height, x, y, true)
  } else if (scenarioId === 'generated.drifting-stack') {
    const dx = x - width * 0.35
    const dy = y - height * 0.5
    const radius = width * 0.12
    value = 8 + (dx * dx + dy * dy <= radius * radius ? 40 : 0) + ((x + y) % 5) * 0.2
  } else throw new Error(`No independent generated reference for ${scenarioId}.`)
  return new Float32Array([value])[0] ?? Number.NaN
}
