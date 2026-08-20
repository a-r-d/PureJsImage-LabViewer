import {
  createGeoProject,
  GEO_PROJECT_LIMITS,
  GEO_PROJECT_SCHEMA_VERSION,
  type GeoCatalogReference,
  type GeoProject,
  type GeoRasterLocator,
} from './model.js'

const MiB = 1_024 * 1_024

export const GEO_PROJECT_DOCUMENT_LIMITS = Object.freeze({
  maxDocumentBytes: 2 * MiB,
  maxMetadataDepth: 32,
  maxProjects: 64,
  maxMigrationMilliseconds: 250,
})

export interface GeoProjectDocumentV2 {
  readonly format: 'atlas-project'
  readonly schemaVersion: typeof GEO_PROJECT_SCHEMA_VERSION
  readonly appVersion: string
  readonly pureJsImageVersion: string
  readonly checksum: Readonly<{ algorithm: 'fnv1a32'; value: string; security: false }>
  readonly project: GeoProject
}

export interface GeoProjectMigrationResult {
  readonly project: GeoProject
  readonly fromSchemaVersion: 1 | 2
  readonly migrations: readonly string[]
}

export class GeoProjectDocumentError extends Error {
  constructor(
    readonly code:
      | 'INVALID_JSON'
      | 'INVALID_DOCUMENT'
      | 'LIMIT_EXCEEDED'
      | 'UNSUPPORTED_SCHEMA'
      | 'CHECKSUM_MISMATCH'
      | 'FORBIDDEN_KEY',
    message: string,
  ) {
    super(message)
    this.name = 'GeoProjectDocumentError'
  }
}

const FORBIDDEN_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'apiKey',
  'api_key',
  'openRouterKey',
  'openrouterKey',
  'OPENROUTER_API_KEY',
])

export function exportGeoProjectDocument(
  project: GeoProject,
  versions: Readonly<{ appVersion: string; pureJsImageVersion: string }>,
): Readonly<{ document: GeoProjectDocumentV2; text: string; bytes: number }> {
  const durable = durableProject(project)
  validateJson(durable, '$.project', 0)
  const checksum = checksumForProject(durable)
  const document: GeoProjectDocumentV2 = {
    format: 'atlas-project',
    schemaVersion: GEO_PROJECT_SCHEMA_VERSION,
    appVersion: boundedVersion(versions.appVersion, 'app version'),
    pureJsImageVersion: boundedVersion(versions.pureJsImageVersion, 'PureJsImage version'),
    checksum: { algorithm: 'fnv1a32', value: checksum, security: false },
    project: durable,
  }
  const text = canonicalJson(document)
  const bytes = new TextEncoder().encode(text).byteLength
  if (bytes > GEO_PROJECT_DOCUMENT_LIMITS.maxDocumentBytes)
    throw new GeoProjectDocumentError('LIMIT_EXCEEDED', 'Atlas project exceeds 2 MiB')
  return { document, text, bytes }
}

