import { afterEach, describe, expect, it, vi } from 'vitest'

import { captureBoundedScreenPreview, createBoundedPngPreview } from '../src/model-preview.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('bounded model previews', () => {
  it('rejects invalid dimensions and pixel budgets before decoding', async () => {
    const source = new Blob()
    await expect(createBoundedPngPreview(source, { width: 1_025, height: 1 })).rejects.toThrow(
      /width must be an integer/,
    )
    await expect(
      createBoundedPngPreview(source, { width: 100, height: 100, maximumPixels: 9_999 }),
    ).rejects.toThrow(/pixel limit/)
  })

  it('closes decoded bitmaps when the encoded preview exceeds its byte budget', async () => {
    const close = vi.fn()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 10, height: 10, close })),
    )
    vi.stubGlobal('document', {
      createElement: (name: string) => {
        if (name !== 'canvas') throw new Error(`Unexpected element: ${name}`)
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            fillStyle: '',
            fillRect: vi.fn(),
            drawImage: vi.fn(),
          }),
          toBlob: (callback: (value: Blob) => void) =>
            callback(new Blob([new Uint8Array(8)], { type: 'image/png' })),
        }
      },
    })

    await expect(
      createBoundedPngPreview(new Blob(), { width: 10, height: 10, maxBytes: 7 }),
    ).rejects.toThrow(/7-byte limit/)
    expect(close).toHaveBeenCalledOnce()
  })

  it('stops a display track that arrives after screen capture is cancelled', async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined
    const requested = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve
    })
    const stop = vi.fn()
    vi.stubGlobal('navigator', {
      mediaDevices: { getDisplayMedia: vi.fn(() => requested) },
    })
    vi.stubGlobal('document', {
      createElement: (name: string) => {
        if (name !== 'video') throw new Error(`Unexpected element: ${name}`)
        return { pause: vi.fn(), srcObject: null }
      },
    })
    const controller = new AbortController()
    const capture = captureBoundedScreenPreview({ width: 64, height: 64 }, controller.signal)
    controller.abort(new DOMException('Cancelled', 'AbortError'))

    await expect(capture).rejects.toMatchObject({ name: 'AbortError' })
    resolveStream?.({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
  })
})
