import { describe, expect, it } from 'vitest'

import { ActivityController } from '../src/index.js'

describe('activity controller', () => {
  it('increments source generation only after a successful open', () => {
    const activity = new ActivityController()
    const first = activity.startOpen()
    expect(first.generation).toBe(1)
    expect(activity.generation).toBe(0)
    activity.completeOpen(first.generation)
    expect(activity.generation).toBe(1)
    const second = activity.startOpen()
    expect(second.generation).toBe(2)
    expect(second.signal.aborted).toBe(false)
    activity.cancelOpen()
    expect(second.signal.aborted).toBe(true)
  })

  it('cancels the previous analysis when a new one starts', () => {
    const activity = new ActivityController()
    const first = activity.startAnalysis('first')
    const second = activity.startAnalysis('Superseded')
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
    activity.cancelAnalysis('Cancelled by semantic action.')
    expect(second.signal.aborted).toBe(true)
    activity.clearAnalysis()
    expect(activity.analysis).toBeUndefined()
  })
})
