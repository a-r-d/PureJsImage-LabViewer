import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

import { mockKentuckyStac } from './stac-mock.js'

const staticRoot = fileURLToPath(
  new URL('../../../packages/domain-geo/tests/fixtures/stac-static/', import.meta.url),
)
const landsatRoot = fileURLToPath(
  new URL('../../../packages/domain-geo/tests/fixtures/stac-api/', import.meta.url),
)
const tnmRoot = fileURLToPath(
  new URL('../../../packages/domain-geo/tests/fixtures/tnm/', import.meta.url),
)

function loadJson(root: string, name: string): unknown {
  return JSON.parse(readFileSync(path.join(root, name), 'utf8')) as unknown
}

function withLocalCog(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value).replaceAll(
      /(?:https?:\/\/|\.\.\/)[^"]+\.tif/giu,
      'http://127.0.0.1:4175/north-up.tif',
    ),
  ) as unknown
}

function jsonFulfill(body: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'content-length': '512' },
    json: body,
  }
}

export async function mockGovernmentCatalogs(page: Page): Promise<void> {
  await mockKentuckyStac(page)
  const itemCollection = withLocalCog(loadJson(staticRoot, 'item-collection.json'))
  const item = withLocalCog(loadJson(staticRoot, 'item-relative.json'))
  await page.route(
    /noaa-nos-coastal-lidar-pds\.s3\.amazonaws\.com|coastalimagery\.blob\.core\.windows\.net/u,
    async (route) => {
      const url = route.request().url()
      if (route.request().method() === 'HEAD') {
        const tooLarge = url.includes('WI_NAIP')
        await route.fulfill({
          status: 200,
          headers: {
            'content-length': tooLarge ? String(2 * 1024 * 1024) : '512',
            'access-control-allow-origin': '*',
          },
        })
        return
      }
      if (url.includes('WI_NAIP') || url.includes('PalmCoast')) {
        await route.fulfill(jsonFulfill({ type: 'FeatureCollection', features: [] }))
        return
      }
      if (url.endsWith('.json') && url.includes('ncei13_')) {
        await route.fulfill(jsonFulfill(item))
        return
      }
      await route.fulfill(jsonFulfill(itemCollection))
    },
  )
  const landsatCatalog = loadJson(landsatRoot, 'landsat-catalog.json')
  const landsatSearch = withLocalCog(loadJson(landsatRoot, 'landsat-search.json'))
  await page.route(/landsatlook\.usgs\.gov/u, async (route) => {
    const url = route.request().url()
    if (url.includes('/search') || url.includes('/items/')) {
      await route.fulfill(jsonFulfill(landsatSearch))
      return
    }
    if (url.includes('/collections')) {
      await route.fulfill(
        jsonFulfill({
          collections: [{ type: 'Collection', id: 'landsat-c2l2-sr', title: 'SR', links: [] }],
        }),
      )
      return
    }
    await route.fulfill(jsonFulfill(landsatCatalog))
  })
  const datasets = loadJson(tnmRoot, 'datasets.json')
  const products = withLocalCog(loadJson(tnmRoot, 'products.json'))
  await page.route(/tnmaccess\.nationalmap\.gov/u, async (route) => {
    if (route.request().url().includes('/datasets')) {
      await route.fulfill(jsonFulfill(datasets))
      return
    }
    await route.fulfill(jsonFulfill(products))
  })
}
