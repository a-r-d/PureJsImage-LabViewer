import type {
  ActionCapabilityManifestV1,
  JsonValue,
  WorkbenchActionDescriptorV1,
} from '@pji-workbench/actions'
import type { ScriptCapability } from '@pji-workbench/plugin-sdk'

export interface ScriptApiEndpointV1 {
  readonly api: string
  readonly actionId: string
  readonly actionVersion: number
  readonly permission: ScriptCapability
  readonly mode: 'dry-run' | 'execute'
  readonly description: string
}

export interface GeneratedScriptApiV1 {
  readonly schemaVersion: 1
  readonly scriptApiVersion: 1
  readonly endpoints: readonly ScriptApiEndpointV1[]
  readonly declaration: string
  readonly moduleSource: string
}

export const SCRIPT_API_ENDPOINTS: readonly Omit<ScriptApiEndpointV1, 'description'>[] = [
  {
    api: 'workspace.getSummary',
    actionId: 'workspace.summary.read',
    actionVersion: 1,
    permission: 'workspace.read',
    mode: 'execute',
  },
  {
    api: 'sources.list',
    actionId: 'source.list',
    actionVersion: 1,
    permission: 'source.read-metadata',
    mode: 'execute',
  },
  {
    api: 'datasets.list',
    actionId: 'dataset.list',
    actionVersion: 1,
    permission: 'dataset.read-descriptor',
    mode: 'execute',
  },
  {
    api: 'datasets.describe',
    actionId: 'dataset.describe',
    actionVersion: 1,
    permission: 'dataset.read-descriptor',
    mode: 'execute',
  },
  {
    api: 'rois.list',
    actionId: 'roi.list',
    actionVersion: 1,
    permission: 'roi.read',
    mode: 'execute',
  },
  {
    api: 'rois.propose',
    actionId: 'roi.create',
    actionVersion: 1,
    permission: 'roi.propose',
    mode: 'dry-run',
  },
  {
    api: 'analysis.catalog',
    actionId: 'analysis.catalog.read',
    actionVersion: 1,
    permission: 'analysis.catalog',
    mode: 'execute',
  },
  {
    api: 'analysis.describe',
    actionId: 'analysis.describe',
    actionVersion: 1,
    permission: 'analysis.catalog',
    mode: 'execute',
  },
  {
    api: 'analysis.normalize',
    actionId: 'analysis.normalize',
    actionVersion: 1,
    permission: 'analysis.dry-run',
    mode: 'execute',
  },
  {
    api: 'analysis.dryRun',
    actionId: 'analysis.dry-run',
    actionVersion: 1,
    permission: 'analysis.dry-run',
    mode: 'dry-run',
  },
  {
    api: 'analysis.requestExecute',
    actionId: 'analysis.request-execute',
    actionVersion: 1,
    permission: 'analysis.execute',
    mode: 'dry-run',
  },
  {
    api: 'results.summarize',
    actionId: 'result.summary.read',
    actionVersion: 1,
    permission: 'result.read-summary',
    mode: 'execute',
  },
  {
    api: 'results.getPage',
    actionId: 'result.page.read',
    actionVersion: 1,
    permission: 'result.read-page',
    mode: 'execute',
  },
  {
    api: 'viewport.getState',
    actionId: 'viewport.state.read',
    actionVersion: 1,
    permission: 'viewport.read',
    mode: 'execute',
  },
  {
    api: 'viewport.proposeState',
    actionId: 'viewport.state.propose',
    actionVersion: 1,
    permission: 'viewport.propose',
    mode: 'dry-run',
  },
  {
    api: 'ui.proposeOpenPanel',
    actionId: 'panel.select',
    actionVersion: 1,
    permission: 'ui.propose',
    mode: 'dry-run',
  },
  {
    api: 'log',
    actionId: 'script.log',
    actionVersion: 1,
    permission: 'workspace.read',
    mode: 'execute',
  },
]

function descriptorMap(
  manifest: ActionCapabilityManifestV1,
): ReadonlyMap<string, WorkbenchActionDescriptorV1> {
  return new Map(
    manifest.actions.map((descriptor) => [`${descriptor.id}@${descriptor.version}`, descriptor]),
  )
}

