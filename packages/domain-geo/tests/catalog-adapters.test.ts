import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { candidatesFromItem, preferHttpsAsset } from '../src/catalog/candidates.js'
import { NOAA_DIGITAL_COAST_CATALOG } from '../src/catalog/noaa-digital-coast.js'
import { createCatalogService } from '../src/catalog/service.js'
import type { CatalogRegistryEntry } from '../src/catalog/types.js'
import { USGS_3DEP_CATALOG, USGS_3DEP_NED_13 } from '../src/catalog/usgs-3dep.js'
import { USGS_LANDSAT_CATALOG } from '../src/catalog/usgs-landsat.js'
import { createMemoryStacCache } from '../src/stac/cache.js'
import { parseStacItem } from '../src/stac/parse.js'
import { StacClientError } from '../src/stac/types.js'

async function fixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')) as unknown
}

function jsonResponse(body: unknown, extra?: { readonly length?: number }): Response {
  const text = JSON.stringify(body)
  return new Response(text, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...(extra?.length === undefined ? {} : { 'content-length': String(extra.length) }),
    },
  })
}

const staticCatalog: CatalogRegistryEntry = {
  ...NOAA_DIGITAL_COAST_CATALOG,
  endpoint: {
    kind: 'static-stac',
    rootHref: 'https://static.example.test/stac/catalog.json',
    collections: [
      {
        id: 'static-dem',
        title: 'Static DEM',
        catalogHref: 'https://static.example.test/stac/catalog.json',
        collectionHref: 'https://static.example.test/stac/collection.json',
        itemCollectionHref: 'https://static.example.test/stac/item-collection.json',
        itemDocumentBaseHref: 'https://static.example.test/stac/',
        bandOverride: {
          note: 'Example provider product guide, table 4.',
          bands: [
            { name: 'Band 1', commonName: 'red' },
            { name: 'Band 2', commonName: 'green' },
            { name: 'Band 3', commonName: 'blue' },
            { name: 'Band 4', commonName: 'nir' },
          ],
        },
      },
      {
        id: 'too-large',
        title: 'Too large',
        catalogHref: 'https://static.example.test/stac/catalog.json',
        collectionHref: 'https://static.example.test/stac/collection.json',
        itemCollectionHref: 'https://static.example.test/stac/huge.json',
        maxItemCollectionBytes: 1024,
      },
    ],
  },
  collectionGroups: { dem: ['static-dem'] },
}

describe('static STAC adapter', () => {
  it('filters, paginates, resolves relative asset hrefs, and refuses oversized collections', async () => {
    const itemCollection = await fixture('./fixtures/stac-static/item-collection.json')
    const item = await fixture('./fixtures/stac-static/item-relative.json')
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input)
      if ((init?.method ?? 'GET') === 'HEAD' && url.endsWith('huge.json')) {
        return new Response(null, { status: 200, headers: { 'content-length': '4096' } })
      }
      if ((init?.method ?? 'GET') === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'content-length': '512' } })
      }
      if (url.endsWith('item-collection.json')) return jsonResponse(itemCollection)
      if (url.endsWith('ncei13_n17x75_w065x75_2022v1.json')) return jsonResponse(item)
      throw new Error(`unexpected ${url}`)
    }
    const service = createCatalogService({ fetch: fetchFn, cacheVersion: 'test' })
    const collections = await service.listCollections(staticCatalog)
    expect(collections.map((collection) => collection.id)).toEqual(['static-dem', 'too-large'])
    const page = await service.search(staticCatalog, {
      collections: ['static-dem'],
      bbox: [-180, -90, 180, 90],
      limit: 1,
    })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.id).toBe('ncei13_n17x75_w065x75_2022v1')
    expect(page.items[0]?.candidates[0]?.href).toBe(
      'https://static.example.test/ncei13_n17x75_w065x75_2022v1.tif',
    )
    expect(page.items[0]?.candidates[0]?.bands.map(({ commonName }) => commonName)).toEqual([
      'red',
      'green',
      'blue',
      'nir',
    ])
    expect(page.items[0]?.candidates[0]?.bandMetadataOverride).toEqual({
      note: 'Example provider product guide, table 4.',
    })
    expect(page.next).toBeDefined()
    const more = await service.follow(staticCatalog, page.next ?? { href: '' })
    expect(more.items[0]?.id).toBe('west-tile')
    const resolved = await service.resolveDeepLink(staticCatalog, {
      catalogId: staticCatalog.id,
      collectionId: 'static-dem',
      itemId: 'ncei13_n17x75_w065x75_2022v1',
      assetKey: 'ncei13_n17x75_w065x75_2022v1',
    })
    expect(resolved?.href).toContain('.tif')
    await expect(
      service.search(staticCatalog, { collections: ['too-large'] }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })
})

