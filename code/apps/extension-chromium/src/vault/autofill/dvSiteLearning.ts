// ============================================================================
// WRVault DataVault — Site Learning Store
// ============================================================================
//
// Persists per-origin field fingerprint → vaultKey mappings in
// chrome.storage.local.  When the user manually remaps a field in the popup,
// we store a PII-free fingerprint so the same field is auto-recognised on
// next visit with boosted confidence (0.95).
//
// Fingerprint (NO PII):
//   { tagName, inputType, name, id, autocomplete, formIndex,
//     labelHash (SHA-256 truncated of normalized label text) }
//
// Security contract:
//   - NEVER store field values, user data, or raw label text
//   - labelHash is a one-way hash — not reversible to PII
//   - Mappings are per-origin, bounded in count (MAX_MAPPINGS_PER_ORIGIN)
//   - Total origins bounded (MAX_ORIGINS)
//
// Public API:
//   buildFieldFingerprint(el)              → FieldFingerprint
//   lookupLearnedMapping(origin, fp)       → FieldKind | null
//   saveLearned(origin, fp, vaultKey)      → void
//   removeLearned(origin, fp)              → void
//   getLearnedMappings(origin)             → LearnedMapping[]
//   clearLearnedMappings(origin)           → void
//
// ============================================================================

import type { FieldKind } from '../../../../../packages/shared/src/vault/fieldTaxonomy'

// ============================================================================
// §1  Types
// ============================================================================

/** PII-free fingerprint of a DOM form field. */
export interface FieldFingerprint {
  tagName: string
  inputType: string
  name: string
  id: string
  autocomplete: string
  formIndex: number
  /** Truncated SHA-256 of normalised label text (one-way, no PII). */
  labelHash: string
}

/** A persisted learned mapping. */
export interface LearnedMapping {
  fingerprint: FieldFingerprint
  vaultKey: FieldKind
  learnedAt: number
  usedCount: number
}

/** Per-origin store shape. */
interface OriginStore {
  mappings: LearnedMapping[]
  updatedAt: number
}

// ============================================================================
// §2  Constants
// ============================================================================

const STORAGE_KEY_PREFIX = 'wrv_dv_learn_'
const MAX_MAPPINGS_PER_ORIGIN = 60
const MAX_ORIGINS = 200
const ORIGINS_INDEX_KEY = 'wrv_dv_learn_index'

/** Confidence boost applied when a learned mapping matches. */
export const LEARNED_CONFIDENCE_BOOST = 95

// ============================================================================
// §3  Fingerprint Builder
// ============================================================================

/**
 * Build a PII-free fingerprint of a DOM form field.
 *
 * The fingerprint contains only structural/attribute data, never field values.
 * Label text is hashed so it can be compared without storing PII.
 */
export function buildFieldFingerprint(element: HTMLElement): FieldFingerprint {
  const input = element as HTMLInputElement
  const formIndex = getFormIndex(element)
  const labelText = resolveRawLabel(element)
  const labelHash = fastHash(labelText)

  return {
    tagName: element.tagName,
    inputType: (input.type ?? '').toLowerCase(),
    name: (input.name ?? '').toLowerCase(),
    id: (element.id ?? '').toLowerCase(),
    autocomplete: (element.getAttribute('autocomplete') ?? '').toLowerCase(),
    formIndex,
    labelHash,
  }
}

/**
 * Compute a match score between two fingerprints (0..1).
 *
 * Strong matches: name, id, autocomplete are the most stable identifiers.
 * Weak matches: formIndex and labelHash provide fallback disambiguation.
 */
