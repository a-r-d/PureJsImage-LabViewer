import {
  isOmeZarrRootMetadataName,
  type OmeZarrRootMetadataName,
  RpcValidationError,
} from '@pji-workbench/contracts'
import { normalizeScientificRelativeName } from 'purejsimage/scientific'

const ROOT_METADATA_PREFERENCE: readonly OmeZarrRootMetadataName[] = [
  'zarr.json',
  '.zgroup',
  '.zattrs',
]

export function omeZarrRelativePath(file: File): string {
  const relative = file.webkitRelativePath
  const raw = typeof relative === 'string' && relative.length > 0 ? relative : file.name
  return normalizeScientificRelativeName(raw.replaceAll('\\', '/'))
}

export function omeZarrStoreRoots(relativePaths: readonly string[]): readonly string[] {
  const prefixes = new Set<string>()
  for (const relativePath of relativePaths) {
    const normalized = normalizeScientificRelativeName(relativePath.replaceAll('\\', '/'))
    const slash = normalized.lastIndexOf('/')
    const name = slash < 0 ? normalized : normalized.slice(slash + 1)
    if (!isOmeZarrRootMetadataName(name)) continue
    prefixes.add(slash < 0 ? '' : normalized.slice(0, slash))
  }
  return [...prefixes]
    .filter(
      (prefix) =>
        ![...prefixes].some(
          (other) => other !== prefix && (other === '' || prefix.startsWith(`${other}/`)),
        ),
    )
    .sort()
}

export function selectOmeZarrDirectoryRoot(
  files: readonly File[],
  requestedRoot?: string,
): Readonly<{
  root: string
  metadataName: OmeZarrRootMetadataName
  primary: File
  members: readonly File[]
}> {
  if (files.length === 0) {
    throw new RpcValidationError('INVALID_PAYLOAD', 'OME-Zarr directory is empty.')
  }
  const relativePaths = files.map(omeZarrRelativePath)
  const roots = omeZarrStoreRoots(relativePaths)
  if (roots.length === 0) {
    throw new RpcValidationError(
      'INVALID_PAYLOAD',
      'OME-Zarr directory is missing zarr.json, .zgroup, or .zattrs.',
    )
  }
  const requested =
    requestedRoot === undefined || requestedRoot.length === 0
      ? undefined
      : normalizeScientificRelativeName(requestedRoot)
  if (requested !== undefined && !roots.includes(requested)) {
    throw new RpcValidationError(
      'INVALID_PAYLOAD',
      'The selected OME-Zarr store root is not present in the directory.',
    )
  }
  const root = requested ?? (roots.length === 1 ? (roots[0] ?? '') : undefined)
  if (root === undefined) {
    throw new RpcValidationError(
      'INVALID_PAYLOAD',
      'OME-Zarr directory contains multiple store roots. Select one primary root.',
    )
  }
  const prefix = root.length === 0 ? '' : `${root}/`
  const members = files.filter((file) => {
    const relative = omeZarrRelativePath(file)
    return root === '' ? true : relative === root || relative.startsWith(prefix)
  })
  const metadataName = ROOT_METADATA_PREFERENCE.find((name) =>
    members.some((file) => omeZarrRelativePath(file) === `${prefix}${name}`),
  )
  const primary = members.find(
    (file) => omeZarrRelativePath(file) === `${prefix}${metadataName ?? ''}`,
  )
  if (metadataName === undefined || primary === undefined) {
    throw new RpcValidationError(
      'INVALID_PAYLOAD',
      'OME-Zarr directory is missing a unique root metadata object.',
    )
  }
  return { root, metadataName, primary, members }
}

export function storeRelativeOmeZarrFile(file: File, storeRoot: string): File {
  const relative = omeZarrRelativePath(file)
  const prefix = storeRoot.length === 0 ? '' : `${storeRoot}/`
  const name =
    storeRoot.length === 0
      ? relative
      : relative === storeRoot
        ? relative.slice(relative.lastIndexOf('/') + 1)
        : relative.startsWith(prefix)
          ? relative.slice(prefix.length)
          : relative
  return new File([file], name, { type: file.type, lastModified: file.lastModified })
}

export async function omeZarrDirectoryFingerprint(
  files: readonly Readonly<{ relativePath: string; size: number }>[],
): Promise<string> {
  const lines = files
    .map(({ relativePath, size }) => `${normalizeScientificRelativeName(relativePath)}\0${size}`)
    .sort()
    .join('\n')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lines))
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
