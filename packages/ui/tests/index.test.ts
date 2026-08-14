import { describe, expect, it } from 'vitest'

import { formatWorkbenchStatus } from '../src/index.js'

describe('workbench status formatting', () => {
  it('provides a complete accessible phrase', () => {
    expect(formatWorkbenchStatus('ready')).toBe('Workbench status: ready')
  })
})
