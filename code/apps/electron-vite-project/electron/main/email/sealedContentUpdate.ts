/**
 * Sealed content update helpers — Phase B, PR B-7 / B-7.2.
 *
 * Provides the read-modify-validate-seal-write pattern (Decision A) for
 * content updates that occur AFTER a row has been initially sealed:
 *
 *   resealWithAiAnalysis       — adds/updates `ai_analysis_json` in the canonical
 *                                content and produces a fresh seal.
 *   resealWithPdfExtraction    — updates the parent message's canonical content to
 *                                include the attachment's extraction result
 *                                (`extracted_text_sha256`, `content_sha256`, status)
 *                                and re-seals the parent row, with `inbox_attachments`
 *                                child writes (actual text + hashes) inside the
 *                                same sealed transaction.
 *   resealWithDecryptedContent — seals a PENDING (unsealed) inbox row that was
 *                                written by the pre-B-4 qBEAP pending path.  Takes
 *                                the decrypted canonical JSON, validates it, and
 *                                writes the row + seal atomically.  Refuses to
 *                                overwrite rows that already carry a valid seal.
 *
 * All helpers:
 *   1. Validate the new content with validatorOrchestrator.validate().
 *   2. Write through prepareSealedUpdate + runSealedTransaction.
 *   3. Return { ok: false, error } with no write on any failure.
 *
 * per Phase B Architecture, PR B-7 / B-7.2, Decisions A–D.
 */

import { createHash } from 'crypto'
import { prepareSealedUpdate, runSealedTransaction, sealedQuery, type SealedRow } from '../sealed-storage/index'
import { validatorOrchestrator } from '../validation/inProcessValidator'
import type { ProvenanceMetadata } from '@repo/ingestion-core'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ResealResult {
  ok: boolean
  error?: string
}

interface InboxSealedRow extends SealedRow {
  id: string
  depackaged_json: string
  ai_analysis_json?: string | null
}

export interface PdfExtractionData {
  text: string
  status: string
  error: string | null
  contentSha256: string
  extractedTextSha256: string
  pageCount: number | null
}

/**
 * Parameters for `resealWithDecryptedContent`.
 *
 * `rawCapsuleJson` is the validator's input — the decrypted qBEAP capsule JSON
 * exactly as returned by `decryptQBeapPackage().rawCapsuleJson`.
 */
