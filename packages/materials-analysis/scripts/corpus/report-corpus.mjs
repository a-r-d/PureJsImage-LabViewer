import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  applyThreshold,
  assessParticleRefinement,
  binaryMorphology,
  computeParticleCorpusFeatures,
  createParticleCorpusReport,
  evaluateParticleSegmentation,
  labelBinaryMaskForEvaluation,
  labelColorInstanceMaskForEvaluation,
  renderParticleCorpusReportMarkdown,
  watershedSeparate,
} from '../../dist/index.js'

import { alphaIgnoreMask, decodeCorpusImage, grayscale, readManifest } from './common.mjs'

function outputDirectory(argv) {
  const flag = argv.indexOf('--output')
  const value = flag < 0 ? '.local/particle-corpus' : argv[flag + 1]
  if (value === undefined || value.trim() === '') throw new Error('--output needs a path.')
  return path.resolve(value)
}

function pipeline(image, profile) {
  const settings = {
    thresholdMethod: 'otsu',
    polarity: 'light',
    histogramBins: 256,
    minimumCoefficientOfVariation: profile.minimumCoefficientOfVariation,
    openRadius: 1,
    fillHoles: true,
    minimumSize: 64,
    watershed: profile.watershed,
    minimumPeakDistance: profile.minimumPeakDistance,
    minimumPeakHeight: profile.minimumPeakHeight,
    connectivity: 8,
  }
  const started = performance.now()
  const threshold = applyThreshold(
    { width: image.width, height: image.height, components: 1, values: image.values },
    0,
    {
      method: 'otsu',
      polarity: 'light',
      lower: 0,
      upper: 255,
      histogramBins: 256,
      windowRadius: 15,
      sauvolaK: 0.2,
      dynamicRange: 128,
      minimumCoefficientOfVariation: profile.minimumCoefficientOfVariation,
      noDataPolicy: 'background',
    },
  )
  const binary = Uint8Array.from(threshold.mask, (value) => (value === 1 ? 1 : 0))
  let cleaned = binaryMorphology(binary, image.width, image.height, {
    kind: 'open',
    radius: 1,
  })
  cleaned = binaryMorphology(cleaned, image.width, image.height, { kind: 'fill-holes' })
  cleaned = binaryMorphology(cleaned, image.width, image.height, {
    kind: 'remove-small-objects',
    minimumSize: 64,
    connectivity: 8,
  })
  if (profile.watershed)
    cleaned = watershedSeparate(cleaned, image.width, image.height, {
      minimumPeakDistance: profile.minimumPeakDistance,
      minimumPeakHeight: profile.minimumPeakHeight,
    })
  const labels = labelBinaryMaskForEvaluation(cleaned, image.width, image.height)
  return {
    labels,
    settings,
    runtimeMilliseconds: Math.round((performance.now() - started) * 1_000) / 1_000,
    managedPeakBytesEstimate:
      image.values.byteLength +
      threshold.mask.byteLength +
      binary.byteLength +
      cleaned.byteLength +
      labels.byteLength,
  }
}

const manifest = await readManifest()
const evaluated = []
for (const fixture of manifest.fixtures) {
  if (fixture.labels.instanceMask === null) continue
  const decoded = await decodeCorpusImage(fixture.image.path)
  const image = {
    width: decoded.width,
    height: decoded.height,
    values: grayscale(decoded),
  }
  const decodedTruth = await decodeCorpusImage(fixture.labels.instanceMask.path)
  const truth = labelColorInstanceMaskForEvaluation(
    decodedTruth.values,
    decodedTruth.width,
    decodedTruth.height,
    decodedTruth.channels,
  )
  const ignoreMask = alphaIgnoreMask(decoded)
  const baseline = pipeline(image, {
    minimumCoefficientOfVariation: 0,
    watershed: false,
    minimumPeakDistance: 20,
    minimumPeakHeight: 4,
  })
  const refined = pipeline(image, {
    minimumCoefficientOfVariation: 0.1,
    watershed: true,
    minimumPeakDistance: 20,
    minimumPeakHeight: 4,
  })
  const baselineMetrics = evaluateParticleSegmentation({
    predictedLabels: baseline.labels,
    truthLabels: truth,
    width: image.width,
    height: image.height,
    ...(ignoreMask === undefined ? {} : { ignoreMask }),
  })
  const refinedMetrics = evaluateParticleSegmentation({
    predictedLabels: refined.labels,
    truthLabels: truth,
    width: image.width,
    height: image.height,
    ...(ignoreMask === undefined ? {} : { ignoreMask }),
  })
  const features = computeParticleCorpusFeatures({
    id: fixture.id,
    image: image.values,
    instanceLabels: truth,
    width: image.width,
    height: image.height,
    bitDepth: fixture.dimensions.bitDepth,
    channelCount: fixture.dimensions.channels,
  })
  evaluated.push({
    id: fixture.id,
    reviewStatus: fixture.review.status,
    oracleClaim: 'upstream-preview-mask-not-adjudicated-gold',
    baseline: { ...baseline, labels: undefined, metrics: baselineMetrics },
    refined: { ...refined, labels: undefined, metrics: refinedMetrics },
    refinement: assessParticleRefinement(baselineMetrics, refinedMetrics),
    features,
  })
}

const report = createParticleCorpusReport(manifest.corpusVersion, evaluated)
const markdown = renderParticleCorpusReportMarkdown(report)

const destination = outputDirectory(process.argv.slice(2))
await mkdir(destination, { recursive: true })
await writeFile(path.join(destination, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
await writeFile(path.join(destination, 'report.md'), markdown)
process.stdout.write(
  `Wrote ${evaluated.length} evaluated fixtures to ${pathToFileURL(destination).href}.\n`,
)
