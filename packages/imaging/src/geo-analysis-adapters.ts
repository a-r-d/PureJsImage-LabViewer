import type {
  RasterNoDataPolicy,
  RasterTargetGridV1,
  RasterTransformDescriptorV1,
} from '@pji-workbench/contracts'
import type { RasterNoData } from 'purejsimage/geo'
import {
  calculateGeoWorldBounds,
  createProj4CompatibleTransformProvider,
  type GeoCoordinateTransformProvider,
  type GeoReprojectionNoData,
  type GeoReprojectionProvenance,
  type GeoSpatialReference,
  type GeoTargetGrid,
  invertGeoAffine,
  normalizeGeoTargetGrid,
} from 'purejsimage/geo'

export interface ApplicationRasterTransformAdapter {
  readonly implementationIdentity: string
  supports(
    descriptor: RasterTransformDescriptorV1,
    sourceCrs: string,
    destinationCrs: string,
  ): boolean
  transform(
    descriptor: RasterTransformDescriptorV1,
    sourceCrs: string,
    destinationCrs: string,
    coordinate: readonly [number, number],
  ): readonly [number, number]
}

export interface RasterTargetGridAdapterOptions {
  readonly crs?: GeoSpatialReference
  readonly sampleType?: GeoTargetGrid['sampleType']
  readonly noData?: RasterNoDataPolicy
  readonly componentCount?: number
  readonly sourceBands?: readonly number[]
}

export interface ApplicationGeoTransformProvenance {
  readonly descriptorId: string
  readonly descriptorVersion: string
  readonly transformIdentity: string
  readonly implementationIdentity: string
  readonly accuracy: RasterTransformDescriptorV1['accuracy'] | Readonly<{ kind: 'unknown' }>
  readonly warnings: readonly string[]
}

export function rasterTargetGridToGeoTargetGrid(
  value: RasterTargetGridV1,
  options: Readonly<RasterTargetGridAdapterOptions> = {},
): GeoTargetGrid {
  const crs =
    options.crs !== undefined && spatialReferenceMatches(options.crs, value.crs)
      ? options.crs
      : spatialReferenceFromApplicationCrs(value.crs)
  const pixelRegistration =
    value.pixelInterpretation === 'area' ? ('pixel-is-area' as const) : ('pixel-is-point' as const)
  const bounds = calculateGeoWorldBounds(value.affine, value.width, value.height, pixelRegistration)
  const authoredBounds = {
    minX: value.extent[0],
    minY: value.extent[1],
    maxX: value.extent[2],
    maxY: value.extent[3],
  }
  if (!sameBounds(bounds, authoredBounds))
    throw new Error('Raster target extent does not exactly match its affine grid bounds.')
  const worldToPixel = invertGeoAffine(value.affine)
  if (worldToPixel === undefined) throw new Error('Raster target affine must be invertible.')
  const componentCount = options.componentCount ?? options.sourceBands?.length ?? 1
  return normalizeGeoTargetGrid({
    schemaVersion: 1,
    crs,
    width: value.width,
    height: value.height,
    pixelToWorld: value.affine,
    worldToPixel,
    pixelRegistration,
    bounds,
    sampleType: options.sampleType ?? value.sampleType,
    noData: rasterNoDataToPackage(options.noData ?? value.noData),
    bandLayout: {
      componentCount,
      layout: 'interleaved',
      ...(options.sourceBands === undefined ? {} : { sourceBands: options.sourceBands }),
    },
  })
}

export function geoTargetGridToRasterTargetGrid(
  value: Readonly<GeoTargetGrid>,
  options: Readonly<{ crs?: string; resampling: RasterTargetGridV1['resampling'] }>,
): RasterTargetGridV1 {
  const grid = normalizeGeoTargetGrid(value)
  const crs = options.crs ?? applicationCrsFromSpatialReference(grid.crs)
  return {
    schemaVersion: 1,
    crs,
    width: grid.width,
    height: grid.height,
    affine: grid.pixelToWorld,
    pixelInterpretation: grid.pixelRegistration === 'pixel-is-area' ? 'area' : 'point',
    extent: [grid.bounds.minX, grid.bounds.minY, grid.bounds.maxX, grid.bounds.maxY],
    sampleType: grid.sampleType,
    noData: packageRasterNoDataToApplication(grid.noData),
    resampling: options.resampling,
  }
}

