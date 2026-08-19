import { createBuiltInScriptStudioExamples } from '@pji-workbench/scripts/examples'
import { enabledExampleScenarios } from '@pji-workbench/test-corpus'
import { describe, expect, it } from 'vitest'

import {
  filterExampleScenarios,
  RECENT_EXAMPLES_KEY,
  readRecentExampleIds,
  rememberRecentExample,
} from '../src/features/examples/ExampleGallery.js'

class MemoryStorage {
  readonly #values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value)
  }
}

describe('example gallery model', () => {
  it('resolves every enabled workflow to a tested Script Studio artifact', async () => {
    const builtIns = await createBuiltInScriptStudioExamples()
    const byId = new Map(builtIns.map((example) => [example.id, example]))
    for (const scenario of enabledExampleScenarios()) {
      for (const workflow of scenario.workflows) {
        expect(byId.has(workflow.artifactId)).toBe(true)
        const artifact = byId.get(workflow.artifactId)
        expect(artifact?.tests.length).toBeGreaterThan(0)
        expect(artifact?.tests.every(({ fixtureId }) => fixtureId === scenario.id)).toBe(true)
        expect(workflow.expected.length).toBeGreaterThan(0)
      }
    }
  })

  it('searches scientific metadata and combines explicit filters', () => {
    const scenarios = enabledExampleScenarios()
    expect(
      filterExampleScenarios(scenarios, {
        query: 'radial peaks',
        modality: '',
        format: '',
        vendor: '',
        task: '',
        size: '',
      }).map(({ id }) => id),
    ).toEqual(['generated.periodic-lattice'])
    expect(
      filterExampleScenarios(scenarios, {
        query: '',
        modality: 'AFM (synthetic)',
        format: 'GSF',
        vendor: 'PureJsImage Lab generator',
        task: 'roughness',
        size: 'tiny',
      }).map(({ id }) => id),
    ).toEqual(['generated.afm-tilted-surface'])
  })

  it('persists bounded, deduplicated recent example identities without source bytes', () => {
    const storage = new MemoryStorage()
    let current: readonly string[] = []
    for (let index = 0; index < 8; index += 1)
      current = rememberRecentExample(storage, current, `generated.example-${index}`)
    current = rememberRecentExample(storage, current, 'generated.example-5')
    expect(readRecentExampleIds(storage)).toEqual([
      'generated.example-5',
      'generated.example-7',
      'generated.example-6',
      'generated.example-4',
      'generated.example-3',
      'generated.example-2',
    ])
    expect(storage.getItem(RECENT_EXAMPLES_KEY)).not.toContain('sourceBytes')
  })

  it('recovers safely from malformed recent metadata', () => {
    const storage = new MemoryStorage()
    storage.setItem(RECENT_EXAMPLES_KEY, '{not-json')
    expect(readRecentExampleIds(storage)).toEqual([])
  })
})
