/**
 * Document Vault Service — encrypted document storage & retrieval
 * ================================================================
 *
 * Storage model:
 *   All documents are stored as encrypted BLOBs inside the SQLCipher
 *   vault_documents table.  Each document gets its own per-record DEK
 *   (identical envelope encryption to vault_items v2).  Documents are
 *   encrypted in their entirety using XChaCha20-Poly1305 via the shared
 *   envelope primitives (`sealRecord` / `openRecord`).
 *
 * Security invariants:
 *   1.  Capability check (vault.document.read/write) BEFORE any decrypt.
 *   2.  Documents are strictly DATA — no execution path is exposed.
 *       - BLOCKED_EXTENSIONS are rejected at import.
 *       - Content-Type on export is always application/octet-stream.
 *       - Content-Disposition is always "attachment" (no inline).
 *   3.  Content addressing via SHA-256 enables deduplication and
 *       integrity verification.
 *   4.  Size limit enforced at MAX_DOCUMENT_SIZE (50 MB).
 *
 * This module is stateless — it receives `db` and `kek` from VaultService
 * and never stores them.  VaultService is the only holder of key material.
 */

import { createHash, randomBytes } from 'crypto'
import { basename, extname } from 'path'
import { sealRecord, openRecord, ENVELOPE_SCHEMA_VERSION } from './envelope'
import { buildAAD } from './crypto'
import type { VaultDocument, DocumentImportResult } from './types'
import { MAX_DOCUMENT_SIZE, BLOCKED_EXTENSIONS } from './types'
import { canAccessRecordType, type VaultTier } from './types'

// ---------------------------------------------------------------------------
// Policy Layer — file-type allow/block
// ---------------------------------------------------------------------------

/**
 * Sanitise a filename: strip path components, collapse whitespace.
 * Returns the basename only — never contains path separators.
 */
export function sanitiseFilename(raw: string): string {
  // Take basename (removes any path components)
  let name = basename(raw).trim()
  // Collapse multiple spaces / dots
  name = name.replace(/\s+/g, ' ')
  // If empty after sanitising, use a generic name
  if (!name || name === '.') name = 'document'
  return name
}

/**
 * Check whether a file extension is on the block-list.
 * Block-list is the security boundary: anything blocked here CANNOT
 * enter the vault, regardless of MIME type.
 */
export function isBlockedExtension(filename: string): boolean {
  const ext = extname(filename).toLowerCase()
  return BLOCKED_EXTENSIONS.has(ext)
}

/**
 * Detect a safe MIME type from the file extension.
 * We intentionally do NOT trust user-supplied MIME types.
 * Unrecognised extensions get `application/octet-stream`.
 */
export function detectMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase()
  const map: Record<string, string> = {
    '.txt':  'text/plain',
    '.md':   'text/plain',
    '.csv':  'text/csv',
    '.json': 'application/json',
    '.xml':  'text/xml',
    '.pdf':  'application/pdf',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.svg':  'image/svg+xml',
    '.zip':  'application/zip',
    '.gz':   'application/gzip',
    '.tar':  'application/x-tar',
    '.7z':   'application/x-7z-compressed',
    '.rar':  'application/vnd.rar',
    '.doc':  'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls':  'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt':  'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.odt':  'application/vnd.oasis.opendocument.text',
    '.ods':  'application/vnd.oasis.opendocument.spreadsheet',
    '.mp3':  'audio/mpeg',
    '.wav':  'audio/wav',
    '.mp4':  'video/mp4',
    '.webm': 'video/webm',
  }
  return map[ext] || 'application/octet-stream'
}

// ---------------------------------------------------------------------------
// Core document operations
// ---------------------------------------------------------------------------

/**
 * Import (store) a document into the vault.
 *
 * @param db       - Open SQLCipher database handle.
 * @param kek      - Vault-level KEK (in-memory while unlocked).
 * @param tier     - User's subscription tier (for capability check).
 * @param filename - Original filename.
 * @param data     - Raw plaintext file content as a Buffer.
 * @param notes    - Optional user notes / tags.
 * @param vaultId  - Vault identifier (for AAD binding).
 * @returns Import result with document metadata and deduplication flag.
 */
