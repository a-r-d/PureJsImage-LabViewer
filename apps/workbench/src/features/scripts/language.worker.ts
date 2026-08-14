import ts from 'typescript-compiler'

interface LanguageRequest {
  readonly schemaVersion: 1
  readonly requestId: string
  readonly kind: 'language.check' | 'language.compile'
  readonly language: 'javascript' | 'typescript'
  readonly source: string
  readonly declaration: string
  readonly apiNames: readonly string[]
}

interface LanguageProblem {
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly line: number
  readonly column: number
}

const MAX_SOURCE_BYTES = 256 * 1024
const MAX_DECLARATION_BYTES = 256 * 1024

const PRELUDE = `
interface Array<T> { readonly length: number; readonly [index: number]: T; map<U>(fn: (value: T, index: number) => U): U[] }
interface ReadonlyArray<T> { readonly length: number; readonly [index: number]: T }
interface Promise<T> { then<U>(fn: (value: T) => U | PromiseLike<U>): Promise<U> }
interface PromiseLike<T> { then<U>(fn: (value: T) => U | PromiseLike<U>): PromiseLike<U> }
interface Record<K extends keyof any, T> { readonly [P in K]: T }
type Readonly<T> = { readonly [P in keyof T]: T[P] }
interface Object {}
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments { readonly length: number; readonly [index: number]: unknown }
interface String { readonly length: number }
interface Number {}
interface Boolean {}
interface RegExp {}
interface Error { readonly message: string }
interface JSON { stringify(value: unknown): string | undefined }
declare const JSON: JSON
declare const console: { info(...values: readonly unknown[]): void; warn(...values: readonly unknown[]): void; error(...values: readonly unknown[]): void }
declare const globalThis: { __scriptMain?: () => unknown }
`

function isRequest(value: unknown): value is LanguageRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Partial<LanguageRequest>
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.requestId === 'string' &&
    (candidate.kind === 'language.check' || candidate.kind === 'language.compile') &&
    (candidate.language === 'javascript' || candidate.language === 'typescript') &&
    typeof candidate.source === 'string' &&
    typeof candidate.declaration === 'string' &&
    Array.isArray(candidate.apiNames) &&
    candidate.apiNames.every((name) => typeof name === 'string')
  )
}

function position(sourceFile: ts.SourceFile | undefined, start: number | undefined) {
  if (sourceFile === undefined || start === undefined) return { line: 1, column: 1 }
  const value = sourceFile.getLineAndCharacterOfPosition(start)
  return { line: value.line + 1, column: value.character + 1 }
}

function diagnosticProblem(diagnostic: ts.Diagnostic): LanguageProblem {
  return {
    severity: diagnostic.category === ts.DiagnosticCategory.Warning ? 'warning' : 'error',
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').slice(0, 4_096),
    ...position(diagnostic.file, diagnostic.start),
  }
}

function policyProblems(request: LanguageRequest): readonly LanguageProblem[] {
  const problems: LanguageProblem[] = []
  const dynamicImport = /\bimport\s*\(/u.exec(request.source)
  if (dynamicImport !== null)
    problems.push({
      severity: 'error',
      message: 'Dynamic import is not available in the restricted script environment.',
      line: request.source.slice(0, dynamicImport.index).split('\n').length,
      column: 1,
    })
  const imports = [
    ...request.source.matchAll(/\bfrom\s*(['"])([^'"]+)\1/gu),
    ...request.source.matchAll(/\bimport\s*(['"])([^'"]+)\1/gu),
    ...request.source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1/gu),
  ]
  for (const match of imports) {
    if (match[2] !== '@lab/api')
      problems.push({
        severity: 'error',
        message: `Module is not permitted: ${match[2] ?? 'unknown'}`,
        line: request.source.slice(0, match.index).split('\n').length,
        column: 1,
      })
  }
  const api = new Set(request.apiNames)
  for (const match of request.source.matchAll(/\blab\.([A-Za-z][\w]*)\.([A-Za-z][\w]*)/gu)) {
    const name = `${match[1]}.${match[2]}`
    if (!api.has(name))
      problems.push({
        severity: 'error',
        message: `Unknown @lab/api endpoint: ${name}`,
        line: request.source.slice(0, match.index).split('\n').length,
        column: 1,
      })
  }
  return problems
}

function typecheck(request: LanguageRequest): readonly LanguageProblem[] {
  const sourceName = request.language === 'typescript' ? '/script.ts' : '/script.js'
  const files = new Map([
    [sourceName, request.source],
    ['/lab-api.d.ts', request.declaration],
    ['/lib.d.ts', PRELUDE],
  ])
  const versions = new Map([...files.keys()].map((name) => [name, '1']))
  const options: ts.CompilerOptions = {
    allowJs: request.language === 'javascript',
    checkJs: request.language === 'javascript',
    strict: true,
    noEmit: true,
    noLib: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  }
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: (name) => versions.get(name) ?? '0',
    getScriptSnapshot: (name) => {
      const content = files.get(name)
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content)
    },
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: () => '/lib.d.ts',
    fileExists: (name) => files.has(name),
    readFile: (name) => files.get(name),
    readDirectory: () => [],
  }
  const service = ts.createLanguageService(host)
  try {
    return [
      ...service.getSyntacticDiagnostics(sourceName),
      ...service.getSemanticDiagnostics(sourceName),
    ].map(diagnosticProblem)
  } finally {
    service.dispose()
  }
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const request = event.data
  if (!isRequest(request)) return
  const encoder = new TextEncoder()
  if (
    encoder.encode(request.source).byteLength > MAX_SOURCE_BYTES ||
    encoder.encode(request.declaration).byteLength > MAX_DECLARATION_BYTES
  ) {
    self.postMessage({
      schemaVersion: 1,
      requestId: request.requestId,
      ok: false,
      error: 'Language request exceeds its byte limit.',
    })
    return
  }
  try {
    const problems = [...policyProblems(request), ...typecheck(request)]
    const javascript =
      request.kind === 'language.compile' && !problems.some(({ severity }) => severity === 'error')
        ? request.language === 'typescript'
          ? ts.transpileModule(request.source, {
              compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ESNext,
                isolatedModules: true,
              },
            }).outputText
          : request.source
        : undefined
    self.postMessage({
      schemaVersion: 1,
      requestId: request.requestId,
      ok: true,
      problems,
      ...(javascript === undefined ? {} : { javascript }),
    })
  } catch (error) {
    self.postMessage({
      schemaVersion: 1,
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 4_096) : 'Language Worker failed.',
    })
  }
})
