import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectBundleInventory, compareBundleInventory } from './bundle-sizes.mjs'

const root = process.cwd()
const HEAVY_RUNTIME_ASSETS = ['worker-entry.js', 'language.worker.js', 'sandbox.worker.js']
const GALLERY_FORBIDDEN_RUNTIME = HEAVY_RUNTIME_ASSETS
const GEO_FORBIDDEN_RUNTIME = ['language.worker.js', 'sandbox.worker.js']
const GALLERY_TOTAL_GZIP_BYTES = 200 * 1024
const GEO_TOTAL_GZIP_BYTES = 2 * 1024 * 1024

function totalGzip(inventory) {
  return inventory.assets.reduce((sum, asset) => sum + asset.gzipBytes, 0)
}

function logInventory(label, inventory) {
  console.log(`${label} (${inventory.buildRoot})`)
  for (const asset of inventory.assets) {
    console.log(`${asset.logicalName}: ${asset.gzipBytes} bytes gzip (${asset.source})`)
  }
}

function heavyRuntimeFailures(application, inventory, forbidden = HEAVY_RUNTIME_ASSETS) {
  return inventory.assets
    .filter((asset) =>
      forbidden.some(
        (name) => asset.logicalName === name || asset.logicalName.startsWith(`${name}#`),
      ),
    )
    .map((asset) => `${application} must not ship ${asset.logicalName} (${asset.source})`)
}

const scienceBuildRoot = path.join(root, 'apps/science/dist')
const scienceBaselinePath = fileURLToPath(
  new URL('../baselines/science-workbench.json', import.meta.url),
)
const scienceBaseline = JSON.parse(await readFile(scienceBaselinePath, 'utf8'))
if (
  scienceBaseline.schemaVersion !== 1 ||
  scienceBaseline.application !== 'science-workbench' ||
  scienceBaseline.bundle === undefined ||
  scienceBaseline.budgets === undefined
) {
  throw new Error('Science workbench bundle baseline is missing or invalid.')
}

const scienceInventory = await collectBundleInventory(scienceBuildRoot)
logInventory('Science', scienceInventory)
const failures = compareBundleInventory(
  scienceInventory,
  scienceBaseline.bundle,
  scienceBaseline.budgets,
)

const galleryInventory = await collectBundleInventory(path.join(root, 'apps/gallery/dist'))
logInventory('Gallery', galleryInventory)
failures.push(...heavyRuntimeFailures('gallery', galleryInventory, GALLERY_FORBIDDEN_RUNTIME))
const galleryGzip = totalGzip(galleryInventory)
if (galleryGzip > GALLERY_TOTAL_GZIP_BYTES) {
  failures.push(
    `gallery total JS gzip is ${galleryGzip} bytes and exceeds the ${GALLERY_TOTAL_GZIP_BYTES}-byte lightweight ceiling`,
  )
}

const geoInventory = await collectBundleInventory(path.join(root, 'apps/geo/dist'))
logInventory('Geo', geoInventory)
failures.push(...heavyRuntimeFailures('geo', geoInventory, GEO_FORBIDDEN_RUNTIME))
const geoGzip = totalGzip(geoInventory)
if (geoGzip > GEO_TOTAL_GZIP_BYTES) {
  failures.push(
    `geo total JS gzip is ${geoGzip} bytes and exceeds the ${GEO_TOTAL_GZIP_BYTES}-byte Atlas ceiling`,
  )
}

if (failures.length > 0) {
  console.error(`Bundle characterization failed:\n${failures.join('\n')}`)
  process.exitCode = 1
}
