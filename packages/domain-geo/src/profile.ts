import type { HeadlessDomainProfile, SourceAdapterKind } from '@pji-workbench/workbench-core'

export const GEO_DOMAIN_ID = 'geo' as const

export interface GeoCommandContext {
  readonly hasDataset: boolean
}

const GEO_CAPABILITIES = Object.freeze({
  localFiles: false,
  remoteHttps: false,
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
  title: 'Geo Workbench',
  description: 'Browser-native geospatial raster showcase on the shared workbench shell.',
  deploymentHostname: 'geo.purejsimage.com',
  readerIds: [],
  sourceAdapters: Object.freeze([] as readonly SourceAdapterKind[]),
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
