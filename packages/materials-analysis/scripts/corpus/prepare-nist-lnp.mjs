import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { validateArchiveEntries } from '../../../test-corpus/dist/index.js'

import { inspectImageFile, readManifest, sha256File } from './common.mjs'
import { openZipFile } from './zip-file.mjs'

const CONDITIONS = {
  'R111_S404_pH4_1p5pcPEG_noRNA.zip': {
    id: 's404-ph4-no-rna',
    ph: 4,
    rna: false,
  },
  'R111_S405_pH7_1p5pcPEG_noRNA.zip': {
    id: 's405-ph7-no-rna',
    ph: 7.4,
    rna: false,
  },
  'R111_S406_pH4_1p5pcPEG_RNA.zip': {
    id: 's406-ph4-rna',
    ph: 4,
    rna: true,
  },
  'R111_S407_pH7_1p5pcPEG_RNA.zip': {
    id: 's407-ph7-rna',
    ph: 7.4,
    rna: true,
  },
}

const ARCHIVE_BUDGETS = {
  maxFiles: 64,
  maxExpandedBytes: 700_000_000,
  maxFileBytes: 40_000_000,
  maxCompressionRatio: 900,
  maxPathLength: 240,
}

function options(argv) {
  let cache = process.env['PJI_PARTICLE_CORPUS_CACHE']
  let downloadName
  let output
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--cache') cache = argv[++index]
    else if (value === '--download') downloadName = argv[++index]
    else if (value === '--output') output = argv[++index]
    else throw new Error(`Unknown NIST LNP preparation option ${value}.`)
  }
  const cacheRoot = path.resolve(
    cache ?? path.join(homedir(), '.cache', 'purejsimage-lab', 'particle-corpus'),
  )
  return {
    cacheRoot,
    downloadName,
    output: path.resolve(output ?? path.join(cacheRoot, 'nist-lnp-cryoem', 'prepared-v1')),
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function writePinned(file, value, sha256) {
  try {
    const existing = await stat(file)
    if (!existing.isFile()) throw new Error(`Prepared corpus path is not a file: ${file}`)
    if ((await sha256File(pathToFileURL(file))) !== sha256)
      throw new Error(`Prepared corpus file has unexpected bytes: ${file}`)
    return
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.partial-${process.pid}`
  await unlink(temporary).catch(() => undefined)
  try {
    await writeFile(temporary, value, { flag: 'wx' })
    if ((await sha256File(pathToFileURL(temporary))) !== sha256)
      throw new Error(`Prepared corpus write failed verification: ${file}`)
    await rename(temporary, file)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

function pairedEntries(entries, condition, expectedRoot) {
  const files = entries.filter(({ kind }) => kind === 'file')
  const images = new Map()
  const masks = new Map()
  for (const entry of files) {
    const segments = entry.path.split('/')
    const [root, directory, filename] = segments
    if (
      segments.length !== 3 ||
      root !== expectedRoot ||
      directory === undefined ||
      filename === undefined
    )
      throw new Error(`Unexpected NIST LNP archive member ${entry.path}.`)
    if (!entry.path.toLowerCase().endsWith('.tif'))
      throw new Error(`Unexpected non-TIFF NIST LNP member ${entry.path}.`)
    const stem = filename.replace(/_(?:Fra|Fractions_manual_mask)\.tif$/u, '')
    if (stem === filename)
      throw new Error(`Unexpected NIST LNP TIFF naming convention ${entry.path}.`)
    const collection = directory === 'images' ? images : directory === 'masks' ? masks : undefined
    if (collection === undefined)
      throw new Error(`Unexpected NIST LNP archive directory ${entry.path}.`)
    if (collection.has(stem)) throw new Error(`Duplicate NIST LNP acquisition stem ${stem}.`)
    collection.set(stem, { filename, entry })
    const ratio = entry.expandedBytes / Math.max(1, entry.compressedBytes)
    const maximumRatio = directory === 'masks' ? 900 : 2
    if (ratio > maximumRatio)
      throw new Error(
        `NIST LNP ${directory} member exceeds the reviewed ${maximumRatio}:1 compression ratio: ${entry.path}.`,
      )
  }
  if (images.size === 0 || images.size !== masks.size)
    throw new Error(`NIST LNP ${condition.id} has ${images.size} images and ${masks.size} masks.`)
  const stems = [...images.keys()].sort()
  for (const stem of stems)
    if (!masks.has(stem)) throw new Error(`NIST LNP mask is missing for ${stem}.`)
  for (const stem of masks.keys())
    if (!images.has(stem)) throw new Error(`NIST LNP image is missing for ${stem}.`)
  return stems.map((stem) => ({ stem, image: images.get(stem), mask: masks.get(stem) }))
}

const request = options(process.argv.slice(2))
const manifest = await readManifest()
const source = manifest.sources.find(({ id }) => id === 'nist-lnp-cryoem')
if (source === undefined || source.fetchPolicy !== 'core-explicit')
  throw new Error('The checksum-pinned NIST LNP source is not enabled.')
const archives = source.downloads.filter(({ role }) => role === 'archive')
const selected =
  request.downloadName === undefined
    ? archives
    : archives.filter(({ filename }) => filename === request.downloadName)
if (selected.length === 0)
  throw new Error(`No NIST LNP archive named ${request.downloadName ?? '(none)'}.`)

const preparedConditions = []
for (const download of selected) {
  const condition = CONDITIONS[download.filename]
  if (condition === undefined) throw new Error(`Unknown NIST LNP condition ${download.filename}.`)
  const archivePath = path.join(request.cacheRoot, source.id, download.filename)
  const archiveStat = await stat(archivePath)
  if (archiveStat.size !== download.sizeBytes)
    throw new Error(
      `${download.filename} has ${archiveStat.size} bytes; expected ${download.sizeBytes}.`,
    )
  if ((await sha256File(pathToFileURL(archivePath))) !== download.sha256)
    throw new Error(`${download.filename} failed SHA-256 verification.`)

  const archive = await openZipFile(archivePath)
  try {
    const issues = validateArchiveEntries(archive.entries, ARCHIVE_BUDGETS)
    if (issues.length > 0) throw new Error(issues.join('\n'))
    const pairs = pairedEntries(
      archive.entries,
      condition,
      download.filename.replace(/\.zip$/u, ''),
    )
    const preparedPairs = []
    for (const [index, pair] of pairs.entries()) {
      const imageBytes = await pair.image.entry.read()
      const maskBytes = await pair.mask.entry.read()
      const imageSha256 = digest(imageBytes)
      const maskSha256 = digest(maskBytes)
      const relativeImage = path.join(condition.id, 'images', pair.image.filename)
      const relativeMask = path.join(condition.id, 'masks', pair.mask.filename)
      const imagePath = path.join(request.output, relativeImage)
      const maskPath = path.join(request.output, relativeMask)
      await writePinned(imagePath, imageBytes, imageSha256)
      await writePinned(maskPath, maskBytes, maskSha256)
      const [imageInfo, maskInfo] = await Promise.all([
        inspectImageFile(pathToFileURL(imagePath), pair.image.filename),
        inspectImageFile(pathToFileURL(maskPath), pair.mask.filename, {
          collectUniqueValues: true,
          maximumUniqueValues: 2,
        }),
      ])
      if (
        imageInfo.width !== 4096 ||
        imageInfo.height !== 4096 ||
        imageInfo.channels !== 1 ||
        imageInfo.bitDepth !== 16
      )
        throw new Error(`NIST LNP image metadata is unexpected for ${pair.image.filename}.`)
      if (
        maskInfo.width !== imageInfo.width ||
        maskInfo.height !== imageInfo.height ||
        maskInfo.channels !== 1 ||
        maskInfo.bitDepth !== 8 ||
        !['[0]', '[0,255]'].includes(JSON.stringify(maskInfo.uniqueValues))
      )
        throw new Error(`NIST LNP semantic mask is unexpected for ${pair.mask.filename}.`)
      preparedPairs.push({
        id: `nist-lnp-${condition.id}-${String(index + 1).padStart(2, '0')}`,
        acquisitionStem: pair.stem,
        originalFilename: pair.image.filename,
        image: {
          path: relativeImage.split(path.sep).join('/'),
          sha256: imageSha256,
          sizeBytes: imageBytes.byteLength,
          ...imageInfo,
        },
        semanticMask: {
          originalFilename: pair.mask.filename,
          path: relativeMask.split(path.sep).join('/'),
          sha256: maskSha256,
          sizeBytes: maskBytes.byteLength,
          ...maskInfo,
        },
      })
      process.stdout.write(`Prepared ${condition.id}/${pair.stem}.\n`)
    }
    preparedConditions.push({
      ...condition,
      archive: {
        filename: download.filename,
        sha256: download.sha256,
        sizeBytes: download.sizeBytes,
        expandedBytes: archive.entries.reduce((total, entry) => total + entry.expandedBytes, 0),
      },
      pairs: preparedPairs,
    })
  } finally {
    await archive.close()
  }
}

let priorConditions = []
const inventoryPath = path.join(request.output, 'inventory.v1.json')
try {
  const prior = JSON.parse(await readFile(inventoryPath, 'utf8'))
  if (prior.schemaVersion !== 1 || prior.sourceId !== source.id || !Array.isArray(prior.conditions))
    throw new Error('Existing NIST LNP inventory is incompatible.')
  priorConditions = prior.conditions
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const replaced = new Set(preparedConditions.map(({ id }) => id))
const conditions = [
  ...priorConditions.filter(({ id }) => !replaced.has(id)),
  ...preparedConditions,
].sort((left, right) => left.id.localeCompare(right.id))
const inventory = {
  schemaVersion: 1,
  corpusVersion: manifest.corpusVersion,
  sourceId: source.id,
  sourceVersion: '1.0.0',
  calibration: { pixelSize: 0.223, unit: 'nm' },
  labelSemantics: 'binary-semantic-mask-not-instance-identities',
  review: { status: 'upstream-unreviewed', localAdjudication: false },
  conditions,
  totalPairs: conditions.reduce((total, condition) => total + condition.pairs.length, 0),
}
await mkdir(request.output, { recursive: true })
await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`)
process.stdout.write(
  `Prepared ${preparedConditions.reduce((total, condition) => total + condition.pairs.length, 0)} NIST LNP pairs; inventory now contains ${inventory.totalPairs}.\n`,
)
