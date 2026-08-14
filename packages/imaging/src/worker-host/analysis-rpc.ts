import { type AnalysisInputBinding, scientificDatasetCharacteristics } from 'purejsimage/analysis'
import { hashCanonicalJson } from 'purejsimage/analysis/project'
import { canonicalNormalizedRoiSemanticsJson, normalizeRoi } from 'purejsimage/analysis/roi'
import { getScientificDatasetIdentity, type ScientificDataset } from 'purejsimage/scientific'

import type { DatasetRecord } from './runtime.js'

export function isScientificDataset(value: unknown): value is ScientificDataset {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { readonly descriptor?: unknown; readonly readPlane?: unknown }
  return typeof candidate.descriptor === 'object' && typeof candidate.readPlane === 'function'
}

export async function createAnalysisBindings(
  record: DatasetRecord,
  roiValue: unknown,
): Promise<Readonly<Record<string, AnalysisInputBinding>>> {
  const identity = getScientificDatasetIdentity(record.dataset)
  if (identity === undefined) throw new Error('The dataset has no stable source identity')
  const source = {
    value: record.dataset,
    identity,
    characteristics: scientificDatasetCharacteristics(record.dataset),
  }
  if (roiValue === undefined) return { source }
  const roi = normalizeRoi(roiValue, record.dataset.descriptor)
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
