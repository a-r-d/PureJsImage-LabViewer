import {
  type AnalysisScriptDocumentV1,
  type AnalysisScriptTestV1,
  type RecipeDocumentV1,
  recipeContentIntegrity,
  type ScriptCapability,
  scriptContentIntegrity,
} from '@pji-workbench/plugin-sdk'

export interface BuiltInScriptStudioExampleV1 {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly artifact: AnalysisScriptDocumentV1 | RecipeDocumentV1
  readonly tests: readonly AnalysisScriptTestV1[]
}

async function script(
  id: string,
  title: string,
  description: string,
  source: string,
  fixtureId: string,
  requestedCapabilities: readonly ScriptCapability[],
  expected: AnalysisScriptTestV1['expected'],
): Promise<BuiltInScriptStudioExampleV1> {
  const tests: readonly AnalysisScriptTestV1[] = [
    {
      id: `${id}.generated`,
      title: `${title} generated fixture`,
      fixtureId,
      expected,
    },
  ]
  const content = {
    schemaVersion: 1 as const,
    kind: 'analysis-script' as const,
    id,
    title,
    description,
    language: 'typescript' as const,
    source,
    manifest: {
      scriptApiVersion: 1 as const,
      requestedCapabilities,
      pureJsImageCompatibility: '^4.0.0',
      workbenchCompatibility: '^0.0.0',
      entrypoint: 'main' as const,
      deterministic: true,
    },
    tests,
  }
  return {
    id,
    title,
    summary: description,
    artifact: { ...content, integrity: await scriptContentIntegrity(content) },
    tests,
  }
}

export async function createBuiltInScriptStudioExamples(): Promise<
  readonly BuiltInScriptStudioExampleV1[]
