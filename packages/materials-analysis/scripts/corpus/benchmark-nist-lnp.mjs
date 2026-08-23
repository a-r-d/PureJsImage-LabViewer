import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

import {
  applyThreshold,
  binaryMorphology,
  boxFilterPlane,
  evaluateSemanticSegmentation,
  gradientPlane,
  multiscaleContrastPlane,
} from '../../dist/index.js'

import { decodeBinaryMaskFile, decodeImageFile } from './common.mjs'

function options(argv) {
  let inventory
  let condition
  let output
  let maximumPairs
  const profileIds = []
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--inventory') inventory = argv[++index]
    else if (value === '--condition') condition = argv[++index]
    else if (value === '--output') output = argv[++index]
    else if (value === '--max-pairs') maximumPairs = Number(argv[++index])
    else if (value === '--profile') profileIds.push(argv[++index])
    else throw new Error(`Unknown NIST LNP benchmark option ${value}.`)
  }
  if (inventory === undefined || condition === undefined || output === undefined)
    throw new Error(
      'Usage: benchmark-nist-lnp.mjs --inventory <inventory.v1.json> --condition <condition-id> --output <report.json> [--max-pairs <positive-integer>]',
    )
  if (
    maximumPairs !== undefined &&
    (!Number.isSafeInteger(maximumPairs) || maximumPairs < 1 || maximumPairs > 64)
  )
    throw new Error('NIST LNP --max-pairs must be a positive integer no larger than 64.')
  return {
    inventory: path.resolve(inventory),
    condition,
    output: path.resolve(output),
    maximumPairs,
    profileIds,
  }
}

const configurations = [
  {
    id: 'particle-default-light',
    method: 'otsu',
    polarity: 'light',
    minimumCoefficientOfVariation: 0,
    openRadius: 1,
    fillHoles: true,
    minimumSize: 64,
  },
  {
    id: 'bbbc039-guarded-light',
    method: 'otsu',
    polarity: 'light',
    minimumCoefficientOfVariation: 0.1,
    openRadius: 1,
    fillHoles: true,
    minimumSize: 64,
  },
  {
    id: 'cryoem-reference-dark',
    method: 'otsu',
    polarity: 'dark',
    minimumCoefficientOfVariation: 0,
    openRadius: 1,
    fillHoles: true,
    minimumSize: 64,
  },
  ...['triangle', 'yen', 'li', 'mean'].map((method) => ({
    id: `cryoem-${method}-dark`,
    method,
    polarity: 'dark',
    minimumCoefficientOfVariation: 0,
    openRadius: 1,
    fillHoles: true,
    minimumSize: 64,
  })),
  ...['light', 'dark'].map((polarity) => ({
    id: `cryoem-background-32-${polarity}`,
    method: 'otsu',
    polarity,
    minimumCoefficientOfVariation: 0,
    backgroundRadius: 32,
    openRadius: 1,
    fillHoles: true,
    minimumSize: 64,
  })),
  ...[2, 4].map((closeRadius) => ({
    id: `cryoem-sobel-close-${closeRadius}`,
    preprocessing: 'sobel-magnitude',
    method: 'otsu',
    polarity: 'light',
    minimumCoefficientOfVariation: 0,
    openRadius: 0,
    closeRadius,
    fillHoles: true,
    minimumSize: 64,
  })),
  ...['triangle', 'yen', 'li'].map((method) => ({
    id: `cryoem-sobel-${method}`,
    preprocessing: 'sobel-magnitude',
    method,
    polarity: 'light',
    minimumCoefficientOfVariation: 0,
    openRadius: 0,
    closeRadius: 2,
    fillHoles: true,
    minimumSize: 64,
  })),
  ...[
    [2, 8],
    [4, 16],
    [8, 32],
  ].flatMap(([innerRadius, outerRadius]) =>
    ['otsu', 'yen'].map((method) => ({
      id: `cryoem-multiscale-${innerRadius}-${outerRadius}-absolute-${method}`,
      preprocessing: 'multiscale-contrast',
      innerRadius,
      outerRadius,
      contrastPolarity: 'absolute',
      method,
      polarity: 'light',
      minimumCoefficientOfVariation: 0,
      openRadius: 0,
      closeRadius: 2,
      fillHoles: true,
      minimumSize: 64,
    })),
  ),
  ...[
    [4, 16, 4],
    [8, 32, 4],
    [8, 32, 8],
  ].map(([innerRadius, outerRadius, closeRadius]) => ({
    id: `cryoem-multiscale-${innerRadius}-${outerRadius}-dark-otsu-close-${closeRadius}`,
    preprocessing: 'multiscale-contrast',
    innerRadius,
    outerRadius,
    contrastPolarity: 'dark',
    method: 'otsu',
    polarity: 'light',
    minimumCoefficientOfVariation: 0,
    openRadius: 0,
    closeRadius,
    fillHoles: true,
    minimumSize: 64,
  })),
]

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length)
}

const request = options(process.argv.slice(2))
const selectedConfigurations =
  request.profileIds.length === 0
    ? configurations
    : configurations.filter(({ id }) => request.profileIds.includes(id))
if (selectedConfigurations.length !== new Set(request.profileIds).size)
  throw new Error(
    `Unknown or duplicate NIST LNP benchmark profile: ${request.profileIds.join(', ')}.`,
  )
const inventory = JSON.parse(await readFile(request.inventory, 'utf8'))
if (
  inventory.schemaVersion !== 1 ||
  inventory.sourceId !== 'nist-lnp-cryoem' ||
  inventory.labelSemantics !== 'binary-semantic-mask-not-instance-identities' ||
  !Array.isArray(inventory.conditions)
)
  throw new Error('NIST LNP prepared inventory is malformed or has unsafe label semantics.')
