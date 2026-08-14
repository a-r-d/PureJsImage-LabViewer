import type { AnalysisCalibrationOverride } from '@pji-workbench/contracts'
import { type AnalysisInputBinding, scientificDatasetCharacteristics } from 'purejsimage/analysis'
import { hashCanonicalJson } from 'purejsimage/analysis/project'
import { canonicalNormalizedRoiSemanticsJson, normalizeRoi } from 'purejsimage/analysis/roi'
import {
  getScientificDatasetIdentity,
  normalizeScientificDatasetDescriptor,
  type ScientificDataset,
} from 'purejsimage/scientific'

import type { DatasetRecord } from './runtime.js'

export function isScientificDataset(value: unknown): value is ScientificDataset {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { readonly descriptor?: unknown; readonly readPlane?: unknown }
  return typeof candidate.descriptor === 'object' && typeof candidate.readPlane === 'function'
}

export async function createAnalysisBindings(
  record: DatasetRecord,
  roiValue: unknown,
  calibration?: AnalysisCalibrationOverride,
): Promise<Readonly<Record<string, AnalysisInputBinding>>> {
  const identity = getScientificDatasetIdentity(record.dataset)
  if (identity === undefined) throw new Error('The dataset has no stable source identity')
  const dataset: ScientificDataset =
    calibration === undefined
      ? record.dataset
      : {
          descriptor: normalizeScientificDatasetDescriptor({
            ...record.dataset.descriptor,
            axes: record.dataset.descriptor.axes.map((axis) => {
              const index = calibration.axisIds.indexOf(axis.id)
              const step = calibration.unitsPerPixel[index]
              if (index < 0 || step === undefined || !Number.isFinite(step) || step <= 0)
                return axis
              return {
                ...axis,
                unit: calibration.unit,
                coordinates: {
                  type: 'linear' as const,
                  origin: axis.coordinates.type === 'linear' ? axis.coordinates.origin : 0,
                  step:
                    axis.coordinates.type === 'linear' && axis.coordinates.step < 0 ? -step : step,
                },
              }
            }),
          }),
          readPlane: (request) => record.dataset.readPlane(request),
        }
  const source = {
    value: dataset,
    identity:
      calibration === undefined
        ? identity
        : {
            kind: 'semantic-json' as const,
            domain: 'pji-workbench.calibrated-dataset.v1',
            sha256: await hashCanonicalJson('pji-workbench.calibrated-dataset.v1', {
              source: identity,
              calibration,
            }),
          },
    characteristics: scientificDatasetCharacteristics(dataset),
  }
  if (roiValue === undefined) return { source }
  const roi = normalizeRoi(roiValue, dataset.descriptor)
  const domain = 'purejsimage.roi-semantics.v1'
  return {
    source,
    selection: {
      value: roi,
      identity: {
        kind: 'semantic-json' as const,
        domain,
        sha256: await hashCanonicalJson(domain, canonicalNormalizedRoiSemanticsJson(roi)),
      },
    },
  }
}
