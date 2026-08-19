import type { AffineTransform } from '@pji-workbench/contracts'

import { assertFinite } from './assert.js'
import type { Point } from './types.js'

export type ViewportTransformErrorCode = 'SINGULAR_AFFINE' | 'INVALID_BOUNDS'

export class ViewportTransformError extends Error {
  constructor(
    readonly code: ViewportTransformErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ViewportTransformError'
  }
}

export function applyAffine(transform: AffineTransform, point: Point): Point {
  const [a, b, c, d, e, f] = transform
  return {
    x: a * point.x + b * point.y + c,
    y: d * point.x + e * point.y + f,
  }
}

export function invertAffine(transform: AffineTransform): AffineTransform {
  const [a, b, c, d, e, f] = transform
  const determinant = a * e - b * d
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new ViewportTransformError('SINGULAR_AFFINE', 'The affine transform is not invertible')
  }
  const inverseDeterminant = 1 / determinant
  return [
    finiteCoefficient(e * inverseDeterminant),
    finiteCoefficient(-b * inverseDeterminant),
    finiteCoefficient((b * f - c * e) * inverseDeterminant),
    finiteCoefficient(-d * inverseDeterminant),
    finiteCoefficient(a * inverseDeterminant),
    finiteCoefficient((c * d - a * f) * inverseDeterminant),
  ]
}

function finiteCoefficient(value: number): number {
  return assertFinite(value, 'Affine coefficient')
}
