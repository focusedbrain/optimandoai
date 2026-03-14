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

import { randomUUID, createHash } from 'crypto'
import { canAccessRecordType } from './types'
import type { VaultTier } from './types'
import { sealRecord, openRecord, decryptRecord, unwrapRecordDEK } from './envelope'
import { runExtractionJob, markDocumentExtractionFailed, runExtractionJobWithVision } from './hsContextOcrJob'
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
  error_code?: string | null
  sensitive?: number
  label?: string | null
  document_type?: string | null
  created_at: number
  page_count?: number
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
  /** Count of documents with extraction_status = 'success' */
  documents_ready: number
  /** Count of documents with extraction_status = 'pending' (or 'processing') */
  documents_pending: number
  /** Count of documents with extraction_status = 'failed' */
  documents_failed: number
  /** Filenames of failed documents, for high-assurance explicit listing */
  documents_failed_names: string[]
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

function rowToSummary(
  row: HsContextProfileRow,
  documentCount = 0,
  docsReady = 0,
  docsPending = 0,
  docsFailed = 0,
  docsFailedNames: string[] = [],
): HsContextProfileSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    scope: row.scope,
    tags: JSON.parse(row.tags || '[]'),
    updated_at: row.updated_at,
    created_at: row.created_at,
    document_count: documentCount,
    documents_ready: docsReady,
    documents_pending: docsPending,
    documents_failed: docsFailed,
    documents_failed_names: docsFailedNames,
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
    error_code: d.error_code ?? null,
    sensitive: !!(d.sensitive ?? 0),
  }))

  const docsReady = docRows.filter((d) => d.extraction_status === 'success').length
  const docsPending = docRows.filter((d) => d.extraction_status === 'pending').length
  const docsFailed = docRows.filter((d) => d.extraction_status === 'failed').length
  const docsFailedNames = docRows.filter((d) => d.extraction_status === 'failed').map((d) => d.filename)

  return {
    ...rowToSummary(row, docRows.length, docsReady, docsPending, docsFailed, docsFailedNames),
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

  const rows: any[] = db
    .prepare(
      `SELECT p.*,
         (SELECT count(*) FROM hs_context_profile_documents d WHERE d.profile_id = p.id) as doc_count,
         (SELECT count(*) FROM hs_context_profile_documents d WHERE d.profile_id = p.id AND d.extraction_status = 'success') as docs_ready,
         (SELECT count(*) FROM hs_context_profile_documents d WHERE d.profile_id = p.id AND d.extraction_status = 'pending') as docs_pending,
         (SELECT count(*) FROM hs_context_profile_documents d WHERE d.profile_id = p.id AND d.extraction_status = 'failed') as docs_failed,
         (SELECT group_concat(filename, ', ') FROM hs_context_profile_documents d WHERE d.profile_id = p.id AND d.extraction_status = 'failed') as docs_failed_names
       FROM hs_context_profiles p
       WHERE p.archived = ?
       ORDER BY p.updated_at DESC`,
    )
    .all(includeArchived ? 1 : 0)

  return rows.map((row: any) => {
    const failedNames = row.docs_failed_names
      ? String(row.docs_failed_names).split(', ').filter(Boolean)
      : []
    return rowToSummary(
      row,
      row.doc_count ?? 0,
      row.docs_ready ?? 0,
      row.docs_pending ?? 0,
      row.docs_failed ?? 0,
      failedNames,
    )
  })
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
    0, 0, 0, 0, [],
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

  const docStats: any = db
    .prepare(
      `SELECT
         count(*) as c,
         sum(CASE WHEN extraction_status = 'success' THEN 1 ELSE 0 END) as r,
         sum(CASE WHEN extraction_status = 'pending' THEN 1 ELSE 0 END) as p,
         sum(CASE WHEN extraction_status = 'failed' THEN 1 ELSE 0 END) as f,
         (SELECT group_concat(filename, ', ') FROM hs_context_profile_documents WHERE profile_id = ? AND extraction_status = 'failed') as fn
       FROM hs_context_profile_documents WHERE profile_id = ?`,
    )
    .get(profileId, profileId)

  const failedNames = docStats?.fn
    ? String(docStats.fn).split(', ').filter(Boolean)
    : []

  return rowToSummary(
    db.prepare('SELECT * FROM hs_context_profiles WHERE id = ?').get(profileId),
    docStats?.c ?? 0,
    docStats?.r ?? 0,
    docStats?.p ?? 0,
    docStats?.f ?? 0,
    failedNames,
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

// FIX 5: Maximum PDF size enforced server-side (mirrors the client-side 50 MB limit).
// A direct RPC call can bypass the UI check — this guard closes that gap.
const MAX_PDF_BYTES = 50 * 1024 * 1024 // 50 MB

// FIX 4: Maximum time (ms) allowed for the async extraction job.
// OCR on a large scanned document can take many minutes. Without a timeout the
// document stays stuck at 'pending' forever if the job hangs.
const EXTRACTION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

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

  // FIX 5: Server-side size guard
  if (content.length > MAX_PDF_BYTES) {
    throw new Error(
      `PDF size ${(content.length / (1024 * 1024)).toFixed(1)} MB exceeds the maximum allowed size of 50 MB.`
    )
  }

  if (!isPdfBuffer(content)) {
    throw new Error('Invalid PDF: file must start with PDF magic bytes (%PDF)')
  }

  const profileRow: HsContextProfileRow | undefined = db
    .prepare('SELECT id FROM hs_context_profiles WHERE id = ?')
    .get(profileId)
  if (!profileRow) throw new Error(`Profile not found: ${profileId}`)

  // FIX 7: Compute SHA-256 of the raw bytes for integrity and duplicate detection.
  const sha256 = createHash('sha256').update(content).digest('hex')

  // FIX 7: Duplicate check within the same profile — reject re-uploads of the same file.
  const existingDoc = db.prepare(`
    SELECT d.id FROM hs_context_profile_documents d
    INNER JOIN vault_documents v ON v.id = d.storage_key
    WHERE d.profile_id = ? AND v.sha256 = ? AND v.sha256 != ''
  `).get(profileId, sha256) as { id: string } | undefined

  if (existingDoc) {
    throw new Error('This document has already been uploaded to this profile. Remove the existing copy first if you want to replace it.')
  }

  const docId = `hsd_${randomUUID().replace(/-/g, '')}`
  const storageKey = `hs_doc_${docId}`
  const now = Date.now()

  // Encrypt and store the raw PDF bytes using the same pattern as documentService.
  // sealRecord expects a string payload that survives JSON.parse on the read path
  // (openRecord calls JSON.parse on the decrypted bytes). We must JSON-encode the
  // base64 string so that JSON.parse("\"JVBER...\"") correctly returns the string.
  // Storing the raw base64 without JSON encoding causes JSON.parse to throw
  // "Unexpected token 'J'" because a bare base64 string is not valid JSON.
  const aad = Buffer.from(`hsdoc:${docId}`)
  const pdfBase64 = content.toString('base64')
  const { wrappedDEK, ciphertext } = await sealRecord(JSON.stringify(pdfBase64), kek, aad)

  // Reuse vault_documents table for encrypted storage (sha256 now stored)
  db.prepare(`
    INSERT OR REPLACE INTO vault_documents
      (id, filename, mime_type, size_bytes, sha256, wrapped_dek, ciphertext, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)
  `).run(
    storageKey,
    filename,
    mimeType,
    content.length,
    sha256,
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

  // FIX 4: Kick off extraction asynchronously (fire-and-forget) with a timeout guard.
  // If extraction hangs (e.g. a huge scanned PDF overwhelming Tesseract), the timeout
  // fires and marks the document 'failed' with a clear message rather than leaving it
  // stuck at 'pending' indefinitely. The UI stops polling after ~6 min anyway, but
  // without this the DB row would never resolve.
  setImmediate(() => {
    let settled = false

    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true
        console.error(`[HS PROFILE] Extraction timed out for document ${docId}`)
        try {
          markDocumentExtractionFailed(
            db,
            docId,
            'Text extraction timed out (5 min). The document may be too large for OCR. Try a PDF with a text layer or split it into smaller files.',
            'EXTRACTION_TIMEOUT',
          )
        } catch (markErr: any) {
          console.error(`[HS PROFILE] Failed to mark timeout for doc ${docId}:`, markErr?.message)
        }
      }
    }, EXTRACTION_TIMEOUT_MS)

    runExtractionJob(db, docId, content)
      .then(() => { settled = true })
      .catch((err: any) => {
        if (!settled) {
          settled = true
          console.error(`[HS PROFILE] Extraction job error for doc ${docId}:`, err?.message)
          try {
            markDocumentExtractionFailed(db, docId, err?.message || 'Extraction failed unexpectedly')
          } catch (markErr: any) {
            console.error(`[HS PROFILE] Failed to mark error for doc ${docId}:`, markErr?.message)
          }
        }
      })
      .finally(() => clearTimeout(timeoutHandle))
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

  // openRecord decrypts and JSON.parse-s the stored payload.
  // New records: stored as JSON.stringify(base64string) → JSON.parse returns a string.
  // Legacy records (stored as bare base64 without JSON encoding): JSON.parse throws,
  // so we fall back to reading the raw decrypted bytes directly via decryptRecord.
  let pdfBase64: string
  try {
    const decryptedResult = await openRecord(wrappedDEK, ciphertext, kek, aad)
    // JSON.parse of a JSON-encoded string returns the string itself.
    // JSON.parse of a JSON-encoded array returns the array (legacy format not used here).
    if (typeof decryptedResult === 'string') {
      pdfBase64 = decryptedResult
    } else if (Array.isArray(decryptedResult) && typeof decryptedResult[0] === 'string') {
      pdfBase64 = decryptedResult[0]
    } else {
      pdfBase64 = String(decryptedResult)
    }
  } catch (_parseErr) {
    // Legacy records were stored as raw base64 (not JSON-encoded). openRecord's
    // JSON.parse throws on them. Fall back to decryptRecord to get the raw string.
    const recordDEK = unwrapRecordDEK(wrappedDEK, kek, aad)
    pdfBase64 = await decryptRecord(ciphertext, recordDEK, aad)
  }
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
/**
 * Migrate legacy documents: split extracted_text by double newline into per-page records.
 * Call lazily when opening the document reader and no pages exist yet.
 * Returns true if pages were created, false if not needed or no extracted_text.
 */
export function splitExtractedTextToPages(db: any, documentId: string): boolean {
  const docRow: HsContextProfileDocumentRow | undefined = db
    .prepare('SELECT id, extracted_text FROM hs_context_profile_documents WHERE id = ?')
    .get(documentId)
  if (!docRow || !docRow.extracted_text?.trim()) return false

  const existingCount = db.prepare(
    'SELECT count(*) as c FROM hs_context_profile_document_pages WHERE document_id = ?'
  ).get(documentId) as { c: number }
  if ((existingCount?.c ?? 0) > 0) return false

  const pageTexts = docRow.extracted_text.split(/\n\n+/).map((s) => s.trim()).filter(Boolean)
  if (pageTexts.length === 0) {
    pageTexts.push('')
  }

  const now = Date.now()
  const insert = db.prepare(`
    INSERT INTO hs_context_profile_document_pages (id, document_id, page_number, text, char_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (let i = 0; i < pageTexts.length; i++) {
    const text = pageTexts[i] ?? ''
    const pageNum = i + 1
    const id = `hspg_${documentId}_${pageNum}`
    insert.run(id, documentId, pageNum, text, text.length, now)
  }

  db.prepare('UPDATE hs_context_profile_documents SET page_count = ? WHERE id = ?')
    .run(pageTexts.length, documentId)
  return true
}

// ── Document reader: per-page fetch ──

export interface DocumentPageInfo {
  page_number: number
  char_count: number
}

/**
 * Get page count for a document. Runs splitExtractedTextToPages if needed for legacy docs.
 */
export function getDocumentPageCount(db: any, tier: VaultTier, documentId: string): number {
  requireHsContextAccess(tier, 'read')
  splitExtractedTextToPages(db, documentId)
  const row = db.prepare(
    'SELECT page_count FROM hs_context_profile_documents WHERE id = ?'
  ).get(documentId) as { page_count?: number } | undefined
  return row?.page_count ?? 0
}

/**
 * Get text for a single page (1-indexed).
 */
export function getDocumentPage(
  db: any,
  tier: VaultTier,
  documentId: string,
  pageNumber: number,
): string | null {
  requireHsContextAccess(tier, 'read')
  splitExtractedTextToPages(db, documentId)
  const row = db.prepare(
    'SELECT text FROM hs_context_profile_document_pages WHERE document_id = ? AND page_number = ?'
  ).get(documentId, pageNumber) as { text: string } | undefined
  return row?.text ?? null
}

/**
 * Get lightweight page list (page_number, char_count) for sidebar navigation.
 */
export function getDocumentPageList(db: any, tier: VaultTier, documentId: string): DocumentPageInfo[] {
  requireHsContextAccess(tier, 'read')
  splitExtractedTextToPages(db, documentId)
  const rows = db.prepare(
    'SELECT page_number, char_count FROM hs_context_profile_document_pages WHERE document_id = ? ORDER BY page_number ASC'
  ).all(documentId) as { page_number: number; char_count: number }[]
  return rows.map((r) => ({ page_number: r.page_number, char_count: r.char_count }))
}

/**
 * Get full extracted text for Download Full Text (avoids fetching all pages).
 */
export function getDocumentFullText(db: any, tier: VaultTier, documentId: string): string | null {
  requireHsContextAccess(tier, 'read')
  const row = db.prepare('SELECT extracted_text FROM hs_context_profile_documents WHERE id = ?').get(documentId) as { extracted_text: string | null } | undefined
  return row?.extracted_text ?? null
}

export interface DocumentSearchMatch {
  page_number: number
  match_count: number
  /** Short context snippet around first match (max ~80 chars) */
  snippet: string
}

/**
 * Search across document pages using SQL LIKE. Returns pages with matches.
 */
export function searchDocumentPages(db: any, tier: VaultTier, documentId: string, query: string): DocumentSearchMatch[] {
  requireHsContextAccess(tier, 'read')
  if (!query?.trim()) return []
  splitExtractedTextToPages(db, documentId)
  const escaped = query.trim().replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
  const likePattern = `%${escaped}%`
  const rows = db.prepare(
    `SELECT page_number, text FROM hs_context_profile_document_pages WHERE document_id = ? AND text LIKE ? ESCAPE '\\' ORDER BY page_number ASC`
  ).all(documentId, likePattern) as { page_number: number; text: string }[]

  const results: DocumentSearchMatch[] = []
  const q = query.trim().toLowerCase()
  for (const row of rows) {
    const text = row.text ?? ''
    const lower = text.toLowerCase()
    let count = 0
    let idx = 0
    while ((idx = lower.indexOf(q, idx)) !== -1) {
      count++
      idx += q.length
    }
    const firstIdx = lower.indexOf(q)
    let snippet = ''
    if (firstIdx !== -1) {
      const start = Math.max(0, firstIdx - 30)
      const end = Math.min(text.length, firstIdx + query.length + 40)
      snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
    }
    results.push({ page_number: row.page_number, match_count: count, snippet })
  }
  return results
}

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

/**
 * Retry text extraction for an existing document using Anthropic Vision API.
 *
 * Retrieves the encrypted PDF blob from vault_documents, decrypts it, and
 * kicks off `runExtractionJobWithVision` as a fire-and-forget job. The caller
 * should poll document status (extraction_status will go pending → success/failed).
 */
export async function retryDocumentWithVision(
  db: any,
  tier: VaultTier,
  kek: Buffer,
  documentId: string,
  anthropicApiKey: string,
): Promise<void> {
  requireHsContextAccess(tier, 'write')

  // Retrieve and decrypt the existing PDF blob
  const docContent = await getProfileDocumentContent(db, tier, kek, documentId)

  // Fire-and-forget — return quickly so the RPC caller gets an immediate response
  setImmediate(() => {
    runExtractionJobWithVision(db, documentId, docContent.content, anthropicApiKey)
      .catch((err: any) => {
        console.error(`[HS PROFILE] Vision retry failed for doc ${documentId}:`, err?.message)
        try {
          markDocumentExtractionFailed(db, documentId, err?.message || 'Vision extraction failed unexpectedly')
        } catch { /* best-effort */ }
      })
  })
}
