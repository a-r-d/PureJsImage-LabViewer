import type {
  CorpusAuditEntryV1,
  CorpusAuditReportV1,
  CorpusManifestV1,
  CorpusStatus,
  ExampleScenarioV1,
} from './types.js'

function auditScenario(scenario: ExampleScenarioV1): CorpusAuditEntryV1 {
  const reasons: string[] = [scenario.statusReason]
  if (scenario.license.redistribution !== 'approved')
    reasons.push('Redistribution is not approved.')
  for (const file of scenario.source.files) {
    if (scenario.source.kind !== 'generated') {
      if (
        (scenario.source.kind === 'hosted' || scenario.source.kind === 'external') &&
        file.url === undefined
      )
        reasons.push(`${file.path}: immutable download URL is missing.`)
      if (file.sizeBytes === undefined) reasons.push(`${file.path}: exact byte size is missing.`)
      if (file.sha256 === undefined) reasons.push(`${file.path}: SHA-256 is missing.`)
    }
  }
  if (scenario.workflows.length === 0) reasons.push('No workflow is defined.')
  return {
    id: scenario.id,
    status: scenario.status,
    ready: scenario.status === 'enabled' && reasons.length === 1,
    reasons,
  }
}

export function createCorpusAuditReport(manifest: CorpusManifestV1): CorpusAuditReportV1 {
  const counts: Record<CorpusStatus, number> = {
    enabled: 0,
    candidate: 0,
    scheduled: 0,
    excluded: 0,
    disabled: 0,
  }
  const entries = manifest.scenarios.map((scenario) => {
    counts[scenario.status] += 1
    return auditScenario(scenario)
  })
  return {
    schemaVersion: 1,
    generatedAt: manifest.generatedAt,
    entries,
    counts,
  }
}

export function corpusAuditMarkdown(report: CorpusAuditReportV1): string {
  const lines = [
    '# Corpus audit',
    '',
    `Generated from manifest verification state dated ${report.generatedAt}.`,
    '',
    '| Scenario | Status | Gate | Reasons |',
    '| --- | --- | --- | --- |',
  ]
  for (const entry of report.entries) {
    lines.push(
      `| \`${entry.id}\` | ${entry.status} | ${entry.ready ? 'ready' : 'not ready'} | ${entry.reasons.join(' ')} |`,
    )
  }
  return `${lines.join('\n')}\n`
}
