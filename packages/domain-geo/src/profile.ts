import type { HeadlessDomainProfile, SourceAdapterKind } from '@pji-workbench/workbench-core'

export const GEO_DOMAIN_ID = 'geo' as const
export const GEO_READER_IDS = Object.freeze(['purejsimage/tiff'] as const)
export const GEO_FILE_ACCEPT = '.tif,.tiff,.cog'

export interface GeoCommandContext {
  readonly hasDataset: boolean
}

const GEO_CAPABILITIES = Object.freeze({
  localFiles: true,
  remoteHttps: true,
  generatedSamples: false,
  bundledExamples: false,
  scripts: false,
  agent: false,
  particleAnalysis: false,
  materialsToolbox: false,
  batch: false,
  fft: false,
  surface: false,
  stack: false,
  projectPersistence: false,
})

export const geoDomainProfile: HeadlessDomainProfile<GeoCommandContext> = Object.freeze({
  id: GEO_DOMAIN_ID,
  title: 'PureJsImage Atlas',
  description: 'Open a local or remote Cloud Optimized GeoTIFF and inspect it in its native CRS.',
  deploymentHostname: 'geo.purejsimage.com',
  readerIds: GEO_READER_IDS,
  sourceAdapters: Object.freeze(['local', 'remote'] as readonly SourceAdapterKind[]),
  exampleScenarioIds: [],
  workflowRecipes: [],
  actionDefinitions: [],
  capabilities: GEO_CAPABILITIES,
  agentPolicy: Object.freeze({
    enabled: false,
    liveModelEnabled: false,
    decisionFor: () => 'deny' as const,
  }),
})

export function createGeoDomainProfile(): HeadlessDomainProfile<GeoCommandContext> {
  return geoDomainProfile
}
