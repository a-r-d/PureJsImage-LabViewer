import type {
  AnalysisGraph,
  AnalysisGraphInput,
  AnalysisGraphNode,
  AnalysisGraphOutput,
  AnalysisValueReference,
} from 'purejsimage/analysis'
import type { PersistedInputBinding } from 'purejsimage/analysis/project'
import type { Roi } from 'purejsimage/analysis/roi'
import type { CalibrationOverride, DisplayLayerState } from './model.js'

import {
  type DatasetReferenceId,
  type PinnedResultReference,
  type ProjectWorkflowSelection,
  type SemanticSourceId,
  type SourceLocator,
  WORKSPACE_LIMITS,
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceDatasetReference,
  type WorkspaceSelection,
  type WorkspaceSnapshot,
  type WorkspaceSourceReference,
} from './model.js'
import { jsonBytes } from './serialization.js'
import { assertNoForbiddenProjectData, validateWorkspaceProjectV1 } from './validation.js'

interface WorkspaceCommandBase {
  readonly schemaVersion: typeof WORKSPACE_SCHEMA_VERSION
  readonly id: string
  readonly expectedRevision: number
  readonly issuedAt: string
}

export type WorkspaceMutation =
  | Readonly<{
      kind: 'source.add'
      source: WorkspaceSourceReference
      datasets: readonly WorkspaceDatasetReference[]
      layers?: readonly DisplayLayerState[]
      activate?: WorkspaceSelection
    }>
  | Readonly<{ kind: 'source.remove'; sourceId: SemanticSourceId }>
  | Readonly<{
      kind: 'source.rebind'
      sourceId: SemanticSourceId
      locator: SourceLocator
      identity: WorkspaceSourceReference['identity']
      bound: boolean
      datasets?: readonly WorkspaceDatasetReference[]
    }>
  | Readonly<{ kind: 'dataset.select'; selection: WorkspaceSelection }>
  | Readonly<{ kind: 'dataset.clear-selection' }>
  | Readonly<{ kind: 'roi.add'; roi: Roi }>
  | Readonly<{ kind: 'roi.update'; roiId: string; roi: Roi }>
  | Readonly<{ kind: 'roi.remove'; roiId: string }>
  | Readonly<{ kind: 'roi.select'; roiId?: string }>
  | Readonly<{ kind: 'display.set-layer'; layer: DisplayLayerState }>
  | Readonly<{ kind: 'display.remove-layer'; layerId: string }>
  | Readonly<{ kind: 'calibration.set'; calibration: CalibrationOverride }>
  | Readonly<{ kind: 'calibration.remove'; datasetReferenceId: DatasetReferenceId }>
  | Readonly<{ kind: 'analysis.add-node'; node: AnalysisGraphNode }>
  | Readonly<{ kind: 'analysis.set-graph'; graph: AnalysisGraph }>
  | Readonly<{ kind: 'analysis.update-node'; nodeId: string; node: AnalysisGraphNode }>
  | Readonly<{ kind: 'analysis.remove-node'; nodeId: string }>
  | Readonly<{
      kind: 'analysis.set-edge'
      nodeId: string
      port: string
      source: AnalysisValueReference
    }>
  | Readonly<{ kind: 'analysis.remove-edge'; nodeId: string; port: string }>
  | Readonly<{
      kind: 'analysis.set-binding'
      input: AnalysisGraphInput
      binding: PersistedInputBinding
    }>
  | Readonly<{ kind: 'analysis.remove-binding'; input: string }>
  | Readonly<{ kind: 'analysis.set-output'; output: AnalysisGraphOutput }>
  | Readonly<{ kind: 'analysis.remove-output'; name: string }>
  | Readonly<{ kind: 'result.pin'; result: PinnedResultReference }>
  | Readonly<{ kind: 'result.unpin'; resultId: string }>
  | Readonly<{ kind: 'project.set-title'; title: string }>
  | Readonly<{ kind: 'project.set-notes'; notes: string }>
  | Readonly<{ kind: 'project.set-workflow'; workflow: ProjectWorkflowSelection }>
  | Readonly<{
      kind: 'agent.apply-proposal'
      proposalId: string
      commands: readonly Exclude<WorkspaceMutation, { readonly kind: 'agent.apply-proposal' }>[]
    }>

export type WorkspaceCommand = WorkspaceCommandBase & WorkspaceMutation

export interface WorkspaceCommandBatch {
  readonly schemaVersion: typeof WORKSPACE_SCHEMA_VERSION
  readonly id: string
  readonly expectedRevision: number
  readonly issuedAt: string
  readonly commands: readonly Exclude<
    WorkspaceMutation,
    { readonly kind: 'agent.apply-proposal' }
  >[]
}

export interface WorkspaceCommandApplication {
  readonly applied: boolean
  readonly snapshot: WorkspaceSnapshot
  readonly description: string
}

