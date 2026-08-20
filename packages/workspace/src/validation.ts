import type { DatasetDescriptor, DisplayMapping, PlaneSelection } from '@pji-workbench/contracts'
import {
  isOmeZarrRootMetadataName,
  normalizeSpatialReference,
  SpatialReferenceError,
} from '@pji-workbench/contracts'
import type { AnalysisGraph, AnalysisSemanticIdentity } from 'purejsimage/analysis'
import type { PersistedInputBinding, PersistedSourceReference } from 'purejsimage/analysis/project'
import type { RoiSet } from 'purejsimage/analysis/roi'

import {
  type ArtifactReferenceId,
  type CalibrationOverride,
  type DatasetReferenceId,
  type DisplayLayerState,
  type JsonValue,
  type LayerId,
  type PinnedResultReference,
  type ProjectId,
  type ProjectWorkflowSelection,
  type ResultReferenceId,
  type SemanticSourceId,
  type SourceLocator,
  WORKSPACE_LIMITS,
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceAnalysisState,
  type WorkspaceDatasetReference,
  type WorkspaceProjectMetadata,
  type WorkspaceSelection,
  type WorkspaceSnapshot,
  type WorkspaceSourceReference,
} from './model.js'
import { deterministicJson, jsonBytes } from './serialization.js'

export class WorkspaceValidationError extends Error {
  constructor(
    readonly code: 'INVALID_PROJECT' | 'LIMIT_EXCEEDED' | 'FORBIDDEN_DATA',
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceValidationError'
  }
}

interface Candidate extends Record<string, unknown> {
  readonly active?: unknown
  readonly analysis?: unknown
  readonly appVersion?: unknown
  readonly artifactId?: unknown
  readonly axes?: unknown
  readonly axisId?: unknown
  readonly axisIds?: unknown
  readonly bindings?: unknown
  readonly bottom?: unknown
  readonly bound?: unknown
  readonly capabilities?: unknown
  readonly calibrations?: unknown
  readonly companionNames?: unknown
  readonly component?: unknown
  readonly components?: unknown
  readonly createdAt?: unknown
  readonly createdWith?: unknown
  readonly datasetId?: unknown
  readonly datasetReferenceId?: unknown
  readonly datasets?: unknown
  readonly descriptor?: unknown
  readonly displayAxes?: unknown
  readonly fixedIndices?: unknown
  readonly format?: unknown
  readonly geometry?: unknown
  readonly graph?: unknown
  readonly graphOutput?: unknown
  readonly id?: unknown
  readonly identity?: unknown
  readonly index?: unknown
  readonly inspector?: unknown
  readonly inputs?: unknown
  readonly kind?: unknown
  readonly label?: unknown
  readonly lastModified?: unknown
  readonly layers?: unknown
  readonly level?: unknown
  readonly levels?: unknown
  readonly locator?: unknown
  readonly mapping?: unknown
  readonly maximum?: unknown
  readonly minimum?: unknown
  readonly mode?: unknown
  readonly name?: unknown
  readonly nodes?: unknown
  readonly notes?: unknown
  readonly opacity?: unknown
  readonly operation?: unknown
  readonly outputs?: unknown
  readonly palette?: unknown
  readonly parameters?: unknown
  readonly pinnedResults?: unknown
  readonly plane?: unknown
  readonly points?: unknown
  readonly project?: unknown
  readonly pureJsImageVersion?: unknown
  readonly range?: unknown
  readonly reader?: unknown
  readonly resolutionLevel?: unknown
  readonly revision?: unknown
  readonly roiSet?: unknown
  readonly rois?: unknown
  readonly sampleId?: unknown
  readonly sampleType?: unknown
  readonly schemaVersion?: unknown
  readonly selectedLayerId?: unknown
  readonly selectedResultId?: unknown
  readonly selectedRoiId?: unknown
  readonly size?: unknown
  readonly sourceId?: unknown
  readonly source?: unknown
  readonly sourceReferences?: unknown
  readonly sources?: unknown
  readonly spatialReference?: unknown
  readonly summary?: unknown
  readonly title?: unknown
  readonly updatedAt?: unknown
  readonly url?: unknown
  readonly version?: unknown
  readonly visible?: unknown
  readonly unit?: unknown
  readonly unitsPerPixel?: unknown
  readonly knownDistance?: unknown
  readonly measuredPixels?: unknown
  readonly workflow?: unknown
}

