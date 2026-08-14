import {
  CORPUS_SCHEMA_VERSION,
  type CorpusFileV1,
  type CorpusLicenseV1,
  type CorpusManifestV1,
  type CorpusStatus,
  type CorpusTier,
  type ExampleBudgetsV1,
  type ExampleScenarioV1,
  type ExampleTestPlanV1,
  type ExampleWorkflowStepAction,
  type ExampleWorkflowV1,
} from './types.js'
import { normalizeCorpusManifest } from './validation.js'

export const GENERATED_CORPUS_ID = 'generated-materials-shapes-v1' as const
export const CORPUS_VERIFICATION_DATE = '2026-08-14' as const

const GENERATED_LICENSE: CorpusLicenseV1 = {
  id: 'CC0-1.0',
  name: 'CC0 1.0 Universal',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  attribution: 'PureJsImage Lab contributors; deterministic generated data.',
  redistribution: 'approved',
  verifiedAt: CORPUS_VERIFICATION_DATE,
}

const REVIEW_REQUIRED: CorpusLicenseV1 = {
  id: 'LicenseRef-Pending-Review',
  name: 'License pending data-specific review',
  url: 'https://purejsimage.com/',
  attribution:
    'Attribution must be copied from the authoritative dataset record before enablement.',
  redistribution: 'review-required',
}

const GENERATED_BUDGETS: ExampleBudgetsV1 = {
  maxSourceBytes: 16_000_000,
  maxRemoteBytes: 0,
  maxExpandedBytes: 16_000_000,
  maxArchiveFiles: 1,
  maxFirstUsefulTileMilliseconds: 2_500,
  maxCancellationMilliseconds: 250,
  maxCompletionMilliseconds: 60_000,
  maxPeakManagedBytes: 256_000_000,
  maxRangeRequests: 0,
}

const EXTERNAL_BUDGETS: ExampleBudgetsV1 = {
  maxSourceBytes: 256_000_000,
  maxRemoteBytes: 8_000_000,
  maxExpandedBytes: 512_000_000,
  maxArchiveFiles: 4_096,
  maxFirstUsefulTileMilliseconds: 4_000,
  maxCancellationMilliseconds: 500,
  maxCompletionMilliseconds: 120_000,
  maxPeakManagedBytes: 512_000_000,
  maxRangeRequests: 128,
}

const WORKFLOW_ACTIONS: Readonly<Record<string, readonly ExampleWorkflowStepAction[]>> = {
  'generated.particles.count': [
    'gallery.open',
    'source.inspect',
    'viewport.inspect',
    'roi.measure',
    'analysis.core',
    'analysis.particles',
    'project.replay',
    'lifecycle.hostile',
    'accessibility.scan',
    'visual.capture',
  ],
  'generated.particles.watershed': [
    'gallery.open',
    'source.inspect',
    'analysis.watershed',
    'script.test',
  ],
  'generated.lattice.fft': [
    'gallery.open',
    'source.inspect',
    'analysis.fft',
    'script.test',
    'project.replay',
  ],
  'generated.afm.roughness': [
    'gallery.open',
    'source.inspect',
    'analysis.surface',
    'script.test',
    'project.replay',
  ],
  'generated.particles.batch': ['gallery.open', 'source.inspect', 'analysis.batch', 'script.test'],
}