export function importGeoProjectDocument(
  input: string | Uint8Array | unknown,
): GeoProjectMigrationResult &
  Readonly<{ appVersion?: string; pureJsImageVersion?: string; checksumVerified: boolean }> {
  const started = performanceNow()
  const value = parseDocumentInput(input)
  validateJson(value, '$', 0)
  const root = record(value, 'Atlas project document')
  const wrapped = root['format'] === 'atlas-project'
  const projectValue = wrapped ? root['project'] : root
  const projectRecord = record(projectValue, 'Atlas project')
  const version = projectRecord['schemaVersion']
  if (version !== 1 && version !== GEO_PROJECT_SCHEMA_VERSION)
    throw new GeoProjectDocumentError(
      'UNSUPPORTED_SCHEMA',
      `Unsupported Atlas project schema ${String(version)}`,
    )
  let checksumVerified = false
  if (wrapped) {
    if (root['schemaVersion'] !== GEO_PROJECT_SCHEMA_VERSION)
      throw new GeoProjectDocumentError('UNSUPPORTED_SCHEMA', 'Unsupported document schema')
    const checksum = record(root['checksum'], 'Atlas project checksum')
    if (checksum['algorithm'] !== 'fnv1a32' || typeof checksum['value'] !== 'string')
      throw new GeoProjectDocumentError('INVALID_DOCUMENT', 'Atlas checksum is invalid')
    if (checksum['value'] !== checksumForUnknownProject(projectRecord))
      throw new GeoProjectDocumentError(
        'CHECKSUM_MISMATCH',
        'Atlas project checksum does not match',
      )
    checksumVerified = true
  }
  const migrated = migrateProject(projectRecord, version)
  if (performanceNow() - started > GEO_PROJECT_DOCUMENT_LIMITS.maxMigrationMilliseconds)
    throw new GeoProjectDocumentError(
      'LIMIT_EXCEEDED',
      'Atlas project migration exceeded its time limit',
    )
  return {
    ...migrated,
    checksumVerified,
    ...(wrapped && typeof root['appVersion'] === 'string'
      ? { appVersion: root['appVersion'] }
      : {}),
    ...(wrapped && typeof root['pureJsImageVersion'] === 'string'
      ? { pureJsImageVersion: root['pureJsImageVersion'] }
      : {}),
  }
}

export function canonicalGeoProject(project: GeoProject): string {
  return canonicalJson(durableProject(project))
}

function migrateProject(
  input: Readonly<Record<string, unknown>>,
  version: 1 | 2,
): GeoProjectMigrationResult {
  const migrations: string[] = []
  const migrated = version === 1 ? migrateV1(input, migrations) : input
  const project = createGeoProject(migrated as unknown as Parameters<typeof createGeoProject>[0])
  return { project, fromSchemaVersion: version, migrations }
}

function migrateV1(
  input: Readonly<Record<string, unknown>>,
  migrations: string[],
): Readonly<Record<string, unknown>> {
  const rootCatalog = plainRecord(input['catalog']) ? input['catalog'] : undefined
  const sources = Array.isArray(input['sources'])
    ? input['sources'].map((value, index) => migrateV1Source(value, index, rootCatalog, migrations))
    : []
  const activePreset =
    typeof input['activePreset'] === 'string' && Array.isArray(input['presets'])
      ? input['presets'].find(
          (preset) => plainRecord(preset) && preset['id'] === input['activePreset'],
        )
      : undefined
  const presetStyle =
    plainRecord(activePreset) && plainRecord(activePreset['style'])
      ? activePreset['style']
      : undefined
  const layers = Array.isArray(input['layers'])
    ? input['layers'].map((value) => {
        if (!plainRecord(value) || presetStyle === undefined || value['kind'] !== 'raster')
          return value
        migrations.push('v1-global-preset-to-raster-layer-style')
        return { ...value, style: presetStyle }
      })
    : []
  migrations.push('v1-project-metadata-defaults')
  if (input['comparison'] === undefined) migrations.push('v1-comparison-default-single')
  return {
    ...input,
    schemaVersion: GEO_PROJECT_SCHEMA_VERSION,
    createdAt:
      typeof input['createdAt'] === 'string' ? input['createdAt'] : '1970-01-01T00:00:00.000Z',
    updatedAt:
      typeof input['updatedAt'] === 'string' ? input['updatedAt'] : '1970-01-01T00:00:00.000Z',
    viewport: plainRecord(input['viewport']) ? input['viewport'] : { kind: 'auto' },
    sources,
    layers,
    comparison: input['comparison'] ?? { mode: 'single' },
    selection: {
      ...(typeof input['selectedSourceId'] === 'string'
        ? { sourceId: input['selectedSourceId'] }
        : {}),
      ...(typeof input['selectedLayerId'] === 'string'
        ? { layerId: input['selectedLayerId'] }
        : {}),
      ...(typeof input['selectedRoiId'] === 'string' ? { roiId: input['selectedRoiId'] } : {}),
      ...(isInspector(input['inspectorMode']) ? { inspector: input['inspectorMode'] } : {}),
    },
  }
}

