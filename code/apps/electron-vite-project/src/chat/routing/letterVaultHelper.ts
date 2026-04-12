/**
 * Letter Composer — vault access helpers (renderer).
 * Uses preload `handshakeView.getVaultStatus` + `vaultRpc` (dashboard:vaultRpc).
 *
 * Note: `vault.listItems` returns metadata only (`fields: []`); callers must use
 * `vault.getItem` for decrypted field payloads (lazy decrypt).
 */

import {
  TIER_LEVEL,
  canAccessRecordType,
  type VaultRecordType,
  type VaultTier,
} from '@shared/vault/vaultCapabilities'
import type { LetterVaultData } from '../../stores/useLetterComposerStore'

/** Legacy listItems filter: maps letter UI category → vault_items.category */
export type LetterVaultListCategory = 'company' | 'identity'

type VaultFieldRow = { key?: string; value?: string; encrypted?: boolean }

function parseVaultTier(raw: string | undefined | null): VaultTier {
  if (!raw || typeof raw !== 'string') return 'unknown'
  const t = raw.trim() as VaultTier
  return t in TIER_LEVEL ? t : 'unknown'
}

function recordTypeForLetterCategory(category: 'company' | 'personal'): VaultRecordType {
  return category === 'company' ? 'company_data' : 'pii_record'
}

/**
 * Build a lowercase key → value map from vault Field[].
 * Skips encrypted fields. Handles dotted keys (uses short segment too).
 */
function vaultFieldsToKeyMap(fields: VaultFieldRow[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(fields)) return out
  for (const f of fields) {
    if (f?.encrypted === true) continue
    const key = typeof f?.key === 'string' ? f.key.trim() : ''
    const value = typeof f?.value === 'string' ? f.value.trim() : ''
    if (!key || !value) continue
    const lower = key.toLowerCase()
    out[lower] = value
    const dot = lower.lastIndexOf('.')
    const short = dot >= 0 ? lower.slice(dot + 1) : lower
    if (!(short in out)) out[short] = value
  }
  return out
}

function assembleStructuredAddress(m: Record<string, string>): string {
  const street = m['street'] || ''
  const streetNumber = m['street_number'] || ''
  const postalCode = m['postal_code'] || ''
  const city = m['city'] || ''
  const state = m['state'] || ''
  const country = m['country'] || ''

  const streetLine = [street, streetNumber].filter(Boolean).join(' ')
  const cityLine = [postalCode, city].filter(Boolean).join(' ')
  const addressParts = [streetLine, cityLine, state, country].filter(Boolean)
  return addressParts.join('\n')
}

/**
 * Map decrypted vault item fields → flat letter payload.
 * For company, pass `itemTitle` from the vault item (`VaultItem.title`).
 */
function mapVaultFieldsToLetterData(
  category: 'company' | 'personal',
  fields: VaultFieldRow[] | undefined,
  itemTitle?: string,
): LetterVaultData {
  const m = vaultFieldsToKeyMap(fields)
  const get = (k: string) => m[k.toLowerCase()] || ''

  if (category === 'company') {
    const ceoFirst = get('ceo_first_name')
    const ceoSurname = get('ceo_surname')
    const ceoName = [ceoFirst, ceoSurname].filter(Boolean).join(' ')
    const fullAddress = assembleStructuredAddress(m)
    const email = get('email')
    const phone = get('phone')
    const companyName = (itemTitle ?? '').trim()

    const out: LetterVaultData = {}
    if (companyName) {
      out.name = companyName
      out.companyName = companyName
    }
    if (fullAddress) out.address = fullAddress
    if (email) out.email = email
    if (phone) out.phone = phone
    if (ceoName) out.signerName = ceoName
    return out
  }

  const firstName = get('first_name')
  const surname = get('surname')
  const fullName = [firstName, surname].filter(Boolean).join(' ')
  const fullAddress = assembleStructuredAddress(m)
  const email = get('email')
  const phone = get('phone')

  const out: LetterVaultData = {}
  if (fullName) {
    out.name = fullName
    out.signerName = fullName
  }
  if (fullAddress) out.address = fullAddress
  if (email) out.email = email
  if (phone) out.phone = phone
  return out
}

