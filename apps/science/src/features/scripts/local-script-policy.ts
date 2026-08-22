import type {
  ScriptCapability,
  ScriptStudioInstallationSnapshotV1,
  ScriptStudioRecordV1,
} from '@pji-workbench/plugin-sdk'

export const LOCAL_SCRIPT_CAPABILITIES: readonly ScriptCapability[] = Object.freeze([
  'analysis.catalog',
  'analysis.dry-run',
  'analysis.execute',
  'dataset.read-descriptor',
  'result.read-page',
  'result.read-summary',
  'roi.propose',
  'roi.read',
  'source.read-metadata',
  'ui.propose',
  'viewport.propose',
  'viewport.read',
  'workspace.propose',
  'workspace.read',
])

export function localInstallation(
  record: ScriptStudioRecordV1,
): ScriptStudioInstallationSnapshotV1 {
  const capabilities =
    record.document.kind === 'recipe'
      ? record.document.requestedCapabilities
      : record.document.manifest.requestedCapabilities
  return {
    schemaVersion: 1,
    installation: {
      schemaVersion: 1,
      pluginId: record.id,
      pluginVersion: record.document.kind === 'recipe' ? record.document.version : '0.1.0',
      contentDigest: record.document.integrity.digest,
      installedKind: record.document.kind === 'recipe' ? 'recipe' : 'sandboxed-script',
      permissionGrant: {
        schemaVersion: 1,
        scriptId: record.id,
        sourceDigest: record.document.integrity.digest,
        grantedCapabilities: capabilities,
        deniedCapabilities: [],
      },
      enabled: true,
    },
    document: record.document,
  }
}
