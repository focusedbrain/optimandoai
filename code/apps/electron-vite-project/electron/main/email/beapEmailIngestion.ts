/**
 * BEAP Email Ingestion — Drains `p2p_pending_beap` after Pull / auto-sync.
 *
 * Extension sandbox (`verifyImportedMessage` / `sandboxDepackage`) is not available
 * in the Electron main process. This module performs a **main-process equivalent**:
 * - **pBEAP**: base64-decode `payload` → capsule JSON → body / title / attachments (no signature verification).
 * - **qBEAP**: decrypt in main when local BEAP keys exist on `handshakes` (schema v50); else metadata excerpt.
 * - **Handshake capsules** (schema_version + capsule_type): structural preview for inbox UI.
 *
 * Updates matching `inbox_messages` rows (`beap_package_json` match). When no row exists
 * (e.g. P2P relay delivered only to `p2p_pending_beap`), inserts a `direct_beap` inbox row
 * then depackages. Marks pending rows processed so Pull does not stall on the extension poll loop.
 *
 * @version 1.0.0
 */

import { createHash, randomUUID } from 'crypto'

import { decryptQBeapPackage } from '../beap/decryptQBeapPackage'
import { evaluateAutoresponder } from '../beap/autoresponderEvaluator'
import { logAutoresponderDecision } from '../beap/autoresponderAudit'
import { writeEncryptedAttachmentFile } from './attachmentBlobCrypto'
import { makeInboxAttachmentStorageId } from './messageRouter'

const BATCH_SIZE = 100

/** Sentinel account_id for P2P-ingested rows (no email account). */
const P2P_BEAP_ACCOUNT_ID = '__p2p_beap__'

function getHandshakePartyEmails(
  db: any,
  handshakeId: string,
): { counterpartyEmail: string | null; localEmail: string | null } {
  try {
    const row = db
      .prepare(`SELECT local_role, initiator_json, acceptor_json FROM handshakes WHERE handshake_id = ?`)
      .get(handshakeId) as { local_role: string; initiator_json: string; acceptor_json: string | null } | undefined
    if (!row) return { counterpartyEmail: null, localEmail: null }
    const initiator = JSON.parse(row.initiator_json) as { email?: string }
    const acceptor = row.acceptor_json ? (JSON.parse(row.acceptor_json) as { email?: string }) : null
    const initEmail = initiator?.email?.trim() || ''
    const accEmail = acceptor?.email?.trim() || ''
    if (row.local_role === 'initiator') {
      return { counterpartyEmail: accEmail || null, localEmail: initEmail || null }
    }
    return { counterpartyEmail: initEmail || null, localEmail: accEmail || null }
  } catch {
    return { counterpartyEmail: null, localEmail: null }
  }
}

/**
 * Metadata-only attachment rows for pBEAP capsule (no file bytes in main process).
 * qBEAP payloads are opaque here — only pBEAP / plaintext capsule shapes yield rows.
 */
