import { describe, expect, it } from 'vitest'

import { geoActionDefinitions } from '../src/index.js'

describe('Atlas semantic action catalog', () => {
  it('publishes the complete stable controller surface', () => {
    expect(geoActionDefinitions.map(({ descriptor }) => descriptor.id)).toEqual([
      'geo.workflow.record',
      'geo.catalog.list',
      'geo.catalog.list_collections',
      'geo.catalog.search',
      'geo.catalog.follow',
      'geo.catalog.inspect_item',
      'geo.catalog.inspect_asset',
      'geo.source.open_catalog_asset',
      'geo.source.open_remote',
      'geo.source.open_local_resource',
      'geo.source.list',
      'geo.source.describe',
      'geo.source.close',
      'geo.source.retry',
      'geo.source.rebind_local',
      'geo.layer.list',
      'geo.layer.add',
      'geo.layer.remove',
      'geo.layer.duplicate',
      'geo.layer.select',
      'geo.layer.set_visibility',
      'geo.layer.set_opacity',
      'geo.layer.set_order',
      'geo.layer.set_style',
      'geo.layer.fit',
      'geo.comparison.read',
      'geo.comparison.set_single',
      'geo.comparison.set_overlay',
      'geo.comparison.set_swipe',
      'geo.comparison.set_blink',
      'geo.viewport.read',
      'geo.viewport.fit_source',
      'geo.viewport.fit_layer',
      'geo.viewport.fit_bounds',
      'geo.viewport.propose',
      'geo.raster.sample_point',
      'geo.raster.sample_points',
      'geo.raster.describe_bands',
      'geo.raster.describe_statistics',
      'geo.analysis.describe',
      'geo.analysis.dry_run',
      'geo.analysis.band_math',
      'geo.analysis.normalized_difference',
      'geo.analysis.virtual_band_stack',
      'geo.analysis.hillshade',
      'geo.analysis.slope',
      'geo.analysis.aspect',
      'geo.analysis.raster_difference',
      'geo.analysis.region_statistics',
      'geo.analysis.line_profile',
      'geo.analysis.zonal_statistics',
      'geo.analysis.cancel',
      'geo.analysis.release',
      'geo.derived_layer.remove',
      'geo.roi.list',
      'geo.roi.create',
      'geo.roi.update',
      'geo.roi.remove',
      'geo.roi.select',
      'geo.roi.import_geojson',
      'geo.roi.export_geojson',
      'geo.measure.distance',
      'geo.measure.area',
      'geo.export.rendered_image',
    ])
    for (const { descriptor } of geoActionDefinitions) {
      expect(descriptor.version).toBe(1)
      expect(descriptor.permissions.length).toBeGreaterThan(0)
      expect(descriptor.inputSchema).toBeDefined()
      expect(descriptor.outputSchema).toBeDefined()
    }
  })
})