const GENERATED_TEST_PLANS: Readonly<Record<string, ExampleTestPlanV1>> = {
  'generated.calibrated-particles': {
    tier: 'pr',
    capabilities: [
      'source.reader-dataset',
      'source.axes-components-calibration-metadata',
      'source.local-range-parity',
      'source.range-byte-budget',
      'source.first-useful-tile',
      'viewport.navigation-value-readout',
      'roi.all-types-and-units',
      'analysis.filters-transforms-background',
      'analysis.threshold-morphology-watershed',
      'analysis.components-filtering-measurements',
      'project.save-reopen-rebind',
      'lifecycle.cancel-crash-cleanup-release',
      'accessibility.keyboard',
      'results.linked-selection',
      'export.bounded',
    ],
    screenshotStates: ['empty', 'opened', 'analysis', 'results'],
    accessibility: true,
    projectReplay: true,
    agentEvalCaseIds: ['open-example', 'sem-particle-count', 'measure-calibrated-roi'],
  },
  'generated.touching-particles': {
    tier: 'pr',
    capabilities: ['analysis.threshold-morphology-watershed', 'scripts.sandbox-recipe-replay'],
    screenshotStates: [],
    accessibility: false,
    projectReplay: false,
    agentEvalCaseIds: ['split-touching-particles'],
  },
  'generated.periodic-lattice': {
    tier: 'pr',
    capabilities: ['analysis.fft-profile-d-spacing', 'scripts.sandbox-recipe-replay'],
    screenshotStates: ['analysis'],
    accessibility: true,
    projectReplay: true,
    agentEvalCaseIds: ['fft-known-spacing'],
  },
  'generated.afm-tilted-surface': {
    tier: 'pr',
    capabilities: ['analysis.afm-leveling-roughness', 'scripts.sandbox-recipe-replay'],
    screenshotStates: [],
    accessibility: true,
    projectReplay: true,
    agentEvalCaseIds: ['level-afm-report-rq'],
  },
  'generated.batch-particles': {
    tier: 'pr',
    capabilities: ['analysis.batch-partial-failure', 'scripts.sandbox-recipe-replay'],
    screenshotStates: [],
    accessibility: false,
    projectReplay: false,
    agentEvalCaseIds: ['run-bounded-batch'],
  },
}

function externalTestPlan(id: string, status: Exclude<CorpusStatus, 'enabled'>): ExampleTestPlanV1 {
  return {
    tier: status === 'scheduled' ? 'scheduled' : 'manual',
    capabilities: [
      'source.reader-dataset',
      ...(id.startsWith('empiar.') ? (['analysis.stack-projection-registration'] as const) : []),
      ...(id.startsWith('openslide.')
        ? (['source.local-range-parity', 'source.range-byte-budget'] as const)
        : []),
    ],
    screenshotStates: [],
    accessibility: false,
    projectReplay: false,
    agentEvalCaseIds: [],
  }
}

function workflow(
  id: string,
  title: string,
  artifactId: string,
  artifactKind: ExampleWorkflowV1['artifactKind'],
  description: string,
): ExampleWorkflowV1 {
  const actions = WORKFLOW_ACTIONS[id] ?? ['source.inspect']
  return {
    id,
    title,
    summary: description,
    artifactId,
    artifactKind,
    steps: actions.map((action, index) => ({
      id: `${id}.step-${index + 1}`,
      action,
      description: `${title}: ${action.replaceAll('.', ' ')}.`,
    })),
    oracle: {
      id: `${id}.oracle`,
      implementation: 'pji-independent-reference',
      version: '1.0.0',
      ...(id.includes('fft') || id.includes('roughness') ? { tolerance: 1e-6 } : {}),
    },
    expected: [{ id: `${id}.bounded`, level: 'structural', description }],
  }
}