const condition = inventory.conditions.find(({ id }) => id === request.condition)
if (condition === undefined) throw new Error(`Unknown NIST LNP condition ${request.condition}.`)
const pairs = condition.pairs.slice(0, request.maximumPairs ?? condition.pairs.length)
if (pairs.length === 0) throw new Error(`NIST LNP condition ${condition.id} contains no pairs.`)
const preparedRoot = path.dirname(request.inventory)
const observations = []
for (const pair of pairs) {
  const decoded = await decodeImageFile(
    pathToFileURL(path.join(preparedRoot, pair.image.path)),
    pair.originalFilename,
  )
  const truth = await decodeBinaryMaskFile(
    pathToFileURL(path.join(preparedRoot, pair.semanticMask.path)),
    pair.semanticMask.originalFilename,
  )
  if (decoded.width !== truth.width || decoded.height !== truth.height || decoded.channels !== 1)
    throw new Error(`NIST LNP pair dimensions do not match for ${pair.id}.`)
  for (const settings of selectedConfigurations) {
    const started = performance.now()
    let values = decoded.values
    if (settings.preprocessing === 'sobel-magnitude')
      values = gradientPlane(
        {
          width: decoded.width,
          height: decoded.height,
          components: 1,
          values: decoded.values,
        },
        'sobel',
        'magnitude',
      ).values
    if (settings.preprocessing === 'multiscale-contrast')
      values = multiscaleContrastPlane(
        {
          width: decoded.width,
          height: decoded.height,
          components: 1,
          values: decoded.values,
        },
        settings.innerRadius,
        settings.outerRadius,
        settings.contrastPolarity,
        'ignore',
      ).values
    if ((settings.backgroundRadius ?? 0) > 0) {
      const background = boxFilterPlane(
        {
          width: decoded.width,
          height: decoded.height,
          components: 1,
          values: decoded.values,
        },
        settings.backgroundRadius,
        { boundary: 'mirror', constantValue: 0, invalidPolicy: 'ignore' },
      )
      values = Float64Array.from(
        decoded.values,
        (value, index) => value - (background.values[index] ?? Number.NaN),
      )
    }
    const threshold = applyThreshold(
      {
        width: decoded.width,
        height: decoded.height,
        components: 1,
        values,
      },
      0,
      {
        method: settings.method,
        polarity: settings.polarity,
        lower: 0,
        upper: 65_535,
        histogramBins: 256,
        windowRadius: 15,
        sauvolaK: 0.2,
        dynamicRange: 32_768,
        minimumCoefficientOfVariation: settings.minimumCoefficientOfVariation,
        noDataPolicy: 'background',
      },
    )
    let predicted = Uint8Array.from(threshold.mask, (value) => (value === 1 ? 1 : 0))
    if (settings.openRadius > 0)
      predicted = binaryMorphology(predicted, decoded.width, decoded.height, {
        kind: 'open',
        radius: settings.openRadius,
      })
    if ((settings.closeRadius ?? 0) > 0)
      predicted = binaryMorphology(predicted, decoded.width, decoded.height, {
        kind: 'close',
        radius: settings.closeRadius,
      })
    if (settings.fillHoles)
      predicted = binaryMorphology(predicted, decoded.width, decoded.height, {
        kind: 'fill-holes',
      })
    if (settings.minimumSize > 1)
      predicted = binaryMorphology(predicted, decoded.width, decoded.height, {
        kind: 'remove-small-objects',
        minimumSize: settings.minimumSize,
        connectivity: 8,
      })
    observations.push({
      fixtureId: pair.id,
      settings,
      threshold: threshold.threshold,
      coefficientOfVariation: threshold.coefficientOfVariation,
      lowInformationRejected: threshold.lowInformationRejected,
      metrics: evaluateSemanticSegmentation({
        predictedMask: predicted,
        truthMask: truth.mask,
        width: decoded.width,
        height: decoded.height,
      }),
      runtimeMilliseconds: performance.now() - started,
    })
    process.stdout.write(`Benchmarked ${pair.id}/${settings.id}.\n`)
  }
}
const summaries = selectedConfigurations.map((settings) => {
  const values = observations.filter(({ settings: candidate }) => candidate.id === settings.id)
  return {
    settings,
    fixtureCount: values.length,
    macroMaskIoU: mean(values.map(({ metrics }) => metrics.maskIoU)),
    macroMaskDice: mean(values.map(({ metrics }) => metrics.maskDice)),
    macroBoundaryF1: mean(values.map(({ metrics }) => metrics.boundaryF1)),
    meanAbsoluteForegroundFractionError: mean(
      values.map(({ metrics }) => Math.abs(metrics.foregroundFractionError)),
    ),
    meanRuntimeMilliseconds: mean(values.map(({ runtimeMilliseconds }) => runtimeMilliseconds)),
  }
})
const report = {
  schemaVersion: 1,
  corpusVersion: inventory.corpusVersion,
  source: inventory.sourceId,
  sourceVersion: inventory.sourceVersion,
  condition: {
    id: condition.id,
    ph: condition.ph,
    rna: condition.rna,
    fixtureCount: pairs.length,
    completeCondition: pairs.length === condition.pairs.length,
  },
  calibration: inventory.calibration,
  labelSemantics: inventory.labelSemantics,
  claimBoundary:
    'These upstream binary masks support semantic mask, boundary, and foreground-fraction evaluation only. They do not support instance matching, merge/split, count-oracle, or particle morphometry claims.',
  summaries,
  observations,
}
await mkdir(path.dirname(request.output), { recursive: true })
await writeFile(request.output, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`Wrote NIST LNP semantic benchmark for ${pairs.length} pairs.\n`)
