import { WorkbenchActionHost } from '@pji-workbench/actions'
import type { DisplayMapping, OpenedSourceDescriptor } from '@pji-workbench/contracts'
import { createEmptyWorkspace } from '@pji-workbench/workspace'
import { describe, expect, it, vi } from 'vitest'

import {
  createScienceActionHandlers,
  displayChannelsDescription,
  omeZarrDatasetDescription,
  omeZarrDatasetList,
  omeZarrNetworkDescription,
  omeZarrStorageDescription,
  omeZarrStoreDescription,
  type ScienceActionPorts,
  workbenchActionRegistry,
} from '../src/index.js'

const SOURCE = {
  source: { kind: 'ome-zarr-remote', name: 'store', size: 32 },
  reader: { id: 'purejsimage/ome-zarr', version: '1.1.0', format: 'OME-Zarr' },
  metadata: { omeNgffVersion: '0.5', zarrFormat: 3, omeZarrIdentity: { rootObjectSize: 32 } },
} as unknown as OpenedSourceDescriptor

function ports(overrides: Partial<ScienceActionPorts> = {}): ScienceActionPorts {
  const workspace = createEmptyWorkspace('OME-Zarr fixture')
  const mapping: DisplayMapping = {
    mode: 'linear',
    range: 'auto',
    colorModel: 'color',
    omeZarrChannels: [{ index: 0, active: true, color: 0xff0000, coefficient: 1, inverted: false }],
  }
  return {
    openSample: vi.fn(),
    requestLocalFiles: vi.fn(),
    requestRemoteUrl: vi.fn(),
    requestOmeZarrRemoteUrl: vi.fn(),
    requestOmeZarrDirectory: vi.fn(),
    requestOmeZarrZip: vi.fn(),
    newProject: vi.fn(),
    openProjectBrowser: vi.fn(),
    saveProject: vi.fn(),
    exportProject: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    fitViewport: vi.fn(),
    oneToOneViewport: vi.fn(),
    openAgentPanel: vi.fn(),
    previewThreshold: vi.fn(),
    commitThreshold: vi.fn(),
    planConnectedComponents: vi.fn(),
    runConnectedComponents: vi.fn(),
    toggleTheme: vi.fn(),
    openPalette: vi.fn(),
    cancelAnalysis: vi.fn(),
    currentWorkspace: () => workspace,
    openedDataset: () => undefined,
    currentSelection: () => undefined,
    calibratedDataset: () => undefined,
    analysisCatalog: () => undefined,
    resolveCatalogOperation: () => undefined,
    executeAnalysisGraph: async () => undefined,
    wholePlaneRoi: () => {
      throw new Error('not used')
    },
    runToolboxOperation: async () => undefined,
    workspaceSummary: () => ({ revision: 0 }),
    sourceList: () => [],
    datasetList: () => [],
    datasetDescription: () => ({}),
    roiList: () => [],
    analysisCatalogSummary: () => ({ operations: [] }),
    analysisDescription: () => ({}),
    resultSummary: () => ({ available: false }),
    resultPage: async () => ({ rows: [] }),
    viewportState: () => ({ mounted: false }),
    particleSettings: () => ({ settings: {} }),
    planParticleAnalysis: async () => ({ valid: true }),
    executeParticleAnalysis: async () => ({ status: 'completed' }),
    particleQuality: () => ({ available: false }),
    runNamedAnalysis: async () => ({ status: 'completed' }),
    createModelPreview: async () => ({
      scope: 'viewport',
      agentArtifact: { kind: 'image', mimeType: 'image/png', bytes: 68 },
    }),
    omeZarrStoreDescription: () => omeZarrStoreDescription(SOURCE, workspace),
    omeZarrDatasetList: () => omeZarrDatasetList(workspace),
    omeZarrDatasetDescription: (input) =>
      omeZarrDatasetDescription(
        workspace,
        typeof input === 'object' && input !== null && 'datasetId' in input
          ? String(input.datasetId)
          : undefined,
      ),
    omeZarrStorageDescription: () => omeZarrStorageDescription(workspace),
    omeZarrNetworkDescription: () =>
      omeZarrNetworkDescription({
        id: 'src' as never,
        kind: 'ome-zarr-remote',
        size: 32,
        revision: 1,
        rangeRequests: 2,
        rangeBytesFetched: 64,
        rangeCacheBytes: 16,
        rangeCacheHits: 1,
        rangeCacheMisses: 1,
        uniqueBytes: 48,
        openDatasets: 1,
        omeZarrNetwork: {
          objectRequests: 3,
          rangeRequests: 2,
          bytesFetched: 64,
          uniqueBytes: 48,
          metadataBytesFetched: 16,
          arrayBytesFetched: 48,
          sourceCacheHits: 1,
          sourceCacheBytes: 16,
          coalescedConsumers: 0,
          abortedConsumers: 0,
          objectsOpened: 1,
        },
      }),
    displayChannels: () => displayChannelsDescription(mapping),
    setDisplayChannels: () => displayChannelsDescription(mapping),
    selectDataset: () => ({ selected: true }),
    selectPlane: () => ({ selected: true }),
    normalizeAnalysis: async () => ({ valid: true }),
    dryRunAnalysis: async () => ({ valid: true }),
    selectRoi: () => ({ selected: true }),
    removeRoi: () => ({ removed: true }),
    removePipelineNode: () => ({ removed: true }),
    selectPanel: () => ({ selected: true }),
    createRoi: async () => ({ created: true }),
    updateRoi: async () => ({ updated: true }),
    ...overrides,
  }
}

