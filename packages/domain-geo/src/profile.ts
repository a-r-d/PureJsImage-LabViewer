import type { HeadlessDomainProfile, SourceAdapterKind } from '@pji-workbench/workbench-core'

import { type GeoActionContext, geoActionDefinitions } from './actions.js'

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
  automation: Object.freeze({ scripts: false, agent: false }),
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
  workflowRecipes: [],
  actionDefinitions: geoActionDefinitions,
  capabilities: GEO_CAPABILITIES,
  agentPolicy: Object.freeze({
    enabled: false,
    liveModelEnabled: false,
    decisionFor: () => 'deny' as const,
  }),
})

export function createGeoDomainProfile(): HeadlessDomainProfile<GeoActionContext> {
  return geoDomainProfile
}
