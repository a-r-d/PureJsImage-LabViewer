import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('domain-science package boundary', () => {
  it('depends on materials-analysis and not on geo', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      readonly dependencies?: Readonly<Record<string, string>>
    }
    const names = Object.keys(manifest.dependencies ?? {})
    expect(names).toContain('@pji-workbench/materials-analysis')
    expect(names).toContain('@pji-workbench/workbench-core')
    expect(names).not.toContain('@pji-workbench/domain-geo')
    expect(names).not.toContain('purejsimage')
  })
})