describe('OME-Zarr semantic actions', () => {
  it('exposes bounded describe actions without chunk bytes', async () => {
    const host = new WorkbenchActionHost(
      workbenchActionRegistry,
      createScienceActionHandlers(ports()),
    )
    const signal = { aborted: false, throwIfAborted: () => undefined }
    const context = { hasDataset: true }
    const store = await host.execute('ome-zarr.store.describe', 1, {}, context, signal)
    const network = await host.execute('ome-zarr.network.describe', 1, {}, context, signal)
    const preview = await host.execute(
      'viewport.preview.create',
      1,
      { scope: 'viewport', width: 64, height: 64 },
      context,
      signal,
    )
    const serialized = JSON.stringify({ store, network, preview })
    expect(serialized).not.toMatch(/chunkBytes|Uint8Array|ArrayBuffer/u)
    expect(store).toMatchObject({ untrusted: true, omeNgffVersion: '0.5' })
    expect(network).toMatchObject({ objectRequests: 3, arrayBytes: 48 })
    expect(preview).toMatchObject({ scope: 'viewport' })
  })

  it('opens remote and local OME-Zarr through picker ports', async () => {
    const requestOmeZarrRemoteUrl = vi.fn()
    const requestOmeZarrDirectory = vi.fn()
    const requestOmeZarrZip = vi.fn()
    const host = new WorkbenchActionHost(
      workbenchActionRegistry,
      createScienceActionHandlers(
        ports({ requestOmeZarrRemoteUrl, requestOmeZarrDirectory, requestOmeZarrZip }),
      ),
    )
    const signal = { aborted: false, throwIfAborted: () => undefined }
    const context = { hasDataset: false }
    await host.execute('source.open-ome-zarr-remote', 1, {}, context, signal)
    await host.execute(
      'source.open-ome-zarr-local-resource',
      1,
      { kind: 'directory' },
      context,
      signal,
    )
    await host.execute('source.open-ome-zarr-local-resource', 1, { kind: 'zip' }, context, signal)
    expect(requestOmeZarrRemoteUrl).toHaveBeenCalledOnce()
    expect(requestOmeZarrDirectory).toHaveBeenCalledOnce()
    expect(requestOmeZarrZip).toHaveBeenCalledOnce()
  })
})
