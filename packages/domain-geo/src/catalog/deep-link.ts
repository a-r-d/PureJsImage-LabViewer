import type { AtlasDeepLink, CatalogAssetIdentity } from './types.js'
import { ATLAS_DEEP_LINK_SCHEMA_VERSION } from './types.js'

const MAX_LINK_CHARACTERS = 4_096
const MAX_WORKFLOW_SOURCES = 4
const MAX_PARAMETERS = 16
const INSPECTORS = new Set(['project', 'catalog', 'layers', 'workflows', 'vectors', 'cog'])

type WithoutVersion<T> = T extends unknown ? Omit<T, 'schemaVersion'> : never

type DeepLinkInput =
  | (CatalogAssetIdentity & {
      readonly inspect?: boolean
      readonly presetId?: string
      readonly inspector?: AtlasDeepLink['inspector']
    })
  | WithoutVersion<AtlasDeepLink>

export function serializeAtlasDeepLink(input: DeepLinkInput): string {
  const link = 'kind' in input ? input : { ...input, kind: 'asset' as const }
  const params = new URLSearchParams()
  params.set('v', String(ATLAS_DEEP_LINK_SCHEMA_VERSION))
  params.set('kind', link.kind)
  if (link.kind === 'asset') {
    writeIdentity(params, 0, link)
    if (link.inspect === true) params.set('inspect', '1')
  } else {
    if (
      link.sources.length === 0 ||
      link.sources.length > MAX_WORKFLOW_SOURCES ||
      (link.kind === 'comparison' && link.sources.length !== 2)
    )
      throw new Error('Atlas deep link source count is invalid')
    if (link.kind === 'workflow') {
      boundedToken(link.workflowId, 'workflow')
      params.set('workflow', link.workflowId)
      const entries = Object.entries(link.parameters).sort(([left], [right]) =>
        left.localeCompare(right),
      )
      if (entries.length > MAX_PARAMETERS)
        throw new Error('Atlas deep link has too many parameters')
      for (const [key, value] of entries) {
        boundedToken(key, 'parameter name')
        if (isForbiddenParameterName(key)) throw new Error('Atlas deep link parameter is forbidden')
        if (
          typeof value !== 'string' &&
          typeof value !== 'boolean' &&
          (typeof value !== 'number' || !Number.isFinite(value))
        )
          throw new Error('Atlas deep link parameter is invalid')
        params.set(`p.${key}`, `${typeof value}:${String(value)}`)
      }
    }
    for (const [index, source] of link.sources.entries()) writeIdentity(params, index, source)
  }
  if (link.presetId !== undefined) {
    boundedToken(link.presetId, 'preset')
    params.set('preset', link.presetId)
  }
  if (link.inspector !== undefined) params.set('inspector', link.inspector)
  const result = `#${params.toString()}`
  if (result.length > MAX_LINK_CHARACTERS) throw new Error('Atlas deep link is too large')
  return result
}

