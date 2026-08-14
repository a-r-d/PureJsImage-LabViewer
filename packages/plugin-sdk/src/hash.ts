import type {
  AnalysisScriptDocumentV1,
  ContentIntegrityV1,
  PluginJsonValue,
  RecipeDocumentV1,
} from './types.js'
import { utf8Bytes } from './utf8.js'

interface SubtleCryptoLike {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
}

function canonicalize(value: PluginJsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const object = value as { readonly [key: string]: PluginJsonValue }
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key] ?? null)}`)
    .join(',')}}`
}

export async function sha256Integrity(value: string): Promise<ContentIntegrityV1> {
  const subtle = (globalThis as { readonly crypto?: { readonly subtle?: SubtleCryptoLike } }).crypto
    ?.subtle
  if (subtle === undefined) throw new Error('Web Crypto SHA-256 is unavailable.')
  const digest = await subtle.digest('SHA-256', utf8Bytes(value))
  return {
    algorithm: 'sha256',
    digest: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  }
}

export async function scriptContentIntegrity(
  document: Omit<AnalysisScriptDocumentV1, 'integrity'>,
): Promise<ContentIntegrityV1> {
  return sha256Integrity(canonicalize(document as unknown as PluginJsonValue))
}

export async function recipeContentIntegrity(
  document: Omit<RecipeDocumentV1, 'integrity'>,
): Promise<ContentIntegrityV1> {
  return sha256Integrity(canonicalize(document as unknown as PluginJsonValue))
}
