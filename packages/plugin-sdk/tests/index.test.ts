import { describe, expect, it } from 'vitest'

import {
  importScriptStudioExport,
  isDeclarativeRecipe,
  isVersionCompatible,
  MemoryScriptStudioRepository,
  normalizeCompatibilityRange,
  normalizeStudioDocument,
  resolveStudioInstallation,
  scriptContentIntegrity,
  serializeScriptStudioExport,
  validateAnalysisScriptDocument,
  validateLocalInstallation,
  validatePluginJsonValue,
  validatePluginManifest,
  validateRecipeDocument,
  validateSandboxHostMessage,
  validateSandboxWorkerMessage,
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
      validateSandboxWorkerMessage({
        schemaVersion: 1,
        kind: 'sandbox.executing',
        requestId: 'request-1',
      }).ok,
    ).toBe(true)
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

  it('round-trips Studio records while rejecting tampering, identity drift, and corruption', async () => {
    const document = await normalizeStudioDocument({
      schemaVersion: 1,
      kind: 'analysis-script',
      id: 'studio.security-test',
      title: 'Studio security test',
      language: 'javascript',
      source: 'export function main() { return null }',
      manifest: {
        scriptApiVersion: 1,
        requestedCapabilities: ['workspace.read'],
        pureJsImageCompatibility: '*',
        workbenchCompatibility: '*',
        entrypoint: 'main',
        deterministic: true,
      },
      tests: [],
      integrity: { algorithm: 'sha256', digest },
    })
    const record = {
      schemaVersion: 1 as const,
      id: document.id,
      kind: document.kind,
      document,
      savedDocument: document,
      editor: {
        schemaVersion: 1 as const,
        selectionAnchor: 0,
        selectionHead: 0,
        scrollTop: 0,
        activePanel: 'problems' as const,
      },
      testResults: [],
    }
    const exported = await serializeScriptStudioExport(record)
    await expect(importScriptStudioExport(exported)).resolves.toEqual(record)

    const injected = JSON.parse(exported) as {
      record: {
        credentials?: { token: string }
        editor: { credentials?: { token: string } }
        testResults: Array<{
          schemaVersion: 1
          testId: string
          status: 'passed'
          issues: string[]
          credentials?: { token: string }
        }>
      }
    }
    injected.record.credentials = { token: 'must-not-survive' }
    injected.record.editor.credentials = { token: 'nested-editor-secret' }
    injected.record.testResults = [
      {
        schemaVersion: 1,
        testId: 'sanitized-result',
        status: 'passed',
        issues: [],
        credentials: { token: 'nested-test-secret' },
      },
    ]
    const sanitized = await importScriptStudioExport(JSON.stringify(injected))
    expect(JSON.stringify(sanitized)).not.toMatch(
      /must-not-survive|nested-editor-secret|nested-test-secret/u,
    )
    expect(sanitized.testResults).toEqual([
      {
        schemaVersion: 1,
        testId: 'sanitized-result',
        status: 'passed',
        issues: [],
      },
    ])

    const tampered = JSON.parse(exported) as {
      record: { document: { source: string }; credentials?: { token: string } }
    }
    tampered.record.document.source = 'fetch("https://attacker.invalid")'
    tampered.record.credentials = { token: 'must-not-survive' }
    await expect(importScriptStudioExport(JSON.stringify(tampered))).rejects.toThrow(
      'content integrity mismatch',
    )

    const wrongIdentity = JSON.parse(exported) as {
      record: { savedDocument: { id: string } }
    }
    wrongIdentity.record.savedDocument.id = 'different-script'
    await expect(importScriptStudioExport(JSON.stringify(wrongIdentity))).rejects.toThrow(
      'identities do not match',
    )

    const repository = new MemoryScriptStudioRepository()
    await repository.put(record)
    repository.injectCorruptRecordForTest('corrupt', { schemaVersion: 99 })
    await expect(repository.list()).resolves.toEqual([record])
    expect(repository.warnings()).toContain('Ignored corrupt Script Studio record: corrupt')
    repository.injectCorruptRecordForTest('forged', {
      ...record,
      id: 'forged',
      document: { ...document, id: 'forged', source: 'forged content' },
      savedDocument: { ...document, id: 'forged', source: 'forged content' },
    })
    await expect(repository.get('forged')).resolves.toBeUndefined()
    expect(repository.warnings()).toContain('Ignored corrupt Script Studio record: forged')
    await expect(importScriptStudioExport('x'.repeat(768 * 1024 + 1))).rejects.toThrow('byte limit')
    await expect(
      repository.put({
        ...record,
        document: { ...document, source: `${document.source}\n// forged without rehashing` },
      }),
    ).rejects.toThrow('content integrity mismatch')

    await expect(
      repository.put({
        ...record,
        testResults: [
          {
            schemaVersion: 1,
            testId: 'oversized-result',
            status: 'failed',
            issues: ['x'.repeat(4_097)],
          },
        ],
      }),
    ).rejects.toThrow('invalid Script Studio record')

    const mismatchedInstallation = {
      ...record,
      installation: {
        schemaVersion: 1 as const,
        document,
        installation: {
          schemaVersion: 1 as const,
          pluginId: document.id,
          pluginVersion: '1.0.0',
          contentDigest: document.integrity.digest,
          installedKind: 'sandboxed-script' as const,
          permissionGrant: {
            schemaVersion: 1 as const,
            scriptId: document.id,
            sourceDigest: 'b'.repeat(64),
            grantedCapabilities: ['analysis.execute'] as const,
            deniedCapabilities: [] as const,
          },
          enabled: true,
        },
      },
    }
    await expect(serializeScriptStudioExport(mismatchedInstallation)).rejects.toThrow(
      'record is invalid',
    )
  })

  it('replays only exact installed snapshots and warns on missing or mismatched content', async () => {
    const document = await normalizeStudioDocument({
      schemaVersion: 1,
      kind: 'recipe',
      id: 'replay.recipe',
      version: '1.0.0',
      title: 'Replay recipe',
      operations: [],
      requestedCapabilities: [],
      compatibility: { pureJsImage: '*', workbench: '*' },
      integrity: { algorithm: 'sha256', digest },
    })
    const record = {
      schemaVersion: 1 as const,
      id: document.id,
      kind: document.kind,
      document,
      savedDocument: document,
      editor: {
        schemaVersion: 1 as const,
        selectionAnchor: 0,
        selectionHead: 0,
        scrollTop: 0,
        activePanel: 'problems' as const,
      },
      testResults: [],
      installation: {
        schemaVersion: 1 as const,
        document,
        installation: {
          schemaVersion: 1 as const,
          pluginId: document.id,
          pluginVersion: '1.0.0',
          contentDigest: document.integrity.digest,
          installedKind: 'recipe' as const,
          permissionGrant: {
            schemaVersion: 1 as const,
            scriptId: document.id,
            sourceDigest: document.integrity.digest,
            grantedCapabilities: [],
            deniedCapabilities: [],
          },
          enabled: true,
        },
      },
    }
    const repository = new MemoryScriptStudioRepository()
    await repository.put(record)
    await expect(
      resolveStudioInstallation(repository, document.id, document.integrity.digest),
    ).resolves.toMatchObject({ status: 'exact', document })
    await expect(
      resolveStudioInstallation(repository, document.id, 'f'.repeat(64)),
    ).resolves.toMatchObject({
      status: 'mismatch',
      warning: expect.stringContaining('content mismatch'),
    })
    await expect(
      resolveStudioInstallation(repository, 'missing.recipe', digest),
    ).resolves.toMatchObject({
      status: 'missing',
      warning: expect.stringContaining('is missing'),
    })
  })
})