export class WorkspaceCommandError extends Error {
  constructor(
    readonly code: 'INVALID_COMMAND' | 'LIMIT_EXCEEDED' | 'STALE_REVISION' | 'CONFLICT',
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceCommandError'
  }
}

const COMMAND_KINDS = new Set<WorkspaceMutation['kind']>([
  'source.add',
  'source.remove',
  'source.rebind',
  'dataset.select',
  'dataset.clear-selection',
  'roi.add',
  'roi.update',
  'roi.remove',
  'roi.select',
  'display.set-layer',
  'display.remove-layer',
  'calibration.set',
  'calibration.remove',
  'analysis.add-node',
  'analysis.set-graph',
  'analysis.update-node',
  'analysis.remove-node',
  'analysis.set-edge',
  'analysis.remove-edge',
  'analysis.set-binding',
  'analysis.remove-binding',
  'analysis.set-output',
  'analysis.remove-output',
  'result.pin',
  'result.unpin',
  'project.set-title',
  'project.set-notes',
  'project.set-workflow',
  'agent.apply-proposal',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface CommandCandidate extends Record<string, unknown> {
  readonly kind?: unknown
  readonly proposalId?: unknown
  readonly commands?: unknown
  readonly schemaVersion?: unknown
  readonly id?: unknown
  readonly issuedAt?: unknown
  readonly expectedRevision?: unknown
}

function commandCandidate(value: unknown): CommandCandidate {
  if (!isRecord(value))
    throw new WorkspaceCommandError('INVALID_COMMAND', 'command must be an object')
  return value as CommandCandidate
}

function assertString(
  value: unknown,
  label: string,
  maximum = WORKSPACE_LIMITS.maxStringLength,
): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new WorkspaceCommandError('INVALID_COMMAND', `${label} must be a non-empty string`)
  }
  if (value.length > maximum) {
    throw new WorkspaceCommandError('LIMIT_EXCEEDED', `${label} exceeds the string limit`)
  }
}

function validateMutationShape(
  value: unknown,
  allowAgent: boolean,
): asserts value is WorkspaceMutation {
  const candidate = commandCandidate(value)
  if (!COMMAND_KINDS.has(candidate.kind as WorkspaceMutation['kind'])) {
    throw new WorkspaceCommandError('INVALID_COMMAND', 'command kind is unknown')
  }
  if (candidate.kind === 'agent.apply-proposal') {
    if (!allowAgent)
      throw new WorkspaceCommandError('INVALID_COMMAND', 'agent proposals cannot nest')
    assertString(candidate.proposalId, 'proposalId')
    if (!Array.isArray(candidate.commands) || candidate.commands.length === 0) {
      throw new WorkspaceCommandError('INVALID_COMMAND', 'agent proposal needs commands')
    }
    if (candidate.commands.length > WORKSPACE_LIMITS.maxCommandsPerBatch) {
      throw new WorkspaceCommandError('LIMIT_EXCEEDED', 'agent proposal exceeds the command limit')
    }
    candidate.commands.forEach((command) => {
      validateMutationShape(command, false)
    })
  }
}

export function validateWorkspaceCommand(value: unknown): WorkspaceCommand {
  assertNoForbiddenProjectData(value, 'command')
  const candidate = commandCandidate(value)
  if (candidate.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new WorkspaceCommandError('INVALID_COMMAND', 'command schema version is unsupported')
  }
  assertString(candidate.id, 'command id')
  assertString(candidate.issuedAt, 'issuedAt')
  if (
    !Number.isSafeInteger(candidate.expectedRevision) ||
    (candidate.expectedRevision as number) < 0
  ) {
    throw new WorkspaceCommandError(
      'INVALID_COMMAND',
      'expectedRevision must be a non-negative integer',
    )
  }
  validateMutationShape(value, true)
  if (jsonBytes(value) > WORKSPACE_LIMITS.maxCommandBytes) {
    throw new WorkspaceCommandError('LIMIT_EXCEEDED', 'command exceeds the byte limit')
  }
  return value as unknown as WorkspaceCommand
}

export function validateWorkspaceCommandBatch(value: unknown): WorkspaceCommandBatch {
  assertNoForbiddenProjectData(value, 'batch')
  const candidate = commandCandidate(value)
  if (candidate.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new WorkspaceCommandError('INVALID_COMMAND', 'batch schema version is unsupported')
  }
  assertString(candidate.id, 'batch id')
  assertString(candidate.issuedAt, 'issuedAt')
  if (
    !Number.isSafeInteger(candidate.expectedRevision) ||
    (candidate.expectedRevision as number) < 0
  ) {
    throw new WorkspaceCommandError(
      'INVALID_COMMAND',
      'expectedRevision must be a non-negative integer',
    )
  }
  if (!Array.isArray(candidate.commands) || candidate.commands.length === 0) {
    throw new WorkspaceCommandError('INVALID_COMMAND', 'batch needs commands')
  }
  if (candidate.commands.length > WORKSPACE_LIMITS.maxCommandsPerBatch) {
    throw new WorkspaceCommandError('LIMIT_EXCEEDED', 'batch exceeds the command limit')
  }
  candidate.commands.forEach((command) => {
    validateMutationShape(command, false)
  })
  if (jsonBytes(value) > WORKSPACE_LIMITS.maxCommandBytes) {
    throw new WorkspaceCommandError('LIMIT_EXCEEDED', 'batch exceeds the byte limit')
  }
  return value as unknown as WorkspaceCommandBatch
}

