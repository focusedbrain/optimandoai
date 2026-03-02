// ============================================================================
// WRVault QSO Remap — Mapping Store
// ============================================================================
//
// Persists and retrieves login form mappings using vault item metadata.
// Each vault credential (category: 'password') can have one mapping per
// effective origin stored in its item meta under the key 'qso_mapping'.
//
// API functions:
//   saveMapping(credentialId, mapping)   → stores mapping in vault meta
//   loadMapping(credentialId)            → retrieves mapping (or null)
//   deleteMapping(credentialId)          → removes mapping from meta
//   createCredentialFromPageInput(...)   → creates a new vault item + mapping
//   findCredentialsForOrigin(origin)     → finds vault items for an origin
//
// Security contract:
//   - All vault calls use existing authenticated API paths (sender-gated).
//   - No plaintext passwords stored in mapping; passwords are in vault fields.
//   - Mapping payloads contain only selectors, signatures, and timestamps.
//   - No PII in audit logs.
// ============================================================================

import * as vaultAPI from '../../api'
import type { VaultItem, Field } from '../../types'
import { auditLogSafe } from '../hardening'
import { isHAEnforced } from '../haGuard'
import type { LoginFormMapping, ElementMapping } from './selectorStrategy'
import {
  effectiveOrigin,
  buildElementMapping,
  validateMapping,
} from './selectorStrategy'
import type { MappingValidationResult } from './selectorStrategy'

// ============================================================================
// §1  Constants
// ============================================================================

/** Meta key for storing QSO mapping on a vault item. */
const META_KEY_QSO_MAPPING = 'qso_mapping'

/** Maximum number of vault items to check when resolving origin matches. */
const MAX_ORIGIN_CHECK = 50

// ============================================================================
// §2  Save / Load / Delete Mapping
// ============================================================================

/**
 * Save a login form mapping to a vault credential's metadata.
 *
 * Overwrites any existing mapping for the same origin.
 */
export async function saveMapping(
  credentialId: string,
  mapping: LoginFormMapping,
): Promise<void> {
  const ha = isHAEnforced()
  try {
    // Load existing meta (preserve other keys)
    const existingMeta = await vaultAPI.getItemMeta(credentialId) ?? {}
    const updatedMeta = {
      ...existingMeta,
      [META_KEY_QSO_MAPPING]: mapping,
    }
    await vaultAPI.setItemMeta(credentialId, updatedMeta)
    auditLogSafe(
      ha ? 'security' : 'info',
      'QSO_MAPPING_SAVED',
      'QSO mapping saved',
      { ha, op: 'save' },
    )
  } catch {
    auditLogSafe(
      ha ? 'security' : 'warn',
      'QSO_MAPPING_SAVE_FAILED',
      'Failed to save QSO mapping',
      { ha, op: 'save' },
    )
    throw new Error('MAPPING_SAVE_FAILED')
  }
}

/**
 * Load a login form mapping from a vault credential's metadata.
 *
 * Returns null if no mapping exists or if the mapping is malformed.
 */
export async function loadMapping(
  credentialId: string,
): Promise<LoginFormMapping | null> {
  try {
    const meta = await vaultAPI.getItemMeta(credentialId)
    if (!meta || typeof meta !== 'object') return null
    const raw = meta[META_KEY_QSO_MAPPING]
    if (!raw || typeof raw !== 'object') return null
    if (raw.mapping_version !== 1) return null
    if (typeof raw.origin !== 'string') return null
    if (!raw.password || typeof raw.password !== 'object') return null
    if (!raw.submit || typeof raw.submit !== 'object') return null
    return raw as LoginFormMapping
  } catch {
    return null
  }
}

/**
 * Delete a login form mapping from a vault credential's metadata.
 */
export async function deleteMapping(credentialId: string): Promise<void> {
  const ha = isHAEnforced()
  try {
    const existingMeta = await vaultAPI.getItemMeta(credentialId) ?? {}
    delete existingMeta[META_KEY_QSO_MAPPING]
    await vaultAPI.setItemMeta(credentialId, existingMeta)
    auditLogSafe(
      ha ? 'security' : 'info',
      'QSO_MAPPING_DELETED',
      'QSO mapping deleted',
      { ha, op: 'delete' },
    )
  } catch {
    auditLogSafe(
      ha ? 'security' : 'warn',
      'QSO_MAPPING_DELETE_FAILED',
      'Failed to delete QSO mapping',
      { ha, op: 'delete' },
    )
  }
}

