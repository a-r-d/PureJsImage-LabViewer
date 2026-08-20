import type {
  DerivedRasterDryRunReport,
  DerivedRasterDryRunRequest,
  DerivedRasterLineProfileRequest,
  DerivedRasterLineProfileResponse,
  DerivedRasterRecipeInputV1,
  DerivedRasterRecipeV1,
  DerivedRasterRequestBase,
  DerivedRasterRuntimeInputV1,
  DerivedRasterStatisticsRequest,
  DerivedRasterStatisticsResponse,
  RasterTargetGridV1,
  RasterTransformDescriptorV1,
  Region,
} from '@pji-workbench/contracts'
import {
  computeRasterRegionStatistics,
  createLinearCombinationPlan,
  createNormalizedDifferencePlan,
  createRasterBandMathPlan,
  createRasterLineProfilePlan,
  createRasterRegionStatisticsPlan,
  createRasterSubtractionPlan,
  createRasterTargetGridPlan,
  createRasterTerrainPlan,
  evaluateRasterBandMathTile,
  evaluateRasterTerrainTile,
  type NumericRasterGrid,
  normalizeNumericRasterGrid,
  numericRasterGridsEqual,
  type RasterCoordinateTransform,
  type RasterLengthUnit,
  type RasterNoData,
  type RasterOperationLimits,
  resampleRasterTileToGrid,
  sampleRasterLineProfile,
} from 'purejsimage/analysis'
import { type NumericTile, numericTileSampleOffset } from 'purejsimage/scientific'

import type { DatasetRecord } from './runtime.js'

export interface DerivedRasterTransformProvider {
  resolve(
    descriptor: RasterTransformDescriptorV1,
    sourceCrs: string,
    targetCrs: string,
  ): RasterCoordinateTransform | undefined
}

export interface BoundDerivedRasterInput {
  readonly recipe: DerivedRasterRecipeInputV1
  readonly runtime: DerivedRasterRuntimeInputV1
  readonly record: DatasetRecord
}

interface EvaluatedInput {
  readonly tile: NumericTile
  readonly component: number
}

export function derivedRasterCacheKey(request: DerivedRasterRequestBase): string {
  return stableHash(
    canonicalJson({
      schema: 'pji-workbench.derived-raster-cache.v1',
      layerId: request.layerId,
      recipe: request.recipe,
      inputs: request.inputs.map((input) => ({
        layerId: input.layerId,
        sourceIdentity: input.sourceIdentity,
        sourceRevision: input.sourceRevision,
        grid: input.grid,
      })),
    }),
  )
}

export function dryRunDerivedRaster(
  request: DerivedRasterDryRunRequest,
  inputs: readonly BoundDerivedRasterInput[],
  transforms: DerivedRasterTransformProvider | undefined,
): DerivedRasterDryRunReport {
  validateBindings(request, inputs)
  validateRecipeOperation(request.recipe)
  const requirements = inputs.flatMap((input) => {
    const source = grid(input.runtime.grid)
    const target = grid(request.recipe.targetGrid)
    if (numericRasterGridsEqual(source, target)) return []
    if (request.recipe.alignment === 'exact') {
      throw new Error(`Input ${input.recipe.layerId} does not exactly match the target grid.`)
    }
    if (source.crs === target.crs) return []
    const descriptor = input.recipe.transform
    if (descriptor === undefined)
      throw new Error(`Input ${input.recipe.layerId} requires a coordinate transform.`)
    const transform = transforms?.resolve(descriptor, source.crs, target.crs)
    if (transform === undefined)
      throw new Error(`Transform ${descriptor.id}@${descriptor.version} is unavailable.`)
    return [
      {
        layerId: input.recipe.layerId,
        sourceCrs: source.crs,
        targetCrs: target.crs,
        descriptor,
      },
    ]
  })
  const target = grid(request.recipe.targetGrid)
  const componentCount = outputComponentCount(request.recipe)
  const tilePixels = Math.min(256, target.width) * Math.min(256, target.height)
  const estimatedTiles = Math.ceil(target.width / 256) * Math.ceil(target.height / 256)
  const perTileInputBytes = tilePixels * 4 * inputs.length
  return {
    valid: true,
    cacheKey: derivedRasterCacheKey(request),
    sources: inputs.map(({ runtime }) => ({
      layerId: runtime.layerId,
      sourceIdentity: runtime.sourceIdentity,
      sourceRevision: runtime.sourceRevision,
      grid: runtime.grid,
    })),
    targetGrid: request.recipe.targetGrid,
    estimatedTiles,
    estimatedTransferredBytes: estimatedTiles * perTileInputBytes,
    estimatedManagedMemory: perTileInputBytes * 2 + tilePixels * componentCount * 4,
    transformRequirements: requirements,
    resampling: target.resampling,
    nodataPolicy: request.recipe.outputNoData,
    expectedOutput: { sampleType: 'float32', componentCount },
    warnings: requirements.flatMap(({ descriptor }) =>
      descriptor.accuracy.kind === 'estimated'
        ? [
            `Transform ${descriptor.id}@${descriptor.version} is estimated to ${descriptor.accuracy.maximumError} ${descriptor.accuracy.unit}.`,
          ]
        : [],
    ),
  }
}

