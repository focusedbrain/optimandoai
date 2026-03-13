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
  HandshakeBindingPolicy,
  HandshakeTarget,
  AttachEvalResult,
  VaultTier,
} from './types'
import { canAccessRecordType } from './types'

const API_TIMEOUT = 30000 // 30 seconds

// ---------------------------------------------------------------------------
// Vault Session Binding Token (VSBT)
// ---------------------------------------------------------------------------
// In-memory only.  Set on unlock/create, cleared on lock/logout.
// Passed to the background script for inclusion as X-Vault-Session header.
// ---------------------------------------------------------------------------

let _vsbt: string | null = null

function _storeVSBT(token: string) { _vsbt = token }
function _clearVSBT() { _vsbt = null }

/** Returns the current VSBT (for testing / advanced use). */
export function getVaultSessionToken(): string | null { return _vsbt }

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
            vsbt: _vsbt,
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
            
            // Auto-store VSBT when the server returns a sessionToken
            // (e.g. after create, unlock)
            if (response.sessionToken) {
              _storeVSBT(response.sessionToken)
              addLog('INFO', 'VSBT stored from response', { endpoint })
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
  // Store VSBT returned by the server for subsequent requests
  const token = result?.sessionToken ?? (result?.data as any)?.sessionToken
  if (token) _storeVSBT(token)
  return result.data || { vaultId: result.vaultId }
}

export async function deleteVault(vaultId?: string): Promise<void> {
  await apiCall('/delete', { vaultId })
}

export async function unlockVault(masterPassword: string, vaultId: string = 'default'): Promise<void> {
  const result = await apiCall('/unlock', { password: masterPassword, vaultId })
  // Store VSBT returned by the server for subsequent requests
  const token = result?.sessionToken
  if (token) _storeVSBT(token)
}

export async function lockVault(): Promise<void> {
  await apiCall('/lock')
  _clearVSBT()
}

export async function getVaultStatus(): Promise<VaultStatus> {
  const status: VaultStatus = await apiCall('/status')
  // Compute canUseHsContextProfiles from tier so all callers get it without
  // needing to re-derive it. The Electron side returns `tier` but does not
  // set this flag — we derive it here, once, at the source.
  if (status.tier) {
    status.canUseHsContextProfiles = canAccessRecordType(
      status.tier as VaultTier,
      'handshake_context',
      'share',
    )
  }
  return status
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
  const result = await apiCall('/containers')
  // Ensure result is an array
  if (!Array.isArray(result)) {
    console.error('[VAULT API] listContainers did not return an array:', result)
    return []
  }
  return result
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
  return await apiCall('/item/get', { id })
}

/**
 * Least-privilege projection of a vault item for autofill preview.
 *
 * Returns only the properties needed by the overlay pipeline:
 *   - id, fields, domain, category, title
 *
 * Strips: container_id, favorite, created_at, updated_at, and any
 * future top-level properties that the fill path does not need.
 *
 * The underlying endpoint is the same (/item/get) — the projection
 * happens client-side to enforce data minimization even if the server
 * returns extra fields.
 */
export interface FillProjection {
  id: string
  category: ItemCategory
  title: string
  fields: Field[]
  domain?: string
}

export async function getItemForFill(id: string): Promise<FillProjection> {
  const item = await apiCall('/item/get', { id })
  // Client-side projection: keep only what the fill pipeline needs
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    fields: item.fields,
    domain: item.domain,
  }
}

export async function listItems(filters?: {
  container_id?: string
  category?: ItemCategory
  favorites_only?: boolean
  limit?: number
  offset?: number
}): Promise<VaultItem[]> {
  // Backend expects containerId (not container_id)
  const body = filters ? { containerId: filters.container_id, category: filters.category } : {}
  const result = await apiCall('/items', body)
  // Ensure result is an array
  if (!Array.isArray(result)) {
    console.error('[VAULT API] listItems did not return an array:', result)
    return []
  }
  return result
}

/**
 * Least-privilege listing for the search index builder.
 *
 * Returns items filtered by fillable categories (password, identity, company)
 * and projects each item to metadata + non-sensitive field hints only.
 * Sensitive field values (password type) are replaced with empty strings.
 *
 * The underlying endpoint is the same (/items) — the projection is
 * client-side to enforce data minimization.
 */
export interface IndexProjection {
  id: string
  category: ItemCategory
  title: string
  domain?: string
  favorite: boolean
  updated_at: number
  fields: Field[]
}

export async function listItemsForIndex(): Promise<IndexProjection[]> {
  const body = {} // fetch all categories — filtered below
  const result = await apiCall('/items', body)
  if (!Array.isArray(result)) return []

  const FILLABLE: Set<string> = new Set(['password', 'identity', 'company'])

  return result
    .filter((item: any) => FILLABLE.has(item.category))
    .map((item: any): IndexProjection => ({
      id: item.id,
      category: item.category,
      title: item.title,
      domain: item.domain,
      favorite: item.favorite,
      updated_at: item.updated_at,
      // Strip sensitive values — index only needs keys for search hints
      fields: (item.fields ?? []).map((f: Field) => ({
        ...f,
        value: f.type === 'password' ? '' : f.value,
      })),
    }))
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
// Document Vault Operations
// ==========================================================================

export interface VaultDocumentMeta {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  sha256: string
  notes: string
  created_at: number
  updated_at: number
}

export interface DocumentImportResult {
  document: VaultDocumentMeta
  deduplicated: boolean
}

/**
 * Upload a document to the encrypted vault.
 * @param filename  Original filename.
 * @param data      Base64-encoded file content.
 * @param notes     Optional notes / tags.
 */
export async function uploadDocument(
  filename: string,
  data: string,
  notes?: string,
): Promise<DocumentImportResult> {
  return await apiCall('/document/upload', { filename, data, notes })
}

/**
 * Retrieve and decrypt a stored document.
 * Returns metadata + base64-encoded content.
 */
export async function getDocument(
  id: string,
): Promise<{ document: VaultDocumentMeta; content: string }> {
  return await apiCall('/document/get', { id })
}

/**
 * List all documents (metadata only, no decryption).
 */
export async function listDocuments(): Promise<VaultDocumentMeta[]> {
  const result = await apiCall('/documents')
  if (!Array.isArray(result)) {
    console.error('[VAULT API] listDocuments did not return an array:', result)
    return []
  }
  return result
}

/**
 * Delete a document from the vault.
 */
export async function deleteDocument(id: string): Promise<void> {
  await apiCall('/document/delete', { id })
}

/**
 * Update document metadata (notes).
 */
export async function updateDocument(
  id: string,
  updates: { notes?: string },
): Promise<VaultDocumentMeta> {
  return await apiCall('/document/update', { id, updates })
}

// ==========================================================================
// Handshake Context — Binding Policy & Evaluation
// ==========================================================================

/**
 * Get item meta (binding policy for handshake context items).
 */
export async function getItemMeta(id: string): Promise<any | null> {
  return await apiCall('/item/meta/get', { id })
}

/**
 * Set item meta (binding policy for handshake context items).
 */
export async function setItemMeta(
  id: string,
  meta: Record<string, any>,
): Promise<void> {
  await apiCall('/item/meta/set', { id, meta })
}

/**
 * Evaluate whether a handshake context item can be attached to a handshake.
 * Returns allowed/blocked with reason and message.
 */
export async function evaluateHandshakeAttach(
  itemId: string,
  target: HandshakeTarget,
): Promise<AttachEvalResult> {
  return await apiCall('/handshake/evaluate', { itemId, target })
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
