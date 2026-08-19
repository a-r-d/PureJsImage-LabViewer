import { describe, expect, it } from 'vitest'
import { KY_FROM_ABOVE_CATALOG } from '../src/catalog/ky-from-above.js'
import { createStacClient } from '../src/stac/client.js'

const live = process.env['ATLAS_LIVE_STAC'] === '1'

describe.skipIf(!live)('live Kentucky From Above STAC smoke', () => {
  it('lists collections and searches a Frankfort bbox', async () => {
    const client = createStacClient({ fetch, cacheVersion: 'live' })
    const catalog = await client.getCatalog(KY_FROM_ABOVE_CATALOG.href)
    const collections = await client.listCollections(catalog)
    expect(collections.length).toBeGreaterThan(0)
    const page = await client.search(catalog, {
      bbox: KY_FROM_ABOVE_CATALOG.defaultBbox,
      collections: ['orthos-phase2'],
      limit: 1,
    })
    expect(page.items.length).toBeGreaterThan(0)
    const item = page.items[0]
    expect(item?.assets.some((asset) => asset.href.startsWith('https://'))).toBe(true)
  }, 30_000)
})
