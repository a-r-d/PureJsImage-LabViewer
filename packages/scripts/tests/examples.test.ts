import { validateAnalysisScriptDocument, validateRecipeDocument } from '@pji-workbench/plugin-sdk'
import { describe, expect, it } from 'vitest'
import { createBuiltInScriptStudioExamples } from '../src/examples.js'
import { SCRIPT_API_ENDPOINTS } from '../src/index.js'

describe('Script Studio built-in examples', () => {
  it('ships five integrity-checked examples with deterministic fixtures', async () => {
    const examples = await createBuiltInScriptStudioExamples()
    expect(examples.map(({ id }) => id)).toEqual([
      'builtin.particle-count-recipe',
      'builtin.watershed-particles',
      'builtin.fft-radial-profile',
      'builtin.afm-level-roughness',
      'builtin.batch-measurement',
    ])
    expect(examples.map(({ tests }) => tests[0]?.fixtureId)).toEqual([
      'generated.calibrated-particles',
      'generated.touching-particles',
      'generated.periodic-lattice',
      'generated.afm-tilted-surface',
      'generated.batch-particles',
    ])
    for (const example of examples) {
      const validation =
        example.artifact.kind === 'recipe'
          ? validateRecipeDocument(example.artifact)
          : validateAnalysisScriptDocument(example.artifact)
      expect(validation.issues, example.id).toEqual([])
      expect(example.tests.length).toBeGreaterThan(0)
      expect(example.tests.every(({ fixtureId }) => fixtureId.startsWith('generated.'))).toBe(true)
    }
  })

  it('exposes only semantic registry-backed endpoints for the complete v1 workflow', () => {
    expect(SCRIPT_API_ENDPOINTS.map(({ api }) => api)).toEqual(
      expect.arrayContaining([
        'datasets.describe',
        'rois.create',
        'rois.update',
        'analysis.execute',
        'analysis.requestBatch',
        'analysis.cancel',
        'results.getPage',
        'pipeline.get',
        'export.proposeCsv',
        'viewport.proposeState',
      ]),
    )
    expect(SCRIPT_API_ENDPOINTS.every(({ actionId }) => !actionId.includes('raw'))).toBe(true)
  })
})
