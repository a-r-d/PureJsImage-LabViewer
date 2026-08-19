import {
  createImagingWorkerClient,
  type ImagingWorkerClient,
  type ImagingWorkerClientOptions,
} from '@pji-workbench/imaging'

export function createGeoImagingWorker(): Worker {
  return new Worker(new URL('./imaging-worker-entry.ts', import.meta.url), {
    type: 'module',
    name: 'purejsimage-imaging',
  })
}

export function createGeoImagingWorkerClient(
  options: Omit<ImagingWorkerClientOptions, 'sourcePolicy' | 'workerFactory'> = {},
): ImagingWorkerClient {
  return createImagingWorkerClient({
    ...options,
    sourcePolicy: 'retain',
    workerFactory: createGeoImagingWorker,
  })
}
