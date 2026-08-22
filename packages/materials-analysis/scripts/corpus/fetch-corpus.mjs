import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

import { readManifest, sha256File } from './common.mjs'

function options(argv) {
  let sourceId
  let downloadName
  let allowExtended = false
  let cache = process.env['PJI_PARTICLE_CORPUS_CACHE']
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--extended') allowExtended = true
    else if (value === '--source') sourceId = argv[++index]
    else if (value === '--download') downloadName = argv[++index]
    else if (value === '--cache') cache = argv[++index]
    else throw new Error(`Unknown corpus fetch option ${value}.`)
  }
  if (sourceId === undefined || sourceId.trim() === '')
    throw new Error('Corpus fetch requires --source <stable-source-id>.')
  return {
    sourceId,
    downloadName,
    allowExtended,
    cache: path.resolve(
      cache ?? path.join(homedir(), '.cache', 'purejsimage-lab', 'particle-corpus'),
    ),
  }
}

const request = options(process.argv.slice(2))
const manifest = await readManifest()
const source = manifest.sources.find(({ id }) => id === request.sourceId)
if (source === undefined) throw new Error(`Unknown particle corpus source ${request.sourceId}.`)
if (source.fetchPolicy === 'blocked') throw new Error(`${source.id} is blocked: ${source.notes}`)
if (source.fetchPolicy === 'extended-opt-in' && !request.allowExtended)
  throw new Error(`${source.id} requires the explicit --extended flag.`)
const downloads =
  request.downloadName === undefined
    ? source.downloads
    : source.downloads.filter(({ filename }) => filename === request.downloadName)
if (downloads.length === 0)
  throw new Error(
    request.downloadName === undefined
      ? `${source.id} has no exact download records.`
      : `${source.id} has no download named ${request.downloadName}.`,
  )
for (const download of downloads)
  if (download.url === undefined || download.sha256 === undefined)
    throw new Error(`${source.id}/${download.filename} lacks an exact URL or SHA-256.`)

const destination = path.join(request.cache, source.id)
await mkdir(destination, { recursive: true })
for (const download of downloads) {
  if (
    path.basename(download.filename) !== download.filename ||
    download.filename === '.' ||
    download.filename === '..' ||
    download.filename.includes('\0')
  )
    throw new Error(`${source.id} has an unsafe download filename.`)
  const finalPath = path.join(destination, download.filename)
  try {
    const existing = await stat(finalPath)
    if (existing.isFile() && (await sha256File(pathToFileURL(finalPath))) === download.sha256) {
      process.stdout.write(`Verified cached ${source.id}/${download.filename}.\n`)
      continue
    }
  } catch {
    // Missing and invalid cache entries are replaced only after a verified temporary download.
  }
  const temporaryPath = `${finalPath}.partial-${process.pid}`
  const response = await fetch(download.url, { redirect: 'follow' })
  if (!response.ok || response.body === null)
    throw new Error(`${source.id}/${download.filename} returned HTTP ${response.status}.`)
  const contentLengthHeader = response.headers.get('content-length')
  const contentLength = contentLengthHeader === null ? undefined : Number(contentLengthHeader)
  if (
    download.sizeBytes !== undefined &&
    contentLength !== undefined &&
    Number.isSafeInteger(contentLength) &&
    contentLength !== download.sizeBytes
  )
    throw new Error(
      `${source.id}/${download.filename} advertises ${contentLength} bytes; expected ${download.sizeBytes}.`,
    )
  const digest = createHash('sha256')
  let bytes = 0
  const meter = new TransformStream({
    transform(chunk, controller) {
      const value = new Uint8Array(chunk)
      bytes += value.byteLength
      if (download.sizeBytes !== undefined && bytes > download.sizeBytes)
        throw new Error(`${source.id}/${download.filename} exceeded its pinned byte size.`)
      digest.update(value)
      controller.enqueue(value)
    },
  })
  try {
    await pipeline(
      Readable.fromWeb(response.body.pipeThrough(meter)),
      createWriteStream(temporaryPath, { flags: 'wx' }),
    )
    const actual = digest.digest('hex')
    if (actual !== download.sha256)
      throw new Error(`${source.id}/${download.filename} failed SHA-256 verification.`)
    if (download.sizeBytes !== undefined && bytes !== download.sizeBytes)
      throw new Error(
        `${source.id}/${download.filename} has ${bytes} bytes; expected ${download.sizeBytes}.`,
      )
    await rename(temporaryPath, finalPath)
    process.stdout.write(
      `Fetched and verified ${source.id}/${download.filename} (${bytes} bytes).\n`,
    )
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}
