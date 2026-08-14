export * from './hash.js'
export * from './types.js'
export * from './validation.js'

import type { PluginManifestIdentity } from './types.js'

export function isDeclarativeRecipe(manifest: PluginManifestIdentity): boolean {
  return manifest.entryKind === 'recipe'
}
