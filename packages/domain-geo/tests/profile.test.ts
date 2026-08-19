import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { createGeoDomainProfile, geoDomainProfile, geoUiContributions } from '../src/index.js'

describe('geo domain profile', () => {
  it('boots an empty geo profile without science capabilities or terminology', () => {
    const profile = createGeoDomainProfile()
    expect(profile).toBe(geoDomainProfile)
    expect(profile.id).toBe('geo')
    expect(profile.deploymentHostname).toBe('geo.purejsimage.com')
    expect(profile.readerIds).toEqual([])
    expect(profile.actionDefinitions).toEqual([])
    expect(profile.exampleScenarioIds).toEqual([])
    expect(profile.capabilities.particleAnalysis).toBe(false)
    expect(profile.capabilities.materialsToolbox).toBe(false)
    expect(profile.agentPolicy.enabled).toBe(false)
    expect(geoUiContributions.panels).toEqual([])
    expect(geoUiContributions.defaultLayout).toBeUndefined()
    const copy = `${profile.title} ${profile.description} ${geoUiContributions.emptyState.heading} ${geoUiContributions.emptyState.body}`
    expect(copy).not.toMatch(/microscopy|particle|scientific imaging|materials/i)
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
        '@pji-workbench/workbench-core',
        '@pji-workbench/contracts',
        'proj4',
      ]),
    )
    expect(names).toHaveLength(3)
    expect(names).not.toContain('@pji-workbench/domain-science')
    expect(names).not.toContain('@pji-workbench/materials-analysis')
    expect(names).not.toContain('@pji-workbench/imaging')
    expect(names).not.toContain('react')
    expect(names).not.toContain('purejsimage')
  })
})
