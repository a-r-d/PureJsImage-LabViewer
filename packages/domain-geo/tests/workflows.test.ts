import { describe, expect, it } from 'vitest'

import {
  assertGeoWorkflowRecipe,
  CATALOG_REGISTRY,
  displayPresetsForCandidate,
  GEO_WORKFLOW_RECIPES,
  geoDomainProfile,
  workflowAvailability,
} from '../src/index.js'

const actionIds = new Set(geoDomainProfile.actionDefinitions.map(({ descriptor }) => descriptor.id))

describe('GeoWorkflowRecipe registry', () => {
  it('defines the six executable URL-free workflows with valid dependencies and steps', () => {
    expect(GEO_WORKFLOW_RECIPES.map(({ id }) => id)).toEqual([
      'cog-anatomy',
      'kentucky-through-time',
      'natural-color-cir',
      'terrain-lab',
      'usgs-landsat-cincinnati',
      'noaa-raster-inspection',
    ])
    expect(geoDomainProfile.workflowRecipes).toEqual(GEO_WORKFLOW_RECIPES)
    for (const workflow of GEO_WORKFLOW_RECIPES) {
      expect(() => assertGeoWorkflowRecipe(workflow)).not.toThrow()
      expect(JSON.stringify(workflow)).not.toMatch(/https?:\/\//iu)
      expect(workflow.steps[0]?.kind).toBe('catalog-discovery')
      expect(workflow.steps.at(-1)).toMatchObject({ kind: 'report' })
      expect(workflow.outputs.length).toBeGreaterThan(0)
      expect(workflow.attributionRequirements.length).toBeGreaterThan(0)
      expect(
        workflowAvailability(workflow, {
          catalogs: CATALOG_REGISTRY,
          availableActions: actionIds,
        }).status,
      ).toBe('available-after-source-selection')
    }
  })

  it('rejects URLs and missing approval targets at the external unknown boundary', () => {
    const valid = GEO_WORKFLOW_RECIPES[0]
    if (valid === undefined) throw new Error('Expected workflow fixture')
    expect(() =>
      assertGeoWorkflowRecipe({ ...valid, fallbackExplanation: 'See https://example.com' }),
    ).toThrow('must not contain URLs')
    expect(() =>
      assertGeoWorkflowRecipe({
        ...valid,
        approvalPoints: [{ stepId: 'missing', reason: 'No', required: true }],
      }),
    ).toThrow('missing step')
  })

  it('derives natural color and CIR strictly from explicit band names', () => {
    const candidate = {
      catalogId: 'fixture',
      catalogTitle: 'Fixture',
      collectionId: 'imagery',
      itemId: 'four-band',
      assetKey: 'data',
      href: 'https://fixtures.invalid/four-band.tif',
      label: 'Four band',
      roles: ['data'],
      bandCount: 4,
      bands: [
        { index: 0, commonName: 'red' },
        { index: 1, commonName: 'green' },
        { index: 2, commonName: 'blue' },
        { index: 3, commonName: 'gray' },
      ],
    }
    expect(displayPresetsForCandidate(candidate).map(({ id }) => id)).toEqual(['natural-color'])
    expect(
      displayPresetsForCandidate({
        ...candidate,
        bands: [...candidate.bands.slice(0, 3), { index: 3, commonName: 'nir' }],
      }).map(({ id }) => id),
    ).toEqual(['natural-color', 'color-infrared'])
  })

  it('records terrain and Landsat scientific constraints explicitly', () => {
    const terrain = GEO_WORKFLOW_RECIPES.find(({ id }) => id === 'terrain-lab')
    const landsat = GEO_WORKFLOW_RECIPES.find(({ id }) => id === 'usgs-landsat-cincinnati')
    expect(terrain?.fallbackExplanation).toContain('DSM')
    expect(terrain?.fallbackExplanation).toContain('DTM')
    expect(landsat?.requiredAssets.map(({ role }) => role)).toEqual(['red', 'green', 'blue', 'nir'])
    expect(landsat?.inputParameters.find(({ id }) => id === 'valueMode')?.options).toEqual([
      { value: 'raw', label: 'Raw stored values' },
      { value: 'scaled', label: 'Scaled surface reflectance' },
    ])
  })
})