function record(value: unknown, path: string): Candidate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path} must be an object`)
  }
  return value as Candidate
}

function stringValue(
  value: unknown,
  path: string,
  maximum: number = WORKSPACE_LIMITS.maxStringLength,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path} must be a non-empty string`)
  }
  if (value.length > maximum) {
    throw new WorkspaceValidationError('LIMIT_EXCEEDED', `${path} exceeds the string limit`)
  }
  return value
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : stringValue(value, path)
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new WorkspaceValidationError(
      'INVALID_PROJECT',
      `${path} must be an integer >= ${minimum}`,
    )
  }
  return value as number
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path} must be finite`)
  }
  return value
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path} must be boolean`)
  }
  return value
}

function boundedArray(value: unknown, path: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path} must be an array`)
  }
  if (value.length > maximum) {
    throw new WorkspaceValidationError('LIMIT_EXCEEDED', `${path} exceeds the item limit`)
  }
  return value
}

function jsonValue(value: unknown, path: string, depth = 0): JsonValue {
  if (depth > 24) {
    throw new WorkspaceValidationError('LIMIT_EXCEEDED', `${path} exceeds the nesting limit`)
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && value.length > WORKSPACE_LIMITS.maxStringLength) {
      throw new WorkspaceValidationError('LIMIT_EXCEEDED', `${path} contains an oversized string`)
    }
    return value
  }
  if (typeof value === 'number') return finite(value, path)
  if (Array.isArray(value)) {
    if (value.length > 4_096) {
      throw new WorkspaceValidationError('LIMIT_EXCEEDED', `${path} contains too many values`)
    }
    return value.map((item, index) => jsonValue(item, `${path}[${index}]`, depth + 1))
  }
  const candidate = record(value, path)
  const entries = Object.entries(candidate)
  if (entries.length > 4_096) {
    throw new WorkspaceValidationError('LIMIT_EXCEEDED', `${path} contains too many fields`)
  }
  return Object.fromEntries(
    entries.map(([key, item]) => [
      stringValue(key, `${path} key`),
      jsonValue(item, `${path}.${key}`, depth + 1),
    ]),
  )
}

const FORBIDDEN_KEYS = new Set([
  'apiKey',
  'openRouterKey',
  'credential',
  'credentials',
  'secret',
  'token',
  'documentId',
  'handleId',
  'datasetHandleId',
  'tileId',
  'preparedPlanId',
  'resultHandleId',
  'gpuHandle',
  'workerId',
])

export function assertNoForbiddenProjectData(value: unknown, path = 'project'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoForbiddenProjectData(item, `${path}[${index}]`)
    })
    return
  }
  if (typeof value !== 'object' || value === null) return
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new WorkspaceValidationError('FORBIDDEN_DATA', `${path}.${key} is not project data`)
    }
    assertNoForbiddenProjectData(item, `${path}.${key}`)
  }
}

function identity(value: unknown, path: string): AnalysisSemanticIdentity {
  const candidate = record(jsonValue(value, path), path)
  stringValue(candidate.kind, `${path}.kind`)
  return candidate as unknown as AnalysisSemanticIdentity
}

export function validateSemanticIdentity(value: unknown): AnalysisSemanticIdentity {
  return identity(value, 'identity')
}

function locator(value: unknown, path: string): SourceLocator {
  const candidate = record(value, path)
  if (candidate.kind === 'sample') {
    return { kind: 'sample', sampleId: stringValue(candidate.sampleId, `${path}.sampleId`) }
  }
  if (candidate.kind === 'bundled') {
    const bundledPath = stringValue(candidate['path'], `${path}.path`)
    const sha256 = stringValue(candidate['sha256'], `${path}.sha256`)
    if (
      !bundledPath.startsWith('examples/') ||
      bundledPath.startsWith('/') ||
      bundledPath.includes('..') ||
      bundledPath.includes('\\')
    )
      throw new WorkspaceValidationError(
        'INVALID_PROJECT',
        `${path}.path must be an application-owned example path`,
      )
    if (!/^[a-f0-9]{64}$/.test(sha256))
      throw new WorkspaceValidationError('INVALID_PROJECT', `${path}.sha256 is invalid`)
    return {
      kind: 'bundled',
      path: bundledPath,
      name: stringValue(candidate.name, `${path}.name`),
      size: integer(candidate.size, `${path}.size`),
      sha256,
      mediaType: stringValue(candidate['mediaType'], `${path}.mediaType`),
    }
  }
  if (candidate.kind === 'remote') {
    const url = stringValue(candidate.url, `${path}.url`)
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new WorkspaceValidationError('INVALID_PROJECT', `${path}.url is invalid`)
    }
    if (
      parsed.protocol !== 'https:' &&
      parsed.hostname !== 'localhost' &&
      parsed.hostname !== '127.0.0.1'
    ) {
      throw new WorkspaceValidationError('INVALID_PROJECT', `${path}.url must use HTTPS`)
    }
    return { kind: 'remote', url: parsed.href }
  }
  if (candidate.kind === 'ome-zarr-remote') {
    const url = stringValue(candidate.url, `${path}.url`)
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new WorkspaceValidationError('INVALID_PROJECT', `${path}.url is invalid`)
    }
    if (
      parsed.protocol !== 'https:' &&
      parsed.hostname !== 'localhost' &&
      parsed.hostname !== '127.0.0.1'
    ) {
      throw new WorkspaceValidationError('INVALID_PROJECT', `${path}.url must use HTTPS`)
    }
    parsed.search = ''
    parsed.hash = ''
    parsed.username = ''
    parsed.password = ''
    const selectedRootMetadataName = stringValue(
      candidate['selectedRootMetadataName'],
      `${path}.selectedRootMetadataName`,
    )
    if (!isOmeZarrRootMetadataName(selectedRootMetadataName)) {
      throw new WorkspaceValidationError(
        'INVALID_PROJECT',
        `${path}.selectedRootMetadataName is unsupported`,
      )
    }
    const strength = stringValue(
      candidate['sourceIdentityStrength'],
      `${path}.sourceIdentityStrength`,
    )
    if (strength !== 'strong' && strength !== 'weak' && strength !== 'session') {
      throw new WorkspaceValidationError(
        'INVALID_PROJECT',
        `${path}.sourceIdentityStrength is unsupported`,
      )
    }
    const validatorValue = candidate['rootObjectValidator']
    const rootObjectValidator =
      validatorValue === undefined
        ? undefined
        : (() => {
            const validator = record(validatorValue, `${path}.rootObjectValidator`)
            const kindValue = stringValue(validator['kind'], `${path}.rootObjectValidator.kind`)
            if (
              kindValue !== 'etag' &&
              kindValue !== 'version-id' &&
              kindValue !== 'last-modified'
            ) {
              throw new WorkspaceValidationError(
                'INVALID_PROJECT',
                `${path}.rootObjectValidator.kind is unsupported`,
              )
            }
            return {
              kind: kindValue,
              value: stringValue(validator['value'], `${path}.rootObjectValidator.value`),
            } as const
          })()
    return {
      kind: 'ome-zarr-remote',
      url: parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/`,
      selectedRootMetadataName,
      sourceIdentityStrength: strength,
      rootObjectSize: integer(candidate['rootObjectSize'], `${path}.rootObjectSize`),
      ...(rootObjectValidator === undefined ? {} : { rootObjectValidator }),
    }
  }
  if (candidate.kind === 'ome-zarr-directory') {
    const selectedRootMetadataName = stringValue(
      candidate['selectedRootMetadataName'],
      `${path}.selectedRootMetadataName`,
    )
    if (!isOmeZarrRootMetadataName(selectedRootMetadataName)) {
      throw new WorkspaceValidationError(
        'INVALID_PROJECT',
        `${path}.selectedRootMetadataName is unsupported`,
      )
    }
    return {
      kind: 'ome-zarr-directory',
      name: stringValue(candidate.name, `${path}.name`),
      selectedRootMetadataName,
      directoryFingerprint: stringValue(
        candidate['directoryFingerprint'],
        `${path}.directoryFingerprint`,
      ),
    }
  }
  if (candidate.kind === 'ome-zarr-zip') {
    return {
      kind: 'ome-zarr-zip',
      name: stringValue(candidate.name, `${path}.name`),
      size: integer(candidate.size, `${path}.size`),
      lastModified: integer(candidate.lastModified, `${path}.lastModified`),
    }
  }
  if (candidate.kind === 'local') {
    return {
      kind: 'local',
      name: stringValue(candidate.name, `${path}.name`),
      size: integer(candidate.size, `${path}.size`),
      lastModified: integer(candidate.lastModified, `${path}.lastModified`),
      companionNames: boundedArray(candidate.companionNames, `${path}.companionNames`, 64).map(
        (item, index) => stringValue(item, `${path}.companionNames[${index}]`),
      ),
    }
  }
  throw new WorkspaceValidationError('INVALID_PROJECT', `${path}.kind is unsupported`)
}