export async function evaluateDerivedRasterTile(
  request: DerivedRasterRequestBase,
  inputs: readonly BoundDerivedRasterInput[],
  region: Region,
  priority: 'visible' | 'near-visible' | 'background',
  signal: AbortSignal,
  transforms: DerivedRasterTransformProvider | undefined,
): Promise<NumericTile> {
  dryRunDerivedRaster(request, inputs, transforms)
  const operation = request.recipe.operation
  const terrain = operation.kind === 'terrain'
  const readTarget = terrain ? haloRegion(region, request.recipe.targetGrid) : region
  const evaluated: EvaluatedInput[] = []
  try {
    for (const input of inputs) {
      signal.throwIfAborted()
      evaluated.push(
        await evaluateInput(input, request.recipe, readTarget, priority, signal, transforms),
      )
    }
    signal.throwIfAborted()
    const limits = operationLimits(request.recipe)
    if (operation.kind === 'virtual-band-stack') {
      const ordered = operation.bands.map((name) => requiredEvaluatedInput(name, inputs, evaluated))
      return stackBands(ordered, readTarget, limits)
    }
    if (operation.kind === 'terrain') {
      const input = requiredEvaluatedInput(operation.input, inputs, evaluated)
      const plan = createRasterTerrainPlan({
        operation: operation.operation,
        component: input.component,
        sourceWidth: request.recipe.targetGrid.width,
        sourceHeight: request.recipe.targetGrid.height,
        xSpacing: operation.xSpacing,
        ySpacing: operation.ySpacing,
        xUnit: operation.xUnit as RasterLengthUnit,
        yUnit: operation.yUnit as RasterLengthUnit,
        verticalUnit: operation.verticalUnit as RasterLengthUnit,
        rowDirection: operation.rowDirection,
        edge: operation.edge,
        inputNoData: noData(namedInput(operation.input, request.recipe).noData),
        outputNoData: noData(request.recipe.outputNoData),
        slopeUnit: operation.slopeUnit,
        azimuthDegrees: operation.azimuthDegrees,
        altitudeDegrees: operation.altitudeDegrees,
      })
      return evaluateRasterTerrainTile(plan, input.tile, region, { signal, limits })
    }
    const planInputs = request.recipe.inputs.map((input, index) => ({
      name: input.name,
      component: evaluated[index]?.component ?? 0,
      valueMode: 'raw' as const,
      scale: 1,
      offset: 0,
      noData: noData(input.noData),
    }))
    const options = {
      outputSampleType: 'float32' as const,
      outputNoData: noData(request.recipe.outputNoData),
      limits,
    }
    const plan =
      operation.kind === 'band-math'
        ? createRasterBandMathPlan({
            ...options,
            expression: operation.expression,
            inputs: planInputs,
            divideByZero: operation.divideByZero,
            nonFinite: operation.nonFinite,
            ...(operation.clamp === undefined ? {} : { clamp: operation.clamp }),
          })
        : operation.kind === 'normalized-difference'
          ? createNormalizedDifferencePlan(
              namedPlanInput(operation.left, planInputs),
              namedPlanInput(operation.right, planInputs),
              options,
            )
          : operation.kind === 'linear-combination'
            ? createLinearCombinationPlan(
                operation.terms.map((term) => ({
                  ...namedPlanInput(term.input, planInputs),
                  coefficient: term.coefficient,
                })),
                operation.constant,
                options,
              )
            : createRasterSubtractionPlan(
                namedPlanInput(operation.minuend, planInputs),
                namedPlanInput(operation.subtrahend, planInputs),
                options,
              )
    return evaluateRasterBandMathTile(
      plan,
      evaluated.map(({ tile }) => tile),
      region,
      { signal, limits },
    )
  } finally {
    for (const input of evaluated) input.tile.release()
  }
}

