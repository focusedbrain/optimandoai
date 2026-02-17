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

    // Store submit button selector for reliable auto-submit on future visits
    const submitSelector = detectSubmitButtonSelector()
    if (submitSelector) {
      fields.push({
        key: 'submit_selector',
        value: submitSelector,
        encrypted: false,
        type: 'text' as const,
      })
    }

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
// §5  Domain Remap (Reliable Future Matching)
// ============================================================================

/**
 * Remap a vault item's domain to the given origin.
 *
 * Called when the user manually selects a non-matching entry from the popover.
 * Updates the vault item's domain field so the icon turns green next time
 * on this site, enabling reliable one-click autofill.
 *
 * Also stores the submit button selector if found, so auto-submit works
 * reliably on future visits (even if the site's UI changes).
 */
export async function remapItemDomain(
  itemId: string,
  newOrigin: string,
  submitSelector?: string,
): Promise<void> {
  try {
    const item = await vaultAPI.getItem(itemId)

    // Build the update payload
    const updates: { domain: string; fields: Field[] } = {
      domain: normalizeToOrigin(newOrigin),
      fields: [...item.fields],
    }

    // Add/update the alternate_url field to store original + new domain
    const existingAltUrls = item.fields.find(f => f.key === 'alternate_urls')
    const altUrls: string[] = existingAltUrls?.value
      ? JSON.parse(existingAltUrls.value)
      : []

    // Preserve the old domain as an alternate if it's different
    if (item.domain && item.domain !== updates.domain) {
      if (!altUrls.includes(item.domain)) {
        altUrls.push(item.domain)
      }
    }

    // Add the new origin if not already present
    if (!altUrls.includes(updates.domain)) {
      altUrls.push(updates.domain)
    }

    if (existingAltUrls) {
      updates.fields = updates.fields.map(f =>
        f.key === 'alternate_urls'
          ? { ...f, value: JSON.stringify(altUrls) }
          : f
      )
    } else {
      updates.fields.push({
        key: 'alternate_urls',
        value: JSON.stringify(altUrls),
        encrypted: false,
        type: 'text' as const,
      })
    }

    // Store submit button selector for reliable auto-submit
    if (submitSelector) {
      const existingSelector = updates.fields.find(f => f.key === 'submit_selector')
      if (existingSelector) {
        updates.fields = updates.fields.map(f =>
          f.key === 'submit_selector'
            ? { ...f, value: submitSelector }
            : f
        )
      } else {
        updates.fields.push({
          key: 'submit_selector',
          value: submitSelector,
          encrypted: false,
          type: 'text' as const,
        })
      }
    }

    await vaultAPI.updateItem(itemId, updates)
    console.log('[CRED-STORE] Domain remapped:', itemId, '→', updates.domain)
  } catch (err) {
    console.error('[CRED-STORE] Error remapping domain:', err)
    throw err
  }
}

/**
 * Check if any vault items match the current domain.
 *
 * Returns matching items sorted by relevance (exact match first, then
 * alternate_urls matches).
 */
export async function findMatchingItemsForDomain(
  domain: string,
): Promise<VaultItem[]> {
  try {
    const items = await vaultAPI.listItems({ category: 'password' })
    const matches: VaultItem[] = []

    // First pass: check primary domain (available on list items)
    const unmatched: VaultItem[] = []
    for (const item of items) {
      if (domainMatches(item.domain, domain)) {
        matches.push(item)
      } else {
        unmatched.push(item)
      }
    }

    // Second pass: for unmatched items, fetch full data to check
    // alternate_urls (listItems returns empty fields[] for security).
    // Only fetch if there are unmatched items to avoid unnecessary API calls.
    if (unmatched.length > 0) {
      const fullItemChecks = unmatched.map(async (item) => {
        try {
          const fullItem = await vaultAPI.getItem(item.id)
          const altUrlsField = fullItem.fields.find(f => f.key === 'alternate_urls')
          if (altUrlsField?.value) {
            const altUrls: string[] = JSON.parse(altUrlsField.value)
            if (altUrls.some(url => domainMatches(url, domain))) {
              matches.push(fullItem)
            }
          }
        } catch {
          // Skip items that can't be fetched
        }
      })
      await Promise.all(fullItemChecks)
    }

    return matches
  } catch {
    return []
  }
}

// ============================================================================
// §6  Helpers
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

/**
 * Detect the submit button on the current page and return a CSS selector for it.
 *
 * Tries to build a unique, resilient selector by using (in order):
 *   1. button[type="submit"] or input[type="submit"] within a form with a password field
 *   2. First visible button near a password field matching login/signup patterns
 *
 * Returns null if no suitable button is found.
 */
export function detectSubmitButtonSelector(): string | null {
  // Find forms with password fields
  const passwordFields = document.querySelectorAll<HTMLInputElement>('input[type="password"]')
  for (const pwField of passwordFields) {
    const form = pwField.closest('form')
    if (!form) continue

    // Try explicit submit
    const explicit = form.querySelector<HTMLElement>('input[type="submit"], button[type="submit"]')
    if (explicit) return buildSelector(explicit)

    // Try default button
    const buttons = form.querySelectorAll<HTMLButtonElement>('button')
    for (const btn of buttons) {
      const t = btn.type.toLowerCase()
      if (t === '' || t === 'submit') return buildSelector(btn)
    }
  }

  // Fallback: look for common login/signup buttons on page
  const buttonPatterns = [
    /log\s*in/i, /sign\s*in/i, /anmeld/i, /einloggen/i,
    /submit/i, /sign\s*up/i, /register/i, /registrier/i,
  ]

  const allButtons = document.querySelectorAll<HTMLElement>('button, input[type="submit"]')
  for (const btn of allButtons) {
    const text = (btn.textContent || (btn as HTMLInputElement).value || '').trim()
    for (const pattern of buttonPatterns) {
      if (pattern.test(text)) return buildSelector(btn)
    }
  }

  return null
}

/**
 * Build a CSS selector for a given element.
 * Tries to generate a unique, stable selector.
 */
function buildSelector(el: HTMLElement): string {
  // If it has an ID, use it
  if (el.id) return `#${CSS.escape(el.id)}`

  // Build a selector from tag + attributes
  const tag = el.tagName.toLowerCase()
  const type = el.getAttribute('type')
  const name = el.getAttribute('name')

  let selector = tag
  if (type) selector += `[type="${CSS.escape(type)}"]`
  if (name) selector += `[name="${CSS.escape(name)}"]`

  // If unique, return as-is
  if (document.querySelectorAll(selector).length === 1) return selector

  // Add text content as additional discriminator via :nth-of-type
  const parent = el.parentElement
  if (parent) {
    const siblings = parent.querySelectorAll<HTMLElement>(selector)
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i] === el) {
        return `${buildSelector(parent)} > ${selector}:nth-of-type(${i + 1})`
      }
    }
  }

  return selector
}