// ============================================================================
// §3  Credential Creation (Add & Map)
// ============================================================================

/**
 * Create a new vault credential from page-input values and save a mapping.
 *
 * This is the "Add & Map" flow:
 *   1. Create a vault item (category: password) with the given credentials.
 *   2. Save the mapping for QSO autofill.
 *
 * Returns the created vault item ID.
 *
 * Security: Password is sent encrypted via the vault API (same as manual save).
 */
export async function createCredentialFromPageInput(params: {
  origin: string
  username: string
  password: string
  label?: string
  mapping: LoginFormMapping
}): Promise<string> {
  const ha = isHAEnforced()
  const hostname = extractHostname(params.origin)
  const title = params.label ?? hostname

  const fields: Field[] = []

  if (params.username) {
    fields.push({ key: 'username', value: params.username, type: 'text', encrypted: false })
  }
  fields.push({ key: 'password', value: params.password, type: 'password', encrypted: false })

  try {
    const item = await vaultAPI.createItem({
      category: 'password',
      title,
      fields,
      domain: hostname,
      favorite: false,
    })

    await saveMapping(item.id, params.mapping)

    auditLogSafe(
      ha ? 'security' : 'info',
      'QSO_CREDENTIAL_CREATED',
      'QSO credential created via Add and Map',
      { ha, op: 'create' },
    )

    return item.id
  } catch {
    auditLogSafe(
      ha ? 'security' : 'warn',
      'QSO_CREDENTIAL_CREATE_FAILED',
      'Failed to create QSO credential',
      { ha, op: 'create' },
    )
    throw new Error('CREDENTIAL_CREATE_FAILED')
  }
}

// ============================================================================
// §4  Origin-Based Credential Lookup
// ============================================================================

/**
 * Credential found for an origin, with its mapping status.
 */
export interface OriginCredential {
  item: { id: string; title: string; domain?: string }
  mapping: LoginFormMapping | null
  mappingValid: boolean
  validationResult: MappingValidationResult | null
}

/**
 * Find all vault credentials for the effective origin and check their mappings.
 *
 * Returns credentials sorted by relevance (mapped + valid first).
 */
export async function findCredentialsForOrigin(
  origin: string,
): Promise<OriginCredential[]> {
  try {
    const allItems = await vaultAPI.listItemsForIndex()
    const hostname = extractHostname(origin)

    // Filter to password-category items matching the origin
    const matching = allItems
      .filter(item =>
        item.category === 'password' &&
        item.domain &&
        domainsMatch(item.domain, hostname),
      )
      .slice(0, MAX_ORIGIN_CHECK)

    const results: OriginCredential[] = []

    for (const item of matching) {
      const mapping = await loadMapping(item.id)
      let mappingValid = false
      let validationResult: MappingValidationResult | null = null

      if (mapping) {
        validationResult = validateMapping(mapping)
        mappingValid = validationResult.valid
      }

      results.push({
        item: { id: item.id, title: item.title, domain: item.domain },
        mapping,
        mappingValid,
        validationResult,
      })
    }

    // Sort: mapped+valid first, then mapped+invalid, then unmapped
    results.sort((a, b) => {
      if (a.mappingValid && !b.mappingValid) return -1
      if (!a.mappingValid && b.mappingValid) return 1
      if (a.mapping && !b.mapping) return -1
      if (!a.mapping && b.mapping) return 1
      return 0
    })

    return results
  } catch {
    return []
  }
}

// ============================================================================
// §5  Helpers
// ============================================================================

/** Extract hostname from an origin string. */
function extractHostname(origin: string): string {
  try {
    return new URL(origin).hostname
  } catch {
    return origin
  }
}

/** Check if two domain strings match (exact or with www prefix). */
function domainsMatch(stored: string, current: string): boolean {
  const a = stored.toLowerCase().replace(/^www\./, '')
  const b = current.toLowerCase().replace(/^www\./, '')
  return a === b
}

// Re-export types and functions needed by other modules
export type { LoginFormMapping, ElementMapping, MappingValidationResult }
export { buildElementMapping, validateMapping, effectiveOrigin }
