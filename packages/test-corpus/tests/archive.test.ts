import { describe, expect, it } from 'vitest'

import {
  type CorpusArchiveBudgets,
  type CorpusArchiveEntry,
  extractCorpusArchive,
  validateArchiveEntries,
} from '../src/index.js'

const budgets: CorpusArchiveBudgets = {
  maxFiles: 3,
  maxExpandedBytes: 32,
  maxFileBytes: 16,
  maxCompressionRatio: 10,
  maxPathLength: 80,
}

function entry(
  path: string,
  value = new Uint8Array([1, 2]),
  kind: CorpusArchiveEntry['kind'] = 'file',
): CorpusArchiveEntry {
  return {
    path,
    kind,
    expandedBytes: value.byteLength,
    compressedBytes: Math.max(1, value.byteLength),
    read: async () => value,
  }
}

describe('bounded corpus archive extraction', () => {
  it('extracts validated files only after checking the complete directory', async () => {
    const output = await extractCorpusArchive(
      new Uint8Array([0]),
      async () => [entry('images/input.png'), entry('masks/input.png')],
      budgets,
      new AbortController().signal,
    )
    expect([...output.keys()]).toEqual(['images/input.png', 'masks/input.png'])
  })

  it.each([
    '../secret',
    '/absolute',
    'safe/../../secret',
    'safe\\secret',
    '%2e%2e/secret',
    '%252e%252e/secret',
    '%252525252e%252525252e/secret',
    'safe%5csecret',
    '%2Fabsolute',
  ])('refuses traversal path %s', (path) => {
    expect(validateArchiveEntries([entry(path)], budgets).join(' ')).toContain(
      'Unsafe archive path',
    )
  })

  it('refuses symlinks, duplicates, excessive counts, sizes, and compression ratios', () => {
    const hostile: CorpusArchiveEntry[] = [
      entry('duplicate.bin'),
      entry('duplicate.bin'),
      { ...entry('link'), kind: 'symlink' },
      { ...entry('bomb.bin'), expandedBytes: 100, compressedBytes: 1 },
    ]
    const issues = validateArchiveEntries(hostile, budgets).join('\n')
    expect(issues).toContain('file-count budget')
    expect(issues).toContain('Duplicate archive path')
    expect(issues).toContain('symlink refused')
    expect(issues).toContain('per-file budget')
    expect(issues).toContain('compression-ratio budget')
    expect(issues).toContain('expanded-byte budget')
  })
})
