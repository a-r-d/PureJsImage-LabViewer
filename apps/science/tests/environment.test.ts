import { describe, expect, it } from 'vitest'

import { readPublicEnvironment } from '../src/environment.js'

describe('public environment validation', () => {
  it('defaults to production without reading unrelated environment values', () => {
    expect(readPublicEnvironment({ VITE_UNRELATED: 'ignored' })).toEqual({
      appEnvironment: 'production',
    })
  })

  it('rejects invalid public configuration', () => {
    expect(() => readPublicEnvironment({ VITE_APP_ENV: 'secret' })).toThrow(
      'VITE_APP_ENV must be development, test, or production',
    )
  })
})
