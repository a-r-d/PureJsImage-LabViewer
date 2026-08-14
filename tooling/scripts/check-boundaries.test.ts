import { describe, expect, it } from 'vitest'

import { inspectSource } from './check-boundaries.mjs'

describe('architecture boundary checker', () => {
  it('accepts public package composition', () => {
    expect(
      inspectSource(
        'apps/workbench/src/app.tsx',
        "import { schemaVersion } from '@pji-workbench/contracts'",
      ),
    ).toEqual([])
  })

  it('allows deliberate type-only PureJsImage persistence contracts', () => {
    expect(
      inspectSource(
        'packages/workspace/src/model.ts',
        "import type { AnalysisGraph } from 'purejsimage/analysis'",
      ),
    ).toEqual([])
  })

  it.each([
    ['packages/workspace/src/index.ts', "import React from 'react'"],
    ['packages/viewport/src/index.ts', "import { decode } from 'purejsimage'"],
    ['packages/workspace/src/index.ts', "import { validateGraph } from 'purejsimage/analysis'"],
    ['packages/imaging/src/index.ts', "import value from 'purejsimage/src/internal'"],
    ['packages/imaging/src/worker.ts', "const privateModule = import('purejsimage/src/reader')"],
    ['packages/contracts/src/index.ts', "import app from '../../../apps/workbench/src/app'"],
    ['apps/workbench/src/app.tsx', "import value from '@pji-workbench/contracts/src/private'"],
  ])('rejects %s crossing a protected boundary', (file, source) => {
    expect(inspectSource(file, source)).toHaveLength(1)
  })
})