export function extractAttachmentsFromBeapPackageJson(packageJson: string): Array<{
  filename: string
  content_type: string
  size_bytes: number
  content_id: string | null
}> {
  const out: Array<{ filename: string; content_type: string; size_bytes: number; content_id: string | null }> = []
  if (!packageJson || typeof packageJson !== 'string') return out
  try {
    const parsed = JSON.parse(packageJson.trim()) as Record<string, unknown>

    const pushOne = (o: Record<string, unknown>) => {
      const cid =
        typeof o.id === 'string'
          ? o.id
          : typeof o.attachmentId === 'string'
            ? o.attachmentId
            : typeof o.encryptedRef === 'string' && o.encryptedRef.trim()
              ? o.encryptedRef.trim()
              : null
      const size =
        typeof o.originalSize === 'number'
          ? o.originalSize
          : typeof o.sizeBytes === 'number'
            ? o.sizeBytes
            : typeof o.size === 'number'
              ? o.size
              : Number(o.size_bytes ?? 0) || 0
      out.push({
        filename: String(o.originalName ?? o.filename ?? o.name ?? 'attachment'),
        content_type: String(o.originalType ?? o.mimeType ?? o.content_type ?? 'application/octet-stream'),
        size_bytes: size,
        content_id: cid,
      })
    }

    const pushFromCapsule = (capsule: Record<string, unknown>) => {
      if (Array.isArray(capsule.attachments)) {
        for (const a of capsule.attachments) {
          if (a && typeof a === 'object') pushOne(a as Record<string, unknown>)
        }
      }
      const body = capsule.body
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const b = body as Record<string, unknown>
        if (Array.isArray(b.attachments)) {
          for (const a of b.attachments) {
            if (a && typeof a === 'object') pushOne(a as Record<string, unknown>)
          }
        }
      }
    }

    const topCapsule = parsed.capsule
    if (topCapsule && typeof topCapsule === 'object' && !Array.isArray(topCapsule)) {
      pushFromCapsule(topCapsule as Record<string, unknown>)
    }

    const header = parsed.header as Record<string, unknown> | undefined
    const encodingRaw = header?.encoding
    const encNorm = typeof encodingRaw === 'string' ? encodingRaw.toUpperCase() : ''
    if (encNorm === 'PBEAP' && typeof parsed.payload === 'string') {
      try {
        const capsuleJson = Buffer.from(parsed.payload, 'base64').toString('utf8')
        const capsule = JSON.parse(capsuleJson) as Record<string, unknown>
        pushFromCapsule(capsule)
      } catch {
        /* ignore */
      }
    }

    if (Array.isArray(parsed.attachments)) {
      for (const a of parsed.attachments) {
        if (a && typeof a === 'object') pushOne(a as Record<string, unknown>)
      }
    }

    const seen = new Set<string>()
    const deduped: typeof out = []
    for (const x of out) {
      const k = `${x.content_id ?? ''}|${x.filename}|${x.size_bytes}`
      if (seen.has(k)) continue
      seen.add(k)
      deduped.push(x)
    }
    return deduped
  } catch {
    /* ignore */
  }
  return out
}

/**
 * Insert missing `inbox_attachments` rows from BEAP package JSON (metadata only; no file bytes).
 * Safe to call on read — backfills when extraction improved or a prior ingest skipped rows.
 */
