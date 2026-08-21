import { MemoryOpenRouterCredentialStore, type OpenRouterCredentialStore } from './openrouter.js'

export type CredentialPersistence = 'session' | 'browser'

export const DEFAULT_OPENROUTER_CREDENTIAL_STORAGE_KEY = 'purejsimage-openrouter-key-v1'

export interface OptionalPersistentOpenRouterCredentialStoreOptions {
  readonly storage?: Storage
  readonly storageKey?: string
}

/**
 * Session-only by default. Browser persistence requires an explicit persist action
 * and never copies a session key to localStorage implicitly.
 */
export class OptionalPersistentOpenRouterCredentialStore implements OpenRouterCredentialStore {
  readonly #memory = new MemoryOpenRouterCredentialStore()
  readonly #storageKey: string
  #storage: Storage | undefined
  #persistence: CredentialPersistence = 'session'

  constructor(options: OptionalPersistentOpenRouterCredentialStoreOptions = {}) {
    this.#storageKey = options.storageKey ?? DEFAULT_OPENROUTER_CREDENTIAL_STORAGE_KEY
    this.#storage = options.storage
    if (options.storage === undefined) return
    try {
      const persisted = options.storage.getItem(this.#storageKey)
      if (persisted === null) return
      try {
        this.#memory.set(persisted)
        this.#persistence = 'browser'
      } catch {
        options.storage.removeItem(this.#storageKey)
      }
    } catch {
      this.#storage = undefined
    }
  }

  get persistence(): CredentialPersistence {
    return this.#persistence
  }

  get(): string | undefined {
    return this.#memory.get()
  }

  set(value: string, options: Readonly<{ persist?: boolean }> = {}): void {
    const persist = options.persist === true
    const validated = new MemoryOpenRouterCredentialStore()
    validated.set(value)
    const normalized = validated.get()
    if (normalized === undefined) throw new Error('OpenRouter key is unavailable.')
    this.#memory.set(normalized)
    if (!persist) {
      this.#removePersistentValue()
      this.#persistence = 'session'
      return
    }
    this.#writePersistentValue(normalized)
  }

  persistMemory(): void {
    const current = this.#memory.get()
    if (current === undefined) throw new Error('Paste an OpenRouter key before remembering it.')
    this.#writePersistentValue(current)
  }

  forgetPersistent(): void {
    this.#removePersistentValue()
    this.#persistence = 'session'
  }

  clear(): void {
    this.#removePersistentValue()
    this.#memory.clear()
    this.#persistence = 'session'
  }

  has(): boolean {
    return this.#memory.has()
  }

  #writePersistentValue(value: string): void {
    if (this.#storage === undefined) {
      throw new Error('This browser cannot remember the OpenRouter key.')
    }
    try {
      this.#storage.setItem(this.#storageKey, value)
      this.#persistence = 'browser'
    } catch {
      throw new Error('This browser could not save the OpenRouter key. Check storage permissions.')
    }
  }

  #removePersistentValue(): void {
    if (this.#storage === undefined) return
    try {
      this.#storage.removeItem(this.#storageKey)
    } catch {
      throw new Error('This browser could not remove the saved OpenRouter key.')
    }
  }
}
