import { describe, expect, it } from 'vitest'

import {
  isDeclarativeRecipe,
  isVersionCompatible,
  normalizeCompatibilityRange,
  scriptContentIntegrity,
  validateAnalysisScriptDocument,
  validateLocalInstallation,
  validatePluginJsonValue,
  validatePluginManifest,
  validateRecipeDocument,
  validateSandboxHostMessage,
  validateScriptProvenance,
  validateScriptTestResult,
} from '../src/index.js'

const digest = 'a'.repeat(64)

describe('plugin SDK bounded contracts', () => {
  it('normalizes manifests, capabilities, and compatibility ranges', () => {
    const result = validatePluginManifest({
      schemaVersion: 1,
      id: 'threshold.recipe',
      version: '1.0.0',
      title: 'Threshold recipe',
      description: 'A bounded recipe.',
      entryKind: 'recipe',
      requestedCapabilities: ['workspace.read', 'analysis.dry-run'],
      compatibility: { pureJsImage: '^4.0.0', workbench: '>=0.0.0 <1.0.0' },
    })
    expect(result.ok).toBe(true)
    expect(result.value?.requestedCapabilities).toEqual(['analysis.dry-run', 'workspace.read'])
    expect(normalizeCompatibilityRange('  >=0.0.0   <1.0.0 ')).toBe('>=0.0.0 <1.0.0')
    expect(isVersionCompatible('>=0.10.0 <1.0.0', '0.31.0')).toBe(true)
    expect(isVersionCompatible('^0.10.0', '0.11.0')).toBe(false)
    expect(
      isDeclarativeRecipe({
        schemaVersion: 1,
        id: 'example',
        version: '1.0.0',
        entryKind: 'recipe',
      }),
    ).toBe(true)
  })

  it('rejects oversized source, capability overflow, and non-JSON values', () => {
    const script = validateAnalysisScriptDocument({
      schemaVersion: 1,
      kind: 'analysis-script',
      id: 'bad-script',
      title: 'Bad script',
      language: 'javascript',
      source: 'x'.repeat(256 * 1024 + 1),
      manifest: {
        scriptApiVersion: 1,
        requestedCapabilities: Array.from({ length: 33 }, () => 'workspace.read'),
        pureJsImageCompatibility: '*',
        workbenchCompatibility: '*',
        entrypoint: 'main',
        deterministic: true,
      },
      tests: [],
      integrity: { algorithm: 'sha256', digest },
    })
    expect(script.ok).toBe(false)
    expect(script.issues.map(({ path }) => path)).toContain('/source')
    expect(script.issues.map(({ path }) => path)).toContain('/manifest/requestedCapabilities')

    const recipe = validateRecipeDocument({
      schemaVersion: 1,
      kind: 'recipe',
      id: 'unsafe-recipe',
      version: '1.0.0',
      title: 'Unsafe recipe',
      operations: [{ actionId: 'analysis.run', actionVersion: 1, input: { value: Number.NaN } }],
      requestedCapabilities: [],
      compatibility: { pureJsImage: '*', workbench: '*' },
      integrity: { algorithm: 'sha256', digest },
    })
    expect(recipe.issues).toContainEqual({
      path: '/operations/0/input/value',
      message: 'Numbers must be finite.',
    })

    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    expect(validatePluginJsonValue(cyclic).ok).toBe(false)
    expect(validatePluginJsonValue({ ['x'.repeat(257)]: true }).ok).toBe(false)

    const cyclicManifest: Record<string, unknown> = {
      schemaVersion: 1,
      id: 'cyclic.plugin',
    }
    cyclicManifest['self'] = cyclicManifest
    expect(() => validatePluginManifest(cyclicManifest)).not.toThrow()
    expect(validatePluginManifest(cyclicManifest).ok).toBe(false)
  })

  it('binds installations and RPC to exact identities and bounded messages', () => {
    const installation = validateLocalInstallation({
      schemaVersion: 1,
      pluginId: 'script.example',
      pluginVersion: '1.0.0',
      contentDigest: digest,
      installedKind: 'sandboxed-script',
      permissionGrant: {
        schemaVersion: 1,
        scriptId: 'different-script',
        sourceDigest: digest,
        grantedCapabilities: ['workspace.read'],
        deniedCapabilities: ['workspace.read'],
      },
      enabled: true,
    })
    expect(installation.ok).toBe(false)
    expect(
      installation.issues.some(({ message }) => message.includes('both granted and denied')),
    ).toBe(true)
    expect(validateSandboxHostMessage({ schemaVersion: 1, kind: 'sandbox.start' }).ok).toBe(false)
    expect(
      validateSandboxHostMessage({
        schemaVersion: 1,
        kind: 'sandbox.cancel',
        requestId: 'request-1',
        padding: 'x'.repeat(256 * 1024),
      }).issues.some(({ message }) => message.includes('byte limit')),
    ).toBe(true)
  })

  it('hashes canonical content without presentation integrity', async () => {
    const base = {
      schemaVersion: 1 as const,
      kind: 'analysis-script' as const,
      id: 'hash-test',
      title: 'Hash test',
      language: 'javascript' as const,
      source: 'export function main() {}',
      manifest: {
        scriptApiVersion: 1 as const,
        requestedCapabilities: [] as const,
        pureJsImageCompatibility: '*',
        workbenchCompatibility: '*',
        entrypoint: 'main' as const,
        deterministic: true,
      },
      tests: [],
    }
    await expect(scriptContentIntegrity(base)).resolves.toEqual({
      algorithm: 'sha256',
      digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    })
  })

  it('bounds test results and provenance references', () => {
    expect(
      validateScriptTestResult({
        schemaVersion: 1,
        testId: 'fixture-test',
        status: 'passed',
        output: { count: 12 },
        issues: [],
      }).ok,
    ).toBe(true)
    expect(
      validateScriptProvenance({
        schemaVersion: 1,
        scriptId: 'script.example',
        sourceHash: { algorithm: 'sha256', digest },
        manifest: {},
        permissions: {
          schemaVersion: 1,
          scriptId: 'script.example',
          sourceDigest: digest,
          grantedCapabilities: [],
          deniedCapabilities: [],
        },
        actionTrace: [],
        references: Array.from({ length: 129 }, (_, index) => ({
          kind: 'action',
          id: `action-${index}`,
        })),
      }).issues,
    ).toContainEqual({ path: '/references', message: 'Expected at most 128 references.' })
  })
})
