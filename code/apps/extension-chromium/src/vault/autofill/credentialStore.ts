// ============================================================================
// WRVault Autofill — Credential Store (Vault Handoff + Duplicate Detection)
// ============================================================================
//
// Bridges the save-password UI with the vault API.
//
// Responsibilities:
//   1. Check for existing credentials (by domain + username)
//   2. Create new vault items
//   3. Update existing vault items (password change)
//   4. Manage "never save" domain blocklist
//
// All vault operations go through the extension's HTTP API client
// (api.ts → background → Electron HTTP → vault service), ensuring
// VSBT authentication and encryption at rest.
//
// ============================================================================

import * as vaultAPI from '../api'
import type { VaultItem, Field } from '../types'
import type { ExtractedCredentials } from '../../../../../packages/shared/src/vault/insertionPipeline'
import type { ExistingMatch, SaveDecision } from './saveBar'
import { matchOrigin, normalizeToOrigin } from '../../../../../packages/shared/src/vault/originPolicy'

// ============================================================================
// §1  Constants
// ============================================================================

/** chrome.storage.local key for the "never save" domain blocklist. */
const NEVER_SAVE_KEY = 'wrv_never_save_domains'

/** Maximum number of domains in the blocklist (prevent unbounded growth). */
const MAX_NEVER_SAVE_DOMAINS = 500

// ============================================================================
// §2  Duplicate Detection
// ============================================================================

/**
 * Find existing vault items that match the given domain + username.
 *
 * Strategy:
 *   1. List all items in the 'password' category
 *   2. Filter by domain match (exact hostname or subdomain)
 *   3. Filter by username match (case-insensitive)
 *
 * Returns matches sorted by most-recently-updated first.
 */
export async function findExistingCredentials(
  domain: string,
  username: string,
): Promise<ExistingMatch[]> {
  try {
    const items = await vaultAPI.listItems({ category: 'password' })
    const matches: ExistingMatch[] = []

    for (const item of items) {
      // Domain match: item.domain matches the current domain
      if (!domainMatches(item.domain, domain)) continue

      // Extract username from the item's fields
      const itemUsername = extractFieldValue(item.fields, ['username', 'email', 'user', 'login'])

      // Username match: at least one of these conditions
      // 1. Exact match (case-insensitive)
      // 2. Item has no username (legacy entry — still counts as domain match)
      // 3. User is empty (we matched on domain only)
      const usernameMatch =
        !username ||
        !itemUsername ||
        itemUsername.toLowerCase() === username.toLowerCase()

      if (usernameMatch) {
        matches.push({
          itemId: item.id,
          title: item.title,
          username: itemUsername,
          domain: item.domain,
        })
      }
    }

    // Sort by most recently updated
    matches.sort((a, b) => {
      const itemA = items.find(i => i.id === a.itemId)
      const itemB = items.find(i => i.id === b.itemId)
      return (itemB?.updated_at ?? 0) - (itemA?.updated_at ?? 0)
    })

    return matches
  } catch (err) {
    console.error('[CRED-STORE] Error finding existing credentials:', err)
    return []
  }
}

// ============================================================================
// §3  Save / Update
// ============================================================================

/** Result of a credential save/update operation. */
export interface CredentialSaveResult {
  success: boolean
  itemId?: string
  action: 'created' | 'updated' | 'cancelled' | 'blocked' | 'error'
  error?: string
}

/**
 * Execute the save decision from the save-bar dialog.
 *
 * Handles:
 *   - 'save'   → create new vault item
 *   - 'update' → update existing vault item's password/username
 *   - 'cancel' → no-op
 *   - 'never'  → add domain to blocklist
 *   - 'timeout' → no-op
 */
export async function executeCredentialSave(
  decision: SaveDecision,
  credentials: ExtractedCredentials,
): Promise<CredentialSaveResult> {
  switch (decision.action) {
    case 'save':
      return await createCredential(
        decision.title,
        decision.username,
        decision.password,
        credentials.domain,
      )

    case 'update':
      return await updateCredential(
        decision.itemId,
        decision.title,
        decision.username,
        decision.password,
      )

    case 'never':
      await addToNeverSaveList(credentials.domain)
      return { success: true, action: 'blocked' }

    case 'cancel':
    case 'timeout':
      return { success: true, action: 'cancelled' }

    default:
      return { success: true, action: 'cancelled' }
  }
}

/**
 * Create a new password item in the vault.
 */
