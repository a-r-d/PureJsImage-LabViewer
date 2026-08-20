import {
  MemoryOpenRouterCredentialStore,
  type OpenRouterCredentialStore,
} from '@pji-workbench/agent'

export const SCIENCE_AGENT_KEY_STORAGE = 'purejsimage-lab-openrouter-key-v1'

export interface ScienceAgentCredentialStore extends OpenRouterCredentialStore {
  readonly persistence: 'browser' | 'session'
}

/**
 * The only durable OpenRouter-key adapter in the Science application.
 * The credential never enters project, action, conversation, or export state.
 */
export class BrowserOpenRouterCredentialStore implements ScienceAgentCredentialStore {
  readonly #memory = new MemoryOpenRouterCredentialStore()
  #storage: Storage | undefined

  constructor(storage?: Storage) {
    this.#storage = storage
    if (storage === undefined) return
    try {
      const persisted = storage.getItem(SCIENCE_AGENT_KEY_STORAGE)
      if (persisted === null) return
      try {
        this.#memory.set(persisted)
      } catch {
        storage.removeItem(SCIENCE_AGENT_KEY_STORAGE)
      }
    } catch {
      this.#storage = undefined
    }
  }

  get persistence(): 'browser' | 'session' {
    return this.#storage === undefined ? 'session' : 'browser'
  }

  get(): string | undefined {
    return this.#memory.get()
  }

  set(value: string): void {
    const validated = new MemoryOpenRouterCredentialStore()
    validated.set(value)
    const normalized = validated.get()
    if (normalized === undefined) throw new Error('OpenRouter key is unavailable.')
    if (this.#storage === undefined) {
      this.#memory.set(normalized)
      return
    }
    try {
      this.#storage.setItem(SCIENCE_AGENT_KEY_STORAGE, normalized)
      this.#memory.set(normalized)
    } catch {
      throw new Error('This browser could not save the OpenRouter key. Check storage permissions.')
    }
  }

  clear(): void {
    if (this.#storage !== undefined) {
      try {
        this.#storage.removeItem(SCIENCE_AGENT_KEY_STORAGE)
      } catch {
        throw new Error('This browser could not remove the saved OpenRouter key.')
      }
    }
    this.#memory.clear()
  }

  has(): boolean {
    return this.#memory.has()
  }
}

export function createScienceAgentCredentialStore(): ScienceAgentCredentialStore {
  try {
    return new BrowserOpenRouterCredentialStore(window.localStorage)
  } catch {
    return new BrowserOpenRouterCredentialStore()
  }
}
