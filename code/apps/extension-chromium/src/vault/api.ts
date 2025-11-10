/**
 * WebSocket RPC client for vault communication
 * Uses chrome.runtime messaging to communicate through background script
 * (Content scripts can't directly open WebSockets due to CSP restrictions)
 */

import type {
  Container,
  ContainerType,
  VaultItem,
  ItemCategory,
  Field,
  VaultStatus,
  VaultSettings,
} from './types'

const RPC_TIMEOUT = 30000 // 30 seconds

let pendingCalls = new Map<string, { resolve: (value: any) => void; reject: (error: any) => void; timer: number }>()

/**
 * Connect to vault through background script
 */
export function connectVault(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('[VAULT API] Using chrome.runtime messaging (background script WebSocket)')
    // No actual connection needed - background script manages WebSocket
    resolve()
  })
}

/**
 * Call RPC method through background script
 */
function rpcCall(method: string, params?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}_${Math.random().toString(36).substring(7)}`
    const message = {
      id,
      method,
      params: params || {},
    }

    console.log('[VAULT API] RPC call via background:', method, params)

    // Set timeout
    const timer = window.setTimeout(() => {
      pendingCalls.delete(id)
      reject(new Error(`RPC timeout: ${method}`))
    }, RPC_TIMEOUT)

    pendingCalls.set(id, { resolve, reject, timer })

    // Send to background script which will forward to WebSocket
    chrome.runtime.sendMessage({ 
      type: 'VAULT_RPC',
      id,
      method,
      params 
    }, (response) => {
      if (chrome.runtime.lastError) {
        const { resolve: res, reject: rej, timer: t } = pendingCalls.get(id) || {}
        if (t) clearTimeout(t)
        pendingCalls.delete(id)
        rej?.(new Error(chrome.runtime.lastError.message))
        return
      }

      const { resolve: res, reject: rej, timer: t } = pendingCalls.get(id) || {}
      if (!res || !rej) return // Already resolved/rejected
      
      clearTimeout(t)
      pendingCalls.delete(id)

      if (response && response.success) {
        res(response)
      } else {
        rej(new Error(response?.error || 'Unknown error'))
      }
    })
  })
}

/**
 * Disconnect from vault
 */
export function disconnectVault(): void {
  // Clear pending calls
  pendingCalls.clear()
  console.log('[VAULT API] Disconnected')
}

// ==========================================================================
// Vault Management
// ==========================================================================

export async function createVault(masterPassword: string): Promise<void> {
  await rpcCall('vault.create', { masterPassword })
}

export async function unlockVault(masterPassword: string): Promise<string> {
  const response = await rpcCall('vault.unlock', { masterPassword })
  return response.token
}

export async function lockVault(): Promise<void> {
  await rpcCall('vault.lock')
}

export async function getVaultStatus(): Promise<VaultStatus> {
  const response = await rpcCall('vault.getStatus')
  return response.status
}

// ==========================================================================
// Container Operations
// ==========================================================================

export async function createContainer(type: ContainerType, name: string, favorite: boolean = false): Promise<Container> {
  const response = await rpcCall('vault.createContainer', { type, name, favorite })
  return response.container
}

export async function updateContainer(id: string, updates: Partial<Pick<Container, 'name' | 'favorite'>>): Promise<Container> {
  const response = await rpcCall('vault.updateContainer', { id, ...updates })
  return response.container
}

export async function deleteContainer(id: string): Promise<void> {
  await rpcCall('vault.deleteContainer', { id })
}

export async function listContainers(): Promise<Container[]> {
  const response = await rpcCall('vault.listContainers')
  return response.containers
}

// ==========================================================================
// Item Operations
// ==========================================================================

export async function createItem(item: {
  container_id?: string
  category: ItemCategory
  title: string
  fields: Field[]
  domain?: string
  favorite?: boolean
}): Promise<VaultItem> {
  const response = await rpcCall('vault.createItem', item)
  return response.item
}

export async function updateItem(id: string, updates: Partial<Pick<VaultItem, 'title' | 'fields' | 'domain' | 'favorite'>>): Promise<VaultItem> {
  const response = await rpcCall('vault.updateItem', { id, ...updates })
  return response.item
}

export async function deleteItem(id: string): Promise<void> {
  await rpcCall('vault.deleteItem', { id })
}

export async function getItem(id: string): Promise<VaultItem> {
  const response = await rpcCall('vault.getItem', { id })
  return response.item
}

export async function listItems(filters?: {
  container_id?: string
  category?: ItemCategory
  favorites_only?: boolean
  limit?: number
  offset?: number
}): Promise<VaultItem[]> {
  const response = await rpcCall('vault.listItems', filters)
  return response.items
}

export async function searchItems(query: string, category?: ItemCategory): Promise<VaultItem[]> {
  const response = await rpcCall('vault.search', { query, category })
  return response.items
}

export async function getAutofillCandidates(domain: string): Promise<VaultItem[]> {
  const response = await rpcCall('vault.getAutofillCandidates', { domain })
  return response.items
}

// ==========================================================================
// Settings & Data Management
// ==========================================================================

export async function updateSettings(updates: Partial<VaultSettings>): Promise<VaultSettings> {
  const response = await rpcCall('vault.updateSettings', updates)
  return response.settings
}

export async function getSettings(): Promise<VaultSettings> {
  const response = await rpcCall('vault.getSettings')
  return response.settings
}

export async function exportCSV(): Promise<string> {
  const response = await rpcCall('vault.exportCSV')
  return response.csv
}

export async function importCSV(csvData: string): Promise<void> {
  await rpcCall('vault.importCSV', { csvData })
}