function conflict(message: string): never {
  throw new WorkspaceCommandError('CONFLICT', message)
}

function replaceById<T extends { readonly id: string }>(
  values: readonly T[],
  next: T,
  allowAdd: boolean,
): readonly T[] {
  const index = values.findIndex(({ id }) => id === next.id)
  if (index < 0) {
    if (!allowAdd) conflict(`${next.id} does not exist`)
    return [...values, next]
  }
  return values.map((value, candidate) => (candidate === index ? next : value))
}

function applyMutation(
  snapshot: WorkspaceSnapshot,
  mutation: WorkspaceMutation,
): WorkspaceSnapshot {
  switch (mutation.kind) {
    case 'source.add': {
      if (snapshot.sources.some(({ id }) => id === mutation.source.id)) {
        conflict(`source ${mutation.source.id} already exists`)
      }
      if (mutation.datasets.some(({ sourceId }) => sourceId !== mutation.source.id)) {
        conflict('added datasets must belong to the added source')
      }
      const references = snapshot.analysis.sourceReferences.some(
        ({ id }) => id === mutation.source.id,
      )
        ? snapshot.analysis.sourceReferences
        : [
            ...snapshot.analysis.sourceReferences,
            {
              id: mutation.source.id,
              identity: mutation.source.identity,
              locatorHint: mutation.source.locator,
            },
          ]
      return {
        ...snapshot,
        sources: [...snapshot.sources, mutation.source],
        datasets: [...snapshot.datasets, ...mutation.datasets],
        layers: [...snapshot.layers, ...(mutation.layers ?? [])],
        analysis: { ...snapshot.analysis, sourceReferences: references },
        ...(mutation.activate === undefined ? {} : { active: mutation.activate }),
      }
    }
    case 'source.remove': {
      const existing = snapshot.sources.find(({ id }) => id === mutation.sourceId)
      if (existing === undefined) conflict(`source ${mutation.sourceId} does not exist`)
      const reference = snapshot.analysis.sourceReferences.find(
        ({ id }) => id === mutation.sourceId,
      )
      if (
        reference !== undefined &&
        snapshot.analysis.bindings.some(
          ({ value }) => value.kind === 'source' && value.sourceReference === reference.id,
        )
      ) {
        conflict(`source ${mutation.sourceId} is still bound to the analysis graph`)
      }
      const removedDatasetIds = new Set(
        snapshot.datasets
          .filter(({ sourceId }) => sourceId === mutation.sourceId)
          .map(({ id }) => id),
      )
      return {
        ...snapshot,
        sources: snapshot.sources.filter(({ id }) => id !== mutation.sourceId),
        datasets: snapshot.datasets.filter(({ sourceId }) => sourceId !== mutation.sourceId),
        layers: snapshot.layers.filter(
          ({ datasetReferenceId }) => !removedDatasetIds.has(datasetReferenceId),
        ),
        calibrations: snapshot.calibrations.filter(
          ({ datasetReferenceId }) => !removedDatasetIds.has(datasetReferenceId),
        ),
        analysis: {
          ...snapshot.analysis,
          sourceReferences: snapshot.analysis.sourceReferences.filter(
            ({ id }) => id !== mutation.sourceId,
          ),
        },
        ...(snapshot.active?.sourceId === mutation.sourceId ? { active: undefined } : {}),
      }
    }
    case 'source.rebind': {
      const existing = snapshot.sources.find(({ id }) => id === mutation.sourceId)
      if (existing === undefined) conflict(`source ${mutation.sourceId} does not exist`)
      return {
        ...snapshot,
        sources: snapshot.sources.map((item) =>
          item.id === mutation.sourceId
            ? {
                ...item,
                locator: mutation.locator,
                identity: mutation.identity,
                bound: mutation.bound,
              }
            : item,
        ),
        datasets:
          mutation.datasets === undefined
            ? snapshot.datasets
            : [
                ...snapshot.datasets.filter(({ sourceId }) => sourceId !== mutation.sourceId),
                ...mutation.datasets,
              ],
        analysis: {
          ...snapshot.analysis,
          sourceReferences: snapshot.analysis.sourceReferences.map((item) =>
            item.id === mutation.sourceId
              ? { ...item, identity: mutation.identity, locatorHint: mutation.locator }
              : item,
          ),
        },
      }
    }
    case 'dataset.select': {
      const dataset = snapshot.datasets.find(
        ({ id }) => id === mutation.selection.datasetReferenceId,
      )
      if (dataset === undefined || dataset.sourceId !== mutation.selection.sourceId) {
        conflict('selected dataset is unresolved')
      }
      return { ...snapshot, active: mutation.selection }
    }
    case 'dataset.clear-selection':
      return { ...snapshot, active: undefined }
    case 'roi.add':
      if (snapshot.analysis.roiSet.rois.some(({ id }) => id === mutation.roi.id)) {
        conflict(`ROI ${mutation.roi.id} already exists`)
      }
      return {
        ...snapshot,
        analysis: {
          ...snapshot.analysis,
          roiSet: {
            ...snapshot.analysis.roiSet,
            rois: [...snapshot.analysis.roiSet.rois, mutation.roi],
          },
        },
      }
    case 'roi.update': {
      if (mutation.roi.id !== mutation.roiId) conflict('updated ROI ID cannot change')
      const rois = replaceById(snapshot.analysis.roiSet.rois, mutation.roi, false)
      return {
        ...snapshot,
        analysis: { ...snapshot.analysis, roiSet: { ...snapshot.analysis.roiSet, rois } },
      }
    }
    case 'roi.remove': {
      if (!snapshot.analysis.roiSet.rois.some(({ id }) => id === mutation.roiId)) {
        conflict(`ROI ${mutation.roiId} does not exist`)
      }
      if (
        snapshot.analysis.bindings.some(
          ({ value }) =>
            (value.kind === 'roi' && value.roiId === mutation.roiId) ||
            (value.kind === 'roi-set' && value.roiIds?.includes(mutation.roiId) === true),
        )
      ) {
        conflict(`ROI ${mutation.roiId} is still bound to the analysis graph`)
      }
      return {
        ...snapshot,
        analysis: {
          ...snapshot.analysis,
          roiSet: {
            ...snapshot.analysis.roiSet,
            rois: snapshot.analysis.roiSet.rois.filter(({ id }) => id !== mutation.roiId),
          },
        },
        workflow: {
          ...snapshot.workflow,
          ...(snapshot.workflow.selectedRoiId === mutation.roiId
            ? { selectedRoiId: undefined }
            : {}),
        },
      }
    }
    case 'roi.select':
      if (
        mutation.roiId !== undefined &&
        !snapshot.analysis.roiSet.rois.some(({ id }) => id === mutation.roiId)
      ) {
        conflict(`ROI ${mutation.roiId} does not exist`)
      }
      return { ...snapshot, workflow: { ...snapshot.workflow, selectedRoiId: mutation.roiId } }
    case 'display.set-layer':
      if (!snapshot.datasets.some(({ id }) => id === mutation.layer.datasetReferenceId)) {
        conflict(`layer dataset ${mutation.layer.datasetReferenceId} does not exist`)
      }
      return { ...snapshot, layers: replaceById(snapshot.layers, mutation.layer, true) }
    case 'display.remove-layer':
      if (!snapshot.layers.some(({ id }) => id === mutation.layerId)) {
        conflict(`layer ${mutation.layerId} does not exist`)
      }
      return { ...snapshot, layers: snapshot.layers.filter(({ id }) => id !== mutation.layerId) }
    case 'calibration.set': {
      const dataset = snapshot.datasets.find(
        ({ id }) => id === mutation.calibration.datasetReferenceId,
      )
      if (dataset === undefined)
        conflict(`calibration dataset ${mutation.calibration.datasetReferenceId} does not exist`)
      const calibration = mutation.calibration
      if (
        calibration.axisIds[0] === calibration.axisIds[1] ||
        calibration.axisIds.some(
          (axisId) => !dataset.descriptor.axes.some(({ id }) => id === axisId),
        ) ||
        calibration.unitsPerPixel.some((spacing) => !Number.isFinite(spacing) || spacing <= 0) ||
        calibration.unit.trim() === '' ||
        (calibration.knownDistance !== undefined &&
          (!Number.isFinite(calibration.knownDistance) || calibration.knownDistance <= 0)) ||
        (calibration.measuredPixels !== undefined &&
          (!Number.isFinite(calibration.measuredPixels) || calibration.measuredPixels <= 0)) ||
        (calibration.source === 'known-line' &&
          (calibration.knownDistance === undefined || calibration.measuredPixels === undefined))
      )
        conflict('calibration values are invalid for the selected dataset')
      return {
        ...snapshot,
        calibrations: replaceById(
          snapshot.calibrations.map((calibration) => ({
            ...calibration,
            id: calibration.datasetReferenceId,
          })),
          { ...mutation.calibration, id: mutation.calibration.datasetReferenceId },
          true,
        ).map(({ id: _id, ...calibration }) => calibration),
      }
    }
    case 'calibration.remove':
      return {
        ...snapshot,
        calibrations: snapshot.calibrations.filter(
          ({ datasetReferenceId }) => datasetReferenceId !== mutation.datasetReferenceId,
        ),
      }
    case 'analysis.add-node':
      if (snapshot.analysis.graph.nodes.some(({ id }) => id === mutation.node.id)) {
        conflict(`analysis node ${mutation.node.id} already exists`)
      }
      return {
        ...snapshot,
        analysis: {
          ...snapshot.analysis,
          graph: {
            ...snapshot.analysis.graph,
            nodes: [...snapshot.analysis.graph.nodes, mutation.node],
          },
        },
      }
    case 'analysis.set-graph':
      return { ...snapshot, analysis: { ...snapshot.analysis, graph: mutation.graph } }
    case 'analysis.update-node':
      if (mutation.node.id !== mutation.nodeId) conflict('updated analysis node ID cannot change')
      return {
        ...snapshot,
        analysis: {
          ...snapshot.analysis,
          graph: {
            ...snapshot.analysis.graph,
            nodes: replaceById(snapshot.analysis.graph.nodes, mutation.node, false),
          },
        },
      }
    case 'analysis.remove-node': {
      if (!snapshot.analysis.graph.nodes.some(({ id }) => id === mutation.nodeId)) {
        conflict(`analysis node ${mutation.nodeId} does not exist`)
      }
      const referenced = [
        ...snapshot.analysis.graph.nodes.flatMap(({ inputs }) => inputs),
        ...snapshot.analysis.graph.outputs,
      ].some(({ source }) => source.kind === 'node' && source.nodeId === mutation.nodeId)
      if (referenced) conflict(`analysis node ${mutation.nodeId} still has consumers`)
      return {
        ...snapshot,
        analysis: {
          ...snapshot.analysis,
          graph: {
            ...snapshot.analysis.graph,
            nodes: snapshot.analysis.graph.nodes.filter(({ id }) => id !== mutation.nodeId),
          },
        },
      }
    }
    case 'analysis.set-edge': {
      const node = snapshot.analysis.graph.nodes.find(({ id }) => id === mutation.nodeId)
      if (node === undefined) conflict(`analysis node ${mutation.nodeId} does not exist`)
      const inputs = [
        ...node.inputs.filter(({ port }) => port !== mutation.port),
        { port: mutation.port, source: mutation.source },
      ]
      return applyMutation(snapshot, {
        kind: 'analysis.update-node',
        nodeId: node.id,
        node: { ...node, inputs },
      })
    }
    case 'analysis.remove-edge': {
      const node = snapshot.analysis.graph.nodes.find(({ id }) => id === mutation.nodeId)
      if (node === undefined || !node.inputs.some(({ port }) => port === mutation.port)) {
        conflict(`analysis edge ${mutation.nodeId}.${mutation.port} does not exist`)
      }
      return applyMutation(snapshot, {
        kind: 'analysis.update-node',
        nodeId: node.id,
        node: { ...node, inputs: node.inputs.filter(({ port }) => port !== mutation.port) },
      })
    }
    case 'analysis.set-binding': {
      if (mutation.input.name !== mutation.binding.input) conflict('binding input names must match')
      const inputs = replaceById(
        snapshot.analysis.graph.inputs.map((item) => ({ ...item, id: item.name })),
        { ...mutation.input, id: mutation.input.name },
        true,
      ).map(({ id: _id, ...input }) => input)
      return {
        ...snapshot,
        analysis: {
          ...snapshot.analysis,
          graph: { ...snapshot.analysis.graph, inputs },
          bindings: [
            ...snapshot.analysis.bindings.filter(({ input }) => input !== mutation.binding.input),
            mutation.binding,
          ],
        },
      }
    }
    case 'analysis.remove-binding': {
      const exists = snapshot.analysis.graph.inputs.some(({ name }) => name === mutation.input)
      if (!exists) conflict(`analysis binding ${mutation.input} does not exist`)
      return {
        ...snapshot,
        analysis: {
          ...snapshot.analysis,
          graph: {
            ...snapshot.analysis.graph,
            inputs: snapshot.analysis.graph.inputs.filter(({ name }) => name !== mutation.input),
          },
          bindings: snapshot.analysis.bindings.filter(({ input }) => input !== mutation.input),
        },
      }
    }
    case 'analysis.set-output':
      return {
        ...snapshot,
        analysis: {
          ...snapshot.analysis,
          graph: {
            ...snapshot.analysis.graph,
            outputs: [
              ...snapshot.analysis.graph.outputs.filter(
                ({ name }) => name !== mutation.output.name,
              ),
              mutation.output,
            ],
          },
        },
      }
    case 'analysis.remove-output':
      if (!snapshot.analysis.graph.outputs.some(({ name }) => name === mutation.name)) {
        conflict(`analysis output ${mutation.name} does not exist`)
      }
      return {
        ...snapshot,
        analysis: {
          ...snapshot.analysis,
          graph: {
            ...snapshot.analysis.graph,
            outputs: snapshot.analysis.graph.outputs.filter(({ name }) => name !== mutation.name),
          },
        },
      }
    case 'result.pin':
      return {
        ...snapshot,
        pinnedResults: replaceById(snapshot.pinnedResults, mutation.result, true),
      }
    case 'result.unpin':
      if (!snapshot.pinnedResults.some(({ id }) => id === mutation.resultId)) {
        conflict(`result ${mutation.resultId} is not pinned`)
      }
      return {
        ...snapshot,
        pinnedResults: snapshot.pinnedResults.filter(({ id }) => id !== mutation.resultId),
      }
    case 'project.set-title':
      return { ...snapshot, project: { ...snapshot.project, title: mutation.title } }
    case 'project.set-notes':
      return { ...snapshot, notes: mutation.notes }
    case 'project.set-workflow':
      return { ...snapshot, workflow: mutation.workflow }
    case 'agent.apply-proposal':
      return mutation.commands.reduce<WorkspaceSnapshot>(applyMutation, snapshot)
  }
}

