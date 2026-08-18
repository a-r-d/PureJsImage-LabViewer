import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const VITE_HASH = /-[A-Za-z0-9_-]{8}(?=\.[A-Za-z0-9]+$)/u

export function logicalAssetName(relativePath) {
  const normalized = relativePath.split(path.sep).join('/')
  const basename = normalized.split('/').at(-1) ?? normalized
  return basename.replace(VITE_HASH, '')
}

export async function collectFiles(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectFiles(file, predicate)))
    else if (predicate(entry.name, file)) files.push(file)
  }
  return files
}

function budgetForAsset(logicalName, budgets) {
  return logicalName.startsWith('language.worker.')
    ? budgets.languageWorkerGzipBytes
    : budgets.routeChunkGzipBytes
}

function budgetKind(logicalName) {
  return logicalName.startsWith('language.worker.') ? 'lazy language Worker' : 'route chunk'
}

export async function collectBundleInventory(buildRoot) {
  const files = await collectFiles(buildRoot, (name) => name.endsWith('.js'))
  const counted = new Map()
  const assets = []
  for (const file of files.sort()) {
    const relative = path.relative(process.cwd(), file).split(path.sep).join('/')
    const logicalName = logicalAssetName(relative)
    const gzipBytes = gzipSync(await readFile(file)).byteLength
    const collision = counted.get(logicalName) ?? 0
    counted.set(logicalName, collision + 1)
    assets.push({
      logicalName: collision === 0 ? logicalName : `${logicalName}#${collision}`,
      source: relative,
      gzipBytes,
    })
  }
  assets.sort(
    (left, right) =>
      left.logicalName.localeCompare(right.logicalName) || left.gzipBytes - right.gzipBytes,
  )
  return { buildRoot: path.relative(process.cwd(), buildRoot).split(path.sep).join('/'), assets }
}

export function compareBundleInventory(inventory, baseline, budgets) {
  const failures = []
  if (inventory.assets.length === 0) {
    failures.push(`No JavaScript build output found under ${inventory.buildRoot}`)
    return failures
  }

  const expected = new Map(baseline.assets.map((asset) => [asset.logicalName, asset.gzipBytes]))
  const actual = new Map(inventory.assets.map((asset) => [asset.logicalName, asset.gzipBytes]))

  for (const [logicalName, gzipBytes] of actual) {
    const budget = budgetForAsset(logicalName, budgets)
    if (gzipBytes > budget) {
      failures.push(
        `${logicalName} is ${gzipBytes} bytes gzip and exceeds the ${budget}-byte ${budgetKind(logicalName)} budget`,
      )
    }
  }

  for (const logicalName of expected.keys()) {
    if (!actual.has(logicalName))
      failures.push(`Recorded science bundle asset is missing: ${logicalName}`)
  }
  for (const logicalName of actual.keys()) {
    if (!expected.has(logicalName)) failures.push(`Unrecorded science bundle asset: ${logicalName}`)
  }
  for (const [logicalName, expectedBytes] of expected) {
    const gzipBytes = actual.get(logicalName)
    if (gzipBytes !== undefined && gzipBytes !== expectedBytes) {
      failures.push(
        `${logicalName} gzip size changed from ${expectedBytes} to ${gzipBytes}; update the reviewed science baseline only after inspecting the diff`,
      )
    }
  }
  return failures
}
