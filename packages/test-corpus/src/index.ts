export * from './archive.js'
export * from './audit.js'
export * from './delivery.js'
export * from './manifest.js'
export * from './reference-oracle.js'
export * from './scenario-artifacts.js'
export * from './types.js'
export * from './validation.js'

export const EXAMPLE_SCENARIO_SCHEMA_V1 = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://purejsimage.com/schemas/example-scenario-v1.json',
  title: 'ExampleScenarioV1',
  type: 'object',
  properties: {
    schemaVersion: { const: 1 },
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9.-]*$' },
    status: { enum: ['enabled', 'candidate', 'scheduled', 'excluded', 'disabled'] },
    tier: { enum: ['generated', 'bundled', 'hosted', 'external'] },
    statusReason: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    summary: { type: 'string', minLength: 1 },
    modality: { type: 'string', minLength: 1 },
    vendor: { type: 'string', minLength: 1 },
    format: { type: 'string', minLength: 1 },
    sizeClass: { enum: ['tiny', 'small', 'medium', 'large', 'very-large'] },
    calibration: { type: 'string', minLength: 1 },
    source: { type: 'object' },
    license: { type: 'object' },
    preview: { type: 'object' },
    initialAnalysis: { type: 'object' },
    tags: { type: 'array', items: { type: 'string', minLength: 1 } },
    learningGoals: { type: 'array', items: { type: 'string', minLength: 1 } },
    workflows: { type: 'array', minItems: 1 },
    expected: { type: 'array', minItems: 1 },
    budgets: { type: 'object' },
    testPlan: { type: 'object' },
    testTags: { type: 'array', items: { type: 'string', minLength: 1 } },
    verifiedAt: { type: 'string', minLength: 1 },
  },
  required: [
    'schemaVersion',
    'id',
    'status',
    'tier',
    'statusReason',
    'title',
    'summary',
    'modality',
    'format',
    'source',
    'license',
    'preview',
    'tags',
    'learningGoals',
    'workflows',
    'expected',
    'budgets',
    'testPlan',
    'testTags',
  ],
  additionalProperties: false,
} as const)