describe('Landsat STAC API adapter', () => {
  it('searches with GET by default, prefers HTTPS assets, and keeps s3-only as s3', async () => {
    const catalog = await fixture('./fixtures/stac-api/landsat-catalog.json')
    const search = await fixture('./fixtures/stac-api/landsat-search.json')
    const searchFeatures = (search as { readonly features: readonly unknown[] }).features
    const s3Item = await fixture('./fixtures/stac-api/landsat-s3-item.json')
    const methods: string[] = []
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input)
      methods.push(`${init?.method ?? 'GET'} ${url}`)
      if (url === 'https://landsatlook.usgs.gov/stac-server/' || url.endsWith('stac-server/')) {
        return jsonResponse(catalog)
      }
      if (url.includes('/search')) {
        expect(url).toContain('sortby=')
        expect(init?.method ?? 'GET').toBe('GET')
        return jsonResponse(search)
      }
      if (url.includes('/collections/landsat-c2l2-sr/items/LC08_L2SP_019033_20250909_02_T1_SR'))
        return jsonResponse(searchFeatures[0])
      if (url.includes('/items/s3-only-scene')) return jsonResponse(s3Item)
      if (url.includes('/collections') && !url.includes('/items')) {
        return jsonResponse({
          collections: [{ type: 'Collection', id: 'landsat-c2l2-sr', links: [] }],
        })
      }
      return new Response('missing', { status: 404 })
    }
    const service = createCatalogService({ fetch: fetchFn, cacheVersion: 'landsat' })
    const page = await service.search(USGS_LANDSAT_CATALOG, {
      collections: ['landsat-c2l2-sr'],
      limit: 1,
    })
    expect(
      page.items[0]?.candidates.some((candidate) => candidate.href.startsWith('https://')),
    ).toBe(true)
    expect(
      page.items[0]?.candidates.every((candidate) => !candidate.href.startsWith('s3://')),
    ).toBe(true)
    const asset = parseStacItem(s3Item).assets[0]
    expect(asset).toBeDefined()
    if (asset === undefined) return
    const s3 = preferHttpsAsset(asset)
    expect(s3.href.startsWith('s3://')).toBe(true)
    expect(methods.some((entry) => entry.startsWith('POST'))).toBe(false)
    const candidate = page.items[0]?.candidates[0]
    if (candidate === undefined) throw new Error('Expected Landsat replay candidate')
    const searchesBeforeReplay = methods.filter((entry) => entry.includes('/search')).length
    await expect(
      service.resolveDeepLink(USGS_LANDSAT_CATALOG, {
        catalogId: candidate.catalogId,
        collectionId: candidate.collectionId,
        itemId: candidate.itemId,
        assetKey: candidate.assetKey,
      }),
    ).resolves.toMatchObject({ itemId: candidate.itemId, assetKey: candidate.assetKey })
    expect(methods.filter((entry) => entry.includes('/search'))).toHaveLength(searchesBeforeReplay)
  })

  it('POSTs search and next only when advertised on the catalog origin', async () => {
    const requests: string[] = []
    const bodies: unknown[] = []
    const postCatalog = {
      type: 'Catalog',
      id: 'post-only',
      links: [
        { rel: 'self', href: 'https://landsat.example.test/' },
        { rel: 'root', href: 'https://landsat.example.test/' },
        {
          rel: 'search',
          href: 'https://landsat.example.test/search',
          method: 'POST',
        },
      ],
    }
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      requests.push(`${method} ${url}`)
      if (method === 'POST') bodies.push(JSON.parse(String(init?.body)) as unknown)
      if (url === 'https://landsat.example.test/' || url.endsWith('stac-server/')) {
        return jsonResponse(postCatalog)
      }
      if (url.endsWith('/search') && method === 'POST') {
        return jsonResponse({
          type: 'FeatureCollection',
          features: [],
          links: [
            {
              rel: 'next',
              href: 'https://landsat.example.test/search',
              method: 'POST',
              body: { token: 'next' },
              merge: true,
              headers: { Accept: 'application/geo+json', Authorization: 'secret' },
            },
          ],
        })
      }
      return new Response('missing', { status: 404 })
    }
    const service = createCatalogService({ fetch: fetchFn, cacheVersion: 'post' })
    const postEntry = {
      ...USGS_LANDSAT_CATALOG,
      endpoint: { kind: 'stac-api' as const, rootHref: 'https://landsat.example.test/' },
    }
    const page = await service.search(postEntry, { collections: ['landsat-c2l2-sr'] })
    expect(page.next?.method).toBe('POST')
    await service.follow(postEntry, page.next ?? { href: 'https://landsat.example.test/search' })
    expect(requests.filter((entry) => entry.startsWith('POST'))).toHaveLength(2)
    expect(bodies[1]).toMatchObject({
      collections: ['landsat-c2l2-sr'],
      limit: 12,
      token: 'next',
    })
  })

  it('uses collection metadata ahead of registry fallback metadata', async () => {
    const catalog = await fixture('./fixtures/stac-api/landsat-catalog.json')
    const search = await fixture('./fixtures/stac-api/landsat-search.json')
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('stac-server/')) return jsonResponse(catalog)
      if (url.includes('/search')) return jsonResponse(search)
      if (url.includes('/collections')) {
        return jsonResponse({
          collections: [
            {
              type: 'Collection',
              id: 'landsat-c2l2-sr',
              title: 'Live Landsat Level-2',
              license:
                'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
              providers: [{ name: 'USGS EROS', roles: ['producer'] }],
              links: [],
            },
          ],
        })
      }
      return new Response(null, { status: 404 })
    }
    const service = createCatalogService({ fetch: fetchFn, cacheVersion: 'metadata' })
    const page = await service.search(USGS_LANDSAT_CATALOG, {
      collections: ['landsat-c2l2-sr'],
    })
    expect(page.items[0]?.collectionTitle).toBe('Live Landsat Level-2')
    expect(page.items[0]?.candidates[0]).toMatchObject({
      provider: 'USGS EROS',
      attribution: 'USGS EROS',
      license: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
    })
  })
})

