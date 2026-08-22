export type ParticleCorpusTier = 'core' | 'extended' | 'quarantined' | 'excluded'
export type ParticleCorpusFetchPolicy = 'core-explicit' | 'extended-opt-in' | 'blocked'
export type ParticleGroundTruthStatus =
  | 'upstream-unreviewed'
  | 'reviewed'
  | 'adjudicated-gold'
  | 'weak-label'
  | 'smoke-test-only'

export interface ParticleCorpusDownloadV1 {
  readonly filename: string
  readonly url?: string
  readonly sha256?: string
  readonly sizeBytes?: number
  readonly role: 'archive' | 'image' | 'mask' | 'annotation' | 'metadata'
}

export interface ParticleCorpusSourceV1 {
  readonly id: string
  readonly tier: ParticleCorpusTier
  readonly fetchPolicy: ParticleCorpusFetchPolicy
  readonly title: string
  readonly authors: string
  readonly landingUrl: string
  readonly license: Readonly<{
    id: string
    evidenceUrl: string
    attribution: string
    commercialUse: boolean
    redistribution: boolean
    derivativeWorks: boolean
  }>
  readonly accessDate: string
  readonly downloads: readonly ParticleCorpusDownloadV1[]
  readonly notes: string
}

export interface ParticleCorpusAssetV1 {
  readonly path: string
  readonly sha256: string
  readonly sizeBytes: number
  readonly format: string
}

export interface ParticleCorpusFixtureV1 {
  readonly id: string
  readonly sourceId: string
  readonly originalFilename: string
  readonly sourceSha256: string
  readonly image: ParticleCorpusAssetV1
  readonly nativeFormat: string
  readonly derivedFormat: string
  readonly dimensions: Readonly<{
    width: number
    height: number
    channels: number
    bitDepth: number
  }>
  readonly calibration: Readonly<{ pixelSize: number; unit: string }> | null
  readonly labels: Readonly<{
    instanceMask: ParticleCorpusAssetV1 | null
    semanticMask: ParticleCorpusAssetV1 | null
    ignoreMask: ParticleCorpusAssetV1 | null
    objectCountIncludingBorder: number | null
    objectCountExcludingBorder: number | null
  }>
  readonly edgePolicy: 'include-mask-exclude-morphometry'
  readonly derivation: readonly Readonly<{
    operation: string
    parameters: Readonly<Record<string, string | number | boolean | null>>
  }>[]
  readonly review: Readonly<{
    status: ParticleGroundTruthStatus
    reviewer: string | null
    reviewedAt: string | null
  }>
  readonly tasks: readonly string[]
  readonly failureModes: readonly string[]
  readonly split: string
  readonly domainGroup: string
  readonly sourceSelection: Readonly<{
    arrayIndex: number | null
    crop: Readonly<{ x: number; y: number; width: number; height: number }> | null
    selection: Readonly<{
      selectorVersion: string
      reasons: readonly string[]
      features: Readonly<Record<string, number>>
    }> | null
  }>
}

export interface ParticleCorpusManifestV1 {
  readonly schemaVersion: 1
  readonly corpusVersion: string
  readonly generatedAt: string
  readonly policy: Readonly<{
    requireCommercialUse: true
    requireRedistribution: true
    requireDerivativeWorks: true
    failClosedOnUnknownLicense: true
    requireSha256: true
    requireTransformProvenance: true
    requireAdjudicationForGold: true
  }>
  readonly sources: readonly ParticleCorpusSourceV1[]
  readonly fixtures: readonly ParticleCorpusFixtureV1[]
}

export interface ParticleCorpusManifestIssue {
  readonly path: string
  readonly message: string
}

export type ParticleCorpusManifestValidation =
  | Readonly<{ ok: true; value: ParticleCorpusManifestV1; issues: readonly [] }>
  | Readonly<{ ok: false; issues: readonly ParticleCorpusManifestIssue[] }>

