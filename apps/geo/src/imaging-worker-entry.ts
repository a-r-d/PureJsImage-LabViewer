import { ImagingWorkerHost } from '@pji-workbench/imaging'

interface ImagingWorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  postMessage(message: unknown, transfer: Transferable[]): void
}

const worker = self as unknown as ImagingWorkerScope
const host = new ImagingWorkerHost()

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
