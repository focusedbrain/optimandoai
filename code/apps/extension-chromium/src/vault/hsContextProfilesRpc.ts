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
  documents_ready: number
  documents_pending: number
  documents_failed: number
  documents_failed_names: string[]
}

export interface ProfileFields {
  legalCompanyName?: string
  tradeName?: string
  address?: string
  country?: string
  website?: string
  linkedin?: string
  twitter?: string
  facebook?: string
  instagram?: string
  youtube?: string
  officialLink?: string
  supportUrl?: string
  generalPhone?: string
  generalEmail?: string
  supportEmail?: string
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
  /** Section key this field belongs to ('company', 'tax', 'contacts', 'hours',
   *  'billing', 'logistics', 'links'). Undefined = legacy catch-all bucket. */
  section?: string
}

export interface ProfileDocumentSummary {
  id: string
  profile_id: string
  filename: string
  mime_type: string
  label?: string | null
  document_type?: string | null
  extraction_status: 'pending' | 'success' | 'failed'
  extracted_text?: string | null
  error_message?: string | null
  /** Structured error code for the BYOK failure card logic. */
  error_code?: string | null
  sensitive?: boolean
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
    input as unknown as Record<string, unknown>,
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
 * Convert ArrayBuffer to base64 without blowing the call stack.
 * String.fromCharCode(...bytes) fails with "Maximum call stack size exceeded"
 * for large files because spreading millions of args exceeds engine limits.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
}

/**
 * Upload a PDF document to a profile.
 * Converts the File to base64 before sending over RPC.
 * @param sensitive If true, marks the document as sensitive (restricts cloud AI and search).
 * @param label Optional user-defined label/title for the document.
 * @param documentType Optional document type (manual, contract, custom, etc.).
 */
export async function uploadHsProfileDocument(
  profileId: string,
  file: File,
  sensitive = false,
  label?: string | null,
  documentType?: string | null,
): Promise<ProfileDocumentSummary> {
  const buffer = await file.arrayBuffer()
  const base64 = arrayBufferToBase64(buffer)
  const res = await sendVaultRpc<{ document: ProfileDocumentSummary }>(
    'vault.hsProfiles.uploadDocument',
    {
      profileId,
      filename: file.name,
      mimeType: file.type || 'application/pdf',
      contentBase64: base64,
      sensitive,
      label: label ?? null,
      documentType: documentType ?? null,
    },
    60_000, // longer timeout for file upload + extraction
  )
  return res.document
}

/**
 * Update document metadata (label, document_type).
 */
export async function updateHsProfileDocumentMeta(
  documentId: string,
  updates: { label?: string | null; document_type?: string | null },
): Promise<void> {
  await sendVaultRpc('vault.hsProfiles.updateDocumentMeta', {
    documentId,
    label: updates.label ?? null,
    document_type: updates.document_type ?? null,
  })
}

export async function deleteHsProfileDocument(documentId: string): Promise<void> {
  await sendVaultRpc('vault.hsProfiles.deleteDocument', { documentId })
}

/**
 * Owner-direct document download. The vault owner requires no consent warning
 * because they hold the vault and uploaded the file themselves.
 * Returns base64-encoded PDF content ready for client-side download.
 */
export async function getHsOwnerDocumentContent(
  documentId: string,
): Promise<{ success: true; contentBase64: string; filename: string; mimeType: string } | { success: false; error: string }> {
  const res = await sendVaultRpc<{ success: boolean; contentBase64?: string; filename?: string; mimeType?: string; error?: string }>(
    'vault.hsProfiles.getOwnerDocumentContent',
    { documentId },
    30_000,
  )
  if (res.success && res.contentBase64 && res.filename && res.mimeType) {
    return { success: true, contentBase64: res.contentBase64, filename: res.filename, mimeType: res.mimeType }
  }
  return { success: false, error: (res as any).error ?? 'Failed to retrieve document' }
}

/**
 * Request original document content (whitelist-gated). Requires acknowledgedWarning.
 * Returns base64 content for download, or error if not approved.
 */
export async function requestOriginalDocument(
  documentId: string,
  acknowledgedWarning: boolean,
  handshakeId?: string | null,
  actorUserId?: string,
): Promise<{ success: boolean; error?: string; approved?: boolean; contentBase64?: string; filename?: string; mimeType?: string }> {
  const res = await sendVaultRpc<{ success: boolean; error?: string; approved?: boolean; contentBase64?: string; filename?: string; mimeType?: string }>(
    'vault.hsProfiles.requestOriginalDocument',
    { documentId, acknowledgedWarning, handshakeId: handshakeId ?? null, actorUserId: actorUserId ?? '' },
  )
  return res
}

/**
 * Request link open approval (whitelist-gated). Requires acknowledgedWarning.
 */
export async function requestLinkOpenApproval(
  linkEntityId: string,
  acknowledgedWarning: boolean,
  handshakeId?: string | null,
  actorUserId?: string,
): Promise<{ success: boolean; error?: string; approved?: boolean }> {
  const res = await sendVaultRpc<{ success: boolean; error?: string; approved?: boolean }>(
    'vault.hsProfiles.requestLinkOpenApproval',
    { linkEntityId, acknowledgedWarning, handshakeId: handshakeId ?? null, actorUserId: actorUserId ?? '' },
  )
  return res
}

// ── BYOK API Key management ──────────────────────────────────────────────────

/**
 * Validate and save the Anthropic API key, encrypted in the vault.
 * Throws with a user-friendly message if the key is invalid.
 */
export async function saveAnthropicApiKey(apiKey: string): Promise<void> {
  await sendVaultRpc('vault.settings.saveAnthropicApiKey', { apiKey }, 30_000)
}

/**
 * Check whether an Anthropic API key is stored (does not return the key value).
 */
export async function hasAnthropicApiKey(): Promise<{ hasKey: boolean }> {
  const res = await sendVaultRpc<{ success: boolean; hasKey: boolean }>(
    'vault.settings.hasAnthropicApiKey',
    {},
  )
  return { hasKey: !!(res as any).hasKey }
}

/**
 * Delete the stored Anthropic API key.
 */
export async function removeAnthropicApiKey(): Promise<void> {
  await sendVaultRpc('vault.settings.removeAnthropicApiKey', {})
}

/**
 * Retry text extraction for a document using Anthropic Vision API.
 * The server uses the stored API key — no key is sent in this RPC call.
 * Returns immediately with status='pending'; poll document status to see result.
 */
export async function retryExtractionWithVision(
  documentId: string,
): Promise<{ status: string }> {
  const res = await sendVaultRpc<{ success: boolean; status?: string }>(
    'vault.hsProfiles.retryExtractionWithVision',
    { documentId },
    15_000,
  )
  return { status: (res as any).status ?? 'pending' }
}
