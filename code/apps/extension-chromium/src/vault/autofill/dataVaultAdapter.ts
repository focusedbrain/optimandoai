// ============================================================================
// WRVault DataVault — Profile Adapter
// ============================================================================
//
// Converts existing VaultItem (identity / company / business) entries into
// a canonical key→value map consumable by the DataVault fill engine.
//
// This module never alters the vault schema.  It is a read-only projection
// layer that maps legacy field keys to FieldKind identifiers.
//
// Public API:
//   listDataVaultProfiles()       → Promise<DataVaultProfileSummary[]>
//   getDataVaultProfile(itemId)   → Promise<DataVaultProfile>
//   buildFieldMap(profile)        → Map<FieldKind, string>
//   getLastUsedProfileId(origin)  → Promise<string | null>
//   setLastUsedProfileId(origin, id) → Promise<void>
//
// ============================================================================

import * as vaultAPI from '../api'
import type { VaultItem, Field } from '../types'
import type { FieldKind, VaultSection } from '../../../../../packages/shared/src/vault/fieldTaxonomy'
import { LEGACY_KEY_MAP } from '../../../../../packages/shared/src/vault/fieldTaxonomy'

// ============================================================================
// §1  Types
// ============================================================================

/** Profile category for the DataVault popup, matching the vault UI badges. */
export type DataVaultProfileType = 'private' | 'company' | 'custom'

/** Summary for listing profiles in the popup (no field values). */
export interface DataVaultProfileSummary {
  itemId: string
  title: string
  type: DataVaultProfileType
  section: VaultSection
}

/** Full profile with resolved field map. */
export interface DataVaultProfile {
  itemId: string
  title: string
  type: DataVaultProfileType
  section: VaultSection
  fields: Map<FieldKind, string>
}

// ============================================================================
// §2  Constants
// ============================================================================

/** chrome.storage.local key prefix for last-used DataVault profile per origin. */
const LAST_USED_KEY_PREFIX = 'wrv_dv_last_profile_'

/** chrome.storage.local key for DataVault origin denylist. */
const DV_DENYLIST_KEY = 'wrv_dv_denylist'

/** Maximum origins in the denylist (prevent unbounded growth). */
const MAX_DENYLIST_ORIGINS = 500

/** Item categories that are DataVault candidates. */
const DV_CATEGORIES = new Set(['identity', 'company', 'custom'])

/** Map vault item category to popup profile type. */
function categoryToProfileType(category: string): DataVaultProfileType {
  switch (category) {
    case 'identity':  return 'private'
    case 'company':   return 'company'
    case 'custom':    return 'custom'
    default:          return 'custom'
  }
}

/** Map vault item category to vault section. */
function categoryToSection(category: string): VaultSection {
  switch (category) {
    case 'identity':  return 'identity'
    case 'company':   return 'company'
    default:          return 'identity'
  }
}

// ============================================================================
// §3  Profile Listing
// ============================================================================

/**
 * List all available DataVault profiles (identity + company/business items).
 *
 * Returns summaries only (no field values) — safe for the popup list.
 */
export async function listDataVaultProfiles(): Promise<DataVaultProfileSummary[]> {
  const items = await vaultAPI.listItems()
  const profiles: DataVaultProfileSummary[] = []

  for (const item of items) {
    if (!DV_CATEGORIES.has(item.category)) continue
    profiles.push({
      itemId: item.id,
      title: item.title,
      type: categoryToProfileType(item.category),
      section: categoryToSection(item.category),
    })
  }

  return profiles
}

// ============================================================================
// §4  Full Profile Retrieval
// ============================================================================

/**
 * Fetch a full DataVault profile with all field values resolved to FieldKind keys.
 */
export async function getDataVaultProfile(itemId: string): Promise<DataVaultProfile> {
  const item = await vaultAPI.getItem(itemId) as VaultItem

  const type: DataVaultProfileType = categoryToProfileType(item.category)
  const section: VaultSection = categoryToSection(item.category)
  const fields = buildFieldMap(item.fields, item.category)

  return {
    itemId: item.id,
    title: item.title,
    type,
    section,
    fields,
  }
}

// ============================================================================
// §5  Field Map Builder
// ============================================================================

/**
 * Build a canonical FieldKind → value map from a VaultItem's fields.
 *
 * Uses LEGACY_KEY_MAP to translate existing field keys (e.g., 'surname' → 'identity.last_name').
 * Only non-empty string values are included.
 */