function migrateV1Source(
  value: unknown,
  index: number,
  rootCatalog: Readonly<Record<string, unknown>> | undefined,
  migrations: string[],
): unknown {
  if (!plainRecord(value)) return value
  const catalog = plainRecord(value['catalog']) ? value['catalog'] : rootCatalog
  let locator = value['locator']
  if (!plainRecord(locator)) {
    if (catalog !== undefined) {
      migrations.push('v1-single-catalog-to-source-locator')
      locator = catalogLocator(catalog)
    } else if (typeof value['url'] === 'string') {
      migrations.push('v1-source-url-to-semantic-locator')
      locator = { kind: 'remote-url', url: value['url'] }
    } else if (
      typeof value['fileName'] === 'string' &&
      typeof value['fileSize'] === 'number' &&
      typeof value['lastModified'] === 'number'
    ) {
      migrations.push('v1-local-evidence-to-semantic-locator')
      locator = {
        kind: 'local-file',
        fingerprint: {
          name: value['fileName'],
          size: value['fileSize'],
          lastModified: value['lastModified'],
        },
      }
    }
  }
  const durableLocator = plainRecord(locator) ? stripSessionUrls(locator) : locator
  const durableCatalog = catalog === undefined ? undefined : stripSessionUrls(catalog)
  return {
    ...value,
    id: typeof value['id'] === 'string' ? value['id'] : `geo-source-${index + 1}`,
    locator: durableLocator,
    ...(durableCatalog === undefined ? {} : { catalog: durableCatalog }),
    validators: plainRecord(value['validators'])
      ? value['validators']
      : validatorsFromLocator(durableLocator),
    lastKnownMetadata: plainRecord(value['lastKnownMetadata'])
      ? value['lastKnownMetadata']
      : metadataFromSource(value, durableLocator, durableCatalog),
  }
}

function catalogLocator(
  catalog: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const kind = catalog['protocol'] === 'tnm-access' ? 'tnm-product' : 'stac-asset'
  return {
    kind,
    catalog: stripSessionUrls(catalog),
    ...(kind === 'tnm-product' && typeof catalog['itemId'] === 'string'
      ? { productId: catalog['itemId'] }
      : {}),
    roles: [],
    bands: [],
  }
}

function validatorsFromLocator(locator: unknown): Readonly<Record<string, unknown>> {
  if (!plainRecord(locator)) return {}
  return {
    ...(typeof locator['fileSize'] === 'number' ? { size: locator['fileSize'] } : {}),
    ...(typeof locator['checksum'] === 'string' ? { checksum: locator['checksum'] } : {}),
    ...(typeof locator['validator'] === 'string' ? { etag: locator['validator'] } : {}),
  }
}

function metadataFromSource(
  source: Readonly<Record<string, unknown>>,
  locator: unknown,
  catalog: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  const loc = plainRecord(locator) ? locator : {}
  return {
    ...(typeof catalog?.['provider'] === 'string' ? { provider: catalog['provider'] } : {}),
    ...(typeof catalog?.['license'] === 'string' ? { license: catalog['license'] } : {}),
    ...(typeof catalog?.['attribution'] === 'string'
      ? { attribution: catalog['attribution'] }
      : {}),
    ...(typeof loc['datetime'] === 'string' ? { datetime: loc['datetime'] } : {}),
    ...(typeof loc['title'] === 'string' ? { title: loc['title'] } : {}),
    ...(typeof loc['projection'] === 'string' ? { projection: loc['projection'] } : {}),
    bands: Array.isArray(source['bands']) ? source['bands'] : [],
  }
}

function durableProject(project: GeoProject): GeoProject {
  return createGeoProject({
    ...project,
    sources: project.sources.map((source) => ({
      ...source,
      locator: durableLocator(source.locator),
      ...(source.catalog === undefined ? {} : { catalog: durableCatalogReference(source.catalog) }),
    })),
  })
}

function durableLocator(locator: GeoRasterLocator): GeoRasterLocator {
  if (locator.kind === 'stac-asset')
    return { ...locator, catalog: durableCatalogReference(locator.catalog) }
  if (locator.kind === 'tnm-product') {
    const { downloadUrl: _downloadUrl, ...durable } = locator
    return { ...durable, catalog: durableCatalogReference(locator.catalog) }
  }
  return locator
}