export async function computeDerivedRasterStatistics(
  request: DerivedRasterStatisticsRequest,
  inputs: readonly BoundDerivedRasterInput[],
  signal: AbortSignal,
  transforms: DerivedRasterTransformProvider | undefined,
): Promise<DerivedRasterStatisticsResponse> {
  const tile = await evaluateDerivedRasterTile(
    request,
    inputs,
    request.region,
    'background',
    signal,
    transforms,
  )
  try {
    const result = computeRasterRegionStatistics(
      createRasterRegionStatisticsPlan({
        component: request.component,
        noData: noData(request.recipe.outputNoData),
        ...(request.histogram === undefined ? {} : { histogram: request.histogram }),
        limits: operationLimits(request.recipe),
      }),
      tile,
      request.region,
      { signal, limits: operationLimits(request.recipe) },
    )
    return {
      cacheKey: derivedRasterCacheKey(request),
      ...result,
    }
  } finally {
    tile.release()
  }
}

export async function sampleDerivedRasterLine(
  request: DerivedRasterLineProfileRequest,
  inputs: readonly BoundDerivedRasterInput[],
  signal: AbortSignal,
  transforms: DerivedRasterTransformProvider | undefined,
): Promise<DerivedRasterLineProfileResponse> {
  const region = lineRegion(request)
  const tile = await evaluateDerivedRasterTile(
    request,
    inputs,
    region,
    'background',
    signal,
    transforms,
  )
  try {
    const result = sampleRasterLineProfile(
      createRasterLineProfilePlan({
        start: request.start,
        end: request.end,
        sampleCount: request.sampleCount,
        component: request.component,
        resampling: request.resampling,
        noData: noData(request.recipe.outputNoData),
        minimumValidWeight: request.recipe.minimumValidWeight,
        limits: operationLimits(request.recipe),
      }),
      tile,
      { signal, limits: operationLimits(request.recipe) },
    )
    return { cacheKey: derivedRasterCacheKey(request), ...result }
  } finally {
    tile.release()
  }
}

async function evaluateInput(
  input: BoundDerivedRasterInput,
  recipe: DerivedRasterRecipeV1,
  targetRegion: Region,
  priority: 'visible' | 'near-visible' | 'background',
  signal: AbortSignal,
  transforms: DerivedRasterTransformProvider | undefined,
): Promise<EvaluatedInput> {
  const sourceGrid = grid(input.runtime.grid)
  const targetGrid = grid(recipe.targetGrid)
  if (numericRasterGridsEqual(sourceGrid, targetGrid)) {
    const source = await requestSourceTile(input.record, targetRegion, priority, signal)
    try {
      return normalizeInputValues(
        input.recipe,
        source,
        input.recipe.component,
        targetRegion,
        recipe,
        signal,
      )
    } finally {
      source.release()
    }
  }
  if (recipe.alignment !== 'resample')
    throw new Error(`Input ${input.recipe.layerId} requires explicit resampling.`)
  const descriptor = input.recipe.transform
  const transform =
    sourceGrid.crs === targetGrid.crs
      ? undefined
      : descriptor === undefined
        ? undefined
        : transforms?.resolve(descriptor, sourceGrid.crs, targetGrid.crs)
  if (sourceGrid.crs !== targetGrid.crs && transform === undefined)
    throw new Error(`Input ${input.recipe.layerId} requires an available coordinate transform.`)
  const sourceRegion = requiredSourceRegion(
    sourceGrid,
    targetGrid,
    targetRegion,
    recipe.targetGrid.resampling,
    transform,
    signal,
  )
  const source = await requestSourceTile(input.record, sourceRegion, priority, signal)
  try {
    const plannedTransform = sourceGrid.crs === targetGrid.crs ? undefined : descriptor
    const intermediateTarget: NumericRasterGrid = {
      ...targetGrid,
      sampleType: recipe.targetGrid.resampling === 'nearest' ? source.sampleType : 'float32',
      noData: noData(input.recipe.noData),
    }
    const plan = createRasterTargetGridPlan({
      sourceGrid,
      targetGrid: intermediateTarget,
      sourceComponent: input.recipe.component,
      resampling: recipe.targetGrid.resampling,
      sourceNoData: noData(input.recipe.noData),
      outputNoData: noData(input.recipe.noData),
      minimumValidWeight: recipe.minimumValidWeight,
      ...(plannedTransform === undefined ? {} : { transform: plannedTransform }),
    })
    const resampled = resampleRasterTileToGrid(plan, source, targetRegion, {
      ...(transform === undefined ? {} : { transform }),
      signal,
      limits: operationLimits(recipe),
    })
    try {
      return normalizeInputValues(input.recipe, resampled, 0, targetRegion, recipe, signal)
    } finally {
      resampled.release()
    }
  } finally {
    source.release()
  }
}

