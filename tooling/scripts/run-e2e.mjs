import { spawn } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const SCIENCE_PLAYWRIGHT_ARGS = ['test']
export const GEO_PLAYWRIGHT_ARGS = ['test', '-c', 'playwright.geo.config.ts']
export const SCIENCE_QUICK_E2E_FILES = [
  'apps-e2e/science/tests/agent.spec.ts',
  'apps-e2e/science/tests/particle-analysis.spec.ts',
  'apps-e2e/science/tests/roi-measurement.spec.ts',
  'apps-e2e/science/tests/scripts-plugins.spec.ts',
]
export const GEO_QUICK_E2E_FILES = [
  'apps-e2e/geo/tests/atlas.spec.ts',
  'apps-e2e/geo/tests/catalog.spec.ts',
]
const QUICK_E2E_ARGS = ['--project=chromium', '--workers=1', '--retries=0']

/**
 * @param {readonly string[]} argv
 * @returns {{ suite: 'all' | 'science' | 'geo', mode: 'full' | 'quick', extra: string[] }}
 */
export function parseE2eArgv(argv) {
  /** @type {'all' | 'science' | 'geo'} */
  let suite = 'all'
  /** @type {'full' | 'quick'} */
  let mode = 'full'
  /** @type {string[]} */
  const extra = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--mode=full' || arg === '--mode=quick') {
      mode = arg.slice('--mode='.length)
      continue
    }
    if (arg === '--mode') {
      const next = argv[index + 1]
      if (next === 'full' || next === 'quick') {
        mode = next
        index += 1
        continue
      }
      throw new Error(`[e2e] unknown mode '${next ?? '(missing)'}'`)
    }
    if (arg.startsWith('--mode=')) {
      throw new Error(`[e2e] unknown mode '${arg.slice('--mode='.length)}'`)
    }
    if (arg === '--suite=science' || arg === '--suite=geo' || arg === '--suite=all') {
      suite = arg.slice('--suite='.length)
      continue
    }
    if (arg === '--suite') {
      const next = argv[index + 1]
      if (next === 'science' || next === 'geo' || next === 'all') {
        suite = next
        index += 1
        continue
      }
      throw new Error(`[e2e] unknown suite '${next ?? '(missing)'}'`)
    }
    if (arg.startsWith('--suite=')) {
      throw new Error(`[e2e] unknown suite '${arg.slice('--suite='.length)}'`)
    }
    extra.push(arg)
  }
  return { suite, mode, extra }
}

/**
 * @param {'science' | 'geo'} suite
 * @param {readonly string[]} extraArgs
 * @param {'full' | 'quick'} [mode]
 * @returns {string[]}
 */
export function playwrightArgvForSuite(suite, extraArgs, mode = 'full') {
  const base = suite === 'geo' ? GEO_PLAYWRIGHT_ARGS : SCIENCE_PLAYWRIGHT_ARGS
  if (mode === 'quick') {
    const files = suite === 'geo' ? GEO_QUICK_E2E_FILES : SCIENCE_QUICK_E2E_FILES
    return [...base, ...files, ...QUICK_E2E_ARGS, ...extraArgs]
  }
  return [...base, ...extraArgs]
}

/**
 * @param {'all' | 'science' | 'geo'} suite
 * @returns {Array<'science' | 'geo'>}
 */
export function suitesToRun(suite) {
  if (suite === 'science') return ['science']
  if (suite === 'geo') return ['geo']
  return ['science', 'geo']
}

/**
 * @param {readonly string[]} args
 * @returns {string[]}
 */
export function projectFiltersFromArgs(args) {
  /** @type {string[]} */
  const projects = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg.startsWith('--project=')) {
      projects.push(arg.slice('--project='.length))
      continue
    }
    if (arg === '--project') {
      const next = args[index + 1]
      if (next !== undefined && !next.startsWith('-')) {
        projects.push(next)
        index += 1
      }
    }
  }
  return projects
}

/**
 * @param {readonly string[]} extraArgs
 * @param {string | undefined} expectedCsv
 */
export function assertExpectedProjects(extraArgs, expectedCsv) {
  if (expectedCsv === undefined || expectedCsv.trim() === '') return
  const expected = expectedCsv
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  const actual = projectFiltersFromArgs(extraArgs)
  const expectedKey = [...new Set(expected)].sort().join(',')
  const actualKey = [...new Set(actual)].sort().join(',')
  if (expectedKey !== actualKey) {
    throw new Error(
      `[e2e] expected Playwright --project filter(s) [${expected.join(', ')}] but received [${actual.join(', ') || 'none'}] from extra args [${extraArgs.join(' ') || 'none'}]. pnpm only appends extra arguments to the last command in a \`&&\` script; invoke test:e2e:science and test:e2e:geo separately, or use this wrapper so both suites receive the filter.`,
    )
  }
}

/**
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
function runPlaywright(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('playwright', args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (signal !== null) {
        reject(new Error(`[e2e] playwright exited due to signal ${signal}`))
        return
      }
      resolve(code ?? 1)
    })
  })
}

async function main() {
  const { suite, mode, extra } = parseE2eArgv(process.argv.slice(2))
  try {
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: CI job env; e2e is not a Turbo task
    assertExpectedProjects(extra, process.env['E2E_EXPECTED_PROJECTS'])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exitCode = 1
    return
  }

  const extraLabel = extra.length === 0 ? '(none)' : extra.join(' ')
  console.log(`[e2e] mode: ${mode}; extra args: ${extraLabel}`)
  for (const name of suitesToRun(suite)) {
    const args = playwrightArgvForSuite(name, extra, mode)
    console.log(`[e2e] ${name}: playwright ${args.join(' ')}`)
    const code = await runPlaywright(args)
    if (code !== 0) {
      process.exitCode = code
      return
    }
  }
}

const entryPoint = process.argv[1]
if (entryPoint !== undefined && import.meta.url === pathToFileURL(path.resolve(entryPoint)).href) {
  await main()
}
