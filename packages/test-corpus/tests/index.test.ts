import { describe, expect, it } from 'vitest'

import { generatedCorpusDescriptor } from '../src/index.js'

describe('generated corpus foundation', () => {
  it('is deterministic and network independent', () => {
    expect(generatedCorpusDescriptor()).toEqual({
      id: 'generated-materials-shapes-v1',
      tier: 'generated',
      requiresNetwork: false,
    })
  })
})
