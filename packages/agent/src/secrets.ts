const KEY_SHAPES = Object.freeze([
  /sk-or-[A-Za-z0-9_-]{8,}/gu,
  /sk-or-v1-[A-Za-z0-9_-]{8,}/gu,
  /Bearer\s+[A-Za-z0-9._~+/-]{8,}/gu,
])

export function credentialLeakNeedles(key: string): readonly string[] {
  const trimmed = key.trim()
  const needles = new Set<string>([trimmed])
  if (trimmed.length >= 12) needles.add(trimmed.slice(0, 12))
  if (trimmed.length >= 8) needles.add(trimmed.slice(-8))
  return [...needles]
}

export function findCredentialLeaks(value: unknown, key: string): readonly string[] {
  const serialized = stableSerialize(value)
  const hits: string[] = []
  for (const needle of credentialLeakNeedles(key)) {
    if (needle.length >= 8 && serialized.includes(needle)) hits.push(needle)
  }
  for (const shape of KEY_SHAPES) {
    shape.lastIndex = 0
    if (shape.test(serialized) && !hits.includes(shape.source)) hits.push(shape.source)
  }
  return hits
}

export function assertNoCredentialLeak(value: unknown, key: string, label: string): void {
  const hits = findCredentialLeaks(value, key)
  if (hits.length > 0) {
    throw new Error(`${label} leaked credential material: ${hits.join(', ')}`)
  }
}

function stableSerialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}
