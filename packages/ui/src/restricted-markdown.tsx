import { createElement, type ReactNode } from 'react'

export const RESTRICTED_MARKDOWN_LIMITS = Object.freeze({
  maxNodes: 400,
  maxNesting: 6,
  maxTableRows: 32,
  maxTableColumns: 8,
  maxCellChars: 256,
  maxCodeChars: 8_192,
  maxHeadingChars: 200,
})

export type RestrictedMarkdownNode =
  | Readonly<{ type: 'paragraph'; children: readonly RestrictedInline[] }>
  | Readonly<{ type: 'heading'; level: 1 | 2 | 3; children: readonly RestrictedInline[] }>
  | Readonly<{ type: 'list'; ordered: boolean; items: readonly (readonly RestrictedInline[])[] }>
  | Readonly<{ type: 'code'; language: string; text: string }>
  | Readonly<{ type: 'blockquote'; children: readonly RestrictedInline[] }>
  | Readonly<{
      type: 'table'
      headers: readonly (readonly RestrictedInline[])[]
      rows: readonly (readonly (readonly RestrictedInline[])[])[]
    }>
  | Readonly<{ type: 'text-fallback'; text: string }>

export type RestrictedInline =
  | Readonly<{ type: 'text'; text: string }>
  | Readonly<{ type: 'emphasis'; children: readonly RestrictedInline[] }>
  | Readonly<{ type: 'strong'; children: readonly RestrictedInline[] }>
  | Readonly<{ type: 'code'; text: string }>
  | Readonly<{ type: 'link'; href: string; children: readonly RestrictedInline[] }>

export function parseRestrictedMarkdown(source: string): readonly RestrictedMarkdownNode[] {
  try {
    return parseBlocks(source.replaceAll('\r\n', '\n'))
  } catch {
    return [{ type: 'text-fallback', text: source }]
  }
}

export function restrictedMarkdownPlainText(source: string): string {
  return parseRestrictedMarkdown(source).map(blockPlainText).join('\n\n').trim()
}

export function RestrictedMarkdown({ source }: { readonly source: string }) {
  const blocks = parseRestrictedMarkdown(source)
  return createElement(
    'div',
    { className: 'restricted-markdown' },
    ...blocks.map((block, index) => renderBlock(block, index)),
  )
}

function parseBlocks(source: string): RestrictedMarkdownNode[] {
  const lines = source.split('\n')
  const blocks: RestrictedMarkdownNode[] = []
  let nodes = 0
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim().length === 0) {
      index += 1
      continue
    }
    if (nodes >= RESTRICTED_MARKDOWN_LIMITS.maxNodes)
      return [...blocks, { type: 'text-fallback', text: lines.slice(index).join('\n') }]
    if (line.startsWith('```')) {
      const language = line.slice(3).trim().slice(0, 32)
      const body: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      const text = body.join('\n').slice(0, RESTRICTED_MARKDOWN_LIMITS.maxCodeChars)
      blocks.push({ type: 'code', language, text })
      nodes += 1
      continue
    }
    if (line.startsWith('>')) {
      const quoted: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('>')) {
        quoted.push((lines[index] ?? '').replace(/^>\s?/u, ''))
        index += 1
      }
      blocks.push({ type: 'blockquote', children: parseInline(quoted.join(' ')) })
      nodes += 1
      continue
    }
    if (/^#{1,3}\s+\S/u.test(line)) {
      const level = (line.startsWith('###') ? 3 : line.startsWith('##') ? 2 : 1) as 1 | 2 | 3
      const text = line
        .replace(/^#{1,3}\s+/u, '')
        .slice(0, RESTRICTED_MARKDOWN_LIMITS.maxHeadingChars)
      blocks.push({ type: 'heading', level, children: parseInline(text) })
      nodes += 1
      index += 1
      continue
    }
    if (isTableRow(line) && isTableDivider(lines[index + 1] ?? '')) {
      const header = splitTableRow(line)
      index += 2
      const rows: string[][] = []
      while (
        index < lines.length &&
        isTableRow(lines[index] ?? '') &&
        rows.length < RESTRICTED_MARKDOWN_LIMITS.maxTableRows
      ) {
        rows.push(splitTableRow(lines[index] ?? ''))
        index += 1
      }
      blocks.push({
        type: 'table',
        headers: header.map((cell) => parseInline(cell)),
        rows: rows.map((row) => header.map((_, column) => parseInline(row[column] ?? ''))),
      })
      nodes += 1
      continue
    }
    if (/^\s*(?:[-*]|\d+\.)\s+\S/u.test(line)) {
      const ordered = /^\s*\d+\./u.test(line)
      const items: string[] = []
      while (index < lines.length && /^\s*(?:[-*]|\d+\.)\s+/u.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*(?:[-*]|\d+\.)\s+/u, ''))
        index += 1
      }
      blocks.push({
        type: 'list',
        ordered,
        items: items.map((item) => parseInline(item)),
      })
      nodes += 1
      continue
    }
    const paragraph: string[] = []
    while (
      index < lines.length &&
      (lines[index] ?? '').trim().length > 0 &&
      !isBlockStart(lines[index] ?? '')
    ) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) })
    nodes += 1
  }
  return blocks.length === 0 ? [{ type: 'text-fallback', text: source }] : blocks
}

function isBlockStart(line: string): boolean {
  return (
    line.startsWith('```') ||
    line.startsWith('>') ||
    /^#{1,3}\s+\S/u.test(line) ||
    /^\s*(?:[-*]|\d+\.)\s+\S/u.test(line) ||
    isTableRow(line)
  )
}

