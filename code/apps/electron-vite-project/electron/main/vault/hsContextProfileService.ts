/**
 * HS Context Profile Service
 *
 * CRUD for hs_context_profiles and hs_context_profile_documents.
 * All write operations are tier-gated: Publisher or Enterprise only.
 *
 * Encryption: PDF document content is stored encrypted using the same
 * sealRecord / openRecord envelope used by the Document Vault service.
 * The profile fields (text) are stored as plain JSON in the vault's
 * already-encrypted SQLCipher database — no additional envelope needed.
 */

import { randomUUID } from 'crypto'
import { canAccessRecordType } from './types'
import type { VaultTier } from './types'
import { sealRecord, openRecord } from './envelope'
import { runExtractionJob } from './hsContextOcrJob'
import type { HsContextProfile, ProfileFields, CustomField, ProfileDocumentSummary } from './hsContextNormalize'
import { validateDocumentLabel, validateDocumentType } from '../../../../../packages/shared/src/handshake/hsContextFieldValidation'


// ── Re-export types consumers need ──
export type { HsContextProfile, ProfileFields, CustomField, ProfileDocumentSummary }

// ── Storage types (DB rows) ──

export interface HsContextProfileRow {
  id: string
  org_id: string
  name: string
  description: string | null
  scope: 'non_confidential' | 'confidential'
  tags: string      // JSON array
  fields: string    // JSON object
  custom_fields: string // JSON array
  created_at: number
  updated_at: number
  archived: number
}

export interface HsContextProfileDocumentRow {
  id: string
  profile_id: string
  filename: string
  mime_type: string
  storage_key: string
  scope: string
  extraction_status: 'pending' | 'success' | 'failed'
  extracted_text: string | null
  extracted_at: number | null
  extractor_name: string | null
  error_message: string | null
  sensitive?: number
  label?: string | null
  document_type?: string | null
  created_at: number
}

// ── Public API types ──

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

// ── Tier guard ──

function requireHsContextAccess(tier: VaultTier, action: 'read' | 'write' | 'share' = 'write'): void {
  if (!canAccessRecordType(tier, 'handshake_context', action)) {
    throw new Error(`HS Context Profiles require Publisher or Enterprise tier (current: ${tier})`)
  }
}

// ── Row mappers ──

function rowToSummary(row: HsContextProfileRow, documentCount = 0): HsContextProfileSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    scope: row.scope,
    tags: JSON.parse(row.tags || '[]'),
    updated_at: row.updated_at,
    created_at: row.created_at,
    document_count: documentCount,
  }
}

function rowToDetail(
  row: HsContextProfileRow,
  docRows: HsContextProfileDocumentRow[],
): HsContextProfileDetail {
  const documents: ProfileDocumentSummary[] = docRows.map((d) => ({
    id: d.id,
    filename: d.filename,
    label: d.label ?? undefined,
    document_type: d.document_type ?? undefined,
    extraction_status: d.extraction_status,
    extracted_text: d.extracted_text,
    error_message: d.error_message,
    sensitive: !!(d.sensitive ?? 0),
  }))

  return {
    ...rowToSummary(row, docRows.length),
    fields: JSON.parse(row.fields || '{}'),
    custom_fields: JSON.parse(row.custom_fields || '[]'),
    documents,
  }
}

function detailToProfile(detail: HsContextProfileDetail): HsContextProfile {
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    scope: detail.scope,
    fields: detail.fields,
    custom_fields: detail.custom_fields,
  }
}

// ── Profile CRUD ──

export function listProfiles(
  db: any,
  tier: VaultTier,
  includeArchived = false,
): HsContextProfileSummary[] {
  requireHsContextAccess(tier, 'read')

  const rows: HsContextProfileRow[] = db
    .prepare(
      `SELECT p.*, (SELECT count(*) FROM hs_context_profile_documents d WHERE d.profile_id = p.id) as doc_count
       FROM hs_context_profiles p
       WHERE p.archived = ?
       ORDER BY p.updated_at DESC`,
    )
    .all(includeArchived ? 1 : 0)

  return rows.map((row: any) => rowToSummary(row, row.doc_count ?? 0))
}

