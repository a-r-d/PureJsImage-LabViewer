import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  corpusManifest,
  createCorpusAuditReport,
  enabledExampleScenarios,
  generatedCorpusDescriptor,
  independentOriginValue,
  REQUIRED_PRODUCT_CAPABILITIES,
  researchExampleScenarios,
  resolveGeneratedFixture,
  scenarioCapabilityMatrix,
  scenarioTestArtifacts,
  validateCorpusManifest,
  validateGeneratedReferenceOracleFile,
} from '../src/index.js'

describe('generated corpus foundation', () => {
  it('is deterministic and network independent', () => {
    expect(generatedCorpusDescriptor()).toEqual({
      id: 'generated-materials-shapes-v1',
      tier: 'generated',
      requiresNetwork: false,
    })
  })

  it('normalizes one immutable manifest for gallery, fixtures, workflows, and audit', () => {
    const validation = validateCorpusManifest(corpusManifest)
    expect(validation.ok).toBe(true)
    expect(Object.isFrozen(corpusManifest)).toBe(true)
    expect(enabledExampleScenarios()).toHaveLength(5)
    expect(enabledExampleScenarios().every(({ source }) => source.kind === 'generated')).toBe(true)
    expect(enabledExampleScenarios().every(({ expected }) => expected.length > 0)).toBe(true)
    expect(researchExampleScenarios().length).toBeGreaterThanOrEqual(8)
    expect(new Set(corpusManifest.scenarios.map(({ id }) => id)).size).toBe(
      corpusManifest.scenarios.length,
    )
    expect(
      corpusManifest.scenarios.some(({ source }) =>
        source.files.some(({ path }) => path.startsWith('../') || path.startsWith('/')),
      ),
    ).toBe(false)
    expect(resolveGeneratedFixture('generated.periodic-lattice')).toEqual({
      scenarioId: 'generated.periodic-lattice',
      generatorId: 'generated.periodic-lattice',
      requiresNetwork: false,
      locator: { kind: 'sample', sampleId: 'generated.periodic-lattice' },
    })
    expect(() => resolveGeneratedFixture('openslide.cmu1-aperio')).toThrow(
      'not an enabled generated fixture',
    )
  })

  it('generates immutable PR artifacts and a complete cross-tier capability matrix', () => {
    const artifacts = scenarioTestArtifacts()
    expect(artifacts).toHaveLength(5)
    expect(Object.isFrozen(artifacts)).toBe(true)
    expect(artifacts.every(({ fixture }) => fixture.kind === 'generated')).toBe(true)
    expect(artifacts.every(({ steps, expected }) => steps.length > 0 && expected.length > 0)).toBe(
      true,
    )
    const matrix = scenarioCapabilityMatrix()
    for (const capability of REQUIRED_PRODUCT_CAPABILITIES)
      expect(matrix.get(capability), capability).not.toEqual(undefined)
  })

  it('keeps reviewed generated JSON aligned with the independent analytic reference', async () => {
    const raw: unknown = JSON.parse(
      await readFile(new URL('../expected/generated-v1.json', import.meta.url), 'utf8'),
    )
    const oracle = validateGeneratedReferenceOracleFile(raw)
    expect(oracle.reference).toEqual({
      implementation: 'independent-analytic-generated-fixture-reference',
      version: '1.0.0',
    })
    expect(oracle.scenarios).toHaveLength(enabledExampleScenarios().length)
    for (const expected of oracle.scenarios)
      expect(independentOriginValue(expected.id)).toBeCloseTo(expected.originValue, 12)
  })

  it('rejects hostile generated reference oracle fields and numeric bounds', () => {
    const valid = {
      schemaVersion: 1,
      reference: { implementation: 'independent', version: '1.0.0' },
      scenarios: [
        {
          id: 'generated.example',
          width: 2,
          height: 2,
          xStep: 1,
          yStep: 1,
          unit: 'nm',
          originValue: 0,
          tolerance: 1e-6,
          samples: [
            { x: 0, y: 0, value: 0 },
            { x: 1, y: 1, value: 1 },
          ],
        },
      ],
    }
    expect(() => validateGeneratedReferenceOracleFile({ ...valid, unexpected: true })).toThrow(
      'unknown unexpected',
    )
    expect(() =>
      validateGeneratedReferenceOracleFile({
        ...valid,
        scenarios: [{ ...valid.scenarios[0], tolerance: 0 }],
      }),
    ).toThrow('invalid tolerance')
    expect(() =>
      validateGeneratedReferenceOracleFile({
        ...valid,
        scenarios: [
          {
            ...valid.scenarios[0],
            samples: [
              { x: 0, y: 0, value: 0, unexpected: true },
              { x: 1, y: 1, value: 1 },
            ],
          },
        ],
      }),
    ).toThrow('unknown unexpected')
  })

  it('keeps unqualified external data out of the enabled catalog with auditable reasons', () => {
    const audit = createCorpusAuditReport(corpusManifest)
    expect(audit.counts.enabled).toBe(5)
    expect(audit.entries.filter(({ ready }) => ready)).toHaveLength(5)
    expect(audit.entries.find(({ id }) => id === 'zenodo.indentation-masks')).toMatchObject({
      status: 'candidate',
      ready: false,
    })
    expect(
      audit.entries.find(({ id }) => id === 'zenodo.indentation-masks')?.reasons.join(' '),
    ).toContain('SHA-256 is missing')
  })

  it('keeps the checked-in audit synchronized with every manifest status', async () => {
    const audit = await readFile(new URL('../../../docs/CORPUS_AUDIT.md', import.meta.url), 'utf8')
    for (const scenario of corpusManifest.scenarios)
      expect(audit).toContain(`| \`${scenario.id}\` | ${scenario.status} |`)
  })

  it('refuses enabled external data without integrity and approved licensing', () => {
    const invalid = {
      schemaVersion: 1,
      generatedAt: '2026-08-14',
      scenarios: [
        {
          ...enabledExampleScenarios()[0],
          id: 'invalid.external',
          source: {
            kind: 'external',
            landingPage: 'https://example.test/data',
            files: [
              {
                path: 'image.tif',
                mediaType: 'image/tiff',
                delivery: 'download',
              },
            ],
          },
          license: {
            id: 'LicenseRef-Unknown',
            name: 'Unknown',
            url: 'https://example.test/license',
            attribution: 'Unknown',
            redistribution: 'review-required',
          },
        },
      ],
    }
    const validation = validateCorpusManifest(invalid)
    expect(validation.ok).toBe(false)
    if (validation.ok) return
    expect(validation.issues.map(({ message }) => message)).toContain(
      'Enabled external files require an immutable HTTPS URL and SHA-256.',
    )
    expect(validation.issues.map(({ message }) => message)).toContain(
      'Enabled scenarios require approved redistribution.',
    )
  })

  it('enforces credential-free URLs and source-specific delivery modes', () => {
    const generated = enabledExampleScenarios()[0]
    expect(generated).toBeDefined()
    if (generated === undefined) return
    const bundled = {
      ...generated,
      id: 'bundled.verified-example',
      tier: 'bundled',
      source: {
        kind: 'bundled',
        landingPage: 'https://purejsimage.com/examples',
        files: [
          {
            path: 'examples/verified.gsf',
            sizeBytes: 128,
            sha256: '1'.repeat(64),
            mediaType: 'application/octet-stream',
            delivery: 'bundled',
          },
        ],
      },
    }
    expect(
      validateCorpusManifest({ schemaVersion: 1, generatedAt: '2026-08-14', scenarios: [bundled] })
        .ok,
    ).toBe(true)

    const invalid = {
      ...bundled,
      source: {
        ...bundled.source,
        landingPage: 'https://user:secret@example.test/data',
        files: [{ ...bundled.source.files[0], delivery: 'download' }],
      },
    }
    const validation = validateCorpusManifest({
      schemaVersion: 1,
      generatedAt: '2026-08-14',
      scenarios: [invalid],
    })
    expect(validation.ok).toBe(false)
    if (validation.ok) return
    expect(validation.issues.map(({ message }) => message)).toContain(
      'Bundled sources require bundled delivery.',
    )
    expect(validation.issues.map(({ message }) => message)).toContain(
      'Landing page must use HTTPS.',
    )
  })
})
