import { describe, expect, it } from 'vitest'

import {
  parseRestrictedMarkdown,
  restrictedMarkdownPlainText,
  sanitizeHref,
} from '../src/restricted-markdown.js'

describe('restricted markdown', () => {
  it('parses the allowed subset without HTML', () => {
    const blocks = parseRestrictedMarkdown(
      [
        '# Heading',
        '',
        'A **bold** and *italic* paragraph with `code` and [docs](https://example.com/path).',
        '',
        '- one',
        '- two',
        '',
        '1. first',
        '',
        '> quoted',
        '',
        '```ts',
        'const value = 1',
        '```',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        '<script>alert(1)</script>',
      ].join('\n'),
    )
    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'blockquote',
      'code',
      'table',
      'paragraph',
    ])
    expect(JSON.stringify(blocks)).not.toContain('<script>')
    expect(restrictedMarkdownPlainText('**Safe** copy')).toBe('Safe copy')
  })

  it('rejects javascript and credential-bearing URLs', () => {
    expect(sanitizeHref('javascript:alert(1)')).toBeUndefined()
    expect(sanitizeHref('https://user:pass@example.com')).toBeUndefined()
    expect(sanitizeHref('https://example.com/docs')).toBe('https://example.com/docs')
  })

  it('falls back to text when markdown is malformed', () => {
    const blocks = parseRestrictedMarkdown('```unterminated')
    expect(blocks[0]?.type === 'code' || blocks[0]?.type === 'text-fallback').toBe(true)
  })
})
