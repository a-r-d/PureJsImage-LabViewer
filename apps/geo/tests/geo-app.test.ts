import { readFile } from 'node:fs/promises'
import { geoDomainProfile, geoUiContributions } from '@pji-workbench/domain-geo'
import { describe, expect, it } from 'vitest'

describe('geo application', () => {
  it('boots the Atlas workbench on the shared shell', async () => {
    const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
    expect(appSource).toContain('WorkbenchShell')
    expect(appSource).toContain('geoUiContributions')
    expect(appSource).toContain('createImagingWorkerClient')
    expect(appSource).toContain('CatalogPanel')
    expect(appSource).not.toContain('orthos-phase2')
    expect(appSource).not.toContain('dem-phase2')
    const catalogSource = await readFile(
      new URL('../src/CatalogPanel.tsx', import.meta.url),
      'utf8',
    )
    expect(catalogSource).not.toContain('orthos-phase')
    expect(catalogSource).not.toContain('dem-phase')
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
})