export interface DecryptedQbeapResealParams {
  /** ID of the inbox_messages row to update. Must be an unsealed pending row. */
  rowId: string
  /** Raw capsule JSON (validator input). Must be the canonical, unmodified capsule. */
  rawCapsuleJson: string
  /** Decrypted body text for the body_text column. */
  bodyText: string
  /** Decrypted subject for the subject column. */
  subject: string | null
  /** Structured metadata stored in the depackaged_metadata column (will be JSON-serialised). */
  depackagedMetadata: Record<string, unknown>
  /** Provenance for the validator call (caller builds via buildP2PProvenance etc.). */
  provenance: ProvenanceMetadata
  /** Number of decrypted attachments (0 when none). */
  attachmentCount: number
  /**
   * Optional child writes to execute inside the sealed transaction.
   * Use this for attachment-row INSERTs/UPDATEs that must be atomic with the
   * parent UPDATE.  Each lambda is called inside the SQLite transaction opened
   * by runSealedTransaction, after the parent UPDATE succeeds.
   */
  childWrites?: Array<() => void>
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL constants
// ─────────────────────────────────────────────────────────────────────────────

/** Re-seal UPDATE for AI analysis additions. Writes new depackaged_json + ai_analysis_json column + seal. */
const RESEAL_AI_ANALYSIS_SQL = `
  UPDATE inbox_messages SET
    depackaged_json = ?,
    ai_analysis_json = ?,
    embedding_status = 'pending',
    validated_at = ?,
    validator_version = ?,
    validation_reason = NULL,
    seal = ?,
    seal_input_json = ?
  WHERE id = ?
`

/** Re-seal UPDATE for PDF extraction. Updates canonical content (new attachment hashes) + seal.
 *  `inbox_attachments` child writes (extracted_text etc.) are handled inside runSealedTransaction. */
const RESEAL_PDF_PARENT_SQL = `
  UPDATE inbox_messages SET
    depackaged_json = ?,
    embedding_status = 'pending',
    validated_at = ?,
    validator_version = ?,
    validation_reason = NULL,
    seal = ?,
    seal_input_json = ?
  WHERE id = ?
`

const UPDATE_ATTACHMENT_EXTRACTION_SQL = `
  UPDATE inbox_attachments SET
    extracted_text = ?,
    text_extraction_status = ?,
    text_extraction_error = ?,
    content_sha256 = ?,
    extracted_text_sha256 = ?,
    page_count = ?
  WHERE id = ?
`

/**
 * First-time sealed UPDATE for a pending (unsealed) inbox row.
 * Equivalent to the removed `P2P_INBOX_SEALED_BACKFILL_UPDATE_SQL` constant
 * that lived in beapEmailIngestion.ts before B-7.2.
 * Used by `resealWithDecryptedContent` (PR B-7.2).
 */
const RESEAL_DECRYPTED_CONTENT_SQL = `
  UPDATE inbox_messages SET
    depackaged_json = ?,
    depackaged_metadata = ?,
    body_text = ?,
    subject = ?,
    has_attachments = ?,
    attachment_count = ?,
    embedding_status = 'pending',
    validated_at = ?,
    validator_version = ?,
    validation_reason = ?,
    seal = ?,
    seal_input_json = ?
  WHERE id = ?
`

// ─────────────────────────────────────────────────────────────────────────────
// Internal: read existing canonical content for re-seal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the existing canonical content for `messageId`.
 *
 * Uses `sealedQuery` to verify the existing seal. On seal failure the row is
 * returned only if it has no seal at all (pre-Phase-B rows are forward-migrated).
 * If the row has a seal but sealedQuery rejected it, the row is considered
 * tampered and re-sealing is refused.
 */
function readCanonicalForReseal(
  db: any,
  messageId: string,
): { canonicalContent: Record<string, unknown>; rawAiAnalysis: string | null } | { error: string } {
  const sealedRows = sealedQuery<InboxSealedRow>(
    db,
    'SELECT id, depackaged_json, seal, seal_input_json, ai_analysis_json, seal_key_source FROM inbox_messages WHERE id = ?',
    [messageId],
    'depackaged_json',
  )

  if (sealedRows.length > 0) {
    const row = sealedRows[0]
    return {
      canonicalContent: parseCanonical(row.depackaged_json),
      rawAiAnalysis: row.ai_analysis_json ?? null,
    }
  }

  // sealedQuery returned nothing — check whether the row exists at all.
  const rawRow = db.prepare(
    'SELECT id, depackaged_json, seal, ai_analysis_json FROM inbox_messages WHERE id = ?',
  ).get(messageId) as InboxSealedRow | undefined

  if (!rawRow) return { error: 'Row not found' }

  if (typeof rawRow.seal === 'string' && rawRow.seal.length > 0) {
    // Row has a seal but it failed sealedQuery's verification — treat as tampered.
    return { error: 'Seal verification failed — row may be tampered; re-seal refused' }
  }

  // No seal — pre-Phase B row; allow forward-migration (first-time sealing).
  console.warn(`[B-7] Forward-migrating unsealed row ${messageId} to sealed content on write.`)
  return {
    canonicalContent: parseCanonical(rawRow.depackaged_json),
    rawAiAnalysis: rawRow.ai_analysis_json ?? null,
  }
}

function parseCanonical(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {}
  try {
    const p = JSON.parse(json)
    if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>
  } catch { /* non-JSON or empty */ }
  return {}
}

function buildProvenance(messageId: string, canonicalJson: string, now: string): ProvenanceMetadata {
  return {
    source_type: 'internal',
    origin_classification: 'internal',
    ingested_at: now,
    transport_metadata: { message_id: messageId },
    input_classification: 'beap_capsule_present',
    raw_input_hash: createHash('sha256').update(canonicalJson, 'utf8').digest('hex'),
    ingestor_version: '1.1.0',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// resealWithAiAnalysis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-seal an inbox message row after adding or updating its `ai_analysis_json`
 * canonical field.
 *
 * Pattern (Decision A):
 *   1. Read existing sealed canonical content (sealedQuery verifies).
 *   2. Merge `aiAnalysisData` into the canonical object as `ai_analysis_json`.
 *   3. Call validatorOrchestrator.validate() — get fresh seal.
 *   4. runSealedTransaction: UPDATE inbox_messages (depackaged_json + ai_analysis_json + seal).
 *
 * On any failure returns `{ ok: false, error }` and leaves the original row unchanged.
 *
 * per Phase B Architecture, PR B-7, Decisions A, C.
 */
export async function resealWithAiAnalysis(
  db: any,
  messageId: string,
  aiAnalysisData: Record<string, unknown> | null,
): Promise<ResealResult> {
  try {
    const readResult = readCanonicalForReseal(db, messageId)
    if ('error' in readResult) {
      return { ok: false, error: readResult.error }
    }

    const { canonicalContent } = readResult
    // Clone canonical content and add/update ai_analysis_json.
    const updatedContent: Record<string, unknown> = { ...canonicalContent }
    if (aiAnalysisData === null) {
      delete updatedContent['ai_analysis_json']
    } else {
      updatedContent['ai_analysis_json'] = aiAnalysisData
    }

    const canonicalJson = JSON.stringify(updatedContent)
    const now = new Date().toISOString()

    const resp = await validatorOrchestrator.validate({
      envelope: { message_id: messageId },
      plaintext_or_encrypted: { kind: 'plaintext', content: canonicalJson },
      provenance: buildProvenance(messageId, canonicalJson, now),
      target_row_id: messageId,
    })

    if (!resp.outcome.ok) {
      const reason = resp.outcome.sealed_quarantine?.rejection_reason ?? 'VALIDATOR_REJECTED'
      return {
        ok: false,
        error: `AI analysis could not be persisted: validator rejected with reason ${reason}`,
      }
    }

    const sealed = resp.outcome.sealed
    const sealedUpdate = prepareSealedUpdate(db, RESEAL_AI_ANALYSIS_SQL)

    runSealedTransaction(
      db,
      sealedUpdate,
      [
        sealed.canonical_json,
        aiAnalysisData !== null ? JSON.stringify(aiAnalysisData) : null,
        sealed.validated_at,
        sealed.validator_version,
        sealed.seal,
        sealed.seal_input_json,
        messageId,
      ],
      {
        seal: sealed.seal,
        seal_input_json: sealed.seal_input_json,
        canonical_json: sealed.canonical_json,
        row_id: messageId,
      },
      [],
    )

    console.log(`[B-7] Re-sealed row ${messageId} with ai_analysis_json (${aiAnalysisData === null ? 'cleared' : 'set'}).`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? 'resealWithAiAnalysis failed' }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// resealWithPdfExtraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-seal an inbox message row after PDF text has been extracted from one of
 * its attachments.
 *
 * Pattern (Decision A + Decision B):
 *   1. Read parent message's canonical content (sealedQuery verifies).
 *   2. Update/insert the `attachments_canonical` entry for `attachmentId`:
 *      set `content_sha256`, `extracted_text_sha256`, `text_extraction_status`.
 *      The full extracted text is stored in `inbox_attachments` (child write);
 *      only the SHA-256 binding lives in canonical content.
 *   3. Call validatorOrchestrator.validate() on the new canonical content.
 *   4. runSealedTransaction: UPDATE inbox_messages (depackaged_json + seal) +
 *      UPDATE inbox_attachments (extracted_text + hashes) as child write.
 *
 * On any failure returns `{ ok: false, error }` and leaves both rows unchanged.
 *
 * per Phase B Architecture, PR B-7, Decisions A, B.
 */
export async function resealWithPdfExtraction(
  db: any,
  attachmentId: string,
  extraction: PdfExtractionData,
): Promise<ResealResult> {
  try {
    // Look up the parent message.
    const attRow = db
      .prepare('SELECT message_id FROM inbox_attachments WHERE id = ?')
      .get(attachmentId) as { message_id: string } | undefined
    if (!attRow?.message_id) {
      return { ok: false, error: `Attachment ${attachmentId} not found or has no parent message` }
    }
    const messageId = attRow.message_id

    const readResult = readCanonicalForReseal(db, messageId)
    if ('error' in readResult) {
      return { ok: false, error: readResult.error }
    }

    const { canonicalContent } = readResult
    const updatedContent: Record<string, unknown> = { ...canonicalContent }

    // Update or insert the attachment's canonical entry.
    if (!Array.isArray(updatedContent['attachments_canonical'])) {
      updatedContent['attachments_canonical'] = []
    }
    const canonical = updatedContent['attachments_canonical'] as Array<Record<string, unknown>>
    const idx = canonical.findIndex((a) => a['attachment_id'] === attachmentId)
    const updatedEntry: Record<string, unknown> = idx >= 0 ? { ...canonical[idx] } : { attachment_id: attachmentId }
    updatedEntry['content_sha256'] = extraction.contentSha256
    updatedEntry['extracted_text_sha256'] = extraction.extractedTextSha256
    updatedEntry['text_extraction_status'] = extraction.status
    if (idx >= 0) {
      canonical[idx] = updatedEntry
    } else {
      canonical.push(updatedEntry)
    }

    const canonicalJson = JSON.stringify(updatedContent)
    const now = new Date().toISOString()

    const resp = await validatorOrchestrator.validate({
      envelope: { message_id: messageId },
      plaintext_or_encrypted: { kind: 'plaintext', content: canonicalJson },
      provenance: buildProvenance(messageId, canonicalJson, now),
      target_row_id: messageId,
    })

    if (!resp.outcome.ok) {
      const reason = resp.outcome.sealed_quarantine?.rejection_reason ?? 'VALIDATOR_REJECTED'
      return {
        ok: false,
        error: `PDF extraction result could not be persisted: validator rejected with reason ${reason}`,
      }
    }

    const sealed = resp.outcome.sealed
    const sealedUpdate = prepareSealedUpdate(db, RESEAL_PDF_PARENT_SQL)

    const updateAttachment = db.prepare(UPDATE_ATTACHMENT_EXTRACTION_SQL)
    const childWrites: Array<() => void> = [
      () =>
        updateAttachment.run(
          extraction.text,
          extraction.status,
          extraction.error,
          extraction.contentSha256,
          extraction.extractedTextSha256,
          extraction.pageCount,
          attachmentId,
        ),
    ]

    runSealedTransaction(
      db,
      sealedUpdate,
      [
        sealed.canonical_json,
        sealed.validated_at,
        sealed.validator_version,
        sealed.seal,
        sealed.seal_input_json,
        messageId,
      ],
      {
        seal: sealed.seal,
        seal_input_json: sealed.seal_input_json,
        canonical_json: sealed.canonical_json,
        row_id: messageId,
      },
      childWrites,
    )

    console.log(`[B-7] Re-sealed row ${messageId} with PDF extraction for attachment ${attachmentId}.`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? 'resealWithPdfExtraction failed' }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// resealWithDecryptedContent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seal a PENDING (unsealed) inbox row after qBEAP decryption.
 *
 * This is the canonical helper for the `retryPendingQbeapDecrypt` path.  Any
 * code path that decrypts qBEAP content and needs to write it into an existing
 * unsealed row must use this function — never raw `db.prepare().run()`.
 *
 * Pattern (Decision A, PR B-7.2):
 *   1. Verify the target row is unsealed (seal IS NULL or '').
 *      If the row already carries a seal, refuse — the row was sealed at ingest
 *      and re-sealing it through this helper would be incorrect.  Use
 *      resealWithAiAnalysis / resealWithPdfExtraction for sealed rows.
 *   2. Call validatorOrchestrator.validate() with rawCapsuleJson.
 *   3. On failure (validator rejects OR subprocess unavailable): return
 *      { ok: false, error }; no write occurs.  The row stays in its pending
 *      state and may be retried later.
 *   4. On success: prepareSealedUpdate + runSealedTransaction.  Optional
 *      childWrites (e.g. attachment-row INSERTs/UPDATEs) execute inside the
 *      same SQLite transaction — atomically bound to the parent UPDATE.
 *
 * Failure-path matrix (per Decision B, PR B-7.2):
 *   - Row not found                       → { ok: false, error }; no write
 *   - Row already sealed                  → { ok: false, error }; no write
 *   - Validator rejects content           → { ok: false, error }; no write
 *   - Validator subprocess unavailable    → { ok: false, error }; no write
 *   - DB transaction error                → rolled back; no partial write
 *
 * per Phase B Architecture, PR B-7.2, Decisions A–C.
 */
export async function resealWithDecryptedContent(
  db: any,
  params: DecryptedQbeapResealParams,
): Promise<ResealResult> {
  const {
    rowId,
    rawCapsuleJson,
    bodyText,
    subject,
    depackagedMetadata,
    provenance,
    attachmentCount,
    childWrites,
  } = params

  try {
    // 1. Verify the row is pending (unsealed).
    const rowCheck = db
      .prepare('SELECT seal FROM inbox_messages WHERE id = ?')
      .get(rowId) as { seal?: string | null } | undefined

    if (!rowCheck) {
      return { ok: false, error: `resealWithDecryptedContent: row ${rowId} not found` }
    }
    if (typeof rowCheck.seal === 'string' && rowCheck.seal.length > 0) {
      return {
        ok: false,
        error:
          `resealWithDecryptedContent: row ${rowId} already carries a seal — ` +
          'use resealWithAiAnalysis or resealWithPdfExtraction for updates to sealed rows',
      }
    }

    // 2. Validate the decrypted canonical content.
    const resp = await validatorOrchestrator.validate({
      envelope: {},
      plaintext_or_encrypted: { kind: 'plaintext', content: rawCapsuleJson },
      provenance,
      target_row_id: rowId,
    })

    if (!resp.outcome.ok) {
      const reason = resp.outcome.sealed_quarantine?.rejection_reason ?? 'VALIDATOR_REJECTED'
      return {
        ok: false,
        error: `resealWithDecryptedContent: validator rejected decrypted content for row ${rowId}: ${reason}`,
      }
    }

    // 3. Write through the sealed gate.
    const sealed = resp.outcome.sealed
    const sealedUpdate = prepareSealedUpdate(db, RESEAL_DECRYPTED_CONTENT_SQL)

    runSealedTransaction(
      db,
      sealedUpdate,
      [
        sealed.canonical_json,
        JSON.stringify(depackagedMetadata),
        bodyText,
        subject ?? '',
        attachmentCount > 0 ? 1 : 0,
        attachmentCount,
        sealed.validated_at,
        sealed.validator_version,
        null, // validation_reason
        sealed.seal,
        sealed.seal_input_json,
        rowId,
      ],
      {
        seal: sealed.seal,
        seal_input_json: sealed.seal_input_json,
        canonical_json: sealed.canonical_json,
        row_id: rowId,
      },
      childWrites ?? [],
    )

    console.log(`[B-7.2] Sealed pending row ${rowId} with decrypted qBEAP content (attCount=${attachmentCount}).`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? 'resealWithDecryptedContent failed' }
  }
}