export function rasterNoDataToGeoReprojectionNoData(
  value: RasterNoDataPolicy,
): GeoReprojectionNoData {
  if (value.kind === 'integer64')
    return { kind: 'integer64', value: canonicalInteger64(value.value) }
  return rasterNoDataToPackage(value)
}

export function createApplicationGeoTransformProvider(
  adapter: ApplicationRasterTransformAdapter,
  descriptor: RasterTransformDescriptorV1,
  sourceCrs: string,
  destinationCrs: string,
): GeoCoordinateTransformProvider {
  if (!adapter.supports(descriptor, sourceCrs, destinationCrs))
    throw new Error(`Transform ${descriptor.id}@${descriptor.version} is unavailable.`)
  return createProj4CompatibleTransformProvider(
    {
      transform(from, to, coordinate) {
        return adapter.transform(descriptor, from, to, coordinate)
      },
    },
    { implementationIdentity: adapter.implementationIdentity, accuracy: descriptor.accuracy },
  )
}

export function geoReprojectionProvenanceToApplication(
  value: Readonly<GeoReprojectionProvenance>,
  descriptor: RasterTransformDescriptorV1,
): ApplicationGeoTransformProvenance {
  return {
    descriptorId: descriptor.id,
    descriptorVersion: descriptor.version,
    transformIdentity: value.transform.transformIdentity,
    implementationIdentity: value.transform.implementationIdentity,
    accuracy: value.transform.accuracy,
    warnings: [...value.transform.warnings],
  }
}

export function spatialReferenceMatches(reference: GeoSpatialReference, crs: string): boolean {
  return applicationCrsFromSpatialReference(reference) === crs
}

export function applicationCrsFromSpatialReference(reference: GeoSpatialReference): string {
  if (reference.authority !== undefined && reference.code !== undefined)
    return `${reference.authority.toUpperCase()}:${String(reference.code)}`
  if (reference.wkt2 !== undefined) return reference.wkt2
  if (reference.name !== undefined) return reference.name
  throw new Error('Geo spatial reference cannot be projected to an application CRS string.')
}

function spatialReferenceFromApplicationCrs(value: string): GeoSpatialReference {
  const identified = /^([A-Za-z][A-Za-z0-9_-]*):([0-9]+)$/u.exec(value)
  const authority = identified?.[1]?.toUpperCase()
  const codeText = identified?.[2]
  const code = codeText === undefined ? undefined : Number(codeText)
  const geographic = authority === 'EPSG' && code === 4326
  return {
    schemaVersion: 1,
    coordinateSystemType: geographic ? 'geographic' : code === undefined ? 'unknown' : 'projected',
    ...(authority === undefined ? {} : { authority }),
    ...(code === undefined ? {} : { code }),
    name: value,
    formalAxes: [],
    applicationAxes: { x: { name: 'x' }, y: { name: 'y' } },
    evidence: [{ kind: 'user-supplied', sourceId: 'derived-raster-v1', locator: 'targetGrid.crs' }],
    state: code === undefined ? 'incomplete' : 'complete',
    diagnostics: [],
  }
}

function rasterNoDataToPackage(value: RasterNoDataPolicy): RasterNoData {
  if (value.kind === 'integer64')
    throw new Error('Geo target grids cannot encode exact 64-bit nodata without information loss.')
  return value.kind === 'value' ? { kind: 'value', value: value.value } : { kind: value.kind }
}

function packageRasterNoDataToApplication(value: RasterNoData): RasterNoDataPolicy {
  return value.kind === 'value' ? { kind: 'value', value: value.value } : { kind: value.kind }
}

function canonicalInteger64(value: string): string {
  if (!/^-?(?:0|[1-9][0-9]*)$/u.test(value) || BigInt(value).toString() !== value)
    throw new Error('Exact 64-bit nodata must be a canonical decimal integer string.')
  const number = BigInt(value)
  if (number < -(1n << 63n) || number > (1n << 64n) - 1n)
    throw new Error('Exact 64-bit nodata is outside the signed and unsigned 64-bit ranges.')
  return value
}

function sameBounds(
  left: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>,
  right: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>,
): boolean {
  return (
    left.minX === right.minX &&
    left.minY === right.minY &&
    left.maxX === right.maxX &&
    left.maxY === right.maxY
  )
}