export function parseAtlasDeepLink(hash: string): AtlasDeepLink | undefined {
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash
  if (trimmed.length === 0 || trimmed.length > MAX_LINK_CHARACTERS) return undefined
  const params = new URLSearchParams(trimmed)
  const version = params.get('v')
  if (version === null || version === '1') return parseLegacyAsset(params)
  if (version !== String(ATLAS_DEEP_LINK_SCHEMA_VERSION)) return undefined
  for (const key of params.keys()) {
    if (
      key !== 'v' &&
      key !== 'kind' &&
      key !== 'preset' &&
      key !== 'inspector' &&
      key !== 'inspect' &&
      key !== 'workflow' &&
      !/^p\.[A-Za-z0-9._-]{1,256}$/u.test(key) &&
      !/^[cnia][0-3]$/u.test(key)
    )
      return undefined
  }
  const kind = params.get('kind')
  const presetId = optionalToken(params.get('preset'))
  const inspectorValue = params.get('inspector')
  const inspector = INSPECTORS.has(inspectorValue ?? '')
    ? (inspectorValue as NonNullable<AtlasDeepLink['inspector']>)
    : undefined
  if (kind === 'asset') {
    const identity = readIdentity(params, 0)
    if (identity === undefined) return undefined
    return {
      schemaVersion: ATLAS_DEEP_LINK_SCHEMA_VERSION,
      kind,
      ...identity,
      ...(params.get('inspect') === '1' ? { inspect: true } : {}),
      ...(presetId === undefined ? {} : { presetId }),
      ...(inspector === undefined ? {} : { inspector }),
    }
  }
  if (kind !== 'workflow' && kind !== 'comparison') return undefined
  const sources: CatalogAssetIdentity[] = []
  for (let index = 0; index < MAX_WORKFLOW_SOURCES; index += 1) {
    const source = readIdentity(params, index)
    if (source === undefined) break
    sources.push(source)
  }
  if (kind === 'comparison') {
    if (sources.length !== 2) return undefined
    return {
      schemaVersion: ATLAS_DEEP_LINK_SCHEMA_VERSION,
      kind,
      sources: [sources[0] as CatalogAssetIdentity, sources[1] as CatalogAssetIdentity],
      ...(presetId === undefined ? {} : { presetId }),
      ...(inspector === undefined ? {} : { inspector }),
    }
  }
  const workflowId = optionalToken(params.get('workflow'))
  if (workflowId === undefined || sources.length === 0) return undefined
  const parameters: Record<string, string | number | boolean> = {}
  for (const [key, encoded] of params) {
    if (!key.startsWith('p.')) continue
    const name = optionalToken(key.slice(2))
    if (
      name === undefined ||
      isForbiddenParameterName(name) ||
      Object.keys(parameters).length >= MAX_PARAMETERS
    )
      return undefined
    const value = parseParameter(encoded)
    if (value === undefined) return undefined
    parameters[name] = value
  }
  return {
    schemaVersion: ATLAS_DEEP_LINK_SCHEMA_VERSION,
    kind,
    workflowId,
    sources,
    parameters,
    ...(presetId === undefined ? {} : { presetId }),
    ...(inspector === undefined ? {} : { inspector }),
  }
}

function writeIdentity(params: URLSearchParams, index: number, value: CatalogAssetIdentity): void {
  for (const [key, item] of [
    ['c', value.catalogId],
    ['n', value.collectionId],
    ['i', value.itemId],
    ['a', value.assetKey],
  ] as const) {
    boundedToken(item, 'catalog identity')
    params.set(`${key}${index}`, item)
  }
}

function readIdentity(params: URLSearchParams, index: number): CatalogAssetIdentity | undefined {
  const values = ['c', 'n', 'i', 'a'].map((key) => optionalToken(params.get(`${key}${index}`)))
  if (values.some((value) => value === undefined)) return undefined
  return {
    catalogId: values[0] as string,
    collectionId: values[1] as string,
    itemId: values[2] as string,
    assetKey: values[3] as string,
  }
}

function parseLegacyAsset(params: URLSearchParams): AtlasDeepLink | undefined {
  const catalogId = optionalToken(params.get('catalog'))
  const collectionId = optionalToken(params.get('collection'))
  const itemId = optionalToken(params.get('item'))
  const assetKey = optionalToken(params.get('asset'))
  if (
    catalogId === undefined ||
    collectionId === undefined ||
    itemId === undefined ||
    assetKey === undefined
  )
    return undefined
  return {
    schemaVersion: ATLAS_DEEP_LINK_SCHEMA_VERSION,
    kind: 'asset',
    catalogId,
    collectionId,
    itemId,
    assetKey,
    ...(params.get('inspect') === '1' ? { inspect: true } : {}),
  }
}

function parseParameter(value: string): string | number | boolean | undefined {
  const separator = value.indexOf(':')
  if (separator < 0) return undefined
  const type = value.slice(0, separator)
  const raw = value.slice(separator + 1)
  if (type === 'string') return raw
  if (type === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : undefined
  if (type === 'number') {
    const number = Number(raw)
    return Number.isFinite(number) ? number : undefined
  }
  return undefined
}

function optionalToken(value: string | null): string | undefined {
  return value !== null && value.length > 0 && value.length <= 256 ? value : undefined
}

function boundedToken(value: string, label: string): void {
  if (optionalToken(value) === undefined) throw new Error(`Atlas ${label} is invalid`)
}

function isForbiddenParameterName(value: string): boolean {
  return (
    value === '__proto__' ||
    value === 'prototype' ||
    value === 'constructor' ||
    /^(?:api[_-]?key|openrouter|access[_-]?token|secret|password)$/iu.test(value)
  )
}
