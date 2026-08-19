import type { ReaderDescriptor } from '@pji-workbench/contracts'
import { SUPPORTED_READERS } from '@pji-workbench/imaging'
import {
  type ExampleScenarioV1,
  enabledExampleScenarios,
  researchExampleScenarios,
} from '@pji-workbench/test-corpus'

import type { HeadlessDomainProfile } from './domain-profile.js'

const COMPOUND_ACCEPT_EXTENSIONS = Object.freeze([
  'envi',
  'imgcif',
  'ome.tif',
  'ome.tiff',
  'nii.gz',
])

export function readersForProfile(
  profile: Pick<HeadlessDomainProfile<unknown>, 'readerIds'>,
  catalog: readonly ReaderDescriptor[] = SUPPORTED_READERS,
): readonly ReaderDescriptor[] {
  const allowed = new Set(profile.readerIds)
  const selected = catalog.filter(({ id }) => allowed.has(id))
  if (selected.length !== profile.readerIds.length) {
    const found = new Set(selected.map(({ id }) => id))
    const missing = profile.readerIds.filter((id) => !found.has(id))
    throw new Error(`Unknown reader ids in domain profile: ${missing.join(', ')}`)
  }
  return selected
}

export function fileAcceptForReaders(readers: readonly ReaderDescriptor[]): string {
  return [
    ...new Set([
      ...readers.flatMap(({ extensions }) => extensions).filter((extension) => extension !== 'gz'),
      ...COMPOUND_ACCEPT_EXTENSIONS,
    ]),
  ]
    .sort()
    .map((extension) => `.${extension}`)
    .join(',')
}

export function fileAcceptForProfile(
  profile: Pick<HeadlessDomainProfile<unknown>, 'readerIds'>,
): string {
  return fileAcceptForReaders(readersForProfile(profile))
}

export function exampleScenariosForProfile(
  profile: Pick<HeadlessDomainProfile<unknown>, 'exampleScenarioIds'>,
  catalog: readonly ExampleScenarioV1[] = enabledExampleScenarios(),
): readonly ExampleScenarioV1[] {
  const byId = new Map(catalog.map((scenario) => [scenario.id, scenario]))
  return profile.exampleScenarioIds.map((id) => {
    const scenario = byId.get(id)
    if (scenario === undefined) throw new Error(`Unknown example scenario in domain profile: ${id}`)
    return scenario
  })
}

export function researchExampleScenariosForProfile(): readonly ExampleScenarioV1[] {
  return researchExampleScenarios()
}