const SEMANTIC_ID = /^[a-z0-9][a-z0-9.-]*$/u
const SHA256 = /^[a-f0-9]{64}$/u
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u
const TIERS = new Set<ParticleCorpusTier>(['core', 'extended', 'quarantined', 'excluded'])
const FETCH_POLICIES = new Set<ParticleCorpusFetchPolicy>([
  'core-explicit',
  'extended-opt-in',
  'blocked',
])
const REVIEW_STATES = new Set<ParticleGroundTruthStatus>([
  'upstream-unreviewed',
  'reviewed',
  'adjudicated-gold',
  'weak-label',
  'smoke-test-only',
])

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectUnknown(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
  issues: ParticleCorpusManifestIssue[],
): void {
  const keys = new Set(allowed)
  for (const key of Object.keys(value))
    if (!keys.has(key)) issues.push({ path: `${path}/${key}`, message: 'Unknown property.' })
}

function requiredText(value: unknown, path: string, issues: ParticleCorpusManifestIssue[]): string {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push({ path, message: 'Expected a non-empty string.' })
    return ''
  }
  return value.trim()
}

function positiveInteger(
  value: unknown,
  path: string,
  issues: ParticleCorpusManifestIssue[],
): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    issues.push({ path, message: 'Expected a positive safe integer.' })
    return 0
  }
  return Number(value)
}

function nullableCount(value: unknown, path: string, issues: ParticleCorpusManifestIssue[]): void {
  if (value !== null && (!Number.isSafeInteger(value) || Number(value) < 0))
    issues.push({ path, message: 'Expected null or a non-negative safe integer.' })
}

function httpsUrl(value: unknown, path: string, issues: ParticleCorpusManifestIssue[]): string {
  const text = requiredText(value, path, issues)
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new Error()
  } catch {
    issues.push({ path, message: 'Expected a credential-free HTTPS URL.' })
  }
  return text
}

function localPath(value: unknown, path: string, issues: ParticleCorpusManifestIssue[]): string {
  const text = requiredText(value, path, issues)
  if (
    text.startsWith('/') ||
    text.includes('\\') ||
    text.split('/').some((segment) => segment === '..' || segment === '')
  )
    issues.push({ path, message: 'Expected a normalized repository-relative path.' })
  return text
}

function sha256(value: unknown, path: string, issues: ParticleCorpusManifestIssue[]): string {
  const text = requiredText(value, path, issues)
  if (!SHA256.test(text)) issues.push({ path, message: 'Expected a lowercase SHA-256 digest.' })
  return text
}

function stringArray(value: unknown, path: string, issues: ParticleCorpusManifestIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'Expected an array.' })
    return
  }
  value.forEach((entry, index) => {
    requiredText(entry, `${path}/${index}`, issues)
  })
}

function validateDownload(
  value: unknown,
  path: string,
  issues: ParticleCorpusManifestIssue[],
): void {
  if (!record(value)) {
    issues.push({ path, message: 'Expected a download object.' })
    return
  }
  rejectUnknown(value, ['filename', 'url', 'sha256', 'sizeBytes', 'role'], path, issues)
  const filename = requiredText(value['filename'], `${path}/filename`, issues)
  if (
    filename === '.' ||
    filename === '..' ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0')
  )
    issues.push({ path: `${path}/filename`, message: 'Expected a safe basename.' })
  if (value['url'] !== undefined) httpsUrl(value['url'], `${path}/url`, issues)
  if (value['sha256'] !== undefined) sha256(value['sha256'], `${path}/sha256`, issues)
  if (value['sizeBytes'] !== undefined)
    positiveInteger(value['sizeBytes'], `${path}/sizeBytes`, issues)
  if (!['archive', 'image', 'mask', 'annotation', 'metadata'].includes(String(value['role'])))
    issues.push({ path: `${path}/role`, message: 'Unknown download role.' })
}