async function createCredential(
  title: string,
  username: string,
  password: string,
  domain: string,
): Promise<CredentialSaveResult> {
  try {
    // Store the canonical origin (scheme://host[:port]) instead of bare hostname.
    // This ensures strict origin binding for future autofill matching.
    const origin = normalizeToOrigin(domain)

    const fields: Field[] = [
      { key: 'username', value: username, encrypted: false, type: 'text' },
      { key: 'password', value: password, encrypted: true, type: 'password' },
      { key: 'url', value: origin, encrypted: false, type: 'url' },
    ]

    const item = await vaultAPI.createItem({
      category: 'password',
      title,
      fields,
      domain: origin,
      favorite: false,
    })

    console.log('[CRED-STORE] Created credential:', item.id, 'for', domain)
    return { success: true, itemId: item.id, action: 'created' }
  } catch (err: any) {
    console.error('[CRED-STORE] Error creating credential:', err)
    return { success: false, action: 'error', error: err.message || String(err) }
  }
}

/**
 * Update an existing vault item's password (and optionally username/title).
 */
async function updateCredential(
  itemId: string,
  title: string,
  username: string,
  password: string,
): Promise<CredentialSaveResult> {
  try {
    // Fetch current item to preserve other fields
    const existing = await vaultAPI.getItem(itemId)

    // Build updated fields
    const updatedFields = existing.fields.map((f: Field) => {
      if (f.key === 'password') return { ...f, value: password }
      if (f.key === 'username' || f.key === 'email' || f.key === 'user') {
        return { ...f, value: username }
      }
      return f
    })

    // Ensure username field exists (legacy items may not have one)
    const hasUsername = updatedFields.some(f =>
      f.key === 'username' || f.key === 'email' || f.key === 'user',
    )
    if (!hasUsername && username) {
      updatedFields.unshift({
        key: 'username',
        value: username,
        encrypted: false,
        type: 'text' as const,
      })
    }

    await vaultAPI.updateItem(itemId, {
      title,
      fields: updatedFields,
    })

    console.log('[CRED-STORE] Updated credential:', itemId)
    return { success: true, itemId, action: 'updated' }
  } catch (err: any) {
    console.error('[CRED-STORE] Error updating credential:', err)
    return { success: false, action: 'error', error: err.message || String(err) }
  }
}

// ============================================================================
// §4  "Never Save" Domain Blocklist
// ============================================================================

/**
 * Check if a domain is in the "never save" blocklist.
 */
export async function isNeverSaveDomain(domain: string): Promise<boolean> {
  const list = await getNeverSaveList()
  return list.includes(domain.toLowerCase())
}

/**
 * Add a domain to the "never save" blocklist.
 */
export async function addToNeverSaveList(domain: string): Promise<void> {
  const list = await getNeverSaveList()
  const normalized = domain.toLowerCase()
  if (list.includes(normalized)) return

  list.push(normalized)

  // Cap the list size
  while (list.length > MAX_NEVER_SAVE_DOMAINS) {
    list.shift()
  }

  await writeNeverSaveList(list)
  console.log('[CRED-STORE] Added to never-save list:', domain)
}

/**
 * Remove a domain from the "never save" blocklist.
 */
export async function removeFromNeverSaveList(domain: string): Promise<void> {
  const list = await getNeverSaveList()
  const normalized = domain.toLowerCase()
  const filtered = list.filter(d => d !== normalized)
  await writeNeverSaveList(filtered)
}

/** Read the blocklist from chrome.storage.local. */
async function getNeverSaveList(): Promise<string[]> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve([])
      return
    }
    chrome.storage.local.get(NEVER_SAVE_KEY, (result) => {
      resolve(Array.isArray(result[NEVER_SAVE_KEY]) ? result[NEVER_SAVE_KEY] : [])
    })
  })
}

/** Write the blocklist to chrome.storage.local. */
async function writeNeverSaveList(list: string[]): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve()
      return
    }
    chrome.storage.local.set({ [NEVER_SAVE_KEY]: list }, () => resolve())
  })
}

// ============================================================================
// §5  Helpers
// ============================================================================

/**
 * Strict origin match for credential deduplication.
 *
 * Only matches if the stored origin is the exact same origin (or www-equivalent)
 * as the current page.  No wildcard subdomain matching — prevents cross-site
 * credential leakage.
 *
 * Accepts legacy formats (bare hostnames, URLs with paths) via `matchOrigin`
 * which normalizes them before comparison.
 */
function domainMatches(stored: string | undefined, current: string): boolean {
  if (!stored) return false
  const result = matchOrigin(stored, current, {
    subdomainPolicy: 'exact',
    allowInsecureSchemeUpgrade: true, // legacy items may store hostname without scheme
  })
  return result.matches
}

/**
 * Extract a field value from a list of fields by trying multiple key names.
 */
function extractFieldValue(fields: Field[], keys: string[]): string {
  for (const key of keys) {
    const field = fields.find(f => f.key.toLowerCase() === key.toLowerCase())
    if (field?.value) return field.value
  }
  return ''
}
