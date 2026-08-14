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

  it('rejects unknown versions, message kinds, oversized strings, and oversized tiles', () => {
    expect(
      isRpcEnvelope({
        schemaVersion: 2,
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
  })
})
