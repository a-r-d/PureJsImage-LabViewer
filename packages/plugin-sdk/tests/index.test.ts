import { describe, expect, it } from 'vitest'

import { isDeclarativeRecipe } from '../src/index.js'

describe('plugin manifest foundation', () => {
  it('distinguishes non-executable recipes', () => {
    expect(
      isDeclarativeRecipe({
        schemaVersion: 1,
        id: 'example',
        version: '1.0.0',
        entryKind: 'recipe',
      }),
    ).toBe(true)
  })
})
