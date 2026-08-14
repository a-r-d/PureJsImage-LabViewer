import { describe, expect, it } from 'vitest'

import { createEmptyWorkspace } from '../src/index.js'

describe('empty workspace', () => {
  it('starts at revision zero without runtime handles', () => {
    expect(createEmptyWorkspace()).toEqual({
      schemaVersion: 1,
      revision: 0,
      title: 'Untitled project',
    })
  })
})
