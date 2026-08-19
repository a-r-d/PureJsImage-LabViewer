import { describe, expect, it } from 'vitest'

import {
  isRpcEnvelope,
  RPC_LIMITS,
  RPC_SCHEMA_VERSION,
  RpcValidationError,
  rpcRequest,
  validateWorkerRequest,
} from '../src/index.js'

describe('imaging RPC validation', () => {
  it('accepts every field of a bounded tile request', () => {
    const request = rpcRequest('tile-1', 'tile.request', {
      tileId: 'visible-0-0',
      datasetHandleId: 'dataset-1' as never,
      generation: 2,
      displayAxes: ['x', 'y'],
      fixedIndices: [{ axisId: 'z', index: 4 }],
      resolutionLevel: 0,
      component: 0,
      mapping: { mode: 'linear', range: 'auto' },
      region: { x: 0, y: 0, width: 256, height: 256 },
      priority: 'visible',
    })
    expect(validateWorkerRequest(request)).toEqual(request)
    expect(isRpcEnvelope(request)).toBe(true)
  })

  it('accepts optional geo display-mapping fields on a tile request', () => {
    const request = rpcRequest('tile-geo', 'tile.request', {
      tileId: 'visible-0-0',
      datasetHandleId: 'dataset-1' as never,
      generation: 1,
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      resolutionLevel: 0,
      component: 0,
      mapping: {
        mode: 'linear',
        range: 'auto',
        stretch: 'percentile',
        percentileLow: 2,
        percentileHigh: 98,
        gamma: 1.2,
        nodata: -9999,
        nodataTransparent: true,
        bands: { red: 0, green: 1, blue: 2 },
      },
      region: { x: 0, y: 0, width: 256, height: 256 },
      priority: 'visible',
    })
    expect(validateWorkerRequest(request)).toEqual(request)
  })

  it('rejects unknown versions, message kinds, oversized strings, and oversized tiles', () => {
    expect(
      isRpcEnvelope({
        schemaVersion: 1,
        requestId: 'request-1',
        kind: 'worker.initialize',
        payload: null,
      }),
    ).toBe(false)
    expect(() =>
      validateWorkerRequest({
        schemaVersion: RPC_SCHEMA_VERSION,
        requestId: 'request-1',
        kind: 'runtime.eval',
        payload: null,
      }),
    ).toThrowError(expect.objectContaining({ code: 'UNKNOWN_KIND' }))
    expect(() =>
      validateWorkerRequest(
        rpcRequest('remote-1', 'source.open-remote', {
          generation: 1,
          url: `https://example.invalid/${'x'.repeat(RPC_LIMITS.maxStringLength + 1)}`,
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
    expect(() =>
      validateWorkerRequest(
        rpcRequest('tile-2', 'tile.request', {
          tileId: 'oversized',
          datasetHandleId: 'dataset-1' as never,
          generation: 1,
          displayAxes: ['x', 'y'],
          fixedIndices: [],
          resolutionLevel: 0,
          component: 0,
          mapping: { mode: 'linear', range: 'auto' },
          region: { x: 0, y: 0, width: 513, height: 513 },
          priority: 'visible',
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
  })

  it('rejects malformed local structured-clone attachments', () => {
    expect(() =>
      validateWorkerRequest({
        schemaVersion: RPC_SCHEMA_VERSION,
        requestId: 'local-1',
        kind: 'source.open-local',
        payload: {
          generation: 1,
          primaryId: 'file-0',
          files: [{ id: 'file-0', name: 'bad.mrc', size: 4, type: '', lastModified: 0, blob: {} }],
        },
      }),
    ).toThrow(RpcValidationError)
  })

  it('accepts only bounded, content-addressed application example locators', () => {
    const valid = rpcRequest('bundled-1', 'source.open-bundled', {
      generation: 1,
      path: 'examples/real/specimen.gsf',
      name: 'specimen.gsf',
      size: 4_096,
      sha256: 'a'.repeat(64),
      mediaType: 'application/octet-stream',
    })
    expect(validateWorkerRequest(valid)).toEqual(valid)

    for (const path of ['/examples/real/specimen.gsf', '../secret.gsf', 'examples/../secret.gsf']) {
      expect(() =>
        validateWorkerRequest({ ...valid, payload: { ...valid.payload, path } }),
      ).toThrow(RpcValidationError)
    }
    expect(() =>
      validateWorkerRequest({
        ...valid,
        payload: { ...valid.payload, sha256: 'NOT-A-SHA', size: 0 },
      }),
    ).toThrow(RpcValidationError)
    expect(() =>
      validateWorkerRequest({
        ...valid,
        payload: { ...valid.payload, size: RPC_LIMITS.maxBundledSourceBytes + 1 },
      }),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
  })

  it('accepts initialize and diagnostics payloads that configure or select sources', () => {
    expect(
      validateWorkerRequest(
        rpcRequest('init-limits', 'worker.initialize', {
          limits: { maxOpenSources: 2, maxInFlightRequests: 4 },
        }),
      ),
    ).toMatchObject({ kind: 'worker.initialize' })
    expect(validateWorkerRequest(rpcRequest('diag-all', 'diagnostics.get', null))).toMatchObject({
      kind: 'diagnostics.get',
    })
    expect(
      validateWorkerRequest(
        rpcRequest('diag-one', 'diagnostics.get', { sourceId: 'source-1' as never }),
      ),
    ).toMatchObject({ kind: 'diagnostics.get' })
  })

  it('bounds analysis JSON, overlay pixels, and table pages before Worker execution', () => {
    expect(() =>
      validateWorkerRequest({
        schemaVersion: RPC_SCHEMA_VERSION,
        requestId: 'analysis-nan',
        kind: 'analysis.execute',
        payload: {
          datasetHandleId: 'dataset-1',
          generation: 1,
          graph: { schemaVersion: 1, inputs: [], nodes: [], outputs: [], invalid: Number.NaN },
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PAYLOAD' }))
    expect(() =>
      validateWorkerRequest({
        schemaVersion: RPC_SCHEMA_VERSION,
        requestId: 'analysis-page',
        kind: 'analysis.table-page',
        payload: {
          datasetHandleId: 'dataset-1',
          generation: 1,
          resultHandleId: 'result-1',
          output: 'objects',
          offset: 0,
          limit: RPC_LIMITS.maxTablePageRows + 1,
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
    expect(() =>
      validateWorkerRequest({
        schemaVersion: RPC_SCHEMA_VERSION,
        requestId: 'analysis-overlay',
        kind: 'analysis.overlay-tile',
        payload: {
          datasetHandleId: 'dataset-1',
          generation: 1,
          resultHandleId: 'result-1',
          output: 'labels',
          tileId: 'labels-0',
          selection: { displayAxes: ['x', 'y'], fixedIndices: [], resolutionLevel: 0 },
          component: 0,
          region: { x: 0, y: 0, width: 513, height: 513 },
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
    expect(() =>
      validateWorkerRequest({
        schemaVersion: RPC_SCHEMA_VERSION,
        requestId: 'analysis-series',
        kind: 'analysis.series-export',
        payload: {
          datasetHandleId: 'dataset-1',
          generation: 1,
          resultHandleId: 'result-1',
          maxRows: 10,
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PAYLOAD' }))
  })
})
