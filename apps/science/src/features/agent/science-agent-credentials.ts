import {
  type OpenRouterCredentialStore,
  OptionalPersistentOpenRouterCredentialStore,
} from '@pji-workbench/agent'

export const SCIENCE_AGENT_KEY_STORAGE = 'purejsimage-lab-openrouter-key-v1'

export type ScienceAgentCredentialStore = OptionalPersistentOpenRouterCredentialStore &
  OpenRouterCredentialStore

export function createScienceAgentCredentialStore(): ScienceAgentCredentialStore {
  try {
    return new OptionalPersistentOpenRouterCredentialStore({
      storage: window.localStorage,
      storageKey: SCIENCE_AGENT_KEY_STORAGE,
    })
  } catch {
    return new OptionalPersistentOpenRouterCredentialStore({
      storageKey: SCIENCE_AGENT_KEY_STORAGE,
    })
  }
}

export { OptionalPersistentOpenRouterCredentialStore as BrowserOpenRouterCredentialStore }
