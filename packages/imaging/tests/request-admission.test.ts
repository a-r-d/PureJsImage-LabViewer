import { describe, expect, it } from 'vitest'

import { inFlightAdmissionLimit } from '../src/worker-host/resources.js'

describe('imaging Worker request admission', () => {
  it('reserves capacity for foreground analysis while viewport tiles are loading', () => {
    expect(inFlightAdmissionLimit('tile.request', 32)).toBe(28)
    expect(inFlightAdmissionLimit('display.tile.request', 32)).toBe(28)
    expect(inFlightAdmissionLimit('analysis.overlay-tile', 32)).toBe(28)
    expect(inFlightAdmissionLimit('analysis.dry-run', 32)).toBe(32)
    expect(inFlightAdmissionLimit('analysis.execute', 32)).toBe(32)
  })

  it('still admits one render request under a minimal test budget', () => {
    expect(inFlightAdmissionLimit('tile.request', 1)).toBe(1)
  })
})
