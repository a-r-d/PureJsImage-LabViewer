import { describe, expect, it } from 'vitest'

import { PUREJSIMAGE_PACKAGE_VERSION } from '../src/index.js'

describe('PureJsImage package boundary', () => {
  it('pins the published scientific runtime contract', () => {
    expect(PUREJSIMAGE_PACKAGE_VERSION).toBe('0.10.0')
  })
})
