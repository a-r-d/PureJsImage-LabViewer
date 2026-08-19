import { WorkbenchActionHost } from '@pji-workbench/actions'
import { SUPPORTED_FILE_ACCEPT, SUPPORTED_READERS } from '@pji-workbench/imaging'
import { enabledExampleScenarios } from '@pji-workbench/test-corpus'
import { describe, expect, it, vi } from 'vitest'

import {
  createScienceActionHandlers,
  createScienceDomainProfile,
  exampleScenariosForProfile,
  fileAcceptForProfile,
  readersForProfile,
  SCIENCE_DOMAIN_ID,
  SCIENCE_EXAMPLE_SCENARIO_IDS,
  SCIENCE_READER_IDS,
  scienceDomainProfile,
  scienceUiContributions,
  workbenchActionRegistry,
} from '../src/index.js'

describe('science domain profile', () => {
  it('describes the current science workbench without geo capabilities', () => {
    const profile = createScienceDomainProfile()
    expect(profile).toBe(scienceDomainProfile)
    expect(profile.id).toBe(SCIENCE_DOMAIN_ID)
    expect(profile.title).toBe('Materials Workbench')
    expect(profile.sourceAdapters).toEqual(['local', 'remote', 'sample', 'bundled'])
    expect(profile.capabilities.particleAnalysis).toBe(true)
    expect(profile.agentPolicy.liveModelEnabled).toBe(false)
    expect(profile.agentPolicy.decisionFor('workspace.read')).toBe('allow')
    expect(profile.agentPolicy.decisionFor('analysis.execute')).toBe('require-approval')
    expect(profile.readerIds.join(' ')).not.toMatch(/geo|titiler|cog/i)
    expect(profile.workflowRecipes.map(({ id }) => id)).toContain('builtin.particle-count-recipe')
  })

  it('opts into the current imaging reader catalog', () => {
    expect([...SCIENCE_READER_IDS]).toEqual(SUPPORTED_READERS.map(({ id }) => id))
    expect(readersForProfile(scienceDomainProfile).map(({ id }) => id)).toEqual([
      ...SCIENCE_READER_IDS,
    ])
    expect(fileAcceptForProfile(scienceDomainProfile)).toBe(SUPPORTED_FILE_ACCEPT)
  })

  it('selects the enabled science example corpus', () => {
    expect([...SCIENCE_EXAMPLE_SCENARIO_IDS]).toEqual(enabledExampleScenarios().map(({ id }) => id))
    expect(exampleScenariosForProfile(scienceDomainProfile).map(({ id }) => id)).toEqual([
      ...SCIENCE_EXAMPLE_SCENARIO_IDS,
    ])
  })

  it('registers the same semantic actions the workbench characterization locks', () => {
    expect(workbenchActionRegistry.list()).toEqual(
      scienceDomainProfile.actionDefinitions
        .map(({ descriptor }) => descriptor)
        .slice()
        .sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version),
    )
    const ids = workbenchActionRegistry.list().map(({ id }) => id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'source.open-local',
        'workspace.openSample',
        'workspace.save',
        'analysis.catalog.read',
        'analysis.request-execute',
      ]),
    )
  })

  it('keeps UI contributions out of the headless profile', () => {
    expect(scienceDomainProfile).not.toHaveProperty('panels')
    expect(scienceDomainProfile).not.toHaveProperty('routes')
    expect(scienceDomainProfile).not.toHaveProperty('emptyState')
    expect(scienceUiContributions.applicationTitle).toBe(scienceDomainProfile.title)
    expect(scienceUiContributions.routes.map(({ path }) => path)).toEqual(['/', '/__ui-lab'])
    expect(scienceUiContributions.emptyState.heading).toContain('original file')
    expect(scienceUiContributions.defaultLayout).toEqual({
      inspectorTab: 'info',
      bottomTab: 'histogram',
    })
  })

  it('wires identifiable science action handlers through injected ports', async () => {
    const openSample = vi.fn(async () => undefined)
    const requestLocalFiles = vi.fn()
    const saveProject = vi.fn(async () => undefined)
    const cancelAnalysis = vi.fn()
    const host = new WorkbenchActionHost(
      workbenchActionRegistry,
      createScienceActionHandlers({
        openSample,
        requestLocalFiles,
        requestRemoteUrl: vi.fn(),
        newProject: vi.fn(),
        openProjectBrowser: vi.fn(),
        saveProject,
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
        cancelAnalysis,
        currentWorkspace: () => {
          throw new Error('workspace not needed')
        },
        openedDataset: () => undefined,
        currentSelection: () => undefined,
        calibratedDataset: () => undefined,
        particleOverlayView: () => 'labels',
        analysisCatalog: () => undefined,
        resolveCatalogOperation: () => undefined,
        executeAnalysisGraph: async () => true,
        wholePlaneRoi: () => {
          throw new Error('roi not needed')
        },
        runToolboxOperation: async () => undefined,
      }),
    )
    const signal = { aborted: false, throwIfAborted: () => undefined }
    const context = { hasDataset: true }
    await host.execute('workspace.openSample', 1, {}, context, signal)
    await host.execute('source.open-local', 1, {}, context, signal)
    await host.execute('workspace.save', 1, {}, context, signal)
    const catalog = await host.execute('analysis.catalog.read', 1, {}, context, signal)
    expect(openSample).toHaveBeenCalledOnce()
    expect(requestLocalFiles).toHaveBeenCalledOnce()
    expect(saveProject).toHaveBeenCalledOnce()
    expect((catalog as { readonly operations: readonly unknown[] }).operations).toHaveLength(2)
    const cancelled = await host.execute('analysis.cancel', 1, {}, context, signal)
    expect(cancelAnalysis).toHaveBeenCalledWith('Cancelled by semantic action.')
    expect(cancelled).toEqual({ status: 'cancel-requested' })
    await expect(host.execute('script.read', 1, { id: 'x' }, context, signal)).rejects.toThrow(
      /No action handler registered/,
    )
  })
})