export function getProfile(
  db: any,
  tier: VaultTier,
  profileId: string,
): HsContextProfileDetail | null {
  requireHsContextAccess(tier, 'read')

  const row: HsContextProfileRow | undefined = db
    .prepare('SELECT * FROM hs_context_profiles WHERE id = ?')
    .get(profileId)

  if (!row) return null

  const docRows: HsContextProfileDocumentRow[] = db
    .prepare('SELECT * FROM hs_context_profile_documents WHERE profile_id = ? ORDER BY created_at ASC')
    .all(profileId)

  return rowToDetail(row, docRows)
}

export function createProfile(
  db: any,
  tier: VaultTier,
  input: CreateProfileInput,
): HsContextProfileSummary {
  requireHsContextAccess(tier, 'write')

  if (!input.name?.trim()) throw new Error('Profile name is required')

  const id = `hsp_${randomUUID().replace(/-/g, '')}`
  const now = Date.now()

  db.prepare(`
    INSERT INTO hs_context_profiles
      (id, org_id, name, description, scope, tags, fields, custom_fields, created_at, updated_at, archived)
    VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    id,
    input.name.trim(),
    input.description ?? null,
    input.scope ?? 'non_confidential',
    JSON.stringify(input.tags ?? []),
    JSON.stringify(input.fields ?? {}),
    JSON.stringify(input.custom_fields ?? []),
    now,
    now,
  )

  return rowToSummary(
    db.prepare('SELECT * FROM hs_context_profiles WHERE id = ?').get(id),
    0,
  )
}

export function updateProfile(
  db: any,
  tier: VaultTier,
  profileId: string,
  updates: UpdateProfileInput,
): HsContextProfileSummary {
  requireHsContextAccess(tier, 'write')

  const existing: HsContextProfileRow | undefined = db
    .prepare('SELECT * FROM hs_context_profiles WHERE id = ?')
    .get(profileId)

  if (!existing) throw new Error(`Profile not found: ${profileId}`)

  const now = Date.now()
  db.prepare(`
    UPDATE hs_context_profiles SET
      name = ?,
      description = ?,
      scope = ?,
      tags = ?,
      fields = ?,
      custom_fields = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    updates.name?.trim() ?? existing.name,
    updates.description !== undefined ? (updates.description ?? null) : existing.description,
    updates.scope ?? existing.scope,
    JSON.stringify(updates.tags ?? JSON.parse(existing.tags || '[]')),
    JSON.stringify(updates.fields ?? JSON.parse(existing.fields || '{}')),
    JSON.stringify(updates.custom_fields ?? JSON.parse(existing.custom_fields || '[]')),
    now,
    profileId,
  )

  const docCount: number = (db
    .prepare('SELECT count(*) as c FROM hs_context_profile_documents WHERE profile_id = ?')
    .get(profileId) as any)?.c ?? 0

  return rowToSummary(
    db.prepare('SELECT * FROM hs_context_profiles WHERE id = ?').get(profileId),
    docCount,
  )
}

export function archiveProfile(db: any, tier: VaultTier, profileId: string): void {
  requireHsContextAccess(tier, 'write')
  db.prepare('UPDATE hs_context_profiles SET archived = 1, updated_at = ? WHERE id = ?')
    .run(Date.now(), profileId)
}

export function deleteProfile(db: any, tier: VaultTier, profileId: string): void {
  requireHsContextAccess(tier, 'write')
  // ON DELETE CASCADE removes documents
  db.prepare('DELETE FROM hs_context_profiles WHERE id = ?').run(profileId)
}

export function duplicateProfile(
  db: any,
  tier: VaultTier,
  profileId: string,
): HsContextProfileSummary {
  requireHsContextAccess(tier, 'write')

  const detail = getProfile(db, tier, profileId)
  if (!detail) throw new Error(`Profile not found: ${profileId}`)

  return createProfile(db, tier, {
    name: `${detail.name} (Copy)`,
    description: detail.description,
    scope: detail.scope,
    tags: detail.tags,
    fields: detail.fields,
    custom_fields: detail.custom_fields,
  })
}

