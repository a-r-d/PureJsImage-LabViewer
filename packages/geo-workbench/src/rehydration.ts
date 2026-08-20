import type {
  CatalogSourceCandidate,
  GeoProject,
  GeoRasterSource,
  GeoSourceId,
  GeoSourceValidators,
} from '@pji-workbench/domain-geo'

export type GeoSourceRehydrationStatus =
  | 'pending'
  | 'unchanged'
  | 'changed'
  | 'rebind-required'
  | 'missing'
  | 'unavailable'
  | 'unauthorized'
  | 'incompatible'

export interface GeoSourceRehydrationEntry {
  readonly sourceId: GeoSourceId
  readonly label: string
  readonly locatorKind: GeoRasterSource['locator']['kind']
  readonly status: GeoSourceRehydrationStatus
  readonly differences: readonly string[]
  readonly refreshedCandidate?: CatalogSourceCandidate
  readonly refreshedUrl?: string
  readonly refreshedValidators?: GeoSourceValidators
  readonly expectedFileName?: string
}

export interface GeoProjectRehydrationPlan {
  readonly projectId: string
  readonly entries: readonly GeoSourceRehydrationEntry[]
  readonly invalidatedDerivedLayerIds: readonly string[]
  readonly readyToCommit: boolean
  readonly requiresConfirmation: boolean
}

export interface GeoRemoteSourceProbe {
  readonly status: Exclude<GeoSourceRehydrationStatus, 'pending' | 'rebind-required' | 'missing'>
  readonly validators: GeoSourceValidators
  readonly url: string
  readonly compatible: boolean
}

export function initialGeoProjectRehydrationPlan(project: GeoProject): GeoProjectRehydrationPlan {
  return finalizeGeoProjectRehydrationPlan(
    project,
    project.sources.map((source) => ({
      sourceId: source.id,
      label: source.label,
      locatorKind: source.locator.kind,
      status: source.locator.kind === 'local-file' ? 'rebind-required' : 'pending',
      differences: [],
      ...(source.locator.kind === 'local-file'
        ? { expectedFileName: source.locator.fingerprint.name }
        : {}),
    })),
  )
}

export function catalogRehydrationEntry(
  source: GeoRasterSource,
  candidate: CatalogSourceCandidate | undefined,
): GeoSourceRehydrationEntry {
  if (candidate === undefined)
    return baseEntry(source, 'missing', ['Stable catalog item or asset was not found.'])
  const differences = compareCandidate(source, candidate)
  return {
    ...baseEntry(source, differences.length === 0 ? 'unchanged' : 'changed', differences),
    refreshedCandidate: candidate,
    refreshedUrl: candidate.href,
  }
}

export function remoteRehydrationEntry(
  source: GeoRasterSource,
  probe: GeoRemoteSourceProbe,
): GeoSourceRehydrationEntry {
  const differences = compareValidators(source.validators, probe.validators)
  const status =
    probe.status === 'unchanged' && differences.length > 0
      ? 'changed'
      : !probe.compatible && probe.status !== 'unauthorized' && probe.status !== 'unavailable'
        ? 'incompatible'
        : probe.status
  return {
    ...baseEntry(source, status, differences),
    refreshedUrl: probe.url,
    refreshedValidators: probe.validators,
  }
}

export function localRehydrationEntry(
  source: GeoRasterSource,
  primary: File,
  companions: readonly File[],
  digest?: string,
): GeoSourceRehydrationEntry {
  if (source.locator.kind !== 'local-file')
    return baseEntry(source, 'incompatible', ['Source is not a local-file locator.'])
  const expected = source.locator.fingerprint
  const differences: string[] = []
  if (primary.name !== expected.name) differences.push('name')
  if (primary.size !== expected.size) differences.push('size')
  if (primary.lastModified !== expected.lastModified) differences.push('lastModified')
  if (expected.digest !== undefined && digest !== expected.digest.value) differences.push('digest')
  const companionNames = new Set(companions.map(({ name }) => name))
  for (const name of expected.companionNames ?? []) {
    if (!companionNames.has(name)) differences.push(`companion:${name}`)
  }
  return baseEntry(source, differences.length === 0 ? 'unchanged' : 'changed', differences)
}

export function finalizeGeoProjectRehydrationPlan(
  project: GeoProject,
  entries: readonly GeoSourceRehydrationEntry[],
): GeoProjectRehydrationPlan {
  const untrustedSourceIds = new Set(
    entries.filter(({ status }) => status !== 'unchanged').map(({ sourceId }) => sourceId),
  )
  const invalid = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const layer of project.layers) {
      if (layer.kind !== 'derived' || invalid.has(layer.id)) continue
      const sourceChanged = layer.provenance.sourceIds.some((id) => untrustedSourceIds.has(id))
      const inputChanged = layer.inputLayerIds.some((id) => invalid.has(id))
      if (sourceChanged || inputChanged) {
        invalid.add(layer.id)
        changed = true
      }
    }
  }
  return {
    projectId: project.id,
    entries,
    invalidatedDerivedLayerIds: [...invalid],
    readyToCommit: entries.every(({ status }) => status === 'unchanged' || status === 'changed'),
    requiresConfirmation: entries.some(({ status }) => status === 'changed'),
  }
}

function compareCandidate(
  source: GeoRasterSource,
  candidate: CatalogSourceCandidate,
): readonly string[] {
  const differences = compareValidators(source.validators, {
    ...(candidate.fileSize === undefined ? {} : { size: candidate.fileSize }),
    ...(candidate.checksum === undefined ? {} : { checksum: candidate.checksum }),
    ...(candidate.validator === undefined ? {} : { etag: candidate.validator }),
  })
  const metadata = source.lastKnownMetadata
  const savedProjection =
    source.locator.kind === 'stac-asset' || source.locator.kind === 'tnm-product'
      ? source.locator.projection
      : metadata?.projection
  const savedBands =
    source.locator.kind === 'stac-asset' || source.locator.kind === 'tnm-product'
      ? source.locator.bands
      : metadata?.bands
  return [
    ...differences,
    ...(savedProjection !== undefined && candidate.projection !== savedProjection
      ? ['projection']
      : []),
    ...(savedBands !== undefined && JSON.stringify(savedBands) !== JSON.stringify(candidate.bands)
      ? ['bands']
      : []),
  ]
}

function compareValidators(
  saved: GeoSourceValidators | undefined,
  refreshed: GeoSourceValidators,
): readonly string[] {
  if (saved === undefined) return []
  const differences: string[] = []
  for (const key of ['etag', 'versionId', 'lastModified', 'size', 'checksum'] as const) {
    if (saved[key] !== undefined && refreshed[key] !== undefined && saved[key] !== refreshed[key])
      differences.push(key)
  }
  return differences
}

function baseEntry(
  source: GeoRasterSource,
  status: GeoSourceRehydrationStatus,
  differences: readonly string[],
): GeoSourceRehydrationEntry {
  return {
    sourceId: source.id,
    label: source.label,
    locatorKind: source.locator.kind,
    status,
    differences,
    ...(source.locator.kind === 'local-file'
      ? { expectedFileName: source.locator.fingerprint.name }
      : {}),
  }
}