function moduleSource(): string {
  const tree: Record<string, JsonValue> = {}
  for (const endpoint of SCRIPT_API_ENDPOINTS) {
    const [namespace, method] = endpoint.api.includes('.')
      ? endpoint.api.split('.', 2)
      : ['root', endpoint.api]
    if (namespace === undefined || method === undefined) continue
    const group = (tree[namespace] ?? {}) as Record<string, JsonValue>
    group[method] = endpoint.api
    tree[namespace] = group
  }
  const groups = Object.entries(tree)
    .filter(([namespace]) => namespace !== 'root')
    .map(([namespace, methods]) => {
      const entries = Object.entries(methods as Record<string, JsonValue>)
        .map(
          ([method, api]) =>
            `${JSON.stringify(method)}: (input = {}) => call(${JSON.stringify(api)}, input)`,
        )
        .join(',')
      return `${JSON.stringify(namespace)}: Object.freeze({${entries}})`
    })
    .join(',')
  const rootLog = SCRIPT_API_ENDPOINTS.some(({ api }) => api === 'log')
    ? `${groups === '' ? '' : ','}log: (input = {}) => call('log', input)`
    : ''
  return `const call = (api, input) => { const encoded = JSON.stringify(input); if (typeof encoded !== 'string') throw new Error('Capability input must be JSON serializable.'); return globalThis.__labCall(api, encoded); }; export const lab = Object.freeze({${groups}${rootLog}}); export default lab;`
}

function declaration(endpoints: readonly ScriptApiEndpointV1[]): string {
  const groups = new Map<string, string[]>()
  for (const { api } of endpoints) {
    const [namespace, method] = api.includes('.') ? api.split('.', 2) : ['root', api]
    if (namespace === undefined || method === undefined) continue
    const methods = groups.get(namespace) ?? []
    methods.push(method)
    groups.set(namespace, methods)
  }
  const fields = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([namespace, methods]) => {
      if (namespace === 'root')
        return methods
          .sort()
          .map(
            (method) =>
              `    readonly ${method}: (input?: Readonly<Record<string, unknown>>) => Promise<unknown>`,
          )
          .join('\n')
      return `    readonly ${namespace}: {\n${methods
        .sort()
        .map(
          (method) =>
            `      readonly ${method}: (input?: Readonly<Record<string, unknown>>) => Promise<unknown>`,
        )
        .join('\n')}\n    }`
    })
    .join('\n')
  return `declare module '@lab/api' {\n  export interface LabApi {\n${fields}\n  }\n  export const lab: LabApi\n  export default lab\n}`
}

export function generateScriptApi(manifest: ActionCapabilityManifestV1): GeneratedScriptApiV1 {
  const descriptors = descriptorMap(manifest)
  const endpoints = SCRIPT_API_ENDPOINTS.map((endpoint) => {
    const descriptor = descriptors.get(`${endpoint.actionId}@${endpoint.actionVersion}`)
    if (descriptor === undefined)
      throw new Error(
        `Script API action is missing: ${endpoint.actionId}@${endpoint.actionVersion}`,
      )
    if (!descriptor.permissions.includes(endpoint.permission))
      throw new Error(`Script API permission mismatch: ${endpoint.api}`)
    return { ...endpoint, description: descriptor.description }
  })
  return {
    schemaVersion: 1,
    scriptApiVersion: 1,
    endpoints: Object.freeze(endpoints),
    declaration: declaration(endpoints),
    moduleSource: moduleSource(),
  }
}

export function findScriptEndpoint(
  api: GeneratedScriptApiV1,
  name: string,
): ScriptApiEndpointV1 | undefined {
  return api.endpoints.find((endpoint) => endpoint.api === name)
}

export function parseGeneratedScriptApi(value: unknown): GeneratedScriptApiV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Malformed generated script API.')
  const candidate = value as Partial<GeneratedScriptApiV1>
  if (
    candidate.schemaVersion !== 1 ||
    candidate.scriptApiVersion !== 1 ||
    !Array.isArray(candidate.endpoints) ||
    typeof candidate.declaration !== 'string' ||
    typeof candidate.moduleSource !== 'string'
  )
    throw new Error('Malformed generated script API.')
  for (const endpoint of candidate.endpoints) {
    if (
      typeof endpoint !== 'object' ||
      endpoint === null ||
      typeof endpoint.api !== 'string' ||
      typeof endpoint.actionId !== 'string' ||
      endpoint.actionVersion !== 1 ||
      (endpoint.mode !== 'execute' && endpoint.mode !== 'dry-run')
    )
      throw new Error('Malformed generated script API endpoint.')
  }
  return candidate as GeneratedScriptApiV1
}
