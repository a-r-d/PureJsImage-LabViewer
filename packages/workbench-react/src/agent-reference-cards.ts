import type { AgentActionTrace, AgentArtifact, AgentRuntimeSnapshot } from '@pji-workbench/agent'

export type AgentReferenceKind = 'action' | 'source' | 'dataset' | 'roi' | 'result' | 'artifact'

export interface AgentReferenceCard {
  readonly kind: AgentReferenceKind
  readonly id: string
  readonly title: string
  readonly detail?: string
}

export function agentReferenceCards(
  snapshot: Pick<AgentRuntimeSnapshot, 'trace' | 'artifacts'>,
): readonly AgentReferenceCard[] {
  const cards: AgentReferenceCard[] = []
  const seen = new Set<string>()
  const add = (card: AgentReferenceCard): void => {
    const key = `${card.kind}:${card.id}`
    if (seen.has(key)) return
    seen.add(key)
    cards.push(card)
  }
  for (const entry of snapshot.trace) {
    add({
      kind: 'action',
      id: `${entry.actionId}@${entry.actionVersion}`,
      title: entry.actionId,
      detail: `${entry.approval} · revision ${entry.projectRevisionAfter}`,
    })
    collectFromValue(entry.result, add)
    collectFromValue(entry.input, add)
  }
  for (const artifact of snapshot.artifacts) {
    add({
      kind: 'artifact',
      id: artifact.id,
      title: artifact.kind,
      detail: `${artifact.width ?? '?'} × ${artifact.height ?? '?'}`,
    })
  }
  return cards.slice(0, 32)
}

function collectFromValue(value: unknown, add: (card: AgentReferenceCard) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) collectFromValue(item, add)
    return
  }
  if (typeof value !== 'object' || value === null) return
  const record = value as Readonly<Record<string, unknown>>
  const sourceId = stringField(record, 'sourceId')
  if (sourceId !== undefined)
    add({
      kind: 'source',
      id: sourceId,
      title: stringField(record, 'label') ?? sourceId,
    })
  const datasetId = stringField(record, 'datasetId') ?? stringField(record, 'datasetReferenceId')
  if (datasetId !== undefined)
    add({
      kind: 'dataset',
      id: datasetId,
      title: stringField(record, 'name') ?? datasetId,
    })
  const roiId = stringField(record, 'roiId')
  if (roiId !== undefined)
    add({
      kind: 'roi',
      id: roiId,
      title: stringField(record, 'name') ?? roiId,
    })
  const resultId =
    stringField(record, 'resultHandleId') ??
    stringField(record, 'resultId') ??
    stringField(record, 'planId')
  if (resultId !== undefined) {
    const detail = stringField(record, 'output') ?? stringField(record, 'status')
    add({
      kind: 'result',
      id: resultId,
      title: 'Analysis result',
      ...(detail === undefined ? {} : { detail }),
    })
  }
  for (const item of Object.values(record)) collectFromValue(item, add)
}

function stringField(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

export function particlePlanFromTrace(
  trace: readonly AgentActionTrace[],
): AgentActionTrace | undefined {
  return trace.findLast(({ actionId }) => actionId === 'analysis.particle.plan')
}

export function previewArtifacts(artifacts: readonly AgentArtifact[]): readonly AgentArtifact[] {
  return artifacts.slice(-8)
}