export function buildFieldMap(fields: Field[], category: string): Map<FieldKind, string> {
  const map = new Map<FieldKind, string>()
  const keyMap = LEGACY_KEY_MAP[category] ?? {}

  for (const field of fields) {
    const kind = keyMap[field.key]
    if (!kind) continue
    const value = (field.value ?? '').trim()
    if (!value) continue
    // Use first IBAN only (payment_iban, payment_2_iban, etc. — prefer payment_iban)
    if (kind === 'company.iban' && map.has('company.iban')) continue
    map.set(kind, value)
  }

  // Special handling: compose full_name from first + last for identity profiles
  if (category === 'identity') {
    const firstName = map.get('identity.first_name') ?? ''
    const lastName = map.get('identity.last_name') ?? ''
    if (firstName && lastName && !map.has('identity.full_name')) {
      map.set('identity.full_name', `${firstName} ${lastName}`)
    }

    // Legacy migration: split date_of_birth → birth_day/birth_month/birth_year
    const legacyDob = map.get('identity.birthday')
    if (legacyDob && !map.has('identity.birth_day')) {
      const parsed = parseLegacyDob(legacyDob)
      if (parsed) {
        map.set('identity.birth_day', String(parsed.day))
        map.set('identity.birth_month', String(parsed.month))
        map.set('identity.birth_year', String(parsed.year))
      }
    }

    // Compose identity.birthday from the 3 components if not already set
    if (!map.has('identity.birthday')) {
      const d = map.get('identity.birth_day')
      const m = map.get('identity.birth_month')
      const y = map.get('identity.birth_year')
      if (d && m && y) {
        map.set('identity.birthday', `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`)
      }
    }
  }

  // Map the item title as company.name if not already mapped
  if (category === 'company' && !map.has('company.name')) {
    // Company items often use title as the company name
    // Only set if no explicit company.name field exists
  }

  return map
}

// ============================================================================
// §6  Last-Used Profile Persistence
// ============================================================================

/**
 * Get the last-used DataVault profile ID for an origin.
 * Returns null if no profile was previously used on this origin.
 */
export function getLastUsedProfileId(origin: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve(null)
      return
    }
    const key = LAST_USED_KEY_PREFIX + normalizeOrigin(origin)
    chrome.storage.local.get(key, (result) => {
      resolve((result[key] as string) ?? null)
    })
  })
}

/**
 * Persist the last-used DataVault profile ID for an origin.
 */
export function setLastUsedProfileId(origin: string, profileId: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve()
      return
    }
    const key = LAST_USED_KEY_PREFIX + normalizeOrigin(origin)
    chrome.storage.local.set({ [key]: profileId }, () => resolve())
  })
}

// ============================================================================
// §7  Origin Denylist ("Never fill on this site")
// ============================================================================

/**
 * Check if an origin is in the DataVault denylist.
 */
export function isDvDenylisted(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve(false)
      return
    }
    chrome.storage.local.get(DV_DENYLIST_KEY, (result) => {
      const list: string[] = result[DV_DENYLIST_KEY] ?? []
      resolve(list.includes(normalizeOrigin(origin)))
    })
  })
}

/**
 * Add an origin to the DataVault denylist.
 */
export function addToDvDenylist(origin: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve()
      return
    }
    chrome.storage.local.get(DV_DENYLIST_KEY, (result) => {
      const list: string[] = result[DV_DENYLIST_KEY] ?? []
      const norm = normalizeOrigin(origin)
      if (!list.includes(norm)) {
        list.push(norm)
        if (list.length > MAX_DENYLIST_ORIGINS) list.shift()
      }
      chrome.storage.local.set({ [DV_DENYLIST_KEY]: list }, () => resolve())
    })
  })
}

/**
 * Remove an origin from the DataVault denylist.
 */
export function removeFromDvDenylist(origin: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve()
      return
    }
    chrome.storage.local.get(DV_DENYLIST_KEY, (result) => {
      const list: string[] = result[DV_DENYLIST_KEY] ?? []
      const norm = normalizeOrigin(origin)
      const idx = list.indexOf(norm)
      if (idx >= 0) list.splice(idx, 1)
      chrome.storage.local.set({ [DV_DENYLIST_KEY]: list }, () => resolve())
    })
  })
}

// ============================================================================
// §8  Helpers
// ============================================================================

/** Normalize an origin for consistent storage keys. */
function normalizeOrigin(origin: string): string {
  try {
    const url = new URL(origin)
    return url.origin
  } catch {
    return origin.toLowerCase().trim()
  }
}

/**
 * Parse a legacy date_of_birth string into day/month/year.
 * Supports: DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD
 */
function parseLegacyDob(value: string): { day: number; month: number; year: number } | null {
  const trimmed = value.trim()

  // YYYY-MM-DD (ISO)
  let m = trimmed.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/)
  if (m) return { year: parseInt(m[1]), month: parseInt(m[2]), day: parseInt(m[3]) }

  // DD.MM.YYYY or DD/MM/YYYY (European)
  m = trimmed.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/)
  if (m) return { day: parseInt(m[1]), month: parseInt(m[2]), year: parseInt(m[3]) }

  return null
}
