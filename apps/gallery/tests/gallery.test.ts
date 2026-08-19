import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { GEO_APP_URL, LIBRARY_SITE_URL, SCIENCE_APP_URL, SHOWCASE_CARDS } from '../src/showcase.js'

describe('gallery showcase', () => {
  it('links to separately deployed science and geo apps and marks medical as planned', () => {
    expect(LIBRARY_SITE_URL).toBe('https://purejsimage.com')
    expect(SCIENCE_APP_URL).toBe('https://lab.purejsimage.com')
    expect(GEO_APP_URL).toBe('https://geo.purejsimage.com')
    expect(SHOWCASE_CARDS.map(({ id, status }) => [id, status])).toEqual([
      ['science', 'live'],
      ['geo', 'live'],
      ['medical', 'planned'],
    ])
    const medical = SHOWCASE_CARDS.find((card) => card.id === 'medical')
    expect(medical?.href).toBeUndefined()
  })

  it('does not depend on the imaging runtime or domain packages', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      readonly dependencies?: Readonly<Record<string, string>>
    }
    const names = Object.keys(manifest.dependencies ?? {})
    expect(names).toEqual(['@pji-workbench/ui', 'react', 'react-dom'])
    expect(names).not.toContain('@pji-workbench/imaging')
    expect(names).not.toContain('@pji-workbench/domain-science')
    expect(names).not.toContain('@pji-workbench/domain-geo')
    expect(names).not.toContain('@pji-workbench/materials-analysis')
    expect(names).not.toContain('@pji-workbench/workbench-core')
  })
})
