/**
 * Shim for extension-chromium hsContextProfilesRpc — routes through Electron IPC
 * instead of chrome.runtime.sendMessage (VAULT_RPC WebSocket).
 */

export interface HsContextProfileSummary {
  id: string
  name: string
  description?: string
  scope: 'non_confidential' | 'confidential'
  tags: string[]
  updated_at: number
  created_at: number
  document_count: number
}

export async function listHsProfiles(includeArchived = false): Promise<HsContextProfileSummary[]> {
  const list = (window as any).handshakeView?.listHsContextProfiles
  if (!list || typeof list !== 'function') {
    return []
  }
  try {
    const res = await list(includeArchived)
    return Array.isArray(res?.profiles) ? res.profiles : []
  } catch (err: any) {
    throw new Error(err?.message ?? 'Failed to load HS Context Profiles')
  }
}

export async function getHsProfile(_id: string): Promise<any> {
  return null
}

export async function createHsProfile(_name: string, _fields: any[]): Promise<any> {
  throw new Error('HS Context Profiles not available in Electron')
}

export async function updateHsProfile(_id: string, _updates: any): Promise<any> {
  throw new Error('HS Context Profiles not available in Electron')
}

export async function deleteHsProfile(_id: string): Promise<void> {
  throw new Error('HS Context Profiles not available in Electron')
}
