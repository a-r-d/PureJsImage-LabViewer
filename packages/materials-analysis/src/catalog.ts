import type { OperationJsonObject } from 'purejsimage/operations'

export const MATERIALS_OPERATION_IDS = Object.freeze({
  rotateRightAngle: 'pji-workbench.materials.geometry.rotate-right-angle',
  flip: 'pji-workbench.materials.geometry.flip',
  translate: 'pji-workbench.materials.geometry.translate',
  convert: 'pji-workbench.materials.numeric.convert',
  normalize: 'pji-workbench.materials.numeric.normalize',
  clamp: 'pji-workbench.materials.numeric.clamp',
  invert: 'pji-workbench.materials.numeric.invert',
  gamma: 'pji-workbench.materials.numeric.gamma',
  log: 'pji-workbench.materials.numeric.log',
  squareRoot: 'pji-workbench.materials.numeric.square-root',
  addConstant: 'pji-workbench.materials.numeric.add-constant',
  subtractConstant: 'pji-workbench.materials.numeric.subtract-constant',
  multiplyConstant: 'pji-workbench.materials.numeric.multiply-constant',
  divideConstant: 'pji-workbench.materials.numeric.divide-constant',
  imageCalculator: 'pji-workbench.materials.numeric.image-calculator',
  box: 'pji-workbench.materials.filter.box',
  median: 'pji-workbench.materials.filter.median',
  minimum: 'pji-workbench.materials.filter.minimum',
  maximum: 'pji-workbench.materials.filter.maximum',
  convolution: 'pji-workbench.materials.filter.convolution',
  unsharp: 'pji-workbench.materials.filter.unsharp-mask',
  gradient: 'pji-workbench.materials.filter.gradient',
  laplacian: 'pji-workbench.materials.filter.laplacian',
  outlier: 'pji-workbench.materials.filter.outlier',
  background: 'pji-workbench.materials.filter.background-subtract',
  thresholdReference: 'pji-workbench.materials.segmentation.threshold-reference',
  binaryErode: 'pji-workbench.materials.segmentation.binary-erode',
  binaryDilate: 'pji-workbench.materials.segmentation.binary-dilate',
  binaryOpen: 'pji-workbench.materials.segmentation.binary-open',
  binaryClose: 'pji-workbench.materials.segmentation.binary-close',
  binaryFillHoles: 'pji-workbench.materials.segmentation.binary-fill-holes',
  binaryClearBorder: 'pji-workbench.materials.segmentation.binary-clear-border',
  binaryRemoveSmall: 'pji-workbench.materials.segmentation.binary-remove-small',
  binaryOutline: 'pji-workbench.materials.segmentation.binary-outline',
  distanceTransform: 'pji-workbench.materials.segmentation.euclidean-distance-transform',
  watershed: 'pji-workbench.materials.segmentation.watershed',
  particleAnalysis: 'pji-workbench.materials.particles.analyze',
  fft2d: 'pji-workbench.materials.frequency.fft-2d',
  stackSumProjection: 'pji-workbench.materials.stack.sum-projection',
  stackMontage: 'pji-workbench.materials.stack.montage',
  stackStatistics: 'pji-workbench.materials.stack.statistics',
  stackAlignment: 'pji-workbench.materials.stack.phase-correlation-align',
  surfaceCorrect: 'pji-workbench.materials.surface.correct',
  surfaceAnalyze: 'pji-workbench.materials.surface.analyze',
} as const)

export type MaterialsOperationId =
  (typeof MATERIALS_OPERATION_IDS)[keyof typeof MATERIALS_OPERATION_IDS]

export interface ToolboxOperationDocumentation extends OperationJsonObject {
  readonly operationId: string
  readonly actionId: 'analysis.request-execute'
  readonly actionVersion: 1
  readonly summary: string
  readonly inputPolicy: string
  readonly outputPolicy: string
  readonly noDataPolicy: string
  readonly boundaryPolicy: string
  readonly calibrationPolicy: string
  readonly reproducibility: string
  readonly cost: 'trivial' | 'interactive' | 'expensive'
  readonly preview: boolean
  readonly preset?: string
}

