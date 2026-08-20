import type { JsonValue } from '@pji-workbench/actions'
import {
  type AgentActionGateway,
  type AgentPolicy,
  createAgentCapabilityManifest,
} from '@pji-workbench/agent'
import type { GeoRasterLocator } from '@pji-workbench/domain-geo'

import type { GeoWorkbenchController } from './controller.js'

export interface GeoAgentPolicySettings {
  readonly allowProposalsWithoutApproval: boolean
}

export function createGeoAgentPolicy(
  settings: GeoAgentPolicySettings = { allowProposalsWithoutApproval: false },
): AgentPolicy {
  return {
    decide(capability, input) {
      const permissions = [...capability.permissions]
      if (!capability.availability.available)
        return {
          decision: 'deny',
          reason: capability.availability.reason ?? 'The Atlas action is unavailable.',
          permissions,
        }
      if (permissions.includes('network.relay'))
        return {
          decision: 'require-approval',
          reason: 'A source relay may incur bandwidth or service cost.',
          permissions,
        }
      if (capability.actionId === 'geo.preview.create')
        return {
          decision: 'require-approval',
          reason: isScreenPreview(input)
            ? 'Sharing a browser screen frame with the model requires preview approval and the browser display-share picker.'
            : 'Creating a model-visible image requires dedicated preview approval.',
          permissions,
        }
      if (
        capability.actionId.startsWith('geo.export.') ||
        capability.actionId === 'geo.project.export' ||
        capability.actionId === 'geo.roi.export_geojson'
      )
        return {
          decision: 'require-approval',
          reason: 'Export requires explicit approval.',
          permissions,
        }
      if (
        capability.actionId === 'geo.source.open_catalog_asset' ||
        capability.actionId === 'geo.source.open_remote' ||
        capability.actionId === 'geo.project.resolve_catalog_source'
      )
        return {
          decision: 'require-approval',
          reason: 'Opening or resolving a network source requires network approval.',
          permissions,
        }
      if (capability.cost === 'expensive')
        return {
          decision: 'require-approval',
          reason: 'Expensive raster analysis requires explicit approval after resource planning.',
          permissions,
        }
      if (capability.mutability === 'mutation')
        return {
          decision: 'require-approval',
          reason: 'This action changes Atlas project state.',
          permissions,
        }
      if (capability.mutability === 'proposal' && !settings.allowProposalsWithoutApproval)
        return {
          decision: 'require-approval',
          reason: 'Atlas is configured to review model-proposed viewport changes.',
          permissions,
        }
      return {
        decision: 'allow',
        reason: capability.actionId.startsWith('geo.catalog.')
          ? 'Bounded catalog metadata reads are automatic.'
          : 'Bounded read-only Atlas action is automatic.',
        permissions,
      }
    },
  }
}

function isScreenPreview(input: JsonValue): boolean {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false
  return (input as Readonly<Record<string, JsonValue>>)['scope'] === 'screen'
}

export function createGeoAgentGateway(controller: GeoWorkbenchController): AgentActionGateway {
  return {
    revision: () => controller.getSnapshot().revision,
    capabilities: () =>
      createAgentCapabilityManifest(
        controller.getSnapshot().revision,
        controller.actionCapabilities(),
      ),
    context: () => boundedGeoContext(controller),
    plan: (call) => controller.planAction(call.actionId, call.actionVersion, call.input),
    execute: (call, signal) =>
      controller.executeVersionedAction(call.actionId, call.actionVersion, call.input, signal),
    auditContext: () => boundedGeoContext(controller),
  }
}

function boundedGeoContext(controller: GeoWorkbenchController): JsonValue {
  const snapshot = controller.getSnapshot()
  const project = snapshot.project
  return json({
    project: {
      id: project.id,
      title: project.title,
      revision: snapshot.revision,
      crs: project.crs,
      comparison: project.comparison,
      sources: project.sources.slice(0, 32).map((source) => ({
        id: source.id,
        label: source.label,
        width: source.width,
        height: source.height,
        componentCount: source.componentCount,
        crs: source.spatialReference.crs,
        identity: modelVisibleLocator(source.locator),
        bands: source.bands.slice(0, 64),
      })),
      layers: project.layers.slice(0, 128).map((layer) => ({
        id: layer.id,
        kind: layer.kind,
        label: layer.label,
        sourceId: layer.sourceId ?? null,
        visible: layer.visible,
        style: layer.style,
        ...(layer.kind === 'derived'
          ? {
              inputLayerIds: layer.inputLayerIds,
              recipe: layer.recipe,
              provenance: layer.provenance,
            }
          : {}),
      })),
      rois: project.rois.slice(0, 128).map((roi) => ({
        id: roi.id,
        name: roi.name ?? null,
        geometryKind: roi.geometry.kind,
        crs: roi.crs,
      })),
      selection: project.selection,
    },
  })
}

function modelVisibleLocator(locator: GeoRasterLocator): JsonValue {
  switch (locator.kind) {
    case 'stac-asset':
      return { kind: locator.kind, catalog: stableCatalogIdentity(locator.catalog) }
    case 'tnm-product':
      return {
        kind: locator.kind,
        productId: locator.productId,
        catalog: stableCatalogIdentity(locator.catalog),
      }
    case 'remote-url': {
      const url = new URL(locator.url)
      return { kind: locator.kind, origin: url.origin, path: url.pathname.slice(0, 1_024) }
    }
    case 'local-file':
      return {
        kind: locator.kind,
        name: locator.fingerprint.name,
        size: locator.fingerprint.size,
        companionNames: locator.fingerprint.companionNames ?? [],
      }
    case 'bundled-example':
      return { kind: locator.kind, scenarioId: locator.scenarioId }
  }
}

function stableCatalogIdentity(
  catalog: Readonly<{
    catalogId: string
    collectionId: string
    itemId: string
    assetKey: string
  }>,
): JsonValue {
  return {
    catalogId: catalog.catalogId,
    collectionId: catalog.collectionId,
    itemId: catalog.itemId,
    assetKey: catalog.assetKey,
  }
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}
