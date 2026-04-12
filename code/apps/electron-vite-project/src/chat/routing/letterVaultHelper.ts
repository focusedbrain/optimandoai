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

function parseVaultTier(raw: string | undefined | null): VaultTier {
  if (!raw || typeof raw !== 'string') return 'unknown'
  const t = raw.trim() as VaultTier
  return t in TIER_LEVEL ? t : 'unknown'
}

function recordTypeForLetterCategory(category: 'company' | 'personal'): VaultRecordType {
  return category === 'company' ? 'company_data' : 'pii_record'
}

/** Build a lowercase key map from vault Field[] (handles keys like `identity.full_name`). */
function vaultFieldsToKeyMap(
  fields: Array<{ key?: string; value?: string }> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(fields)) return out
  for (const f of fields) {
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

function firstNonEmpty(m: Record<string, string>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = m[k.toLowerCase()]
    if (v) return v
  }
  return undefined
}

/**
 * Map decrypted vault item fields → flat letter payload.
 * TODO: verify field keys against vault create forms / migrations for company vs identity.
 */
function mapVaultFieldsToLetterData(
  category: 'company' | 'personal',
  fields: Array<{ key?: string; value?: string }> | undefined,
): LetterVaultData {
  const m = vaultFieldsToKeyMap(fields)

  if (category === 'company') {
    return {
      // TODO: verify — company items may use company_name, legal_name, firma, etc.
      companyName: firstNonEmpty(m, ['company_name', 'company', 'legal_name', 'firma', 'organization']),
      name: firstNonEmpty(m, ['ceo_name', 'contact_name', 'representative', 'signer_name']),
      address: firstNonEmpty(m, [
        'address',
        'street',
        'address_line_1',
        'business_address',
        'company_address',
 ]),
      email: firstNonEmpty(m, ['email', 'contact_email', 'company_email', 'e_mail']),
      phone: firstNonEmpty(m, ['phone', 'telephone', 'company_phone', 'mobile']),
      signerName: firstNonEmpty(m, ['signer_name', 'authorized_signer', 'ceo_name', 'representative']),
    }
  }

  return {
    // TODO: verify — identity / Private Data may use full_name, first_name+last_name, etc.
    name: firstNonEmpty(m, ['full_name', 'name', 'display_name', 'first_name']),
    address: firstNonEmpty(m, ['address', 'street', 'address_line_1', 'home_address']),
    email: firstNonEmpty(m, ['email', 'personal_email', 'e_mail']),
    phone: firstNonEmpty(m, ['phone', 'mobile', 'telephone']),
    signerName: firstNonEmpty(m, ['signer_name']),
    companyName: firstNonEmpty(m, ['company_name', 'employer']),
  }
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

export async function fetchLetterVaultData(
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

    const items = listResult.items
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false, error: 'no_items' }
    }

    const first = items[0] as { id?: string }
    const id = typeof first?.id === 'string' ? first.id : ''
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

    const item = getResult.item as { fields?: Array<{ key?: string; value?: string }> } | undefined
    const data = mapVaultFieldsToLetterData(category, item?.fields)

    return { success: true, data }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg || 'vault_error' }
  }
}
