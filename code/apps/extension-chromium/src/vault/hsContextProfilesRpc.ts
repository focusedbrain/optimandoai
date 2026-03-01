/**
 * HS Context Profiles RPC Client
 *
 * Communicates vault.hsProfiles.* methods through the Chrome background
 * script → WebSocket → Electron via the VAULT_RPC message channel.
 *
 * Available to Publisher and Enterprise tiers only (enforced server-side).
 */

let _rpcIdCounter = 0

function nextRpcId(): string {
  return `hs-profile-rpc-${Date.now()}-${++_rpcIdCounter}`
}

async function sendVaultRpc<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 20_000,
): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('Chrome runtime not available')
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`HS Profile RPC timeout: ${method}`))
    }, timeoutMs + 2_000)

    chrome.runtime.sendMessage(
      {
        type: 'VAULT_RPC',
        id: nextRpcId(),
        method,
        params,
      },
      (response: any) => {
        clearTimeout(timer)
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        if (!response) {
          reject(new Error('Empty response from background'))
          return
        }
        if (response.success === false) {
          reject(new Error(response.error ?? 'RPC error'))
          return
        }
        resolve(response as T)
      },
    )
  })
}

// ── Types ──

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

export interface ProfileFields {
  legalCompanyName?: string
  tradeName?: string
  address?: string
  country?: string
  website?: string
  vatNumber?: string
  companyRegistrationNumber?: string
  supplierNumber?: string
  customerNumber?: string
  contacts?: Array<{
    name?: string
    role?: string
    email?: string
    phone?: string
    notes?: string
  }>
  openingHours?: Array<{ days: string; from: string; to: string }>
  timezone?: string
  holidayNotes?: string
  billingEmail?: string
  paymentTerms?: string
  bankDetails?: string
  receivingHours?: string
  deliveryInstructions?: string
  supportHours?: string
  escalationContact?: string
}

export interface CustomField {
  label: string
  value: string
}

export interface ProfileDocumentSummary {
  id: string
  profile_id: string
  filename: string
  mime_type: string
  extraction_status: 'pending' | 'success' | 'failed'
  extracted_text?: string | null
  error_message?: string | null
  created_at: number
}

export interface HsContextProfileDetail extends HsContextProfileSummary {
  fields: ProfileFields
  custom_fields: CustomField[]
  documents: ProfileDocumentSummary[]
}

export interface CreateProfileInput {
  name: string
  description?: string
  scope?: 'non_confidential' | 'confidential'
  tags?: string[]
  fields?: ProfileFields
  custom_fields?: CustomField[]
}

export interface UpdateProfileInput {
  name?: string
  description?: string
  scope?: 'non_confidential' | 'confidential'
  tags?: string[]
  fields?: ProfileFields
  custom_fields?: CustomField[]
}

// ── Public API ──

export async function listHsProfiles(includeArchived = false): Promise<HsContextProfileSummary[]> {
  const res = await sendVaultRpc<{ profiles: HsContextProfileSummary[] }>(
    'vault.hsProfiles.list',
    { includeArchived },
  )
  return res.profiles ?? []
}

export async function getHsProfile(profileId: string): Promise<HsContextProfileDetail> {
  const res = await sendVaultRpc<{ profile: HsContextProfileDetail }>(
    'vault.hsProfiles.get',
    { profileId },
  )
  return res.profile
}

export async function createHsProfile(input: CreateProfileInput): Promise<HsContextProfileSummary> {
  const res = await sendVaultRpc<{ profile: HsContextProfileSummary }>(
    'vault.hsProfiles.create',
    input as Record<string, unknown>,
  )
  return res.profile
}

export async function updateHsProfile(
  profileId: string,
  updates: UpdateProfileInput,
): Promise<HsContextProfileSummary> {
  const res = await sendVaultRpc<{ profile: HsContextProfileSummary }>(
    'vault.hsProfiles.update',
    { profileId, ...updates } as Record<string, unknown>,
  )
  return res.profile
}

export async function archiveHsProfile(profileId: string): Promise<void> {
  await sendVaultRpc('vault.hsProfiles.archive', { profileId })
}

export async function deleteHsProfile(profileId: string): Promise<void> {
  await sendVaultRpc('vault.hsProfiles.delete', { profileId })
}

export async function duplicateHsProfile(profileId: string): Promise<HsContextProfileSummary> {
  const res = await sendVaultRpc<{ profile: HsContextProfileSummary }>(
    'vault.hsProfiles.duplicate',
    { profileId },
  )
  return res.profile
}

/**
 * Upload a PDF document to a profile.
 * Converts the File to base64 before sending over RPC.
 */
export async function uploadHsProfileDocument(
  profileId: string,
  file: File,
): Promise<ProfileDocumentSummary> {
  const buffer = await file.arrayBuffer()
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
  const res = await sendVaultRpc<{ document: ProfileDocumentSummary }>(
    'vault.hsProfiles.uploadDocument',
    {
      profileId,
      filename: file.name,
      mimeType: file.type || 'application/pdf',
      contentBase64: base64,
    },
    60_000, // longer timeout for file upload + extraction
  )
  return res.document
}

export async function deleteHsProfileDocument(documentId: string): Promise<void> {
  await sendVaultRpc('vault.hsProfiles.deleteDocument', { documentId })
}