export async function importDocument(
  db: any,
  kek: Buffer,
  tier: VaultTier,
  filename: string,
  data: Buffer,
  notes: string = '',
  vaultId: string = 'default',
): Promise<DocumentImportResult> {
  // ── 1. Capability gate (fail-closed) ──
  if (!canAccessRecordType(tier, 'document', 'write')) {
    throw new Error(`Tier "${tier}" cannot write document records. Upgrade to Pro or higher.`)
  }

  // ── 2. Filename policy ──
  const safeName = sanitiseFilename(filename)
  if (isBlockedExtension(safeName)) {
    throw new Error(
      `File type "${extname(safeName)}" is blocked for security reasons. ` +
      `Executable and script files cannot be stored in the Document Vault.`
    )
  }

  // ── 3. Size limit ──
  if (data.length > MAX_DOCUMENT_SIZE) {
    throw new Error(
      `Document size (${(data.length / 1024 / 1024).toFixed(1)} MB) exceeds the ` +
      `${MAX_DOCUMENT_SIZE / 1024 / 1024} MB limit.`
    )
  }

  // ── 4. Content addressing ──
  const sha256 = createHash('sha256').update(data).digest('hex')

  // ── 5. Deduplication check ──
  const existing = db.prepare(
    'SELECT id, filename, mime_type, size_bytes, sha256, notes, created_at, updated_at FROM vault_documents WHERE sha256 = ?'
  ).get(sha256)

  if (existing) {
    console.log(`[DOC VAULT] Deduplicated — SHA-256 ${sha256.slice(0, 12)}… already stored as ${existing.id}`)
    return {
      document: rowToDocument(existing),
      deduplicated: true,
    }
  }

  // ── 6. Encrypt document content ──
  // We reuse sealRecord: the "fieldsJson" param is just a string — works for any payload.
  // AAD binds the ciphertext to this vault and the 'document' record type.
  const contentStr = data.toString('base64')
  const aad = buildAAD(vaultId, 'document', ENVELOPE_SCHEMA_VERSION)
  const { wrappedDEK, ciphertext } = await sealRecord(contentStr, kek, aad)

  // ── 7. Detect MIME type (from extension, never trusted for execution) ──
  const mimeType = detectMimeType(safeName)

  // ── 8. Store ──
  const id = randomBytes(16).toString('hex')
  const now = Date.now()

  db.prepare(
    `INSERT INTO vault_documents
       (id, filename, mime_type, size_bytes, sha256, wrapped_dek, ciphertext, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, safeName, mimeType, data.length, sha256, wrappedDEK, ciphertext, notes, now, now)

  console.log(`[DOC VAULT] ✅ Imported "${safeName}" (${(data.length / 1024).toFixed(1)} KB, sha256=${sha256.slice(0, 12)}…)`)

  const doc: VaultDocument = {
    id,
    filename: safeName,
    mime_type: mimeType,
    size_bytes: data.length,
    sha256,
    notes,
    created_at: now,
    updated_at: now,
  }

  return { document: doc, deduplicated: false }
}

/**
 * Retrieve and decrypt a document.
 *
 * @param vaultId - Vault identifier (for AAD binding).
 * @returns Object with metadata + decrypted content as Buffer.
 */
export async function getDocument(
  db: any,
  kek: Buffer,
  tier: VaultTier,
  documentId: string,
  vaultId: string = 'default',
): Promise<{ document: VaultDocument; content: Buffer }> {
  // ── 1. Capability gate (BEFORE decrypt) ──
  if (!canAccessRecordType(tier, 'document', 'read')) {
    throw new Error(`Tier "${tier}" cannot read document records. Upgrade to Pro or higher.`)
  }

  // ── 2. Fetch row ──
  const row = db.prepare(
    'SELECT * FROM vault_documents WHERE id = ?'
  ).get(documentId)

  if (!row) {
    throw new Error('Document not found')
  }

  // ── 3. Decrypt (with AAD binding to vault + document record type) ──
  const wrappedDEK = Buffer.from(row.wrapped_dek)
  const ciphertext = Buffer.from(row.ciphertext)
  const aad = buildAAD(vaultId, 'document', ENVELOPE_SCHEMA_VERSION)
  const decryptedArr = await openRecord(wrappedDEK, ciphertext, kek, aad)
  // openRecord returns JSON.parse result; our payload was a base64 string,
  // so the result is that string.
  const base64Content = typeof decryptedArr === 'string'
    ? decryptedArr
    : (Array.isArray(decryptedArr) ? decryptedArr[0] : String(decryptedArr))
  const content = Buffer.from(base64Content, 'base64')

  console.log(`[DOC VAULT] ✅ Decrypted "${row.filename}" (${content.length} bytes)`)

  return {
    document: rowToDocument(row),
    content,
  }
}

/**
 * List all documents (metadata only — NO decryption).
 */
export function listDocuments(
  db: any,
  tier: VaultTier,
): VaultDocument[] {
  // ── Capability gate ──
  if (!canAccessRecordType(tier, 'document', 'read')) {
    return [] // fail-closed: empty list for unauthorised tiers
  }

  const rows = db.prepare(
    'SELECT id, filename, mime_type, size_bytes, sha256, notes, created_at, updated_at FROM vault_documents ORDER BY created_at DESC'
  ).all()

  if (!Array.isArray(rows)) return []

  return rows.map(rowToDocument)
}

/**
 * Delete a document.
 */
export function deleteDocument(
  db: any,
  tier: VaultTier,
  documentId: string,
): void {
  // ── Capability gate ──
  if (!canAccessRecordType(tier, 'document', 'delete')) {
    throw new Error(`Tier "${tier}" cannot delete document records.`)
  }

  const existing = db.prepare('SELECT id FROM vault_documents WHERE id = ?').get(documentId)
  if (!existing) {
    throw new Error('Document not found')
  }

  db.prepare('DELETE FROM vault_documents WHERE id = ?').run(documentId)
  console.log(`[DOC VAULT] ✅ Deleted document ${documentId}`)
}

/**
 * Update document metadata (notes).
 * Content is immutable after import — to change content, delete and re-import.
 */
export function updateDocumentMeta(
  db: any,
  tier: VaultTier,
  documentId: string,
  updates: { notes?: string },
): VaultDocument {
  if (!canAccessRecordType(tier, 'document', 'write')) {
    throw new Error(`Tier "${tier}" cannot write document records.`)
  }

  const existing = db.prepare(
    'SELECT id, filename, mime_type, size_bytes, sha256, notes, created_at, updated_at FROM vault_documents WHERE id = ?'
  ).get(documentId)
  if (!existing) {
    throw new Error('Document not found')
  }

  const now = Date.now()
  const newNotes = updates.notes ?? existing.notes

  db.prepare(
    'UPDATE vault_documents SET notes = ?, updated_at = ? WHERE id = ?'
  ).run(newNotes, now, documentId)

  return rowToDocument({ ...existing, notes: newNotes, updated_at: now })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToDocument(row: any): VaultDocument {
  return {
    id: row.id,
    filename: row.filename,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    sha256: row.sha256,
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