export function fingerprintMatchScore(a: FieldFingerprint, b: FieldFingerprint): number {
  let score = 0
  let maxScore = 0

  // Tag name must match (hard requirement)
  if (a.tagName !== b.tagName) return 0

  // Input type (weight 15)
  maxScore += 15
  if (a.inputType === b.inputType) score += 15

  // Name attribute (weight 30 — most stable identifier)
  maxScore += 30
  if (a.name && b.name && a.name === b.name) score += 30

  // ID attribute (weight 25)
  maxScore += 25
  if (a.id && b.id && a.id === b.id) score += 25

  // Autocomplete (weight 20)
  maxScore += 20
  if (a.autocomplete && b.autocomplete && a.autocomplete === b.autocomplete) score += 20

  // Label hash (weight 15 — may change across deploys)
  maxScore += 15
  if (a.labelHash && b.labelHash && a.labelHash === b.labelHash) score += 15

  // Form index (weight 10 — positional, least stable)
  maxScore += 10
  if (a.formIndex === b.formIndex) score += 10

  return maxScore > 0 ? score / maxScore : 0
}

/** Minimum fingerprint match score to consider a learned mapping valid. */
const FP_MATCH_THRESHOLD = 0.55

// ============================================================================
// §4  Lookup
// ============================================================================

/**
 * Look up a learned mapping for a field on the given origin.
 *
 * Returns the vaultKey if a fingerprint match is found above threshold,
 * or null if no learned mapping exists.
 */
export async function lookupLearnedMapping(
  origin: string,
  fingerprint: FieldFingerprint,
): Promise<FieldKind | null> {
  const store = await loadOriginStore(origin)
  if (!store || store.mappings.length === 0) return null

  let bestKey: FieldKind | null = null
  let bestScore = 0

  for (const m of store.mappings) {
    const score = fingerprintMatchScore(fingerprint, m.fingerprint)
    if (score > bestScore && score >= FP_MATCH_THRESHOLD) {
      bestScore = score
      bestKey = m.vaultKey
    }
  }

  // Bump usage counter on match (non-blocking)
  if (bestKey) {
    bumpUsageAsync(origin, fingerprint, bestKey).catch(() => {})
  }

  return bestKey
}

/**
 * Batch-lookup for multiple fields at once (avoids repeated storage reads).
 */
export async function lookupLearnedMappingsBatch(
  origin: string,
  fingerprints: FieldFingerprint[],
): Promise<Map<FieldFingerprint, FieldKind>> {
  const store = await loadOriginStore(origin)
  const results = new Map<FieldFingerprint, FieldKind>()
  if (!store || store.mappings.length === 0) return results

  for (const fp of fingerprints) {
    let bestKey: FieldKind | null = null
    let bestScore = 0

    for (const m of store.mappings) {
      const score = fingerprintMatchScore(fp, m.fingerprint)
      if (score > bestScore && score >= FP_MATCH_THRESHOLD) {
        bestScore = score
        bestKey = m.vaultKey
      }
    }

    if (bestKey) {
      results.set(fp, bestKey)
    }
  }

  return results
}

// ============================================================================
// §5  Save / Remove
// ============================================================================

/**
 * Save a learned field→vaultKey mapping for an origin.
 *
 * If a mapping for the same fingerprint already exists, it is overwritten.
 * Enforces MAX_MAPPINGS_PER_ORIGIN (LRU eviction by learnedAt).
 */
export async function saveLearned(
  origin: string,
  fingerprint: FieldFingerprint,
  vaultKey: FieldKind,
): Promise<void> {
  const store = await loadOriginStore(origin) ?? { mappings: [], updatedAt: 0 }

  // Remove existing mapping for same fingerprint
  store.mappings = store.mappings.filter(
    m => fingerprintMatchScore(m.fingerprint, fingerprint) < FP_MATCH_THRESHOLD,
  )

  // Add new mapping
  store.mappings.push({
    fingerprint,
    vaultKey,
    learnedAt: Date.now(),
    usedCount: 0,
  })

  // Enforce cap: evict oldest (by learnedAt) if over limit
  if (store.mappings.length > MAX_MAPPINGS_PER_ORIGIN) {
    store.mappings.sort((a, b) => a.learnedAt - b.learnedAt)
    store.mappings = store.mappings.slice(-MAX_MAPPINGS_PER_ORIGIN)
  }

  store.updatedAt = Date.now()
  await saveOriginStore(origin, store)
  await ensureOriginInIndex(origin)
}

/**
 * Remove a single learned mapping.
 */