const docs = (
  operationId: string,
  summary: string,
  options: Partial<Omit<ToolboxOperationDocumentation, 'operationId' | 'summary'>> = {},
): ToolboxOperationDocumentation => ({
  operationId,
  actionId: 'analysis.request-execute',
  actionVersion: 1,
  summary,
  inputPolicy: 'One numeric scientific dataset; every component is processed independently.',
  outputPolicy: 'A lazy bounded scientific dataset; no complete source plane is retained.',
  noDataPolicy:
    'Non-finite and declared no-data samples propagate unless the operation says otherwise.',
  boundaryPolicy: 'No boundary extension is required.',
  calibrationPolicy:
    'X/Y calibration and units are preserved unless geometry changes them explicitly.',
  reproducibility: 'Reference TypeScript provider; tolerance 1e-6 absolute and relative.',
  cost: 'interactive',
  preview: true,
  ...options,
})

export const TOOLBOX_DOCUMENTATION: readonly ToolboxOperationDocumentation[] = Object.freeze([
  docs('purejsimage.analysis.crop', 'Crop to an integer pixel rectangle.', {
    calibrationPolicy:
      'Axis origins advance by the cropped pixel offset; spacing and units remain unchanged.',
  }),
  docs('purejsimage.analysis.resample', 'Resize with nearest or bilinear interpolation.', {
    boundaryPolicy: 'Sampling is bounded to the source extent.',
    calibrationPolicy: 'Physical extent is preserved while X/Y spacing changes with output size.',
  }),
  docs(
    'purejsimage.analysis.gaussian-blur',
    'Separable Gaussian smoothing with an explicit boundary policy.',
    {
      boundaryPolicy: 'Clamp, mirror, or constant boundary selected by the user.',
      preset: 'Gentle denoise',
    },
  ),
  docs('purejsimage.analysis.statistics', 'ROI intensity statistics and bounded percentiles.', {
    outputPolicy: 'A bounded result collection with pixel and calibrated measurement metadata.',
    calibrationPolicy: 'Uses the active file calibration or revisioned project override.',
    cost: 'expensive',
  }),
  docs('purejsimage.analysis.histogram', 'Bounded ROI histogram.', {
    outputPolicy: 'Histogram bin edges, counts, underflow, overflow, and units.',
    cost: 'expensive',
  }),
  docs(
    'purejsimage.analysis.line-profile',
    'Calibrated line profile with nearest or bilinear sampling.',
    {
      outputPolicy: 'Bounded profile axis and component series.',
      calibrationPolicy: 'Distance uses anisotropic X/Y spacing when available.',
      cost: 'expensive',
    },
  ),
  docs(
    MATERIALS_OPERATION_IDS.rotateRightAngle,
    'Rotate a plane clockwise by 90, 180, or 270 degrees.',
    {
      calibrationPolicy: '90/270 degree rotation swaps X/Y spacing and units; 180 preserves them.',
    },
  ),
  docs(MATERIALS_OPERATION_IDS.flip, 'Flip pixels horizontally or vertically.', {
    calibrationPolicy:
      'The flipped axis origin moves to the opposite edge and its step changes sign.',
  }),
  docs(MATERIALS_OPERATION_IDS.translate, 'Translate pixels with an explicit constant fill.', {
    boundaryPolicy: 'Pixels outside the translated source use the selected constant value.',
  }),
  docs(
    MATERIALS_OPERATION_IDS.convert,
    'Convert numeric sample type with explicit clipping or range scaling.',
    {
      noDataPolicy:
        'Non-finite samples remain non-finite for floating output and become the clipped minimum for integer output.',
    },
  ),
  docs(
    MATERIALS_OPERATION_IDS.normalize,
    'Map a declared input interval to a declared output interval.',
  ),
  docs(MATERIALS_OPERATION_IDS.clamp, 'Clamp finite samples to an inclusive interval.'),
  docs(MATERIALS_OPERATION_IDS.invert, 'Invert samples around an explicit minimum and maximum.'),
  docs(
    MATERIALS_OPERATION_IDS.gamma,
    'Apply a normalized power-law transform with explicit range.',
  ),
  docs(
    MATERIALS_OPERATION_IDS.log,
    'Apply natural or base-10 logarithm with explicit non-positive handling.',
  ),
  docs(
    MATERIALS_OPERATION_IDS.squareRoot,
    'Apply square root with explicit negative-value handling.',
  ),
  docs(MATERIALS_OPERATION_IDS.addConstant, 'Add a finite constant to each sample.'),
  docs(MATERIALS_OPERATION_IDS.subtractConstant, 'Subtract a finite constant from each sample.'),
  docs(MATERIALS_OPERATION_IDS.multiplyConstant, 'Multiply each sample by a finite constant.'),
  docs(
    MATERIALS_OPERATION_IDS.divideConstant,
    'Divide each sample by an explicitly non-zero constant.',
  ),
  docs(MATERIALS_OPERATION_IDS.imageCalculator, 'Combine two compatible datasets pixel-by-pixel.', {
    inputPolicy: 'Two datasets with identical axes, component count, and calibration.',
    cost: 'expensive',
  }),
  docs(MATERIALS_OPERATION_IDS.box, 'Mean/box filter over an odd square neighborhood.', {
    boundaryPolicy:
      'Clamp, mirror, or constant boundary; invalid samples propagate or are ignored with renormalization.',
    preset: 'Fast denoise',
  }),
  docs(MATERIALS_OPERATION_IDS.median, 'Median filter over an odd square neighborhood.', {
    boundaryPolicy: 'Clamp, mirror, or constant boundary.',
    preset: 'Despeckle',
  }),
  docs(MATERIALS_OPERATION_IDS.minimum, 'Neighborhood minimum filter.', {
    boundaryPolicy: 'Clamp, mirror, or constant boundary.',
  }),
  docs(MATERIALS_OPERATION_IDS.maximum, 'Neighborhood maximum filter.', {
    boundaryPolicy: 'Clamp, mirror, or constant boundary.',
  }),
  docs(MATERIALS_OPERATION_IDS.convolution, 'Arbitrary bounded odd convolution kernel.', {
    boundaryPolicy: 'Clamp, mirror, or constant boundary; kernels are limited to 9 by 9.',
  }),
  docs(
    MATERIALS_OPERATION_IDS.unsharp,
    'Unsharp-mask enhancement using a bounded Gaussian neighborhood.',
    {
      boundaryPolicy: 'Mirror boundary with a finite sigma and amount.',
      preset: 'Crisp edges',
    },
  ),
  docs(MATERIALS_OPERATION_IDS.gradient, 'Sobel or Scharr X, Y, or magnitude gradient.', {
    boundaryPolicy: 'Mirror boundary; magnitude is hypot(Gx, Gy).',
  }),
  docs(MATERIALS_OPERATION_IDS.laplacian, 'Discrete 4- or 8-neighbor Laplacian.', {
    boundaryPolicy: 'Mirror boundary.',
  }),
  docs(MATERIALS_OPERATION_IDS.outlier, 'Replace isolated outliers relative to a local median.', {
    boundaryPolicy: 'Mirror boundary; replacement occurs only above the finite threshold.',
    preset: 'Despeckle',
  }),
  docs(
    MATERIALS_OPERATION_IDS.background,
    'Subtract a bounded local mean background and add an optional offset.',
    {
      boundaryPolicy: 'Mirror boundary; radius is limited to 64 pixels.',
      preset: 'Correct uneven background',
      cost: 'expensive',
    },
  ),
  docs(
    MATERIALS_OPERATION_IDS.thresholdReference,
    'Reference manual, Otsu, Triangle, Yen, Li, mean, and adaptive Sauvola thresholding.',
    {
      inputPolicy: 'One numeric scientific dataset and one explicit area ROI.',
      outputPolicy:
        'A binary mask plus bounded histogram, foreground fraction, and resolved-threshold results.',
      noDataPolicy: 'Invalid samples are explicitly background, foreground, or propagated as NaN.',
      cost: 'expensive',
      preset: 'Particle threshold',
    },
  ),
  ...(
    [
      [MATERIALS_OPERATION_IDS.binaryErode, 'Erode a binary mask with a Euclidean disk.'],
      [MATERIALS_OPERATION_IDS.binaryDilate, 'Dilate a binary mask with a Euclidean disk.'],
      [MATERIALS_OPERATION_IDS.binaryOpen, 'Erode then dilate a binary mask.'],
      [MATERIALS_OPERATION_IDS.binaryClose, 'Dilate then erode a binary mask.'],
      [
        MATERIALS_OPERATION_IDS.binaryFillHoles,
        'Fill background regions not connected to the plane border.',
      ],
      [
        MATERIALS_OPERATION_IDS.binaryClearBorder,
        'Remove foreground objects connected to the plane border.',
      ],
      [
        MATERIALS_OPERATION_IDS.binaryRemoveSmall,
        'Remove connected foreground objects below a pixel-area limit.',
      ],
      [
        MATERIALS_OPERATION_IDS.binaryOutline,
        'Retain the one-pixel inner outline of a binary mask.',
      ],
    ] as const
  ).map(([operationId, summary]) =>
    docs(operationId, summary, {
      inputPolicy: 'One binary scientific dataset; non-zero finite samples are foreground.',
      outputPolicy: 'One deterministic uint8 binary scientific dataset.',
      boundaryPolicy: 'Pixels outside the plane are background; connectivity is explicit.',
      cost: 'expensive',
    }),
  ),
  docs(
    MATERIALS_OPERATION_IDS.distanceTransform,
    'Exact Euclidean distance from each foreground sample to the nearest background sample.',
    {
      inputPolicy: 'One binary scientific dataset.',
      outputPolicy: 'One floating-point distance dataset in pixel units.',
      boundaryPolicy: 'The plane exterior is background.',
      cost: 'expensive',
    },
  ),
  docs(
    MATERIALS_OPERATION_IDS.watershed,
    'Separate touching foreground objects by flooding the exact Euclidean distance surface.',
    {
      inputPolicy: 'One binary scientific dataset.',
      outputPolicy: 'A binary mask with deterministic watershed boundaries removed.',
      boundaryPolicy: 'Eight-neighbor flooding with deterministic priority and peak suppression.',
      cost: 'expensive',
    },
  ),
  docs(
    MATERIALS_OPERATION_IDS.particleAnalysis,
    'Filter and measure connected-component labels against a chosen intensity component.',
    {
      inputPolicy:
        'A connected-components label dataset, calibrated source dataset, and explicit area ROI.',
      outputPolicy:
        'Filtered labels, a bounded deterministic table, scalar summary, and cumulative size distribution.',
      calibrationPolicy:
        'Area, perimeter, equivalent diameter, and fitted ellipse retain explicit pixel and physical units; centroid remains in pixel coordinates.',
      cost: 'expensive',
      preview: false,
    },
  ),
  docs(
    MATERIALS_OPERATION_IDS.fft2d,
    'Centered 2D FFT magnitude/power spectra and calibrated profiles.',
    {
      inputPolicy: 'One finite numeric plane and an optional bounded rectangular ROI.',
      outputPolicy:
        'Raw quantitative magnitude, power, and mask datasets plus radial/azimuthal profiles and bounded peaks.',
      noDataPolicy:
        'Non-finite input samples are explicitly replaced by zero and counted in provenance.',
      calibrationPolicy:
        'Linear X/Y spacing becomes reciprocal spatial frequency; d-spacing is emitted only when both axes are calibrated.',
      cost: 'expensive',
      preset: 'FFT workspace',
    },
  ),
  docs(
    MATERIALS_OPERATION_IDS.stackSumProjection,
    'Sum all admitted planes along one selected stack axis.',
    {
      inputPolicy: 'One numeric dataset with two display axes and one finite stack axis.',
      outputPolicy: 'A floating-point two-dimensional projection dataset.',
      noDataPolicy: 'Finite samples are summed; an all-invalid pixel remains NaN.',
      cost: 'expensive',
    },
  ),
  docs(
    MATERIALS_OPERATION_IDS.stackMontage,
    'Create a deterministic contact sheet from selected stack planes.',
    {
      inputPolicy: 'One numeric stack with bounded frame count and explicit column count.',
      outputPolicy: 'A floating-point two-dimensional montage; unused cells are NaN.',
      cost: 'expensive',
    },
  ),
  docs(MATERIALS_OPERATION_IDS.stackStatistics, 'Calculate bounded per-plane stack statistics.', {
    inputPolicy: 'One numeric stack with an explicit stack axis.',
    outputPolicy: 'A bounded table of count, min, max, mean, and standard deviation per frame.',
    cost: 'expensive',
  }),
  docs(
    MATERIALS_OPERATION_IDS.stackAlignment,
    'Align stack frames by normalized phase correlation.',
    {
      inputPolicy:
        'One numeric stack, explicit reference frame, integer-shift tolerance, and edge policy.',
      outputPolicy:
        'An aligned stack plus drift/tolerance table; rejected frames fail without partial output.',
      boundaryPolicy: 'Pad with an explicit value or crop to the common integer-shift overlap.',
      cost: 'expensive',
      preview: false,
    },
  ),
  docs(
    MATERIALS_OPERATION_IDS.surfaceCorrect,
    'Apply one explicit AFM/SPM background correction.',
    {
      inputPolicy: 'One scalar height plane with an independent Z component unit.',
      outputPolicy: 'A corrected floating height dataset; raw source values are never modified.',
      noDataPolicy: 'Non-finite and excluded samples do not influence the fit.',
      calibrationPolicy: 'X/Y and Z units remain independent and unchanged.',
      cost: 'expensive',
      preset: 'AFM surface',
    },
  ),
  docs(
    MATERIALS_OPERATION_IDS.surfaceAnalyze,
    'Measure AFM/SPM roughness, histogram, profile, and grains.',
    {
      inputPolicy: 'One corrected or raw scalar height plane with an optional exclusion mask.',
      outputPolicy:
        'Height histogram, Ra/Rq/Rz summary, calibrated profile, and shared-threshold grain mask.',
      noDataPolicy:
        'Non-finite and excluded samples are omitted from metrics and threshold selection.',
      calibrationPolicy:
        'Profile distance uses X/Y spacing; height metrics retain the component Z unit.',
      cost: 'expensive',
      preview: false,
    },
  ),
])

