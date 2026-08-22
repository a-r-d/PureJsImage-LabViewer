import { copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { sha256File } from './common.mjs'

function options(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag)
    return index < 0 ? undefined : argv[index + 1]
  }
  const root = value('--root')
  const selection = value('--selection')
  const destination = value('--destination')
  if (root === undefined || selection === undefined || destination === undefined)
    throw new Error(
      'Usage: import-bbbc039.mjs --root <extracted-directory> --selection <report.json> --destination <corpus-directory>',
    )
  return {
    root: path.resolve(root),
    selection: path.resolve(selection),
    destination: path.resolve(destination),
  }
}

const request = options(process.argv.slice(2))
const report = JSON.parse(await readFile(request.selection, 'utf8'))
if (report?.schemaVersion !== 1 || !Array.isArray(report.selection))
  throw new Error('BBBC039 selection report is malformed.')
if (report.selection.length !== 16)
  throw new Error(
    `BBBC039 import requires exactly 16 selected fields; received ${report.selection.length}.`,
  )
const splitCounts = Object.fromEntries(
  ['training', 'validation', 'test'].map((split) => [
    split,
    report.selection.filter((fixture) => fixture.split === split).length,
  ]),
)
if (splitCounts.training !== 8 || splitCounts.validation !== 4 || splitCounts.test !== 4)
  throw new Error(
    `BBBC039 selection must preserve the frozen 8/4/4 split; received ${JSON.stringify(splitCounts)}.`,
  )

const imageDirectory = path.join(request.destination, 'images')
const maskDirectory = path.join(request.destination, 'masks')
await mkdir(imageDirectory, { recursive: true })
await mkdir(maskDirectory, { recursive: true })
const selectedImages = new Set(report.selection.map(({ imageName }) => imageName))
const selectedMasks = new Set(report.selection.map(({ maskName }) => maskName))
for (const filename of await readdir(imageDirectory))
  if (!selectedImages.has(filename)) await unlink(path.join(imageDirectory, filename))
for (const filename of await readdir(maskDirectory))
  if (!selectedMasks.has(filename)) await unlink(path.join(maskDirectory, filename))
const imported = []
for (const fixture of report.selection) {
  const imageSource = path.join(request.root, 'images', fixture.imageName)
  const maskSource = path.join(request.root, 'masks', fixture.maskName)
  const imageDestination = path.join(imageDirectory, fixture.imageName)
  const maskDestination = path.join(maskDirectory, fixture.maskName)
  await copyFile(imageSource, imageDestination)
  await copyFile(maskSource, maskDestination)
  const [imageStat, maskStat, imageSha256, maskSha256] = await Promise.all([
    stat(imageDestination),
    stat(maskDestination),
    sha256File(pathToFileURL(imageDestination)),
    sha256File(pathToFileURL(maskDestination)),
  ])
  imported.push({
    ...fixture,
    image: { filename: fixture.imageName, sizeBytes: imageStat.size, sha256: imageSha256 },
    mask: { filename: fixture.maskName, sizeBytes: maskStat.size, sha256: maskSha256 },
  })
}
const frozen = {
  schemaVersion: 1,
  selectorVersion: 'particle-hard-case-selector-v1',
  source: report.source,
  candidates: report.candidates,
  selectionPolicy: report.selectionPolicy,
  splitCounts,
  archives: {
    images: {
      filename: 'images.zip',
      sizeBytes: 77_915_748,
      sha256: '6f30a5d4fe38c928ded972704f085975f8dc0d65d9aa366df00e5a9d449fddd7',
    },
    masks: {
      filename: 'masks.zip',
      sizeBytes: 2_753_811,
      sha256: 'f9e6043d8ca56344a4886f96a700d804d6ee982f31e2b2cd3194af2a053c2710',
    },
    metadata: {
      filename: 'metadata.zip',
      sizeBytes: 17_816,
      sha256: 'a2c1f900bed9ba92a99553efd4c2ae98598433691c7401d818653ab61110deb2',
    },
  },
  selection: imported,
}
await writeFile(
  path.join(request.destination, 'selection.v1.json'),
  `${JSON.stringify(frozen, null, 2)}\n`,
)
process.stdout.write('Imported 16 checksum-pinned BBBC039 native image/mask pairs.\n')
