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
} from './schemas'

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
        return { success: true, status: { ...status, tier } }
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
