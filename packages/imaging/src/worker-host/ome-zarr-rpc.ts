import {
  type LocalFileAttachment,
  OME_ZARR_IDENTITY_METADATA_KEY,
  OME_ZARR_READER_ID,
  type OmeZarrNetworkDiagnostics,
  type OmeZarrRootIdentityEvidence,
  type OmeZarrRootMetadataName,
  RpcValidationError,
} from '@pji-workbench/contracts'
import { createScientificLibrary } from 'purejsimage/scientific'
import {
  createOmeZarrHttpContext,
  createScientificFileContext,
  normalizeOmeZarrStoreUrl,
  type OmeZarrHttpStore,
  type OmeZarrHttpStoreIdentitySummary,
} from 'purejsimage/scientific/browser'
import { wrapFetchToExposeContentRange } from '../cors-range-fetch.js'
import { selectOmeZarrDirectoryRoot, storeRelativeOmeZarrFile } from '../ome-zarr-directory.js'
import { loadOmeZarrReader } from '../worker-readers.js'

export function durableOmeZarrRootUrl(input: string | URL): string {
  const normalized = normalizeOmeZarrStoreUrl(input)
  const url = new URL(normalized.storeRootUrl)
  url.search = ''
  url.hash = ''
  url.username = ''
  url.password = ''
  return url.href.endsWith('/') ? url.href : `${url.href}/`
}

export function filesFromOmeZarrAttachments(attachments: readonly LocalFileAttachment[]): File[] {
  return attachments.map(
    (attachment) =>
      new File([attachment.blob as Blob], attachment.relativePath ?? attachment.name, {
        type: attachment.type,
        lastModified: attachment.lastModified,
      }),
  )
}

export async function openOmeZarrScientificDocument(
  primary: File,
  companions: readonly File[],
  signal: AbortSignal,
) {
  const readers = [await loadOmeZarrReader()]
  return createScientificLibrary({ readers }).open(
    createScientificFileContext(primary, {
      companions,
      readerId: OME_ZARR_READER_ID,
      signal,
    }),
  )
}

export async function openOmeZarrHttpDocument(
  url: string,
  options: Readonly<{
    fetch?: typeof fetch
    signal: AbortSignal
    maxCacheBytesPerSource: number
    blockBytes: number
  }>,
): Promise<
  Readonly<{
    document: Awaited<ReturnType<typeof openOmeZarrScientificDocument>>
    store: OmeZarrHttpStore
  }>
> {
  const storeContext = await createOmeZarrHttpContext(url, {
    fetch: wrapFetchToExposeContentRange(options.fetch ?? globalThis.fetch.bind(globalThis)),
    signal: options.signal,
    maxCacheBytesPerSource: options.maxCacheBytesPerSource,
    blockBytes: options.blockBytes,
  })
  const readers = [await loadOmeZarrReader()]
  const document = await createScientificLibrary({ readers }).open({
    ...storeContext,
    readerId: OME_ZARR_READER_ID,
    signal: options.signal,
  })
  return { document, store: storeContext.store }
}

export function omeZarrIdentityEvidence(
  summary: OmeZarrHttpStoreIdentitySummary,
  extras: Readonly<{
    directoryFingerprint?: string
    selectedRootMetadataName?: OmeZarrRootMetadataName
  }> = {},
): OmeZarrRootIdentityEvidence {
  const name = extras.selectedRootMetadataName ?? summary.selectedRootMetadataObject
  if (name !== 'zarr.json' && name !== '.zgroup' && name !== '.zattrs') {
    throw new RpcValidationError('INVALID_PAYLOAD', 'OME-Zarr root metadata name is unsupported.')
  }
  return {
    normalizedRootUrl: durableOmeZarrRootUrl(summary.normalizedRootUrl),
    selectedRootMetadataName: name,
    sourceIdentityStrength: summary.sourceIdentityStrength,
    rootObjectSize: summary.rootObjectSize,
    ...(summary.rootObjectValidator === undefined
      ? {}
      : { rootObjectValidator: summary.rootObjectValidator }),
    ...(extras.directoryFingerprint === undefined
      ? {}
      : { directoryFingerprint: extras.directoryFingerprint }),
  }
}

export function directoryOmeZarrIdentity(
  selectedRootMetadataName: OmeZarrRootMetadataName,
  directoryFingerprint: string,
  rootObjectSize: number,
): OmeZarrRootIdentityEvidence {
  return {
    selectedRootMetadataName,
    sourceIdentityStrength: 'session',
    rootObjectSize,
    directoryFingerprint,
  }
}

export function zipOmeZarrIdentity(
  selectedRootMetadataName: OmeZarrRootMetadataName,
  rootObjectSize: number,
): OmeZarrRootIdentityEvidence {
  return {
    selectedRootMetadataName,
    sourceIdentityStrength: 'weak',
    rootObjectSize,
  }
}

export function omeZarrNetworkFromStore(store: OmeZarrHttpStore): OmeZarrNetworkDiagnostics {
  return store.stats()
}

export function omeZarrIdentityMetadata(
  evidence: OmeZarrRootIdentityEvidence | undefined,
): Readonly<Record<string, unknown>> {
  if (evidence === undefined) return {}
  return { [OME_ZARR_IDENTITY_METADATA_KEY]: evidence }
}

export function directoryMembersForOpen(
  files: readonly File[],
  storeRoot: string,
): Readonly<{
  primary: File
  members: readonly File[]
  metadataName: OmeZarrRootMetadataName
  root: string
}> {
  const selected = selectOmeZarrDirectoryRoot(files, storeRoot)
  return {
    root: selected.root,
    metadataName: selected.metadataName,
    primary: storeRelativeOmeZarrFile(selected.primary, selected.root),
    members: selected.members.map((file) => storeRelativeOmeZarrFile(file, selected.root)),
  }
}
