import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  computeParticleCorpusFeatures,
  labelColorInstanceMaskForEvaluation,
  selectParticleCorpusHardCases,
} from '../../dist/index.js'

import { decodeImageFile, grayscale } from './common.mjs'

function options(argv) {
  const rootIndex = argv.indexOf('--root')
  const outputIndex = argv.indexOf('--output')
  const root = rootIndex < 0 ? undefined : argv[rootIndex + 1]
  const output = outputIndex < 0 ? undefined : argv[outputIndex + 1]
  if (root === undefined || output === undefined)
    throw new Error('Usage: select-bbbc039.mjs --root <extracted-directory> --output <report.json>')
  return { root: path.resolve(root), output: path.resolve(output) }
}

async function splitNames(root, split) {
  const content = await readFile(path.join(root, 'metadata', `${split}.txt`), 'utf8')
  return content
    .split(/\r?\n/u)
    .map((name) => name.trim())
    .filter((name) => name !== '')
    .sort()
}

const request = options(process.argv.slice(2))
const candidates = []
for (const split of ['training', 'validation', 'test']) {
  const names = await splitNames(request.root, split)
  for (const [arrayIndex, maskName] of names.entries()) {
    const imageName = maskName.replace(/\.png$/u, '.tif')
    const image = await decodeImageFile(
      pathToFileURL(path.join(request.root, 'images', imageName)),
      imageName,
    )
    const mask = await decodeImageFile(
      pathToFileURL(path.join(request.root, 'masks', maskName)),
      maskName,
    )
    if (image.width !== mask.width || image.height !== mask.height)
      throw new Error(`${imageName} and ${maskName} dimensions do not match.`)
    const labels = labelColorInstanceMaskForEvaluation(
      mask.values,
      mask.width,
      mask.height,
      mask.channels,
    )
    candidates.push({
      id: imageName.replace(/\.tif$/u, ''),
      split,
      arrayIndex,
      imageName,
      maskName,
      objectCount: new Set(labels).size - (labels.includes(0) ? 1 : 0),
      features: computeParticleCorpusFeatures({
        id: imageName,
        image: grayscale(image),
        instanceLabels: labels,
        width: image.width,
        height: image.height,
        bitDepth: image.bitDepth,
        channelCount: image.channels,
      }),
    })
    if (candidates.length % 20 === 0)
      process.stdout.write(`Measured ${candidates.length}/200 BBBC039 fields.\n`)
  }
}
const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
const selectionPolicy = {
  training: { maximumCount: 8, clusterCount: 4 },
  validation: { maximumCount: 4, clusterCount: 2 },
  test: { maximumCount: 4, clusterCount: 2 },
}
const selection = Object.entries(selectionPolicy)
  .flatMap(([split, policy]) =>
    selectParticleCorpusHardCases(
      candidates
        .filter((candidate) => candidate.split === split)
        .map(({ id, features }) => ({ id, features })),
      policy.clusterCount,
      policy.maximumCount,
    ),
  )
  .sort((left, right) => left.id.localeCompare(right.id))
const report = {
  schemaVersion: 1,
  source: 'bbbc039-v1',
  candidates: candidates.length,
  selectionPolicy,
  selection: selection.map(({ id, reasons }) => ({ ...byId.get(id), reasons })),
}
await writeFile(request.output, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`Selected ${report.selection.length} unique BBBC039 hard cases.\n`)
