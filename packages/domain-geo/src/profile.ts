import type { HeadlessDomainProfile, SourceAdapterKind } from '@pji-workbench/workbench-core'

import { type GeoActionContext, geoActionDefinitions } from './actions.js'
import { GEO_WORKFLOW_RECIPES } from './workflows.js'

type GeoAgentPermission = Parameters<
  HeadlessDomainProfile<GeoActionContext>['agentPolicy']['decisionFor']
>[0]

export const GEO_DOMAIN_ID = 'geo' as const
export const GEO_READER_IDS = Object.freeze(['purejsimage/tiff'] as const)
export const GEO_FILE_ACCEPT = '.tif,.tiff,.cog'

const GEO_CAPABILITIES = Object.freeze({
  sources: Object.freeze({
    localFiles: true,
    remoteHttps: true,
    generatedSamples: false,
    bundledExamples: false,
    catalogs: true,
  }),
  automation: Object.freeze({ scripts: false, agent: true }),
  analysis: Object.freeze({
    particle: false,
    materials: false,
    batch: false,
    fft: false,
    surface: false,
    stack: false,
  }),
  workspace: Object.freeze({ projectPersistence: true }),
})

export const geoDomainProfile: HeadlessDomainProfile<GeoActionContext> = Object.freeze({
  id: GEO_DOMAIN_ID,
  title: 'PureJsImage Atlas',
  description: 'Search STAC catalogs and inspect Cloud Optimized GeoTIFFs in their native CRS.',
  deploymentHostname: 'geo.purejsimage.com',
  readerIds: GEO_READER_IDS,
  sourceAdapters: Object.freeze(['local', 'remote'] as readonly SourceAdapterKind[]),
  exampleScenarioIds: [],
  workflowRecipes: GEO_WORKFLOW_RECIPES,
  actionDefinitions: geoActionDefinitions,
  capabilities: GEO_CAPABILITIES,
  agentPolicy: Object.freeze({
    enabled: true,
    liveModelEnabled: true,
    decisionFor: (permission: GeoAgentPermission) =>
      permission === 'workspace.read' || permission === 'source.read-metadata'
        ? ('allow' as const)
        : ('require-approval' as const),
  }),
})

export function createGeoDomainProfile(): HeadlessDomainProfile<GeoActionContext> {
  return geoDomainProfile
}
