import { readFile, writeFile } from 'node:fs/promises'

import { manifestUrl } from './common.mjs'

const selectionUrl = new URL(
  '../../testdata/corpus/core/native/bbbc039/selection.v1.json',
  import.meta.url,
)
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
const selection = JSON.parse(await readFile(selectionUrl, 'utf8'))
if (selection?.schemaVersion !== 1 || selection?.selection?.length !== 16)
  throw new Error('Frozen BBBC039 selection is missing or malformed.')
const source = manifest.sources.find(({ id }) => id === 'bbbc039')
if (source === undefined) throw new Error('BBBC039 source record is missing.')
const archiveRecords = [
  {
    filename: 'images.zip',
    url: 'https://data.broadinstitute.org/bbbc/BBBC039/images.zip',
    ...selection.archives.images,
    role: 'archive',
  },
  {
    filename: 'masks.zip',
    url: 'https://data.broadinstitute.org/bbbc/BBBC039/masks.zip',
    ...selection.archives.masks,
    role: 'archive',
  },
  {
    filename: 'metadata.zip',
    url: 'https://data.broadinstitute.org/bbbc/BBBC039/metadata.zip',
    ...selection.archives.metadata,
    role: 'metadata',
  },
]
source.downloads = [
  ...archiveRecords,
  ...source.downloads.filter(
    ({ filename }) => !archiveRecords.some((archive) => archive.filename === filename),
  ),
]
source.notes =
  'The official native archives are checksum-pinned. Sixteen native 16-bit TIFF and instance-mask pairs are selected deterministically across the published 8 training, 4 validation, and 4 held-out test fields in this corpus; the two web previews remain lightweight wiring fixtures.'

const splitPrefix = { training: 'train', validation: 'validation', test: 'test' }
const ordinalBySplit = { training: 0, validation: 0, test: 0 }
const nativeFixtures = selection.selection.map((entry) => {
  const prefix = splitPrefix[entry.split]
  if (prefix === undefined) throw new Error(`Unknown BBBC039 split ${entry.split}.`)
  ordinalBySplit[entry.split] += 1
  const ordinal = String(ordinalBySplit[entry.split]).padStart(2, '0')
  const borderCount = Math.round(
    entry.objectCount * (entry.features.edgeTouchingInstanceFraction ?? 0),
  )
  return {
    id: `bbbc039-native-${prefix}-${ordinal}`,
    sourceId: 'bbbc039',
    originalFilename: entry.imageName,
    sourceSha256: entry.image.sha256,
    image: {
      path: `core/native/bbbc039/images/${entry.image.filename}`,
      sha256: entry.image.sha256,
      sizeBytes: entry.image.sizeBytes,
      format: 'TIFF',
    },
    nativeFormat: 'TIFF uint16',
    derivedFormat: 'TIFF uint16 identity copy',
    dimensions: { width: 696, height: 520, channels: 1, bitDepth: 16 },
    calibration: null,
    labels: {
      instanceMask: {
        path: `core/native/bbbc039/masks/${entry.mask.filename}`,
        sha256: entry.mask.sha256,
        sizeBytes: entry.mask.sizeBytes,
        format: 'PNG RGBA indexed-instance mask',
      },
      semanticMask: null,
      ignoreMask: null,
      objectCountIncludingBorder: entry.objectCount,
      objectCountExcludingBorder: entry.objectCount - borderCount,
    },
    edgePolicy: 'include-mask-exclude-morphometry',
    derivation: [
      {
        operation: 'identity-copy-from-bbbc039-v1-archive',
        parameters: { imageArchive: 'images.zip', maskArchive: 'masks.zip' },
      },
    ],
    review: { status: 'upstream-unreviewed', reviewer: null, reviewedAt: null },
    tasks: ['instance-segmentation', 'counting', 'touching-object-separation'],
    failureModes: entry.reasons.map((reason) => `selector-${reason}`),
    split: prefix,
    domainGroup: 'bbbc039-u2os-nuclei',
    sourceSelection: {
      arrayIndex: entry.arrayIndex,
      crop: null,
      selection: {
        selectorVersion: selection.selectorVersion,
        reasons: entry.reasons,
        features: entry.features,
      },
    },
  }
})
manifest.schemaVersion = 1
manifest.corpusVersion = '0.2.0'
manifest.fixtures = [
  ...manifest.fixtures.filter(({ id }) => !id.startsWith('bbbc039-native-')),
  ...nativeFixtures,
]
await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write('Updated corpus manifest with 16 native BBBC039 fixtures.\n')
