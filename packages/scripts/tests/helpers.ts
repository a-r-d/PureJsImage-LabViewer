import type {
  ActionCapabilityManifestV1,
  JsonValue,
  WorkbenchActionDescriptorV1,
} from '@pji-workbench/actions'
import {
  type AnalysisScriptDocumentV1,
  type ScriptCapability,
  type ScriptPermissionGrantV1,
  scriptContentIntegrity,
} from '@pji-workbench/plugin-sdk'
import {
  DEFAULT_SANDBOX_LIMITS,
  generateScriptApi,
  SCRIPT_API_ENDPOINTS,
  type ScriptActionInvoker,
} from '../src/index.js'

const manifest: ActionCapabilityManifestV1 = {
  schemaVersion: 1,
  actions: SCRIPT_API_ENDPOINTS.map(
    (endpoint): WorkbenchActionDescriptorV1 => ({
      schemaVersion: 1,
      id: endpoint.actionId,
      version: endpoint.actionVersion,
      title: endpoint.api,
      description: `Fixture handler for ${endpoint.api}.`,
      category: endpoint.api.split('.')[0] ?? 'script',
      inputSchema: { type: 'object' },
      outputSchema: {},
      mutability: endpoint.mode === 'dry-run' ? 'proposal' : 'read',
      cost: 'trivial',
      permissions: [endpoint.permission],
      cancellable: true,
    }),
  ),
}

export const testApi = generateScriptApi(manifest)
export const testLimits = { ...DEFAULT_SANDBOX_LIMITS, deadlineMilliseconds: 100 }

export const fixtureInvoker: ScriptActionInvoker = {
  invoke(actionId, _version, input): Promise<JsonValue> {
    const results: Readonly<Record<string, JsonValue>> = {
      'workspace.summary.read': { revision: 4, title: 'Generated particles' },
      'source.list': [{ id: 'source:generated', label: 'Generated particles' }],
      'dataset.list': [{ id: 'dataset:particles', name: 'Calibrated particles' }],
      'dataset.describe': { id: 'dataset:particles', width: 512, height: 512, unit: 'nm' },
      'roi.list': [{ id: 'roi:known', kind: 'rectangle', area: 12_288 }],
      'roi.create': { proposalId: 'proposal:roi-1', normalized: input },
      'analysis.catalog.read': { operations: ['threshold.manual', 'measure.statistics'] },
      'analysis.describe': { id: 'threshold.manual', version: 1 },
      'analysis.normalize': { operationId: 'threshold.manual', parameters: { lower: 96 } },
      'analysis.dry-run': { planId: 'plan:threshold-1', estimatedBytes: 262_144 },
      'analysis.request-execute': { proposalId: 'proposal:analysis-1' },
      'result.summary.read': { rowCount: 12, mean: 42.5 },
      'result.page.read': { offset: 0, rows: [] },
      'viewport.state.read': { zoom: 1, center: [256, 256] },
      'viewport.state.propose': { proposalId: 'proposal:viewport-1' },
      'panel.select': { proposalId: 'proposal:panel-1' },
      'script.log': null,
    }
    return Promise.resolve(results[actionId] ?? null)
  },
}

export async function scriptFixture(
  source: string,
  capabilities: readonly ScriptCapability[] = ['workspace.read'],
): Promise<{
  readonly document: AnalysisScriptDocumentV1
  readonly grant: ScriptPermissionGrantV1
}> {
  const base = {
    schemaVersion: 1 as const,
    kind: 'analysis-script' as const,
    id: 'test-script',
    title: 'Test script',
    language: 'javascript' as const,
    source,
    manifest: {
      scriptApiVersion: 1 as const,
      requestedCapabilities: capabilities,
      pureJsImageCompatibility: '*',
      workbenchCompatibility: '*',
      entrypoint: 'main' as const,
      deterministic: true,
    },
    tests: [],
  }
  const integrity = await scriptContentIntegrity(base)
  return {
    document: { ...base, integrity },
    grant: {
      schemaVersion: 1,
      scriptId: base.id,
      sourceDigest: integrity.digest,
      grantedCapabilities: capabilities,
      deniedCapabilities: [],
    },
  }
}