// ── Document CRUD ──

/** PDF magic bytes: %PDF */
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46])

function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).equals(PDF_MAGIC)
}

/**
 * Upload a PDF document to a profile.
 * Stores the encrypted content and kicks off async text extraction.
 *
 * @param db            Open vault DB.
 * @param tier          Current user tier.
 * @param kek           Key-encryption key for sealing the document.
 * @param profileId     Target profile ID.
 * @param filename      Original filename.
 * @param mimeType      MIME type (should be application/pdf).
 * @param content       Raw PDF bytes.
 * @param sensitive     Optional: mark document as sensitive (restricts cloud AI and search).
 * @param label         Optional: user-defined label/title for the document.
 * @param documentType  Optional: document type (manual, contract, custom, etc.).
 */
export async function uploadProfileDocument(
  db: any,
  tier: VaultTier,
  kek: Buffer,
  profileId: string,
  filename: string,
  mimeType: string,
  content: Buffer,
  sensitive = false,
  label?: string | null,
  documentType?: string | null,
): Promise<HsContextProfileDocumentRow> {
  requireHsContextAccess(tier, 'write')

  if (!isPdfBuffer(content)) {
    throw new Error('Invalid PDF: file must start with PDF magic bytes (%PDF)')
  }

  const profileRow: HsContextProfileRow | undefined = db
    .prepare('SELECT id FROM hs_context_profiles WHERE id = ?')
    .get(profileId)
  if (!profileRow) throw new Error(`Profile not found: ${profileId}`)

  const docId = `hsd_${randomUUID().replace(/-/g, '')}`
  const storageKey = `hs_doc_${docId}`
  const now = Date.now()

  // Encrypt and store the raw PDF bytes using the same pattern as documentService.
  // sealRecord expects a string payload — we base64-encode the binary content.
  const aad = Buffer.from(`hsdoc:${docId}`)
  const pdfBase64 = content.toString('base64')
  const { wrappedDEK, ciphertext } = await sealRecord(pdfBase64, kek, aad)

  // Reuse vault_documents table for encrypted storage
  db.prepare(`
    INSERT OR REPLACE INTO vault_documents
      (id, filename, mime_type, size_bytes, sha256, wrapped_dek, ciphertext, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, '', ?, ?, '', ?, ?)
  `).run(
    storageKey,
    filename,
    mimeType,
    content.length,
    wrappedDEK,
    ciphertext,
    now,
    now,
  )

  db.prepare(`
    INSERT INTO hs_context_profile_documents
      (id, profile_id, filename, mime_type, storage_key, scope, extraction_status, sensitive, label, document_type, created_at)
    VALUES (?, ?, ?, ?, ?, 'confidential', 'pending', ?, ?, ?, ?)
  `).run(docId, profileId, filename, mimeType, storageKey, sensitive ? 1 : 0, label?.trim() || null, documentType?.trim() || null, now)

  // Bump profile updated_at
  db.prepare('UPDATE hs_context_profiles SET updated_at = ? WHERE id = ?').run(now, profileId)

  // Kick off extraction asynchronously (fire-and-forget)
  setImmediate(() => {
    runExtractionJob(db, docId, content).catch((err) => {
      console.error(`[HS PROFILE] Extraction job failed for doc ${docId}:`, err?.message)
    })
  })

  return db
    .prepare('SELECT * FROM hs_context_profile_documents WHERE id = ?')
    .get(docId) as HsContextProfileDocumentRow
}

/**
 * Retrieve the decrypted PDF content for a profile document.
 */
