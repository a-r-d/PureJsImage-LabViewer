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

const GENERATED_FIXTURE = 'generated.calibrated-materials'

async function script(
  id: string,
  title: string,
  description: string,
  source: string,
  requestedCapabilities: readonly ScriptCapability[],
  expected: AnalysisScriptTestV1['expected'],
): Promise<BuiltInScriptStudioExampleV1> {
  const tests: readonly AnalysisScriptTestV1[] = [
    {
      id: `${id}.generated`,
      title: `${title} generated fixture`,
      fixtureId: GENERATED_FIXTURE,
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
      fixtureId: GENERATED_FIXTURE,
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
  const plan = await lab.analysis.dryRun({ workflow: 'particle', segmentation: 'watershed', fixtureId: '${GENERATED_FIXTURE}' })
  return { workflow: 'watershed-particles', planned: true, plan }
}

globalThis.__scriptMain = main
`,
      ['analysis.dry-run'],
      { workflow: 'watershed-particles', planned: true },
    ),
    await script(
      'builtin.fft-radial-profile',
      'FFT radial-profile script',
      'Plans the calibrated FFT workspace and its radial-profile result.',
      `import { lab } from '@lab/api'

export async function main() {
  const plan = await lab.analysis.dryRun({ workflow: 'fft-radial-profile', radialBins: 128, calibrated: true })
  return { workflow: 'fft-radial-profile', radialBins: 128, plan }
}

globalThis.__scriptMain = main
`,
      ['analysis.dry-run'],
      { workflow: 'fft-radial-profile', radialBins: 128 },
    ),
    await script(
      'builtin.afm-level-roughness',
      'AFM leveling and roughness script',
      'Plans first-order leveling followed by documented Ra, Rq, and Rz measurement.',
      `import { lab } from '@lab/api'

export async function main() {
  const plan = await lab.analysis.dryRun({ workflow: 'afm-level-roughness', correction: 'first-order-plane', metrics: ['Ra', 'Rq', 'Rz'] })
  return { workflow: 'afm-level-roughness', correction: 'first-order-plane', plan }
}

globalThis.__scriptMain = main
`,
      ['analysis.dry-run'],
      { workflow: 'afm-level-roughness', correction: 'first-order-plane' },
    ),
    await script(
      'builtin.batch-measurement',
      'Batch measurement script',
      'Requests a bounded local batch recipe proposal with per-item isolation.',
      `import { lab } from '@lab/api'

export async function main() {
  const proposal = await lab.analysis.requestBatch({ recipeId: 'builtin.particle-count-recipe', concurrency: 2, target: 'selected-local-items' })
  return { workflow: 'batch-measurement', concurrency: 2, proposal }
}

globalThis.__scriptMain = main
`,
      ['analysis.execute'],
      { workflow: 'batch-measurement', concurrency: 2 },
    ),
  ]
}
