import { describe, expect, it } from 'vitest'

import { findFeatureCycles, inspectSource } from './check-boundaries.mjs'

describe('architecture boundary checker', () => {
  it('accepts public package composition', () => {
    expect(
      inspectSource(
        'apps/science/src/app.tsx',
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

  it('allows the explicit trusted scientific extension to use public PureJsImage APIs', () => {
    expect(
      inspectSource(
        'packages/materials-analysis/src/provider.ts',
        "import { createOperationProvider } from 'purejsimage/operations'",
      ),
    ).toEqual([])
  })

  it.each([
    ['packages/workspace/src/index.ts', "import React from 'react'"],
    ['packages/workbench-core/src/index.ts', "import React from 'react'"],
    ['packages/workbench-core/src/index.ts', "import { decode } from 'purejsimage'"],
    ['packages/viewport/src/index.ts', "import { decode } from 'purejsimage'"],
    ['packages/workspace/src/index.ts', "import { validateGraph } from 'purejsimage/analysis'"],
    ['packages/imaging/src/index.ts', "import value from 'purejsimage/src/internal'"],
    ['packages/imaging/src/worker.ts', "const privateModule = import('purejsimage/src/reader')"],
    ['packages/contracts/src/index.ts', "import app from '../../../apps/science/src/app'"],
    ['apps/science/src/app.tsx', "import value from '@pji-workbench/contracts/src/private'"],
    [
      'apps/geo/src/App.tsx',
      "import { scienceDomainProfile } from '@pji-workbench/domain-science'",
    ],
    ['apps/geo/src/App.tsx', "import { runBatchRecipe } from '@pji-workbench/materials-analysis'"],
    ['apps/science/src/App.tsx', "import { geoDomainProfile } from '@pji-workbench/domain-geo'"],
    [
      'apps/gallery/src/App.tsx',
      "import { createImagingWorkerClient } from '@pji-workbench/imaging'",
    ],
  ])('rejects %s crossing a protected boundary', (file, source) => {
    expect(inspectSource(file, source)).toHaveLength(1)
  })

  it('detects cycles between application feature boundaries', () => {
    expect(
      findFeatureCycles([
        { file: 'apps/science/src/features/source/a.ts', source: "import '../analysis/b.js'" },
        { file: 'apps/science/src/features/analysis/b.ts', source: "import '../source/a.js'" },
      ]),
    ).toEqual(['analysis -> source -> analysis'])
  })
})