function generated(
  id: string,
  title: string,
  summary: string,
  modality: string,
  generatorId: string,
  format: string,
  calibration: string,
  tags: readonly string[],
  learningGoals: readonly string[],
  workflows: readonly ExampleWorkflowV1[],
  pattern: string,
): ExampleScenarioV1 {
  const filename =
    generatorId === 'generated.periodic-lattice'
      ? 'periodic-lattice.gsf'
      : generatorId === 'generated.afm-tilted-surface'
        ? 'afm-tilted-surface.gsf'
        : generatorId === 'generated.touching-particles'
          ? 'touching-particles.gsf'
          : generatorId === 'generated.batch-particles'
            ? 'batch-particles.gsf'
            : 'sample-sem.gsf'
  return {
    schemaVersion: CORPUS_SCHEMA_VERSION,
    id,
    status: 'enabled',
    tier: 'generated',
    statusReason: 'Deterministic, license-approved, offline, bounded, and covered by normal CI.',
    title,
    summary,
    modality,
    vendor: 'PureJsImage Lab generator',
    format,
    sizeClass: 'tiny',
    calibration,
    source: {
      kind: 'generated',
      generatorId,
      files: [
        {
          path: filename,
          sizeBytes: 0,
          mediaType: 'application/octet-stream',
          delivery: 'generated',
        },
      ],
    },
    license: GENERATED_LICENSE,
    preview: {
      kind: 'generated-pattern',
      value: pattern,
      alt: `${title} generated preview`,
    },
    tags,
    learningGoals,
    workflows,
    expected: workflows.flatMap(({ expected }) => expected),
    budgets: GENERATED_BUDGETS,
    testPlan:
      GENERATED_TEST_PLANS[id] ??
      (() => {
        throw new Error(`Missing generated test plan for ${id}.`)
      })(),
    testTags: ['pr', 'offline', 'generated'],
    verifiedAt: CORPUS_VERIFICATION_DATE,
  }
}

function external(
  id: string,
  status: Exclude<CorpusStatus, 'enabled'>,
  tier: Exclude<CorpusTier, 'generated' | 'bundled'>,
  title: string,
  summary: string,
  modality: string,
  format: string,
  sizeClass: ExampleScenarioV1['sizeClass'],
  landingPage: string,
  files: readonly CorpusFileV1[],
  statusReason: string,
  tags: readonly string[],
  license: CorpusLicenseV1 = REVIEW_REQUIRED,
): ExampleScenarioV1 {
  return {
    schemaVersion: CORPUS_SCHEMA_VERSION,
    id,
    status,
    tier,
    statusReason,
    title,
    summary,
    modality,
    format,
    sizeClass,
    calibration: 'Source calibration requires scenario-level verification.',
    source: { kind: tier, landingPage, files },
    license,
    preview: {
      kind: 'generated-pattern',
      value: 'research',
      alt: `${title} research candidate`,
    },
    tags,
    learningGoals: ['Inspect source metadata', 'Review the proposed bounded workflow'],
    workflows: [
      workflow(
        `${id}.inspect`,
        'Inspect proposed workflow',
        'builtin.particle-count-recipe',
        'recipe',
        'The workflow remains unavailable until the selected files and oracle are verified.',
      ),
    ],
    expected: [
      {
        id: `${id}.qualification`,
        level: 'structural',
        description:
          'Expected results remain unavailable until the source qualification gate passes.',
      },
    ],
    budgets: EXTERNAL_BUDGETS,
    testPlan: externalTestPlan(id, status),
    testTags: status === 'scheduled' ? ['scheduled', 'network'] : ['audit-only'],
  }
}

