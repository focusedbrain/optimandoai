/**
 * RPC handlers for vault WebSocket communication
 * Validates requests with Zod schemas and calls VaultService
 *
 * SECURITY: Every data-touching method receives a resolved `tier` from
 * the caller (WebSocket handler in main.ts).  The tier is derived from
 * the JWT session per-request — never from the client payload.
 */

import { vaultService } from './service'
import type { VaultTier } from './types'

// Export vaultService for HTTP API handlers
export { vaultService }
import {
  CreateVaultRequestSchema,
  UnlockVaultRequestSchema,
  CreateContainerSchema,
  UpdateContainerSchema,
  DeleteContainerRequestSchema,
  CreateItemSchema,
  UpdateItemSchema,
  GetItemRequestSchema,
  ListItemsRequestSchema,
  DeleteItemRequestSchema,
  SearchRequestSchema,
  GetAutofillCandidatesRequestSchema,
  UpdateSettingsRequestSchema,
  ImportCSVRequestSchema,
  ActivateHARequestSchema,
  DeactivateHARequestSchema,
  LockHARequestSchema,
  UnlockHARequestSchema,
} from './schemas'
import {
  activateHA,
  deactivateHA,
  lockHA,
  unlockHA,
  isHAActive,
  haAllowsIPC,
  DEFAULT_HA_STATE,
  INITIAL_HA_STATE_OFF,
  type HAModeState,
} from '../../../../../packages/shared/src/vault/haMode'

// ── HA Mode server-side state ──
// Stored in vault settings; loaded on unlock, persisted on change.
let _haState: HAModeState = { ...INITIAL_HA_STATE_OFF }

/** Get the current HA state (for broadcasting to extension). */
export function getHAState(): Readonly<HAModeState> { return _haState }

/** Load HA state from vault settings (called on vault unlock). */
export function loadHAState(settings: any): void {
  if (settings?.haMode && typeof settings.haMode === 'object' && typeof settings.haMode.state === 'string') {
    _haState = settings.haMode as HAModeState
  } else {
    // Missing HA field in existing vault → fail-closed (active)
    _haState = { ...DEFAULT_HA_STATE }
  }
  console.log(`[VAULT RPC] HA Mode loaded: state=${_haState.state}`)
}

/** Persist HA state to vault settings. */
function persistHAState(): void {
  try {
    const settings = vaultService.getSettings()
    vaultService.updateSettings({ ...settings, haMode: _haState } as any)
  } catch (err) {
    console.error('[VAULT RPC] Failed to persist HA state')
  }
}

/**
 * Handle vault RPC calls from WebSocket.
 *
 * @param method  RPC method name (e.g. 'vault.getItem')
 * @param params  Client-supplied parameters (validated via Zod)
 * @param tier    Server-resolved subscription tier (REQUIRED for data ops)
 */
