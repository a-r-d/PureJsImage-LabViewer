import {
  createImagingWorkerClient,
  type ImagingWorkerClient,
  type ImagingWorkerClientOptions,
} from '@pji-workbench/imaging'

export function createScienceImagingWorker(): Worker {
  return new Worker(new URL('./imaging-worker-entry.ts', import.meta.url), {
    type: 'module',
    name: 'purejsimage-imaging',
  })
}

export function createScienceImagingWorkerClient(
  options: Omit<ImagingWorkerClientOptions, 'sourcePolicy' | 'workerFactory'> = {},
): ImagingWorkerClient {
  return createImagingWorkerClient({
    ...options,
    sourcePolicy: 'replace-one',
    workerFactory: createScienceImagingWorker,
  })
}
