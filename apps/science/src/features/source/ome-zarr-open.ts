import type { OpenedSourceDescriptor } from '@pji-workbench/contracts'
import { isOmeZarrRootMetadataName, OME_ZARR_IDENTITY_METADATA_KEY } from '@pji-workbench/contracts'
import { omeZarrDirectoryFingerprint, selectOmeZarrDirectoryRoot } from '@pji-workbench/imaging'
import {
  omeZarrDirectorySourceLocator,
  omeZarrRemoteSourceLocator,
  omeZarrZipSourceLocator,
} from '@pji-workbench/workbench-core'
import type { WorkspaceSourceReference } from '@pji-workbench/workspace'

export function omeZarrOpenErrorCopy(error: unknown): string {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'detail' in error &&
    typeof error.detail === 'object' &&
    error.detail !== null &&
    'code' in error.detail &&
    typeof error.detail.code === 'string'
      ? error.detail.code
      : undefined
  if (code === 'CORS_FAILED' || code === 'CORS_OR_RANGE_UNAVAILABLE') {
    return 'The OME-Zarr store blocked this origin. Confirm CORS allows GET with Range from this application.'
  }
  if (code === 'RANGE_UNSUPPORTED') {
    return 'The OME-Zarr store must answer Range requests with HTTP 206 and a Content-Range header.'
  }
  if (code === 'UNSUPPORTED') {
    return 'This OME-Zarr store uses an unsupported codec or NGFF feature.'
  }
  if (code === 'MALFORMED_METADATA') {
    return 'The OME-Zarr NGFF metadata is malformed and cannot be opened.'
  }
  if (code === 'LIMIT_EXCEEDED') {
    return 'The OME-Zarr store exceeds the workbench resource limits.'
  }
  if (
    code === 'INVALID_PAYLOAD' &&
    error instanceof Error &&
    /multiple store roots/iu.test(error.message)
  ) {
    return 'The directory contains multiple OME-Zarr store roots. Select one primary root.'
  }
  return error instanceof Error ? error.message : 'Unable to open the OME-Zarr source.'
}

export function locatorForOpenedOmeZarr(
  source: OpenedSourceDescriptor,
  files: readonly File[] = [],
): WorkspaceSourceReference['locator'] {
  const evidence = source.metadata[OME_ZARR_IDENTITY_METADATA_KEY]
  const record =
    typeof evidence === 'object' && evidence !== null && !Array.isArray(evidence)
      ? (evidence as Readonly<Record<string, unknown>>)
      : undefined
  const metadataName =
    typeof record?.['selectedRootMetadataName'] === 'string' &&
    isOmeZarrRootMetadataName(record['selectedRootMetadataName'])
      ? record['selectedRootMetadataName']
      : 'zarr.json'
  const strength =
    record?.['sourceIdentityStrength'] === 'strong' ||
    record?.['sourceIdentityStrength'] === 'weak' ||
    record?.['sourceIdentityStrength'] === 'session'
      ? record['sourceIdentityStrength']
      : 'session'
  if (source.source.kind === 'ome-zarr-remote') {
    const validator = record?.['rootObjectValidator']
    return omeZarrRemoteSourceLocator(source.source.url ?? '', {
      selectedRootMetadataName: metadataName,
      sourceIdentityStrength: strength,
      rootObjectSize:
        typeof record?.['rootObjectSize'] === 'number'
          ? record['rootObjectSize']
          : source.source.size,
      ...(typeof validator === 'object' &&
      validator !== null &&
      !Array.isArray(validator) &&
      (validator as { kind?: unknown }).kind !== undefined
        ? {
            rootObjectValidator: validator as {
              kind: 'etag' | 'version-id' | 'last-modified'
              value: string
            },
          }
        : {}),
    })
  }
  if (source.source.kind === 'ome-zarr-zip') {
    const archive = files[0]
    return omeZarrZipSourceLocator({
      name: archive?.name ?? source.source.name,
      size: archive?.size ?? source.source.size,
      lastModified: archive?.lastModified ?? 0,
    })
  }
  const selected = files.length === 0 ? undefined : selectOmeZarrDirectoryRoot(files)
  return omeZarrDirectorySourceLocator(
    selected?.root || metadataName,
    selected?.metadataName ?? metadataName,
    typeof record?.['directoryFingerprint'] === 'string' ? record['directoryFingerprint'] : '',
  )
}

export async function filesFromDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  prefix = '',
): Promise<File[]> {
  const files: File[] = []
  for await (const [name, entry] of handle.entries()) {
    const relative = prefix.length === 0 ? name : `${prefix}/${name}`
    if (entry.kind === 'file') {
      const file = await entry.getFile()
      files.push(new File([file], relative, { type: file.type, lastModified: file.lastModified }))
    } else {
      files.push(...(await filesFromDirectoryHandle(entry, relative)))
    }
  }
  return files
}

export async function withOmeZarrOpenError<T>(opener: () => Promise<T>): Promise<T> {
  try {
    return await opener()
  } catch (error) {
    throw new Error(omeZarrOpenErrorCopy(error))
  }
}

export async function pickOmeZarrDirectoryFiles(): Promise<readonly File[] | undefined> {
  const picker = (
    window as Window & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
    }
  ).showDirectoryPicker
  if (typeof picker !== 'function') return undefined
  const handle = await picker.call(window)
  return filesFromDirectoryHandle(handle)
}

export async function directoryFingerprintForFiles(files: readonly File[]): Promise<string> {
  return omeZarrDirectoryFingerprint(
    files.map((file) => ({
      relativePath:
        typeof file.webkitRelativePath === 'string' && file.webkitRelativePath.length > 0
          ? file.webkitRelativePath
          : file.name,
      size: file.size,
    })),
  )
}
