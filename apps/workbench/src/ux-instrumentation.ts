export type UxMetricKind = 'interaction' | 'task'

export interface UxMetricEvent {
  readonly durationMilliseconds: number
  readonly kind: UxMetricKind
  readonly name: string
}

export interface UxMetrics {
  events: UxMetricEvent[]
  layoutShiftScore: number
}

const MAX_EVENTS = 256
let enabled = false
const pendingPaints = new Set<string>()

function metrics(): UxMetrics | undefined {
  return enabled ? window.__PJI_UX_METRICS__ : undefined
}

function record(event: UxMetricEvent): void {
  const current = metrics()
  if (current === undefined) return
  current.events.push(event)
  if (current.events.length > MAX_EVENTS)
    current.events.splice(0, current.events.length - MAX_EVENTS)
}

export function initializeUxInstrumentation(nextEnabled: boolean): void {
  enabled = nextEnabled
  pendingPaints.clear()
  if (enabled) window.__PJI_UX_METRICS__ = { events: [], layoutShiftScore: 0 }
  else delete window.__PJI_UX_METRICS__
}

export function beginUxTask(name: string): () => void {
  if (!enabled) return () => undefined
  const startedAt = performance.now()
  let finished = false
  return () => {
    if (finished) return
    finished = true
    record({ durationMilliseconds: performance.now() - startedAt, kind: 'task', name })
  }
}

export function measureUxNextPaint(name: string): void {
  if (!enabled || pendingPaints.has(name)) return
  pendingPaints.add(name)
  const startedAt = performance.now()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pendingPaints.delete(name)
      record({ durationMilliseconds: performance.now() - startedAt, kind: 'interaction', name })
    })
  })
}

export function observeUxLayoutShift(): () => void {
  if (!enabled || typeof PerformanceObserver === 'undefined') return () => undefined
  const observer = new PerformanceObserver((list) => {
    const current = metrics()
    if (current === undefined) return
    for (const entry of list.getEntries()) {
      const candidate = entry as PerformanceEntry & {
        readonly hadRecentInput?: unknown
        readonly value?: unknown
      }
      if (candidate.hadRecentInput === false && typeof candidate.value === 'number') {
        current.layoutShiftScore += candidate.value
      }
    }
  })
  try {
    observer.observe({ type: 'layout-shift', buffered: true })
  } catch {
    return () => undefined
  }
  return () => observer.disconnect()
}
