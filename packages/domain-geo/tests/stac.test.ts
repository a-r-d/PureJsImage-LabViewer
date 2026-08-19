import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { rasterAssets } from '../src/stac/assets.js'
import { createMemoryStacCache } from '../src/stac/cache.js'
import { createStacClient } from '../src/stac/client.js'
import { parseStacCatalog, parseStacCollections, parseStacItem } from '../src/stac/parse.js'
import { StacClientError } from '../src/stac/types.js'

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`./fixtures/stac/${name}`, import.meta.url), 'utf8'),
  ) as unknown
}

describe('STAC parse', () => {
  it('reads catalogs, collections, projection/raster/eo extensions, and skips non-raster assets', async () => {
    const catalog = parseStacCatalog(await fixture('catalog.json'))
    expect(catalog.id).toBe('stac-fastapi')
    expect(catalog.links.some((link) => link.rel === 'search')).toBe(true)
    const collections = parseStacCollections(await fixture('collections.json'))
    expect(collections.map((collection) => collection.id)).toEqual([
      'orthos-phase1',
      'orthos-phase2',
      'dem-phase2',
    ])
    const item = parseStacItem(await fixture('item-ortho.json'))
    expect(item.projEpsg).toBe(3089)
    expect(item.eoBands).toHaveLength(4)
    expect(rasterAssets(item).map((asset) => asset.key)).toEqual(['data'])
    expect(rasterAssets(item)[0]?.rasterBands[0]?.dataType).toBe('uint8')
    expect(rasterAssets(item)[0]?.fileSize).toBe(48_219_328)
    expect(rasterAssets(item)[0]?.fileChecksum).toMatch(/^md5:/u)
  })

  it('rejects invalid documents', () => {
    expect(() => parseStacItem({ type: 'Catalog', id: 'nope' })).toThrow(StacClientError)
  })
})

describe('STAC client', () => {
  it('browses, searches with filters, paginates, and caches by version', async () => {
    const item = await fixture('item-ortho.json')
    const requests: string[] = []
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith('/') || url.endsWith('stac.example.test')) {
        return jsonResponse(await fixture('catalog.json'))
      }
      if (url.includes('/collections') && !url.includes('/items')) {
        return jsonResponse(await fixture('collections.json'))
      }
      if (url.includes('/search')) {
        const parsed = new URL(url)
        if (!url.includes('token=next')) {
          expect(parsed.searchParams.get('bbox')).toBe('-84.9,38.16,-84.82,38.22')
          expect(parsed.searchParams.get('datetime')).toBe('2019-01-01/2019-12-31')
          expect(parsed.searchParams.get('collections')).toBe('orthos-phase2')
        }
        const page = {
          type: 'FeatureCollection',
          features: url.includes('token=next') ? [] : [item],
          links: url.includes('token=next')
            ? []
            : [{ rel: 'next', href: 'https://stac.example.test/search?token=next', method: 'GET' }],
        }
        return jsonResponse(page)
      }
      return new Response('missing', { status: 404 })
    }
    const cache = createMemoryStacCache()
    const client = createStacClient({ fetch: fetchFn, cache, cacheVersion: '1' })
    const catalog = await client.getCatalog('https://stac.example.test/')
    const collections = await client.listCollections(catalog)
    expect(collections).toHaveLength(3)
    const page = await client.search(catalog, {
      bbox: [-84.9, 38.16, -84.82, 38.22],
      datetime: '2019-01-01/2019-12-31',
      collections: ['orthos-phase2'],
      limit: 12,
    })
    expect(page.items[0]?.id).toBe('N082E280_2019_6IN_cog.tif')
    expect(page.nextHref).toContain('token=next')
    const next = await client.follow(page.nextHref ?? '')
    expect(next.items).toEqual([])
    const again = await client.getCatalog('https://stac.example.test/')
    expect(again.id).toBe(catalog.id)
    expect(requests.filter((url) => url === 'https://stac.example.test/')).toHaveLength(1)
    await cache.invalidate()
    const clientV2 = createStacClient({ fetch: fetchFn, cache, cacheVersion: '2' })
    await clientV2.getCatalog('https://stac.example.test/')
    expect(requests.filter((url) => url === 'https://stac.example.test/')).toHaveLength(2)
  })

  it('classifies unavailable catalogs', async () => {
    const client = createStacClient({
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
      cacheVersion: '1',
    })
    await expect(client.getCatalog('https://stac.example.test/')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    })
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
