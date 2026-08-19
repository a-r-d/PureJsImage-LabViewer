import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  assertExpectedProjects,
  parseE2eArgv,
  playwrightArgvForSuite,
  projectFiltersFromArgs,
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

  it('strips --suite from forwarded Playwright args', () => {
    expect(parseE2eArgv(['--suite=science', '--project=firefox', '--project=webkit'])).toEqual({
      suite: 'science',
      extra: ['--project=firefox', '--project=webkit'],
    })
    expect(parseE2eArgv(['--suite', 'geo', '--', '--project=chromium'])).toEqual({
      suite: 'geo',
      extra: ['--project=chromium'],
    })
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
  it('exposes independent science/geo scripts and an unfiltered aggregate', async () => {
    const packageJson: unknown = JSON.parse(await readFile(`${root}/package.json`, 'utf8'))
    if (typeof packageJson !== 'object' || packageJson === null || !('scripts' in packageJson)) {
      throw new Error('package.json scripts are missing.')
    }
    const scripts = (packageJson as { scripts: Record<string, string> }).scripts
    expect(scripts['test:e2e:science']).toBe('node tooling/scripts/run-e2e.mjs --suite=science')
    expect(scripts['test:e2e:geo']).toBe('node tooling/scripts/run-e2e.mjs --suite=geo')
    expect(scripts['test:e2e']).toBe('node tooling/scripts/run-e2e.mjs')
    expect(scripts.check).toContain('test:e2e')
    expect(scripts['test:e2e']).not.toContain('&&')
  })

  it('runs each suite with the intended browser projects and distinct artifacts', async () => {
    const workflow = await readFile(`${root}/.github/workflows/ci.yml`, 'utf8')
    const chromium = githubJobBody(workflow, 'browser-chromium')
    const cross = githubJobBody(workflow, 'browser-cross')

    expect(chromium).toContain('playwright install --with-deps chromium')
    expect(chromium).not.toMatch(/playwright install[^\n]*(firefox|webkit)/u)
    expect(chromium).toContain('pnpm test:e2e:science --project=chromium')
    expect(chromium).toContain('pnpm test:e2e:geo --project=chromium')
    expect(chromium).not.toContain('pnpm test:e2e --')
    expect(chromium).toContain('E2E_EXPECTED_PROJECTS: chromium')
    expect(chromium).toContain('chromium-science-test-results')
    expect(chromium).toContain('chromium-geo-test-results')
    expect(chromium).toContain('test-results/science/')
    expect(chromium).toContain('test-results/geo/')
    expect(chromium).not.toMatch(/--project=(firefox|webkit)/u)

    expect(cross).toContain('playwright install --with-deps firefox webkit')
    expect(cross).not.toMatch(/playwright install[^\n]*chromium/u)
    expect(cross).toContain('pnpm test:e2e:science --project=firefox --project=webkit')
    expect(cross).toContain('pnpm test:e2e:geo --project=firefox --project=webkit')
    expect(cross).not.toContain('pnpm test:e2e --')
    expect(cross).toContain('E2E_EXPECTED_PROJECTS: firefox,webkit')
    expect(cross).toContain('firefox-webkit-science-test-results')
    expect(cross).toContain('firefox-webkit-geo-test-results')
    expect(cross).not.toContain('--project=chromium')

    const scienceConfig = await readFile(`${root}/playwright.config.ts`, 'utf8')
    const geoConfig = await readFile(`${root}/playwright.geo.config.ts`, 'utf8')
    expect(scienceConfig).toContain("outputDir: 'test-results/science'")
    expect(geoConfig).toContain("outputDir: 'test-results/geo'")
    expect(geoConfig).toContain("name: 'firefox'")
    expect(geoConfig).toContain("name: 'webkit'")
  })
})