function isVaultRpcSuccess(r: Record<string, unknown> | undefined): r is { success: true } & Record<string, unknown> {
  return r != null && r.success === true
}

export async function canAccessLetterVaultCategory(
  category: 'company' | 'personal',
): Promise<{ allowed: boolean; reason?: string }> {
  const status = await window.handshakeView?.getVaultStatus?.()
  if (!status?.isUnlocked) {
    return { allowed: false, reason: 'vault_locked' }
  }

  const tier = parseVaultTier(status.tier)
  const recordType = recordTypeForLetterCategory(category)
  if (!canAccessRecordType(tier, recordType, 'read')) {
    return { allowed: false, reason: 'tier_too_low' }
  }

  return { allowed: true }
}

/** Metadata only — does not call getItem. */
export async function listLetterVaultItems(category: 'company' | 'personal'): Promise<{
  success: boolean
  items?: Array<{ id: string; title: string }>
  error?: string
}> {
  try {
    const access = await canAccessLetterVaultCategory(category)
    if (!access.allowed) {
      return { success: false, error: access.reason }
    }

    const listCategory: LetterVaultListCategory = category === 'company' ? 'company' : 'identity'
    const rpc = window.handshakeView?.vaultRpc
    if (typeof rpc !== 'function') {
      return { success: false, error: 'vault_rpc_unavailable' }
    }

    const listResult = await rpc({
      method: 'vault.listItems',
      params: { category: listCategory, limit: 50 },
    })

    if (!isVaultRpcSuccess(listResult)) {
      const err =
        typeof listResult?.error === 'string'
          ? listResult.error
          : 'vault_list_failed'
      return { success: false, error: err }
    }

    const raw = listResult.items
    if (!Array.isArray(raw) || raw.length === 0) {
      return { success: false, error: 'no_items' }
    }

    const items: Array<{ id: string; title: string }> = []
    for (const row of raw) {
      const o = row as { id?: unknown; title?: unknown }
      const id = typeof o.id === 'string' ? o.id : ''
      const title = typeof o.title === 'string' ? o.title : ''
      if (!id) continue
      items.push({ id, title })
    }

    if (items.length === 0) {
      return { success: false, error: 'no_items' }
    }

    return { success: true, items }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg || 'vault_error' }
  }
}

export async function fetchAndMapVaultItem(
  itemId: string,
  category: 'company' | 'personal',
): Promise<{
  success: boolean
  data?: LetterVaultData
  error?: string
}> {
  try {
    const access = await canAccessLetterVaultCategory(category)
    if (!access.allowed) {
      return { success: false, error: access.reason }
    }

    const rpc = window.handshakeView?.vaultRpc
    if (typeof rpc !== 'function') {
      return { success: false, error: 'vault_rpc_unavailable' }
    }

    const id = itemId.trim()
    if (!id) {
      return { success: false, error: 'no_item_id' }
    }

    const getResult = await rpc({
      method: 'vault.getItem',
      params: { id },
    })

    if (!isVaultRpcSuccess(getResult)) {
      const err =
        typeof getResult?.error === 'string' ? getResult.error : 'vault_get_failed'
      return { success: false, error: err }
    }

    const item = getResult.item as { fields?: VaultFieldRow[]; title?: string } | undefined
    const title =
      typeof item?.title === 'string' ? item.title : ''
    const data = mapVaultFieldsToLetterData(category, item?.fields, title)

    return { success: true, data }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg || 'vault_error' }
  }
}

export async function fetchLetterVaultData(
  category: 'company' | 'personal',
): Promise<{
  success: boolean
  data?: LetterVaultData
  error?: string
}> {
  const listed = await listLetterVaultItems(category)
  if (!listed.success || !listed.items?.length) {
    return { success: false, error: listed.error ?? 'no_items' }
  }
  const firstId = listed.items[0].id
  return fetchAndMapVaultItem(firstId, category)
}
