/**
 * BEAP Email Ingestion — Drains `p2p_pending_beap` after Pull / auto-sync.
 *
 * Extension sandbox (`verifyImportedMessage` / `sandboxDepackage`) is not available
 * in the Electron main process. This module performs a **main-process equivalent**:
 * - **pBEAP**: base64-decode `payload` → capsule JSON → body / title / attachments (no signature verification).
 * - **qBEAP**: metadata + email body excerpt only (cannot decrypt without keys).
 * - **Handshake capsules** (schema_version + capsule_type): structural preview for inbox UI.
 *
 * Updates matching `inbox_messages` rows (`beap_package_json` match). When no row exists
 * (e.g. P2P relay delivered only to `p2p_pending_beap`), inserts a `direct_beap` inbox row
 * then depackages. Marks pending rows processed so Pull does not stall on the extension poll loop.
 *
 * @version 1.0.0
 */

import { randomUUID } from 'crypto'

import { evaluateAutoresponder } from '../beap/autoresponderEvaluator'
import { logAutoresponderDecision } from '../beap/autoresponderAudit'

const BATCH_SIZE = 100

/** Sentinel account_id for P2P-ingested rows (no email account). */
const P2P_BEAP_ACCOUNT_ID = '__p2p_beap__'

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
          typeof capsule.title === 'string' && capsule.title.trim()
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

/**
 * Process pending rows in `p2p_pending_beap` in batches until drained.
 * Matches `inbox_messages` via `beap_package_json` = `package_json`; if none, inserts `direct_beap`.
 */
export function processPendingP2PBeapEmails(db: any): number {
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

          if (!inbox) {
            const preview = extractP2PBeapInboxPreview(pkg)
            const inboxId = randomUUID()
            const now = new Date().toISOString()
            const receivedAt = row.created_at && String(row.created_at).trim() ? String(row.created_at) : now
            insertDirectBeap.run(
              inboxId,
              'direct_beap',
              row.handshake_id,
              P2P_BEAP_ACCOUNT_ID,
              `p2p-pending-${row.id}`,
              preview.from_address,
              null,
              '[]',
              '[]',
              preview.subject,
              preview.body_text,
              null,
              pkg,
              0,
              0,
              receivedAt,
              now,
              'P2P_DIRECT',
              null,
            )
            inbox = {
              id: inboxId,
              subject: preview.subject,
              from_address: preview.from_address,
              body_text: preview.body_text,
            }
          }

          const depackagedJson = beapPackageToMainProcessDepackaged(pkg, inbox)
          updateInbox.run(depackagedJson, inbox.id)

          try {
            const evaluation = evaluateAutoresponder({
              messageId: inbox.id,
              handshakeId: row.handshake_id ?? null,
              depackagedJson,
            })
            logAutoresponderDecision(evaluation)
            if (evaluation.decision === 'policy-consent') {
              // TODO: Auto-import sessions + trigger orchestrator + build reply
              // This is where the autoresponder pipeline will execute
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
