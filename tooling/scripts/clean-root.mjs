import { rm } from 'node:fs/promises'

for (const target of ['.turbo', 'coverage', 'node_modules', 'playwright-report', 'test-results']) {
  await rm(new URL(`../../${target}`, import.meta.url), { force: true, recursive: true })
}
