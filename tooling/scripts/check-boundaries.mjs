import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
const IMPORT_PATTERN =
  /(?:import\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?|export\s+(?:type\s+)?[^'";]*?\s+from\s+|import\s*\()\s*['"]([^'"]+)['"]/g

const APPLICATION_PACKAGE_NAMES = [
  '@pji-workbench/app',
  '@pji-workbench/science',
  '@pji-workbench/gallery',
  '@pji-workbench/geo',
]

const CROSS_APP_RULES = [
  {
    prefix: 'apps/science/',
    forbidden: ['@pji-workbench/domain-geo', '@pji-workbench/gallery', '@pji-workbench/geo'],
    message: 'science app import of geo or gallery',
  },
  {
    prefix: 'apps/geo/',
    forbidden: [
      '@pji-workbench/domain-science',
      '@pji-workbench/materials-analysis',
      '@pji-workbench/science',
      '@pji-workbench/gallery',
    ],
    message: 'geo app import of science or materials-analysis',
  },
  {
    prefix: 'apps/gallery/',
    forbidden: [
      '@pji-workbench/imaging',
      '@pji-workbench/materials-analysis',
      '@pji-workbench/domain-science',
      '@pji-workbench/domain-geo',
      '@pji-workbench/scripts',
      '@pji-workbench/workbench-core',
      '@pji-workbench/workbench-react',
      '@pji-workbench/viewport',
      '@pji-workbench/agent',
      '@pji-workbench/workspace',
      '@pji-workbench/science',
      '@pji-workbench/geo',
    ],
    message: 'gallery import of imaging runtime or domain packages',
  },
  {
    prefix: 'packages/domain-geo/',
    forbidden: [
      '@pji-workbench/domain-science',
      '@pji-workbench/materials-analysis',
      '@pji-workbench/imaging',
    ],
    message: 'geo domain import of science, materials-analysis, or imaging',
  },
  {
    prefix: 'packages/geo-workbench/',
    forbidden: ['@pji-workbench/domain-science', '@pji-workbench/materials-analysis', 'react'],
    message: 'geo workbench import of science, materials-analysis, or React',
  },
  {
    prefix: 'packages/domain-science/',
    forbidden: ['@pji-workbench/domain-geo'],
    message: 'science domain import of geo',
  },
  {
    prefix: 'packages/workbench-core/',
    forbidden: ['@pji-workbench/domain-science', '@pji-workbench/domain-geo'],
    message: 'shared runtime import of a domain package',
  },
]

function normalized(value) {
  return value.split(path.sep).join('/')
}

function resolveRepositoryImport(file, specifier) {
  if (!specifier.startsWith('.')) return undefined
  return normalized(path.normalize(path.join(path.dirname(file), specifier)))
}

function specifierMatches(specifier, forbidden) {
  return specifier === forbidden || specifier.startsWith(`${forbidden}/`)
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
      const trustedScientificRuntime =
        file.startsWith('packages/imaging/') || file.startsWith('packages/materials-analysis/')
      if (!trustedScientificRuntime && !deliberateTypeContract) {
        violations.push(`${file}: PureJsImage import outside packages/imaging '${specifier}'`)
      }
    }

    if (file.startsWith('packages/')) {
      const importsApp =
        APPLICATION_PACKAGE_NAMES.some((name) => specifierMatches(specifier, name)) ||
        specifier.startsWith('apps/') ||
        resolved?.startsWith('apps/') === true
      if (importsApp) {
        violations.push(`${file}: package import from application '${specifier}'`)
      }
    }

    if (
      (file.startsWith('packages/actions/') ||
        file.startsWith('packages/contracts/') ||
        file.startsWith('packages/workspace/') ||
        file.startsWith('packages/workbench-core/') ||
        file.startsWith('packages/domain-geo/')) &&
      (specifier === 'react' || specifier.startsWith('react/'))
    ) {
      violations.push(`${file}: React import in framework-neutral core '${specifier}'`)
    }

    if (
      file.startsWith('packages/actions/') &&
      (specifier === 'purejsimage' || specifier.startsWith('purejsimage/'))
    ) {
      violations.push(`${file}: PureJsImage import in semantic action contracts '${specifier}'`)
    }

    for (const rule of CROSS_APP_RULES) {
      if (!file.startsWith(rule.prefix)) continue
      if (rule.forbidden.some((forbidden) => specifierMatches(specifier, forbidden))) {
        violations.push(`${file}: ${rule.message} '${specifier}'`)
      }
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

function featureName(file) {
  return normalized(file).match(/^apps\/science\/src\/features\/([^/]+)\//)?.[1]
}

export function findFeatureCycles(sources) {
  const graph = new Map()
  for (const { file: inputFile, source } of sources) {
    const file = normalized(inputFile)
    const from = featureName(file)
    if (from === undefined) continue
    const edges = graph.get(from) ?? new Set()
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1]
      if (specifier === undefined) continue
      const target = featureName(resolveRepositoryImport(file, specifier) ?? '')
      if (target !== undefined && target !== from) edges.add(target)
    }
    graph.set(from, edges)
  }
  const visiting = new Set()
  const visited = new Set()
  const stack = []
  const cycles = []
  function visit(feature) {
    if (visiting.has(feature)) {
      const start = stack.indexOf(feature)
      cycles.push([...stack.slice(start), feature].join(' -> '))
      return
    }
    if (visited.has(feature)) return
    visiting.add(feature)
    stack.push(feature)
    for (const dependency of [...(graph.get(feature) ?? [])].sort()) visit(dependency)
    stack.pop()
    visiting.delete(feature)
    visited.add(feature)
  }
  for (const feature of [...graph.keys()].sort()) visit(feature)
  return [...new Set(cycles)]
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
  const sources = []

  for (const file of files.sort()) {
    const source = await readFile(path.join(root, file), 'utf8')
    sources.push({ file, source })
    violations.push(...inspectSource(file, source))
  }

  violations.push(
    ...findFeatureCycles(sources).map(
      (cycle) => `apps/science/src/features: feature cycle '${cycle}'`,
    ),
  )

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
