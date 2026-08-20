import { describe, expect, it, vi } from 'vitest'

import { DisplayTileCache } from '../src/display-tile-cache.js'

describe('DisplayTileCache', () => {
  it('evicts deterministically by LRU and disposes resources', () => {
    const dispose = vi.fn()
    const cache = new DisplayTileCache<string>(8, 2)
    cache.set('a', { value: 'a', bytes: 4, dispose })
    cache.set('b', { value: 'b', bytes: 4, dispose })
    expect(cache.get('a')).toBe('a')
    cache.set('c', { value: 'c', bytes: 4, dispose })
    expect(cache.peek('a')).toBe('a')
    expect(cache.peek('b')).toBeUndefined()
    expect(cache.peek('c')).toBe('c')
    expect(dispose).toHaveBeenCalledWith('b')
    expect(cache.diagnostics()).toMatchObject({ bytes: 8, tiles: 2, evictions: 1, hits: 1 })
  })

  it('never exceeds byte or tile budgets and protects required tiles when possible', () => {
    const cache = new DisplayTileCache<string>(10, 2)
    const dispose = () => undefined
    cache.set('required', { value: 'required', bytes: 5, dispose })
    cache.set('old', { value: 'old', bytes: 4, dispose })
    cache.set('new', { value: 'new', bytes: 5, dispose }, new Set(['required']))
    expect(cache.peek('required')).toBe('required')
    expect(cache.peek('old')).toBeUndefined()
    expect(cache.diagnostics()).toMatchObject({ bytes: 10, tiles: 2 })
  })
})
