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
    'http://127.0.0.1:4175/north-up.tif',
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
export async function mockKentuckyStac(page: Page): Promise<void> {
  const catalog = loadFixture('catalog.json')
  const collections = loadFixture('collections.json')
  const item = withLocalCog(loadFixture('item-ortho.json'))
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
    if (pathname.includes('/items/') && pathname.endsWith('.tif')) {
      await route.fulfill(jsonFulfill(item))
      return
    }
    if (pathname === '/search' || pathname.endsWith('/items')) {
      await route.fulfill(
        jsonFulfill({
          type: 'FeatureCollection',
          numberReturned: 1,
          numberMatched: 1,
          features: [item],
          links: [{ rel: 'self', href: url.toString() }],
        }),
      )
      return
    }
    await route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } })
  })
}