function normalizeInputValues(
  input: DerivedRasterRecipeInputV1,
  tile: NumericTile,
  component: number,
  region: Region,
  recipe: DerivedRasterRecipeV1,
  signal: AbortSignal,
): EvaluatedInput {
  const plan = createLinearCombinationPlan(
    [
      {
        name: input.name,
        component,
        valueMode: input.valueMode,
        scale: input.scale,
        offset: input.offset,
        noData: noData(input.noData),
        coefficient: 1,
      },
    ],
    0,
    {
      outputSampleType: 'float32',
      outputNoData: noData(input.noData),
      limits: operationLimits(recipe),
    },
  )
  return {
    tile: evaluateRasterBandMathTile(plan, [tile], region, {
      signal,
      limits: operationLimits(recipe),
    }),
    component: 0,
  }
}

async function requestSourceTile(
  record: DatasetRecord,
  region: Region,
  priority: 'visible' | 'near-visible' | 'background',
  signal: AbortSignal,
): Promise<NumericTile> {
  return record.runtime.request(record.tileSource, {
    address: {
      cacheClass: 'source',
      namespace: `geo-derived:${record.handleId}`,
      dataset: record.tileIdentity,
      displayAxes: record.selection.displayAxes,
      fixedIndices: record.selection.fixedIndices,
      resolutionLevel: 0,
      ...region,
    },
    priority,
    signal,
    target: { sampleType: 'float32' },
  })
}

function requiredSourceRegion(
  source: NumericRasterGrid,
  target: NumericRasterGrid,
  region: Region,
  resampling: 'nearest' | 'bilinear',
  transform: RasterCoordinateTransform | undefined,
  signal: AbortSignal,
): Region {
  let minimumPixelX = Number.POSITIVE_INFINITY
  let minimumPixelY = Number.POSITIVE_INFINITY
  let maximumPixelX = Number.NEGATIVE_INFINITY
  let maximumPixelY = Number.NEGATIVE_INFINITY
  const include = (column: number, row: number): void => {
    const model = modelPoint(target, column, row)
    const sourceModel = transform?.inverse(model[0], model[1]) ?? model
    const pixel = pixelPoint(source, sourceModel[0], sourceModel[1])
    if (!Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1]))
      throw new Error('Coordinate transform returned a non-finite source position.')
    minimumPixelX = Math.min(minimumPixelX, pixel[0])
    minimumPixelY = Math.min(minimumPixelY, pixel[1])
    maximumPixelX = Math.max(maximumPixelX, pixel[0])
    maximumPixelY = Math.max(maximumPixelY, pixel[1])
  }
  if (transform === undefined) {
    include(region.x, region.y)
    include(region.x + region.width, region.y)
    include(region.x, region.y + region.height)
    include(region.x + region.width, region.y + region.height)
  } else {
    for (let row = region.y; row < region.y + region.height; row += 1) {
      signal.throwIfAborted()
      for (let column = region.x; column < region.x + region.width; column += 1) {
        include(column, row)
      }
    }
  }
  const padding = resampling === 'bilinear' ? 2 : 1
  const minimumX = Math.max(0, Math.floor(minimumPixelX) - padding)
  const minimumY = Math.max(0, Math.floor(minimumPixelY) - padding)
  const maximumX = Math.min(source.width, Math.ceil(maximumPixelX) + padding + 1)
  const maximumY = Math.min(source.height, Math.ceil(maximumPixelY) + padding + 1)
  if (maximumX <= minimumX || maximumY <= minimumY) return { x: 0, y: 0, width: 1, height: 1 }
  return {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  }
}

