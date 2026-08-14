export const GENERATED_CORPUS_ID = 'generated-materials-shapes-v1' as const

export interface GeneratedCorpusDescriptor {
  readonly id: typeof GENERATED_CORPUS_ID
  readonly tier: 'generated'
  readonly requiresNetwork: false
}

export function generatedCorpusDescriptor(): GeneratedCorpusDescriptor {
  return { id: GENERATED_CORPUS_ID, tier: 'generated', requiresNetwork: false }
}
