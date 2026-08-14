import { describe, expect, it } from 'vitest'

import { defaultAgentDecision } from '../src/index.js'

describe('agent policy foundation', () => {
  it('allows bounded reads and gates side effects', () => {
    expect(defaultAgentDecision('workspace.read')).toBe('allow')
    expect(defaultAgentDecision('analysis.execute')).toBe('require-approval')
  })
})
