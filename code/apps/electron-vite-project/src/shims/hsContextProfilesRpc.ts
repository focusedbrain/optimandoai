/**
 * Shim for extension-chromium hsContextProfilesRpc — stub for Electron.
 * Vault context profiles are not available in the desktop app yet.
 */

export interface HsContextProfileSummary {
  id: string
  name: string
  description?: string
  created_at: string
  field_count: number
}

export async function listHsProfiles(): Promise<HsContextProfileSummary[]> {
  return []
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
