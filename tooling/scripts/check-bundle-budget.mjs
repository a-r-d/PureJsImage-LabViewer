import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectBundleInventory, compareBundleInventory } from './bundle-sizes.mjs'

const root = process.cwd()
const buildRoot = path.join(root, 'apps/workbench/dist')
const baselinePath = fileURLToPath(new URL('../baselines/science-workbench.json', import.meta.url))

const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
if (
  baseline.schemaVersion !== 1 ||
  baseline.application !== 'science-workbench' ||
  baseline.bundle === undefined ||
  baseline.budgets === undefined
) {
  throw new Error('Science workbench bundle baseline is missing or invalid.')
}

const inventory = await collectBundleInventory(buildRoot)
for (const asset of inventory.assets) {
  console.log(`${asset.logicalName}: ${asset.gzipBytes} bytes gzip (${asset.source})`)
}

const failures = compareBundleInventory(inventory, baseline.bundle, baseline.budgets)
if (failures.length > 0) {
  console.error(`Science workbench bundle characterization failed:\n${failures.join('\n')}`)
  process.exitCode = 1
}
