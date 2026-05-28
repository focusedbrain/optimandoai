/**
 * Merge Stage-5 depackaged BEAP content from the Chromium extension into `inbox_messages`.
 *
 * Phase B, PR B-5: migrated to the sealed-storage pipeline (async, validator subprocess,
 * `runSealedTransaction`, `attachments_canonical` / `content_type: 'beap_message'`).
 *
 * Phase B, PR B-5.1: removed the failure-path bypass.
 *   Previous code wrote operational fields (`validated_at`, `validator_version`,
 *   `validation_reason`) to the shell inbox row on validation failure with no paired
 *   sandbox ("fallback: update shell row with failure state"). Per canon Decision A —
 *   "no write to inbox-bound tables outside the sealed gate" — even operational-field-only
 *   writes are prohibited.
 *
 *   New behavior:
 *     - Validation fails, sandbox paired  → sealed quarantine row (unchanged from B-5)
 *     - Validation fails, no sandbox paired → NO write; add to retry buffer; emit UI info
 *       box event.  `drainExtensionMergeBuffer` processes pending entries when a sandbox
 *       becomes available or on a periodic timer.
 *
 * Keys rows by exact `beap_package_json` match.
 *
 * @version 1.1.0 (Phase B, PR B-5.1)
 */

import { createHash, randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { writeEncryptedAttachmentFile } from './attachmentBlobCrypto'
import {
  makeInboxAttachmentStorageId,
  buildQuarantineCanonicalJson,
  findPairedSandboxHandshake,
} from './messageRouter'
import { validatorOrchestrator } from '../validation/inProcessValidator'
import { prepareSealedUpdate, prepareSealedInsert, prepareSealedOperationalUpdate, runSealedTransaction } from '../sealed-storage/index'
import { encryptForQuarantine } from '../quarantine-encrypt/index'
import { writeQuarantineBlob } from '../quarantine-blob-storage/index'
import type { SSOSession } from '../handshake/types'
import type { ProvenanceMetadata } from '@repo/ingestion-core'
import {
  addPendingMerge,
  removePendingMerge,
  getAllPendingMerges,
  getPendingMergeCount,
  MAX_EXTENSION_MERGE_RETRY,
  type PendingExtensionMerge,
} from './extensionMergeRetryBuffer'
import {
  edgeExtractedTextSha256,
  parsePodDepackagedAttachments,
  verifyEdgeExtractedTextV1,
} from './capsuleExtractedText.js'
import { isPdfFile } from './pdf-extractor.js'

/** Only BeapPackageBuilder user send paths set this (Electron renderer + extension). */
export const USER_PACKAGE_BUILDER_SEND_SOURCE = 'user_package_builder'

export interface MergeDepackagedAttachmentInput {
  content_id: string
  filename: string
  content_type: string
  size_bytes: number
  /** Raw file bytes from extension Stage-5 artefacts (original class). */
  base64?: string | null
}

export interface MergeExtensionDepackagedInput {
  beap_package_json: string
  /** Narrows fallback scan when JSON string equality differs by whitespace. */
  handshake_id?: string | null
  /** PR B-5 / Decision A: canonical capsule plaintext (bytes the Validator approved). */
  depackaged_json: string
  /**
   * PR B-5 / Decision B: wrapper metadata (format, source, verifiedAt) stored
   * separately from validated content. Optional — pre-B-5 callers may omit it.
   */
  depackaged_metadata?: string | null
  body_text?: string | null
  attachments?: MergeDepackagedAttachmentInput[]
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sealed UPDATE for inbox_messages rows reached by the extension Stage-5 merge.
 * Verified by `prepareSealedUpdate` before execution.
 */
const MERGE_INBOX_SEALED_UPDATE_SQL = `
  UPDATE inbox_messages SET
    depackaged_json = ?,
    depackaged_metadata = COALESCE(?, depackaged_metadata),
    body_text = COALESCE(?, body_text),
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

/** Quarantine INSERT for merge-path validation failures. */
const MERGE_QUARANTINE_INSERT_SQL = `
  INSERT INTO quarantine_messages (
    id, transport_sender, transport_received_at, transport_folder,
    blob_size_bytes, blob_storage_id, blob_sha256, rejection_reason,
    paired_sandbox_handshake_id,
    seal, seal_input_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizePackageJson(s: string): string {
  const t = (s ?? '').trim()
  if (!t) return ''
  try {
    return JSON.stringify(JSON.parse(t))
  } catch {
    return t
  }
}

/**
 * Emit `inbox:mergePendingNoSandbox` to all renderer windows.
 * The renderer surfaces an info box when `pendingCount > 0` and clears it when 0.
 *
 * per Phase B Architecture, PR B-5.1, Decision B.
 */
function notifyMergePendingNoSandbox(pendingCount: number): void {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send('inbox:mergePendingNoSandbox', { pendingCount })
      }
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * Attempt a quarantine write for a merge validation failure.
 *
 * Returns `true` on success (quarantine row written), `false` on failure (no sandbox
 * available, encryption error, or validator rejection of quarantine content).
 *
 * per Phase B Architecture, PR B-5.1, Decision D.
 */
async function attemptQuarantineWrite(
  db: any,
  packageJson: string,
  rowId: string,
  rejectionReason: string,
  provenance: ProvenanceMetadata,
  now: string,
  session: SSOSession | null | undefined,
): Promise<boolean> {
  const sandbox = findPairedSandboxHandshake(db, session)
  if (!sandbox) return false

  try {
    const quarantineId = randomUUID()
    const blobBytes = Buffer.from(packageJson, 'utf-8')
    const encResult = encryptForQuarantine(blobBytes, sandbox.peer_x25519_public_key_b64)
    if (!encResult.ok) {
      console.warn('[MERGE] encryptForQuarantine failed:', encResult.error)
      return false
    }
    const writeResult = writeQuarantineBlob(encResult.blob)
    const storageId = writeResult.storage_id
    const blobSha256 = writeResult.blob_sha256
    const blobSize = writeResult.blob_size_bytes

    const canonicalQ = buildQuarantineCanonicalJson({
      id: quarantineId,
      blob_storage_id: storageId,
      blob_sha256: blobSha256,
      rejection_reason: rejectionReason,
      paired_sandbox_handshake_id: sandbox.handshake_id,
    })

    const qResp = await validatorOrchestrator.validate({
      envelope: { beap_package_json: packageJson },
      plaintext_or_encrypted: { kind: 'plaintext', content: canonicalQ },
      provenance: { ...provenance, input_classification: 'beap_capsule_malformed' },
      target_row_id: quarantineId,
    })

    if (!qResp.outcome.ok) {
      console.warn('[MERGE] Quarantine content validator rejected:', qResp.outcome.sealed_quarantine?.rejection_reason)
      return false
    }

    const qSealed = qResp.outcome.sealed
    const insertQ = prepareSealedInsert(db, MERGE_QUARANTINE_INSERT_SQL)
    db.transaction(() => {
      insertQ.run(
        [
          quarantineId,
          null,
          now,
          'extension_merge',
          blobSize,
          storageId,
          blobSha256,
          rejectionReason,
          sandbox.handshake_id,
          qSealed.seal,
          qSealed.seal_input_json,
        ],
        {
          seal: qSealed.seal,
          seal_input_json: qSealed.seal_input_json,
          canonical_json: qSealed.canonical_json,
          row_id: quarantineId,
        },
      )
    })()

    console.log('[MERGE] Quarantine row written:', quarantineId, 'for inbox row:', rowId)
    return true
  } catch (err) {
    console.warn('[MERGE] attemptQuarantineWrite failed:', (err as Error)?.message)
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge Stage-5 depackaged BEAP content from the Chromium extension.
 *
 * Phase B, PR B-5: now **async**; routes through the sealed-storage gate.
 * Phase B, PR B-5.1: no unsealed writes under any failure mode.
 *
 * @param db      better-sqlite3 Database instance.
 * @param input   Payload from `POST /api/inbox/merge-depackaged`.
 * @param session SSO session — used for sandbox lookup in the quarantine/retry path.
 */
export async function mergeExtensionDepackaged(
  db: any,
  input: MergeExtensionDepackagedInput,
  session?: SSOSession | null,
): Promise<{ ok: boolean; messageId?: string; handshakeId?: string | null; error?: string }> {
  if (!db) return { ok: false, error: 'Database unavailable' }
  const rawPkg = typeof input.beap_package_json === 'string' ? input.beap_package_json.trim() : ''
  if (!rawPkg) return { ok: false, error: 'beap_package_json required' }
  const depackaged = typeof input.depackaged_json === 'string' ? input.depackaged_json.trim() : ''
  if (!depackaged) return { ok: false, error: 'depackaged_json required' }

  const norm = normalizePackageJson(rawPkg)

  // ── Row lookup ───────────────────────────────────────────────────────────
  let row = db
    .prepare('SELECT id, handshake_id FROM inbox_messages WHERE beap_package_json = ? LIMIT 1')
    .get(rawPkg) as { id: string; handshake_id: string | null } | undefined

  if (!row && norm !== rawPkg) {
    row = db
      .prepare('SELECT id, handshake_id FROM inbox_messages WHERE beap_package_json = ? LIMIT 1')
      .get(norm) as { id: string; handshake_id: string | null } | undefined
  }

  if (!row) {
    const hid =
      typeof input.handshake_id === 'string' && input.handshake_id.trim()
        ? input.handshake_id.trim()
        : null
    const candidates = hid
      ? (db
          .prepare(
            `SELECT id, handshake_id, beap_package_json FROM inbox_messages
             WHERE source_type = 'direct_beap' AND beap_package_json IS NOT NULL AND handshake_id = ?`,
          )
          .all(hid) as Array<{ id: string; handshake_id: string | null; beap_package_json: string }>)
      : (db
          .prepare(
            `SELECT id, handshake_id, beap_package_json FROM inbox_messages
             WHERE source_type = 'direct_beap' AND beap_package_json IS NOT NULL`,
          )
          .all() as Array<{ id: string; handshake_id: string | null; beap_package_json: string }>)
    for (const c of candidates) {
      if (normalizePackageJson(c.beap_package_json) === norm) {
        row = { id: c.id, handshake_id: c.handshake_id }
        break
      }
    }
  }

  if (!row) {
    return { ok: false, error: 'No inbox row matches this package (sync after main-process ingest?)' }
  }

  const now = new Date().toISOString()

  // ── Body text ────────────────────────────────────────────────────────────
  const bodyText: string | null =
    input.body_text !== undefined && input.body_text !== null
      ? String(input.body_text).slice(0, 120_000)
      : null

  let parsedDepackagedEarly: Record<string, unknown> = {}
  try {
    const p = JSON.parse(depackaged)
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      parsedDepackagedEarly = p as Record<string, unknown>
    }
  } catch {
    /* non-JSON depackaged */
  }

  // ── Build attachments_canonical (Att-2 — Phase B PR B-5) ──────────────────
  const atts = Array.isArray(input.attachments) ? input.attachments : []
  const attachmentsCanonical: Array<{
    attachment_id: string
    filename: string
    content_type: string
    size_bytes: number
    content_sha256: string | null
    extracted_text_sha256?: string | null
    text_extraction_status?: string | null
  }> = []

  interface ProcessedAttachment {
    cid: string
    attId: string
    fname: string
    ctype: string
    sizeBytes: number
    buf: Buffer | null
    sha256: string | null
    extractedText: string | null
    extractionStatus: string | null
    extractionError: string | null
    extractedTextSha256: string | null
  }
  const processedAtts: ProcessedAttachment[] = []

  for (const a of atts) {
    const cid = typeof a.content_id === 'string' && a.content_id.trim() ? a.content_id.trim() : randomUUID()
    const attId = makeInboxAttachmentStorageId(row.id, cid)
    const fname = (a.filename || 'attachment').slice(0, 500)
    const ctype = (a.content_type || 'application/octet-stream').slice(0, 200)
    const sizeBytes = typeof a.size_bytes === 'number' && a.size_bytes >= 0 ? a.size_bytes : 0

    let buf: Buffer | null = null
    let sha256: string | null = null
    if (a.base64 && typeof a.base64 === 'string' && a.base64.length > 0) {
      try {
        const decoded = Buffer.from(a.base64, 'base64')
        if (decoded.length > 0) {
          buf = decoded
          sha256 = createHash('sha256').update(decoded).digest('hex')
        }
      } catch {
        /* base64 decode failed — treat as metadata-only */
      }
    }

    let extractedText: string | null = null
    let extractionStatus: string | null = null
    let extractionError: string | null = null
    let extractedTextSha256: string | null = null
    if (isPdfFile(ctype, fname) && buf && buf.length > 0) {
      extractionStatus = 'consent_required'
    }

    processedAtts.push({
      cid,
      attId,
      fname,
      ctype,
      sizeBytes: buf ? buf.length : sizeBytes,
      buf,
      sha256,
      extractedText,
      extractionStatus,
      extractionError,
      extractedTextSha256,
    })
    attachmentsCanonical.push({
      attachment_id: attId,
      filename: fname,
      content_type: ctype,
      size_bytes: buf ? buf.length : sizeBytes,
      content_sha256: sha256,
      extracted_text_sha256: extractedTextSha256,
      ...(extractionStatus ? { text_extraction_status: extractionStatus } : {}),
    })
  }

  const podAttachments = parsePodDepackagedAttachments(parsedDepackagedEarly)
  for (const pa of processedAtts) {
    const podAtt = podAttachments.find(
      (p) => p.id === pa.cid || p.id === pa.attId || makeInboxAttachmentStorageId(row.id, p.id) === pa.attId,
    )
    if (!podAtt?.extracted_text_v1) continue
    const v1 = podAtt.extracted_text_v1
    if (!verifyEdgeExtractedTextV1(v1)) {
      pa.extractionStatus = 'failed'
      pa.extractionError = 'edge_extracted_text_hash_mismatch'
      continue
    }
    pa.extractedText = v1.text
    pa.extractedTextSha256 = edgeExtractedTextSha256(v1.text)
    pa.extractionStatus = 'edge_extracted'
    pa.extractionError = null
    const canon = attachmentsCanonical.find((c) => c.attachment_id === pa.attId)
    if (canon) {
      canon.extracted_text_sha256 = pa.extractedTextSha256
      canon.text_extraction_status = 'edge_extracted'
    }
  }

  // ── Build canonical content (content_type: 'beap_message') ───────────────
  const canonicalContent: Record<string, unknown> = {
    ...parsedDepackagedEarly,
    content_type: 'beap_message',
    attachments_canonical: attachmentsCanonical,
  }
  const canonicalJson = JSON.stringify(canonicalContent)

  const depackagedMeta =
    typeof input.depackaged_metadata === 'string' && input.depackaged_metadata.trim()
      ? input.depackaged_metadata.trim()
      : null

  console.log('[MERGE] Received merge request:', {
    hasDepackagedJson: !!depackaged,
    depackagedLength: depackaged.length,
    bodyTextLength: bodyText != null ? bodyText.length : null,
    attachmentCount: atts.length,
    attachmentsCanonicalCount: attachmentsCanonical.length,
    packageJsonSnippet: rawPkg.slice(0, 100),
    messageId: row.id,
  })

  // ── Provenance ───────────────────────────────────────────────────────────
  const provenance: ProvenanceMetadata = {
    source_type: 'extension',
    origin_classification: 'internal',
    ingested_at: now,
    transport_metadata: { message_id: row.handshake_id ?? undefined },
    input_classification: 'beap_capsule_present',
    raw_input_hash: createHash('sha256').update(rawPkg, 'utf8').digest('hex'),
    ingestor_version: '1.0.0',
  }

  // ── Validate via subprocess ───────────────────────────────────────────────
  const resp = await validatorOrchestrator.validate({
    envelope: { beap_package_json: rawPkg },
    plaintext_or_encrypted: { kind: 'plaintext', content: canonicalJson },
    provenance,
    target_row_id: row.id,
  })

  // ── Validation success path ───────────────────────────────────────────────
  if (resp.outcome.ok) {
    const sealed = resp.outcome.sealed
    const sealedUpdate = prepareSealedUpdate(db, MERGE_INBOX_SEALED_UPDATE_SQL)

    const hasAtts = processedAtts.length > 0

    const insertAtt = db.prepare(`
      INSERT INTO inbox_attachments (id, message_id, filename, content_type, size_bytes, content_id, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const updateAttBlob = db.prepare(`
      UPDATE inbox_attachments SET filename = ?, content_type = ?, size_bytes = ?, storage_path = ?, content_id = ? WHERE id = ?
    `)
    const updateEnc = db.prepare(`
      UPDATE inbox_attachments SET encryption_key = ?, encryption_iv = ?, encryption_tag = ?, storage_encrypted = ? WHERE id = ?
    `)
    const updateSha = db.prepare(`UPDATE inbox_attachments SET content_sha256 = ? WHERE id = ?`)
    const updatePdf = db.prepare(`
      UPDATE inbox_attachments
      SET extracted_text = ?, text_extraction_status = ?, text_extraction_error = ?,
          extracted_text_sha256 = ?
      WHERE id = ?
    `)

    // Write encrypted attachment files before the transaction (disk I/O outside SQLite txn).
    const attStorageResults: Array<{
      attId: string
      storagePath: string | null
      encKey: string | null
      ivB64: string | null
      tagB64: string | null
      sha256: string | null
      fname: string
      ctype: string
      sizeBytes: number
      cid: string
      extractedText: string | null
      extractionStatus: string | null
      extractionError: string | null
      extractedTextSha256: string | null
    }> = []

    for (const pa of processedAtts) {
      let storagePath: string | null = null
      let encKey: string | null = null
      let ivB64: string | null = null
      let tagB64: string | null = null
      if (pa.buf) {
        try {
          const w = writeEncryptedAttachmentFile(row.id, pa.attId, pa.fname, pa.buf)
          storagePath = w.storagePath
          encKey = w.encryptionKeyStored
          ivB64 = w.ivB64
          tagB64 = w.tagB64
        } catch (e) {
          console.warn('[mergeExtensionDepackaged] attachment write failed:', (e as Error)?.message)
        }
      }
      attStorageResults.push({
        attId: pa.attId,
        storagePath,
        encKey,
        ivB64,
        tagB64,
        sha256: pa.sha256,
        fname: pa.fname,
        ctype: pa.ctype,
        sizeBytes: pa.sizeBytes,
        cid: pa.cid,
        extractedText: pa.extractedText,
        extractionStatus: pa.extractionStatus,
        extractionError: pa.extractionError,
        extractedTextSha256: pa.extractedTextSha256,
      })
    }

    const childWrites: Array<() => void> = attStorageResults.map((r) => () => {
      const existing = db
        .prepare('SELECT id FROM inbox_attachments WHERE id = ?')
        .get(r.attId) as { id: string } | undefined
      if (r.storagePath) {
        if (existing) {
          updateAttBlob.run(r.fname, r.ctype, r.sizeBytes, r.storagePath, r.cid, r.attId)
        } else {
          insertAtt.run(r.attId, row!.id, r.fname, r.ctype, r.sizeBytes, r.cid, r.storagePath, now)
        }
        if (r.encKey) updateEnc.run(r.encKey, r.ivB64, r.tagB64, 1, r.attId)
      } else if (!existing) {
        insertAtt.run(r.attId, row!.id, r.fname, r.ctype, r.sizeBytes, r.cid, null, now)
      }
      if (r.sha256) updateSha.run(r.sha256, r.attId)
      if (r.extractionStatus) {
        updatePdf.run(
          r.extractedText,
          r.extractionStatus,
          r.extractionError,
          r.extractedTextSha256,
          r.attId,
        )
      }
    })

    if (hasAtts) {
      const updateAttCount = prepareSealedOperationalUpdate(
        db,
        `UPDATE inbox_messages SET has_attachments = 1, attachment_count = ? WHERE id = ?`,
      )
      childWrites.push(() => updateAttCount.run(atts.length, row!.id))
    }

    runSealedTransaction(
      db,
      sealedUpdate,
      [
        sealed.canonical_json,
        depackagedMeta,
        bodyText,
        hasAtts ? 1 : 0,
        processedAtts.length,
        sealed.validated_at,
        sealed.validator_version,
        null,
        sealed.seal,
        sealed.seal_input_json,
        row.id,
      ],
      {
        seal: sealed.seal,
        seal_input_json: sealed.seal_input_json,
        canonical_json: sealed.canonical_json,
        row_id: row.id,
      },
      childWrites,
    )

    console.log('[MERGE] Sealed update committed for row:', row.id)
    return { ok: true, messageId: row.id, handshakeId: row.handshake_id }
  }

  // ── Validation failure path — no unseal writes (PR B-5.1) ────────────────
  const rejectionReason = resp.outcome.sealed_quarantine.rejection_reason
  console.warn('[MERGE] Validator rejected merge content:', rejectionReason, 'rowId:', row.id)

  // Try the quarantine path first (sandbox must be paired).
  const quarantineWritten = await attemptQuarantineWrite(
    db, rawPkg, row.id, rejectionReason, provenance, now, session,
  )
  if (quarantineWritten) {
    return { ok: false, messageId: row.id, handshakeId: row.handshake_id, error: `Validation failed: ${rejectionReason}` }
  }

  // No sandbox paired (or quarantine write failed): add to retry buffer.
  // Per B-5.1 Decision A: NO write to inbox tables. Shell row remains in pre-merge state.
  addPendingMerge({
    rowId: row.id,
    packageJson: rawPkg,
    depackagedJson: depackaged,
    depackagedMetadata: depackagedMeta,
    bodyText,
    attachments: atts,
    rejectionReason,
    retryCount: 0,
    firstAttemptAt: now,
  })
  const pending = getPendingMergeCount()
  notifyMergePendingNoSandbox(pending)
  console.warn(
    `[B-5.1] Extension Stage-5 merge failed for row ${row.id}; no sandbox paired. ` +
    `Held in retry buffer. Pending: ${pending}. Rejection: ${rejectionReason}`,
  )

  return {
    ok: false,
    messageId: row.id,
    handshakeId: row.handshake_id,
    error: `Validation failed: ${rejectionReason} (queued for retry — connect a sandbox orchestrator)`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry buffer drain
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drain the extension merge retry buffer.
 *
 * Called:
 *   - On a periodic timer (every 60 seconds, registered in `main.ts`).
 *   - When a P2P BEAP arrives (piggybacked on `P2P_BEAP_RECEIVED` in `main.ts`).
 *
 * For each entry in the buffer:
 *   - If `retryCount >= MAX_EXTENSION_MERGE_RETRY`: drop with loud log.
 *   - If sandbox is now available: attempt quarantine write; on success remove entry.
 *   - If still no sandbox: increment `retryCount` and leave in buffer.
 *
 * After processing, emits `inbox:mergePendingNoSandbox` with the updated count.
 *
 * Returns the number of entries successfully processed (quarantine row written or dropped).
 *
 * per Phase B Architecture, PR B-5.1, Decision C.
 */
export async function drainExtensionMergeBuffer(
  db: any,
  session: SSOSession | null | undefined,
): Promise<number> {
  const entries = getAllPendingMerges()
  if (entries.length === 0) return 0

  let processed = 0
  const now = new Date().toISOString()

  for (const entry of entries) {
    if (entry.retryCount >= MAX_EXTENSION_MERGE_RETRY) {
      removePendingMerge(entry.rowId)
      console.error(
        `[B-5.1] Extension merge retry limit (${MAX_EXTENSION_MERGE_RETRY}) reached for ` +
        `row ${entry.rowId} (first attempt: ${entry.firstAttemptAt}). ` +
        `Shell row remains in pre-merge state. User may delete manually.`,
      )
      processed++
      continue
    }

    const provenance: ProvenanceMetadata = {
      source_type: 'extension',
      origin_classification: 'internal',
      ingested_at: entry.firstAttemptAt,
      transport_metadata: {},
      input_classification: 'beap_capsule_malformed',
      raw_input_hash: createHash('sha256').update(entry.packageJson, 'utf8').digest('hex'),
      ingestor_version: '1.0.0',
    }

    const quarantineWritten = await attemptQuarantineWrite(
      db, entry.packageJson, entry.rowId, entry.rejectionReason, provenance, now, session,
    )

    if (quarantineWritten) {
      removePendingMerge(entry.rowId)
      processed++
    } else {
      // Still no sandbox or quarantine write failed — increment retry count.
      entry.retryCount++
      console.warn(
        `[B-5.1] Retry ${entry.retryCount}/${MAX_EXTENSION_MERGE_RETRY} for row ${entry.rowId}: ` +
        `no sandbox or quarantine write failed.`,
      )
    }
  }

  const remaining = getPendingMergeCount()
  notifyMergePendingNoSandbox(remaining)
  return processed
}

// ─────────────────────────────────────────────────────────────────────────────
// UI notification
// ─────────────────────────────────────────────────────────────────────────────

export function notifyInboxDepackagedMerged(handshakeId: string | null | undefined): void {
  const hid = handshakeId?.trim()
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('inbox:beapInboxUpdated', { handshakeId: hid ?? undefined, depackagedMerged: true })
    }
  } catch {
    /* non-fatal */
  }
}