function finalize(
  original: WorkspaceSnapshot,
  changed: WorkspaceSnapshot,
  revision: number,
  issuedAt: string,
): WorkspaceSnapshot {
  if (changed === original) return original
  return validateWorkspaceProjectV1({
    ...changed,
    revision,
    project: { ...changed.project, updatedAt: issuedAt },
  })
}

export function applyWorkspaceCommand(
  snapshot: WorkspaceSnapshot,
  input: unknown,
): WorkspaceCommandApplication {
  const command = validateWorkspaceCommand(input)
  if (command.expectedRevision !== snapshot.revision) {
    throw new WorkspaceCommandError(
      'STALE_REVISION',
      `expected revision ${command.expectedRevision}, current revision is ${snapshot.revision}`,
    )
  }
  const changed = applyMutation(snapshot, command)
  const next = finalize(snapshot, changed, snapshot.revision + 1, command.issuedAt)
  return { applied: true, snapshot: next, description: describeWorkspaceCommand(command) }
}

export function applyWorkspaceCommandBatch(
  snapshot: WorkspaceSnapshot,
  input: unknown,
): WorkspaceCommandApplication {
  const batch = validateWorkspaceCommandBatch(input)
  if (batch.expectedRevision !== snapshot.revision) {
    throw new WorkspaceCommandError(
      'STALE_REVISION',
      `expected revision ${batch.expectedRevision}, current revision is ${snapshot.revision}`,
    )
  }
  const changed = batch.commands.reduce<WorkspaceSnapshot>(applyMutation, snapshot)
  const next = finalize(snapshot, changed, snapshot.revision + 1, batch.issuedAt)
  return {
    applied: true,
    snapshot: next,
    description: `Applied ${batch.commands.length} workspace changes`,
  }
}

