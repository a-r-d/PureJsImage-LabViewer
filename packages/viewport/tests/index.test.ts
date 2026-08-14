import { describe, expect, it } from 'vitest'

import { translateCamera } from '../src/index.js'

describe('camera math', () => {
  it('translates without mutating the input point', () => {
    const point = { x: 4, y: -2 }
    expect(translateCamera(point, { x: 3, y: 5 })).toEqual({ x: 7, y: 3 })
    expect(point).toEqual({ x: 4, y: -2 })
  })
})
