import {
  CRS_EPSG_3857,
  CRS_EPSG_4326,
  type CrsReference,
  transformMapPoint,
} from '@pji-workbench/domain-geo'
import { ImagingWorkerHost } from '@pji-workbench/imaging'

interface ImagingWorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  postMessage(message: unknown, transfer: Transferable[]): void
}

const worker = self as unknown as ImagingWorkerScope
const host = new ImagingWorkerHost({
  profile: 'geo',
  rasterTransforms: {
    implementationIdentity: 'proj4@2.19.10',
    supports(descriptor, sourceCrs, targetCrs) {
      if (descriptor.id !== 'pji-workbench.proj4-inverse' || descriptor.version !== '1')
        return false
      return supportedCrs(sourceCrs) !== undefined && supportedCrs(targetCrs) !== undefined
    },
    transform(descriptor, sourceCrs, targetCrs, coordinate) {
      if (!this.supports(descriptor, sourceCrs, targetCrs))
        throw new Error(`Transform ${descriptor.id}@${descriptor.version} is unavailable.`)
      const source = supportedCrs(sourceCrs)
      const target = supportedCrs(targetCrs)
      if (source === undefined || target === undefined) throw new Error('CRS is unavailable.')
      const point = transformMapPoint({ x: coordinate[0], y: coordinate[1] }, source, target)
      return [point.x, point.y]
    },
  },
})

function supportedCrs(value: string): CrsReference | undefined {
  if (value === 'EPSG:4326') return CRS_EPSG_4326
  if (value === 'EPSG:3857') return CRS_EPSG_3857
  return undefined
}

worker.addEventListener('message', (event: MessageEvent<unknown>) => {
  void host.handle(event.data).then(
    ({ response, transfer }) => worker.postMessage(response, [...transfer]),
    (error: unknown) => {
      queueMicrotask(() => {
        throw error
      })
    },
  )
})