export async function removeLearned(
  origin: string,
  fingerprint: FieldFingerprint,
): Promise<void> {
  const store = await loadOriginStore(origin)
  if (!store) return

  store.mappings = store.mappings.filter(
    m => fingerprintMatchScore(m.fingerprint, fingerprint) < FP_MATCH_THRESHOLD,
  )
  store.updatedAt = Date.now()
  await saveOriginStore(origin, store)
}

/**
 * Get all learned mappings for an origin.
 */
export async function getLearnedMappings(origin: string): Promise<LearnedMapping[]> {
  const store = await loadOriginStore(origin)
  return store?.mappings ?? []
}

/**
 * Clear all learned mappings for an origin.
 */
export async function clearLearnedMappings(origin: string): Promise<void> {
  const key = STORAGE_KEY_PREFIX + normalizeOrigin(origin)
  await chromeLocalRemove(key)
}

// ============================================================================
// §6  Storage Helpers
// ============================================================================

async function loadOriginStore(origin: string): Promise<OriginStore | null> {
  const key = STORAGE_KEY_PREFIX + normalizeOrigin(origin)
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve(null)
      return
    }
    chrome.storage.local.get(key, (result) => {
      resolve((result[key] as OriginStore) ?? null)
    })
  })
}

async function saveOriginStore(origin: string, store: OriginStore): Promise<void> {
  const key = STORAGE_KEY_PREFIX + normalizeOrigin(origin)
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve()
      return
    }
    chrome.storage.local.set({ [key]: store }, () => resolve())
  })
}

async function ensureOriginInIndex(origin: string): Promise<void> {
  const norm = normalizeOrigin(origin)
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve()
      return
    }
    chrome.storage.local.get(ORIGINS_INDEX_KEY, (result) => {
      const index: string[] = result[ORIGINS_INDEX_KEY] ?? []
      if (!index.includes(norm)) {
        index.push(norm)
        // LRU eviction of oldest origins
        if (index.length > MAX_ORIGINS) {
          const evicted = index.shift()!
          chromeLocalRemove(STORAGE_KEY_PREFIX + evicted).catch(() => {})
        }
      }
      chrome.storage.local.set({ [ORIGINS_INDEX_KEY]: index }, () => resolve())
    })
  })
}

async function bumpUsageAsync(
  origin: string,
  fingerprint: FieldFingerprint,
  _vaultKey: FieldKind,
): Promise<void> {
  const store = await loadOriginStore(origin)
  if (!store) return

  for (const m of store.mappings) {
    if (fingerprintMatchScore(m.fingerprint, fingerprint) >= FP_MATCH_THRESHOLD) {
      m.usedCount++
      break
    }
  }

  store.updatedAt = Date.now()
  await saveOriginStore(origin, store)
}

function chromeLocalRemove(key: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve()
      return
    }
    chrome.storage.local.remove(key, () => resolve())
  })
}

// ============================================================================
// §7  Utility
// ============================================================================

function normalizeOrigin(origin: string): string {
  try {
    const url = new URL(origin)
    return url.origin
  } catch {
    return origin.toLowerCase().trim()
  }
}

function getFormIndex(element: HTMLElement): number {
  const form = element.closest('form')
  if (!form) return 0
  const inputs = form.querySelectorAll('input, select, textarea')
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i] === element) return i
  }
  return 0
}

function resolveRawLabel(element: HTMLElement): string {
  let label = ''

  if (element.id) {
    const forLabel = document.querySelector<HTMLLabelElement>(
      `label[for="${CSS.escape(element.id)}"]`,
    )
    if (forLabel) label = forLabel.textContent ?? ''
  }

  if (!label) {
    const parentLabel = element.closest('label')
    if (parentLabel) label = parentLabel.textContent ?? ''
  }

  if (!label) label = element.getAttribute('aria-label') ?? ''
  if (!label) label = (element as HTMLInputElement).placeholder ?? ''
  if (!label) label = element.title ?? ''

  return label.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Fast non-crypto hash for label text fingerprinting.
 * Produces a 16-char hex string.  NOT cryptographic — only for equality checks.
 */
function fastHash(input: string): string {
  if (!input) return ''
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return combined.toString(16).padStart(16, '0')
}