export function ensureInboxAttachmentsFromBeapPackageJson(
  db: any,
  messageId: string,
  packageJson: string | null | undefined,
): number {
  if (!db || !messageId || !packageJson || typeof packageJson !== 'string' || !packageJson.trim()) return 0
  const attMeta = extractAttachmentsFromBeapPackageJson(packageJson)
  if (attMeta.length === 0) return 0
  const existingCount = (
    db.prepare('SELECT COUNT(*) as c FROM inbox_attachments WHERE message_id = ?').get(messageId) as {
      c: number
    }
  )?.c ?? 0
  if (existingCount >= attMeta.length) return 0
  const insertP2PAttachment = db.prepare(`
    INSERT INTO inbox_attachments (id, message_id, filename, content_type, size_bytes, content_id, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const ts = new Date().toISOString()
  for (let i = existingCount; i < attMeta.length; i++) {
    const a = attMeta[i]
    insertP2PAttachment.run(
      randomUUID(),
      messageId,
      a.filename,
      a.content_type,
      a.size_bytes,
      a.content_id,
      null,
      ts,
    )
  }
  db.prepare(`UPDATE inbox_messages SET has_attachments = 1, attachment_count = ? WHERE id = ?`).run(
    attMeta.length,
    messageId,
  )
  return attMeta.length - existingCount
}

function resolveP2PPendingPackageColumnExpr(db: any): string {
  try {
    const cols = db.prepare(`PRAGMA table_info(p2p_pending_beap)`).all() as Array<{ name: string }>
    const names = new Set(cols.map((c) => c.name))
    if (names.has('raw_package') && names.has('package_json')) return 'COALESCE(package_json, raw_package)'
    if (names.has('raw_package')) return 'raw_package'
    return 'package_json'
  } catch {
    return 'package_json'
  }
}

/**
 * Best-effort subject/body for `inbox_messages` before depackaging (P2P path has no email envelope).
 */
export function extractP2PBeapInboxPreview(packageJson: string): {
  subject: string
  body_text: string
  from_address: string | null
} {
  const fallback = { subject: 'BEAP message', body_text: '', from_address: null as string | null }
  if (!packageJson || typeof packageJson !== 'string') return fallback
  try {
    const parsed = JSON.parse(packageJson.trim()) as Record<string, unknown>

    if (typeof parsed.schema_version === 'number' && typeof parsed.capsule_type === 'string') {
      return {
        subject: `BEAP ${String(parsed.capsule_type)}`,
        body_text: '',
        from_address: null,
      }
    }

    const header = parsed.header as Record<string, unknown> | undefined
    if (!header || typeof header !== 'object') return fallback

    const encoding = header.encoding
    if (encoding === 'pBEAP' && typeof parsed.payload === 'string') {
      try {
        const capsuleJson = Buffer.from(parsed.payload, 'base64').toString('utf8')
        const capsule = JSON.parse(capsuleJson) as Record<string, unknown>
        const bodyText = String(capsule.body ?? capsule.transport_plaintext ?? '')
        const title =
          typeof capsule.subject === 'string' && capsule.subject.trim()
            ? capsule.subject
            : typeof capsule.title === 'string' && capsule.title.trim()
              ? capsule.title
              : fallback.subject
        return { subject: title, body_text: bodyText.slice(0, 50_000), from_address: null }
      } catch {
        /* fall through */
      }
    }

    if (encoding === 'qBEAP') {
      return {
        subject: 'BEAP message (encrypted)',
        body_text: '(Encrypted qBEAP — open in extension for full content)',
        from_address: null,
      }
    }

    return fallback
  } catch {
    return fallback
  }
}

export interface InboxRowFallback {
  id: string
  subject: string | null
  from_address: string | null
  body_text: string | null
}

/**
 * Build depackaged_json for orchestrator inbox UI + downstream embedding queue.
 * Best-effort only; never throws.
 */
export function beapPackageToMainProcessDepackaged(
  packageJson: string,
  fallback: InboxRowFallback,
): string {
  const emailSubject = fallback.subject ?? ''
  const from = fallback.from_address ?? ''
  const bodyExcerpt = (fallback.body_text ?? '').slice(0, 12_000)

  const baseError = (reason: string) =>
    JSON.stringify({
      schema_version: '1.0.0',
      format: 'beap_main_process_error',
      error_reason: reason,
      header: { subject: emailSubject, from },
      body: { text: bodyExcerpt },
      metadata: {
        source: 'main_process_pending_beap',
        note: 'Could not extract BEAP structure; email fields retained for context.',
      },
    })

  let parsed: unknown
  try {
    parsed = JSON.parse(packageJson.trim())
  } catch {
    return baseError('invalid_json')
  }

  if (!parsed || typeof parsed !== 'object') {
    return baseError('not_object')
  }

  const p = parsed as Record<string, unknown>

  // ── Handshake capsule (attachment/body) — not a qBEAP/pBEAP message package
  if (typeof p.schema_version === 'number' && typeof p.capsule_type === 'string') {
    return JSON.stringify({
      schema_version: '1.0.0',
      format: 'beap_handshake_capsule_email',
      capsule_type: p.capsule_type,
      capsule_schema_version: p.schema_version,
      header: { subject: emailSubject, from },
      body: { text: bodyExcerpt },
      capsule_keys: Object.keys(p).slice(0, 40),
      metadata: {
        source: 'main_process_pending_beap',
        note: 'Handshake capsule from email; cryptographic processing may still run in extension. Structural preview for inbox.',
      },
    })
  }

  const header = p.header as Record<string, unknown> | undefined
  if (!header || typeof header !== 'object') {
    return baseError('missing_header')
  }

  const encoding = header.encoding
  const senderFingerprint =
    typeof header.sender_fingerprint === 'string' ? header.sender_fingerprint : undefined
  const contentHash = typeof header.content_hash === 'string' ? header.content_hash : undefined
  const version = header.version

  // ── pBEAP: plaintext base64 payload → capsule JSON (mirrors decodePBeapPackage decode step)
  if (encoding === 'pBEAP' && typeof p.payload === 'string') {
    try {
      const capsuleJson = Buffer.from(p.payload, 'base64').toString('utf8')
      const capsule = JSON.parse(capsuleJson) as Record<string, unknown>
      const bodyText = String(capsule.body ?? capsule.transport_plaintext ?? '')
      const title =
        typeof capsule.title === 'string' && capsule.title.trim()
          ? capsule.title
          : emailSubject

      const attachments: Array<{
        filename: string
        content_type: string
        size: number
        content_id?: string
      }> = []

      if (Array.isArray(capsule.attachments)) {
        for (const a of capsule.attachments) {
          if (!a || typeof a !== 'object') continue
          const o = a as Record<string, unknown>
          attachments.push({
            filename: String(o.originalName ?? o.filename ?? o.name ?? 'attachment'),
            content_type: String(o.originalType ?? o.mimeType ?? 'application/octet-stream'),
            size: typeof o.originalSize === 'number' ? o.originalSize : Number(o.sizeBytes ?? 0) || 0,
            content_id: typeof o.id === 'string' ? o.id : undefined,
          })
        }
      }

      return JSON.stringify({
        schema_version: '1.0.0',
        format: 'beap_message_main_process',
        encoding: 'pBEAP',
        trust_note:
          'Public pBEAP payload decoded in main process without Stage-5 sandbox signature / gate verification.',
        header: {
          subject: title,
          from,
          sender_fingerprint: senderFingerprint,
        },
        body: { text: bodyText },
        attachments,
        metadata: {
          source: 'main_process_pending_beap',
          decoded_at: new Date().toISOString(),
        },
      })
    } catch (e) {
      console.warn(
        '[BeapEmailIngestion] pBEAP payload decode failed, falling back to metadata:',
        (e as Error)?.message,
      )
    }
  }

  // ── qBEAP: cannot decrypt in main
  if (encoding === 'qBEAP') {
    return JSON.stringify({
      schema_version: '1.0.0',
      format: 'beap_qbeap_pending_main',
      encoding: 'qBEAP',
      header_summary: {
        sender_fingerprint: senderFingerprint,
        content_hash: contentHash,
        version,
      },
      body: { text: bodyExcerpt },
      email_fallback_header: {
        subject: emailSubject,
        from,
      },
      metadata: {
        source: 'main_process_pending_beap',
        note: 'qBEAP requires extension sandbox and keys; email excerpt retained for search/context.',
      },
    })
  }

  // Unknown encoding but has header — still surface email + header hints
  return JSON.stringify({
    schema_version: '1.0.0',
    format: 'beap_message_main_process_partial',
    encoding: typeof encoding === 'string' ? encoding : 'unknown',
    header_summary: {
      sender_fingerprint: senderFingerprint,
      content_hash: contentHash,
      version,
    },
    body: { text: bodyExcerpt },
    metadata: {
      source: 'main_process_pending_beap',
      note: 'Unrecognised BEAP message shape for main-process decode; email fields retained.',
    },
  })
}

/** Prepared statements for qBEAP decrypt → inbox update (shared by P2P drain + retry). */
export type QbeapDecryptInboxStmts = {
  updateInboxDecrypted: any
  deleteAttForMessage: any
  insertAtt: any
  updateAttEnc: any
  updateAttSha: any
}

export function createQbeapDecryptInboxStmts(db: any): QbeapDecryptInboxStmts {
  return {
    updateInboxDecrypted: db.prepare(`
    UPDATE inbox_messages SET
      depackaged_json = ?,
      body_text = ?,
      subject = ?,
      has_attachments = ?,
      attachment_count = ?,
      embedding_status = 'pending'
    WHERE id = ?
  `),
    deleteAttForMessage: db.prepare(`DELETE FROM inbox_attachments WHERE message_id = ?`),
    insertAtt: db.prepare(`
    INSERT INTO inbox_attachments (id, message_id, filename, content_type, size_bytes, content_id, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
    updateAttEnc: db.prepare(`
    UPDATE inbox_attachments SET encryption_key = ?, encryption_iv = ?, encryption_tag = ?, storage_encrypted = ? WHERE id = ?
  `),
    updateAttSha: db.prepare(`UPDATE inbox_attachments SET content_sha256 = ? WHERE id = ?`),
  }
}

/**
 * Decrypt qBEAP in main and persist to `inbox_messages` + attachments. Returns depackaged JSON for autoresponder.
 */
export async function tryQbeapDecryptInbox(
  db: any,
  stmts: QbeapDecryptInboxStmts,
  inbox: InboxRowFallback,
  pkg: string,
  handshakeId: string | null | undefined,
): Promise<{ decrypted: boolean; depackagedJson?: string }> {
  if (!handshakeId || !pkg.trim()) return { decrypted: false }
  try {
    const hdr = JSON.parse(pkg) as { header?: { encoding?: string } }
    if (hdr.header?.encoding !== 'qBEAP') return { decrypted: false }
    const dec = await decryptQBeapPackage(pkg, handshakeId, db)
    if (!dec) return { decrypted: false }

    const depackagedJson = JSON.stringify({
      schema_version: '1.0.0',
      format: 'beap_qbeap_decrypted',
      encoding: 'qBEAP',
      subject: dec.subject,
      body: { text: dec.body },
      transport_plaintext: dec.transport_plaintext,
      automation: dec.automation,
      metadata: { source: 'main_process_qbeap_decrypt' },
    })
    stmts.deleteAttForMessage.run(inbox.id)
    const nowIso = new Date().toISOString()
    for (const att of dec.attachments) {
      if (!att.bytes || att.bytes.length === 0) continue
      const rowAttId = makeInboxAttachmentStorageId(inbox.id, att.id)
      try {
        const w = writeEncryptedAttachmentFile(inbox.id, att.id, att.filename, att.bytes)
        stmts.insertAtt.run(
          rowAttId,
          inbox.id,
          att.filename.slice(0, 500),
          att.contentType.slice(0, 200),
          att.size,
          att.id,
          w.storagePath,
          nowIso,
        )
        stmts.updateAttEnc.run(w.encryptionKeyStored, w.ivB64, w.tagB64, 1, rowAttId)
        stmts.updateAttSha.run(createHash('sha256').update(att.bytes).digest('hex'), rowAttId)
      } catch (attErr) {
        console.warn('[BEAP-INBOX] Attachment write failed:', (attErr as Error)?.message)
      }
    }
    const attCount = dec.attachments.filter((a) => a.bytes && a.bytes.length > 0).length
    const bodyText = dec.transport_plaintext || dec.body || inbox.body_text || ''
    const subj = dec.subject || inbox.subject || ''
    stmts.updateInboxDecrypted.run(depackagedJson, bodyText, subj, attCount > 0 ? 1 : 0, attCount, inbox.id)
    return { decrypted: true, depackagedJson }
  } catch (decErr) {
    console.warn('[BEAP-INBOX] qBEAP decrypt skipped:', (decErr as Error)?.message ?? decErr)
    return { decrypted: false }
  }
}

/** Run `retryPendingQbeapDecrypt` at most once per process (avoids timer spam from tryP2PStartup). */
let pendingQbeapDecryptRetryRan = false

/**
 * One-time-style retry: inbox rows that were stored with `beap_qbeap_pending_main` (decrypt not available
 * at ingest) are attempted again using current handshake keys — e.g. after Linux deploy or key sync.
 */
export async function retryPendingQbeapDecrypt(db: any): Promise<number> {
  if (!db) return 0
  if (pendingQbeapDecryptRetryRan) return 0
  let fixed = 0
  let rows: Array<{
    id: string
    beap_package_json: string
    handshake_id: string
    subject: string | null
    from_address: string | null
    body_text: string | null
  }>
  try {
    try {
      rows = db
        .prepare(
          `SELECT id, beap_package_json, handshake_id, subject, from_address, body_text
           FROM inbox_messages
           WHERE source_type = 'direct_beap'
             AND depackaged_json LIKE '%beap_qbeap_pending_main%'
             AND beap_package_json IS NOT NULL
             AND TRIM(COALESCE(beap_package_json, '')) != ''
             AND handshake_id IS NOT NULL
             AND TRIM(COALESCE(handshake_id, '')) != ''`,
        )
        .all() as typeof rows
    } catch (e) {
      console.warn('[RETRY-DECRYPT] Query failed:', (e as Error)?.message ?? e)
      return 0
    }

    if (!rows.length) return 0

    console.log(`[RETRY-DECRYPT] Found ${rows.length} inbox row(s) with qBEAP pending (main); attempting decrypt`)

    const stmts = createQbeapDecryptInboxStmts(db)

    for (const row of rows) {
      const pkg = String(row.beap_package_json ?? '').trim()
      if (!pkg) continue
      const inbox: InboxRowFallback = {
        id: row.id,
        subject: row.subject,
        from_address: row.from_address,
        body_text: row.body_text,
      }
      try {
        const q = await tryQbeapDecryptInbox(db, stmts, inbox, pkg, row.handshake_id)
        if (q.decrypted) {
          fixed++
          console.log(`[RETRY-DECRYPT] Decrypted inbox message id=${row.id}`)
        }
      } catch (e) {
        console.warn(`[RETRY-DECRYPT] Error for id=${row.id}:`, (e as Error)?.message ?? e)
      }
    }

    return fixed
  } finally {
    pendingQbeapDecryptRetryRan = true
  }
}

/**
 * Process pending rows in `p2p_pending_beap` in batches until drained.
 * Matches `inbox_messages` via `beap_package_json` = `package_json`; if none, inserts `direct_beap`.
 */
export async function processPendingP2PBeapEmails(db: any): Promise<number> {
  if (!db) return 0

  let drained = 0

  const pkgExpr = resolveP2PPendingPackageColumnExpr(db)
  const selectBatch = db.prepare(
    `SELECT id, handshake_id, ${pkgExpr} AS package_json, created_at FROM p2p_pending_beap
     WHERE processed = 0 ORDER BY created_at ASC LIMIT ?`,
  )

  const selectInbox = db.prepare(
    `SELECT id, subject, from_address, body_text FROM inbox_messages
     WHERE beap_package_json IS NOT NULL AND beap_package_json = ?
     LIMIT 1`,
  )

  const updateInbox = db.prepare(
    `UPDATE inbox_messages SET depackaged_json = ?, embedding_status = 'pending' WHERE id = ?`,
  )

  const qbeapStmts = createQbeapDecryptInboxStmts(db)

  const insertDirectBeap = db.prepare(`
    INSERT INTO inbox_messages (
      id, source_type, handshake_id, account_id, email_message_id,
      from_address, from_name, to_addresses, cc_addresses,
      subject, body_text, body_html, beap_package_json,
      has_attachments, attachment_count, received_at, ingested_at,
      imap_remote_mailbox, imap_rfc_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const markProcessed = db.prepare(`UPDATE p2p_pending_beap SET processed = 1 WHERE id = ?`)

  try {
    const pendingCountRow = db.prepare(`SELECT COUNT(*) as c FROM p2p_pending_beap WHERE processed = 0`).get() as { c: number }
    const pendingTotal = pendingCountRow?.c ?? 0
    if (pendingTotal > 0) {
      console.log(`[BEAP-INBOX] Processing ${pendingTotal} pending P2P BEAP message(s)`)
    }

    for (;;) {
      const rows = selectBatch.all(BATCH_SIZE) as Array<{
        id: number
        handshake_id: string
        package_json: string
        created_at: string
      }>

      if (!rows.length) break

      for (const row of rows) {
        try {
          const pkg = row.package_json != null ? String(row.package_json) : ''
          if (!pkg.trim()) {
            console.warn('[BEAP-INBOX] Skipping pending row with empty package id=', row.id)
            markProcessed.run(row.id)
            drained++
            continue
          }

          let inbox = selectInbox.get(pkg) as InboxRowFallback | undefined

          const ensureAttachmentsForInboxMessage = (messageId: string) => {
            ensureInboxAttachmentsFromBeapPackageJson(db, messageId, pkg)
          }

          if (!inbox) {
            const preview = extractP2PBeapInboxPreview(pkg)
            const parties = row.handshake_id ? getHandshakePartyEmails(db, row.handshake_id) : { counterpartyEmail: null, localEmail: null }
            const fromAddr =
              (preview.from_address && String(preview.from_address).trim()) ||
              (parties.counterpartyEmail && parties.counterpartyEmail.trim()) ||
              null
            const toJson = parties.localEmail ? JSON.stringify([parties.localEmail]) : '[]'
            const attMeta = extractAttachmentsFromBeapPackageJson(pkg)
            const attCount = attMeta.length
            const inboxId = randomUUID()
            const now = new Date().toISOString()
            const receivedAt = row.created_at && String(row.created_at).trim() ? String(row.created_at) : now
            insertDirectBeap.run(
              inboxId,
              'direct_beap',
              row.handshake_id,
              P2P_BEAP_ACCOUNT_ID,
              `p2p-pending-${row.id}`,
              fromAddr,
              null,
              toJson,
              '[]',
              preview.subject,
              preview.body_text,
              null,
              pkg,
              attCount > 0 ? 1 : 0,
              attCount,
              receivedAt,
              now,
              'P2P_DIRECT',
              null,
            )
            if (attCount > 0) {
              ensureInboxAttachmentsFromBeapPackageJson(db, inboxId, pkg)
            }
            inbox = {
              id: inboxId,
              subject: preview.subject,
              from_address: fromAddr,
              body_text: preview.body_text,
            }
          } else {
            ensureAttachmentsForInboxMessage(inbox.id)
          }

          let depackagedJson = beapPackageToMainProcessDepackaged(pkg, inbox)
          const qbeapTry = await tryQbeapDecryptInbox(db, qbeapStmts, inbox, pkg, row.handshake_id)
          if (qbeapTry.decrypted && qbeapTry.depackagedJson) {
            depackagedJson = qbeapTry.depackagedJson
          } else {
            updateInbox.run(depackagedJson, inbox.id)
          }

          try {
            const evaluation = evaluateAutoresponder({
              messageId: inbox.id,
              handshakeId: row.handshake_id ?? null,
              depackagedJson,
            })
            logAutoresponderDecision(evaluation)
            if (evaluation.decision === 'policy-consent') {
              // Autoresponder send path is intentionally NOT implemented — user must send manually.
              console.log(
                '[Autoresponder] policy-consent detected; auto-send disabled (receiver authority / manual consent).',
                inbox.id,
              )
            }
          } catch (evalErr: unknown) {
            console.warn('[Autoresponder] evaluation failed:', (evalErr as Error)?.message ?? evalErr)
          }

          markProcessed.run(row.id)
          drained++
          console.log(`[BEAP-INBOX] Message imported: handshake=${row.handshake_id} messageId=${inbox.id}`)
        } catch (e: unknown) {
          console.error('[BEAP-INBOX] Import failed:', (e as Error)?.message ?? e)
          console.error('[BeapEmailIngestion] Error processing pending id', row.id, (e as Error)?.message)
          try {
            markProcessed.run(row.id)
            drained++
          } catch {
            /* non-fatal */
          }
        }
      }
    }
  } catch (e: unknown) {
    console.error('[BEAP-INBOX] Import failed:', (e as Error)?.message ?? e)
    console.error('[BeapEmailIngestion] Query error:', (e as Error)?.message)
    return drained
  }

  return drained
}
