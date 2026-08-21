import type { PureJsImageExtension } from 'purejsimage/extensions'

import { advancedMaterialsOperationDefinitions } from './advanced-definitions.js'
import { createAdvancedMaterialsProvider } from './advanced-provider.js'
import { MATERIALS_OPERATION_IDS, TOOLBOX_DOCUMENTATION, TOOLBOX_PRESETS } from './catalog.js'
import { materialsOperationDefinitions } from './definitions.js'
import { createMaterialsAnalysisProvider } from './provider.js'
import { segmentationOperationDefinitions } from './segmentation-definitions.js'
import { createSegmentationAnalysisProvider } from './segmentation-provider.js'

export * from './advanced-definitions.js'
export * from './advanced-provider.js'
export * from './batch.js'
export * from './catalog.js'
export * from './definitions.js'
export * from './dense-dataset.js'
export * from './frequency.js'
export * from './kernels.js'
export * from './measurement.js'
export * from './particle-quality.js'
export * from './particles.js'
export * from './provider.js'
export * from './segmentation.js'
export * from './segmentation-definitions.js'
export * from './segmentation-provider.js'
export * from './stack.js'
export * from './surface.js'

export function createMaterialsAnalysisExtension(): PureJsImageExtension {
  return {
    descriptor: {
      id: 'pji-workbench.materials',
      version: 1,
      apiVersion: 1,
      title: 'PureJsImage Lab core materials toolbox',
      metadata: {
        operationIds: Object.values(MATERIALS_OPERATION_IDS),
        documentationCount: TOOLBOX_DOCUMENTATION.length,
        presetCount: TOOLBOX_PRESETS.length,
      },
    },
    operations: [
      ...materialsOperationDefinitions,
      ...segmentationOperationDefinitions,
      ...advancedMaterialsOperationDefinitions,
    ],
    providers: [
      createMaterialsAnalysisProvider(),
      createSegmentationAnalysisProvider(),
      createAdvancedMaterialsProvider(),
    ],
  }
}
