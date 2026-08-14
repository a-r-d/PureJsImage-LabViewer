import {
  type AnalysisScriptDocumentV1,
  type ScriptPermissionGrantV1,
  scriptContentIntegrity,
} from '@pji-workbench/plugin-sdk'

const SOURCE = `import { lab } from '@lab/api'

export async function main() {
  const workspace = await lab.workspace.getSummary()
  const datasets = await lab.datasets.list()
  const dataset = await lab.datasets.describe({ datasetId: datasets[0].id })
  const rois = await lab.rois.list()
  const catalog = await lab.analysis.catalog()
  const plan = await lab.analysis.dryRun({ operationId: 'threshold.manual', parameters: { lower: 96 } })
  const proposal = await lab.rois.propose({ kind: 'rectangle', label: 'script-proposal', x: 12, y: 16, width: 96, height: 64 })
  await lab.log({ message: 'Prepared a bounded threshold proposal.' })
  return {
    workspace,
    datasetCount: datasets.length,
    dataset,
    roiCount: rois.length,
    operationCount: catalog.operations.length,
    plan,
    proposal
  }
}

globalThis.__scriptMain = main
`

export async function createBuiltInScriptFixture(): Promise<{
  readonly document: AnalysisScriptDocumentV1
  readonly permissionGrant: ScriptPermissionGrantV1
}> {
  const withoutIntegrity = {
    schemaVersion: 1 as const,
    kind: 'analysis-script' as const,
    id: 'builtin.threshold-proposal',
    title: 'Threshold and ROI proposal',
    description:
      'Reads bounded fixture summaries and proposes one threshold plan and rectangle ROI.',
    language: 'javascript' as const,
    source: SOURCE,
    manifest: {
      scriptApiVersion: 1 as const,
      requestedCapabilities: [
        'analysis.catalog',
        'analysis.dry-run',
        'dataset.read-descriptor',
        'roi.propose',
        'roi.read',
        'workspace.read',
      ] as const,
      pureJsImageCompatibility: '^4.0.0',
      workbenchCompatibility: '^0.0.0',
      entrypoint: 'main' as const,
      deterministic: true,
    },
    tests: [
      {
        id: 'generated-particles',
        title: 'Produces bounded sample proposals',
        fixtureId: 'generated.calibrated-particles',
        expected: { datasetCount: 1, roiCount: 1 },
      },
    ],
  }
  const integrity = await scriptContentIntegrity(withoutIntegrity)
  return {
    document: { ...withoutIntegrity, integrity },
    permissionGrant: {
      schemaVersion: 1,
      scriptId: withoutIntegrity.id,
      sourceDigest: integrity.digest,
      grantedCapabilities: withoutIntegrity.manifest.requestedCapabilities,
      deniedCapabilities: [],
    },
  }
}
