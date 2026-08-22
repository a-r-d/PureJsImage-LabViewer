import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
const FORBIDDEN_CODE = [
  { label: 'eval call', pattern: /\beval\s*\(/ },
  { label: 'Function constructor', pattern: /\bnew\s+Function\s*\(/ },
  { label: 'dangerous HTML insertion', pattern: /dangerouslySetInnerHTML/ },
]
const FORBIDDEN_BUNDLE_CODE = FORBIDDEN_CODE.slice(0, 2)
const SCIENCE_APP = 'science'

async function isWorkspaceDirectory(directory) {
  try {
    await readFile(path.join(directory, 'package.json'), 'utf8')
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectFiles(file)))
    else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) files.push(file)
  }
  return files
}

const root = process.cwd()
const sourceDirectories = []
const appEntries = []
for (const appEntry of await readdir(path.join(root, 'apps'), { withFileTypes: true })) {
  const directory = path.join(root, 'apps', appEntry.name)
  if (!appEntry.isDirectory() || !(await isWorkspaceDirectory(directory))) continue
  appEntries.push(appEntry)
  sourceDirectories.push(path.join(directory, 'src'))
}
for (const packageEntry of await readdir(path.join(root, 'packages'), { withFileTypes: true })) {
  const directory = path.join(root, 'packages', packageEntry.name)
  if (!packageEntry.isDirectory() || !(await isWorkspaceDirectory(directory))) continue
  sourceDirectories.push(path.join(directory, 'src'))
}

const files = []
for (const directory of sourceDirectories) files.push(...(await collectFiles(directory)))
const violations = []

for (const file of files) {
  const source = await readFile(file, 'utf8')
  for (const rule of FORBIDDEN_CODE) {
    if (rule.pattern.test(source)) violations.push(`${path.relative(root, file)}: ${rule.label}`)
  }
}

for (const appEntry of appEntries) {
  try {
    const bundleFiles = await collectFiles(path.join(root, 'apps', appEntry.name, 'dist'))
    for (const file of bundleFiles) {
      const source = await readFile(file, 'utf8')
      for (const rule of FORBIDDEN_BUNDLE_CODE) {
        if (rule.pattern.test(source)) {
          violations.push(`${path.relative(root, file)}: production bundle ${rule.label}`)
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }

  const headersPath = path.join(root, 'apps', appEntry.name, 'public/_headers')
  const headers = await readFile(headersPath, 'utf8')
  const relativeHeaders = `apps/${appEntry.name}/public/_headers`
  if (!headers.includes('Content-Security-Policy:')) {
    violations.push(`${relativeHeaders}: missing Content-Security-Policy`)
  }
  if (headers.includes("'unsafe-eval'")) {
    violations.push(`${relativeHeaders}: CSP permits 'unsafe-eval'`)
  }
  if (headers.includes('[::1]:*')) {
    violations.push(`${relativeHeaders}: CSP host http://[::1]:* is invalid in Firefox`)
  }
  if (appEntry.name === SCIENCE_APP && !headers.includes("script-src 'self' 'wasm-unsafe-eval'")) {
    violations.push(`${relativeHeaders}: QuickJS requires narrowly scoped 'wasm-unsafe-eval'`)
  }
}

if (violations.length > 0) {
  console.error(`Static security violations:\n${violations.join('\n')}`)
  process.exitCode = 1
} else {
  console.log('Static security checks: passed')
}
