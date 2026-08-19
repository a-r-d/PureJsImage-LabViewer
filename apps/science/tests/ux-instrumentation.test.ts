import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { beginUxTask, initializeUxInstrumentation } from '../src/ux-instrumentation.js'

describe('test-only UX instrumentation', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {})
  })

  afterEach(() => {
    initializeUxInstrumentation(false)
    vi.unstubAllGlobals()
  })

  it('does not expose or record UX metrics when disabled', () => {
    initializeUxInstrumentation(false)
    const finish = beginUxTask('source.open')
    finish()
    expect(Reflect.has(window, '__PJI_UX_METRICS__')).toBe(false)
  })

  it('records bounded, idempotent duration events when explicitly enabled', () => {
    initializeUxInstrumentation(true)
    for (let index = 0; index < 300; index += 1) {
      const finish = beginUxTask(`task.${index}`)
      finish()
      finish()
    }
    expect(window.__PJI_UX_METRICS__?.events).toHaveLength(256)
    expect(window.__PJI_UX_METRICS__?.events.at(-1)).toMatchObject({
      kind: 'task',
      name: 'task.299',
    })
  })
})