describe('TNMAccess adapter', () => {
  it('lists dataset tags, keeps only GeoTIFF candidates, and treats empty as success', async () => {
    const datasets = await fixture('./fixtures/tnm/datasets.json')
    const products = await fixture('./fixtures/tnm/products.json')
    const empty = await fixture('./fixtures/tnm/products-empty.json')
    const nonTiff = await fixture('./fixtures/tnm/products-non-tiff.json')
    const errored = await fixture('./fixtures/tnm/products-error.json')
    const targetedQueries: string[] = []
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('/products?')) {
        const parsed = new URL(url)
        if (parsed.searchParams.has('q')) targetedQueries.push(parsed.searchParams.get('q') ?? '')
        else {
          expect(parsed.searchParams.get('dateType')).toBe('Publication')
          expect(parsed.searchParams.get('start')).toBe('2021-01-01')
          expect(parsed.searchParams.get('end')).toBe('2021-12-31')
        }
      }
      if (url.includes('/datasets')) return jsonResponse(datasets)
      if (url.includes('products-empty')) return jsonResponse(empty)
      if (url.includes('products-img')) return jsonResponse(nonTiff)
      if (url.includes('products-error')) return jsonResponse(errored)
      return jsonResponse(products)
    }
    const service = createCatalogService({ fetch: fetchFn, cacheVersion: 'tnm' })
    const collections = await service.listCollections(USGS_3DEP_CATALOG)
    expect(collections.some((collection) => collection.id === USGS_3DEP_NED_13)).toBe(true)
    const page = await service.search(USGS_3DEP_CATALOG, {
      collections: [USGS_3DEP_NED_13],
      bbox: [-84.6, 39.05, -84.4, 39.2],
      datetime: '2021-01-01/2021-12-31',
    })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.candidates[0]?.assetKey).toBe('geotiff')
    expect(page.items[0]?.candidates[0]?.href.endsWith('.tif')).toBe(true)
    const candidate = page.items[0]?.candidates[0]
    expect(candidate).toBeDefined()
    if (candidate !== undefined) {
      await expect(
        service.resolveDeepLink(USGS_3DEP_CATALOG, {
          catalogId: candidate.catalogId,
          collectionId: candidate.collectionId,
          itemId: candidate.itemId,
          assetKey: candidate.assetKey,
        }),
      ).resolves.toMatchObject({ href: candidate.href, itemId: candidate.itemId })
      expect(targetedQueries).toContain(candidate.itemId)
    }
    const skipped = await service.search(
      {
        ...USGS_3DEP_CATALOG,
        endpoint: {
          kind: 'tnm-access',
          productsHref: 'https://tnm.example.test/products-img',
          datasetsHref: 'https://tnmaccess.nationalmap.gov/api/v1/datasets',
          datasetTags: [USGS_3DEP_NED_13],
        },
      },
      { collections: [USGS_3DEP_NED_13] },
    )
    expect(skipped.items).toEqual([])
    const none = await service.search(
      {
        ...USGS_3DEP_CATALOG,
        endpoint: {
          kind: 'tnm-access',
          productsHref: 'https://tnm.example.test/products-empty',
          datasetsHref: 'https://tnmaccess.nationalmap.gov/api/v1/datasets',
          datasetTags: [USGS_3DEP_NED_13],
        },
      },
      {},
    )
    expect(none.items).toEqual([])
    await expect(
      service.search(
        {
          ...USGS_3DEP_CATALOG,
          endpoint: {
            kind: 'tnm-access',
            productsHref: 'https://tnm.example.test/products-error',
            datasetsHref: 'https://tnmaccess.nationalmap.gov/api/v1/datasets',
            datasetTags: [USGS_3DEP_NED_13],
          },
        },
        {},
      ),
    ).rejects.toBeInstanceOf(StacClientError)
  })
})