function stackBands(
  inputs: readonly EvaluatedInput[],
  region: Region,
  limits: RasterOperationLimits,
): NumericTile {
  const pixels = region.width * region.height
  const bytes = pixels * inputs.length * 4
  if (
    pixels > (limits.maxTilePixels ?? Number.MAX_SAFE_INTEGER) ||
    bytes > (limits.maxOutputBytes ?? Number.MAX_SAFE_INTEGER) ||
    bytes > (limits.maxWorkingBytes ?? Number.MAX_SAFE_INTEGER)
  )
    throw new Error('Virtual band stack exceeds its configured memory budget.')
  const data = new Float32Array(pixels * inputs.length)
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const x = pixel % region.width
    const y = Math.floor(pixel / region.width)
    for (let band = 0; band < inputs.length; band += 1) {
      const input = inputs[band]
      if (input === undefined) continue
      data[pixel * inputs.length + band] = tileNumber(input.tile, x, y, input.component)
    }
  }
  return {
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    sampleType: 'float32',
    componentCount: inputs.length,
    layout: 'interleaved',
    rowStrideElements: region.width * inputs.length,
    data,
    release: () => undefined,
  }
}

function tileNumber(tile: NumericTile, x: number, y: number, component: number): number {
  const value = tile.data[numericTileSampleOffset(tile, x, y, component)]
  return typeof value === 'bigint' ? Number(value) : (value ?? Number.NaN)
}

function validateBindings(
  request: DerivedRasterRequestBase,
  inputs: readonly BoundDerivedRasterInput[],
): void {
  if (inputs.length !== request.recipe.inputs.length)
    throw new Error('Derived runtime inputs do not match the recipe.')
  const names = new Set<string>()
  for (let index = 0; index < inputs.length; index += 1) {
    const bound = inputs[index]
    const recipe = request.recipe.inputs[index]
    if (
      bound === undefined ||
      recipe === undefined ||
      bound.recipe.name !== recipe.name ||
      bound.recipe.layerId !== recipe.layerId ||
      bound.runtime.layerId !== recipe.layerId
    )
      throw new Error('Derived input order or identity does not match the recipe.')
    if (names.has(recipe.name)) throw new Error(`Duplicate derived input ${recipe.name}.`)
    names.add(recipe.name)
  }
}

function validateRecipeOperation(recipe: DerivedRasterRecipeV1): void {
  grid(recipe.targetGrid)
  const operation = recipe.operation
  if (operation.kind === 'virtual-band-stack') {
    if (operation.bands.length < 1 || operation.bands.length > 16)
      throw new Error('Virtual band stack requires between 1 and 16 bands.')
    for (const name of operation.bands) namedInput(name, recipe)
    return
  }
  if (operation.kind === 'terrain') {
    namedInput(operation.input, recipe)
    createRasterTerrainPlan({
      operation: operation.operation,
      sourceWidth: recipe.targetGrid.width,
      sourceHeight: recipe.targetGrid.height,
      xSpacing: operation.xSpacing,
      ySpacing: operation.ySpacing,
      xUnit: operation.xUnit as RasterLengthUnit,
      yUnit: operation.yUnit as RasterLengthUnit,
      verticalUnit: operation.verticalUnit as RasterLengthUnit,
      rowDirection: operation.rowDirection,
      edge: operation.edge,
      slopeUnit: operation.slopeUnit,
      azimuthDegrees: operation.azimuthDegrees,
      altitudeDegrees: operation.altitudeDegrees,
    })
    return
  }
  const planInputs = recipe.inputs.map((input) => ({
    name: input.name,
    component: input.component,
    valueMode: input.valueMode,
    scale: input.scale,
    offset: input.offset,
    noData: noData(input.noData),
  }))
  if (operation.kind === 'band-math') {
    createRasterBandMathPlan({
      expression: operation.expression,
      inputs: planInputs,
      divideByZero: operation.divideByZero,
      nonFinite: operation.nonFinite,
      ...(operation.clamp === undefined ? {} : { clamp: operation.clamp }),
      limits: operationLimits(recipe),
    })
  } else if (operation.kind === 'normalized-difference') {
    createNormalizedDifferencePlan(
      namedPlanInput(operation.left, planInputs),
      namedPlanInput(operation.right, planInputs),
    )
  } else if (operation.kind === 'linear-combination') {
    createLinearCombinationPlan(
      operation.terms.map((term) => ({
        ...namedPlanInput(term.input, planInputs),
        coefficient: term.coefficient,
      })),
      operation.constant,
    )
  } else {
    createRasterSubtractionPlan(
      namedPlanInput(operation.minuend, planInputs),
      namedPlanInput(operation.subtrahend, planInputs),
    )
  }
}

