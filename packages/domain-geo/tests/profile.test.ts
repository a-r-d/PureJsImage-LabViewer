import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  createGeoDomainProfile,
  GEO_FILE_ACCEPT,
  GEO_READER_IDS,
  geoDomainProfile,
  geoUiContributions,
} from '../src/index.js'

describe('geo domain profile', () => {
  it('enables local and remote GeoTIFF/COG inspection without science capabilities', () => {
    const profile = createGeoDomainProfile()
    expect(profile).toBe(geoDomainProfile)
    expect(profile.id).toBe('geo')
    expect(profile.deploymentHostname).toBe('geo.purejsimage.com')
    expect(profile.readerIds).toEqual([...GEO_READER_IDS])
    expect(profile.sourceAdapters).toEqual(['local', 'remote'])
    expect(profile.capabilities.sources.localFiles).toBe(true)
    expect(profile.capabilities.sources.remoteHttps).toBe(true)
    expect(profile.capabilities.sources.catalogs).toBe(true)
    expect(profile.capabilities.workspace.projectPersistence).toBe(true)
    expect(profile.capabilities.analysis.particle).toBe(false)
    expect(profile.capabilities.analysis.materials).toBe(false)
    expect(profile.actionDefinitions.length).toBeGreaterThan(0)
    expect(profile.capabilities.automation.agent).toBe(true)
    expect(profile.agentPolicy.enabled).toBe(true)
    expect(profile.agentPolicy.liveModelEnabled).toBe(true)
    expect(GEO_FILE_ACCEPT).toContain('.tif')
    expect(geoUiContributions.panels.map(({ id }) => id)).toEqual([
      'geo-catalog',
      'geo-agent',
      'geo-layers',
      'geo-vectors',
      'geo-display',
      'geo-xray',
    ])
    const copy = `${profile.title} ${profile.description} ${geoUiContributions.emptyState.heading} ${geoUiContributions.emptyState.body}`
    expect(copy).not.toMatch(/microscopy|particle|scientific imaging|materials/i)
    expect(copy).toMatch(/GeoTIFF|COG/i)
    expect(geoUiContributions.emptyState.heading).toMatch(/click a Ready tile/i)
  })
})

describe('geo domain package boundary', () => {
  it('does not depend on science or materials-analysis', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      readonly dependencies?: Readonly<Record<string, string>>
    }
    const names = Object.keys(manifest.dependencies ?? {})
    expect(names).toEqual(
      expect.arrayContaining([
        '@pji-workbench/actions',
        '@pji-workbench/workbench-core',
        '@pji-workbench/contracts',
        'proj4',
      ]),
    )
    expect(names).toHaveLength(4)
    expect(names).not.toContain('@pji-workbench/domain-science')
    expect(names).not.toContain('@pji-workbench/materials-analysis')
    expect(names).not.toContain('@pji-workbench/imaging')
    expect(names).not.toContain('react')
    expect(names).not.toContain('purejsimage')
  })
})
