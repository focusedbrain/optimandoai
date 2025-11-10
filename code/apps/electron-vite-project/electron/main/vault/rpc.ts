/**
 * RPC handlers for vault WebSocket communication
 * Validates requests with Zod schemas and calls VaultService
 */

import { vaultService } from './service'

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
 * Handle vault RPC calls from WebSocket
 * Returns response object with success/error
 */
export async function handleVaultRPC(method: string, params: any): Promise<any> {
  try {
    console.log(`[VAULT RPC] ${method}`, params ? '(with params)' : '')

    switch (method) {
      // ==============================================
      // Vault Management
      // ==============================================

      case 'vault.create': {
        const parsed = CreateVaultRequestSchema.parse(params)
        const vaultId = await vaultService.createVault(parsed.masterPassword, parsed.vaultName || 'My Vault', parsed.vaultId)
        return { success: true, message: 'Vault created successfully', vaultId }
      }

      case 'vault.unlock': {
        const parsed = UnlockVaultRequestSchema.parse(params)
        const token = await vaultService.unlock(parsed.masterPassword, parsed.vaultId || 'default')
        return { success: true, token }
      }

      case 'vault.lock': {
        vaultService.lock()
        return { success: true, message: 'Vault locked' }
      }

      case 'vault.getStatus': {
        const status = vaultService.getStatus()
        return { success: true, status }
      }

      // ==============================================
      // Container Operations
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
      // Item Operations
      // ==============================================

      case 'vault.createItem': {
        const data = CreateItemSchema.parse(params)
        const item = await vaultService.createItem(data)
        return { success: true, item }
      }

      case 'vault.updateItem': {
        const { id, ...updates } = UpdateItemSchema.parse(params)
        const item = await vaultService.updateItem(id, updates)
        return { success: true, item }
      }

      case 'vault.deleteItem': {
        const { id } = DeleteItemRequestSchema.parse(params)
        vaultService.deleteItem(id)
        return { success: true, message: 'Item deleted' }
      }

      case 'vault.getItem': {
        const { id } = GetItemRequestSchema.parse(params)
        const item = await vaultService.getItem(id)
        return { success: true, item }
      }

      case 'vault.listItems': {
        const filters = ListItemsRequestSchema.parse(params || {})
        const items = vaultService.listItems(filters)
        return { success: true, items }
      }

      case 'vault.search': {
        const { query, category } = SearchRequestSchema.parse(params)
        const items = vaultService.search(query, category)
        return { success: true, items }
      }

      case 'vault.getAutofillCandidates': {
        const { domain } = GetAutofillCandidatesRequestSchema.parse(params)
        const items = await vaultService.getAutofillCandidates(domain)
        return { success: true, items }
      }

      // ==============================================
      // Settings & Data Management
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
        const csv = vaultService.exportCSV()
        return { success: true, csv }
      }

      case 'vault.importCSV': {
        const { csvData } = ImportCSVRequestSchema.parse(params)
        vaultService.importCSV(csvData)
        return { success: true, message: 'CSV imported successfully' }
      }

      default:
        return { success: false, error: `Unknown method: ${method}` }
    }
  } catch (error: any) {
    console.error(`[VAULT RPC] Error in ${method}:`, error)
    console.error(`[VAULT RPC] Error type:`, typeof error)
    console.error(`[VAULT RPC] Error message:`, error?.message)
    console.error(`[VAULT RPC] Error stack:`, error?.stack)
    console.error(`[VAULT RPC] Error stringified:`, JSON.stringify(error, Object.getOwnPropertyNames(error)))
    return {
      success: false,
      error: error?.message || error?.toString() || 'Unknown error occurred',
    }
  }
}
