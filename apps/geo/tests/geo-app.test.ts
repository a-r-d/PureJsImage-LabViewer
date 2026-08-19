import { readFile } from 'node:fs/promises'
import { geoDomainProfile, geoUiContributions } from '@pji-workbench/domain-geo'
import { describe, expect, it } from 'vitest'

describe('geo application', () => {
  it('boots the empty geo profile through the shared shell', async () => {
    const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
    expect(appSource).toContain('WorkbenchShell')
    expect(appSource).toContain('geoDomainProfile')
    expect(appSource).toContain('geoUiContributions')
    expect(appSource).not.toContain('domain-science')
    expect(appSource).not.toContain('materials-analysis')
    expect(appSource).not.toContain('ParticleAnalysis')
    expect(appSource).not.toContain('Choose local scientific files')
    expect(geoDomainProfile.id).toBe('geo')
    expect(geoUiContributions.panels).toEqual([])
  })

  it('does not depend on science or materials packages', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      readonly dependencies?: Readonly<Record<string, string>>
    }
    const names = Object.keys(manifest.dependencies ?? {})
    expect(names).toEqual(
      expect.arrayContaining([
        '@pji-workbench/domain-geo',
        '@pji-workbench/ui',
        '@pji-workbench/workbench-react',
      ]),
    )
    expect(names).not.toContain('@pji-workbench/domain-science')
    expect(names).not.toContain('@pji-workbench/materials-analysis')
    expect(names).not.toContain('@pji-workbench/imaging')
  })
})
