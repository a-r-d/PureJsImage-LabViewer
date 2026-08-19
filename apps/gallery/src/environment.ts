export type PublicAppEnvironment = 'development' | 'test' | 'production'

export interface PublicEnvironment {
  readonly appEnvironment: PublicAppEnvironment
}

const VALID_ENVIRONMENTS = new Set<PublicAppEnvironment>(['development', 'test', 'production'])

interface PublicEnvironmentCandidate {
  readonly VITE_APP_ENV?: unknown
}

export function readPublicEnvironment(value: unknown): PublicEnvironment {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The public application environment was unavailable; no app state changed.')
  }

  const candidate = value as PublicEnvironmentCandidate
  const configured = candidate.VITE_APP_ENV
  if (configured === undefined) return { appEnvironment: 'production' }
  if (
    typeof configured !== 'string' ||
    !VALID_ENVIRONMENTS.has(configured as PublicAppEnvironment)
  ) {
    throw new Error(
      'VITE_APP_ENV must be development, test, or production; no application secrets were read.',
    )
  }
  return { appEnvironment: configured as PublicAppEnvironment }
}
