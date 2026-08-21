import { describe, expect, it } from 'vitest'

import { actionTrailLabel } from '../src/AgentActionTrail.js'

describe('agent action trail', () => {
  it('labels versioned action ids without dumping the full path', () => {
    expect(actionTrailLabel('analysis.particle.settings.read')).toBe('Settings read')
    expect(actionTrailLabel('analysis.particle.execute')).toBe('Particle execute')
    expect(actionTrailLabel('viewport.preview.create')).toBe('Preview create')
  })
})
