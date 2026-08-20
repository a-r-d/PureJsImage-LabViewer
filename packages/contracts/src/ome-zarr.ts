export const OME_ZARR_READER_ID = 'purejsimage/ome-zarr' as const

export const OME_ZARR_IDENTITY_METADATA_KEY = 'omeZarrIdentity' as const

export const OME_ZARR_ROOT_METADATA_NAMES = Object.freeze([
  'zarr.json',
  '.zgroup',
  '.zattrs',
] as const)

export type OmeZarrRootMetadataName = (typeof OME_ZARR_ROOT_METADATA_NAMES)[number]

export type OmeZarrSourceKind = 'ome-zarr-remote' | 'ome-zarr-directory' | 'ome-zarr-zip'

export type OmeZarrColorModel = 'color' | 'greyscale'

export interface OmeZarrChannelDisplayState {
  readonly index: number
  readonly active: boolean
  readonly color?: number
  readonly coefficient?: number
  readonly inverted?: boolean
  readonly window?: Readonly<{ start: number; end: number }>
  readonly label?: string
}

export interface OmeZarrRootIdentityEvidence {
  readonly normalizedRootUrl?: string
  readonly selectedRootMetadataName: OmeZarrRootMetadataName
  readonly sourceIdentityStrength: 'strong' | 'weak' | 'session'
  readonly rootObjectSize: number
  readonly rootObjectValidator?: Readonly<{
    kind: 'etag' | 'version-id' | 'last-modified'
    value: string
  }>
  readonly directoryFingerprint?: string
}

export interface OmeZarrNetworkDiagnostics {
  readonly objectRequests: number
  readonly rangeRequests: number
  readonly bytesFetched: number
  readonly uniqueBytes: number
  readonly metadataBytesFetched: number
  readonly arrayBytesFetched: number
  readonly sourceCacheHits: number
  readonly sourceCacheBytes: number
  readonly coalescedConsumers: number
  readonly abortedConsumers: number
  readonly objectsOpened: number
}

export function isOmeZarrRootMetadataName(value: string): value is OmeZarrRootMetadataName {
  return (OME_ZARR_ROOT_METADATA_NAMES as readonly string[]).includes(value)
}

export function isOmeZarrSourceKind(value: string): value is OmeZarrSourceKind {
  return (
    value === 'ome-zarr-remote' || value === 'ome-zarr-directory' || value === 'ome-zarr-zip'
  )
}
