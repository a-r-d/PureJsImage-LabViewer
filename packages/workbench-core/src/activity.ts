export class ActivityController {
  #generation = 0
  #open: AbortController | undefined
  #analysis: AbortController | undefined

  get generation(): number {
    return this.#generation
  }

  startOpen(): { readonly generation: number; readonly signal: AbortSignal } {
    this.#open?.abort()
    const controller = new AbortController()
    this.#open = controller
    return { generation: this.#generation + 1, signal: controller.signal }
  }

  completeOpen(generation: number): void {
    this.#generation = generation
  }

  syncGeneration(generation: number): void {
    this.#generation = generation
  }

  cancelOpen(): void {
    this.#open?.abort()
  }

  startAnalysis(reason: string): AbortController {
    this.#analysis?.abort(new DOMException(reason, 'AbortError'))
    const controller = new AbortController()
    this.#analysis = controller
    return controller
  }

  get analysis(): AbortController | undefined {
    return this.#analysis
  }

  set analysis(controller: AbortController | undefined) {
    this.#analysis = controller
  }

  cancelAnalysis(reason: string): void {
    this.#analysis?.abort(new DOMException(reason, 'AbortError'))
  }

  clearAnalysis(): void {
    this.#analysis = undefined
  }
}
