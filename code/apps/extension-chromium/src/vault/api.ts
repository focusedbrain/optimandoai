/**
 * HTTP API client for vault communication
 * Uses chrome.runtime.sendMessage to relay through background script (bypasses CSP)
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

const API_TIMEOUT = 30000 // 30 seconds

/**
 * Make HTTP API call to vault via background script
 */
// Global log storage for UI debugging
const debugLogs: Array<{time: string, level: string, message: string, data?: any}> = []

function addLog(level: string, message: string, data?: any) {
  const log = {
    time: new Date().toISOString(),
    level,
    message,
    data: data ? JSON.stringify(data, null, 2) : undefined
  }
  debugLogs.push(log)
  console.log(`[VAULT API ${level}]`, message, data || '')
  
  // Store in window for UI access
  if (typeof window !== 'undefined') {
    (window as any).vaultDebugLogs = debugLogs
  }
  
  // Limit log size
  if (debugLogs.length > 100) {
    debugLogs.shift()
  }
}

async function apiCall(endpoint: string, body?: any): Promise<any> {
  addLog('INFO', `Calling ${endpoint}`, body)
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      addLog('ERROR', `Timeout calling ${endpoint}`)
      reject(new Error(`API call timeout after ${API_TIMEOUT}ms`))
    }, API_TIMEOUT)
    
    addLog('INFO', `Sending message to background script`, { type: 'VAULT_HTTP_API', endpoint, body })
    
    // Retry wrapper for service worker suspension issues
    const attemptCall = (retryCount = 0): void => {
      try {
        chrome.runtime.sendMessage(
          {
            type: 'VAULT_HTTP_API',
            endpoint,
            body,
          },
          (response) => {
            clearTimeout(timeout)
            
            // Check for chrome.runtime.lastError first
            if (chrome.runtime.lastError) {
              const errorMsg = chrome.runtime.lastError.message || 'Unknown chrome.runtime error'
              addLog('ERROR', `chrome.runtime.lastError`, { message: errorMsg, endpoint, retryCount })
              
              // Retry if service worker might be suspended (max 2 retries)
              if (retryCount < 2 && (errorMsg.includes('message port closed') || errorMsg.includes('Extension context invalidated'))) {
                addLog('INFO', `Retrying due to service worker issue (attempt ${retryCount + 1})`)
                setTimeout(() => attemptCall(retryCount + 1), 500 * (retryCount + 1))
                return
              }
              
              reject(new Error(`Background script error: ${errorMsg}`))
              return
            }
            
            addLog('INFO', `Received response from background`, response)
            
            if (!response) {
              // Retry if no response (might be service worker suspension)
              if (retryCount < 2) {
                addLog('INFO', `No response, retrying (attempt ${retryCount + 1})`)
                setTimeout(() => attemptCall(retryCount + 1), 500 * (retryCount + 1))
                return
              }
              addLog('ERROR', `No response from background script after retries`, { endpoint })
              reject(new Error('No response from background script - check if background script is running'))
              return
            }
            
            if (!response.success) {
              addLog('ERROR', `API call failed`, { endpoint, error: response.error })
              reject(new Error(response.error || 'API call failed'))
              return
            }
            
            addLog('SUCCESS', `API call succeeded`, { endpoint, data: response.data })
            resolve(response.data)
          }
        )
      } catch (error: any) {
        clearTimeout(timeout)
        addLog('ERROR', `Exception sending message`, { endpoint, error: error.message, stack: error.stack })
        reject(new Error(`Failed to send message: ${error.message}`))
      }
    }
    
    attemptCall()
  })
}

/**
 * Health check - lightweight endpoint to verify server is running
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const result = await apiCall('/health')
    return result?.status === 'ok'
  } catch (error) {
    console.error('[VAULT API] Health check failed:', error)
    return false
  }
}

/**
 * Connect to vault (no-op for HTTP, kept for compatibility)
 */
export function connectVault(): Promise<void> {
  console.log('[VAULT API] Using HTTP API via background script')
  return Promise.resolve()
}

/**
 * Disconnect from vault (no-op for HTTP, kept for compatibility)
 */
export function disconnectVault(): void {
  console.log('[VAULT API] Disconnected')
}

// ==========================================================================
// Vault Management
// ==========================================================================

export async function createVault(masterPassword: string, vaultName: string, vaultId?: string): Promise<{ vaultId: string }> {
  const result = await apiCall('/create', { password: masterPassword, vaultName, vaultId })
  return result.data || { vaultId: result.vaultId }
}

export async function deleteVault(vaultId?: string): Promise<void> {
  await apiCall('/delete', { vaultId })
}

export async function unlockVault(masterPassword: string, vaultId: string = 'default'): Promise<void> {
  await apiCall('/unlock', { password: masterPassword, vaultId })
}

export async function lockVault(): Promise<void> {
  await apiCall('/lock')
}

export async function getVaultStatus(): Promise<VaultStatus> {
  return await apiCall('/status')
}

// ==========================================================================
// Container Operations
// ==========================================================================

export async function createContainer(type: ContainerType, name: string, favorite: boolean = false): Promise<Container> {
  return await apiCall('/container/create', { type, name, favorite })
}

export async function updateContainer(id: string, updates: Partial<Pick<Container, 'name' | 'favorite'>>): Promise<Container> {
  return await apiCall('/container/update', { id, ...updates })
}

export async function deleteContainer(id: string): Promise<void> {
  await apiCall('/container/delete', { id })
}

export async function listContainers(): Promise<Container[]> {
  return await apiCall('/containers')
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
  return await apiCall('/item/create', item)
}

export async function updateItem(id: string, updates: Partial<Pick<VaultItem, 'title' | 'fields' | 'domain' | 'favorite'>>): Promise<VaultItem> {
  return await apiCall('/item/update', { id, updates })
}

export async function deleteItem(id: string): Promise<void> {
  await apiCall('/item/delete', { id })
}

export async function getItem(id: string): Promise<VaultItem> {
  // Not yet implemented in HTTP endpoints, but keeping for API compatibility
  throw new Error('getItem not yet implemented')
}

export async function listItems(filters?: {
  container_id?: string
  category?: ItemCategory
  favorites_only?: boolean
  limit?: number
  offset?: number
}): Promise<VaultItem[]> {
  return await apiCall('/items', filters)
}

export async function searchItems(query: string, category?: ItemCategory): Promise<VaultItem[]> {
  // Not yet implemented in HTTP endpoints, but keeping for API compatibility
  throw new Error('searchItems not yet implemented')
}

export async function getAutofillCandidates(domain: string): Promise<VaultItem[]> {
  // Not yet implemented in HTTP endpoints, but keeping for API compatibility
  throw new Error('getAutofillCandidates not yet implemented')
}

// ==========================================================================
// Settings & Data Management
// ==========================================================================

export async function updateSettings(updates: Partial<VaultSettings>): Promise<VaultSettings> {
  return await apiCall('/settings/update', updates)
}

export async function getSettings(): Promise<VaultSettings> {
  return await apiCall('/settings/get')
}

export async function exportCSV(): Promise<string> {
  // Not yet implemented in HTTP endpoints, but keeping for API compatibility
  throw new Error('exportCSV not yet implemented')
}

export async function importCSV(csvData: string): Promise<void> {
  // Not yet implemented in HTTP endpoints, but keeping for API compatibility
  throw new Error('importCSV not yet implemented')
}
