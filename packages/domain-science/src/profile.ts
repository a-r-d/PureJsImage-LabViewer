import type { HeadlessDomainProfile } from '@pji-workbench/workbench-core'

import { type CommandContext, scienceActionDefinitions } from './actions.js'
import { SCIENCE_WORKFLOW_RECIPES, scienceAgentPolicy } from './workflows.js'

export const SCIENCE_DOMAIN_ID = 'science' as const

export const SCIENCE_READER_IDS = Object.freeze([
  'purejsimage/png',
  'purejsimage/jpeg',
  'purejsimage/webp',
  'purejsimage/bmp',
  'purejsimage/jp2',
  'purejsimage/tiff',
  'purejsimage/ome-tiff',
  'purejsimage/aperio-svs',
  'purejsimage/digital-micrograph',
  'purejsimage/tia-ser',
  'purejsimage/tia-emi',
  'purejsimage/ncem-emd',
  'purejsimage/velox-emd',
  'purejsimage/blockfile',
  'purejsimage/mib',
  'purejsimage/gsf',
  'purejsimage/nanonis-sxm',
  'purejsimage/igor-binary-wave',
  'purejsimage/digital-surf',
  'purejsimage/x3p',
  'purejsimage/mrc',
  'purejsimage/nrrd',
  'purejsimage/meta-image',
  'purejsimage/nifti',
  'purejsimage/envi',
  'purejsimage/fits',
  'purejsimage/cbf',
  'purejsimage/rpl',
  'purejsimage/emsa',
  'purejsimage/ebsd-text',
  'purejsimage/npy',
])

export const SCIENCE_EXAMPLE_SCENARIO_IDS = Object.freeze([
  'generated.calibrated-particles',
  'generated.touching-particles',
  'generated.periodic-lattice',
  'generated.afm-tilted-surface',
  'generated.batch-particles',
  'generated.drifting-stack',
  'cdc.ecoli-sem',
  'cdc.staph-aureus-sem',
  'nih.hela-cells-3709',
  'nci.hhv6-em',
])

export const scienceDomainProfile: HeadlessDomainProfile<CommandContext> = Object.freeze({
  id: SCIENCE_DOMAIN_ID,
  title: 'Materials Workbench',
  description:
    'Browser-native, local-first scientific imaging workbench for electron microscopy and adjacent engineering imagery.',
  deploymentHostname: 'lab.purejsimage.com',
  readerIds: SCIENCE_READER_IDS,
  sourceAdapters: Object.freeze(['local', 'remote', 'sample', 'bundled'] as const),
  exampleScenarioIds: SCIENCE_EXAMPLE_SCENARIO_IDS,
  workflowRecipes: SCIENCE_WORKFLOW_RECIPES,
  actionDefinitions: scienceActionDefinitions,
  capabilities: Object.freeze({
    localFiles: true,
    remoteHttps: true,
    generatedSamples: true,
    bundledExamples: true,
    scripts: true,
    agent: true,
    particleAnalysis: true,
    materialsToolbox: true,
    batch: true,
    fft: true,
    surface: true,
    stack: true,
    projectPersistence: true,
  }),
  agentPolicy: scienceAgentPolicy,
})

export function createScienceDomainProfile(): HeadlessDomainProfile<CommandContext> {
  return scienceDomainProfile
}
