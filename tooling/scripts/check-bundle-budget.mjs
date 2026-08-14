import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const MAX_ROUTE_CHUNK_GZIP_BYTES = 300 * 1024
const MAX_LAZY_LANGUAGE_WORKER_GZIP_BYTES = 1_000 * 1024
const root = process.cwd()
const buildRoot = path.join(root, 'apps/workbench/dist')

async function collectJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectJavaScript(file)))
    else if (entry.name.endsWith('.js')) files.push(file)
  }
  return files
}

const files = await collectJavaScript(buildRoot)
if (files.length === 0) {
  throw new Error(`No JavaScript build output found under ${path.relative(root, buildRoot)}`)
}

let failed = false
for (const file of files.sort()) {
  const bytes = await readFile(file)
  const gzipBytes = gzipSync(bytes).byteLength
  const relative = path.relative(root, file)
  const budget = path.basename(file).startsWith('language.worker-')
    ? MAX_LAZY_LANGUAGE_WORKER_GZIP_BYTES
    : MAX_ROUTE_CHUNK_GZIP_BYTES
  const budgetKind = path.basename(file).startsWith('language.worker-')
    ? 'lazy language Worker'
    : 'route chunk'
  console.log(`${relative}: ${gzipBytes} bytes gzip`)
  if (gzipBytes > budget) {
    console.error(`${relative} exceeds the ${budget}-byte ${budgetKind} budget`)
    failed = true
  }
}

if (failed) process.exitCode = 1
