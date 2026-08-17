import { createHash } from 'node:crypto'
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
  resolveExampleFixture,
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
    expect(enabledExampleScenarios()).toHaveLength(10)
    expect(
      enabledExampleScenarios().filter(({ source }) => source.kind === 'bundled'),
    ).toHaveLength(4)
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
    expect(resolveExampleFixture('cdc.ecoli-sem')).toEqual({
      scenarioId: 'cdc.ecoli-sem',
      requiresNetwork: false,
      locator: {
        kind: 'bundled',
        path: 'examples/real/e-coli-sem.gsf',
        name: 'e-coli-sem.gsf',
        size: 1_330_276,
        sha256: 'da8cd19072a139b869e070de78f1cecc6aab491cfbcf4c41253acd115b2318e3',
        mediaType: 'application/octet-stream',
      },
    })
    expect(resolveExampleFixture('cdc.staph-aureus-sem')).toEqual({
      scenarioId: 'cdc.staph-aureus-sem',
      requiresNetwork: false,
      locator: {
        kind: 'bundled',
        path: 'examples/real/staph-aureus-sem.jpg',
        name: 'staph-aureus-sem.jpg',
        size: 1_272_863,
        sha256: 'b51027770e00eb1065bd6e0c83e56265181b28559aee0e6d3ee04778514d8032',
        mediaType: 'image/jpeg',
      },
    })
  })

  it('generates immutable PR artifacts and a complete cross-tier capability matrix', () => {
    const artifacts = scenarioTestArtifacts()
    expect(artifacts).toHaveLength(10)
    expect(Object.isFrozen(artifacts)).toBe(true)
    expect(new Set(artifacts.map(({ fixture }) => fixture.kind))).toEqual(
      new Set(['generated', 'bundled']),
    )
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
    expect(oracle.scenarios).toHaveLength(
      enabledExampleScenarios().filter(({ source }) => source.kind === 'generated').length,
    )
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
    expect(audit.counts.enabled).toBe(10)
    expect(audit.entries.filter(({ ready }) => ready)).toHaveLength(10)
    expect(audit.entries.find(({ id }) => id === 'zenodo.indentation-masks')).toMatchObject({
      status: 'candidate',
      ready: false,
    })
    expect(
      audit.entries.find(({ id }) => id === 'zenodo.indentation-masks')?.reasons.join(' '),
    ).toContain('SHA-256 is missing')
  })

  it('pins every bundled real-data byte to the reviewed manifest', async () => {
    const bundled = enabledExampleScenarios().filter(({ source }) => source.kind === 'bundled')
    for (const scenario of bundled)
      for (const file of scenario.source.files) {
        const bytes = await readFile(
          new URL(`../../../apps/workbench/public/${file.path}`, import.meta.url),
        )
        expect(bytes.byteLength, `${scenario.id}/${file.path}`).toBe(file.sizeBytes)
        expect(
          createHash('sha256').update(bytes).digest('hex'),
          `${scenario.id}/${file.path}`,
        ).toBe(file.sha256)
      }
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
