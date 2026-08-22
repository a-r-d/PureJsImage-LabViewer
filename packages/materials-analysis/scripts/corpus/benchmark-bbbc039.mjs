import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  applyThreshold,
  binaryMorphology,
  evaluateParticleSegmentation,
  labelBinaryMaskForEvaluation,
  labelColorInstanceMaskForEvaluation,
  watershedSeparate,
} from '../../dist/index.js'

import { decodeCorpusImage, grayscale, readManifest } from './common.mjs'

function options(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag)
    return index < 0 ? undefined : argv[index + 1]
  }
  const split = value('--split')
  const output = value('--output')
  const allowTest = argv.includes('--allow-test')
  const referenceOnly = argv.includes('--reference-only')
  if (!['train', 'validation', 'test'].includes(split) || output === undefined)
    throw new Error(
      'Usage: benchmark-bbbc039.mjs --split <train|validation|test> --output <report.json> [--allow-test]',
    )
  if (split === 'test' && !allowTest)
    throw new Error('The held-out BBBC039 test split requires the explicit --allow-test flag.')
  return { split, output: path.resolve(output), referenceOnly }
}

function configurations(referenceOnly) {
  const values = [
    {
      id: 'particle-default-before-low-information-guard',
      method: 'otsu',
      polarity: 'light',
      minimumCoefficientOfVariation: 0,
      openRadius: 1,
      minimumSize: 64,
      fillHoles: true,
      watershed: 0,
    },
    {
      id: 'particle-default-with-low-information-guard',
      method: 'otsu',
      polarity: 'light',
      minimumCoefficientOfVariation: 0.1,
      openRadius: 1,
      minimumSize: 64,
      fillHoles: true,
      watershed: 0,
    },
    {
      id: 'bbbc039-watershed-refinement',
      method: 'otsu',
      polarity: 'light',
      minimumCoefficientOfVariation: 0.1,
      openRadius: 1,
      minimumSize: 64,
      fillHoles: true,
      watershed: 20,
      minimumPeakHeight: 4,
    },
  ]
  if (referenceOnly) return values
  for (const method of ['otsu', 'triangle', 'yen', 'li', 'mean'])
    for (const polarity of ['light', 'dark'])
      for (const minimumSize of [1, 50, 100, 200])
        values.push({ method, polarity, minimumSize, fillHoles: false, watershed: 0 })
  for (const windowRadius of [15, 31, 63])
    for (const sauvolaK of [0.1, 0.2, 0.3])
      for (const polarity of ['light', 'dark'])
        for (const minimumSize of [50, 100])
          values.push({
            method: 'sauvola',
            polarity,
            minimumSize,
            fillHoles: false,
            watershed: 0,
            windowRadius,
            sauvolaK,
          })
  for (const watershed of [4, 8, 12, 16, 20, 24, 28, 32])
    for (const minimumPeakHeight of [0, 4, 6, 8, 10, 12])
      values.push({
        method: 'otsu',
        polarity: 'light',
        minimumCoefficientOfVariation: 0.1,
        openRadius: 1,
        minimumSize: 64,
        fillHoles: true,
        watershed,
        minimumPeakHeight,
      })
  return values
}

function thresholdKey(settings) {
  return [
    settings.method,
    settings.polarity,
    settings.windowRadius ?? 15,
    settings.sauvolaK ?? 0.2,
    settings.minimumCoefficientOfVariation ?? 0,
  ].join(':')
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length)
}

const request = options(process.argv.slice(2))
const manifest = await readManifest()
const fixtures = manifest.fixtures
  .filter(({ id, split }) => id.startsWith('bbbc039-native-') && split === request.split)
  .sort((left, right) => left.id.localeCompare(right.id))
