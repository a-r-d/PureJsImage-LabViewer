export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as const

export type PluginEntryKind = 'recipe' | 'trusted-module' | 'sandboxed-module'

export interface PluginManifestIdentity {
  readonly schemaVersion: typeof PLUGIN_MANIFEST_SCHEMA_VERSION
  readonly id: string
  readonly version: string
  readonly entryKind: PluginEntryKind
}

export function isDeclarativeRecipe(manifest: PluginManifestIdentity): boolean {
  return manifest.entryKind === 'recipe'
}
