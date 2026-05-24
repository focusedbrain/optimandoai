/**
 * BEAP Ingestion — Validate-before-write pipeline for P2P-arrived BEAP packages.
 *
 * Phase B, PR B-4: the old `p2p_pending_beap` staging path has been replaced.
 * P2P entry points (coordinationWs, p2pServer, relayPull, main.ts file-import IPC,
 * beapSync.ts Strategy 1b) now call `processBeapPackageInline` directly, which runs
 * the validator subprocess and writes a sealed `inbox_messages` or sealed
 * `quarantine_messages` row without any SQLite-backed staging step.
 *
 * The module also provides:
 * - `processBeapPackageInline` — main entry point for all P2P ingestion.
 * - `processSandboxQuarantineReceive` — sandbox-side decrypt of host-quarantined blobs.
 * - `retryPendingQbeapDecrypt` — sealed-update backfill for pre-B-4 unsealed rows
 *   (uses `resealWithDecryptedContent` from sealedContentUpdate.ts — PR B-7.2).
 * - `processPendingP2PBeapEmails` — deprecated no-op stub (was the old drain function).
 *
 * Phase B, PR B-7.2: The old `tryQbeapDecryptInbox` / `createQbeapDecryptInboxStmts`
 * helpers have been removed.  They performed raw `db.prepare().run()` writes without a
 * seal and had no production callers (`retryPendingQbeapDecrypt` was already migrated
 * to the sealed gate in PR B-4).  The canonical re-seal helper for this path is now
 * `resealWithDecryptedContent` in `sealedContentUpdate.ts`.
 *
 * @version 2.1.0 (Phase B, PR B-7.2)
 */

import { createHash, randomUUID } from 'crypto'

import { getHandshakeRecord } from '../handshake/db'
import type { ProvenanceMetadata } from '@repo/ingestion-core'
import type { DepackageKeys } from '@repo/pod-client'
import { buildIngestPodClient } from '../ingestion/podClientFactory.js'
import { evaluateAutoresponder } from '../beap/autoresponderEvaluator'
import { logAutoresponderDecision } from '../beap/autoresponderAudit'
import { makeInboxAttachmentStorageId, buildQuarantineCanonicalJson, findPairedSandboxHandshake } from './messageRouter'
import { validatorOrchestrator } from '../validation/inProcessValidator'
import type { ReasonCode } from '../vault/capabilityBroker'
import { prepareSealedInsert, prepareSealedOperationalUpdate, computeSeal } from '../sealed-storage/index'
import type { KeySource } from '../sealed-storage/index'
import { getHandshakeClassification } from '../vault/vaultCanon'
import { resealWithDecryptedContent } from './sealedContentUpdate'
import { decryptQuarantineBlob, encryptForQuarantine } from '../quarantine-encrypt/index'
import { writeQuarantineBlob, type QuarantineBlobFile } from '../quarantine-blob-storage/index'
import type { SSOSession } from '../handshake/types'
import { notifyBeapInboxDashboard } from './beapInboxDashboardNotify'
import { notifyBeapDeliveryAck } from '../p2p/beapDeliveryAck'
import { postPeerDeliveryAckToSender } from '../p2p/peerDeliveryAck'
import { notifyBeapRecipientPending } from '../p2p/beapRecipientNotify'

const BATCH_SIZE = 100

/** Structured visibility for qBEAP decrypt null returns (main-process logs only). */
function reportQbeapDecryptFailure(ctx: string) {
  return (info: { code: string; handshakeId: string; retryable: boolean }): void => {
    console.warn(`[${ctx}] qBEAP decrypt failure`, info)
  }
}

/**
 * After a sealed `direct_beap` row is committed to `inbox_messages`:
 * broadcast dashboard/inbox refresh (matches `App.tsx` `onBeapInboxUpdated`) + extension hook,
 * and optionally emit local `inbox:beapDeliveryAck` (same-process sender confirmation only).
 */
function finalizeDirectBeapInboxPersistence(
  db: any,
  handshakeId: string,
  rowId: string,
  emitPeerDeliveryAck: boolean,
): void {
  console.log(`[BEAP_DELIVERY] persist_success messageId=${rowId} handshake=${handshakeId} outcome=inbox`)
  console.log(`[BEAP_DELIVERY] ui_notify_sent messageId=${rowId} handshake=${handshakeId} rowId=${rowId}`)
  notifyBeapInboxDashboard(handshakeId)
  notifyBeapRecipientPending(handshakeId)
  if (emitPeerDeliveryAck) {
    console.log(`[BEAP_DELIVERY] ack_sent messageId=${rowId} handshake=${handshakeId} rowId=${rowId}`)
    notifyBeapDeliveryAck(handshakeId, rowId)
    postPeerDeliveryAckToSender(db, handshakeId, rowId)
  }
}

/** Sentinel account_id for P2P-ingested rows (no email account). */
const P2P_BEAP_ACCOUNT_ID = '__p2p_beap__'

const OUTBOUND_QBEAP_BODY_PLACEHOLDER = '(Sent qBEAP message — see Sent tab for details)'

// ── Pod-based qBEAP depackage (P1.12 — replaces in-process decryptQBeapPackage) ────

/**
 * Depackaged qBEAP content as returned by the pod's depackager.
 * Structurally compatible with the old DecryptedQBeapContent interface.
 * Attachments are not included (Phase 2 concern; pod doesn't return bytes).
 */
interface DepackagedQBeapContent {
  subject: string
  body: string
  transport_plaintext: string
  rawCapsuleJson?: string
  attachments: never[]
  automation: undefined
}

/**
 * Decrypt a qBEAP package via the pod ingestor.
 *
 * Reads the handshake's X25519 private key from the DB, sends the raw
 * package to the pod with per-request key material, and returns a
 * DepackagedQBeapContent shaped like the old DecryptedQBeapContent.
 *
 * Returns null when:
 *   - Handshake record is missing or has no local key
 *   - Pod is unreachable or returns an error
 *   - Pod response is missing the depackaged content field
 */
async function depackageQBeapViaPod(
  packageJson: string,
  handshakeId: string,
  db: unknown,
  opts?: { reportFailure?: (info: { reason: string; handshakeId: string }) => void },
): Promise<DepackagedQBeapContent | null> {
  const hs = getHandshakeRecord(db as any, handshakeId.trim())
  if (!hs) {
    opts?.reportFailure?.({ reason: 'missing_handshake_record', handshakeId })
    return null
  }
  const x25519PrivB64 = hs.local_x25519_private_key_b64?.trim()
  if (!x25519PrivB64) {
    opts?.reportFailure?.({ reason: 'missing_x25519_private_key', handshakeId })
    return null
  }
  const depackageKeys: DepackageKeys = {
    x25519_priv_b64: x25519PrivB64,
    mlkem_secret_b64: hs.local_mlkem768_secret_key_b64?.trim() || undefined,
  }

  const client = buildIngestPodClient('native_beap')

  let podBody: Record<string, unknown>
  try {
    const result = await client.ingest(
      { body: packageJson },
      'p2p',
      undefined,
      depackageKeys,
    )
    podBody = result.body as Record<string, unknown>
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    opts?.reportFailure?.({ reason: `pod_error: ${msg}`, handshakeId })
    return null
  }

  const depackaged = podBody?.['depackaged'] as Record<string, unknown> | undefined
  if (!depackaged || typeof depackaged['rawCapsuleJson'] !== 'string') {
    opts?.reportFailure?.({ reason: 'pod_missing_depackaged_content', handshakeId })
    return null
  }

  return {
    subject: typeof depackaged['subject'] === 'string' ? depackaged['subject'] : '',
    body: typeof depackaged['body'] === 'string' ? depackaged['body'] : '',
    transport_plaintext: typeof depackaged['transport_plaintext'] === 'string'
      ? depackaged['transport_plaintext'] : '',
    rawCapsuleJson: depackaged['rawCapsuleJson'] as string,
    attachments: [],
    automation: undefined,
  }
}