const scenarios: readonly ExampleScenarioV1[] = [
  generated(
    'generated.calibrated-particles',
    'Calibrated particle field',
    'Known isolated particles on a calibrated, nonuniform SEM-style background.',
    'SEM (synthetic)',
    'generated.calibrated-particles',
    'GSF',
    '0.42 nm/px · intensity a.u.',
    ['particles', 'segmentation', 'calibrated', 'SEM'],
    ['Choose a threshold', 'Measure a particle-size distribution', 'Inspect linked labels'],
    [
      workflow(
        'generated.particles.count',
        'Count precipitates',
        'builtin.particle-count-recipe',
        'recipe',
        'The graph proposal remains explicit and approval-gated.',
      ),
    ],
    'particles',
  ),
  generated(
    'generated.touching-particles',
    'Touching-particle watershed',
    'Overlapping calibrated disks expose the difference between components and watershed labels.',
    'SEM (synthetic)',
    'generated.touching-particles',
    'GSF',
    '0.5 nm/px · intensity a.u.',
    ['particles', 'watershed', 'ground-truth', 'SEM'],
    ['Separate touching objects', 'Compare label counts', 'Review boundary policy'],
    [
      workflow(
        'generated.particles.watershed',
        'Separate touching particles',
        'builtin.watershed-particles',
        'script',
        'The script dry-runs a shared segmentation and watershed plan.',
      ),
    ],
    'touching',
  ),
  generated(
    'generated.periodic-lattice',
    'Periodic lattice and FFT',
    'A calibrated two-frequency lattice with a deterministic reciprocal-space signature.',
    'HRTEM-style (synthetic)',
    'generated.periodic-lattice',
    'GSF',
    '0.08 nm/px · intensity a.u.',
    ['FFT', 'radial-profile', 'd-spacing', 'HRTEM'],
    ['Compute a centered FFT', 'Inspect radial peaks', 'Relate frequency to spacing'],
    [
      workflow(
        'generated.lattice.fft',
        'Compute FFT and radial profile',
        'builtin.fft-radial-profile',
        'script',
        'The workflow uses calibrated axes and a bounded 128-bin radial profile.',
      ),
    ],
    'lattice',
  ),
  generated(
    'generated.afm-tilted-surface',
    'Tilted AFM surface',
    'A deterministic plane, nanoscale texture, and raised features for leveling and roughness.',
    'AFM (synthetic)',
    'generated.afm-tilted-surface',
    'GSF',
    '2 nm/px · height nm',
    ['AFM', 'surface', 'leveling', 'roughness'],
    ['Remove a first-order plane', 'Compare Ra, Rq, and Rz', 'Preserve physical units'],
    [
      workflow(
        'generated.afm.roughness',
        'Level and measure roughness',
        'builtin.afm-level-roughness',
        'script',
        'The workflow documents first-order leveling and calibrated roughness metrics.',
      ),
    ],
    'surface',
  ),
  generated(
    'generated.batch-particles',
    'Repeatable particle batch',
    'A local-only fixture family for per-item isolation, retry, and aggregate measurement review.',
    'SEM batch (synthetic)',
    'generated.batch-particles',
    'GSF',
    '0.42 nm/px · intensity a.u.',
    ['batch', 'particles', 'retry', 'table'],
    ['Review a batch plan', 'Inspect per-item failure isolation', 'Export bounded results'],
    [
      workflow(
        'generated.particles.batch',
        'Plan batch measurement',
        'builtin.batch-measurement',
        'script',
        'The script requests a bounded local batch proposal with concurrency two.',
      ),
    ],
    'batch',
  ),
  external(
    'nist.sem-detection-limits',
    'candidate',
    'external',
    'NIST SEM detection limits',
    'Noisy and low-contrast simulated SEM collections with reference masks and metrics.',
    'SEM',
    'ZIP · PNG · CSV',
    'large',
    'https://doi.org/10.18434/mds2-3838',
    [
      {
        path: 'mask_sets.zip',
        sha256: '5925dc95478e2cfc3c9ec54bfef888c7596db35fdf41bb929d6b96b8562ab562',
        mediaType: 'application/zip',
        delivery: 'download',
      },
    ],
    'NIST publishes a SHA-256, but exact bytes, immutable file URL, selected members, and a product redistribution decision remain pending.',
    ['SEM', 'noise', 'contrast', 'ground-truth'],
  ),
  external(
    'zenodo.indentation-masks',
    'candidate',
    'external',
    'SEM indentation marks',
    '1,120 SEM images and ground-truth masks for indentation segmentation.',
    'SEM',
    'TAR.GZ · PNG',
    'very-large',
    'https://doi.org/10.5281/zenodo.7639190',
    [
      {
        path: 'masks.tar.gz',
        sizeBytes: 7_588_350,
        sourceChecksum: 'md5:047f601bdd2b5526fa8c50ea1b4c5f52',
        url: 'https://zenodo.org/api/records/7639190/files/masks.tar.gz/content',
        mediaType: 'application/gzip',
        delivery: 'download',
      },
    ],
    'The record is CC BY 4.0, but Zenodo exposes MD5 only; a representative image/mask pair and SHA-256 are not yet pinned.',
    ['SEM', 'indentation', 'segmentation', 'mask'],
    {
      id: 'CC-BY-4.0',
      name: 'Creative Commons Attribution 4.0 International',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: 'R. Hadian et al., Indention mark segmentation data, Zenodo 7639190.',
      citation: 'https://doi.org/10.5281/zenodo.7639190',
      redistribution: 'review-required',
      verifiedAt: CORPUS_VERIFICATION_DATE,
    },
  ),
  external(
    'zenodo.tem-cobalt-segmentation',
    'candidate',
    'external',
    'Cobalt-oxide TEM nanoparticles',
    'TEM images and deep-learning segmentation results with 67–86 pm pixel sizes.',
    'TEM',
    'ZIP · image labels',
    'large',
    'https://doi.org/10.5281/zenodo.14927582',
    [
      {
        path: 'Segmented_images.zip',
        sourceChecksum: 'md5:63edc9b44264f8a1397bff806d58eade',
        mediaType: 'application/zip',
        delivery: 'download',
      },
    ],
    'The record has relevant labels, but exact bytes, SHA-256, selected members, and data-specific redistribution review are pending.',
    ['TEM', 'nanoparticles', 'segmentation'],
  ),
  external(
    'zenodo.tio2-particle-masks',
    'candidate',
    'external',
    'Agglomerated TiO2 particles',
    'Electron micrographs, segmentation masks, and particle occlusion classes.',
    'Electron microscopy',
    'ZIP',
    'large',
    'https://doi.org/10.5281/zenodo.4563942',
    [
      {
        path: 'Datasets.zip',
        sourceChecksum: 'md5:e013c146fb7a6904d04b1ecaa47e008a',
        mediaType: 'application/zip',
        delivery: 'download',
      },
    ],
    'A representative image/mask pair, SHA-256, exact bytes, and data license still need verification.',
    ['particles', 'agglomeration', 'mask', 'materials'],
  ),
  external(
    'gwyddion.chip-afm',
    'candidate',
    'external',
    'Gwyddion microchip surface',
    'A compact real GSF surface suitable for metadata, leveling, and roughness workflows.',
    'AFM/SPM',
    'GSF',
    'small',
    'https://gwyddion.net/download.php',
    [
      {
        path: 'chip.gsf',
        sizeBytes: 360_120,
        url: 'https://gwyddion.net/download/data-samples/gsf/chip.gsf',
        mediaType: 'application/octet-stream',
        delivery: 'download',
      },
    ],
    'The exact file and bytes are known, but no data-specific license statement or SHA-256 has been verified.',
    ['AFM', 'GSF', 'surface', 'roughness'],
  ),
  external(
    'empiar.cryo-fib-sem-10870',
    'scheduled',
    'external',
    'Cryo-FIB-SEM Chlamydomonas stack',
    'Thirty-seven 6144 × 4096 TIFF frames with 3.4 nm pixel spacing.',
    'FIB-SEM',
    'TIFF stack',
    'very-large',
    'https://www.ebi.ac.uk/empiar/EMPIAR-10870/',
    [{ path: 'data/*.tif', mediaType: 'image/tiff', delivery: 'download' }],
    'The entry metadata is verified, but an exact small slice subset, file hashes, and normal-CI hosting decision are pending.',
    ['FIB-SEM', 'volume', 'stack', 'registration'],
  ),
  external(
    'empiar.pollen-multimodal-10903',
    'scheduled',
    'external',
    'Pollen HRTEM and FIB-SEM',
    'A multimodal entry with sixteen 2048² HRTEM fields and three calibrated FIB-SEM stacks.',
    'HRTEM · FIB-SEM',
    'TIFF',
    'very-large',
    'https://www.ebi.ac.uk/empiar/EMPIAR-10903/',
    [
      { path: 'data/HRTEM/*.tif', mediaType: 'image/tiff', delivery: 'download' },
      { path: 'data/FIB-SEM/**', mediaType: 'image/tiff', delivery: 'download' },
    ],
    'The entry is scientifically relevant, but exact selected files, hashes, and a bounded hosted subset remain pending.',
    ['HRTEM', 'FFT', 'FIB-SEM', 'volume'],
  ),
  external(
    'openslide.cmu1-aperio',
    'scheduled',
    'external',
    'Aperio CMU-1 whole slide',
    'A CC0 Aperio pyramid used by OpenSlide, suitable for bounded range and multiresolution tests.',
    'Whole-slide pathology',
    'Aperio SVS',
    'large',
    'https://openslide.org/',
    [
      {
        path: 'Aperio/CMU-1.svs',
        sizeBytes: 177_552_579,
        sha256: '00a3d54482cd707abf254fe69dccc8d06b8ff757a1663f1290c23418c480eb30',
        url: 'https://openslide.cs.cmu.edu/download/openslide-testdata/Aperio/CMU-1.svs',
        mediaType: 'image/tiff',
        delivery: 'range',
      },
    ],
    'File identity and CC0 status are verified; scheduled range/CORS qualification and project-controlled immutable hosting remain required.',
    ['Aperio', 'SVS', 'pyramid', 'range'],
    {
      id: 'CC0-1.0',
      name: 'CC0 1.0 Universal',
      url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attribution: 'OpenSlide test data contributors, CMU-1.svs.',
      redistribution: 'approved',
      verifiedAt: CORPUS_VERIFICATION_DATE,
    },
  ),
  external(
    'future.dm4-4dstem',
    'excluded',
    'external',
    'DM4 / 4D-STEM future coverage',
    'Reserved capability target; no exact redistributable representative record met the corpus gate.',
    '4D-STEM',
    'DM4',
    'very-large',
    'https://www.ebi.ac.uk/empiar/',
    [{ path: 'not-selected', mediaType: 'application/octet-stream', delivery: 'download' }],
    'Excluded until the upstream PureJsImage support boundary and a licensed exact scenario are both defined.',
    ['DM4', '4D-STEM', 'future'],
  ),
]

