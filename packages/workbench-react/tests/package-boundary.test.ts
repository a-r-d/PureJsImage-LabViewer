import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('workbench-react package boundary', () => {
  it('does not depend on domain or imaging packages', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      readonly dependencies?: Readonly<Record<string, string>>
    }
    const names = Object.keys(manifest.dependencies ?? {})
    expect(names).toEqual(['@pji-workbench/agent', '@pji-workbench/ui', 'react'])
    expect(names).not.toContain('@pji-workbench/domain-science')
    expect(names).not.toContain('@pji-workbench/domain-geo')
    expect(names).not.toContain('@pji-workbench/imaging')
    expect(names).not.toContain('@pji-workbench/materials-analysis')
  })
})
