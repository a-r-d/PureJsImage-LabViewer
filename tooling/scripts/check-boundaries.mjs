import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
const IMPORT_PATTERN =
  /(?:import\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?|export\s+(?:type\s+)?[^'";]*?\s+from\s+|import\s*\()\s*['"]([^'"]+)['"]/g

function normalized(value) {
  return value.split(path.sep).join('/')
}

function resolveRepositoryImport(file, specifier) {
  if (!specifier.startsWith('.')) return undefined
  return normalized(path.normalize(path.join(path.dirname(file), specifier)))
}

export function inspectSource(relativeFile, source) {
  const file = normalized(relativeFile)
  const violations = []

  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1]
    if (specifier === undefined) continue
    const resolved = resolveRepositoryImport(file, specifier)

    if (
      specifier.includes('purejsimage/src') ||
      specifier.includes('node_modules/purejsimage/src')
    ) {
      violations.push(`${file}: private PureJsImage import '${specifier}'`)
    }

    if (specifier === 'purejsimage' || specifier.startsWith('purejsimage/')) {
      const deliberateTypeContract =
        (file.startsWith('packages/contracts/') || file.startsWith('packages/workspace/')) &&
        /^import\s+type\b/.test(match[0])
      if (!file.startsWith('packages/imaging/') && !deliberateTypeContract) {
        violations.push(`${file}: PureJsImage import outside packages/imaging '${specifier}'`)
      }
    }

    if (file.startsWith('packages/')) {
      const importsApp =
        specifier === '@pji-workbench/app' ||
        specifier.startsWith('@pji-workbench/app/') ||
        specifier.startsWith('apps/') ||
        resolved?.startsWith('apps/') === true
      if (importsApp) {
        violations.push(`${file}: package import from application '${specifier}'`)
      }
    }

    if (
      (file.startsWith('packages/contracts/') || file.startsWith('packages/workspace/')) &&
      (specifier === 'react' || specifier.startsWith('react/'))
    ) {
      violations.push(`${file}: React import in framework-neutral core '${specifier}'`)
    }

    if (file.startsWith('apps/')) {
      const namedPrivateImport = /^@pji-workbench\/[^/]+\/(?:src|tests?)(?:\/|$)/.test(specifier)
      const relativePrivateImport = /^packages\/[^/]+\/src(?:\/|$)/.test(resolved ?? '')
      if (namedPrivateImport || relativePrivateImport) {
        violations.push(`${file}: application deep import into package internals '${specifier}'`)
      }
    }
  }

  return violations
}

async function collectSourceFiles(root, directory) {
  const absoluteDirectory = path.join(root, directory)
  const entries = await readdir(absoluteDirectory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const relative = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(root, relative)))
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(relative)
    }
  }

  return files
}

export async function findBoundaryViolations(root) {
  const files = [
    ...(await collectSourceFiles(root, 'apps')),
    ...(await collectSourceFiles(root, 'packages')),
  ]
  const violations = []

  for (const file of files.sort()) {
    const source = await readFile(path.join(root, file), 'utf8')
    violations.push(...inspectSource(file, source))
  }

  return violations
}

async function main() {
  const root = process.cwd()
  const violations = await findBoundaryViolations(root)
  if (violations.length > 0) {
    console.error(`Architecture boundary violations:\n${violations.join('\n')}`)
    process.exitCode = 1
    return
  }
  console.log('Architecture boundaries: passed')
}

const entryPoint = process.argv[1]
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  await main()
}