function namedInput(name: string, recipe: DerivedRasterRecipeV1): DerivedRasterRecipeInputV1 {
  const input = recipe.inputs.find((candidate) => candidate.name === name)
  if (input === undefined) throw new Error(`Derived input ${name} does not exist.`)
  return input
}

function namedPlanInput<T extends Readonly<{ name: string }>>(
  name: string,
  inputs: readonly T[],
): T {
  const input = inputs.find((candidate) => candidate.name === name)
  if (input === undefined) throw new Error(`Derived input ${name} does not exist.`)
  return input
}

function requiredEvaluatedInput(
  name: string,
  bindings: readonly BoundDerivedRasterInput[],
  evaluated: readonly EvaluatedInput[],
): EvaluatedInput {
  const index = bindings.findIndex(({ recipe }) => recipe.name === name)
  const input = evaluated[index]
  if (input === undefined) throw new Error(`Derived input ${name} was not evaluated.`)
  return input
}

function outputComponentCount(recipe: DerivedRasterRecipeV1): number {
  return recipe.operation.kind === 'virtual-band-stack' ? recipe.operation.bands.length : 1
}

function operationLimits(recipe: DerivedRasterRecipeV1): RasterOperationLimits {
  return recipe.limits
}

function grid(value: RasterTargetGridV1): NumericRasterGrid {
  return normalizeNumericRasterGrid({
    ...value,
    noData: noData(value.noData),
  })
}

function noData(value: RasterTargetGridV1['noData']): RasterNoData {
  return value.kind === 'value' ? { kind: 'value', value: value.value } : { kind: value.kind }
}

function haloRegion(region: Region, target: RasterTargetGridV1): Region {
  const x = Math.max(0, region.x - 1)
  const y = Math.max(0, region.y - 1)
  return {
    x,
    y,
    width: Math.min(target.width, region.x + region.width + 1) - x,
    height: Math.min(target.height, region.y + region.height + 1) - y,
  }
}

function lineRegion(request: DerivedRasterLineProfileRequest): Region {
  const padding = request.resampling === 'bilinear' ? 1 : 0
  const minimumX = Math.max(0, Math.floor(Math.min(request.start.x, request.end.x)) - padding)
  const minimumY = Math.max(0, Math.floor(Math.min(request.start.y, request.end.y)) - padding)
  const maximumX = Math.min(
    request.recipe.targetGrid.width,
    Math.ceil(Math.max(request.start.x, request.end.x)) + padding + 1,
  )
  const maximumY = Math.min(
    request.recipe.targetGrid.height,
    Math.ceil(Math.max(request.start.y, request.end.y)) + padding + 1,
  )
  if (maximumX <= minimumX || maximumY <= minimumY)
    throw new Error('Line profile is outside the target grid.')
  return { x: minimumX, y: minimumY, width: maximumX - minimumX, height: maximumY - minimumY }
}

function modelPoint(
  gridValue: NumericRasterGrid,
  column: number,
  row: number,
): readonly [number, number] {
  const offset = gridValue.pixelInterpretation === 'area' ? 0.5 : 0
  const x = column + offset
  const y = row + offset
  return [
    gridValue.affine[0] * x + gridValue.affine[1] * y + gridValue.affine[2],
    gridValue.affine[3] * x + gridValue.affine[4] * y + gridValue.affine[5],
  ]
}

function pixelPoint(
  gridValue: NumericRasterGrid,
  modelX: number,
  modelY: number,
): readonly [number, number] {
  const [a, b, c, d, e, f] = gridValue.affine
  const determinant = a * e - b * d
  const offset = gridValue.pixelInterpretation === 'area' ? 0.5 : 0
  return [
    (e * (modelX - c) - b * (modelY - f)) / determinant - offset,
    (-d * (modelX - c) + a * (modelY - f)) / determinant - offset,
  ]
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(',')}]`
  const record = value as Readonly<Record<string, unknown>>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `derived-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
