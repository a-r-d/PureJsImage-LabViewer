import { WORKSPACE_LIMITS, type WorkspaceSnapshot } from './model.js'

export class WorkspaceSerializationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceSerializationError'
  }
}

function encode(value: unknown, ancestors: Set<object>, depth: number): string {
  if (depth > 64) throw new WorkspaceSerializationError('project exceeds the nesting limit')
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new WorkspaceSerializationError('project numbers must be finite')
    return Object.is(value, -0) ? '0' : JSON.stringify(value)
  }
  if (typeof value !== 'object') {
    throw new WorkspaceSerializationError(`project contains non-JSON value: ${typeof value}`)
  }
  if (ancestors.has(value)) throw new WorkspaceSerializationError('project contains a cycle')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => encode(item, ancestors, depth + 1)).join(',')}]`
    }
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${encode(record[key], ancestors, depth + 1)}`)
      .join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

export function deterministicJson(value: unknown): string {
  return encode(value, new Set(), 0)
}

export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(deterministicJson(value)).byteLength
}

export function serializeWorkspaceProject(snapshot: WorkspaceSnapshot): string {
  const persistent = {
    ...snapshot,
    sources: snapshot.sources.map((source) =>
      source.locator.kind === 'local' ? { ...source, bound: false } : source,
    ),
  }
  const json = deterministicJson(persistent)
  if (new TextEncoder().encode(json).byteLength > WORKSPACE_LIMITS.maxProjectBytes) {
    throw new WorkspaceSerializationError('project exceeds the byte limit')
  }
  return json
}