function isTableRow(line: string): boolean {
  return line.includes('|') && line.trim().startsWith('|') && line.trim().endsWith('|')
}

function isTableDivider(line: string): boolean {
  return isTableRow(line) && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(line.trim())
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .slice(0, RESTRICTED_MARKDOWN_LIMITS.maxTableColumns)
    .map((cell) => cell.trim().slice(0, RESTRICTED_MARKDOWN_LIMITS.maxCellChars))
}

function parseInline(source: string, depth = 0): RestrictedInline[] {
  if (depth > RESTRICTED_MARKDOWN_LIMITS.maxNesting) return [{ type: 'text', text: source }]
  const nodes: RestrictedInline[] = []
  let remaining = source
  while (remaining.length > 0) {
    const code = remaining.match(/^`([^`]+)`/u)
    if (code?.[1] !== undefined) {
      nodes.push({ type: 'code', text: code[1] })
      remaining = remaining.slice(code[0].length)
      continue
    }
    const strong = remaining.match(/^\*\*(.+?)\*\*/u)
    if (strong?.[1] !== undefined) {
      nodes.push({ type: 'strong', children: parseInline(strong[1], depth + 1) })
      remaining = remaining.slice(strong[0].length)
      continue
    }
    const emphasis = remaining.match(/^\*(.+?)\*/u)
    if (emphasis?.[1] !== undefined) {
      nodes.push({ type: 'emphasis', children: parseInline(emphasis[1], depth + 1) })
      remaining = remaining.slice(emphasis[0].length)
      continue
    }
    const link = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/u)
    if (link?.[1] !== undefined && link[2] !== undefined) {
      const href = sanitizeHref(link[2])
      if (href !== undefined) {
        nodes.push({ type: 'link', href, children: parseInline(link[1], depth + 1) })
        remaining = remaining.slice(link[0].length)
        continue
      }
    }
    const next = remaining.search(/[`*[]/u)
    const text = next === -1 ? remaining : remaining.slice(0, Math.max(1, next))
    nodes.push({ type: 'text', text: stripHtml(text) })
    remaining = remaining.slice(text.length)
    if (next === 0) {
      nodes.push({ type: 'text', text: remaining.slice(0, 1) })
      remaining = remaining.slice(1)
    }
  }
  return nodes
}

export function sanitizeHref(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 2_048) return undefined
  if (/[\s<>\\]/u.test(trimmed) || trimmed.includes(':///')) return undefined
  try {
    if (trimmed.startsWith('/') || trimmed.startsWith('#')) return undefined
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'mailto:')
      return undefined
    if (url.username.length > 0 || url.password.length > 0) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function stripHtml(value: string): string {
  return value.replaceAll(/<[^>]*>/gu, '')
}

function renderBlock(block: RestrictedMarkdownNode, key: number): ReactNode {
  switch (block.type) {
    case 'text-fallback':
      return createElement('p', { key }, block.text)
    case 'paragraph':
      return createElement('p', { key }, ...renderInline(block.children))
    case 'heading':
      return createElement(`h${block.level}`, { key }, ...renderInline(block.children))
    case 'blockquote':
      return createElement(
        'blockquote',
        { key },
        createElement('p', null, ...renderInline(block.children)),
      )
    case 'code':
      return createElement('pre', { key }, createElement('code', null, block.text))
    case 'list':
      return createElement(
        block.ordered ? 'ol' : 'ul',
        { key },
        ...block.items.map((item, index) =>
          createElement('li', { key: index }, ...renderInline(item)),
        ),
      )
    case 'table':
      return createElement(
        'div',
        { key, className: 'restricted-markdown__table' },
        createElement(
          'table',
          null,
          createElement(
            'thead',
            null,
            createElement(
              'tr',
              null,
              ...block.headers.map((cell, index) =>
                createElement('th', { key: index }, ...renderInline(cell)),
              ),
            ),
          ),
          createElement(
            'tbody',
            null,
            ...block.rows.map((row, rowIndex) =>
              createElement(
                'tr',
                { key: rowIndex },
                ...row.map((cell, cellIndex) =>
                  createElement('td', { key: cellIndex }, ...renderInline(cell)),
                ),
              ),
            ),
          ),
        ),
      )
  }
}

function renderInline(nodes: readonly RestrictedInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.text
      case 'code':
        return createElement('code', { key: index }, node.text)
      case 'emphasis':
        return createElement('em', { key: index }, ...renderInline(node.children))
      case 'strong':
        return createElement('strong', { key: index }, ...renderInline(node.children))
      case 'link':
        return createElement(
          'a',
          {
            key: index,
            href: node.href,
            rel: 'noopener noreferrer nofollow',
            target: '_blank',
          },
          ...renderInline(node.children),
        )
      default: {
        const exhaustive: never = node
        return exhaustive
      }
    }
  })
}

function blockPlainText(block: RestrictedMarkdownNode): string {
  switch (block.type) {
    case 'text-fallback':
      return block.text
    case 'code':
      return block.text
    case 'paragraph':
    case 'heading':
    case 'blockquote':
      return inlinePlainText(block.children)
    case 'list':
      return block.items.map((item) => inlinePlainText(item)).join('\n')
    case 'table':
      return [
        block.headers.map(inlinePlainText).join('\t'),
        ...block.rows.map((row) => row.map(inlinePlainText).join('\t')),
      ].join('\n')
  }
}

function inlinePlainText(nodes: readonly RestrictedInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.text
        case 'emphasis':
        case 'strong':
        case 'link':
          return inlinePlainText(node.children)
        default: {
          const exhaustive: never = node
          return exhaustive
        }
      }
    })
    .join('')
}