function validateSource(
  value: unknown,
  index: number,
  issues: ParticleCorpusManifestIssue[],
): void {
  const path = `/sources/${index}`
  if (!record(value)) {
    issues.push({ path, message: 'Expected a source object.' })
    return
  }
  rejectUnknown(
    value,
    [
      'id',
      'tier',
      'fetchPolicy',
      'title',
      'authors',
      'landingUrl',
      'license',
      'accessDate',
      'downloads',
      'notes',
    ],
    path,
    issues,
  )
  const id = requiredText(value['id'], `${path}/id`, issues)
  if (!SEMANTIC_ID.test(id)) issues.push({ path: `${path}/id`, message: 'Malformed source ID.' })
  if (!TIERS.has(value['tier'] as ParticleCorpusTier))
    issues.push({ path: `${path}/tier`, message: 'Unknown source tier.' })
  if (!FETCH_POLICIES.has(value['fetchPolicy'] as ParticleCorpusFetchPolicy))
    issues.push({ path: `${path}/fetchPolicy`, message: 'Unknown fetch policy.' })
  for (const key of ['title', 'authors', 'notes'])
    requiredText(value[key], `${path}/${key}`, issues)
  httpsUrl(value['landingUrl'], `${path}/landingUrl`, issues)
  const accessDate = requiredText(value['accessDate'], `${path}/accessDate`, issues)
  if (!ISO_DATE.test(accessDate))
    issues.push({ path: `${path}/accessDate`, message: 'Expected an ISO calendar date.' })
  if (!record(value['license'])) {
    issues.push({ path: `${path}/license`, message: 'Expected a license object.' })
  } else {
    const license = value['license']
    rejectUnknown(
      license,
      ['id', 'evidenceUrl', 'attribution', 'commercialUse', 'redistribution', 'derivativeWorks'],
      `${path}/license`,
      issues,
    )
    requiredText(license['id'], `${path}/license/id`, issues)
    httpsUrl(license['evidenceUrl'], `${path}/license/evidenceUrl`, issues)
    requiredText(license['attribution'], `${path}/license/attribution`, issues)
    for (const key of ['commercialUse', 'redistribution', 'derivativeWorks'])
      if (typeof license[key] !== 'boolean')
        issues.push({ path: `${path}/license/${key}`, message: 'Expected a boolean.' })
    if (value['tier'] !== 'excluded' && value['tier'] !== 'quarantined') {
      if (
        license['commercialUse'] !== true ||
        license['redistribution'] !== true ||
        license['derivativeWorks'] !== true
      )
        issues.push({
          path: `${path}/license`,
          message: 'Core and extended sources must pass every redistribution policy gate.',
        })
    }
  }
  if (!Array.isArray(value['downloads']))
    issues.push({ path: `${path}/downloads`, message: 'Expected a download array.' })
  else
    value['downloads'].forEach((download, downloadIndex) => {
      validateDownload(download, `${path}/downloads/${downloadIndex}`, issues)
    })
  if (value['fetchPolicy'] === 'core-explicit' && Array.isArray(value['downloads'])) {
    if (value['downloads'].length === 0)
      issues.push({
        path: `${path}/downloads`,
        message: 'Fetchable core sources require at least one pinned download.',
      })
    for (const [downloadIndex, download] of value['downloads'].entries())
      if (
        !record(download) ||
        typeof download['url'] !== 'string' ||
        typeof download['sha256'] !== 'string'
      )
        issues.push({
          path: `${path}/downloads/${downloadIndex}`,
          message: 'Fetchable core downloads require an exact URL and SHA-256.',
        })
  }
}

function validateAsset(value: unknown, path: string, issues: ParticleCorpusManifestIssue[]): void {
  if (!record(value)) {
    issues.push({ path, message: 'Expected an asset object.' })
    return
  }
  rejectUnknown(value, ['path', 'sha256', 'sizeBytes', 'format'], path, issues)
  localPath(value['path'], `${path}/path`, issues)
  sha256(value['sha256'], `${path}/sha256`, issues)
  positiveInteger(value['sizeBytes'], `${path}/sizeBytes`, issues)
  requiredText(value['format'], `${path}/format`, issues)
}