function source(value: unknown, path: string): WorkspaceSourceReference {
  const candidate = record(value, path)
  const reader = record(candidate.reader, `${path}.reader`)
  return {
    id: stringValue(candidate.id, `${path}.id`) as SemanticSourceId,
    label: stringValue(candidate.label, `${path}.label`),
    locator: locator(candidate.locator, `${path}.locator`),
    identity: identity(candidate.identity, `${path}.identity`),
    reader: {
      id: stringValue(reader.id, `${path}.reader.id`),
      version: stringValue(reader.version, `${path}.reader.version`),
      format: stringValue(reader.format, `${path}.reader.format`),
    },
    bound: booleanValue(candidate.bound, `${path}.bound`),
  }
}

function planeSelection(value: unknown, path: string): PlaneSelection {
  const candidate = record(value, path)
  const axes = boundedArray(candidate.displayAxes, `${path}.displayAxes`, 2)
  if (axes.length !== 2) {
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path}.displayAxes needs two axes`)
  }
  return {
    displayAxes: [
      stringValue(axes[0], `${path}.displayAxes[0]`),
      stringValue(axes[1], `${path}.displayAxes[1]`),
    ],
    fixedIndices: boundedArray(candidate.fixedIndices, `${path}.fixedIndices`, 64).map(
      (item, index) => {
        const fixed = record(item, `${path}.fixedIndices[${index}]`)
        return {
          axisId: stringValue(fixed.axisId, `${path}.fixedIndices[${index}].axisId`),
          index: integer(fixed.index, `${path}.fixedIndices[${index}].index`),
        }
      },
    ),
    resolutionLevel: integer(candidate.resolutionLevel, `${path}.resolutionLevel`),
  }
}

function spatialReference(
  value: unknown,
  path: string,
  componentCount: number,
): DatasetDescriptor['spatialReference'] {
  try {
    return normalizeSpatialReference(value, { componentCount, label: path })
  } catch (error) {
    if (error instanceof SpatialReferenceError) {
      throw new WorkspaceValidationError('INVALID_PROJECT', error.message)
    }
    throw error
  }
}

function resolutionLevel(
  value: unknown,
  path: string,
  componentCount: number,
): DatasetDescriptor['levels'][number] {
  const candidate = record(value, path)
  const reference =
    candidate.spatialReference === undefined
      ? undefined
      : spatialReference(candidate.spatialReference, `${path}.spatialReference`, componentCount)
  return {
    ...(candidate as unknown as DatasetDescriptor['levels'][number]),
    level: integer(candidate.level, `${path}.level`),
    ...(reference === undefined ? {} : { spatialReference: reference }),
  }
}

function datasetDescriptor(value: unknown, path: string): DatasetDescriptor {
  const candidate = record(value, path)
  jsonValue(candidate, path)
  const axes = boundedArray(candidate.axes, `${path}.axes`, 64)
  const components = boundedArray(candidate.components, `${path}.components`, 64)
  const levels = boundedArray(candidate.levels, `${path}.levels`, 64).map((level, index) =>
    resolutionLevel(level, `${path}.levels[${index}]`, components.length),
  )
  const capabilities = record(candidate.capabilities, `${path}.capabilities`)
  const reference =
    candidate.spatialReference === undefined
      ? undefined
      : spatialReference(candidate.spatialReference, `${path}.spatialReference`, components.length)
  return {
    ...(candidate as unknown as DatasetDescriptor),
    id: stringValue(candidate.id, `${path}.id`),
    identity: identity(candidate.identity, `${path}.identity`) as unknown as Readonly<
      Record<string, unknown>
    >,
    sampleType: stringValue(candidate.sampleType, `${path}.sampleType`),
    axes: axes as DatasetDescriptor['axes'],
    components: components as DatasetDescriptor['components'],
    levels,
    capabilities: capabilities as unknown as DatasetDescriptor['capabilities'],
    ...(reference === undefined ? {} : { spatialReference: reference }),
  }
}

function dataset(value: unknown, path: string): WorkspaceDatasetReference {
  const candidate = record(value, path)
  return {
    id: stringValue(candidate.id, `${path}.id`) as DatasetReferenceId,
    sourceId: stringValue(candidate.sourceId, `${path}.sourceId`) as SemanticSourceId,
    datasetId: stringValue(candidate.datasetId, `${path}.datasetId`),
    identity: identity(candidate.identity, `${path}.identity`),
    descriptor: datasetDescriptor(candidate.descriptor, `${path}.descriptor`),
  }
}

function displayMapping(value: unknown, path: string): DisplayMapping {
  const candidate = record(value, path)
  if (candidate.mode !== 'linear' || (candidate.range !== 'auto' && candidate.range !== 'manual')) {
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path} has an unsupported mapping`)
  }
  if (candidate.range === 'manual') {
    const minimum = finite(candidate.minimum, `${path}.minimum`)
    const maximum = finite(candidate.maximum, `${path}.maximum`)
    if (maximum <= minimum) {
      throw new WorkspaceValidationError('INVALID_PROJECT', `${path}.maximum must exceed minimum`)
    }
    return { mode: 'linear', range: 'manual', minimum, maximum }
  }
  return {
    mode: 'linear',
    range: 'auto',
    ...(candidate.minimum === undefined
      ? {}
      : { minimum: finite(candidate.minimum, `${path}.minimum`) }),
    ...(candidate.maximum === undefined
      ? {}
      : { maximum: finite(candidate.maximum, `${path}.maximum`) }),
  }
}

