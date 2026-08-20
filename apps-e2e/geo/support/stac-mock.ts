import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

export const LIVE_STAC_ORIGIN = 'https://spved5ihrl.execute-api.us-west-2.amazonaws.com'
export const KENTUCKY_STAC_ROUTE = /spved5ihrl\.execute-api\.us-west-2\.amazonaws\.com/u

const fixtureRoot = fileURLToPath(
  new URL('../../../packages/domain-geo/tests/fixtures/stac/', import.meta.url),
)

function loadFixture(name: string): unknown {
  const json = readFileSync(path.join(fixtureRoot, name), 'utf8').replaceAll(
    'https://stac.example.test',
    LIVE_STAC_ORIGIN,
  )
  return JSON.parse(json) as unknown
}

function withLocalCog(value: unknown): unknown {
  const rewritten = JSON.stringify(value).replaceAll(
    /https:\/\/kyfromabove[^"]+\.tif/gu,
    'http://127.0.0.1:4175/four-band.tif',
  )
  return JSON.parse(rewritten) as unknown
}

function jsonFulfill(body: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    json: body,
  }
}

/** Intercept the live KyFromAbove STAC host so geo E2E never depends on the public service. */
export async function mockKentuckyStac(
  page: Page,
  options: Readonly<{ incompatibleSecondCrs?: boolean }> = {},
): Promise<void> {
  const catalog = loadFixture('catalog.json')
  const collections = loadFixture('collections.json')
  const collectionRows =
    typeof collections === 'object' &&
    collections !== null &&
    'collections' in collections &&
    Array.isArray(collections.collections)
      ? collections.collections
      : []
  const item = withLocalCog(loadFixture('item-ortho.json'))
  const laterItem = JSON.parse(JSON.stringify(item)) as Record<string, unknown>
  if (options.incompatibleSecondCrs === true) {
    const incompatible = JSON.stringify(laterItem).replaceAll(
      'http://127.0.0.1:4175/four-band.tif',
      'http://127.0.0.1:4175/web-mercator.tif',
    )
    Object.assign(laterItem, JSON.parse(incompatible) as Record<string, unknown>)
  }
  laterItem['id'] = 'N082E280_2022_6IN_cog.tif'
  const laterProperties = laterItem['properties']
  if (typeof laterProperties === 'object' && laterProperties !== null) {
    const properties = laterProperties as Record<string, unknown>
    properties['datetime'] = '2022-02-25T00:00:00Z'
  }
  const items = [item, laterItem]
  await page.route(KENTUCKY_STAC_ROUTE, async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname.replace(/\/$/u, '') || '/'
    if (pathname === '/') {
      await route.fulfill(jsonFulfill(catalog))
      return
    }
    if (pathname === '/collections') {
      await route.fulfill(jsonFulfill(collections))
      return
    }
    if (pathname.startsWith('/collections/') && !pathname.includes('/items')) {
      const id = pathname.slice('/collections/'.length)
      const collection = collectionRows.find(
        (value): value is Record<string, unknown> =>
          typeof value === 'object' && value !== null && value['id'] === id,
      )
      await route.fulfill(
        collection === undefined
          ? { status: 404, json: { code: 'NOT_FOUND' } }
          : jsonFulfill(collection),
      )
      return
    }
    if (pathname.includes('/items/') && pathname.endsWith('.tif')) {
      const resolved = items.find(
        (candidate) =>
          typeof candidate === 'object' &&
          candidate !== null &&
          pathname.includes(
            encodeURIComponent(String((candidate as Record<string, unknown>)['id'])),
          ),
      )
      await route.fulfill(jsonFulfill(resolved ?? item))
      return
    }
    if (pathname === '/search' || pathname.endsWith('/items')) {
      await route.fulfill(
        jsonFulfill({
          type: 'FeatureCollection',
          numberReturned: items.length,
          numberMatched: items.length,
          features: items,
          links: [{ rel: 'self', href: url.toString() }],
        }),
      )
      return
    }
    await route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } })
  })
}