function validateFixture(
  value: unknown,
  index: number,
  sourceIds: ReadonlySet<string>,
  issues: ParticleCorpusManifestIssue[],
): void {
  const path = `/fixtures/${index}`
  if (!record(value)) {
    issues.push({ path, message: 'Expected a fixture object.' })
    return
  }
  rejectUnknown(
    value,
    [
      'id',
      'sourceId',
      'originalFilename',
      'sourceSha256',
      'image',
      'nativeFormat',
      'derivedFormat',
      'dimensions',
      'calibration',
      'labels',
      'edgePolicy',
      'derivation',
      'review',
      'tasks',
      'failureModes',
      'split',
      'domainGroup',
      'sourceSelection',
    ],
    path,
    issues,
  )
  const id = requiredText(value['id'], `${path}/id`, issues)
  if (!SEMANTIC_ID.test(id)) issues.push({ path: `${path}/id`, message: 'Malformed fixture ID.' })
  const sourceId = requiredText(value['sourceId'], `${path}/sourceId`, issues)
  if (!sourceIds.has(sourceId))
    issues.push({ path: `${path}/sourceId`, message: 'Fixture source is not declared.' })
  requiredText(value['originalFilename'], `${path}/originalFilename`, issues)
  sha256(value['sourceSha256'], `${path}/sourceSha256`, issues)
  validateAsset(value['image'], `${path}/image`, issues)
  for (const key of ['nativeFormat', 'derivedFormat', 'split', 'domainGroup'])
    requiredText(value[key], `${path}/${key}`, issues)
  if (!record(value['dimensions'])) {
    issues.push({ path: `${path}/dimensions`, message: 'Expected dimensions.' })
  } else {
    rejectUnknown(
      value['dimensions'],
      ['width', 'height', 'channels', 'bitDepth'],
      `${path}/dimensions`,
      issues,
    )
    for (const key of ['width', 'height', 'channels', 'bitDepth'])
      positiveInteger(value['dimensions'][key], `${path}/dimensions/${key}`, issues)
  }
  if (value['calibration'] !== null) {
    if (!record(value['calibration']))
      issues.push({ path: `${path}/calibration`, message: 'Expected null or calibration.' })
    else {
      rejectUnknown(value['calibration'], ['pixelSize', 'unit'], `${path}/calibration`, issues)
      if (
        typeof value['calibration']['pixelSize'] !== 'number' ||
        !Number.isFinite(value['calibration']['pixelSize']) ||
        value['calibration']['pixelSize'] <= 0
      )
        issues.push({ path: `${path}/calibration/pixelSize`, message: 'Invalid pixel size.' })
      requiredText(value['calibration']['unit'], `${path}/calibration/unit`, issues)
    }
  }
  let reviewStatus: ParticleGroundTruthStatus | undefined
  if (!record(value['labels'])) {
    issues.push({ path: `${path}/labels`, message: 'Expected labels.' })
  } else {
    const labels = value['labels']
    rejectUnknown(
      labels,
      [
        'instanceMask',
        'semanticMask',
        'ignoreMask',
        'objectCountIncludingBorder',
        'objectCountExcludingBorder',
      ],
      `${path}/labels`,
      issues,
    )
    for (const key of ['instanceMask', 'semanticMask', 'ignoreMask'])
      if (labels[key] !== null) validateAsset(labels[key], `${path}/labels/${key}`, issues)
    nullableCount(
      labels['objectCountIncludingBorder'],
      `${path}/labels/objectCountIncludingBorder`,
      issues,
    )
    nullableCount(
      labels['objectCountExcludingBorder'],
      `${path}/labels/objectCountExcludingBorder`,
      issues,
    )
  }
  if (value['edgePolicy'] !== 'include-mask-exclude-morphometry')
    issues.push({ path: `${path}/edgePolicy`, message: 'Unknown edge policy.' })
  if (!Array.isArray(value['derivation']))
    issues.push({ path: `${path}/derivation`, message: 'Expected a derivation array.' })
  else
    value['derivation'].forEach((step, stepIndex) => {
      const stepPath = `${path}/derivation/${stepIndex}`
      if (!record(step)) {
        issues.push({ path: stepPath, message: 'Expected a derivation step.' })
        return
      }
      rejectUnknown(step, ['operation', 'parameters'], stepPath, issues)
      requiredText(step['operation'], `${stepPath}/operation`, issues)
      if (!record(step['parameters']))
        issues.push({ path: `${stepPath}/parameters`, message: 'Expected an object.' })
      else
        for (const [key, parameter] of Object.entries(step['parameters']))
          if (
            (parameter !== null && !['string', 'number', 'boolean'].includes(typeof parameter)) ||
            (typeof parameter === 'number' && !Number.isFinite(parameter))
          )
            issues.push({ path: `${stepPath}/parameters/${key}`, message: 'Expected a scalar.' })
    })
  if (!record(value['review'])) {
    issues.push({ path: `${path}/review`, message: 'Expected review metadata.' })
  } else {
    const review = value['review']
    rejectUnknown(review, ['status', 'reviewer', 'reviewedAt'], `${path}/review`, issues)
    if (!REVIEW_STATES.has(review['status'] as ParticleGroundTruthStatus))
      issues.push({ path: `${path}/review/status`, message: 'Unknown review status.' })
    else reviewStatus = review['status'] as ParticleGroundTruthStatus
    for (const key of ['reviewer', 'reviewedAt'])
      if (review[key] !== null) requiredText(review[key], `${path}/review/${key}`, issues)
    if (
      reviewStatus === 'adjudicated-gold' &&
      (review['reviewer'] === null || review['reviewedAt'] === null)
    )
      issues.push({ path: `${path}/review`, message: 'Gold fixtures require reviewer evidence.' })
  }
  stringArray(value['tasks'], `${path}/tasks`, issues)
  stringArray(value['failureModes'], `${path}/failureModes`, issues)
  if (!record(value['sourceSelection'])) {
    issues.push({ path: `${path}/sourceSelection`, message: 'Expected source selection.' })
  } else {
    const selection = value['sourceSelection']
    rejectUnknown(selection, ['arrayIndex', 'crop', 'selection'], `${path}/sourceSelection`, issues)
    if (
      selection['arrayIndex'] !== null &&
      (!Number.isSafeInteger(selection['arrayIndex']) || Number(selection['arrayIndex']) < 0)
    )
      issues.push({ path: `${path}/sourceSelection/arrayIndex`, message: 'Invalid array index.' })
    if (selection['crop'] !== null) {
      if (!record(selection['crop']))
        issues.push({ path: `${path}/sourceSelection/crop`, message: 'Expected a crop.' })
      else {
        rejectUnknown(
          selection['crop'],
          ['x', 'y', 'width', 'height'],
          `${path}/sourceSelection/crop`,
          issues,
        )
        for (const key of ['x', 'y'])
          if (!Number.isSafeInteger(selection['crop'][key]) || Number(selection['crop'][key]) < 0)
            issues.push({
              path: `${path}/sourceSelection/crop/${key}`,
              message: 'Invalid crop origin.',
            })
        for (const key of ['width', 'height'])
          positiveInteger(selection['crop'][key], `${path}/sourceSelection/crop/${key}`, issues)
      }
    }
    if (selection['selection'] !== null) {
      if (!record(selection['selection']))
        issues.push({
          path: `${path}/sourceSelection/selection`,
          message: 'Expected selection evidence.',
        })
      else {
        const evidence = selection['selection']
        rejectUnknown(
          evidence,
          ['selectorVersion', 'reasons', 'features'],
          `${path}/sourceSelection/selection`,
          issues,
        )
        requiredText(
          evidence['selectorVersion'],
          `${path}/sourceSelection/selection/selectorVersion`,
          issues,
        )
        stringArray(evidence['reasons'], `${path}/sourceSelection/selection/reasons`, issues)
        if (Array.isArray(evidence['reasons']) && evidence['reasons'].length === 0)
          issues.push({
            path: `${path}/sourceSelection/selection/reasons`,
            message: 'Selected fixtures require at least one reason.',
          })
        if (!record(evidence['features']))
          issues.push({
            path: `${path}/sourceSelection/selection/features`,
            message: 'Expected a feature vector.',
          })
        else {
          if (Object.keys(evidence['features']).length === 0)
            issues.push({
              path: `${path}/sourceSelection/selection/features`,
              message: 'Selected fixtures require a non-empty feature vector.',
            })
          for (const [key, feature] of Object.entries(evidence['features']))
            if (key.trim() === '' || typeof feature !== 'number' || !Number.isFinite(feature))
              issues.push({
                path: `${path}/sourceSelection/selection/features/${key}`,
                message: 'Selection features must be finite numbers.',
              })
        }
      }
    }
  }
  if (reviewStatus === 'adjudicated-gold' && record(value['labels'])) {
    if (value['labels']['instanceMask'] === null)
      issues.push({
        path: `${path}/labels/instanceMask`,
        message: 'Counting gold requires an instance mask.',
      })
    if (value['labels']['ignoreMask'] === null)
      issues.push({
        path: `${path}/labels/ignoreMask`,
        message: 'Gold fixtures require an ignore mask.',
      })
  }
}