export const TOOLBOX_PRESETS = Object.freeze([
  {
    id: 'denoise-gaussian',
    title: 'Gentle Gaussian denoise',
    operationId: 'purejsimage.analysis.gaussian-blur',
    parameters: { sigma: 1.2, boundary: 'mirror', constantValue: 0, invalidPolicy: 'ignore' },
  },
  {
    id: 'despeckle',
    title: 'Median despeckle',
    operationId: MATERIALS_OPERATION_IDS.median,
    parameters: { radius: 1, boundary: 'mirror', constantValue: 0, invalidPolicy: 'ignore' },
  },
  {
    id: 'unsharp',
    title: 'Crisp edges',
    operationId: MATERIALS_OPERATION_IDS.unsharp,
    parameters: { sigma: 1.25, amount: 0.8, invalidPolicy: 'propagate' },
  },
  {
    id: 'background',
    title: 'Correct uneven background',
    operationId: MATERIALS_OPERATION_IDS.background,
    parameters: { radius: 16, offset: 0, invalidPolicy: 'ignore' },
  },
  {
    id: 'particle-threshold',
    title: 'Particle threshold',
    operationId: MATERIALS_OPERATION_IDS.thresholdReference,
    parameters: {
      method: 'otsu',
      polarity: 'light',
      lower: 0,
      upper: 255,
      histogramBins: 256,
      windowRadius: 15,
      sauvolaK: 0.2,
      dynamicRange: 128,
      noDataPolicy: 'background',
    },
  },
  {
    id: 'fft-workspace',
    title: 'FFT workspace',
    operationId: MATERIALS_OPERATION_IDS.fft2d,
    parameters: {
      spectrumDisplay: 'log1p',
      radialBins: 128,
      azimuthalBins: 180,
      peakThreshold: 0,
      minimumPeakDistance: 4,
      maximumPeaks: 32,
      maskKind: 'none',
    },
  },
  {
    id: 'afm-surface',
    title: 'AFM surface',
    operationId: MATERIALS_OPERATION_IDS.surfaceCorrect,
    parameters: { correction: 'first-order-plane', polynomialDegree: 1 },
  },
])
