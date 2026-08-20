import { describe, expect, it } from 'vitest'

import {
  BrowserOpenRouterCredentialStore,
  SCIENCE_AGENT_KEY_STORAGE,
} from '../src/features/agent/science-agent-credentials.js'

class TestStorage implements Storage {
  readonly #values = new Map<string, string>()

  get length(): number {
    return this.#values.size
  }

  clear(): void {
    this.#values.clear()
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.#values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value)
  }
}

describe('science agent credential store', () => {
  it('restores and explicitly removes a validated browser credential', () => {
    const storage = new TestStorage()
    const first = new BrowserOpenRouterCredentialStore(storage)
    first.set('  sk-or-browser-fixture  ')

    expect(storage.getItem(SCIENCE_AGENT_KEY_STORAGE)).toBe('sk-or-browser-fixture')
    const restored = new BrowserOpenRouterCredentialStore(storage)
    expect(restored.persistence).toBe('browser')
    expect(restored.get()).toBe('sk-or-browser-fixture')

    restored.clear()
    expect(restored.has()).toBe(false)
    expect(storage.getItem(SCIENCE_AGENT_KEY_STORAGE)).toBeNull()
  })

  it('rejects invalid persisted and newly supplied values', () => {
    const storage = new TestStorage()
    storage.setItem(SCIENCE_AGENT_KEY_STORAGE, 'short')
    const store = new BrowserOpenRouterCredentialStore(storage)

    expect(store.has()).toBe(false)
    expect(storage.getItem(SCIENCE_AGENT_KEY_STORAGE)).toBeNull()
    expect(() => store.set('short')).toThrow('OpenRouter key length is invalid.')
  })

  it('keeps a session-only fallback when browser storage is unavailable', () => {
    const store = new BrowserOpenRouterCredentialStore()
    store.set('sk-or-session-fallback')

    expect(store.persistence).toBe('session')
    expect(store.get()).toBe('sk-or-session-fallback')
  })
})
