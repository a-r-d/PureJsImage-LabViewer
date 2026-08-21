import { describe, expect, it } from 'vitest'

import { actionApprovalPrompt, actionTrailLabel } from '../src/AgentActionTrail.js'

describe('agent action trail', () => {
  it('labels versioned action ids without dumping the full path', () => {
    expect(actionTrailLabel('analysis.particle.settings.read')).toBe('Settings read')
    expect(actionTrailLabel('analysis.particle.execute')).toBe('Particle execute')
    expect(actionTrailLabel('viewport.preview.create')).toBe('Preview create')
  })

  it('asks for approval in one short line', () => {
    expect(actionApprovalPrompt('analysis.particle.execute')).toBe('Run particle analysis?')
    expect(actionApprovalPrompt('viewport.preview.create')).toBe('Create viewport preview?')
  })
})