if (fixtures.length === 0) throw new Error(`No native BBBC039 ${request.split} fixtures exist.`)
const observations = []
for (const fixture of fixtures) {
  const decoded = await decodeCorpusImage(fixture.image.path)
  const image = grayscale(decoded)
  const decodedMask = await decodeCorpusImage(fixture.labels.instanceMask.path)
  const truth = labelColorInstanceMaskForEvaluation(
    decodedMask.values,
    decodedMask.width,
    decodedMask.height,
    decodedMask.channels,
  )
  const thresholdCache = new Map()
  for (const settings of configurations(request.referenceOnly)) {
    const key = thresholdKey(settings)
    let binary = thresholdCache.get(key)
    if (binary === undefined) {
      const result = applyThreshold(
        { width: decoded.width, height: decoded.height, components: 1, values: image },
        0,
        {
          method: settings.method,
          polarity: settings.polarity,
          lower: 0,
          upper: 255,
          histogramBins: 256,
          windowRadius: settings.windowRadius ?? 15,
          sauvolaK: settings.sauvolaK ?? 0.2,
          dynamicRange: 128,
          minimumCoefficientOfVariation: settings.minimumCoefficientOfVariation ?? 0,
          noDataPolicy: 'background',
        },
      )
      binary = Uint8Array.from(result.mask, (value) => (value === 1 ? 1 : 0))
      thresholdCache.set(key, binary)
    }
    let cleaned = binary
    if ((settings.openRadius ?? 0) > 0)
      cleaned = binaryMorphology(cleaned, decoded.width, decoded.height, {
        kind: 'open',
        radius: settings.openRadius,
      })
    if (settings.fillHoles)
      cleaned = binaryMorphology(cleaned, decoded.width, decoded.height, { kind: 'fill-holes' })
    if (settings.minimumSize > 1)
      cleaned = binaryMorphology(cleaned, decoded.width, decoded.height, {
        kind: 'remove-small-objects',
        minimumSize: settings.minimumSize,
        connectivity: 8,
      })
    if (settings.watershed > 0)
      cleaned = watershedSeparate(cleaned, decoded.width, decoded.height, {
        minimumPeakDistance: settings.watershed,
        minimumPeakHeight: settings.minimumPeakHeight ?? 0,
      })
    const predicted = labelBinaryMaskForEvaluation(cleaned, decoded.width, decoded.height)
    observations.push({
      fixtureId: fixture.id,
      settings,
      metrics: evaluateParticleSegmentation({
        predictedLabels: predicted,
        truthLabels: truth,
        width: decoded.width,
        height: decoded.height,
      }),
    })
  }
  process.stdout.write(`Benchmarked ${fixture.id}.\n`)
}
const byConfiguration = new Map()
for (const observation of observations) {
  const key = JSON.stringify(observation.settings)
  const values = byConfiguration.get(key) ?? []
  values.push(observation)
  byConfiguration.set(key, values)
}
const rankings = [...byConfiguration.entries()]
  .map(([key, values]) => ({
    settings: JSON.parse(key),
    fixtureCount: values.length,
    macroF1: mean(values.map(({ metrics }) => metrics.f1)),
    macroMaskIoU: mean(values.map(({ metrics }) => metrics.maskIoU)),
    macroBoundaryF1: mean(values.map(({ metrics }) => metrics.boundaryF1)),
    meanAbsoluteCountError: mean(
      values.map(({ metrics }) => Math.abs(metrics.countError.includingBorder)),
    ),
    totalTruthCount: values.reduce(
      (total, { metrics }) => total + metrics.truthCount.includingBorder,
      0,
    ),
    totalPredictedCount: values.reduce(
      (total, { metrics }) => total + metrics.predictedCount.includingBorder,
      0,
    ),
  }))
  .sort(
    (left, right) =>
      right.macroF1 - left.macroF1 ||
      right.macroMaskIoU - left.macroMaskIoU ||
      left.meanAbsoluteCountError - right.meanAbsoluteCountError ||
      JSON.stringify(left.settings).localeCompare(JSON.stringify(right.settings)),
  )
const dominates = (left, right) =>
  left.macroF1 >= right.macroF1 &&
  left.macroMaskIoU >= right.macroMaskIoU &&
  left.macroBoundaryF1 >= right.macroBoundaryF1 &&
  left.meanAbsoluteCountError <= right.meanAbsoluteCountError &&
  (left.macroF1 > right.macroF1 ||
    left.macroMaskIoU > right.macroMaskIoU ||
    left.macroBoundaryF1 > right.macroBoundaryF1 ||
    left.meanAbsoluteCountError < right.meanAbsoluteCountError)
const paretoFront = rankings.filter(
  (candidate) => !rankings.some((other) => other !== candidate && dominates(other, candidate)),
)
const referenceComparisons = [
  'particle-default-before-low-information-guard',
  'particle-default-with-low-information-guard',
  'bbbc039-watershed-refinement',
].map((id) => {
  const result = rankings.find(({ settings }) => settings.id === id)
  if (result === undefined) throw new Error(`Missing reference benchmark configuration ${id}.`)
  return result
})
const report = {
  schemaVersion: 2,
  corpusVersion: manifest.corpusVersion,
  source: 'bbbc039-v1-native-selected',
  split: request.split,
  fixtureIds: fixtures.map(({ id }) => id),
  rankingPolicy:
    'The main ranking is descriptive macro instance F1 only. It is not an improvement decision; use the Pareto front and frozen reference comparison across count, instance, mask, and boundary metrics.',
  ranking: rankings,
  paretoFront,
  referenceComparisons,
  observations,
}
await mkdir(path.dirname(request.output), { recursive: true })
await writeFile(request.output, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(
  `Ranked ${rankings.length} configurations; ${paretoFront.length} are non-dominated across count, instance, mask, and boundary metrics.\n`,
)
