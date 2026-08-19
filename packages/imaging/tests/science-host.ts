import {
  createMaterialsAnalysisExtension,
  TOOLBOX_DOCUMENTATION,
  TOOLBOX_PRESETS,
} from '@pji-workbench/materials-analysis'

import { ImagingWorkerHost, type ImagingWorkerHostOptions } from '../src/index.js'

export function createScienceImagingWorkerHost(
  options: ImagingWorkerHostOptions = {},
): ImagingWorkerHost {
  return new ImagingWorkerHost({
    ...options,
    analysisExtensions: [createMaterialsAnalysisExtension(), ...(options.analysisExtensions ?? [])],
    analysisCatalog: options.analysisCatalog ?? {
      documentation: TOOLBOX_DOCUMENTATION,
      presets: TOOLBOX_PRESETS,
    },
  })
}
