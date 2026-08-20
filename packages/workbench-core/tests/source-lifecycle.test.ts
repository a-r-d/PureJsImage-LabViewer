import type { OpenedDatasetDescriptor, OpenedSourceDescriptor } from '@pji-workbench/contracts'
import type { SemanticSourceId, WorkspaceMutation } from '@pji-workbench/workspace'
import { describe, expect, it } from 'vitest'

import {
  commitOpenedSource,
  createProject,
  datasetSelectMutation,
  formatOpenSourceError,
  localSourceLocator,
  omeZarrDirectorySourceLocator,
  omeZarrRemoteSourceLocator,
  omeZarrZipSourceLocator,
  remoteSourceLocator,
  sampleSourceLocator,
  sourceRebindMutation,
} from '../src/index.js'

const IDENTITY = { kind: 'application-defined', namespace: 'test', value: 'opened' }

function openedSource(): OpenedSourceDescriptor {
  return {
    sourceId: 'src-1' as OpenedSourceDescriptor['sourceId'],
    documentId: 'doc-1' as OpenedSourceDescriptor['documentId'],
    generation: 1,
    identity: IDENTITY,
    source: { kind: 'sample', name: 'particles.gsf', size: 128 },
    reader: { id: 'purejsimage/gsf', version: '1.0.0', format: 'Gwyddion Simple Field' },
    metadata: {},
    datasets: [
      {
        id: 'dataset-a',
        identity: IDENTITY,
        name: 'Plane A',
        sampleType: 'scalar',
        axes: [
          { id: 'y', kind: 'spatial', length: 8, coordinates: { type: 'index' } },
          { id: 'x', kind: 'spatial', length: 8, coordinates: { type: 'index' } },
        ],
        components: [{ id: 'intensity', kind: 'intensity' }],
        levels: [
          {
            level: 0,
            axisLengths: [
              { axisId: 'y', length: 8 },
              { axisId: 'x', length: 8 },
            ],
          },
        ],
        capabilities: {
          regionReads: true,
          resolutionLevels: false,
          planeReads: { kind: 'any-axis-pair' },
        },
      },
    ],
  }
}

function openedDataset(): OpenedDatasetDescriptor {
  const source = openedSource()
  const dataset = source.datasets[0]
  if (dataset === undefined) throw new Error('expected dataset')
  return {
    handleId: 'handle-1' as OpenedDatasetDescriptor['handleId'],
    generation: 1,
    dataset,
    selection: { displayAxes: ['x', 'y'], fixedIndices: [], resolutionLevel: 0 },
  }
}

describe('source lifecycle', () => {
  it('builds locators for science source adapters including OME-Zarr', () => {
    expect(sampleSourceLocator('generated.calibrated-particles')).toEqual({
      kind: 'sample',
      sampleId: 'generated.calibrated-particles',
    })
    expect(remoteSourceLocator('https://example.test/file.tif')).toEqual({
      kind: 'remote',
      url: 'https://example.test/file.tif',
    })
    expect(
      localSourceLocator([
        { name: 'a.tif', size: 10, lastModified: 1 },
        { name: 'a.xml', size: 2, lastModified: 1 },
      ]),
    ).toEqual({
      kind: 'local',
      name: 'a.tif',
      size: 10,
      lastModified: 1,
      companionNames: ['a.xml'],
    })
    expect(
      omeZarrRemoteSourceLocator('https://example.test/store/?X-Amz-Signature=secret', {
        selectedRootMetadataName: 'zarr.json',
        sourceIdentityStrength: 'weak',
        rootObjectSize: 12,
      }).url,
    ).toBe('https://example.test/store/')
    expect(omeZarrDirectorySourceLocator('plate', 'zarr.json', 'abc').kind).toBe(
      'ome-zarr-directory',
    )
    expect(omeZarrZipSourceLocator({ name: 'store.zip', size: 8, lastModified: 1 })).toEqual({
      kind: 'ome-zarr-zip',
      name: 'store.zip',
      size: 8,
      lastModified: 1,
    })
  })

  it('replaces leftover sources and analysis when committing an opened document', () => {
    const mutations: WorkspaceMutation[] = []
    let snapshot = createProject('Existing project')
    snapshot = {
      ...snapshot,
      sources: [
        {
          id: 'source-previous' as SemanticSourceId,
          label: 'previous.gsf',
          locator: { kind: 'sample', sampleId: 'generated.calibrated-particles' },
          identity: IDENTITY,
          reader: { id: 'gsf', version: '1', format: 'GSF' },
          bound: true,
        },
      ],
      analysis: {
        ...snapshot.analysis,
        graph: {
          schemaVersion: 1,
          inputs: [],
          nodes: [
            {
              id: 'threshold-1',
              operation: { id: 'threshold', version: 1 },
              inputs: [],
              parameters: {},
            },
          ],
          outputs: [],
        },
        roiSet: {
          ...snapshot.analysis.roiSet,
          rois: [
            {
              schemaVersion: 1,
              id: 'roi-old',
              name: 'Old',
              axisIds: ['x', 'y'],
              fixedIndices: [],
              coordinateSpace: 'pixel',
              geometry: { kind: 'rectangle', x: 0, y: 0, width: 4, height: 4 },
            },
          ],
        },
      },
    }
    const added = commitOpenedSource(
      {
        currentSnapshot: () => snapshot,
        applyMutation: (mutation) => {
          mutations.push(mutation)
          if (mutation.kind === 'source.remove') {
            snapshot = {
              ...snapshot,
              sources: snapshot.sources.filter(({ id }) => id !== mutation.sourceId),
            }
          }
          if (mutation.kind === 'analysis.set-graph') {
            snapshot = { ...snapshot, analysis: { ...snapshot.analysis, graph: mutation.graph } }
          }
          if (mutation.kind === 'roi.remove') {
            snapshot = {
              ...snapshot,
              analysis: {
                ...snapshot.analysis,
                roiSet: {
                  ...snapshot.analysis.roiSet,
                  rois: snapshot.analysis.roiSet.rois.filter(({ id }) => id !== mutation.roiId),
                },
              },
              workflow: { ...snapshot.workflow, selectedRoiId: undefined },
            }
          }
        },
      },
      openedSource(),
      sampleSourceLocator('generated.calibrated-particles'),
      openedDataset(),
    )
    expect(mutations.map(({ kind }) => kind)).toEqual([
      'analysis.set-graph',
      'source.remove',
      'source.add',
      'roi.remove',
      'roi.select',
    ])
    const firstDataset = added.datasets[0]
    if (firstDataset === undefined) throw new Error('expected added dataset')
    expect(added.source.label).toBe('particles.gsf')
    expect(
      datasetSelectMutation(added.source.id, firstDataset.id, openedDataset().selection).kind,
    ).toBe('dataset.select')
    expect(
      sourceRebindMutation(
        added.source.id,
        [{ name: 'a.tif', size: 1, lastModified: 1 }],
        openedSource(),
      ).kind,
    ).toBe('source.rebind')
  })

  it('formats worker guidance onto open failures', () => {
    expect(
      formatOpenSourceError({
        message: 'Unsupported format.',
        detail: { guidance: 'Try a TIFF.' },
      }),
    ).toBe('Unsupported format. Try a TIFF.')
    expect(formatOpenSourceError(new Error('boom'))).toBe('boom')
    expect(formatOpenSourceError('nope')).toBe('Unable to open the source.')
  })
})