export const corpusManifest: CorpusManifestV1 = normalizeCorpusManifest({
  schemaVersion: CORPUS_SCHEMA_VERSION,
  generatedAt: CORPUS_VERIFICATION_DATE,
  scenarios,
})

export function enabledExampleScenarios(): readonly ExampleScenarioV1[] {
  return corpusManifest.scenarios.filter(({ status }) => status === 'enabled')
}

export function researchExampleScenarios(): readonly ExampleScenarioV1[] {
  return corpusManifest.scenarios.filter(({ status }) => status !== 'enabled')
}

export interface GeneratedFixtureResolutionV1 {
  readonly scenarioId: string
  readonly generatorId: string
  readonly requiresNetwork: false
  readonly locator: Readonly<{ kind: 'sample'; sampleId: string }>
}

export function resolveGeneratedFixture(scenarioId: string): GeneratedFixtureResolutionV1 {
  const scenario = corpusManifest.scenarios.find(({ id }) => id === scenarioId)
  if (scenario === undefined) throw new Error(`Unknown corpus scenario: ${scenarioId}.`)
  if (scenario.status !== 'enabled' || scenario.source.kind !== 'generated')
    throw new Error(`Corpus scenario ${scenarioId} is not an enabled generated fixture.`)
  return {
    scenarioId,
    generatorId: scenario.source.generatorId,
    requiresNetwork: false,
    locator: { kind: 'sample', sampleId: scenario.source.generatorId },
  }
}

export interface GeneratedCorpusDescriptor {
  readonly id: typeof GENERATED_CORPUS_ID
  readonly tier: 'generated'
  readonly requiresNetwork: false
}

export function generatedCorpusDescriptor(): GeneratedCorpusDescriptor {
  return { id: GENERATED_CORPUS_ID, tier: 'generated', requiresNetwork: false }
}