/**
 * Relay echo of our own qBEAP send: `header.sender_fingerprint` matches Ed25519 `handshakes.local_public_key`.
 * Decrypt would fail (payload encrypted for recipient); skip decrypt and mark outbound for UI.
 */
export function isOutboundQbeapEcho(
  packageJson: string,
  handshakeId: string | null | undefined,
  db: unknown,
): boolean {
  if (!db || !handshakeId?.trim()) return false
  let p: Record<string, unknown>
  try {
    p = JSON.parse(packageJson.trim()) as Record<string, unknown>
  } catch {
    return false
  }
  const header = p.header as Record<string, unknown> | undefined
  if (!header || header.encoding !== 'qBEAP') return false
  const senderFp =
    typeof header.sender_fingerprint === 'string' ? header.sender_fingerprint.trim() : ''
  if (!senderFp) return false
  const hs = getHandshakeRecord(db as any, handshakeId.trim())
  const localPub = hs?.local_public_key?.trim()
  if (!localPub) return false
  return senderFp === localPub
}

/** depackaged_json for sender's own qBEAP echo (not decryptable locally). */
/**
 * Canonical depackaged content + wrapper metadata for an outbound qBEAP echo.
 *
 * PR 5.1 / Decision A+B+D:
 * - `depackaged_json`: canonical placeholder shape. Sender can't decrypt their own
 *   ciphertext, so subject/body are sourced from the email fallback. No
 *   `session_import_artefact` (encrypted for recipient, not visible to sender).
 * - `depackaged_metadata`: wrapper info (format, source, header summaries).
 */
export function buildOutboundQbeapDepackagedJson(
  packageJson: string,
  fallback: InboxRowFallback,
): { depackaged_json: string; depackaged_metadata: string } {
  let senderFingerprint: string | undefined
  let contentHash: string | undefined
  let version: unknown
  try {
    const p = JSON.parse(packageJson.trim()) as Record<string, unknown>
    const header = p.header as Record<string, unknown> | undefined
    if (header && typeof header === 'object') {
      senderFingerprint =
        typeof header.sender_fingerprint === 'string' ? header.sender_fingerprint : undefined
      contentHash = typeof header.content_hash === 'string' ? header.content_hash : undefined
      version = header.version
    }
  } catch {
    /* keep defaults */
  }
  const depackaged_json = JSON.stringify({
    subject: fallback.subject ?? '',
    body: OUTBOUND_QBEAP_BODY_PLACEHOLDER,
    has_authoritative_encrypted: true,
  })
  const depackaged_metadata = JSON.stringify({
    format: 'beap_qbeap_outbound',
    encoding: 'qBEAP',
    note: 'Outbound message — encrypted for recipient, not decryptable by sender',
    header_summary: { sender_fingerprint: senderFingerprint, content_hash: contentHash, version },
    email_fallback_header: {
      subject: fallback.subject ?? '',
      from: fallback.from_address ?? '',
    },
    source: 'main_process_p2p_outbound_echo',
  })
  return { depackaged_json, depackaged_metadata }
}

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
  prepareSealedOperationalUpdate(
    db,
    `UPDATE inbox_messages SET has_attachments = 1, attachment_count = ? WHERE id = ?`,
  ).run(attMeta.length, messageId)
  return attMeta.length - existingCount
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

/** Keep in sync with renderer `SANDBOX_CLONE_INBOX_LEAD_IN` (beapInboxCloneToSandbox / inboxMessageSandboxClone). */
const SANDBOX_CLONE_INBOX_LEAD_IN =
  '[BEAP sandbox clone — sent by you]\n' +
  'This is a test clone for your sandbox; the original inbox message is unchanged. New qBEAP only — no original ciphertext reuse.\n' +
  'Automation: sandbox_clone=true in metadata below.\n\n'

/** Clone receive only — strip synthetic lead-in so inbox body matches Host-visible content. */
export function stripSandboxCloneLeadInBodyText(raw: string | null | undefined): string {
  const s = raw ?? ''
  if (!s) return ''
  if (s.startsWith(SANDBOX_CLONE_INBOX_LEAD_IN)) return s.slice(SANDBOX_CLONE_INBOX_LEAD_IN.length)
  if (s.startsWith('[BEAP sandbox clone — sent by you]')) {
    return s.slice('[BEAP sandbox clone — sent by you]'.length).replace(/^\n+/, '')
  }
  return s
}

/** After inline qBEAP decrypt, replace the pre-decrypt placeholder in `body_text`. */
export function applyDecryptedQBeapToInboxPreview(
  preview: { subject: string; body_text: string; from_address: string | null },
  decrypted: DepackagedQBeapContent,
  opts?: { stripCloneLeadIn?: boolean },
): { subject: string; body_text: string; from_address: string | null } {
  let body =
    (decrypted.body ?? '').trim() ||
    (decrypted.transport_plaintext ?? '').trim()
  if (opts?.stripCloneLeadIn) body = stripSandboxCloneLeadInBodyText(body)
  const subject = (decrypted.subject ?? '').trim() || preview.subject
  return {
    ...preview,
    subject,
    body_text: body ? body.slice(0, 50_000) : preview.body_text,
  }
}

/**
 * Depackaged-email sandbox clones: store depackaged_json in the same shape the Host inbox UI
 * already renders (format + body), not raw inner capsule only.
 */