export async function handleVaultRPC(method: string, params: any, tier: VaultTier): Promise<any> {
  try {
    console.log(`[VAULT RPC] ${method} (tier=${tier})`, params ? '(with params)' : '')

    // ── HA IPC restriction ──
    // When HA is active, only allowlisted methods may be invoked.
    if (isHAActive(_haState) && !haAllowsIPC(_haState, method) && !method.startsWith('ha.')) {
      console.log(`[VAULT RPC] HA Mode blocked method: ${method}`)
      return { success: false, error: `HA Mode: method "${method}" is not permitted` }
    }

    switch (method) {
      // ==============================================
      // Vault Management (no tier-gated data access)
      // ==============================================

      case 'vault.create': {
        const parsed = CreateVaultRequestSchema.parse(params)
        const vaultId = await vaultService.createVault(parsed.masterPassword, parsed.vaultName || 'My Vault', parsed.vaultId)
        return { success: true, message: 'Vault created successfully', vaultId, sessionToken: vaultService.getSessionToken() }
      }

      case 'vault.unlock': {
        const parsed = UnlockVaultRequestSchema.parse(params)
        const token = await vaultService.unlock(parsed.masterPassword, parsed.vaultId || 'default')
        return { success: true, token, sessionToken: vaultService.getSessionToken() }
      }

      case 'vault.lock': {
        vaultService.lock()
        return { success: true, message: 'Vault locked' }
      }

      case 'vault.getStatus': {
        const status = vaultService.getStatus()
        const sessionToken = status.isUnlocked ? vaultService.getSessionToken() : null
        return { success: true, status: { ...status, tier }, ...(sessionToken ? { sessionToken } : {}) }
      }

      // ==============================================
      // Container Operations (no per-record capability)
      // ==============================================

      case 'vault.createContainer': {
        const data = CreateContainerSchema.parse(params)
        const container = vaultService.createContainer(data.type, data.name, data.favorite)
        return { success: true, container }
      }

      case 'vault.updateContainer': {
        const { id, ...updates } = UpdateContainerSchema.parse(params)
        const container = vaultService.updateContainer(id, updates)
        return { success: true, container }
      }

      case 'vault.deleteContainer': {
        const { id } = DeleteContainerRequestSchema.parse(params)
        vaultService.deleteContainer(id)
        return { success: true, message: 'Container deleted' }
      }

      case 'vault.listContainers': {
        const containers = vaultService.listContainers()
        return { success: true, containers }
      }

      // ==============================================
      // Item Operations — tier passed to every call
      // ==============================================

      case 'vault.createItem': {
        const data = CreateItemSchema.parse(params)
        const item = await vaultService.createItem(data, tier)
        return { success: true, item }
      }

      case 'vault.updateItem': {
        const { id, ...updates } = UpdateItemSchema.parse(params)
        const item = await vaultService.updateItem(id, updates, tier)
        return { success: true, item }
      }

      case 'vault.deleteItem': {
        const { id } = DeleteItemRequestSchema.parse(params)
        vaultService.deleteItem(id, tier)
        return { success: true, message: 'Item deleted' }
      }

      case 'vault.getItem': {
        const { id } = GetItemRequestSchema.parse(params)
        const item = await vaultService.getItem(id, tier)
        return { success: true, item }
      }

      case 'vault.listItems': {
        const filters = ListItemsRequestSchema.parse(params || {})
        const items = await vaultService.listItems(filters, tier)
        return { success: true, items }
      }

      case 'vault.search': {
        const { query, category } = SearchRequestSchema.parse(params)
        const items = vaultService.search(query, category, tier)
        return { success: true, items }
      }

      case 'vault.getAutofillCandidates': {
        const { domain } = GetAutofillCandidatesRequestSchema.parse(params)
        const items = await vaultService.getAutofillCandidates(domain, tier)
        return { success: true, items }
      }

      // ==============================================
      // Settings & Data Management — tier-gated
      // ==============================================

      case 'vault.updateSettings': {
        const updates = UpdateSettingsRequestSchema.parse(params)
        const settings = vaultService.updateSettings(updates)
        return { success: true, settings }
      }

      case 'vault.getSettings': {
        const settings = vaultService.getSettings()
        return { success: true, settings }
      }

      case 'vault.exportCSV': {
        const csv = await vaultService.exportCSV(tier)
        return { success: true, csv }
      }

      case 'vault.importCSV': {
        const { csvData } = ImportCSVRequestSchema.parse(params)
        vaultService.importCSV(csvData, tier)
        return { success: true, message: 'CSV imported successfully' }
      }

      // ==============================================
      // High Assurance Mode
      // ==============================================

      case 'ha.getState': {
        return { success: true, haState: _haState }
      }

      case 'ha.activate': {
        const { activatedBy } = ActivateHARequestSchema.parse(params)
        const result = activateHA(_haState, activatedBy)
        if (result.success) {
          _haState = result.newState
          persistHAState()
          console.log(`[VAULT RPC] HA Mode activated by ${activatedBy}`)
        }
        return { success: result.success, haState: result.newState, error: result.error }
      }

      case 'ha.deactivate': {
        const { confirmPhrase } = DeactivateHARequestSchema.parse(params)
        const result = deactivateHA(_haState, confirmPhrase)
        if (result.success) {
          _haState = result.newState
          persistHAState()
          console.log('[VAULT RPC] HA Mode deactivated')
        }
        return { success: result.success, haState: result.newState, error: result.error }
      }

      case 'ha.lock': {
        const { lockCodeHash } = LockHARequestSchema.parse(params)
        const result = lockHA(_haState, lockCodeHash)
        if (result.success) {
          _haState = result.newState
          persistHAState()
          console.log('[VAULT RPC] HA Mode locked by administrator')
        }
        return { success: result.success, haState: result.newState, error: result.error }
      }

      case 'ha.unlock': {
        const { codeHash } = UnlockHARequestSchema.parse(params)
        const result = unlockHA(_haState, codeHash)
        _haState = result.newState // Always update (tracks failed attempts)
        persistHAState()
        if (result.success) {
          console.log('[VAULT RPC] HA Mode unlocked')
        } else {
          console.log(`[VAULT RPC] HA Mode unlock failed: ${result.error}`)
        }
        return { success: result.success, haState: result.newState, error: result.error }
      }

      default:
        return { success: false, error: `Unknown method: ${method}` }
    }
  } catch (error: any) {
    console.error(`[VAULT RPC] Error in ${method}:`, error)
    console.error(`[VAULT RPC] Error message:`, error?.message)
    return {
      success: false,
      error: error?.message || error?.toString() || 'Unknown error occurred',
    }
  }
}