describe('catalog service cache keys', () => {
  it('prefixes cache keys with catalog id and protocol', async () => {
    const cache = createMemoryStacCache()
    const seen: string[] = []
    const wrapped = {
      get: async (url: string) => {
        seen.push(`get:${url}`)
        return cache.get(url)
      },
      set: async (entry: Parameters<typeof cache.set>[0]) => {
        seen.push(`set:${entry.url}`)
        return cache.set(entry)
      },
      invalidate: async (url?: string) => cache.invalidate(url),
    }
    const fetchFn: typeof fetch = async () =>
      jsonResponse({
        type: 'Catalog',
        id: 'stac-fastapi',
        links: [{ rel: 'self', href: 'https://landsatlook.usgs.gov/stac-server/' }],
      })
    const service = createCatalogService({ fetch: fetchFn, cache: wrapped, cacheVersion: 'v' })
    await service.listCollections(USGS_LANDSAT_CATALOG).catch(() => undefined)
    expect(seen.some((entry) => entry.includes('usgs-landsat:stac-api:'))).toBe(true)
  })
})

describe('HTTPS alternate preference', () => {
  it('does not rewrite s3 hrefs when no HTTPS alternate exists', async () => {
    const item = parseStacItem(await fixture('./fixtures/stac-api/landsat-s3-item.json'))
    const candidates = candidatesFromItem(USGS_LANDSAT_CATALOG, item)
    expect(candidates[0]?.href.startsWith('s3://')).toBe(true)
    expect(candidates[0]?.bands[0]).toMatchObject({ scale: 0.0000275, offset: -0.2 })
    expect(
      candidatesFromItem({ ...USGS_LANDSAT_CATALOG, id: 'generic-stac' }, item)[0]?.bands,
    ).toEqual([])
  })
})
