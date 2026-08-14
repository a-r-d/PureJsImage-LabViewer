export interface CorpusArchiveBudgets {
  readonly maxFiles: number
  readonly maxExpandedBytes: number
  readonly maxFileBytes: number
  readonly maxCompressionRatio: number
  readonly maxPathLength: number
}

export interface CorpusArchiveEntry {
  readonly path: string
  readonly kind: 'file' | 'directory' | 'symlink'
  readonly expandedBytes: number
  readonly compressedBytes: number
  read(): Promise<Uint8Array>
}

export type CorpusArchiveDecoder = (
  archive: Uint8Array,
  signal: AbortSignal,
) => Promise<readonly CorpusArchiveEntry[]>

function safePath(path: string, maxLength: number): boolean {
  if (path === '' || path.length > maxLength || path.includes('\0') || path.includes('\\'))
    return false
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false
  let decoded = path
  try {
    let stable = false
    for (let pass = 0; pass < 8; pass += 1) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) {
        stable = true
        break
      }
      decoded = next
    }
    if (!stable) return false
  } catch {
    return false
  }
  if (
    decoded === '' ||
    decoded.length > maxLength ||
    decoded.includes('\0') ||
    decoded.includes('\\') ||
    decoded.startsWith('/') ||
    /^[A-Za-z]:/.test(decoded)
  )
    return false
  const segments = decoded.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

export function validateArchiveEntries(
  entries: readonly CorpusArchiveEntry[],
  budgets: CorpusArchiveBudgets,
): readonly string[] {
  const issues: string[] = []
  if (entries.length > budgets.maxFiles) issues.push('Archive exceeds the file-count budget.')
  const paths = new Set<string>()
  let expandedTotal = 0
  for (const entry of entries) {
    if (!safePath(entry.path, budgets.maxPathLength))
      issues.push(`Unsafe archive path: ${JSON.stringify(entry.path)}.`)
    if (paths.has(entry.path)) issues.push(`Duplicate archive path: ${JSON.stringify(entry.path)}.`)
    paths.add(entry.path)
    if (entry.kind === 'symlink')
      issues.push(`Archive symlink refused: ${JSON.stringify(entry.path)}.`)
    if (
      !Number.isSafeInteger(entry.expandedBytes) ||
      !Number.isSafeInteger(entry.compressedBytes) ||
      entry.expandedBytes < 0 ||
      entry.compressedBytes < 0
    ) {
      issues.push(`Invalid archive size for ${JSON.stringify(entry.path)}.`)
      continue
    }
    if (entry.expandedBytes > budgets.maxFileBytes)
      issues.push(`Archive member exceeds the per-file budget: ${JSON.stringify(entry.path)}.`)
    expandedTotal += entry.expandedBytes
    if (!Number.isSafeInteger(expandedTotal)) {
      issues.push('Archive expanded-byte total exceeds the safe integer range.')
      expandedTotal = Number.POSITIVE_INFINITY
    }
    const ratio = entry.expandedBytes / Math.max(1, entry.compressedBytes)
    if (ratio > budgets.maxCompressionRatio)
      issues.push(
        `Archive member exceeds the compression-ratio budget: ${JSON.stringify(entry.path)}.`,
      )
  }
  if (expandedTotal > budgets.maxExpandedBytes)
    issues.push('Archive exceeds the expanded-byte budget.')
  return issues
}

export async function extractCorpusArchive(
  archive: Uint8Array,
  decoder: CorpusArchiveDecoder,
  budgets: CorpusArchiveBudgets,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, Uint8Array>> {
  if (signal.aborted) throw signal.reason
  const entries = await decoder(archive, signal)
  const issues = validateArchiveEntries(entries, budgets)
  if (issues.length > 0) throw new Error(issues.join('\n'))
  const files = new Map<string, Uint8Array>()
  for (const entry of entries) {
    if (signal.aborted) throw signal.reason
    if (entry.kind !== 'file') continue
    const bytes = await entry.read()
    if (bytes.byteLength !== entry.expandedBytes)
      throw new Error(`Archive member size changed while extracting ${JSON.stringify(entry.path)}.`)
    files.set(entry.path, bytes.slice())
  }
  return files
}