export function buildEmailStyleDepackagedJsonFromDecrypt(
  decrypted: DepackagedQBeapContent,
  opts?: { stripCloneLeadIn?: boolean },
): string {
  let body =
    (decrypted.body ?? '').trim() ||
    (decrypted.transport_plaintext ?? '').trim()
  if (opts?.stripCloneLeadIn) body = stripSandboxCloneLeadInBodyText(body)
  const transport = stripSandboxCloneLeadInBodyText(
    (decrypted.transport_plaintext ?? '').trim() || body,
  )
  return JSON.stringify({
    format: 'beap_qbeap_decrypted',
    subject: (decrypted.subject ?? '').trim() || undefined,
    body: body || transport,
    ...(transport ? { transport_plaintext: transport } : {}),
  })
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
/**
 * PR 5.1 / Decision A+B: depackaged content pair for inbox_messages row.
 *
 * - `depackaged_json`: canonical capsule plaintext (bytes the Validator approved), or
 *   `null` when no canonical plaintext is available yet (qBEAP pending, errors, handshake).
 * - `depackaged_metadata`: wrapper metadata (format identifier, source tag, header summaries)
 *   that does NOT form part of the validated content but is kept for ops / routing.
 */
export interface BeapDepackagedPair {
  depackaged_json: string | null
  depackaged_metadata: string
}

export function beapPackageToMainProcessDepackaged(
  packageJson: string,
  fallback: InboxRowFallback,
): BeapDepackagedPair {
  const emailSubject = fallback.subject ?? ''
  const from = fallback.from_address ?? ''
  const bodyExcerpt = (fallback.body_text ?? '').slice(0, 12_000)

  const baseError = (reason: string): BeapDepackagedPair => ({
    depackaged_json: null,
    depackaged_metadata: JSON.stringify({
      format: 'beap_main_process_error',
      error_reason: reason,
      header: { subject: emailSubject, from },
      body_excerpt: bodyExcerpt,
      source: 'main_process_pending_beap',
      note: 'Could not extract BEAP structure; email fields retained for context.',
    }),
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
    return {
      depackaged_json: null,
      depackaged_metadata: JSON.stringify({
        format: 'beap_handshake_capsule_email',
        capsule_type: p.capsule_type,
        capsule_schema_version: p.schema_version,
        header: { subject: emailSubject, from },
        body_excerpt: bodyExcerpt,
        capsule_keys: Object.keys(p).slice(0, 40),
        source: 'main_process_pending_beap',
        note: 'Handshake capsule from email; cryptographic processing may still run in extension. Structural preview for inbox.',
      }),
    }
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

  // ── pBEAP: plaintext base64 payload → capsule JSON is the canonical plaintext
  // (PR 5.1 / Decision A). `depackaged_json` becomes the raw capsule JSON so the
  // Validator's approval applies to exactly the bytes the UI reads.
  if (encoding === 'pBEAP' && typeof p.payload === 'string') {
    try {
      const capsuleJson = Buffer.from(p.payload, 'base64').toString('utf8')
      return {
        depackaged_json: capsuleJson,
        depackaged_metadata: JSON.stringify({
          format: 'beap_message_main_process',
          encoding: 'pBEAP',
          trust_note:
            'Public pBEAP payload decoded in main process without Stage-5 sandbox signature / gate verification.',
          header_from: from,
          sender_fingerprint: senderFingerprint,
          source: 'main_process_pending_beap',
          decoded_at: new Date().toISOString(),
        }),
      }
    } catch (e) {
      console.warn(
        '[BeapEmailIngestion] pBEAP payload decode failed, falling back to metadata:',
        (e as Error)?.message,
      )
    }
  }

  // ── qBEAP: cannot decrypt in main. No canonical plaintext yet — stored as null.
  // `depackaged_metadata` holds the format identifier so routing/retry queries work.
  if (encoding === 'qBEAP') {
    return {
      depackaged_json: null,
      depackaged_metadata: JSON.stringify({
        format: 'beap_qbeap_pending_main',
        encoding: 'qBEAP',
        header_summary: { sender_fingerprint: senderFingerprint, content_hash: contentHash, version },
        email_fallback_header: { subject: emailSubject, from },
        source: 'main_process_pending_beap',
        note: 'qBEAP requires extension sandbox and keys; email excerpt retained for search/context.',
      }),
    }
  }

  // Unknown encoding but has header
  return {
    depackaged_json: null,
    depackaged_metadata: JSON.stringify({
      format: 'beap_message_main_process_partial',
      encoding: typeof encoding === 'string' ? encoding : 'unknown',
      header_summary: { sender_fingerprint: senderFingerprint, content_hash: contentHash, version },
      body_excerpt: bodyExcerpt,
      source: 'main_process_pending_beap',
      note: 'Unrecognised BEAP message shape for main-process decode; email fields retained.',
    }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase B, PR B-4 — P2P Inline Validator-Before-Write + Sandbox Quarantine Receive
// ─────────────────────────────────────────────────────────────────────────────
//
// Phase B, PR B-7.2: `QbeapDecryptInboxStmts`, `createQbeapDecryptInboxStmts`,
// and `tryQbeapDecryptInbox` have been removed.  These helpers performed raw
// `db.prepare().run()` writes with no seal and had no production callers.
// The canonical re-seal helper is now `resealWithDecryptedContent` in
// `sealedContentUpdate.ts`.  `retryPendingQbeapDecrypt` (below) is refactored
// to use `resealWithDecryptedContent`.
// ─────────────────────────────────────────────────────────────────────────────
//
// Decision A: P2P relay reuses messageRouter's validate-before-write pattern.
// Decision C: Sandbox-side quarantine receive: detect sandbox_clone_quarantine
//   flag, qBEAP-decrypt outer clone, decryptQuarantineBlob inner layer, then
//   re-process original BEAP bytes through the same inline flow.
//
// per Phase B Architecture, Implementation Prompt B-4/11.

/** Sentinel value used for sandbox-final-state quarantine rows (no blob to store). */
const SANDBOX_FINAL_STATE_BLOB_ID = '__sandbox_final_state__'
const SANDBOX_FINAL_STATE_BLOB_SHA = 'sandbox_final_state_no_blob'

// P2P_BEAP_ACCOUNT_ID is declared at module scope (line 44); no re-declaration needed here.

const P2P_INBOX_INSERT_SQL = `
  INSERT INTO inbox_messages (
    id, source_type, handshake_id, account_id, email_message_id,
    from_address, from_name, to_addresses, cc_addresses,
    subject, body_text, body_html, beap_package_json,
    depackaged_json, has_attachments, attachment_count, received_at, ingested_at,
    imap_remote_mailbox, imap_rfc_message_id,
    validated_at, validator_version, validation_reason,
    seal, seal_input_json,
    seal_key_source
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

/**
 * Minimal placeholder row — written when a capsule arrives but processing is blocked
 * (inner vault locked, validator unhealthy, etc.).  Uses plain db.prepare() since
 * sealed-storage is unavailable in the same conditions that trigger a placeholder.
 * INSERT OR IGNORE: first arrival wins; duplicate relay deliveries are silently dropped.
 */
const P2P_INBOX_PLACEHOLDER_INSERT_SQL = `
  INSERT OR IGNORE INTO inbox_messages (
    id, source_type, handshake_id, account_id, email_message_id,
    from_address, subject, received_at, ingested_at,
    imap_remote_mailbox,
    pending_reason_code, pending_first_seen_at, pending_last_retry_at,
    raw_capsule_json,
    seal_key_source
  ) VALUES (?, 'direct_beap', ?, ?, ?, ?, ?, ?, ?, 'p2p', ?, ?, ?, ?, ?)
`

interface P2PInboxPlaceholderParams {
  rowId: string
  handshakeId: string
  transportSender: string | null
  receivedAt: string
  now: string
  pendingReasonCode: ReasonCode
  sealKeySource: 'ledger' | 'vmk'
  rawCapsuleJson: string
}

function writeP2PInboxPlaceholder(db: any, p: P2PInboxPlaceholderParams): void {
  try {
    db.prepare(P2P_INBOX_PLACEHOLDER_INSERT_SQL).run(
      p.rowId,
      p.handshakeId,
      P2P_BEAP_ACCOUNT_ID,
      `p2p-${p.rowId}`,
      p.transportSender,
      '(pending — capsule awaiting processing)',
      p.receivedAt,
      p.now,
      p.pendingReasonCode,
      p.receivedAt,
      p.now,
      p.rawCapsuleJson,
      p.sealKeySource,
    )
    console.log(`[BEAP_DELIVERY] placeholder_written messageId=${p.rowId} reason=${p.pendingReasonCode} handshake=${p.handshakeId}`)
  } catch (err: unknown) {
    console.warn('[P2P-INLINE] writeP2PInboxPlaceholder failed:', (err as Error)?.message ?? err)
  }
}

const P2P_QUARANTINE_INSERT_SQL = `
  INSERT INTO quarantine_messages (
    id, transport_sender, transport_received_at, transport_folder,
    blob_size_bytes, blob_storage_id, blob_sha256, rejection_reason,
    paired_sandbox_handshake_id,
    seal, seal_input_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

export interface P2PInlineResult {
  outcome: 'inbox' | 'quarantine' | 'error'
  rowId?: string
  error?: string
  reasonCode?: ReasonCode
  retryable?: boolean
}

function buildP2PProvenance(
  handshakeId: string,
  transportSender: string | null,
  sourceType: ProvenanceMetadata['source_type'],
  packageJson: string,
): ProvenanceMetadata {
  return {
    source_type: sourceType,
    origin_classification: 'external',
    ingested_at: new Date().toISOString(),
    transport_metadata: {
      sender_address: transportSender ?? undefined,
      message_id: handshakeId,
    },
    input_classification: 'beap_capsule_present',
    raw_input_hash: createHash('sha256').update(packageJson, 'utf8').digest('hex'),
    ingestor_version: '1.0.0',
  }
}

interface P2PInboxWriteParams {
  rowId: string
  handshakeId: string
  sourceType: string
  depackagedJson: string
  depackagedMetadata: string
  packageJson: string
  transportSender: string | null
  preview: { subject: string; body_text: string; from_address: string | null }
  receivedAt: string
  now: string
  transportFolder: string
  seal: string
  sealInputJson: string
  validatedAt: string | null
  validatorVersion: string | null
  validationReason: string | null
  /** Which key provider was used to compute the seal. Determines seal_key_source tag. */
  sealProviderSource: KeySource
}

function writeP2PInboxRow(db: any, p: P2PInboxWriteParams): P2PInlineResult {
  const sealKeySource = p.sealProviderSource === 'outer' ? 'ledger' : 'vmk'
  const insertInbox = prepareSealedInsert(db, P2P_INBOX_INSERT_SQL)
  insertInbox.run(
    [
      p.rowId,
      p.sourceType,
      p.handshakeId,
      P2P_BEAP_ACCOUNT_ID,
      `p2p-${p.rowId}`,
      p.transportSender,
      null,
      '[]',
      '[]',
      p.preview.subject,
      p.preview.body_text,
      null,
      p.packageJson,
      p.depackagedJson,
      0,
      0,
      p.receivedAt,
      p.now,
      p.transportFolder,
      null,
      p.validatedAt,
      p.validatorVersion,
      p.validationReason,
      p.seal,
      p.sealInputJson,
      sealKeySource,
    ],
    {
      seal: p.seal,
      seal_input_json: p.sealInputJson,
      canonical_json: p.depackagedJson,
      row_id: p.rowId,
    },
    p.sealProviderSource,
  )
  console.log(`[BEAP_DELIVERY] inbox_row_inserted messageId=${p.rowId} seal_key_source=${sealKeySource} handshake=${p.handshakeId}`)
  return { outcome: 'inbox', rowId: p.rowId }
}

interface P2PQuarantineWriteParams {
  rejectionReason: string
  transportSender: string | null
  receivedAt: string
  transportFolder: string
  now: string
  session?: SSOSession | null
  /** When true, writes a sandbox-final-state quarantine row (no blob encryption). */
  isSandboxFinalState?: boolean
  sandboxFinalStateHandshakeId?: string
}

async function writeP2PQuarantineRow(
  db: any,
  packageJson: string,
  handshakeId: string,
  p: P2PQuarantineWriteParams,
): Promise<P2PInlineResult> {
  const quarantineId = randomUUID()

  let blobStorageId: string
  let blobSha256: string
  let blobSizeBytes: number
  let pairedSandboxHandshakeId: string

  if (p.isSandboxFinalState) {
    // Sandbox is the final destination — no sub-sandbox to encrypt for.
    // Use sentinel values to mark this as a final-state row.
    blobStorageId = SANDBOX_FINAL_STATE_BLOB_ID
    blobSha256 = SANDBOX_FINAL_STATE_BLOB_SHA
    blobSizeBytes = 0
    pairedSandboxHandshakeId = p.sandboxFinalStateHandshakeId ?? handshakeId
  } else {
    const sandboxHandshake = findPairedSandboxHandshake(db, p.session ?? null)
    if (!sandboxHandshake) {
      // No paired sandbox: write a final-state quarantine row with sentinels.
      blobStorageId = SANDBOX_FINAL_STATE_BLOB_ID
      blobSha256 = SANDBOX_FINAL_STATE_BLOB_SHA
      blobSizeBytes = 0
      pairedSandboxHandshakeId = handshakeId
    } else {
      const emailBytes = Buffer.from(packageJson, 'utf-8')
      const encResult = encryptForQuarantine(emailBytes, sandboxHandshake.peer_x25519_public_key_b64)
      if (!encResult.ok) {
        console.error('[P2P-INLINE] encryptForQuarantine failed:', encResult.error)
        blobStorageId = SANDBOX_FINAL_STATE_BLOB_ID
        blobSha256 = SANDBOX_FINAL_STATE_BLOB_SHA
        blobSizeBytes = 0
        pairedSandboxHandshakeId = handshakeId
      } else {
        const blobResult = writeQuarantineBlob(encResult.blob)
        blobStorageId = blobResult.storage_id
        blobSha256 = blobResult.blob_sha256
        blobSizeBytes = blobResult.blob_size_bytes
        pairedSandboxHandshakeId = sandboxHandshake.handshake_id
      }
    }
  }

  const qCanonicalJson = buildQuarantineCanonicalJson({
    id: quarantineId,
    blob_storage_id: blobStorageId,
    blob_sha256: blobSha256,
    rejection_reason: p.rejectionReason,
    paired_sandbox_handshake_id: pairedSandboxHandshakeId,
  })

  const qProvenance = buildP2PProvenance(handshakeId, p.transportSender, 'p2p', packageJson)
  const qResp = await validatorOrchestrator.validate({
    envelope: {},
    plaintext_or_encrypted: { kind: 'plaintext', content: qCanonicalJson },
    provenance: qProvenance,
    target_row_id: quarantineId,
  })

  if (!qResp.outcome.ok) {
    throw new Error(`P2P quarantine validator rejected (structural bug): ${qResp.outcome.sealed_quarantine.rejection_reason}`)
  }

  const qSealed = qResp.outcome.sealed
  const insertQ = prepareSealedInsert(db, P2P_QUARANTINE_INSERT_SQL)
  insertQ.run(
    [
      quarantineId,
      p.transportSender ?? handshakeId,
      p.receivedAt,
      p.transportFolder,
      blobSizeBytes,
      blobStorageId,
      blobSha256,
      p.rejectionReason,
      pairedSandboxHandshakeId,
      qSealed.seal,
      qSealed.seal_input_json,
    ],
    {
      seal: qSealed.seal,
      seal_input_json: qSealed.seal_input_json,
      canonical_json: qCanonicalJson,
      row_id: quarantineId,
    },
  )
  return { outcome: 'quarantine', rowId: quarantineId }
}

/**
 * Sandbox-side quarantine receive branch (Decision C, Phase B PR B-4).
 *
 * Called when the incoming P2P package has
 * `metadata.inbox_response_path.sandbox_clone_quarantine === true`.
 *
 * Flow:
 *   1. qBEAP-decrypt the outer clone package → body = QuarantineBlobFile JSON.
 *   2. Parse body as QuarantineBlobFile.
 *   3. decryptQuarantineBlob using local X25519 private key.
 *   4. Process decrypted original BEAP bytes through processBeapPackageInline.
 *   5. Any failure → sandbox-side final-state quarantine row.
 *
 * Encoding contract (host side, to be implemented in a future PR for the
 * clone-to-sandbox IPC): encryptedMessage = JSON.stringify(QuarantineBlobFile).
 * After qBEAP decrypt, decryptedContent.body = the QuarantineBlobFile JSON string.
 */
async function processSandboxQuarantineReceiveInternal(
  db: any,
  pkg: Record<string, unknown>,
  packageJson: string,
  handshakeId: string,
  opts: {
    rowId: string
    receivedAt: string
    transportFolder: string
    now: string
    session?: SSOSession | null
  },
): Promise<P2PInlineResult> {
  const writeFinaState = (reason: string) =>
    writeP2PQuarantineRow(db, packageJson, handshakeId, {
      rejectionReason: reason,
      transportSender: null,
      receivedAt: opts.receivedAt,
      transportFolder: opts.transportFolder,
      now: opts.now,
      session: opts.session,
      isSandboxFinalState: true,
      sandboxFinalStateHandshakeId: handshakeId,
    })

  // Step 1: qBEAP-decrypt the outer clone package.
  let decrypted: DepackagedQBeapContent | null = null
  try {
    decrypted = await depackageQBeapViaPod(packageJson, handshakeId, db, {
      reportFailure: reportQbeapDecryptFailure('P2P-INLINE-SANDBOX'),
    })
  } catch {
    /* fall through */
  }
  if (!decrypted?.body) {
    console.warn('[P2P-INLINE] Sandbox quarantine receive: outer qBEAP decrypt failed for handshake', handshakeId)
    return writeFinaState('blob_decrypt_failed')
  }

  // Step 2: Parse body as QuarantineBlobFile.
  let blobFile: QuarantineBlobFile | null = null
  try {
    blobFile = JSON.parse(decrypted.body) as QuarantineBlobFile
    if (blobFile.version !== 'quarantine-v1') throw new Error(`Unsupported blob version: ${blobFile.version}`)
  } catch (e: unknown) {
    console.warn('[P2P-INLINE] Sandbox quarantine receive: blob parse failed:', (e as Error)?.message ?? e)
    return writeFinaState('blob_parse_failed')
  }

  // Step 3: Decrypt quarantine blob using local X25519 private key.
  const hsRecord = getHandshakeRecord(db, handshakeId)
  const localPrivKey = hsRecord?.local_x25519_private_key_b64?.trim()
  if (!localPrivKey) {
    console.warn('[P2P-INLINE] Sandbox quarantine receive: local_x25519_private_key_b64 missing for handshake', handshakeId)
    return writeFinaState('blob_decrypt_failed_no_local_key')
  }

  const decryptResult = decryptQuarantineBlob(blobFile, localPrivKey)
  if (!decryptResult.ok) {
    console.warn('[P2P-INLINE] Sandbox quarantine receive: decryptQuarantineBlob failed:', decryptResult.error)
    return writeFinaState('blob_decrypt_failed')
  }

  // Step 4: Process decrypted original BEAP bytes as a regular P2P message.
  // The isSandboxDecryptedBlob flag causes depackage failure to write
  // a sandbox-final-state quarantine row instead of another blob-encrypted row.
  const originalPackageJson = decryptResult.plaintext.toString('utf-8')
  console.log('[P2P-INLINE] Sandbox quarantine receive: blob decrypted, processing original BEAP bytes for handshake', handshakeId)
  return processBeapPackageInlineInternal(db, originalPackageJson, handshakeId, {
    receivedAt: opts.receivedAt,
    transportFolder: opts.transportFolder,
    session: opts.session,
    isSandboxDecryptedBlob: true,
  })
}

/**
 * Internal implementation of processBeapPackageInline that accepts an
 * `isSandboxDecryptedBlob` flag to control quarantine fallback behaviour.
 *
 * When `isSandboxDecryptedBlob = true`, a depackage failure writes a
 * sandbox-final-state quarantine row (no blob encryption, sentinel values)
 * instead of encrypting for a sub-sandbox.
 */
async function processBeapPackageInlineInternal(
  db: any,
  packageJson: string,
  handshakeId: string,
  options: {
    receivedAt?: string
    transportSender?: string | null
    transportFolder?: string
    session?: SSOSession | null
    sourceType?: ProvenanceMetadata['source_type']
    isSandboxDecryptedBlob?: boolean
  },
): Promise<P2PInlineResult> {
  const now = new Date().toISOString()
  const receivedAt = options.receivedAt ?? now
  const transportFolder = options.transportFolder ?? 'p2p'
  const sourceType = options.sourceType ?? 'p2p'
  const rowId = randomUUID()

  console.log(`[BEAP_DELIVERY] native_message_received messageId=${rowId} handshake=${handshakeId} sourceType=${sourceType}`)

  // ── Parse outer package ──────────────────────────────────────────────────
  let pkg: Record<string, unknown>
  let pkgEncoding: string | undefined
  try {
    pkg = JSON.parse(packageJson.trim()) as Record<string, unknown>
    const h = pkg.header as Record<string, unknown> | undefined
    pkgEncoding = typeof h?.encoding === 'string' ? h.encoding : undefined
  } catch {
    pkg = {}
    pkgEncoding = undefined
  }

  // Detect sandbox clone early so receiver logs use [CLONE_RECEIVE] prefix.
  const outerMetaForCloneDetect = pkg.metadata as Record<string, unknown> | undefined
  const inboxResponsePathForCloneDetect = outerMetaForCloneDetect?.inbox_response_path as Record<string, unknown> | undefined
  const isSandboxClone = !options.isSandboxDecryptedBlob && inboxResponsePathForCloneDetect?.sandbox_clone === true
  if (isSandboxClone) {
    console.log(`[CLONE_RECEIVE] ingest_received cloneId=clone-${rowId.slice(0, 8)} messageId=${rowId} handshake=${handshakeId}`)
  }

  // ── Capability preflight (no silent drop) ────────────────────────────────
  {
    const { canPerform } = await import('../vault/capabilityBroker')
    const capability = canPerform('beap_receive', { handshakeId })
    if (!capability.allowed) {
      const classification = getHandshakeClassification(handshakeId)
      const sealKeySource: 'ledger' | 'vmk' = classification === 'confidential' ? 'vmk' : 'ledger'
      console.log(
        `[BEAP_DELIVERY] receive_blocked messageId=${rowId} reason=${capability.reasonCode} classification=${classification}`,
      )

      const _transportSenderEarly = options.transportSender ?? null
      writeP2PInboxPlaceholder(db, {
        rowId,
        handshakeId,
        transportSender: _transportSenderEarly,
        receivedAt,
        now,
        pendingReasonCode: capability.reasonCode,
        sealKeySource,
        rawCapsuleJson: packageJson,
      })
      notifyBeapInboxDashboard(handshakeId)

      return {
        outcome: 'error',
        rowId,
        error: capability.userMessage || capability.reasonCode,
        reasonCode: capability.reasonCode,
        retryable: capability.retryStrategy !== 'user_action',
      }
    }
  }

  // ── Sandbox quarantine receive branch (Decision C) ────────────────────────
  // Only check when NOT already processing a decrypted blob (avoids re-entry).
  if (!options.isSandboxDecryptedBlob) {
    const outerMeta = pkg.metadata as Record<string, unknown> | undefined
    const inboxResponsePath = outerMeta?.inbox_response_path as Record<string, unknown> | undefined
    if (inboxResponsePath?.sandbox_clone_quarantine === true) {
      return processSandboxQuarantineReceiveInternal(db, pkg, packageJson, handshakeId, {
        rowId,
        receivedAt,
        transportFolder,
        now,
        session: options.session,
      })
    }
  }

  // ── Transport sender resolution ───────────────────────────────────────────
  const parties = handshakeId ? getHandshakePartyEmails(db, handshakeId) : { counterpartyEmail: null, localEmail: null }
  const transportSender = options.transportSender ?? parties.counterpartyEmail

  // ── Preview extraction ────────────────────────────────────────────────────
  let preview = extractP2PBeapInboxPreview(packageJson)

  // ── Outbound echo check ────────────────────────────────────────────────────
  if (isOutboundQbeapEcho(packageJson, handshakeId, db)) {
    const { depackaged_json: dpJson, depackaged_metadata: dpMeta } = buildOutboundQbeapDepackagedJson(
      packageJson,
      { id: rowId, subject: preview.subject, from_address: transportSender, body_text: preview.body_text },
    )
    const provenance = buildP2PProvenance(handshakeId, transportSender, sourceType, packageJson)
    const resp = await validatorOrchestrator.validate({
      envelope: pkg,
      plaintext_or_encrypted: { kind: 'plaintext', content: dpJson },
      provenance,
      target_row_id: rowId,
    })
    if (!resp.outcome.ok) {
      throw new Error(`P2P inline: validator rejected outbound qBEAP echo: ${resp.outcome.sealed_quarantine.rejection_reason}`)
    }
    const sealed = resp.outcome.sealed
    console.log(`[BEAP_DELIVERY] direct_message_classified messageId=${rowId} classification=outbound_echo`)
    console.log(`[BEAP_DELIVERY] persist_attempt messageId=${rowId} handshake=${handshakeId}`)
    const echoResult = writeP2PInboxRow(db, {
      rowId, handshakeId, sourceType: 'direct_beap',
      depackagedJson: sealed.canonical_json,
      depackagedMetadata: dpMeta,
      packageJson, transportSender, preview,
      receivedAt, now, transportFolder,
      seal: sealed.seal, sealInputJson: sealed.seal_input_json,
      validatedAt: sealed.validated_at, validatorVersion: sealed.validator_version,
      validationReason: null,
      sealProviderSource: 'inner',
    })
    if (echoResult.outcome === 'inbox') {
      if (isSandboxClone) {
        console.log(`[CLONE_RECEIVE] persist_success cloneId=clone-${rowId.slice(0, 8)} messageId=${rowId} handshake=${handshakeId} outcome=inbox`)
        console.log(`[CLONE_RECEIVE] ui_notify_sent cloneId=clone-${rowId.slice(0, 8)} messageId=${rowId}`)
        console.log(`[CLONE_RECEIVE] ack_sent cloneId=clone-${rowId.slice(0, 8)} messageId=${rowId} handshake=${handshakeId}`)
      }
      // Outbound qBEAP echo: refresh inbox + extension; do not emit delivery ACK (not a peer-received message).
      finalizeDirectBeapInboxPersistence(db, handshakeId, rowId, false)
    }
    return echoResult
  }

  // ── Inline depackage ───────────────────────────────────────────────────────
  let canonicalJson: string | null = null
  let depackageError: string | null = null
  let depackagedMetadata: string | null = null
  let decryptedQbeap: DepackagedQBeapContent | null = null
  const cloneEmailResponsePath =
    isSandboxClone && inboxResponsePathForCloneDetect?.original_response_path === 'email'

  if (pkgEncoding === 'qBEAP') {
    try {
      const decr = await depackageQBeapViaPod(packageJson, handshakeId, db, {
        reportFailure: reportQbeapDecryptFailure('P2P-INLINE'),
      })
      if (decr?.rawCapsuleJson) {
        decryptedQbeap = decr
        canonicalJson = decr.rawCapsuleJson
        depackagedMetadata = JSON.stringify({
          format: 'beap_qbeap_decrypted',
          encoding: 'qBEAP',
          source: cloneEmailResponsePath
            ? 'main_process_p2p_inline_sandbox_clone_email'
            : 'main_process_p2p_inline',
          decrypted_at: now,
        })
        preview = applyDecryptedQBeapToInboxPreview(preview, decr, {
          stripCloneLeadIn: isSandboxClone,
        })
      } else {
        depackageError = 'qBEAP decrypt returned null (missing handshake key or malformed package)'
      }
    } catch (err: unknown) {
      depackageError = `qBEAP decrypt error: ${err instanceof Error ? err.message : String(err)}`
    }
  } else if (pkgEncoding === 'pBEAP') {
    try {
      const payloadB64 = (pkg.payload as string | undefined) ?? ''
      if (!payloadB64.trim()) {
        depackageError = 'pBEAP package has no payload field'
      } else {
        canonicalJson = Buffer.from(payloadB64, 'base64').toString('utf-8')
        depackagedMetadata = JSON.stringify({
          format: 'beap_message_main_process',
          encoding: 'pBEAP',
          source: 'main_process_p2p_inline',
          trust_note: 'Public pBEAP payload decoded in main process without Stage-5 sandbox signature / gate verification.',
        })
      }
    } catch (err: unknown) {
      depackageError = `pBEAP decode error: ${err instanceof Error ? err.message : String(err)}`
    }
  } else if (typeof pkg.schema_version === 'number' && typeof pkg.capsule_type === 'string') {
    // Handshake capsule — the outer JSON is canonical.
    canonicalJson = packageJson
    depackagedMetadata = JSON.stringify({
      format: 'beap_handshake_capsule_p2p',
      capsule_type: pkg.capsule_type,
      source: 'main_process_p2p_inline',
    })
  } else {
    depackageError = `Unrecognised BEAP package shape; encoding=${pkgEncoding ?? 'missing'}`
  }

  // ── Seal and write inbox row ─────────────────────────────────────────────
  // Classification determines which seal key to use:
  //   non_confidential → computeSeal with 'outer' provider (no validator subprocess)
  //   confidential     → validatorOrchestrator.validate() with 'inner' provider
  //
  // For W4-P11 all handshakes classify as non_confidential (fallback).
  // The confidential branch is scaffolded for W4-P12.
  if (canonicalJson !== null) {
    const classification = getHandshakeClassification(handshakeId)
    const sealProviderSource: KeySource = classification === 'confidential' ? 'inner' : 'outer'
    const rowSourceType = cloneEmailResponsePath ? 'email_beap' : 'direct_beap'
    let depackagedJsonForRow = canonicalJson
    if (cloneEmailResponsePath && decryptedQbeap) {
      depackagedJsonForRow = buildEmailStyleDepackagedJsonFromDecrypt(decryptedQbeap, {
        stripCloneLeadIn: true,
      })
    }

    if (classification === 'non_confidential') {
      // ── Non-confidential path: outer key, no validator subprocess ─────────
      let sealResult: { seal: string; seal_input_json: string } | null = null
      try {
        sealResult = computeSeal(depackagedJsonForRow, rowId, 'outer')
      } catch (err: unknown) {
        depackageError = `outer seal computation failed: ${err instanceof Error ? err.message : String(err)}`
        // sealResult stays null — fall through to quarantine path below.
      }
      if (sealResult !== null) {
        if (isSandboxClone) {
          console.log(`[CLONE_RECEIVE] classified_as_clone cloneId=clone-${rowId.slice(0, 8)} messageId=${rowId} encoding=${pkgEncoding ?? 'qBEAP'} handshake=${handshakeId}`)
          console.log(`[CLONE_RECEIVE] persist_attempt cloneId=clone-${rowId.slice(0, 8)} messageId=${rowId} handshake=${handshakeId}`)
        } else {
          console.log(`[BEAP_DELIVERY] direct_message_classified messageId=${rowId} encoding=${pkgEncoding ?? 'handshake'} classification=non_confidential handshake=${handshakeId}`)
          console.log(`[BEAP_DELIVERY] persist_attempt messageId=${rowId} handshake=${handshakeId}`)
        }
        const outerValidatedAt = new Date().toISOString()
        const inlineResult = writeP2PInboxRow(db, {
          rowId, handshakeId, sourceType: rowSourceType,
          depackagedJson: depackagedJsonForRow,
          depackagedMetadata: depackagedMetadata ?? '',
          packageJson, transportSender, preview,
          receivedAt, now, transportFolder,
          seal: sealResult.seal, sealInputJson: sealResult.seal_input_json,
          validatedAt: outerValidatedAt,
          validatorVersion: 'outer-ledger-v1',
          validationReason: 'non_confidential_ledger_sealed',
          sealProviderSource,
        })
        if (inlineResult.outcome === 'inbox') {
          if (isSandboxClone) {
            console.log(
              `[CLONE_RECEIVE] persist_success cloneId=clone-${rowId.slice(0, 8)} messageId=${rowId} handshake=${handshakeId} outcome=inbox source_type=${rowSourceType} body_len=${preview.body_text.length}`,
            )
            console.log(`[CLONE_RECEIVE] ui_notify_sent cloneId=clone-${rowId.slice(0, 8)} messageId=${rowId}`)
            console.log(`[CLONE_RECEIVE] ack_sent cloneId=clone-${rowId.slice(0, 8)} messageId=${rowId} handshake=${handshakeId}`)
          }
          finalizeDirectBeapInboxPersistence(db, handshakeId, rowId, true)
        }
        return inlineResult
      }
    } else {
      // ── Confidential path: inner vault + validator subprocess ─────────────
      const provenance = buildP2PProvenance(handshakeId, transportSender, sourceType, packageJson)
      const resp = await validatorOrchestrator.validate({
        envelope: pkg,
        plaintext_or_encrypted: { kind: 'plaintext', content: depackagedJsonForRow },
        provenance,
        target_row_id: rowId,
      })
      if (resp.outcome.ok) {
        const sealed = resp.outcome.sealed
        if (isSandboxClone) {
          console.log(`[CLONE_RECEIVE] classified_as_clone cloneId=clone-${rowId.slice(0, 8)} messageId=${rowId} encoding=${pkgEncoding ?? 'qBEAP'} handshake=${handshakeId}`)
          console.log(`[CLONE_RECEIVE] persist_attempt cloneId=clone-${rowId.slice(0, 8)} messageId=${rowId} handshake=${handshakeId}`)
        } else {
          console.log(`[BEAP_DELIVERY] direct_message_classified messageId=${rowId} encoding=${pkgEncoding ?? 'handshake'} classification=confidential handshake=${handshakeId}`)
          console.log(`[BEAP_DELIVERY] persist_attempt messageId=${rowId} handshake=${handshakeId}`)
        }
        const sealedCanonical =
          cloneEmailResponsePath && decryptedQbeap
            ? buildEmailStyleDepackagedJsonFromDecrypt(decryptedQbeap, { stripCloneLeadIn: true })
            : sealed.canonical_json
        const inlineResult = writeP2PInboxRow(db, {
          rowId, handshakeId, sourceType: rowSourceType,
          depackagedJson: sealedCanonical,
          depackagedMetadata: depackagedMetadata ?? '',
          packageJson, transportSender, preview,
          receivedAt, now, transportFolder,
          seal: sealed.seal, sealInputJson: sealed.seal_input_json,
          validatedAt: sealed.validated_at, validatorVersion: sealed.validator_version,
          validationReason: null,
          sealProviderSource,
        })
        if (inlineResult.outcome === 'inbox') {
          if (isSandboxClone) {
            console.log(
              `[CLONE_RECEIVE] persist_success cloneId=clone-${rowId.slice(0, 8)} messageId=${rowId} handshake=${handshakeId} outcome=inbox source_type=${rowSourceType}`,
            )
            console.log(`[CLONE_RECEIVE] ui_notify_sent cloneId=clone-${rowId.slice(0, 8)} messageId=${rowId}`)
            console.log(`[CLONE_RECEIVE] ack_sent cloneId=clone-${rowId.slice(0, 8)} messageId=${rowId} handshake=${handshakeId}`)
          }
          finalizeDirectBeapInboxPersistence(db, handshakeId, rowId, true)
        }
        return inlineResult
      }
      depackageError = `validator rejected: ${resp.outcome.sealed_quarantine.rejection_reason}`
    }
  }

  // ── Quarantine path ────────────────────────────────────────────────────────
  const rejectionReason = depackageError ?? 'depackage_failed'
  console.warn('[P2P-INLINE] Routing to quarantine, reason:', rejectionReason, 'handshake:', handshakeId)
  return writeP2PQuarantineRow(db, packageJson, handshakeId, {
    rejectionReason,
    transportSender,
    receivedAt,
    transportFolder,
    now,
    session: options.session,
    isSandboxFinalState: options.isSandboxDecryptedBlob === true,
    sandboxFinalStateHandshakeId: handshakeId,
  })
}

/**
 * Inline P2P BEAP package ingestion — Phase B, PR B-4.
 *
 * Replaces the two-stage `insertPendingP2PBeap → processPendingP2PBeapEmails`
 * pattern.  Called directly from P2P entry points (coordinationWs, p2pServer,
 * relayPull) and from the `handshake:importBeapMessage` IPC handler.
 *
 * Decision A — validate-before-write: no row is written before the validator
 *   subprocess has produced a cryptographic seal.
 *
 * Decision B — P2P quarantine path: messages that cannot be depackaged go to
 *   `quarantine_messages` with `transport_folder = transportFolder` (e.g. 'p2p').
 *
 * Decision C — sandbox quarantine receive: packages with
 *   `metadata.inbox_response_path.sandbox_clone_quarantine === true` are
 *   routed through `processSandboxQuarantineReceive` instead.
 *
 * @param sourceType  SourceType for provenance (caller supplies 'p2p',
 *   'p2p_relay', 'relay_pull', 'coordination_ws', etc.).
 */
export async function processBeapPackageInline(
  db: any,
  packageJson: string,
  handshakeId: string,
  options: {
    receivedAt?: string
    transportSender?: string | null
    transportFolder?: string
    session?: SSOSession | null
    sourceType?: ProvenanceMetadata['source_type']
  } = {},
): Promise<P2PInlineResult> {
  try {
    return await processBeapPackageInlineInternal(db, packageJson, handshakeId, options)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[P2P-INLINE] Unhandled error in processBeapPackageInline:', msg)
    return { outcome: 'error', error: msg }
  }
}

/**
 * Public entry point for the sandbox-side quarantine receive branch.
 * Accepts a raw outer qBEAP package JSON string (the clone message as
 * received at the sandbox) plus the handshake identifier for the paired host.
 *
 * Used by tests and future host-side clone IPC integration.
 */
export async function processSandboxQuarantineReceive(
  db: any,
  outerPackageJson: string,
  handshakeId: string,
  opts: {
    receivedAt?: string
    transportFolder?: string
    session?: SSOSession | null
  } = {},
): Promise<P2PInlineResult> {
  const now = new Date().toISOString()
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(outerPackageJson.trim()) as Record<string, unknown>
  } catch {
    pkg = {}
  }
  try {
    return await processSandboxQuarantineReceiveInternal(db, pkg, outerPackageJson, handshakeId, {
      rowId: randomUUID(),
      receivedAt: opts.receivedAt ?? now,
      transportFolder: opts.transportFolder ?? 'p2p',
      now,
      session: opts.session,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[P2P-INLINE] Error in processSandboxQuarantineReceive:', msg)
    return { outcome: 'error', error: msg }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/** Run `retryPendingQbeapDecrypt` at most once per process (avoids timer spam from tryP2PStartup). */
let pendingQbeapDecryptRetryRan = false

/**
 * One-time legacy backfill: inbox rows written by the pre-B-4 P2P path
 * with format `beap_qbeap_pending_main` are retried using current handshake
 * keys and, on success, updated via the sealed-storage gate.
 *
 * Phase B, PR B-4 migration: this function now uses `prepareSealedUpdate`
 * with a validator subprocess call so each successfully decrypted row
 * receives a valid seal and becomes readable by the gate's read-path.
 *
 * SAFETY GUARD: the query explicitly excludes rows with a non-NULL `seal`
 * column (B-3+ sealed rows written by detectAndRouteMessage or
 * processBeapPackageInline).  B-3+ rows were fully depackaged at ingest;
 * overwriting their depackaged_json without re-sealing would invalidate
 * the existing seal.
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
          // PR 5.1: format moved from depackaged_json to depackaged_metadata.
          // Check both columns so the query works on pre-migration rows (old format
          // still in depackaged_json) and post-migration rows (format in depackaged_metadata).
          // PR B-3.1 safety guard: exclude sealed rows (seal IS NOT NULL).
          `SELECT id, beap_package_json, handshake_id, subject, from_address, body_text
           FROM inbox_messages
           WHERE source_type = 'direct_beap'
             AND (seal IS NULL OR seal = '')
             AND (
               depackaged_metadata LIKE '%beap_qbeap_pending_main%'
               OR (depackaged_metadata IS NULL AND depackaged_json LIKE '%beap_qbeap_pending_main%')
             )
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

    console.log(`[RETRY-DECRYPT] Found ${rows.length} inbox row(s) with qBEAP pending (main); attempting sealed backfill`)

    for (const row of rows) {
      const pkg = String(row.beap_package_json ?? '').trim()
      if (!pkg) continue
      const fallback: InboxRowFallback = {
        id: row.id,
        subject: row.subject,
        from_address: row.from_address,
        body_text: row.body_text,
      }
      try {
        if (isOutboundQbeapEcho(pkg, row.handshake_id, db)) {
          const { depackaged_json: dpJson, depackaged_metadata: dpMeta } =
            buildOutboundQbeapDepackagedJson(pkg, fallback)
          const provenance = buildP2PProvenance(row.handshake_id, row.from_address, 'p2p', pkg)
          let dpMetaObj: Record<string, unknown>
          try { dpMetaObj = JSON.parse(dpMeta) as Record<string, unknown> } catch { dpMetaObj = {} }
          const res = await resealWithDecryptedContent(db, {
            rowId: row.id,
            rawCapsuleJson: dpJson,
            bodyText: OUTBOUND_QBEAP_BODY_PLACEHOLDER,
            subject: fallback.subject ?? '',
            depackagedMetadata: dpMetaObj,
            provenance,
            attachmentCount: 0,
          })
          if (!res.ok) {
            console.warn(`[RETRY-DECRYPT] Outbound echo reseal failed id=${row.id}: ${res.error}`)
            continue
          }
          fixed++
          console.log(`[RETRY-DECRYPT] Outbound qBEAP echo sealed id=${row.id}`)
          continue
        }

        const decrypted = await depackageQBeapViaPod(pkg, row.handshake_id, db, {
          reportFailure: reportQbeapDecryptFailure('RETRY-DECRYPT'),
        })
        if (!decrypted?.rawCapsuleJson) {
          console.warn(`[RETRY-DECRYPT] Cannot decrypt id=${row.id} (handshake key unavailable)`)
          continue
        }

        const provenance = buildP2PProvenance(row.handshake_id, row.from_address, 'p2p', pkg)
        const attCount = decrypted.attachments?.length ?? 0
        const res = await resealWithDecryptedContent(db, {
          rowId: row.id,
          rawCapsuleJson: decrypted.rawCapsuleJson,
          bodyText: decrypted.body ?? fallback.body_text ?? '',
          subject: decrypted.subject || fallback.subject || 'BEAP message',
          depackagedMetadata: {
            format: 'beap_qbeap_decrypted',
            encoding: 'qBEAP',
            source: 'retry_pending_qbeap_decrypt_b4',
            decrypted_at: new Date().toISOString(),
          },
          provenance,
          attachmentCount: attCount,
        })
        if (!res.ok) {
          console.warn(`[RETRY-DECRYPT] reseal failed id=${row.id}: ${res.error}`)
          continue
        }
        fixed++
        console.log(`[RETRY-DECRYPT] Sealed legacy row id=${row.id}`)
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
 * Multi-shot retry: scans `inbox_messages` where `pending_reason_code IS NOT NULL`
 * and re-attempts `processBeapPackageInline` for each row whose blocking condition
 * has cleared (per `capabilityBroker.canPerform`).
 *
 * Unlike `retryPendingQbeapDecrypt` this function has NO one-shot guard — it is
 * safe to call multiple times per process (e.g. after vault unlock, on P2P startup).
 *
 * On success the placeholder row is deleted and a new sealed `inbox_messages` row
 * is written by the inline pipeline.  A `inbox:beapInboxUpdated` broadcast triggers
 * a full list refresh in the renderer; a `inbox:beapDeliveryAck` broadcast (no status
 * field) triggers the W3-P7 sender state transition `delivered_deferred_inner_vault →
 * live` via the fallback path in `ackToState`.
 *
 * On failure (still blocked) only `pending_last_retry_at` is updated.
 */
export async function retryPendingInboxPlaceholders(db: any): Promise<number> {
  if (!db) return 0

  let rows: Array<{
    id: string
    handshake_id: string
    pending_reason_code: string
    raw_capsule_json: string | null
    received_at: string
    from_address: string | null
  }>

  try {
    rows = db
      .prepare(
        `SELECT id, handshake_id, pending_reason_code, raw_capsule_json, received_at, from_address
         FROM inbox_messages
         WHERE pending_reason_code IS NOT NULL
           AND raw_capsule_json IS NOT NULL
           AND TRIM(COALESCE(raw_capsule_json, '')) != ''
           AND source_type = 'direct_beap'`,
      )
      .all() as typeof rows
  } catch (e) {
    console.warn('[RETRY-PLACEHOLDER] Query failed:', (e as Error)?.message ?? e)
    return 0
  }

  if (!rows.length) return 0

  console.log(`[RETRY-PLACEHOLDER] Found ${rows.length} placeholder row(s); checking capability`)

  const { canPerform } = await import('../vault/capabilityBroker')

  const now = new Date().toISOString()
  let fixed = 0
  for (const row of rows) {
    const capability = canPerform('beap_receive', { handshakeId: row.handshake_id })
    if (!capability.allowed) {
      try {
        db.prepare(
          `UPDATE inbox_messages SET pending_last_retry_at = ?, pending_reason_code = ? WHERE id = ?`,
        ).run(now, capability.reasonCode, row.id)
      } catch { /* best-effort */ }
      continue
    }

    const capsule = row.raw_capsule_json?.trim()
    if (!capsule) continue
    try {
      const result = await processBeapPackageInline(db, capsule, row.handshake_id, {
        receivedAt: row.received_at,
        transportSender: row.from_address,
        transportFolder: 'p2p',
        sourceType: 'p2p',
      })
      if (result.outcome === 'inbox') {
        // New sealed row written — delete the placeholder.
        try {
          db.prepare(
            `DELETE FROM inbox_messages WHERE id = ? AND pending_reason_code IS NOT NULL`,
          ).run(row.id)
        } catch { /* best-effort */ }
        fixed++
        console.log(`[RETRY-PLACEHOLDER] Upgraded placeholder id=${row.id} → new inbox rowId=${result.rowId ?? '?'}`)
        notifyBeapInboxDashboard(row.handshake_id)
        notifyBeapDeliveryAck(row.handshake_id, row.id, { status: 'ok' })
        postPeerDeliveryAckToSender(db, row.handshake_id, row.id, { status: 'ok' })
      } else {
        // Still failed — update retry timestamp only.
        try {
          db.prepare(`UPDATE inbox_messages SET pending_last_retry_at = ? WHERE id = ?`).run(now, row.id)
        } catch { /* best-effort */ }
        console.warn(`[RETRY-PLACEHOLDER] Retry failed id=${row.id} outcome=${result.outcome} error=${result.error ?? ''}`)
      }
    } catch (e) {
      console.warn(`[RETRY-PLACEHOLDER] Error for id=${row.id}:`, (e as Error)?.message ?? e)
    }
  }

  return fixed
}

/**
 * Decode the pBEAP payload from a BEAP package JSON and return the raw
 * capsule object for content validation (PR 2.1/7).
 *
 * The `session_import_artefact` field lives inside the capsule, not in the
 * outer `depackaged_json` wrapper produced by `beapPackageToMainProcessDepackaged`.
 * Validators must receive the raw capsule to detect artefact presence.
 *
 * Returns `null` for non-pBEAP packages (qBEAP, handshake, malformed).
 * Never throws.
 *
 * per Canon A.3.054.8, Annex I.3.3
 */
export function extractPBeapCapsule(packageJson: string): unknown | null {
  try {
    const pkg = JSON.parse(packageJson.trim()) as Record<string, unknown>
    const header = pkg.header as Record<string, unknown> | undefined
    if (header?.encoding !== 'pBEAP') return null
    if (typeof pkg.payload !== 'string') return null
    const capsuleJson = Buffer.from(pkg.payload, 'base64').toString('utf8')
    return JSON.parse(capsuleJson)
  } catch {
    return null
  }
}

/**
 * Safe string for inbox DB errors in logs (no row bodies or secrets).
 */
export function formatBeapInboxDbError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * @deprecated Phase B, PR B-4 — P2P entry points now call `processBeapPackageInline`
 * directly (validate-before-write). The `p2p_pending_beap` staging table has been
 * dropped in schema migration v66. This stub exists only to avoid breaking callers
 * that have not yet been updated; it is a no-op and always returns 0.
 */
export async function processPendingP2PBeapEmails(_db: any): Promise<number> {
  return 0
}

