import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('workbench-core package boundary', () => {
  it('has no React, PureJsImage, or domain-package dependency', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      readonly dependencies?: Readonly<Record<string, string>>
      readonly peerDependencies?: Readonly<Record<string, string>>
    }
    const names = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]
    expect(names).not.toContain('react')
    expect(names).not.toContain('react-dom')
    expect(names).not.toContain('purejsimage')
    expect(names).not.toContain('@pji-workbench/domain-science')
    expect(names).not.toContain('@pji-workbench/domain-geo')
    expect(names).toEqual(
      expect.arrayContaining([
        '@pji-workbench/actions',
        '@pji-workbench/imaging',
        '@pji-workbench/workspace',
      ]),
    )
    const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(index).not.toContain('scienceDomainProfile')
    expect(index).not.toContain('domain-science')
  })
})
