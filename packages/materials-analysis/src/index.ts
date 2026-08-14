import type { PureJsImageExtension } from 'purejsimage/extensions'

import { MATERIALS_OPERATION_IDS, TOOLBOX_DOCUMENTATION, TOOLBOX_PRESETS } from './catalog.js'
import { materialsOperationDefinitions } from './definitions.js'
import { createMaterialsAnalysisProvider } from './provider.js'

export * from './catalog.js'
export * from './definitions.js'
export * from './kernels.js'
export * from './measurement.js'
export * from './provider.js'

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
    operations: materialsOperationDefinitions,
    providers: [createMaterialsAnalysisProvider()],
  }
}