export function invertWorkspaceMutation(
  snapshot: WorkspaceSnapshot,
  mutation: WorkspaceMutation,
): readonly WorkspaceMutation[] {
  switch (mutation.kind) {
    case 'source.add':
      return [{ kind: 'source.remove', sourceId: mutation.source.id }]
    case 'source.remove': {
      const source = snapshot.sources.find(({ id }) => id === mutation.sourceId)
      if (source === undefined) conflict(`source ${mutation.sourceId} does not exist`)
      const datasets = snapshot.datasets.filter(({ sourceId }) => sourceId === mutation.sourceId)
      const datasetIds = new Set(datasets.map(({ id }) => id))
      const layers = snapshot.layers.filter(({ datasetReferenceId }) =>
        datasetIds.has(datasetReferenceId),
      )
      return [
        {
          kind: 'source.add',
          source,
          datasets,
          layers,
          ...(snapshot.active?.sourceId === mutation.sourceId ? { activate: snapshot.active } : {}),
        },
      ]
    }
    case 'source.rebind': {
      const source = snapshot.sources.find(({ id }) => id === mutation.sourceId)
      if (source === undefined) conflict(`source ${mutation.sourceId} does not exist`)
      return [
        {
          kind: 'source.rebind',
          sourceId: source.id,
          locator: source.locator,
          identity: source.identity,
          bound: source.bound,
          datasets: snapshot.datasets.filter(({ sourceId }) => sourceId === source.id),
        },
      ]
    }
    case 'dataset.select':
      return snapshot.active === undefined
        ? [{ kind: 'dataset.clear-selection' }]
        : [{ kind: 'dataset.select', selection: snapshot.active }]
    case 'dataset.clear-selection':
      return snapshot.active === undefined
        ? []
        : [{ kind: 'dataset.select', selection: snapshot.active }]
    case 'roi.add':
      return [{ kind: 'roi.remove', roiId: mutation.roi.id }]
    case 'roi.update': {
      const roi = snapshot.analysis.roiSet.rois.find(({ id }) => id === mutation.roiId)
      if (roi === undefined) conflict(`ROI ${mutation.roiId} does not exist`)
      return [{ kind: 'roi.update', roiId: roi.id, roi }]
    }
    case 'roi.remove': {
      const roi = snapshot.analysis.roiSet.rois.find(({ id }) => id === mutation.roiId)
      if (roi === undefined) conflict(`ROI ${mutation.roiId} does not exist`)
      return [{ kind: 'roi.add', roi }]
    }
    case 'roi.select':
      return [
        {
          kind: 'roi.select',
          ...(snapshot.workflow.selectedRoiId === undefined
            ? {}
            : { roiId: snapshot.workflow.selectedRoiId }),
        },
      ]
    case 'display.set-layer': {
      const layer = snapshot.layers.find(({ id }) => id === mutation.layer.id)
      return layer === undefined
        ? [{ kind: 'display.remove-layer', layerId: mutation.layer.id }]
        : [{ kind: 'display.set-layer', layer }]
    }
    case 'display.remove-layer': {
      const layer = snapshot.layers.find(({ id }) => id === mutation.layerId)
      if (layer === undefined) conflict(`layer ${mutation.layerId} does not exist`)
      return [{ kind: 'display.set-layer', layer }]
    }
    case 'calibration.set': {
      const calibration = snapshot.calibrations.find(
        ({ datasetReferenceId }) => datasetReferenceId === mutation.calibration.datasetReferenceId,
      )
      return calibration === undefined
        ? [
            {
              kind: 'calibration.remove',
              datasetReferenceId: mutation.calibration.datasetReferenceId,
            },
          ]
        : [{ kind: 'calibration.set', calibration }]
    }
    case 'calibration.remove': {
      const calibration = snapshot.calibrations.find(
        ({ datasetReferenceId }) => datasetReferenceId === mutation.datasetReferenceId,
      )
      return calibration === undefined ? [] : [{ kind: 'calibration.set', calibration }]
    }
    case 'analysis.add-node':
      return [{ kind: 'analysis.remove-node', nodeId: mutation.node.id }]
    case 'analysis.set-graph':
      return [{ kind: 'analysis.set-graph', graph: snapshot.analysis.graph }]
    case 'analysis.update-node': {
      const node = snapshot.analysis.graph.nodes.find(({ id }) => id === mutation.nodeId)
      if (node === undefined) conflict(`analysis node ${mutation.nodeId} does not exist`)
      return [{ kind: 'analysis.update-node', nodeId: node.id, node }]
    }
    case 'analysis.remove-node': {
      const node = snapshot.analysis.graph.nodes.find(({ id }) => id === mutation.nodeId)
      if (node === undefined) conflict(`analysis node ${mutation.nodeId} does not exist`)
      return [{ kind: 'analysis.add-node', node }]
    }
    case 'analysis.set-edge': {
      const node = snapshot.analysis.graph.nodes.find(({ id }) => id === mutation.nodeId)
      const edge = node?.inputs.find(({ port }) => port === mutation.port)
      return edge === undefined
        ? [{ kind: 'analysis.remove-edge', nodeId: mutation.nodeId, port: mutation.port }]
        : [
            {
              kind: 'analysis.set-edge',
              nodeId: mutation.nodeId,
              port: mutation.port,
              source: edge.source,
            },
          ]
    }
    case 'analysis.remove-edge': {
      const edge = snapshot.analysis.graph.nodes
        .find(({ id }) => id === mutation.nodeId)
        ?.inputs.find(({ port }) => port === mutation.port)
      if (edge === undefined)
        conflict(`analysis edge ${mutation.nodeId}.${mutation.port} does not exist`)
      return [
        {
          kind: 'analysis.set-edge',
          nodeId: mutation.nodeId,
          port: mutation.port,
          source: edge.source,
        },
      ]
    }
    case 'analysis.set-binding': {
      const input = snapshot.analysis.graph.inputs.find(({ name }) => name === mutation.input.name)
      const binding = snapshot.analysis.bindings.find(
        ({ input: name }) => name === mutation.input.name,
      )
      return input === undefined || binding === undefined
        ? [{ kind: 'analysis.remove-binding', input: mutation.input.name }]
        : [{ kind: 'analysis.set-binding', input, binding }]
    }
    case 'analysis.remove-binding': {
      const input = snapshot.analysis.graph.inputs.find(({ name }) => name === mutation.input)
      const binding = snapshot.analysis.bindings.find(({ input: name }) => name === mutation.input)
      if (input === undefined || binding === undefined)
        conflict(`analysis binding ${mutation.input} does not exist`)
      return [{ kind: 'analysis.set-binding', input, binding }]
    }
    case 'analysis.set-output': {
      const output = snapshot.analysis.graph.outputs.find(
        ({ name }) => name === mutation.output.name,
      )
      return output === undefined
        ? [{ kind: 'analysis.remove-output', name: mutation.output.name }]
        : [{ kind: 'analysis.set-output', output }]
    }
    case 'analysis.remove-output': {
      const output = snapshot.analysis.graph.outputs.find(({ name }) => name === mutation.name)
      if (output === undefined) conflict(`analysis output ${mutation.name} does not exist`)
      return [{ kind: 'analysis.set-output', output }]
    }
    case 'result.pin': {
      const result = snapshot.pinnedResults.find(({ id }) => id === mutation.result.id)
      return result === undefined
        ? [{ kind: 'result.unpin', resultId: mutation.result.id }]
        : [{ kind: 'result.pin', result }]
    }
    case 'result.unpin': {
      const result = snapshot.pinnedResults.find(({ id }) => id === mutation.resultId)
      if (result === undefined) conflict(`result ${mutation.resultId} is not pinned`)
      return [{ kind: 'result.pin', result }]
    }
    case 'project.set-title':
      return [{ kind: 'project.set-title', title: snapshot.project.title }]
    case 'project.set-notes':
      return [{ kind: 'project.set-notes', notes: snapshot.notes }]
    case 'project.set-workflow':
      return [{ kind: 'project.set-workflow', workflow: snapshot.workflow }]
    case 'agent.apply-proposal': {
      let current = snapshot
      const inverse: WorkspaceMutation[] = []
      for (const command of mutation.commands) {
        inverse.unshift(...invertWorkspaceMutation(current, command))
        current = applyMutation(current, command)
      }
      return inverse
    }
  }
}