function durableCatalogReference(catalog: GeoCatalogReference): GeoCatalogReference {
  const { href: _href, ...durable } = catalog
  return durable
}

function stripSessionUrls(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'href' || key === 'downloadUrl') continue
    result[key] = plainRecord(item) ? stripSessionUrls(item) : item
  }
  return result
}

function checksumForProject(project: GeoProject): string {
  return fnv1a32(canonicalJson(project))
}

function checksumForUnknownProject(project: Readonly<Record<string, unknown>>): string {
  return fnv1a32(canonicalJson(project))
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > GEO_PROJECT_DOCUMENT_LIMITS.maxMetadataDepth)
    throw new GeoProjectDocumentError('LIMIT_EXCEEDED', 'Atlas project exceeds metadata depth')
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new GeoProjectDocumentError('INVALID_DOCUMENT', 'Atlas project numbers must be finite')
    return Object.is(value, -0) ? '0' : JSON.stringify(value)
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`
  if (!plainRecord(value))
    throw new GeoProjectDocumentError('INVALID_DOCUMENT', 'Atlas project must be plain JSON')
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`)
    .join(',')}}`
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function parseDocumentInput(input: string | Uint8Array | unknown): unknown {
  let value = input
  if (typeof input === 'string' || input instanceof Uint8Array) {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
    if (bytes.byteLength > GEO_PROJECT_DOCUMENT_LIMITS.maxDocumentBytes)
      throw new GeoProjectDocumentError('LIMIT_EXCEEDED', 'Atlas project exceeds 2 MiB')
    try {
      value = JSON.parse(
        typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input),
      ) as unknown
    } catch {
      throw new GeoProjectDocumentError('INVALID_JSON', 'Atlas project is not valid UTF-8 JSON')
    }
  } else {
    const bytes = new TextEncoder().encode(canonicalJson(input)).byteLength
    if (bytes > GEO_PROJECT_DOCUMENT_LIMITS.maxDocumentBytes)
      throw new GeoProjectDocumentError('LIMIT_EXCEEDED', 'Atlas project exceeds 2 MiB')
  }
  return value
}

function validateJson(value: unknown, path: string, depth: number): void {
  if (depth > GEO_PROJECT_DOCUMENT_LIMITS.maxMetadataDepth)
    throw new GeoProjectDocumentError('LIMIT_EXCEEDED', `${path} exceeds metadata depth`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new GeoProjectDocumentError('INVALID_DOCUMENT', `${path} must be finite`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      validateJson(item, `${path}[${index}]`, depth + 1)
    })
    return
  }
  if (!plainRecord(value))
    throw new GeoProjectDocumentError('INVALID_DOCUMENT', `${path} must be a plain JSON object`)
  for (const [key, item] of Object.entries(value)) {
    if (isForbiddenKey(key))
      throw new GeoProjectDocumentError('FORBIDDEN_KEY', `${path}.${key} is forbidden`)
    validateJson(item, `${path}.${key}`, depth + 1)
  }
}

function isForbiddenKey(key: string): boolean {
  return (
    FORBIDDEN_KEYS.has(key) ||
    /^(?:api[_-]?key|openrouter(?:[_-]?(?:api)?[_-]?key)?|access[_-]?token|password|secret)$/iu.test(
      key,
    )
  )
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!plainRecord(value))
    throw new GeoProjectDocumentError('INVALID_DOCUMENT', `${label} must be an object`)
  return value
}

function plainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function boundedVersion(value: string, label: string): string {
  if (value.length === 0 || value.length > GEO_PROJECT_LIMITS.maxStringLength)
    throw new GeoProjectDocumentError('INVALID_DOCUMENT', `${label} is invalid`)
  return value
}

function isInspector(value: unknown): value is NonNullable<GeoProject['selection']['inspector']> {
  return (
    value === 'project' ||
    value === 'agent' ||
    value === 'catalog' ||
    value === 'layers' ||
    value === 'workflows' ||
    value === 'vectors' ||
    value === 'cog'
  )
}

function performanceNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}
