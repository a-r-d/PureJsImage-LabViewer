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
  rasterTransforms: {
    resolve(descriptor, sourceCrs, targetCrs) {
      if (descriptor.id !== 'pji-workbench.proj4-inverse' || descriptor.version !== '1')
        return undefined
      const source = supportedCrs(sourceCrs)
      const target = supportedCrs(targetCrs)
      if (source === undefined || target === undefined) return undefined
      return {
        descriptor,
        inverse(targetX, targetY) {
          const point = transformMapPoint({ x: targetX, y: targetY }, target, source)
          return [point.x, point.y]
        },
      }
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
