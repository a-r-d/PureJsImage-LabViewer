import { readFile, writeFile } from 'node:fs/promises'

import { selectParticleCorpusHardCases } from '../../dist/index.js'

const [inputPath, outputPath] = process.argv.slice(2)
if (inputPath === undefined || outputPath === undefined)
  throw new Error('Usage: select-hard-cases.mjs <feature-report.json> <selection.json>')
const input = JSON.parse(await readFile(inputPath, 'utf8'))
if (!Array.isArray(input)) throw new Error('Feature report must be an array.')
const selection = selectParticleCorpusHardCases(input, Math.min(8, input.length))
await writeFile(outputPath, `${JSON.stringify(selection, null, 2)}\n`)
process.stdout.write(`Selected ${selection.length} deduplicated hard cases.\n`)
