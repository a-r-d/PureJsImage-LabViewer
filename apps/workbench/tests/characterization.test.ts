import { readFile } from 'node:fs/promises'
import { enabledExampleScenarios } from '@pji-workbench/test-corpus'
import { describe, expect, it } from 'vitest'

import { type CommandContext, workbenchActionRegistry } from '../src/commands.js'
import { readPublicEnvironment } from '../src/environment.js'

interface ScienceActionCatalogFixture {
  readonly schemaVersion: 1
  readonly application: 'science-workbench'
  readonly actions: unknown
}

interface ScienceActionAvailabilityFixture {
  readonly schemaVersion: 1
  readonly application: 'science-workbench'
  readonly emptyWorkspace: unknown
  readonly datasetOpen: unknown
}

interface ScienceRouteFixture {
  readonly schemaVersion: 1
  readonly application: 'science-workbench'
  readonly routes: readonly {
    readonly path: string
    readonly id: string
    readonly component: string
    readonly title: string
    readonly readyAttribute: string
  }[]
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableJson(item))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJson(item)]),
    )
  }
  return value
}

async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`./fixtures/characterization/${name}`, import.meta.url), 'utf8'),
  ) as unknown
}

function availabilitySnapshot(context: CommandContext) {
  return Object.fromEntries(
    workbenchActionRegistry
      .list()
      .map(({ id, version }) => [
        `${id}@${version}`,
        workbenchActionRegistry.availability(id, version, context),
      ]),
  )
}

function isScienceActionCatalog(value: unknown): value is ScienceActionCatalogFixture {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 1 &&
    'application' in value &&
    value.application === 'science-workbench' &&
    'actions' in value
  )
}

function isScienceActionAvailability(value: unknown): value is ScienceActionAvailabilityFixture {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 1 &&
    'application' in value &&
    value.application === 'science-workbench' &&
    'emptyWorkspace' in value &&
    'datasetOpen' in value
  )
}

function isScienceRoutes(value: unknown): value is ScienceRouteFixture {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 1 &&
    'application' in value &&
    value.application === 'science-workbench' &&
    'routes' in value &&
    Array.isArray(value.routes)
  )
}

describe('science workbench characterization', () => {
  it('keeps the reviewed semantic action catalog', async () => {
    const fixture = await readFixture('science-action-catalog.json')
    expect(isScienceActionCatalog(fixture)).toBe(true)
    if (!isScienceActionCatalog(fixture)) return
    expect(
      stableJson({
        schemaVersion: 1,
        application: 'science-workbench',
        actions: workbenchActionRegistry.list(),
      }),
    ).toEqual(fixture)
    const ids = workbenchActionRegistry.list().map(({ id }) => id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'source.open-local',
        'workspace.openSample',
        'workspace.save',
        'analysis.catalog.read',
        'analysis.request-execute',
        'analysis.graph.request-execute',
      ]),
    )
  })

  it('keeps reviewed action availability for empty and opened-dataset contexts', async () => {
    const fixture = await readFixture('science-action-availability.json')
    expect(isScienceActionAvailability(fixture)).toBe(true)
    if (!isScienceActionAvailability(fixture)) return
    expect(
      stableJson({
        schemaVersion: 1,
        application: 'science-workbench',
        emptyWorkspace: availabilitySnapshot({ hasDataset: false }),
        datasetOpen: availabilitySnapshot({ hasDataset: true, canUndo: true, canRedo: true }),
      }),
    ).toEqual(fixture)
  })

  it('keeps the current science routes including the UI lab', async () => {
    const fixture = await readFixture('science-routes.json')
    expect(isScienceRoutes(fixture)).toBe(true)
    if (!isScienceRoutes(fixture)) return
    const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
    const labSource = await readFile(new URL('../src/app/UiLab.tsx', import.meta.url), 'utf8')
    const shellSource = await readFile(
      new URL('../src/app/WorkbenchShell.tsx', import.meta.url),
      'utf8',
    )
    const workbenchSource = await readFile(
      new URL('../src/app/WorkbenchApp.tsx', import.meta.url),
      'utf8',
    )
    expect(fixture.routes.map(({ path }) => path)).toEqual(['/', '/__ui-lab'])
    for (const route of fixture.routes) {
      expect(appSource).toContain(route.component)
      if (route.path === '/__ui-lab') {
        expect(appSource).toContain(`pathname === '${route.path}'`)
        expect(labSource).toContain(route.title)
        expect(labSource).toContain(route.readyAttribute)
      } else {
        expect(html).toContain(`<title>${route.title}</title>`)
        expect(shellSource).toContain(route.readyAttribute)
        expect(workbenchSource).toContain('WorkbenchShell')
      }
    }
  })

  it('still boots through the public environment contract and imaging Worker client', async () => {
    const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
    const providersSource = await readFile(
      new URL('../src/app/WorkbenchProviders.tsx', import.meta.url),
      'utf8',
    )
    const workbenchSource = await readFile(
      new URL('../src/app/WorkbenchApp.tsx', import.meta.url),
      'utf8',
    )
    expect(readPublicEnvironment({})).toEqual({ appEnvironment: 'production' })
    expect(mainSource).toContain('createRoot(rootElement).render')
    expect(mainSource).toContain('<App environment={readPublicEnvironment(import.meta.env)} />')
    expect(providersSource).toContain('createImagingWorkerClient()')
    expect(workbenchSource).toContain('Choose local scientific files')
    expect(workbenchSource).toContain('createWorkbenchActionHost')
    expect(workbenchSource).not.toContain("'workspace.openSample@1'")
    expect(workbenchSource).not.toContain('enabledExampleScenarios')
    const handlersSource = await readFile(
      new URL('../../../packages/workbench-core/src/science/action-handlers.ts', import.meta.url),
      'utf8',
    )
    expect(handlersSource).toContain("'workspace.openSample@1'")
    expect(handlersSource).toContain("'workspace.save@1'")
    expect(handlersSource).toContain("'analysis.catalog.read@1'")
    expect(handlersSource).toContain("'source.open-local@1'")
    const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
    expect(appSource).toContain('profile={scienceDomainProfile}')
  })

  it('still exposes the current enabled science examples', () => {
    expect(enabledExampleScenarios().map(({ id }) => id)).toEqual([
      'generated.calibrated-particles',
      'generated.touching-particles',
      'generated.periodic-lattice',
      'generated.afm-tilted-surface',
      'generated.batch-particles',
      'generated.drifting-stack',
      'cdc.ecoli-sem',
      'cdc.staph-aureus-sem',
      'nih.hela-cells-3709',
      'nci.hhv6-em',
    ])
    expect(
      enabledExampleScenarios()
        .filter(({ source }) => source.kind === 'bundled')
        .map(({ id }) => id),
    ).toEqual(['cdc.ecoli-sem', 'cdc.staph-aureus-sem', 'nih.hela-cells-3709', 'nci.hhv6-em'])
  })
})
