import {
  PLUGIN_LIMITS,
  type PluginJsonValue,
  type ScriptCapability,
  type ValidationIssue,
  type ValidationResult,
} from './types.js'
import { utf8ByteLength } from './utf8.js'

export const CAPABILITIES = new Set<ScriptCapability>([
  'analysis.catalog',
  'analysis.dry-run',
  'analysis.execute',
  'dataset.read-descriptor',
  'file.export',
  'network.explicit-hosts',
  'result.read-page',
  'result.read-summary',
  'roi.propose',
  'roi.read',
  'source.read-metadata',
  'ui.propose',
  'viewport.propose',
  'viewport.read',
  'workspace.propose',
  'workspace.read',
])

export const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u
export const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u
export const COMPATIBILITY =
  /^(?:\*|(?:\^|~|>=|>|<=|<)?\s*(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\s+(?:<|<=|>|>=)\s*(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))?)$/u
export const SHA256 = /^[a-f0-9]{64}$/u

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function byteLength(value: string): number {
  return utf8ByteLength(value)
}

export function addIssue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message })
}

export function stringField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  issues: ValidationIssue[],
  maximum: number,
  optional = false,
): string | undefined {
  const value = record[key]
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    addIssue(issues, `/${key}`, `Expected a non-empty string of at most ${maximum} characters.`)
    return undefined
  }
  return value.trim()
}

export function validateIdentifier(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is string {
  if (
    typeof value !== 'string' ||
    value.length > PLUGIN_LIMITS.identifierCharacters ||
    !IDENTIFIER.test(value)
  ) {
    addIssue(issues, path, 'Expected a bounded lowercase identifier.')
    return false
  }
  return true
}

export function validateJson(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  depth = 0,
  ancestors: ReadonlySet<object> = new Set(),
): value is PluginJsonValue {
  if (depth > 16) {
    addIssue(issues, path, 'JSON value exceeds maximum depth 16.')
    return false
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) addIssue(issues, path, 'Numbers must be finite.')
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    if (value.length > 1_024) addIssue(issues, path, 'Array exceeds 1024 items.')
    if (ancestors.has(value)) {
      addIssue(issues, path, 'JSON value contains a cycle.')
      return false
    }
    const nestedAncestors = new Set(ancestors).add(value)
    return (
      value.length <= 1_024 &&
      value.every((entry, index) =>
        validateJson(entry, `${path}/${index}`, issues, depth + 1, nestedAncestors),
      )
    )
  }
  if (!isRecord(value)) {
    addIssue(issues, path, 'Expected a JSON-safe value.')
    return false
  }
  const entries = Object.entries(value)
  if (entries.length > 256) addIssue(issues, path, 'Object exceeds 256 fields.')
  if (ancestors.has(value)) {
    addIssue(issues, path, 'JSON value contains a cycle.')
    return false
  }
  const nestedAncestors = new Set(ancestors).add(value)
  return (
    entries.length <= 256 &&
    entries.every(([key, entry]) => {
      if (key.length > 256) {
        addIssue(issues, `${path}/${key.slice(0, 256)}`, 'Object key exceeds 256 characters.')
        return false
      }
      return validateJson(entry, `${path}/${key}`, issues, depth + 1, nestedAncestors)
    })
  )
}

export function validateCapabilities(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is readonly ScriptCapability[] {
  if (!Array.isArray(value) || value.length > PLUGIN_LIMITS.capabilities) {
    addIssue(issues, path, `Expected at most ${PLUGIN_LIMITS.capabilities} capabilities.`)
    return false
  }
  let valid = true
  const seen = new Set<string>()
  for (const [index, candidate] of value.entries()) {
    if (typeof candidate !== 'string' || !CAPABILITIES.has(candidate as ScriptCapability)) {
      addIssue(issues, `${path}/${index}`, 'Unknown capability.')
      valid = false
    } else if (seen.has(candidate)) {
      addIssue(issues, `${path}/${index}`, 'Duplicate capability.')
      valid = false
    }
    if (typeof candidate === 'string') seen.add(candidate)
  }
  return valid
}

export function sortedCapabilities(
  value: readonly ScriptCapability[],
): readonly ScriptCapability[] {
  return Object.freeze([...value].sort())
}

export function validationResult<T>(
  issues: readonly ValidationIssue[],
  value: T,
): ValidationResult<T> {
  return issues.length === 0 ? { ok: true, value, issues } : { ok: false, issues }
}
