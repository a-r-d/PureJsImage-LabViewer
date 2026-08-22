import { readFile } from 'node:fs/promises'

import { validateParticleCorpusManifest } from '../../../test-corpus/dist/index.js'

import { corpusRoot, readManifest, sha256File } from './common.mjs'

const validation = validateParticleCorpusManifest(await readManifest())
if (!validation.ok)
  throw new Error(validation.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'))

const assets = new Map()
for (const fixture of validation.value.fixtures)
  for (const asset of [
    fixture.image,
    fixture.labels.instanceMask,
    fixture.labels.semanticMask,
    fixture.labels.ignoreMask,
  ])
    if (asset !== null) assets.set(asset.path, asset)

let bytes = 0
for (const [path, asset] of assets) {
  const content = await readFile(new URL(path, corpusRoot))
  if (content.byteLength !== asset.sizeBytes)
    throw new Error(`${path} has ${content.byteLength} bytes; expected ${asset.sizeBytes}.`)
  const digest = await sha256File(new URL(path, corpusRoot))
  if (digest !== asset.sha256) throw new Error(`${path} failed SHA-256 verification.`)
  bytes += content.byteLength
}

process.stdout.write(
  `Verified ${validation.value.fixtures.length} particle fixtures, ${assets.size} unique assets, and ${bytes} bytes with no network access.\n`,
)
