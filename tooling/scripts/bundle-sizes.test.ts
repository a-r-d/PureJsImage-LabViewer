import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { logicalAssetName } from './bundle-sizes.mjs'

const REQUIRED_SCIENCE_ASSETS = [
  'index.js',
  'worker-entry.js',
  'language.worker.js',
  'sandbox.worker.js',
  'gsf.js',
  'png.js',
  'jpeg.js',
  'mrc.js',
  'nrrd.js',
  'tiff.js',
]

describe('science workbench bundle inventory', () => {
  it('strips the trailing Vite content hash without collapsing distinct prefixes', () => {
    expect(logicalAssetName('apps/workbench/dist/assets/index-BsChTh28.js')).toBe('index.js')
    expect(logicalAssetName('apps/workbench/dist/assets/worker-entry-BwzWo_f2.js')).toBe(
      'worker-entry.js',
    )
    expect(logicalAssetName('apps/workbench/dist/assets/language.worker-_TFzLBn-.js')).toBe(
      'language.worker.js',
    )
    expect(logicalAssetName('apps/workbench/dist/assets/sandbox.worker-D-A7JJMB.js')).toBe(
      'sandbox.worker.js',
    )
    expect(logicalAssetName('apps/workbench/dist/assets/module-6F3E5H7Y-Bk_Kqtn5.js')).toBe(
      'module-6F3E5H7Y.js',
    )
  })

  it('records gzip budgets and the current science Worker/reader chunks', async () => {
    const raw: unknown = JSON.parse(
      await readFile(
        fileURLToPath(new URL('../baselines/science-workbench.json', import.meta.url)),
        'utf8',
      ),
    )
    expect(raw).toMatchObject({
      schemaVersion: 1,
      application: 'science-workbench',
      budgets: {
        routeChunkGzipBytes: 300 * 1024,
        languageWorkerGzipBytes: 1_000 * 1024,
        warmShellInteractiveMilliseconds: 1_000,
        largestTilePixels: 256 * 256,
      },
    })
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !('bundle' in raw) ||
      typeof raw.bundle !== 'object' ||
      raw.bundle === null ||
      !('assets' in raw.bundle) ||
      !Array.isArray(raw.bundle.assets)
    ) {
      throw new Error('Science workbench bundle baseline is missing assets.')
    }
    const logicalNames = raw.bundle.assets.map((asset) => {
      if (typeof asset !== 'object' || asset === null || !('logicalName' in asset)) {
        throw new Error('Science workbench bundle asset is missing a logical name.')
      }
      const logicalName = asset.logicalName
      if (typeof logicalName !== 'string') {
        throw new Error('Science workbench bundle logical name must be a string.')
      }
      return logicalName.replace(/#\d+$/u, '')
    })
    expect(logicalNames).toEqual(expect.arrayContaining(REQUIRED_SCIENCE_ASSETS))
  })
})
