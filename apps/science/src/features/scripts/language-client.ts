import type { GeneratedScriptApiV1 } from '@pji-workbench/scripts'

export interface ScriptLanguageProblem {
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly line: number
  readonly column: number
}

export interface ScriptLanguageResult {
  readonly problems: readonly ScriptLanguageProblem[]
  readonly javascript?: string
}

interface Pending {
  readonly resolve: (value: ScriptLanguageResult) => void
  readonly reject: (error: Error) => void
}

export class ScriptLanguageClient {
  #worker: Worker | undefined
  #sequence = 0
  readonly #pending = new Map<string, Pending>()

  check(
    source: string,
    language: 'javascript' | 'typescript',
    api: GeneratedScriptApiV1,
  ): Promise<ScriptLanguageResult> {
    return this.#request('language.check', source, language, api)
  }

  compile(
    source: string,
    language: 'javascript' | 'typescript',
    api: GeneratedScriptApiV1,
  ): Promise<ScriptLanguageResult> {
    return this.#request('language.compile', source, language, api)
  }

  cancel(): void {
    this.#worker?.terminate()
    this.#worker = undefined
    for (const pending of this.#pending.values())
      pending.reject(new DOMException('Language request cancelled.', 'AbortError'))
    this.#pending.clear()
  }

  dispose(): void {
    this.cancel()
  }

  #request(
    kind: 'language.check' | 'language.compile',
    source: string,
    language: 'javascript' | 'typescript',
    api: GeneratedScriptApiV1,
  ): Promise<ScriptLanguageResult> {
    const worker = this.#worker ?? this.#createWorker()
    const requestId = `language-${++this.#sequence}`
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject })
      worker.postMessage({
        schemaVersion: 1,
        requestId,
        kind,
        language,
        source,
        declaration: api.declaration,
        apiNames: api.endpoints.map(({ api: name }) => name),
      })
    })
  }

  #createWorker(): Worker {
    const worker = new Worker(new URL('./language.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      const value = event.data
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return
      const response = value as Readonly<Record<string, unknown>>
      const requestId = response['requestId']
      if (typeof requestId !== 'string') return
      const pending = this.#pending.get(requestId)
      if (pending === undefined) return
      this.#pending.delete(requestId)
      if (response['ok'] !== true) {
        pending.reject(
          new Error(
            typeof response['error'] === 'string' ? response['error'] : 'Language Worker failed.',
          ),
        )
        return
      }
      const problems = Array.isArray(response['problems'])
        ? response['problems'].flatMap((candidate) => {
            if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
              return []
            const problem = candidate as Readonly<Record<string, unknown>>
            const rawSeverity = problem['severity']
            if (rawSeverity !== 'error' && rawSeverity !== 'warning') return []
            const severity: ScriptLanguageProblem['severity'] = rawSeverity
            return typeof problem['message'] === 'string' &&
              typeof problem['line'] === 'number' &&
              typeof problem['column'] === 'number'
              ? [
                  {
                    severity,
                    message: problem['message'],
                    line: problem['line'],
                    column: problem['column'],
                  },
                ]
              : []
          })
        : []
      pending.resolve({
        problems,
        ...(typeof response['javascript'] === 'string'
          ? { javascript: response['javascript'] }
          : {}),
      })
    })
    worker.addEventListener('error', () => {
      for (const pending of this.#pending.values())
        pending.reject(new Error('Language Worker crashed.'))
      this.#pending.clear()
      this.#worker = undefined
      worker.terminate()
    })
    this.#worker = worker
    return worker
  }
}
