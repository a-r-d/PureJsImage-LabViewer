import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  ATLAS_START_DEMOS,
  CATALOG_REGISTRY,
  CRS_EPSG_4326,
  candidatesFromItem,
  catalogById,
  catalogProtocolHint,
  catalogRootHref,
  classifyStacClientError,
  collectionSummariesFromRegistry,
  createGeoProject,
  createGeoRasterSource,
  curatedPresetsForIdentity,
  GeoValidationError,
  KY_FROM_ABOVE_CATALOG,
  parseAtlasCatalogSession,
  parseAtlasDeepLink,
  parseStacItem,
  preferredCandidate,
  registerCrsDefinition,
  StacClientError,
  serializeAtlasCatalogSession,
  serializeAtlasDeepLink,
  transformMapPoint,
  USGS_LANDSAT_CATALOG,
} from '../src/index.js'

const wgs84 = {
  crs: CRS_EPSG_4326,
  pixelInterpretation: 'pixel-is-area' as const,
  pixelToModel: [10, 0, 100, 0, -20, 200] as const,
}

describe('catalog registry', () => {
  it('keeps product collection IDs in the catalog registry', () => {
    expect(CATALOG_REGISTRY.map((entry) => entry.id)).toEqual([
      'noaa-digital-coast',
      'usgs-3dep',
      'usgs-landsat',
      'ky-from-above',
    ])
    expect(catalogRootHref(KY_FROM_ABOVE_CATALOG)).toContain('execute-api')
    expect(KY_FROM_ABOVE_CATALOG.protocol).toBe('stac-api')
    expect(
      KY_FROM_ABOVE_CATALOG.collectionGroups['elevation-dtm']?.some((id) => id.startsWith('dem-')),
    ).toBe(true)
    expect(KY_FROM_ABOVE_CATALOG.collectionGroups['elevation-dsm']).toEqual([])
    expect(
      KY_FROM_ABOVE_CATALOG.collectionGroups['time-series-ortho']?.every((id) =>
        id.startsWith('orthos-'),
      ),
    ).toBe(true)
    expect(catalogById('missing')).toBeUndefined()
  })

  it('pins launch demos to registry catalog identities', () => {
    expect(ATLAS_START_DEMOS.map((demo) => demo.id)).toEqual([
      'kentucky-frankfort-ortho',
      'noaa-palm-coast-rgbn',
    ])
    expect(ATLAS_START_DEMOS[0]?.presets?.map(({ id }) => id)).toEqual([
      'natural-color',
      'color-infrared',
    ])
    expect(ATLAS_START_DEMOS[1]?.identity).toMatchObject({
      collectionId: 'noaa-rgbn-palm-coast-10213',
      itemId: '474000e3303000n',
      assetKey: '474000e3303000n',
    })
    for (const demo of ATLAS_START_DEMOS) {
      expect(catalogById(demo.identity.catalogId)?.id).toBe(demo.identity.catalogId)
      expect(demo.style.mapping).toBeDefined()
    }
    const kentucky = ATLAS_START_DEMOS.find(({ id }) => id === 'kentucky-frankfort-ortho')
    if (kentucky === undefined) throw new Error('Kentucky demo is missing')
    expect(curatedPresetsForIdentity(kentucky.identity)?.map(({ id }) => id)).toEqual([
      'natural-color',
      'color-infrared',
    ])
  })

  it('surfaces Landsat origin limits through the generic protocol hint', () => {
    expect(catalogProtocolHint(KY_FROM_ABOVE_CATALOG)).toBe('STAC API · public HTTPS')
    expect(catalogProtocolHint(USGS_LANDSAT_CATALOG)).toContain('STAC API · public HTTPS')
    expect(catalogProtocolHint(USGS_LANDSAT_CATALOG)).toContain(
      'LandsatLook CORS allows only landsatlook.usgs.gov, not Atlas',
    )
    expect(collectionSummariesFromRegistry(USGS_LANDSAT_CATALOG).map((entry) => entry.id)).toEqual([
      'landsat-c2l2-sr',
      'landsat-c2l2-st',
    ])
  })

  it('classifies catalog fetch throws as network unless the error names CORS', () => {
    const blocked = classifyStacClientError(
      new StacClientError('NETWORK', 'NetworkError when attempting to fetch resource.'),
    )
    expect(blocked).toMatchObject({
      kind: 'browser-network-blocked',
      title: 'Browser blocked this catalog',
    })
    const cors = classifyStacClientError(
      new StacClientError(
        'NETWORK',
        'Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://landsatlook.usgs.gov/stac-server/.',
      ),
    )
    expect(cors.kind).toBe('cors')
    expect(cors.title).toBe('Catalog origin blocked')
  })

  it('normalizes STAC items into source candidates with provenance', async () => {
    const item = parseStacItem(
      JSON.parse(
        await readFile(new URL('./fixtures/stac/item-ortho.json', import.meta.url), 'utf8'),
      ),
    )
    const candidates = candidatesFromItem(KY_FROM_ABOVE_CATALOG, item)
    expect(candidates).toHaveLength(1)
    const candidate = preferredCandidate(candidates, item)
    expect(candidate?.collectionId).toBe('orthos-phase2')
    expect(candidate?.itemId).toBe('N082E280_2019_6IN_cog.tif')
    expect(candidate?.assetKey).toBe('data')
    expect(candidate?.license).toBe('CC-BY-4.0')
    expect(candidate?.attribution).toContain('KyFromAbove')
    expect(candidate?.sourceUrl).toContain('/items/')
    expect(candidate?.href).toContain('.tif')
    expect(candidate?.href.includes('X-Amz-Signature')).toBe(false)
    expect(candidate?.bandCount).toBe(4)
    const dem = parseStacItem(
      JSON.parse(await readFile(new URL('./fixtures/stac/item-dem.json', import.meta.url), 'utf8')),
    )
    const demCandidate = preferredCandidate(candidatesFromItem(KY_FROM_ABOVE_CATALOG, dem), dem)
    expect(demCandidate?.bandCount).toBe(1)
    expect(
      preferredCandidate(
        candidatesFromItem(KY_FROM_ABOVE_CATALOG, item, {
          style: { mapping: { gray: 0 }, stretch: 'percentile' },
        }),
        item,
      )?.style?.stretch,
    ).toBe('percentile')
  })

  it('round-trips deep links and catalog sessions without signed URLs', () => {
    const link = serializeAtlasDeepLink({
      catalogId: 'ky-from-above',
      collectionId: 'orthos-phase2',
      itemId: 'N082E280_2019_6IN_cog.tif',
      assetKey: 'data',
      inspect: true,
    })
    expect(link).not.toContain('https://')
    expect(parseAtlasDeepLink(link)).toMatchObject({
      kind: 'asset',
      catalogId: 'ky-from-above',
      itemId: 'N082E280_2019_6IN_cog.tif',
      inspect: true,
    })
    const workflow = serializeAtlasDeepLink({
      kind: 'workflow',
      workflowId: 'geo.ndvi',
      sources: [
        {
          catalogId: 'catalog',
          collectionId: 'collection',
          itemId: 'item',
          assetKey: 'data',
        },
      ],
      parameters: { nir: 3, red: 2, scaled: true },
      presetId: 'false-color',
      inspector: 'workflows',
    })
    expect(workflow.length).toBeLessThan(512)
    expect(workflow).not.toContain('href')
    expect(parseAtlasDeepLink(workflow)).toEqual({
      schemaVersion: 2,
      kind: 'workflow',
      workflowId: 'geo.ndvi',
      sources: [
        {
          catalogId: 'catalog',
          collectionId: 'collection',
          itemId: 'item',
          assetKey: 'data',
        },
      ],
      parameters: { nir: 3, red: 2, scaled: true },
      presetId: 'false-color',
      inspector: 'workflows',
    })
    expect(parseAtlasDeepLink(`${workflow}&href=https%3A%2F%2Fsigned.invalid%2Fx`)).toBeUndefined()
    expect(
      parseAtlasDeepLink(
        '#v=2&kind=workflow&workflow=x&c0=c&n0=n&i0=i&a0=a&p.__proto__=string%3Apolluted',
      ),
    ).toBeUndefined()
    const session = parseAtlasCatalogSession(
      JSON.parse(
        serializeAtlasCatalogSession({
          schemaVersion: 1,
          label: 'Frankfort ortho',
          provenance: {
            catalogId: 'ky-from-above',
            catalogTitle: 'Kentucky From Above',
            collectionId: 'orthos-phase2',
            itemId: 'N082E280_2019_6IN_cog.tif',
            assetKey: 'data',
            href: 'https://kyfromabove.s3.us-west-2.amazonaws.com/example.tif',
            license: 'CC-BY-4.0',
            attribution: 'KyFromAbove',
            provider: 'KyFromAbove',
            sourceUrl: 'https://stac.example.test/items/example',
          },
        }),
      ),
    )
    expect(session?.provenance.collectionId).toBe('orthos-phase2')
    expect(
      parseAtlasCatalogSession({
        schemaVersion: 1,
        provenance: { href: 'https://x?X-Amz-Signature=1' },
      }),
    ).toBeUndefined()
    const source = createGeoRasterSource({
      id: 'src-1',
      label: 'Frankfort',
      width: 4,
      height: 2,
      componentCount: 4,
      spatialReference: wgs84,
      locator: { kind: 'bundled-example', scenarioId: 'test.catalog-source' },
      catalog: session?.provenance,
    })
    const project = createGeoProject({
      title: 'Kentucky story',
      crs: CRS_EPSG_4326,
      sources: [source],
    })
    expect(project.sources[0]?.catalog?.itemId).toBe('N082E280_2019_6IN_cog.tif')
    const snapshot = JSON.parse(JSON.stringify(project)) as typeof project
    const restored = createGeoProject({
      id: snapshot.id,
      title: snapshot.title,
      crs: snapshot.crs,
      sources: snapshot.sources,
      layers: snapshot.layers,
    })
    expect(restored.sources[0]?.catalog).toEqual(project.sources[0]?.catalog)
    expect(() =>
      createGeoRasterSource({
        id: 'bad',
        label: 'bad',
        width: 4,
        height: 2,
        componentCount: 1,
        spatialReference: wgs84,
        locator: { kind: 'bundled-example', scenarioId: 'test.signed-source' },
        catalog: {
          catalogId: 'x',
          catalogTitle: 'x',
          collectionId: 'x',
          itemId: 'x',
          assetKey: 'data',
          href: 'https://bucket/file.tif?X-Amz-Signature=secret',
        },
      }),
    ).toThrow(GeoValidationError)
  })
})

describe('catalog CRS registration', () => {
  it('registers Kentucky Single Zone so viewport bounds can search in WGS84', () => {
    const def = KY_FROM_ABOVE_CATALOG.crsDefinitions?.[0]
    expect(def).toBeDefined()
    if (def === undefined) return
    registerCrsDefinition(def.key, def.proj4)
    const geographic = transformMapPoint(
      { x: 5_175_000, y: 3_950_000 },
      { kind: 'projected', authority: 'EPSG', code: 3089, name: 'Kentucky Single Zone' },
      CRS_EPSG_4326,
    )
    expect(geographic.x).toBeGreaterThan(-89)
    expect(geographic.x).toBeLessThan(-81)
    expect(geographic.y).toBeGreaterThan(36)
    expect(geographic.y).toBeLessThan(40)
  })
})
