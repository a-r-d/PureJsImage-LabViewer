import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { compareBundleInventory, logicalAssetName } from './bundle-sizes.mjs'

const ROUTE_BUDGET = 300 * 1024
const LANGUAGE_BUDGET = 1_000 * 1024
const BUDGETS = {
  routeChunkGzipBytes: ROUTE_BUDGET,
  languageWorkerGzipBytes: LANGUAGE_BUDGET,
}

describe('science workbench bundle inventory', () => {
  it('strips the trailing Vite content hash without collapsing distinct prefixes', () => {
    expect(logicalAssetName('apps/science/dist/assets/index-BsChTh28.js')).toBe('index.js')
    expect(logicalAssetName('apps/science/dist/assets/worker-entry-BwzWo_f2.js')).toBe(
      'worker-entry.js',
    )
    expect(logicalAssetName('apps/science/dist/assets/language.worker-_TFzLBn-.js')).toBe(
      'language.worker.js',
    )
    expect(logicalAssetName('apps/science/dist/assets/sandbox.worker-D-A7JJMB.js')).toBe(
      'sandbox.worker.js',
    )
    expect(logicalAssetName('apps/science/dist/assets/module-6F3E5H7Y-Bk_Kqtn5.js')).toBe(
      'module-6F3E5H7Y.js',
    )
  })

  it('records gzip and performance ceilings without freezing every hashed chunk', async () => {
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
        routeChunkGzipBytes: ROUTE_BUDGET,
        languageWorkerGzipBytes: LANGUAGE_BUDGET,
        warmShellInteractiveMilliseconds: 1_000,
        largestTilePixels: 256 * 256,
      },
    })
    if (typeof raw === 'object' && raw !== null && 'bundle' in raw) {
      throw new Error('Science workbench baseline must not freeze a per-asset gzip inventory.')
    }
  })

  it('enforces gzip ceilings and required chunks, not exact asset lists or byte counts', () => {
    const inventory = {
      buildRoot: 'apps/science/dist',
      assets: [
        {
          logicalName: 'index.js',
          source: 'apps/science/dist/assets/index-aaaa.js',
          gzipBytes: 10,
        },
        {
          logicalName: 'worker-entry.js',
          source: 'apps/science/dist/assets/worker-entry-bbbb.js',
          gzipBytes: 20,
        },
        {
          logicalName: 'language.worker.js',
          source: 'apps/science/dist/assets/language.worker-cccc.js',
          gzipBytes: 30,
        },
        {
          logicalName: 'sandbox.worker.js',
          source: 'apps/science/dist/assets/sandbox.worker-dddd.js',
          gzipBytes: 40,
        },
        { logicalName: 'jpeg.js', source: 'apps/science/dist/assets/jpeg-eeee.js', gzipBytes: 50 },
        {
          logicalName: 'jpeg.js#1',
          source: 'apps/science/dist/assets/jpeg-ffff.js',
          gzipBytes: 60,
        },
        { logicalName: 'icc.js', source: 'apps/science/dist/assets/icc-gggg.js', gzipBytes: 70 },
      ],
    }
    expect(
      compareBundleInventory(inventory, BUDGETS, {
        requiredLogicalNames: [
          'index.js',
          'worker-entry.js',
          'language.worker.js',
          'sandbox.worker.js',
        ],
      }),
    ).toEqual([])
  })

  it('fails empty output, missing required chunks, and over-budget assets', () => {
    expect(compareBundleInventory({ buildRoot: 'apps/science/dist', assets: [] }, BUDGETS)).toEqual(
      ['No JavaScript build output found under apps/science/dist'],
    )
    expect(
      compareBundleInventory(
        {
          buildRoot: 'apps/science/dist',
          assets: [
            {
              logicalName: 'index.js',
              source: 'apps/science/dist/assets/index-aaaa.js',
              gzipBytes: 10,
            },
          ],
        },
        BUDGETS,
        { requiredLogicalNames: ['index.js', 'worker-entry.js'] },
      ),
    ).toEqual(['apps/science/dist is missing required chunk worker-entry.js'])
    expect(
      compareBundleInventory(
        {
          buildRoot: 'apps/science/dist',
          assets: [
            {
              logicalName: 'index.js',
              source: 'apps/science/dist/assets/index-aaaa.js',
              gzipBytes: ROUTE_BUDGET + 1,
            },
            {
              logicalName: 'language.worker.js',
              source: 'apps/science/dist/assets/language.worker-cccc.js',
              gzipBytes: LANGUAGE_BUDGET + 1,
            },
          ],
        },
        BUDGETS,
      ),
    ).toEqual([
      `index.js is ${ROUTE_BUDGET + 1} bytes gzip and exceeds the ${ROUTE_BUDGET}-byte route chunk budget`,
      `language.worker.js is ${LANGUAGE_BUDGET + 1} bytes gzip and exceeds the ${LANGUAGE_BUDGET}-byte lazy language Worker budget`,
    ])
  })
})
