import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { type ParticleCorpusManifestV1, validateParticleCorpusManifest } from '../src/index.js'

const manifestUrl = new URL(
  '../../materials-analysis/testdata/corpus/manifest.v1.json',
  import.meta.url,
)
const corpusRoot = new URL('../../materials-analysis/testdata/corpus/', import.meta.url)

async function manifestUnknown(): Promise<unknown> {
  return JSON.parse(await readFile(manifestUrl, 'utf8'))
}

async function manifest(): Promise<ParticleCorpusManifestV1> {
  const validation = validateParticleCorpusManifest(await manifestUnknown())
  if (!validation.ok)
    throw new Error(validation.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'))
  return validation.value
}

describe('fixture-level particle corpus manifest', () => {
  it('strictly validates the canonical source, rights, provenance, and fixture records', async () => {
    const value = await manifest()
    expect(value.sources.length).toBeGreaterThanOrEqual(15)
    expect(value.fixtures).toHaveLength(22)
    expect(value.fixtures.filter(({ review }) => review.status === 'smoke-test-only')).toHaveLength(
      2,
    )
    expect(
      value.fixtures.filter(({ review }) => review.status === 'adjudicated-gold'),
    ).toHaveLength(0)
    expect(
      value.sources
        .filter(({ tier }) => tier === 'core' || tier === 'extended')
        .every(
          ({ license }) =>
            license.commercialUse && license.redistribution && license.derivativeWorks,
        ),
    ).toBe(true)
    expect(
      value.sources
        .filter(({ fetchPolicy }) => fetchPolicy === 'core-explicit')
        .every(({ downloads }) =>
          downloads.every(({ url, sha256 }) => url !== undefined && sha256 !== undefined),
        ),
    ).toBe(true)
    expect(value.sources.find(({ id }) => id === 'nist-lnp-cryoem')?.fetchPolicy).toBe('blocked')
    expect(value.sources.find(({ id }) => id === 'nist-sem-detection-limits')?.fetchPolicy).toBe(
      'blocked',
    )
    expect(value.sources.find(({ id }) => id === 'emps')?.tier).toBe('quarantined')
    const native = value.fixtures.filter(({ id }) => id.startsWith('bbbc039-native-'))
    expect(native).toHaveLength(16)
    expect(native.filter(({ split }) => split === 'train')).toHaveLength(8)
    expect(native.filter(({ split }) => split === 'validation')).toHaveLength(4)
    expect(native.filter(({ split }) => split === 'test')).toHaveLength(4)
    expect(native.every(({ sourceSelection }) => sourceSelection.selection !== null)).toBe(true)
  })

  it('pins every checked-in fixture asset byte and refuses checksum drift', async () => {
    const value = await manifest()
    const assets = new Map(
      value.fixtures.flatMap(({ image, labels }) =>
        [image, labels.instanceMask, labels.semanticMask, labels.ignoreMask]
          .filter((asset) => asset !== null)
          .map((asset) => [asset.path, asset] as const),
      ),
    )
    for (const [path, asset] of assets) {
      const bytes = await readFile(new URL(path, corpusRoot))
      expect(bytes.byteLength, path).toBe(asset.sizeBytes)
      expect(createHash('sha256').update(bytes).digest('hex'), path).toBe(asset.sha256)
    }

    const first = value.fixtures[0]
    if (first === undefined) throw new Error('Particle corpus fixture is missing.')
    const changed = {
      ...value,
      fixtures: [{ ...first, image: { ...first.image, sha256: 'not-a-digest' } }],
    }
    const validation = validateParticleCorpusManifest(changed)
    expect(validation.ok).toBe(false)
    if (validation.ok) return
    expect(validation.issues.map(({ message }) => message)).toContain(
      'Expected a lowercase SHA-256 digest.',
    )
  })

  it('fails closed on unknown metadata, incomplete provenance, and permissive license claims', async () => {
    const value = await manifest()
    const firstSource = value.sources[0]
    const firstFixture = value.fixtures[0]
    if (firstSource === undefined || firstFixture === undefined)
      throw new Error('Particle corpus records are missing.')
    const hostile = {
      ...value,
      unexpected: true,
      sources: [
        {
          ...firstSource,
          id: 'unsafe-source',
          tier: 'core',
          license: { ...firstSource.license, commercialUse: false },
        },
      ],
      fixtures: [{ ...firstFixture, sourceId: 'undeclared-source' }],
    }
    const validation = validateParticleCorpusManifest(hostile)
    expect(validation.ok).toBe(false)
    if (validation.ok) return
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/unexpected', message: 'Unknown property.' }),
        expect.objectContaining({
          path: '/sources/0/license',
          message: 'Core and extended sources must pass every redistribution policy gate.',
        }),
        expect.objectContaining({
          path: '/fixtures/0/sourceId',
          message: 'Fixture source is not declared.',
        }),
      ]),
    )
  })

  it('keeps all extended and quarantined sources out of implicit core fetches', async () => {
    const value = await manifest()
    expect(
      value.sources
        .filter(({ tier }) => tier !== 'core')
        .every(({ fetchPolicy }) => fetchPolicy !== 'core-explicit'),
    ).toBe(true)
    expect(
      value.sources.some(({ downloads }) =>
        downloads.some(({ filename }) => filename === 'AImodel_sets.zip'),
      ),
    ).toBe(false)
  })

  it('rejects empty core fetch records and non-finite derivation parameters', async () => {
    const value = await manifest()
    const source = value.sources.find(({ fetchPolicy }) => fetchPolicy === 'core-explicit')
    const fixture = value.fixtures[0]
    if (source === undefined || fixture === undefined)
      throw new Error('Fetchable source and fixture are required for this validation test.')
    const validation = validateParticleCorpusManifest({
      ...value,
      sources: value.sources.map((candidate) =>
        candidate.id === source.id ? { ...candidate, downloads: [] } : candidate,
      ),
      fixtures: [
        {
          ...fixture,
          derivation: [{ operation: 'hostile', parameters: { value: Number.POSITIVE_INFINITY } }],
        },
      ],
    })
    expect(validation.ok).toBe(false)
    if (validation.ok) return
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Fetchable core sources require at least one pinned download.',
        }),
        expect.objectContaining({
          message: 'Expected a scalar.',
        }),
      ]),
    )
  })
})
