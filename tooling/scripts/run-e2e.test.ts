import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  assertExpectedProjects,
  GEO_QUICK_E2E_FILES,
  parseE2eArgv,
  playwrightArgvForSuite,
  projectFiltersFromArgs,
  SCIENCE_QUICK_E2E_FILES,
  suitesToRun,
} from './run-e2e.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))

function githubJobBody(workflow: string, jobId: string): string {
  const pattern = new RegExp(`  ${jobId}:\\n([\\s\\S]*?)(?=\\n  [a-z]|$)`)
  const match = pattern.exec(workflow)
  if (match?.[1] === undefined) throw new Error(`CI workflow is missing job '${jobId}'.`)
  return match[1]
}

describe('Playwright e2e runner', () => {
  it('forwards extra --project filters onto both science and geo argv', () => {
    const extra = ['--project=chromium']
    expect(playwrightArgvForSuite('science', extra)).toEqual(['test', '--project=chromium'])
    expect(playwrightArgvForSuite('geo', extra)).toEqual([
      'test',
      '-c',
      'playwright.geo.config.ts',
      '--project=chromium',
    ])
    expect(suitesToRun('all')).toEqual(['science', 'geo'])
  })

  it('runs a fixed single-browser sample in quick mode without retries', () => {
    expect(playwrightArgvForSuite('science', [], 'quick')).toEqual([
      'test',
      ...SCIENCE_QUICK_E2E_FILES,
      '--project=chromium',
      '--workers=1',
      '--retries=0',
    ])
    expect(playwrightArgvForSuite('geo', [], 'quick')).toEqual([
      'test',
      '-c',
      'playwright.geo.config.ts',
      ...GEO_QUICK_E2E_FILES,
      '--project=chromium',
      '--workers=1',
      '--retries=0',
    ])
  })

  it('strips --suite from forwarded Playwright args', () => {
    expect(parseE2eArgv(['--suite=science', '--project=firefox', '--project=webkit'])).toEqual({
      suite: 'science',
      mode: 'full',
      extra: ['--project=firefox', '--project=webkit'],
    })
    expect(parseE2eArgv(['--suite', 'geo', '--mode', 'quick', '--project=chromium'])).toEqual({
      suite: 'geo',
      mode: 'quick',
      extra: ['--project=chromium'],
    })
    expect(() => parseE2eArgv(['--mode=fast'])).toThrow(/unknown mode 'fast'/u)
  })

  it('fails loudly when CI expected projects are missing from extra args', () => {
    expect(() => assertExpectedProjects([], 'chromium')).toThrow(/extra args \[none\]/u)
    expect(() => assertExpectedProjects(['--project=chromium'], 'firefox,webkit')).toThrow(
      /firefox, webkit/u,
    )
    expect(() =>
      assertExpectedProjects(['--project=firefox', '--project=webkit'], 'firefox,webkit'),
    ).not.toThrow()
    expect(projectFiltersFromArgs(['--project', 'chromium', '--grep', '@visual'])).toEqual([
      'chromium',
    ])
  })
})

describe('Playwright e2e scripts and CI wiring', () => {
  it('exposes quick and exhaustive browser gates plus independent suites', async () => {
    const packageJson: unknown = JSON.parse(await readFile(`${root}/package.json`, 'utf8'))
    if (typeof packageJson !== 'object' || packageJson === null || !('scripts' in packageJson)) {
      throw new Error('package.json scripts are missing.')
    }
    const scripts = (packageJson as { scripts: Record<string, string> }).scripts
    expect(scripts['test:e2e:science']).toBe('node tooling/scripts/run-e2e.mjs --suite=science')
    expect(scripts['test:e2e:geo']).toBe('node tooling/scripts/run-e2e.mjs --suite=geo')
    expect(scripts['test:e2e']).toBe('node tooling/scripts/run-e2e.mjs')
    expect(scripts['test:e2e:quick']).toBe('node tooling/scripts/run-e2e.mjs --mode=quick')
    expect(scripts['test:e2e:full']).toBe('node tooling/scripts/run-e2e.mjs --mode=full')
    expect(scripts.check).toContain('test:e2e:quick')
    expect(scripts['check:full']).toContain('test:e2e:full')
    expect(scripts['test:e2e']).not.toContain('&&')
  })

  it('runs each suite with the intended browser projects and distinct artifacts', async () => {
    const workflow = await readFile(`${root}/.github/workflows/ci.yml`, 'utf8')
    const browser = githubJobBody(workflow, 'browser')

    expect(browser).toContain('mcr.microsoft.com/playwright:v1.62.1-noble')
    expect(browser).toContain('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD')
    expect(browser).not.toMatch(/playwright install/u)
    expect(browser).toContain(`--project=\${{ matrix.browser }}`)
    expect(browser).toContain(`pnpm test:e2e:science --project=\${{ matrix.browser }}`)
    expect(browser).toContain(`pnpm test:e2e:geo --project=\${{ matrix.browser }}`)
    expect(browser).not.toContain('pnpm test:e2e --')
    expect(browser).toContain(`E2E_EXPECTED_PROJECTS: \${{ matrix.browser }}`)
    expect(browser).toContain(`\${{ matrix.browser }}-science-test-results`)
    expect(browser).toContain(`\${{ matrix.browser }}-geo-test-results`)
    expect(browser).toContain('test-results/science/')
    expect(browser).toContain('test-results/geo/')
    expect(browser).toContain('- chromium')
    expect(browser).toContain('- firefox')
    expect(browser).toContain('- webkit')

    const scienceConfig = await readFile(`${root}/playwright.config.ts`, 'utf8')
    const geoConfig = await readFile(`${root}/playwright.geo.config.ts`, 'utf8')
    expect(scienceConfig).toContain("outputDir: 'test-results/science'")
    expect(scienceConfig).toContain("workers: process.env.CI ? 2 : '50%'")
    expect(geoConfig).toContain("outputDir: 'test-results/geo'")
    expect(geoConfig).toContain("workers: process.env.CI ? 4 : '50%'")
    expect(geoConfig).toContain("name: 'firefox'")
    expect(geoConfig).toContain("name: 'webkit'")
  })
})