export function describeWorkspaceCommand(command: WorkspaceMutation): string {
  switch (command.kind) {
    case 'source.add':
      return `Added source ${command.source.label}`
    case 'source.remove':
      return `Removed source ${command.sourceId}`
    case 'source.rebind':
      return `Rebound source ${command.sourceId}`
    case 'dataset.select':
      return `Selected dataset ${command.selection.datasetReferenceId}`
    case 'dataset.clear-selection':
      return 'Cleared the active dataset'
    case 'roi.add':
      return `Added ROI ${command.roi.name ?? command.roi.id}`
    case 'roi.update':
      return `Updated ROI ${command.roi.name ?? command.roiId}`
    case 'roi.remove':
      return `Removed ROI ${command.roiId}`
    case 'roi.select':
      return command.roiId === undefined ? 'Cleared ROI selection' : `Selected ROI ${command.roiId}`
    case 'display.set-layer':
      return `Updated display layer ${command.layer.label}`
    case 'display.remove-layer':
      return `Removed display layer ${command.layerId}`
    case 'calibration.set':
      return `Calibrated dataset ${command.calibration.datasetReferenceId}`
    case 'calibration.remove':
      return `Restored file calibration for ${command.datasetReferenceId}`
    case 'analysis.add-node':
      return `Added analysis step ${command.node.label ?? command.node.operation.id}`
    case 'analysis.set-graph':
      return `Updated analysis pipeline (${command.graph.nodes.length} steps)`
    case 'analysis.update-node':
      return `Updated analysis step ${command.node.label ?? command.node.operation.id}`
    case 'analysis.remove-node':
      return `Removed analysis step ${command.nodeId}`
    case 'analysis.set-edge':
      return `Connected ${command.nodeId}.${command.port}`
    case 'analysis.remove-edge':
      return `Disconnected ${command.nodeId}.${command.port}`
    case 'analysis.set-binding':
      return `Bound analysis input ${command.input.name}`
    case 'analysis.remove-binding':
      return `Unbound analysis input ${command.input}`
    case 'analysis.set-output':
      return `Published analysis output ${command.output.label ?? command.output.name}`
    case 'analysis.remove-output':
      return `Removed analysis output ${command.name}`
    case 'result.pin':
      return `Pinned result ${command.result.label}`
    case 'result.unpin':
      return `Unpinned result ${command.resultId}`
    case 'project.set-title':
      return `Renamed project to ${command.title}`
    case 'project.set-notes':
      return 'Updated project notes'
    case 'project.set-workflow':
      return 'Changed project workspace view'
    case 'agent.apply-proposal':
      return `Applied approved agent proposal ${command.proposalId}`
  }
}

export function workspaceCommand(
  snapshot: WorkspaceSnapshot,
  id: string,
  issuedAt: string,
  mutation: WorkspaceMutation,
): WorkspaceCommand {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id,
    expectedRevision: snapshot.revision,
    issuedAt,
    ...mutation,
  }
}

export function datasetReferenceId(
  sourceId: SemanticSourceId,
  datasetId: string,
): DatasetReferenceId {
  return `${sourceId}:${datasetId}` as DatasetReferenceId
}
