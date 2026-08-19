import { readFile } from 'node:fs/promises'
import { geoDomainProfile, geoUiContributions } from '@pji-workbench/domain-geo'
import { describe, expect, it } from 'vitest'

describe('geo application', () => {
  it('boots the Atlas workbench on the shared shell', async () => {
    const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
    expect(appSource).toContain('WorkbenchShell')
    expect(appSource).toContain('geoUiContributions')
    expect(appSource).toContain('createGeoImagingWorkerClient')
    expect(appSource).toContain('imaging-client.js')
    expect(appSource).toContain('CatalogPanel')
    expect(appSource).toContain('appendAtlas')
    expect(appSource).toContain('viewportRasters')
    expect(appSource).toContain('opened?.rasters.map((raster) => raster.dataset)')
    expect(appSource).not.toContain('if (replaced) setOpened(null)')
    expect(appSource).not.toContain('opened={opened.dataset}')
    const viewportSource = await readFile(
      new URL('../src/GeoViewport.tsx', import.meta.url),
      'utf8',
    )
    expect(viewportSource).toContain('datasetHandleId: context.raster.handleId')
    expect(viewportSource).toContain('rasters: readonly OpenedDatasetDescriptor[]')
    expect(viewportSource).toContain('renderer.upload(layerPlan.layerId, tile, context.adapter)')
    expect(viewportSource).toContain('cached.adapter.pixelToWorld')
    expect(viewportSource).not.toContain('opened.handleId')
    expect(appSource).not.toContain('orthos-phase2')
    expect(appSource).not.toContain('dem-phase2')
    const catalogSource = await readFile(
      new URL('../src/CatalogPanel.tsx', import.meta.url),
      'utf8',
    )
    expect(catalogSource).not.toContain('orthos-phase')
    expect(catalogSource).not.toContain('dem-phase')
    expect(catalogSource).toContain('openItem(item, preferInspect)')
    expect(catalogSource).toContain('Click a tile to open it in the map')
    expect(catalogSource).toContain('searchNonce')
    expect(appSource).toContain('geo-opening')
    expect(appSource).toContain('setSearchNonce')
    expect(appSource).not.toContain('domain-science')
    expect(appSource).not.toContain('ParticleAnalysis')
    expect(appSource).not.toContain('Choose local scientific files')
    expect(geoDomainProfile.id).toBe('geo')
    expect(geoDomainProfile.capabilities.localFiles).toBe(true)
    expect(geoUiContributions.panels.map(({ id }) => id)).toContain('geo-catalog')
    expect(geoUiContributions.panels.map(({ id }) => id)).toContain('geo-xray')
  })

  it('depends on imaging and viewport without science or materials packages', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      readonly dependencies?: Readonly<Record<string, string>>
    }
    const names = Object.keys(manifest.dependencies ?? {})
    expect(names).toEqual(
      expect.arrayContaining([
        '@pji-workbench/contracts',
        '@pji-workbench/domain-geo',
        '@pji-workbench/imaging',
        '@pji-workbench/ui',
        '@pji-workbench/viewport',
        '@pji-workbench/workbench-react',
      ]),
    )
    expect(names).not.toContain('@pji-workbench/domain-science')
    expect(names).not.toContain('@pji-workbench/materials-analysis')
  })

  it('hosts the imaging Worker from the Atlas app entry, not the package Worker URL', async () => {
    const clientSource = await readFile(
      new URL('../src/imaging-client.ts', import.meta.url),
      'utf8',
    )
    const workerSource = await readFile(
      new URL('../src/imaging-worker-entry.ts', import.meta.url),
      'utf8',
    )
    expect(clientSource).toContain('./imaging-worker-entry.ts')
    expect(workerSource).toContain('ImagingWorkerHost')
    expect(workerSource).not.toContain('materials-analysis')
    expect(workerSource).not.toContain('createMaterialsAnalysisExtension')
  })
})