/** Strict runtime validation for the fixture-level particle corpus. Unknown keys fail closed. */
export function validateParticleCorpusManifest(value: unknown): ParticleCorpusManifestValidation {
  const issues: ParticleCorpusManifestIssue[] = []
  if (!record(value)) return { ok: false, issues: [{ path: '/', message: 'Expected an object.' }] }
  rejectUnknown(
    value,
    ['schemaVersion', 'corpusVersion', 'generatedAt', 'policy', 'sources', 'fixtures'],
    '',
    issues,
  )
  if (value['schemaVersion'] !== 1)
    issues.push({ path: '/schemaVersion', message: 'Unsupported particle corpus schema.' })
  requiredText(value['corpusVersion'], '/corpusVersion', issues)
  const generatedAt = requiredText(value['generatedAt'], '/generatedAt', issues)
  if (!ISO_DATE.test(generatedAt))
    issues.push({ path: '/generatedAt', message: 'Expected an ISO calendar date.' })
  const policyKeys = [
    'requireCommercialUse',
    'requireRedistribution',
    'requireDerivativeWorks',
    'failClosedOnUnknownLicense',
    'requireSha256',
    'requireTransformProvenance',
    'requireAdjudicationForGold',
  ] as const
  if (!record(value['policy'])) issues.push({ path: '/policy', message: 'Expected policy.' })
  else {
    rejectUnknown(value['policy'], policyKeys, '/policy', issues)
    for (const key of policyKeys)
      if (value['policy'][key] !== true)
        issues.push({ path: `/policy/${key}`, message: 'Particle corpus policy must fail closed.' })
  }
  const sourceIds = new Set<string>()
  if (!Array.isArray(value['sources']))
    issues.push({ path: '/sources', message: 'Expected sources.' })
  else {
    value['sources'].forEach((source, index) => {
      validateSource(source, index, issues)
      if (record(source) && typeof source['id'] === 'string') {
        if (sourceIds.has(source['id']))
          issues.push({ path: `/sources/${index}/id`, message: 'Duplicate source ID.' })
        sourceIds.add(source['id'])
      }
    })
  }
  const fixtureIds = new Set<string>()
  if (!Array.isArray(value['fixtures']))
    issues.push({ path: '/fixtures', message: 'Expected fixtures.' })
  else
    value['fixtures'].forEach((fixture, index) => {
      validateFixture(fixture, index, sourceIds, issues)
      if (record(fixture) && typeof fixture['id'] === 'string') {
        if (fixtureIds.has(fixture['id']))
          issues.push({ path: `/fixtures/${index}/id`, message: 'Duplicate fixture ID.' })
        fixtureIds.add(fixture['id'])
      }
    })
  return issues.length === 0
    ? { ok: true, value: value as unknown as ParticleCorpusManifestV1, issues: [] }
    : { ok: false, issues }
}