export async function getProfileDocumentContent(
  db: any,
  tier: VaultTier,
  kek: Buffer,
  documentId: string,
): Promise<{ content: Buffer; filename: string; mimeType: string }> {
  requireHsContextAccess(tier, 'read')

  const docRow: HsContextProfileDocumentRow | undefined = db
    .prepare('SELECT * FROM hs_context_profile_documents WHERE id = ?')
    .get(documentId)
  if (!docRow) throw new Error(`Document not found: ${documentId}`)

  const storageRow: any = db
    .prepare('SELECT * FROM vault_documents WHERE id = ?')
    .get(docRow.storage_key)
  if (!storageRow) throw new Error(`Storage record not found for document: ${documentId}`)

  const aad = Buffer.from(`hsdoc:${documentId}`)
  const wrappedDEK = Buffer.from(storageRow.wrapped_dek)
  const ciphertext = Buffer.from(storageRow.ciphertext)

  // openRecord returns JSON.parse result — we stored a base64 string, JSON.parse gives string
  const decryptedResult = await openRecord(wrappedDEK, ciphertext, kek, aad)
  const pdfBase64 = typeof decryptedResult === 'string'
    ? decryptedResult
    : Array.isArray(decryptedResult) ? decryptedResult[0] : String(decryptedResult)
  const content = Buffer.from(pdfBase64, 'base64')

  return { content, filename: docRow.filename, mimeType: docRow.mime_type }
}

export function deleteProfileDocument(db: any, tier: VaultTier, documentId: string): void {
  requireHsContextAccess(tier, 'write')

  const docRow: HsContextProfileDocumentRow | undefined = db
    .prepare('SELECT * FROM hs_context_profile_documents WHERE id = ?')
    .get(documentId)
  if (!docRow) return

  // Remove storage record
  db.prepare('DELETE FROM vault_documents WHERE id = ?').run(docRow.storage_key)
  // Remove document row (cascade)
  db.prepare('DELETE FROM hs_context_profile_documents WHERE id = ?').run(documentId)

  // Bump profile updated_at
  db.prepare('UPDATE hs_context_profiles SET updated_at = ? WHERE id = ?')
    .run(Date.now(), docRow.profile_id)
}

/**
 * Update document metadata (label, document_type).
 * Additive; only updates provided fields.
 * Validates label and document_type (aligns with upload path validation).
 */
export function updateProfileDocumentMeta(
  db: any,
  tier: VaultTier,
  documentId: string,
  updates: { label?: string | null; document_type?: string | null },
): void {
  requireHsContextAccess(tier, 'write')

  const docRow: HsContextProfileDocumentRow | undefined = db
    .prepare('SELECT * FROM hs_context_profile_documents WHERE id = ?')
    .get(documentId)
  if (!docRow) throw new Error(`Document not found: ${documentId}`)

  const setClauses: string[] = []
  const values: unknown[] = []

  if (updates.label !== undefined) {
    const r = validateDocumentLabel(updates.label)
    if (!r.ok) throw new Error(r.error)
    setClauses.push('label = ?')
    values.push(r.value || null)
  }
  if (updates.document_type !== undefined) {
    const r = validateDocumentType(updates.document_type)
    if (!r.ok) throw new Error(r.error)
    setClauses.push('document_type = ?')
    values.push(r.value || null)
  }
  if (setClauses.length === 0) return

  values.push(documentId)
  db.prepare(`UPDATE hs_context_profile_documents SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)

  db.prepare('UPDATE hs_context_profiles SET updated_at = ? WHERE id = ?')
    .run(Date.now(), docRow.profile_id)
}

// ── Context resolution for handshake initiation ──

/**
 * Resolve a list of profile IDs into their full HsContextProfile + documents
 * for use in building a handshake context payload.
 *
 * This must be called server-side. The client sends only IDs.
 */
export function resolveProfilesForHandshake(
  db: any,
  tier: VaultTier,
  profileIds: string[],
): Array<{ profile: HsContextProfile; documents: ProfileDocumentSummary[] }> {
  requireHsContextAccess(tier, 'share')

  return profileIds
    .map((id) => {
      const detail = getProfile(db, tier, id)
      if (!detail) {
        console.warn(`[HS PROFILE] Profile not found during handshake resolution: ${id}`)
        return null
      }
      return {
        profile: detailToProfile(detail),
        documents: detail.documents,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}