> {
  const recipeContent = {
    schemaVersion: 1 as const,
    kind: 'recipe' as const,
    id: 'builtin.particle-count-recipe',
    version: '1.0.0',
    title: 'Particle count recipe',
    description: 'A declarative threshold, watershed, and particle-measurement graph proposal.',
    operations: [
      {
        actionId: 'analysis.graph.request-execute',
        actionVersion: 1,
        input: {
          graph: {
            schemaVersion: 1,
            preset: 'particle-count',
            steps: ['threshold', 'watershed', 'measure-particles'],
          },
        },
      },
    ],
    requestedCapabilities: ['analysis.execute'] as const,
    compatibility: { pureJsImage: '^4.0.0', workbench: '^0.0.0' },
  }
  const recipe: RecipeDocumentV1 = {
    ...recipeContent,
    integrity: await recipeContentIntegrity(recipeContent),
  }
  const recipeTests: readonly AnalysisScriptTestV1[] = [
    {
      id: 'builtin.particle-count-recipe.generated',
      title: 'Particle graph remains explicit and versioned',
      fixtureId: 'generated.calibrated-particles',
      expected: { operationCount: 1, actionId: 'analysis.graph.request-execute' },
    },
  ]
  return [
    {
      id: recipe.id,
      title: recipe.title,
      summary: recipe.description ?? '',
      artifact: recipe,
      tests: recipeTests,
    },
    await script(
      'builtin.watershed-particles',
      'Watershed particle script',
      'Plans shared segmentation and watershed separation without bypassing execution approval.',
      `import { lab } from '@lab/api'

export async function main() {
  const plan = await lab.analysis.dryRun({ workflow: 'particle', segmentation: 'watershed', fixtureId: 'generated.touching-particles' })
  return { workflow: 'watershed-particles', planned: true, plan }
}

globalThis.__scriptMain = main
`,
      'generated.touching-particles',
      ['analysis.dry-run'],
      { workflow: 'watershed-particles', planned: true },
    ),
    await script(
      'builtin.fft-radial-profile',
      'FFT radial-profile script',
      'Plans the calibrated FFT workspace and its radial-profile result.',
      `import { lab } from '@lab/api'

export async function main() {
  const plan = await lab.analysis.dryRun({ workflow: 'fft-radial-profile', radialBins: 128, calibrated: true, fixtureId: 'generated.periodic-lattice' })
  return { workflow: 'fft-radial-profile', radialBins: 128, plan }
}

globalThis.__scriptMain = main
`,
      'generated.periodic-lattice',
      ['analysis.dry-run'],
      { workflow: 'fft-radial-profile', radialBins: 128 },
    ),
    await script(
      'builtin.afm-level-roughness',
      'AFM leveling and roughness script',
      'Plans first-order leveling followed by documented Ra, Rq, and Rz measurement.',
      `import { lab } from '@lab/api'

export async function main() {
  const plan = await lab.analysis.dryRun({ workflow: 'afm-level-roughness', correction: 'first-order-plane', metrics: ['Ra', 'Rq', 'Rz'], fixtureId: 'generated.afm-tilted-surface' })
  return { workflow: 'afm-level-roughness', correction: 'first-order-plane', plan }
}

globalThis.__scriptMain = main
`,
      'generated.afm-tilted-surface',
      ['analysis.dry-run'],
      { workflow: 'afm-level-roughness', correction: 'first-order-plane' },
    ),
    await script(
      'builtin.real-ecoli-components',
      'Real E. coli segmentation review',
      'Documents the bounded threshold and connected-components preset applied to the bundled CDC SEM image.',
      `import { lab } from '@lab/api'

export async function main() {
  const plan = await lab.analysis.dryRun({ workflow: 'connected-components', threshold: 46260, mode: 'greater-than', connectivity: 8, component: 0, fixtureId: 'cdc.ecoli-sem' })
  return { workflow: 'real-ecoli-components', threshold: 46260, connectivity: 8, plan }
}

globalThis.__scriptMain = main
`,
      'cdc.ecoli-sem',
      ['analysis.dry-run'],
      { workflow: 'real-ecoli-components', threshold: 46_260, connectivity: 8 },
    ),
    await script(
      'builtin.real-staph-components',
      'Real S. aureus JPEG segmentation review',
      'Documents the bounded threshold and connected-components preset applied to the original CDC Staphylococcus SEM JPEG.',
      `import { lab } from '@lab/api'

export async function main() {
  const plan = await lab.analysis.dryRun({ workflow: 'connected-components', threshold: 128, mode: 'greater-than', connectivity: 8, component: 0, fixtureId: 'cdc.staph-aureus-sem' })
  return { workflow: 'real-staph-components', threshold: 128, connectivity: 8, plan }
}

globalThis.__scriptMain = main
`,
      'cdc.staph-aureus-sem',
      ['analysis.dry-run'],
      { workflow: 'real-staph-components', threshold: 128, connectivity: 8 },
    ),
    await script(
      'builtin.real-image-inspection',
      'Real micrograph inspection',
      'Plans an ROI-first inspection without inventing calibration absent from the source file.',
      `import { lab } from '@lab/api'

export async function main() {
  const plan = await lab.analysis.dryRun({ workflow: 'roi-inspection', calibrated: false, fixtureId: 'nih.hela-cells-3709' })
  return { workflow: 'real-image-inspection', calibrated: false, plan }
}

globalThis.__scriptMain = main
`,
      'nih.hela-cells-3709',
      ['analysis.dry-run'],
      { workflow: 'real-image-inspection', calibrated: false },
    ),
    await script(
      'builtin.real-hhv6-histogram',
      'Real TEM intensity histogram',
      'Documents the bounded whole-plane histogram applied to the bundled HHV-6 TEM image.',
      `import { lab } from '@lab/api'

export async function main() {
  const plan = await lab.analysis.dryRun({ workflow: 'histogram', bins: 64, component: 0, fixtureId: 'nci.hhv6-em' })
  return { workflow: 'real-hhv6-histogram', bins: 64, component: 0, plan }
}

globalThis.__scriptMain = main
`,
      'nci.hhv6-em',
      ['analysis.dry-run'],
      { workflow: 'real-hhv6-histogram', bins: 64, component: 0 },
    ),
    await script(
      'builtin.stack-mean-projection',
      'Stack mean-projection script',
      'Plans a mean projection along the generated eight-plane drifting stack.',
      `import { lab } from '@lab/api'

export async function main() {
  const plan = await lab.analysis.dryRun({ workflow: 'stack-mean-projection', mode: 'mean', fixtureId: 'generated.drifting-stack' })
  return { workflow: 'stack-mean-projection', frames: 8, plan }
}

globalThis.__scriptMain = main
`,
      'generated.drifting-stack',
      ['analysis.dry-run'],
      { workflow: 'stack-mean-projection', frames: 8 },
    ),
    await script(
      'builtin.batch-measurement',
      'Batch measurement script',
      'Requests a bounded local batch recipe proposal with per-item isolation.',
      `import { lab } from '@lab/api'

export async function main() {
  const proposal = await lab.analysis.requestBatch({ recipeId: 'builtin.particle-count-recipe', concurrency: 2, target: 'selected-local-items', fixtureId: 'generated.batch-particles' })
  return { workflow: 'batch-measurement', concurrency: 2, proposal }
}

globalThis.__scriptMain = main
`,
      'generated.batch-particles',
      ['analysis.execute'],
      { workflow: 'batch-measurement', concurrency: 2 },
    ),
  ]
}