function layer(value: unknown, path: string): DisplayLayerState {
  const candidate = record(value, path)
  const opacity = finite(candidate.opacity, `${path}.opacity`)
  if (opacity < 0 || opacity > 1) {
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path}.opacity must be between 0 and 1`)
  }
  return {
    id: stringValue(candidate.id, `${path}.id`) as LayerId,
    datasetReferenceId: stringValue(
      candidate.datasetReferenceId,
      `${path}.datasetReferenceId`,
    ) as DatasetReferenceId,
    label: stringValue(candidate.label, `${path}.label`),
    visible: booleanValue(candidate.visible, `${path}.visible`),
    opacity,
    mapping: displayMapping(candidate.mapping, `${path}.mapping`),
    palette: stringValue(candidate.palette, `${path}.palette`),
  }
}

function analysis(value: unknown, path: string): WorkspaceAnalysisState {
  const candidate = record(value, path)
  const graphCandidate = record(candidate.graph, `${path}.graph`)
  if (graphCandidate.schemaVersion !== 1) {
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path}.graph schema is unsupported`)
  }
  const nodes = boundedArray(
    graphCandidate.nodes,
    `${path}.graph.nodes`,
    WORKSPACE_LIMITS.maxGraphNodes,
  )
  const inputs = boundedArray(
    graphCandidate.inputs,
    `${path}.graph.inputs`,
    WORKSPACE_LIMITS.maxBindings,
  )
  const outputs = boundedArray(
    graphCandidate.outputs,
    `${path}.graph.outputs`,
    WORKSPACE_LIMITS.maxOutputs,
  )
  let edgeCount = 0
  for (const [index, nodeValue] of nodes.entries()) {
    const node = record(nodeValue, `${path}.graph.nodes[${index}]`)
    stringValue(node.id, `${path}.graph.nodes[${index}].id`)
    const operation = record(node.operation, `${path}.graph.nodes[${index}].operation`)
    stringValue(operation.id, `${path}.graph.nodes[${index}].operation.id`)
    integer(operation.version, `${path}.graph.nodes[${index}].operation.version`, 1)
    edgeCount += boundedArray(
      node.inputs,
      `${path}.graph.nodes[${index}].inputs`,
      WORKSPACE_LIMITS.maxGraphEdges,
    ).length
    jsonValue(node.parameters, `${path}.graph.nodes[${index}].parameters`)
  }
  if (edgeCount > WORKSPACE_LIMITS.maxGraphEdges) {
    throw new WorkspaceValidationError('LIMIT_EXCEEDED', `${path}.graph has too many edges`)
  }
  const graph = {
    ...(graphCandidate as unknown as AnalysisGraph),
    schemaVersion: 1,
    inputs,
    nodes,
    outputs,
  } as AnalysisGraph
  jsonValue(graph, `${path}.graph`)

  const roiCandidate = record(candidate.roiSet, `${path}.roiSet`)
  if (roiCandidate.schemaVersion !== 1) {
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path}.roiSet schema is unsupported`)
  }
  const rois = boundedArray(roiCandidate.rois, `${path}.roiSet.rois`, WORKSPACE_LIMITS.maxRois)
  for (const [index, roiValue] of rois.entries()) {
    const roi = record(roiValue, `${path}.roiSet.rois[${index}]`)
    stringValue(roi.id, `${path}.roiSet.rois[${index}].id`)
    const geometry = record(roi.geometry, `${path}.roiSet.rois[${index}].geometry`)
    if (Array.isArray(geometry.points) && geometry.points.length > WORKSPACE_LIMITS.maxRoiPoints) {
      throw new WorkspaceValidationError(
        'LIMIT_EXCEEDED',
        `${path}.roiSet geometry has too many points`,
      )
    }
  }
  const roiSet = { ...(roiCandidate as unknown as RoiSet), schemaVersion: 1, rois } as RoiSet
  jsonValue(roiSet, `${path}.roiSet`)

  const bindings = boundedArray(
    candidate.bindings,
    `${path}.bindings`,
    WORKSPACE_LIMITS.maxBindings,
  )
  const sourceReferences = boundedArray(
    candidate.sourceReferences,
    `${path}.sourceReferences`,
    WORKSPACE_LIMITS.maxSources,
  )
  bindings.forEach((item, index) => {
    jsonValue(item, `${path}.bindings[${index}]`)
  })
  sourceReferences.forEach((item, index) => {
    jsonValue(item, `${path}.sourceReferences[${index}]`)
  })
  return {
    graph,
    roiSet,
    bindings: bindings as readonly PersistedInputBinding[],
    sourceReferences: sourceReferences as readonly PersistedSourceReference[],
  }
}

function projectMetadata(value: unknown, path: string): WorkspaceProjectMetadata {
  const candidate = record(value, path)
  const createdWith = record(candidate.createdWith, `${path}.createdWith`)
  return {
    id: stringValue(candidate.id, `${path}.id`) as ProjectId,
    title: stringValue(candidate.title, `${path}.title`),
    createdAt: stringValue(candidate.createdAt, `${path}.createdAt`),
    updatedAt: stringValue(candidate.updatedAt, `${path}.updatedAt`),
    createdWith: {
      appVersion: stringValue(createdWith.appVersion, `${path}.createdWith.appVersion`),
      pureJsImageVersion: stringValue(
        createdWith.pureJsImageVersion,
        `${path}.createdWith.pureJsImageVersion`,
      ),
    },
  }
}

function workflow(value: unknown, path: string): ProjectWorkflowSelection {
  const candidate = record(value, path)
  const inspectors: readonly ProjectWorkflowSelection['inspector'][] = [
    'info',
    'display',
    'roi',
    'analysis',
    'history',
    'agent',
  ]
  const bottoms: readonly ProjectWorkflowSelection['bottom'][] = [
    'pipeline',
    'history',
    'histogram',
    'profile',
    'results',
    'log',
  ]
  if (!inspectors.includes(candidate.inspector as ProjectWorkflowSelection['inspector'])) {
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path}.inspector is invalid`)
  }
  if (!bottoms.includes(candidate.bottom as ProjectWorkflowSelection['bottom'])) {
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path}.bottom is invalid`)
  }
  return {
    inspector: candidate.inspector as ProjectWorkflowSelection['inspector'],
    bottom: candidate.bottom as ProjectWorkflowSelection['bottom'],
    ...(optionalString(candidate.selectedRoiId, `${path}.selectedRoiId`) === undefined
      ? {}
      : { selectedRoiId: candidate.selectedRoiId as string }),
    ...(optionalString(candidate.selectedLayerId, `${path}.selectedLayerId`) === undefined
      ? {}
      : { selectedLayerId: candidate.selectedLayerId as LayerId }),
    ...(optionalString(candidate.selectedResultId, `${path}.selectedResultId`) === undefined
      ? {}
      : { selectedResultId: candidate.selectedResultId as ResultReferenceId }),
  }
}

function pinnedResult(value: unknown, path: string): PinnedResultReference {
  const candidate = record(value, path)
  const summary = record(
    jsonValue(candidate.summary, `${path}.summary`),
    `${path}.summary`,
  ) as Readonly<Record<string, JsonValue>>
  if (jsonBytes(summary) > WORKSPACE_LIMITS.maxPinnedSummaryBytes) {
    throw new WorkspaceValidationError('LIMIT_EXCEEDED', `${path}.summary exceeds the byte limit`)
  }
  const artifactId = optionalString(candidate.artifactId, `${path}.artifactId`)
  return {
    id: stringValue(candidate.id, `${path}.id`) as ResultReferenceId,
    graphOutput: stringValue(candidate.graphOutput, `${path}.graphOutput`),
    label: stringValue(candidate.label, `${path}.label`),
    kind: stringValue(candidate.kind, `${path}.kind`),
    ...(artifactId === undefined ? {} : { artifactId: artifactId as ArtifactReferenceId }),
    summary,
    createdAt: stringValue(candidate.createdAt, `${path}.createdAt`),
  }
}

function calibrationOverride(value: unknown, path: string): CalibrationOverride {
  const candidate = record(value, path)
  const axisIds = boundedArray(candidate.axisIds, `${path}.axisIds`, 2)
  const units = boundedArray(candidate.unitsPerPixel, `${path}.unitsPerPixel`, 2)
  if (axisIds.length !== 2 || units.length !== 2)
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path} requires two calibrated axes`)
  const source = stringValue(candidate.source, `${path}.source`)
  if (source !== 'known-line' && source !== 'manual')
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path}.source is unsupported`)
  const knownDistance =
    candidate.knownDistance === undefined
      ? undefined
      : finite(candidate.knownDistance, `${path}.knownDistance`)
  const measuredPixels =
    candidate.measuredPixels === undefined
      ? undefined
      : finite(candidate.measuredPixels, `${path}.measuredPixels`)
  const x = finite(units[0], `${path}.unitsPerPixel[0]`)
  const y = finite(units[1], `${path}.unitsPerPixel[1]`)
  if (
    x <= 0 ||
    y <= 0 ||
    axisIds[0] === axisIds[1] ||
    (knownDistance !== undefined && knownDistance <= 0) ||
    (measuredPixels !== undefined && measuredPixels <= 0) ||
    (source === 'known-line' && (knownDistance === undefined || measuredPixels === undefined))
  )
    throw new WorkspaceValidationError(
      'INVALID_PROJECT',
      `${path} calibration values must be positive`,
    )
  return {
    datasetReferenceId: stringValue(
      candidate.datasetReferenceId,
      `${path}.datasetReferenceId`,
    ) as DatasetReferenceId,
    axisIds: [
      stringValue(axisIds[0], `${path}.axisIds[0]`),
      stringValue(axisIds[1], `${path}.axisIds[1]`),
    ],
    unitsPerPixel: [x, y],
    unit: stringValue(candidate.unit, `${path}.unit`),
    source,
    ...(knownDistance === undefined ? {} : { knownDistance }),
    ...(measuredPixels === undefined ? {} : { measuredPixels }),
  }
}

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new WorkspaceValidationError('INVALID_PROJECT', `${path} contains duplicate IDs`)
  }
}

export function validateWorkspaceProjectV1(value: unknown): WorkspaceSnapshot {
  assertNoForbiddenProjectData(value)
  const candidate = record(value, 'project')
  if (candidate.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new WorkspaceValidationError('INVALID_PROJECT', 'unsupported project schema version')
  }
  const revision = integer(candidate.revision, 'project.revision')
  const sources = boundedArray(
    candidate.sources,
    'project.sources',
    WORKSPACE_LIMITS.maxSources,
  ).map((item, index) => source(item, `project.sources[${index}]`))
  const datasets = boundedArray(
    candidate.datasets,
    'project.datasets',
    WORKSPACE_LIMITS.maxDatasets,
  ).map((item, index) => dataset(item, `project.datasets[${index}]`))
  const layers = boundedArray(candidate.layers, 'project.layers', WORKSPACE_LIMITS.maxLayers).map(
    (item, index) => layer(item, `project.layers[${index}]`),
  )
  const pinnedResults = boundedArray(
    candidate.pinnedResults,
    'project.pinnedResults',
    WORKSPACE_LIMITS.maxPinnedResults,
  ).map((item, index) => pinnedResult(item, `project.pinnedResults[${index}]`))
  const calibrations = boundedArray(
    candidate.calibrations ?? [],
    'project.calibrations',
    WORKSPACE_LIMITS.maxDatasets,
  ).map((item, index) => calibrationOverride(item, `project.calibrations[${index}]`))
  unique(
    sources.map(({ id }) => id),
    'project.sources',
  )
  unique(
    datasets.map(({ id }) => id),
    'project.datasets',
  )
  unique(
    layers.map(({ id }) => id),
    'project.layers',
  )
  unique(
    pinnedResults.map(({ id }) => id),
    'project.pinnedResults',
  )
  unique(
    calibrations.map(({ datasetReferenceId }) => datasetReferenceId),
    'project.calibrations',
  )
  const sourceIds = new Set(sources.map(({ id }) => id))
  const datasetIds = new Set(datasets.map(({ id }) => id))
  for (const item of datasets) {
    if (!sourceIds.has(item.sourceId)) {
      throw new WorkspaceValidationError('INVALID_PROJECT', `dataset ${item.id} has no source`)
    }
  }
  for (const item of layers) {
    if (!datasetIds.has(item.datasetReferenceId)) {
      throw new WorkspaceValidationError('INVALID_PROJECT', `layer ${item.id} has no dataset`)
    }
  }
  for (const item of calibrations) {
    const dataset = datasets.find(({ id }) => id === item.datasetReferenceId)
    if (dataset === undefined)
      throw new WorkspaceValidationError(
        'INVALID_PROJECT',
        `calibration ${item.datasetReferenceId} has no dataset`,
      )
    if (item.axisIds.some((axisId) => !dataset.descriptor.axes.some(({ id }) => id === axisId)))
      throw new WorkspaceValidationError(
        'INVALID_PROJECT',
        `calibration ${item.datasetReferenceId} references an unknown axis`,
      )
  }
  let active: WorkspaceSelection | undefined
  if (candidate.active !== undefined) {
    const selection = record(candidate.active, 'project.active')
    active = {
      sourceId: stringValue(selection.sourceId, 'project.active.sourceId') as SemanticSourceId,
      datasetReferenceId: stringValue(
        selection.datasetReferenceId,
        'project.active.datasetReferenceId',
      ) as DatasetReferenceId,
      plane: planeSelection(selection.plane, 'project.active.plane'),
      component: integer(selection.component, 'project.active.component'),
    }
    if (!sourceIds.has(active.sourceId) || !datasetIds.has(active.datasetReferenceId)) {
      throw new WorkspaceValidationError('INVALID_PROJECT', 'active selection is unresolved')
    }
  }
  const notes =
    candidate.notes === ''
      ? ''
      : stringValue(candidate.notes, 'project.notes', WORKSPACE_LIMITS.maxNotesLength)
  const snapshot: WorkspaceSnapshot = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    revision,
    project: projectMetadata(candidate.project, 'project.project'),
    sources,
    datasets,
    ...(active === undefined ? {} : { active }),
    layers,
    calibrations,
    analysis: analysis(candidate.analysis, 'project.analysis'),
    pinnedResults,
    notes,
    workflow: workflow(candidate.workflow, 'project.workflow'),
  }
  if (jsonBytes(snapshot) > WORKSPACE_LIMITS.maxProjectBytes) {
    throw new WorkspaceValidationError('LIMIT_EXCEEDED', 'project exceeds the byte limit')
  }
  return snapshot
}

interface LegacyWorkspaceV0 {
  readonly schemaVersion: 0
  readonly revision?: unknown
  readonly title?: unknown
  readonly notes?: unknown
}

export function migrateWorkspaceProject(value: unknown): unknown {
  const candidate = record(value, 'project')
  if (candidate.schemaVersion === WORKSPACE_SCHEMA_VERSION) return value
  if (candidate.schemaVersion !== 0) {
    throw new WorkspaceValidationError('INVALID_PROJECT', 'no migration path for project schema')
  }
  const legacy = candidate as unknown as LegacyWorkspaceV0
  const timestamp = '1970-01-01T00:00:00.000Z'
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    revision: integer(legacy.revision ?? 0, 'project.revision'),
    project: {
      id: 'migrated-project',
      title: stringValue(legacy.title ?? 'Untitled project', 'project.title'),
      createdAt: timestamp,
      updatedAt: timestamp,
      createdWith: { appVersion: '0.0.0', pureJsImageVersion: '0.10.0' },
    },
    sources: [],
    datasets: [],
    layers: [],
    analysis: {
      graph: { schemaVersion: 1, inputs: [], nodes: [], outputs: [] },
      roiSet: { schemaVersion: 1, rois: [] },
      bindings: [],
      sourceReferences: [],
    },
    pinnedResults: [],
    notes:
      legacy.notes === undefined
        ? ''
        : stringValue(legacy.notes, 'project.notes', WORKSPACE_LIMITS.maxNotesLength),
    workflow: { inspector: 'info', bottom: 'histogram' },
  }
}

export function importWorkspaceProject(text: string): WorkspaceSnapshot {
  if (new TextEncoder().encode(text).byteLength > WORKSPACE_LIMITS.maxProjectBytes) {
    throw new WorkspaceValidationError('LIMIT_EXCEEDED', 'project import exceeds the byte limit')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new WorkspaceValidationError('INVALID_PROJECT', 'project import is not valid JSON')
  }
  return validateWorkspaceProjectV1(migrateWorkspaceProject(parsed))
}

export function semanticIdentityEqual(
  left: AnalysisSemanticIdentity,
  right: AnalysisSemanticIdentity,
): boolean {
  return deterministicJson(left) === deterministicJson(right)
}
