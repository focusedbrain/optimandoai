/**
 * Message Router — Phase B, PR B-3
 *
 * Detects BEAP content in incoming emails and routes to the sealed-storage
 * pipeline.  Validation runs BEFORE any inbox-bound write.
 *
 * Architecture decision (Phase B, Section 2.1 + Amendment 1 to B-3):
 *   "Validator runs before storage; no row exists in inbox_messages until a
 *    valid seal has been produced."
 *
 * Flow:
 *   1. Detect BEAP vs plain (sync, same heuristics as pre-B-3).
 *   2. BEAP path:
 *      a. Try inline depackaging (qBEAP decrypt or pBEAP extract).
 *      b. If depackage succeeds → validate canonical content via orchestrator
 *         → write sealed inbox_messages row.
 *      c. If depackage fails → quarantine: encrypt email bytes to sandbox's
 *         X25519 public key → write sealed quarantine_messages row.
 *   3. Plain email path:
 *      a. Build canonical plain_email content object.
 *      b. Validate via orchestrator (always ok for conformant plain emails).
 *      c. Write sealed inbox_messages row with validation_reason 'plain_email_no_validation_required'.
 *
 * p2p_pending_beap and plain_email_inbox staging tables are no longer written
 * by this module.  p2p_pending_beap was dropped in schema v66 (Phase B, PR B-4)
 * after P2P relay entry points were migrated to processBeapPackageInline.
 * plain_email_inbox was dropped in schema v65.
 *
 * @version 2.0.0 (Phase B, PR B-3)
 */

import { createHash, randomUUID } from 'crypto'

import { plainEmailToBeapMessage, enrichWithAttachments } from './plainEmailConverter'
import type { SanitizedMessageDetail } from './types'
import { emailGateway } from './gateway'
import { extractPdfText, isPdfFile, resolveInboxPdfExtractionStatus } from './pdf-extractor'
import { writeEncryptedAttachmentFile } from './attachmentBlobCrypto'
import { decryptQBeapPackage } from '../beap/decryptQBeapPackage'
import { classifyLivePbeapTrust, pbeapTrustMetadata } from '../depackaging-microvm/livePbeapTrust'
import { validatorOrchestrator } from '../validator-process/orchestrator'
import { isSeamValidationCutoverEnabled, isSeamDepackageCutoverEnabled } from '../critical-jobs/featureFlags'
import { assertNoInlineParse } from './inlineParseGuard'
import { prepareSealedInsert, runSealedTransaction, computeSeal, type ChildAttachmentDescriptor } from '../sealed-storage/index'
import {
  listAvailableInternalSandboxes,
  isEligibleActiveInternalHostSandboxRecord,
} from '../handshake/internalSandboxesApi'
import { getHandshakeRecord } from '../handshake/db'
import { encryptForQuarantine } from '../quarantine-encrypt/index'
import { writeQuarantineBlob } from '../quarantine-blob-storage/index'
import type { SSOSession } from '../handshake/types'
import type { ProvenanceMetadata } from '@repo/ingestion-core'

// ── Types ──

export interface RawEmailMessage {
  messageId?: string
  id?: string
  uid?: string
  /** IMAP folder the message was listed under (for remote MOVE chaining). */
  folder?: string
  headers?: { messageId?: string; inReplyTo?: string; references?: string[] }
  from: { address: string; name?: string }
  to: Array<{ address: string; name?: string }>
  cc?: Array<{ address: string; name?: string }>
  subject: string
  text?: string
  html?: string
  date: string
  attachments?: Array<{
    id?: string
    filename: string
    contentType: string
    size: number
    contentId?: string
    content?: Buffer
  }>
  /**
   * B2 byte-courier (R2): the OPAQUE provider payload for the email-depackage
   * cutover — raw RFC822 (IMAP/Gmail `format=raw`) or provider-structured-json
   * (Outlook) shipped UNPARSED. Populated by the provider/sync layer ONLY when
   * `WRDESK_SEAM_DEPACKAGE_CUTOVER` is on; the orchestrator never inspects it.
   * When the flag is on and this is absent, ingestion fails closed (INV-7) — it
   * is never inline-parsed from `text`/`html`.
   */
  rawRfc822?: Buffer | string
  /**
   * B2.1 (D4) alternative opaque form: the provider's structured JSON shipped
   * UNPARSED, walked by the guest's provider-structured-json walker. Used where
   * faithful raw RFC822 is not obtainable (e.g. Outlook default). When present
   * AND the flag is on, the seam prefers this over `rawRfc822`. The orchestrator
   * never inspects it.
   */
  providerStructuredJson?: { readonly provider: string; readonly json: Buffer | string }
}

export interface DetectAndRouteResult {
  type: 'beap' | 'plain' | 'quarantine'
  messageId: string
  /** inbox_messages.id or quarantine_messages.id */
  inboxMessageId: string
}

// ── Detection helpers (same heuristics as pre-B-3) ──

function detectBeapCapsule(text: string): { detected: boolean; capsuleJson?: string } {
  if (!text || typeof text !== 'string') return { detected: false }
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return { detected: false }
  try {
    const parsed = JSON.parse(trimmed)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.schema_version === 'number' &&
      typeof parsed.capsule_type === 'string' &&
      ['initiate', 'accept', 'refresh', 'revoke'].includes(parsed.capsule_type)
    ) {
      return { detected: true, capsuleJson: trimmed }
    }
  } catch { /* not valid JSON */ }
  return { detected: false }
}

function detectBeapMessagePackage(text: string): { detected: boolean; packageJson?: string } {
  if (!text || typeof text !== 'string') return { detected: false }
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return { detected: false }
  try {
    const parsed = JSON.parse(trimmed)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'header' in parsed && parsed.header != null && typeof parsed.header === 'object' &&
      'metadata' in parsed && parsed.metadata != null && typeof parsed.metadata === 'object' &&
      ('envelope' in parsed || 'payload' in parsed)
    ) {
      const enc = parsed.header?.encoding
      if (enc != null && !['qBEAP', 'pBEAP'].includes(enc)) return { detected: false }
      return { detected: true, packageJson: trimmed }
    }
  } catch { /* not valid JSON */ }
  return { detected: false }
}

function detectBeapInJson(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false
  const p = parsed as Record<string, unknown>
  if (p.capsule_type && typeof p.schema_version === 'number') return true
  if (p.header && typeof p.header === 'object' && (p.envelope != null || p.payload != null)) return true
  return false
}

function isBeapAttachment(att: { filename: string; contentType?: string }): boolean {
  const fn = (att.filename || '').toLowerCase()
  const ct = (att.contentType || '').toLowerCase()
  if (fn.endsWith('.beap')) return true
  if (ct === 'application/vnd.beap+json' || ct === 'application/x-beap') return true
  return false
}

function isJsonAttachment(att: { filename: string; contentType?: string }): boolean {
  const fn = (att.filename || '').toLowerCase()
  const ct = (att.contentType || '').toLowerCase()
  if (fn.endsWith('.json')) return true
  if (ct === 'application/json') return true
  return false
}

function extractHandshakeId(parsed: Record<string, unknown>): string | null {
  const h = parsed.header as Record<string, unknown> | undefined
  if (h && typeof h.handshake_id === 'string') return h.handshake_id
  if (h && typeof h.receiver_binding === 'object') {
    const rb = h.receiver_binding as Record<string, unknown>
    if (typeof rb?.handshake_id === 'string') return rb.handshake_id
  }
  if (typeof parsed.handshake_id === 'string') return parsed.handshake_id
  return null
}

/**
 * Primary key for `inbox_attachments.id`. Provider attachment ids are only unique per remote
 * message; prefixing with our inbox row id avoids PRIMARY KEY collisions across local messages.
 */
export function makeInboxAttachmentStorageId(
  inboxMessageId: string,
  providerAttachmentId: string | undefined,
): string {
  const trimmed = typeof providerAttachmentId === 'string' ? providerAttachmentId.trim() : ''
  if (trimmed.length > 0) return `${inboxMessageId}__${trimmed}`
  return randomUUID()
}

// ── Email ID resolution ──

function resolveStorageEmailMessageId(accountId: string, rawMsg: RawEmailMessage): string {
  let provider: string | null = null
  try { provider = emailGateway.getProviderSync(accountId) } catch { provider = null }

  const pick = (s: string | undefined): string | undefined => {
    const t = typeof s === 'string' ? s.trim() : ''
    return t.length > 0 ? t : undefined
  }

  if (provider === 'imap') {
    return pick(rawMsg.uid) ?? pick(rawMsg.id) ?? pick(rawMsg.messageId) ?? randomUUID()
  }
  return pick(rawMsg.messageId) ?? pick(rawMsg.id) ?? pick(rawMsg.uid) ?? randomUUID()
}

// ── Provenance builder ──

function buildProvenance(
  fromAddr: string,
  messageId: string,
  bodyText: string,
  inputClassification: ProvenanceMetadata['input_classification'],
): ProvenanceMetadata {
  return {
    source_type: 'email',
    origin_classification: 'external',
    ingested_at: new Date().toISOString(),
    transport_metadata: { sender_address: fromAddr, message_id: messageId },
    input_classification: inputClassification,
    raw_input_hash: createHash('sha256').update(bodyText, 'utf8').digest('hex'),
    ingestor_version: '1.0.0',
  }
}

// ── Quarantine canonical JSON ──

/**
 * Canonical JSON for a quarantine_messages row seal.
 *
 * Only the immutable, security-relevant fields are included.  These are the
 * fields the read-path reconstructs to verify the seal on retrieval.
 * Mutable fields (cloned_to_sandbox_at) are excluded.
 */
export function buildQuarantineCanonicalJson(fields: {
  id: string
  blob_storage_id: string
  blob_sha256: string
  rejection_reason: string
  paired_sandbox_handshake_id: string
}): string {
  return JSON.stringify({
    content_type: 'host_quarantine',
    id: fields.id,
    blob_storage_id: fields.blob_storage_id,
    blob_sha256: fields.blob_sha256,
    rejection_reason: fields.rejection_reason,
    paired_sandbox_handshake_id: fields.paired_sandbox_handshake_id,
  })
}

// ── Sandbox handshake lookup ──

export function findPairedSandboxHandshake(
  db: any,
  session: SSOSession | null | undefined,
): { handshake_id: string; peer_x25519_public_key_b64: string } | null {
  if (!db || !session) return null
  const result = listAvailableInternalSandboxes(db, session)
  if (!result.success) return null
  const keyed = result.sandboxes.find((s) => s.sandbox_keying_complete)
  if (!keyed) return null
  const record = getHandshakeRecord(db, keyed.handshake_id)
  if (!record) return null
  if (!isEligibleActiveInternalHostSandboxRecord(record, session)) return null
  const pub = record.peer_x25519_public_key_b64?.trim()
  if (!pub) return null
  return { handshake_id: keyed.handshake_id, peer_x25519_public_key_b64: pub }
}

// ── Prepared SQL constants ──

const INBOX_INSERT_SQL = `
  INSERT INTO inbox_messages (
    id, source_type, handshake_id, account_id, email_message_id,
    from_address, from_name, to_addresses, cc_addresses,
    subject, body_text, body_html, beap_package_json,
    depackaged_json, depackaged_metadata, has_attachments, attachment_count, received_at, ingested_at,
    imap_remote_mailbox, imap_rfc_message_id,
    validated_at, validator_version, validation_reason,
    seal, seal_input_json,
    seal_key_source
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

const QUARANTINE_INSERT_SQL = `
  INSERT INTO quarantine_messages (
    id, transport_sender, transport_received_at, transport_folder,
    blob_size_bytes, blob_storage_id, blob_sha256, rejection_reason,
    paired_sandbox_handshake_id,
    seal, seal_input_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

// ── Main router ──

/**
 * Detect BEAP content and route to the correct sealed-storage ingestion path.
 *
 * Phase B invariant: no row is written to inbox_messages or quarantine_messages
 * until a valid cryptographic seal has been produced by the validator subprocess.
 *
 * @param session  Current SSO session used for sandbox lookup in quarantine path.
 *                 Pass null when session is unavailable.
 */
/**
 * Public entry. B2 flag (`WRDESK_SEAM_DEPACKAGE_CUTOVER`, default OFF):
 *   - OFF → the original inline path runs unchanged (byte-identical behavior).
 *   - ON  → the opaque payload is depackaged inside the isolated guest via
 *           `dispatch({kind:'depackage-email'})` and this becomes a consumer of
 *           the typed result; the orchestrator never parses the raw bytes. Any
 *           failure to establish the safety contract fails closed / quarantines
 *           (INV-7) — there is no inline fallback while the flag is on.
 */
export async function detectAndRouteMessage(
  db: any,
  accountId: string,
  rawMsg: RawEmailMessage,
  session?: SSOSession | null,
): Promise<DetectAndRouteResult> {
  if (isSeamDepackageCutoverEnabled()) {
    return routeViaDepackageSeam(db, accountId, rawMsg, session ?? null)
  }
  return detectAndRouteMessageInline(db, accountId, rawMsg, session)
}

/**
 * The original (pre-B2) inline router. UNCHANGED — it remains the verbatim
 * flag-off path AND the proven pipeline-2 path that the B2 seam consumer re-enters
 * for an extracted carrier package (passing the package JSON as `text`).
 */
export async function detectAndRouteMessageInline(
  db: any,
  accountId: string,
  rawMsg: RawEmailMessage,
  session?: SSOSession | null,
  viaSeam = false,
): Promise<DetectAndRouteResult> {
  // D5.2 invariant-0 guard: inline raw-byte carrier detection here is forbidden
  // while the cutover is ON — the guest does the parsing. The ONLY legitimate
  // flag-on entry is the seam re-entering with a guest-EXTRACTED package (already
  // vetted, not raw untrusted bytes), signalled by `viaSeam`. Any other flag-on
  // entry is a missed-cutover regression → fail closed (E_INLINE_PARSE_FORBIDDEN).
  if (!viaSeam) assertNoInlineParse('messageRouter.detectAndRouteMessageInline')

  const messageId = resolveStorageEmailMessageId(accountId, rawMsg)
  const inboxMessageId = randomUUID()
  const now = new Date().toISOString()
  const receivedAt = rawMsg.date || now

  const fromAddr = rawMsg.from?.address ?? (rawMsg.from as any)?.email ?? ''
  const fromName = rawMsg.from?.name ?? null
  const toList = rawMsg.to ?? []
  const ccList = rawMsg.cc ?? []
  const toAddrs = toList.map((r) => r.address ?? (r as any).email ?? '')
  const ccAddrs = ccList.map((r) => r.address ?? (r as any).email ?? '')
  const bodyText = rawMsg.text ?? ''
  const bodyHtml = rawMsg.html ?? null
  const subject = rawMsg.subject ?? ''
  const attachments = rawMsg.attachments ?? []
  const folderRaw =
    rawMsg.folder != null && String(rawMsg.folder).trim() !== '' ? String(rawMsg.folder).trim() : 'INBOX'
  const imapRemoteMailbox = folderRaw || 'INBOX'
  const imapRfcMessageId = rawMsg.headers?.messageId?.trim() || null
  const hasAttachments = attachments.length > 0

  // ── Step 1: Detect BEAP vs plain (sync) ──────────────────────────────────

  let beapPackageJson: string | null = null
  let handshakeId: string | null = null
  let detectedType: 'beap' | 'plain' = 'plain'

  for (const att of attachments) {
    if (!isBeapAttachment(att)) continue
    const content = att.content
    if (!content || content.length === 0) continue
    const text = content.toString('utf-8')
    if (text.length > 65536) continue
    const capsule = detectBeapCapsule(text)
    if (capsule.detected && capsule.capsuleJson) {
      beapPackageJson = capsule.capsuleJson
      try { handshakeId = extractHandshakeId(JSON.parse(capsule.capsuleJson)) ?? '__email_import__' } catch { handshakeId = '__email_import__' }
      detectedType = 'beap'; break
    }
    const pkg = detectBeapMessagePackage(text)
    if (pkg.detected && pkg.packageJson) {
      beapPackageJson = pkg.packageJson
      try { handshakeId = extractHandshakeId(JSON.parse(pkg.packageJson)) ?? '__email_import__' } catch { handshakeId = '__email_import__' }
      detectedType = 'beap'; break
    }
  }

  if (detectedType === 'plain' && bodyText.trim().startsWith('{')) {
    const capsule = detectBeapCapsule(bodyText)
    if (capsule.detected && capsule.capsuleJson) {
      beapPackageJson = capsule.capsuleJson
      try { handshakeId = extractHandshakeId(JSON.parse(capsule.capsuleJson)) ?? '__email_import__' } catch { handshakeId = '__email_import__' }
      detectedType = 'beap'
    }
  }
  if (detectedType === 'plain' && bodyText.trim().startsWith('{')) {
    const pkg = detectBeapMessagePackage(bodyText)
    if (pkg.detected && pkg.packageJson) {
      beapPackageJson = pkg.packageJson
      try { handshakeId = extractHandshakeId(JSON.parse(pkg.packageJson)) ?? '__email_import__' } catch { handshakeId = '__email_import__' }
      detectedType = 'beap'
    }
  }
  if (detectedType === 'plain') {
    for (const att of attachments) {
      if (!isJsonAttachment(att)) continue
      const content = att.content
      if (!content || content.length === 0) continue
      const text = content.toString('utf-8')
      if (text.length > 65536) continue
      try {
        const parsed = JSON.parse(text)
        if (detectBeapInJson(parsed)) {
          beapPackageJson = text
          handshakeId = extractHandshakeId(parsed) ?? '__email_import__'
          detectedType = 'beap'; break
        }
      } catch { /* not valid JSON */ }
    }
  }

  // ── Step 2a: Attachment preprocessing (Att-2, PR B-3.1) ──────────────────
  //
  // Runs BEFORE the validator call so that attachment content_sha256 values
  // can be included in the canonical content that the seal binds.  The seal
  // therefore covers the attachment list, satisfying the Att-2 property:
  //   "any post-write tampering with an inbox_attachments row's content is
  //    detectable at read time via the parent message seal."
  //
  // Att-2 scope note: this preprocessing applies to plain_email rows only.
  // For email_beap rows, the canonical_json is the BEAP capsule plaintext
  // (a protocol-defined format).  Augmenting it would change the
  // depackaged_json format expected by existing consumers.  BEAP attachment
  // sealing requires a depackaged_json format migration deferred to B-5.

  type AttMeta = {
    attId: string
    storagePath: string | null
    encKey: string | null
    encIv: string | null
    encTag: string | null
    storageEncrypted: number
    contentSha256: string | null
    extractedText: string | null
    extractionStatus: string | null
    extractionError: string | null
    extractedTextSha256: string | null
    att: (typeof attachments)[number]
  }
  const attMetas: AttMeta[] = []

  // For plain emails we always need attachment metadata before calling the
  // validator.  For BEAP we still preprocess (attachment writes are in the
  // same transaction), but content_sha256s are not yet bound to the seal.
  for (const att of attachments) {
    const attId = makeInboxAttachmentStorageId(inboxMessageId, att.id)
    let storagePath: string | null = null
    let encKey: string | null = null
    let encIv: string | null = null
    let encTag: string | null = null
    let storageEncrypted = 0
    let contentSha256: string | null = null
    let extractedText: string | null = null
    let extractionStatus: string | null = null
    let extractionError: string | null = null
    let extractedTextSha256: string | null = null

    if (att.content && att.content.length > 0) {
      try {
        const w = writeEncryptedAttachmentFile(inboxMessageId, attId, att.filename, att.content)
        storagePath = w.storagePath; encKey = w.encryptionKeyStored
        encIv = w.ivB64; encTag = w.tagB64; storageEncrypted = 1
      } catch (e) {
        console.warn('[MessageRouter] Failed to store attachment:', att.filename, e)
      }
      contentSha256 = createHash('sha256').update(att.content).digest('hex')
    }

    if (isPdfFile(att.contentType || '', att.filename) && att.content && att.content.length > 0) {
      try {
        const result = await extractPdfText(att.content)
        extractedText = result.text ?? ''
        extractedTextSha256 = createHash('sha256').update(extractedText, 'utf8').digest('hex')
        const { status, error: errMsg } = resolveInboxPdfExtractionStatus(result)
        extractionStatus = status; extractionError = errMsg
      } catch (e: any) {
        extractionStatus = 'failed'; extractionError = e?.message ?? String(e) ?? 'Extraction crashed'
      }
    }

    attMetas.push({
      attId, storagePath, encKey, encIv, encTag, storageEncrypted,
      contentSha256, extractedText, extractionStatus, extractionError, extractedTextSha256, att,
    })
  }

  // Build the Att-2 attachment canonical array (used for plain_email sealing).
  const attachmentsCanonical: ChildAttachmentDescriptor[] = attMetas.map((m) => ({
    attachment_id: m.attId,
    filename: m.att.filename || 'attachment',
    content_type: m.att.contentType || 'application/octet-stream',
    size_bytes: m.att.size ?? 0,
    content_sha256: m.contentSha256,
    extracted_text_sha256: m.extractedTextSha256 ?? null,
  }))

  // ── Step 2b: Async pre-work — depackage + validate (no DB writes yet) ──────

  // Sealed payload for inbox write
  type InboxPayload = {
    kind: 'inbox'
    sourceType: 'email_beap' | 'email_plain'
    depackagedJson: string
    /** Wrapper metadata (e.g. the explicit pBEAP trust verdict). Outside the seal. */
    depackagedMetadata?: string | null
    seal: string
    sealInputJson: string
    sealKeySource: 'ledger'
    validatedAt: string
    validatorVersion: string
    validationReason: string | null
  }
  // Sealed payload for quarantine write
  type QuarantinePayload = {
    kind: 'quarantine'
    quarantineId: string
    blobStorageId: string
    blobSha256: string
    blobSizeBytes: number
    rejectionReason: string
    pairedSandboxHandshakeId: string
    seal: string
    sealInputJson: string
  }
  type WritePayload = InboxPayload | QuarantinePayload

  // Definite assignment: all code paths in the BEAP and plain branches
  // assign writePayload.  The `!` suppresses the TS definite-assignment check
  // which cannot trace through async branches.
  let writePayload!: WritePayload

  if (detectedType === 'beap' && beapPackageJson) {
    const packageObj = (() => {
      try { return JSON.parse(beapPackageJson) as Record<string, unknown> } catch { return null }
    })()
    const encoding = (packageObj?.header as Record<string, unknown> | null)?.encoding

    let canonicalJson: string | null = null
    let depackageError: string | null = null
    // pBEAP explicit trust verdict, persisted to depackaged_metadata on the inbox row.
    // Verdict-only payload (no `format` key) so format-based routing/eligibility readers
    // (depackagedFormatFromJson / depackagedFormatFromMessage) fall through to
    // depackaged_json exactly as before — persistence is additive, not a routing change.
    let pbeapTrustMetaJson: string | null = null

    // ── Inline depackage ──
    if (encoding === 'qBEAP') {
      try {
        const decrypted = await decryptQBeapPackage(beapPackageJson, handshakeId ?? '', db, {
          reportFailure: (info) => console.warn('[messageRouter] qBEAP decrypt failure', info),
        })
        if (decrypted?.rawCapsuleJson) {
          canonicalJson = decrypted.rawCapsuleJson
        } else {
          depackageError = 'qBEAP decrypt returned null (missing handshake key or malformed package)'
        }
      } catch (err: unknown) {
        depackageError = err instanceof Error ? err.message : String(err)
      }
    } else if (encoding === 'pBEAP') {
      try {
        const payloadB64 = (packageObj?.payload as string | undefined) ?? ''
        if (!payloadB64.trim()) {
          depackageError = 'pBEAP package has no payload field'
        } else {
          canonicalJson = Buffer.from(payloadB64, 'base64').toString('utf-8')
          // Build 2b: stop SILENTLY trusting pBEAP on the email path. Resolve an
          // explicit trust decision (today: unverified_public — Gate-5 signing
          // bytes not yet mirrored in main). Persisting it on this path needs a
          // metadata/seal-structure change (deferred); we record it explicitly
          // here so it is no longer a silent trust.
          const pbeapTrust = classifyLivePbeapTrust({ header: packageObj?.header })
          pbeapTrustMetaJson = JSON.stringify(pbeapTrustMetadata(pbeapTrust))
          if (pbeapTrust.level !== 'verified_bound') {
            console.warn('[messageRouter] pBEAP not authenticated', pbeapTrustMetadata(pbeapTrust).pbeap_trust)
          }
        }
      } catch (err: unknown) {
        depackageError = err instanceof Error ? err.message : String(err)
      }
    } else {
      // Handshake capsule or other known BEAP structure — JSON itself is canonical.
      canonicalJson = beapPackageJson
    }

    if (canonicalJson !== null) {
      // ── Validate decrypted BEAP content (native BEAP pipeline) ──
      // B1 cutover: behind WRDESK_SEAM_VALIDATION_CUTOVER this validation leg
      // routes through the critical-job dispatcher (in-process → same forked
      // validator subprocess, so parity is byte-identical). Flag OFF keeps the
      // original inline call verbatim. The qBEAP/pBEAP decrypt above is untouched.
      const provenance = buildProvenance(fromAddr, messageId, bodyText, 'beap_capsule_present')
      const validationInput = {
        envelope: packageObj ?? {},
        plaintext_or_encrypted: { kind: 'plaintext' as const, content: canonicalJson },
        provenance,
        target_row_id: inboxMessageId,
      }
      let resp: Awaited<ReturnType<typeof validatorOrchestrator.validate>> | null = null
      if (isSeamValidationCutoverEnabled()) {
        // Lazy import so flag-off never pulls the seam graph at module load.
        const { dispatchValidateDecryptedBeap } = await import('../critical-jobs/liveValidationCutover')
        const out = await dispatchValidateDecryptedBeap(validationInput)
        if (out.ok) {
          resp = out.value
        } else {
          // Dispatcher/executor failure → fail closed to the quarantine path
          // (never an unvalidated insert, never a silent drop).
          depackageError = `seam_validation_dispatch_failed:${out.code}`
          canonicalJson = null
        }
      } else {
        resp = await validatorOrchestrator.validate(validationInput)
      }

      if (resp && resp.outcome.ok) {
        const sealed = resp.outcome.sealed
        // Bind the pBEAP trust verdict tamper-evidently into the seal (when present),
        // so the persisted depackaged_metadata cannot be altered post-write undetected.
        const { seal, seal_input_json } = computeSeal(sealed.canonical_json, inboxMessageId, 'outer', pbeapTrustMetaJson)
        writePayload = {
          kind: 'inbox',
          sourceType: 'email_beap',
          depackagedJson: sealed.canonical_json,
          depackagedMetadata: pbeapTrustMetaJson,
          seal,
          sealInputJson: seal_input_json,
          sealKeySource: 'ledger',
          validatedAt: sealed.validated_at,
          validatorVersion: sealed.validator_version,
          validationReason: null,
        }
      } else if (resp) {
        depackageError = `validator rejected: ${resp.outcome.sealed_quarantine.rejection_reason}`
        canonicalJson = null
      }
      // resp === null means a seam dispatch failure already set depackageError +
      // canonicalJson = null above; fall through to the quarantine path.
    }

    if (canonicalJson === null) {
      // ── Quarantine path ──
      const rejectionReason = depackageError ?? 'depackage_failed'
      const sandboxHandshake = findPairedSandboxHandshake(db, session)

      if (!sandboxHandshake) {
        console.warn('[MessageRouter] No sandbox for quarantine; falling back to plain inbox row:', messageId)
        writePayload = await buildPlainEmailInboxPayload(
          inboxMessageId, messageId, accountId, rawMsg, fromAddr,
          fromName, subject, bodyText, bodyHtml, toList, ccList,
          receivedAt, attachmentsCanonical,
        )
      } else {
        const emailBytes = Buffer.from(beapPackageJson, 'utf-8')
        const encResult = encryptForQuarantine(emailBytes, sandboxHandshake.peer_x25519_public_key_b64)

        if (!encResult.ok) {
          console.error('[MessageRouter] encryptForQuarantine failed:', encResult.error)
          writePayload = await buildPlainEmailInboxPayload(
            inboxMessageId, messageId, accountId, rawMsg, fromAddr,
            fromName, subject, bodyText, bodyHtml, toList, ccList,
            receivedAt, attachmentsCanonical,
          )
        } else {
          const blobResult = writeQuarantineBlob(encResult.blob)
          const quarantineId = randomUUID()
          const qCanonicalJson = buildQuarantineCanonicalJson({
            id: quarantineId,
            blob_storage_id: blobResult.storage_id,
            blob_sha256: blobResult.blob_sha256,
            rejection_reason: rejectionReason,
            paired_sandbox_handshake_id: sandboxHandshake.handshake_id,
          })

          const qProvenance = buildProvenance(fromAddr, messageId, bodyText, 'beap_capsule_present')
          const qResp = await validatorOrchestrator.validate({
            envelope: {},
            plaintext_or_encrypted: { kind: 'plaintext', content: qCanonicalJson },
            provenance: qProvenance,
            target_row_id: quarantineId,
          })

          if (!qResp.outcome.ok) {
            // Structural bug: host_quarantine content should always pass.
            console.error('[MessageRouter] quarantine validator rejected (bug):', qResp.outcome.sealed_quarantine.rejection_reason)
            writePayload = await buildPlainEmailInboxPayload(
              inboxMessageId, messageId, accountId, rawMsg, fromAddr,
              fromName, subject, bodyText, bodyHtml, toList, ccList,
              receivedAt, attachmentsCanonical,
            )
          } else {
            const qSealed = qResp.outcome.sealed
            writePayload = {
              kind: 'quarantine',
              quarantineId,
              blobStorageId: blobResult.storage_id,
              blobSha256: blobResult.blob_sha256,
              blobSizeBytes: blobResult.blob_size_bytes,
              rejectionReason,
              pairedSandboxHandshakeId: sandboxHandshake.handshake_id,
              seal: qSealed.seal,
              sealInputJson: qSealed.seal_input_json,
            }
          }
        }
      }
    }
  } else {
    // ── Plain email path (attachmentsCanonical already built in Step 2a) ──
    writePayload = await buildPlainEmailInboxPayload(
      inboxMessageId, messageId, accountId, rawMsg, fromAddr,
      fromName, subject, bodyText, bodyHtml, toList, ccList,
      receivedAt, attachmentsCanonical,
    )
  }

  // ── Step 4: Atomic sealed DB write ───────────────────────────────────────

  if (writePayload.kind === 'quarantine') {
    const qCanonJson = buildQuarantineCanonicalJson({
      id: writePayload.quarantineId,
      blob_storage_id: writePayload.blobStorageId,
      blob_sha256: writePayload.blobSha256,
      rejection_reason: writePayload.rejectionReason,
      paired_sandbox_handshake_id: writePayload.pairedSandboxHandshakeId,
    })

    const sealedQ = prepareSealedInsert(db, QUARANTINE_INSERT_SQL)
    sealedQ.run(
      [
        writePayload.quarantineId,
        fromAddr,
        receivedAt,
        imapRemoteMailbox,
        writePayload.blobSizeBytes,
        writePayload.blobStorageId,
        writePayload.blobSha256,
        writePayload.rejectionReason,
        writePayload.pairedSandboxHandshakeId,
        writePayload.seal,
        writePayload.sealInputJson,
      ],
      {
        seal: writePayload.seal,
        seal_input_json: writePayload.sealInputJson,
        canonical_json: qCanonJson,
        row_id: writePayload.quarantineId,
      },
    )

    return { type: 'quarantine', messageId, inboxMessageId: writePayload.quarantineId }
  }

  // ── Step 3: Atomic sealed DB write (Att-2, PR B-3.1) ─────────────────────
  //
  // The inbox_messages row is written via SealedStatement (gate enforces seal
  // verification before write).  inbox_attachments rows are written as raw
  // child writes inside the SAME db.transaction(), per Option Att-2.
  //
  // Att-2 security guarantee: for plain_email rows, the canonical_json passed
  // to the validator (and therefore covered by the seal) includes
  // attachments_canonical with each attachment's content_sha256.  Any
  // post-write tampering with inbox_attachments.content_sha256 is detectable
  // at read time because the parent seal would no longer verify against the
  // original canonical_json.
  //
  // For email_beap rows, the canonical_json is the raw BEAP capsule JSON
  // (protocol-defined format).  Attachment SHA-256s are NOT yet in the seal.
  // Full BEAP attachment sealing requires a depackaged_json format migration
  // deferred to B-5.
  const sealedInbox = prepareSealedInsert(db, INBOX_INSERT_SQL)

  const insertAtt = db.prepare(`
    INSERT INTO inbox_attachments (id, message_id, filename, content_type, size_bytes, content_id, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updateContentSha = db.prepare(`UPDATE inbox_attachments SET content_sha256 = ? WHERE id = ?`)
  const updatePdfOk = db.prepare(`
    UPDATE inbox_attachments
    SET extracted_text = ?, text_extraction_status = ?, text_extraction_error = ?,
        extracted_text_sha256 = ?, page_count = ?
    WHERE id = ?
  `)
  const updatePdfFail = db.prepare(`
    UPDATE inbox_attachments SET text_extraction_status = 'failed', text_extraction_error = ? WHERE id = ?
  `)
  const updateAttEnc = db.prepare(`
    UPDATE inbox_attachments
    SET encryption_key = ?, encryption_iv = ?, encryption_tag = ?, storage_encrypted = ?
    WHERE id = ?
  `)

  const parentBindArgs = [
    inboxMessageId,
    writePayload.sourceType,
    handshakeId,
    accountId,
    messageId,
    fromAddr,
    fromName,
    JSON.stringify(toAddrs),
    JSON.stringify(ccAddrs),
    subject,
    bodyText,
    bodyHtml,
    beapPackageJson,
    writePayload.depackagedJson,
    writePayload.kind === 'inbox' ? (writePayload.depackagedMetadata ?? null) : null,
    hasAttachments ? 1 : 0,
    attachments.length,
    receivedAt,
    now,
    imapRemoteMailbox,
    imapRfcMessageId,
    writePayload.validatedAt,
    writePayload.validatorVersion,
    writePayload.validationReason,
    writePayload.seal,
    writePayload.sealInputJson,
    writePayload.sealKeySource ?? 'ledger',
  ]

  const childWrites = attMetas.map((m) => () => {
    insertAtt.run(
      m.attId, inboxMessageId,
      m.att.filename || 'attachment', m.att.contentType || 'application/octet-stream',
      m.att.size ?? 0, m.att.contentId ?? null, m.storagePath, now,
    )
    if (m.storageEncrypted && m.encKey && m.encIv && m.encTag) {
      updateAttEnc.run(m.encKey, m.encIv, m.encTag, m.storageEncrypted, m.attId)
    }
    if (m.contentSha256) updateContentSha.run(m.contentSha256, m.attId)
    if (m.extractionStatus === 'failed') {
      updatePdfFail.run(m.extractionError, m.attId)
    } else if (m.extractionStatus) {
      updatePdfOk.run(m.extractedText, m.extractionStatus, m.extractionError, m.extractedTextSha256, null, m.attId)
    }
  })

  runSealedTransaction(
    db,
    sealedInbox,
    parentBindArgs,
    {
      seal: writePayload.seal,
      seal_input_json: writePayload.sealInputJson,
      canonical_json: writePayload.depackagedJson,
      row_id: inboxMessageId,
    },
    childWrites,
    'outer',
  )

  return {
    type: writePayload.sourceType === 'email_beap' ? 'beap' : 'plain',
    messageId,
    inboxMessageId,
  }
}

// ── B2 email-depackage cutover consumer (flag-gated) ─────────────────────────

/**
 * Raised when the safety contract cannot be established and the message must be
 * HELD (not inserted, not inline-parsed) for a later retry — INV-7. The sync
 * caller treats this as "skip this message this round", never as a downgrade.
 */
export class DepackageCutoverHeldError extends Error {
  constructor(public readonly reason: string) {
    super(`depackage cutover held: ${reason}`)
    this.name = 'DepackageCutoverHeldError'
  }
}

/** Quarantine mapping table (0007 §5.3 / 0008 §4): code → typed reason string. */
function mapDepackageCodeToReason(code: string): string {
  switch (code) {
    case 'E_MALFORMED_MIME': return 'email_depackage_malformed'
    case 'E_LIMITS_EXCEEDED': return 'email_depackage_limits'
    case 'E_DECOMPRESSION_BOMB': return 'email_depackage_bomb'
    case 'E_AMBIGUOUS_CLASSIFICATION': return 'email_depackage_ambiguous'
    case 'E_AMBIGUOUS_STRUCTURE': return 'email_depackage_ambiguous_structure'
    case 'E_ARTIFACT_CUSTODY_FAILED': return 'email_depackage_custody'
    case 'E_INLINE_PARSE_FORBIDDEN': return 'email_depackage_inline_parse_forbidden'
    case 'E_SIGNATURE_INVALID': return 'email_depackage_sig'
    case 'E_NO_EXECUTOR':
    case 'E_EXECUTOR_UNAVAILABLE': return 'email_depackage_no_executor'
    case 'E_ROLE_FORBIDDEN': return 'email_depackage_role_forbidden'
    case 'E_TIMEOUT': return 'email_depackage_timeout'
    case 'E_UNSUPPORTED_KIND': return 'email_depackage_unsupported'
    default: return `email_depackage_other:${code}`
  }
}

function toOpaqueBuffer(v: Buffer | string | undefined): Buffer | null {
  if (v == null) return null
  if (Buffer.isBuffer(v)) return v.length > 0 ? v : null
  if (typeof v === 'string' && v.length > 0) return Buffer.from(v, 'utf-8')
  return null
}

/**
 * Flag-ON entry. INV-7 throughout: the orchestrator hands ONLY opaque bytes to
 * the isolated guest and consumes the typed union; any safety-contract failure
 * quarantines (raw bytes custody-sealed, typed reason) or fails closed (held).
 * There is no inline parse, no partial-trust display, no silent downgrade.
 */
async function routeViaDepackageSeam(
  db: any,
  accountId: string,
  rawMsg: RawEmailMessage,
  session: SSOSession | null,
): Promise<DetectAndRouteResult> {
  const messageId = resolveStorageEmailMessageId(accountId, rawMsg)

  // INV-7: no opaque payload obtainable ⇒ HELD (never parse text/html inline).
  // Prefer the provider-structured-json form when present (D4), else raw RFC822.
  let opaque: Buffer | null = null
  let form: { inputForm?: 'rfc822' | 'provider-structured-json'; provider?: string } = {}
  if (rawMsg.providerStructuredJson) {
    opaque = toOpaqueBuffer(rawMsg.providerStructuredJson.json)
    form = { inputForm: 'provider-structured-json', provider: rawMsg.providerStructuredJson.provider }
  } else {
    opaque = toOpaqueBuffer(rawMsg.rawRfc822)
    form = { inputForm: 'rfc822' }
  }
  if (!opaque) {
    throw new DepackageCutoverHeldError('opaque_payload_unobtainable')
  }
  // Custody key required both to depackage (seal artifacts) AND to quarantine.
  // Without it we cannot fail closed safely ⇒ HELD for retry (never downgrade).
  const sandbox = findPairedSandboxHandshake(db, session)
  if (!sandbox) {
    throw new DepackageCutoverHeldError('no_paired_sandbox')
  }

  const { dispatchDepackageEmail } = await import('../critical-jobs/liveDepackageCutover')
  const out = await dispatchDepackageEmail(opaque, sandbox.peer_x25519_public_key_b64, undefined, form)

  // INV-5 logging: identifiers/codes only, never plaintext/bytes.
  if (!out.ok) {
    console.warn('[messageRouter] depackage-email dispatch failed', { messageId, code: out.code })
    return quarantineRawBytes(db, opaque, sandbox, messageId, rawMsg, mapDepackageCodeToReason(out.code))
  }
  const result = out.result
  if (!result.ok) {
    console.warn('[messageRouter] depackage-email worker failure', { messageId, code: result.code })
    return quarantineRawBytes(db, opaque, sandbox, messageId, rawMsg, mapDepackageCodeToReason(result.code))
  }

  if (result.type === 'beap-carrier' || result.type === 'mixed') {
    // Carrier: hand the FIRST extracted package (parity — the inline classifier
    // also stops at the first) to the proven pipeline-2 path by re-entering the
    // inline router with the package JSON as the body. The orchestrator does not
    // parse it as MIME; it is the guest-extracted opaque package.
    const pkg = result.packages[0]
    const pkgJson = Buffer.from(pkg.bytesB64, 'base64').toString('utf-8')
    console.warn('[messageRouter] depackage-email carrier', { messageId, type: result.type, packages: result.packages.length })
    // B2.2: inject the guest-derived display envelope so the re-entered pipeline-2
    // path has from/to/subject/date WITHOUT the orchestrator parsing headers.
    const env = result.displayEnvelope
    const th = result.threadingHints
    const beapRawMsg: RawEmailMessage = {
      ...rawMsg,
      subject: env.subject,
      from: env.from ? { address: env.from.email, name: env.from.name } : rawMsg.from,
      to: env.to.map((a) => ({ address: a.email, name: a.name })),
      cc: env.cc.map((a) => ({ address: a.email, name: a.name })),
      date: rawMsg.date || env.date,
      // Guest-derived threading key (no orchestrator header parse).
      headers: th?.messageId ? { ...rawMsg.headers, messageId: th.messageId } : rawMsg.headers,
      text: pkgJson,
      html: undefined,
      attachments: [],
      rawRfc822: undefined,
    }
    return detectAndRouteMessageInline(db, accountId, beapRawMsg, session, true)
  }

  // Plain mail: consumer-wrap the guest SafeText, preserve sealed originals.
  console.warn('[messageRouter] depackage-email plain', { messageId, artifacts: result.artifacts.length })
  return writePlainSeamInbox(db, accountId, rawMsg, messageId, result.safeText, result.artifacts, result.displayEnvelope, result.threadingHints)
}

/**
 * Custody-seal the RAW opaque bytes and write a quarantine_messages row. Reuses
 * the exact B1 quarantine discipline (encryptForQuarantine → blob → canonical →
 * validator seal → sealed insert). The sandbox key is the caller-resolved pair.
 */
async function quarantineRawBytes(
  db: any,
  opaque: Buffer,
  sandbox: { handshake_id: string; peer_x25519_public_key_b64: string },
  messageId: string,
  rawMsg: RawEmailMessage,
  rejectionReason: string,
): Promise<DetectAndRouteResult> {
  const fromAddr = rawMsg.from?.address ?? (rawMsg.from as any)?.email ?? ''
  const receivedAt = rawMsg.date || new Date().toISOString()
  const folder = rawMsg.folder != null && String(rawMsg.folder).trim() !== '' ? String(rawMsg.folder).trim() : 'INBOX'

  const encResult = encryptForQuarantine(opaque, sandbox.peer_x25519_public_key_b64)
  if (!encResult.ok) {
    // Cannot seal ⇒ cannot insert anything safely ⇒ HELD (INV-7; never inline).
    throw new DepackageCutoverHeldError(`quarantine_seal_failed:${encResult.error}`)
  }
  const blobResult = writeQuarantineBlob(encResult.blob)
  const quarantineId = randomUUID()
  const qCanonicalJson = buildQuarantineCanonicalJson({
    id: quarantineId,
    blob_storage_id: blobResult.storage_id,
    blob_sha256: blobResult.blob_sha256,
    rejection_reason: rejectionReason,
    paired_sandbox_handshake_id: sandbox.handshake_id,
  })
  const qProvenance = buildProvenance(fromAddr, messageId, '', 'beap_capsule_present')
  const qResp = await validatorOrchestrator.validate({
    envelope: {},
    plaintext_or_encrypted: { kind: 'plaintext', content: qCanonicalJson },
    provenance: qProvenance,
    target_row_id: quarantineId,
  })
  if (!qResp.outcome.ok) {
    // host_quarantine content should always pass; a reject is a structural bug.
    throw new DepackageCutoverHeldError(`quarantine_validator_rejected:${qResp.outcome.sealed_quarantine.rejection_reason}`)
  }
  const qSealed = qResp.outcome.sealed
  const sealedQ = prepareSealedInsert(db, QUARANTINE_INSERT_SQL)
  sealedQ.run(
    [
      quarantineId, fromAddr, receivedAt, folder,
      blobResult.blob_size_bytes, blobResult.storage_id, blobResult.blob_sha256,
      rejectionReason, sandbox.handshake_id, qSealed.seal, qSealed.seal_input_json,
    ],
    { seal: qSealed.seal, seal_input_json: qSealed.seal_input_json, canonical_json: qCanonicalJson, row_id: quarantineId },
  )
  return { type: 'quarantine', messageId, inboxMessageId: quarantineId }
}

/**
 * Write a plain inbox row from the guest SafeText (R1 consumer-wrap). Original
 * artifacts (HTML, attachments) arrive already custody-sealed from the guest;
 * they are PRESERVED as blobs and referenced in the consumer-wrapped
 * depackaged_json (input to the future `view-attachment` job — out of scope to
 * render here). No plaintext attachment rows are written: under the cutover the
 * orchestrator never holds attachment plaintext.
 */
async function writePlainSeamInbox(
  db: any,
  accountId: string,
  rawMsg: RawEmailMessage,
  messageId: string,
  safeText: { subject: string; body_text: string; attachment_refs: readonly string[] },
  artifacts: ReadonlyArray<{ blob_id: string; content_type: string; filename?: string; blob: import('../quarantine-blob-storage/index').QuarantineBlobFile }>,
  envelope: import('../depackaging-microvm/emailDepackage').DisplayEnvelope,
  threadingHints?: import('../depackaging-microvm/emailDepackage').ThreadingHints,
): Promise<DetectAndRouteResult> {
  const inboxMessageId = randomUUID()
  const now = new Date().toISOString()
  // Bookkeeping date is provider-native (IMAP INTERNALDATE / Gmail internalDate /
  // Graph receivedDateTime); fall back to the guest-decoded Date header.
  const receivedAt = rawMsg.date || envelope.date || now
  // B2.2: from/to/cc/subject come from the GUEST-derived display envelope — the
  // orchestrator parsed no headers. (subject == safeText.subject == envelope.subject.)
  const fromAddr = envelope.from?.email ?? ''
  const fromName = envelope.from?.name ?? null
  const toList = envelope.to.map((a) => ({ address: a.email, name: a.name }))
  const ccList = envelope.cc.map((a) => ({ address: a.email, name: a.name }))
  const toAddrs = toList.map((r) => r.address)
  const ccAddrs = ccList.map((r) => r.address)
  const folder = rawMsg.folder != null && String(rawMsg.folder).trim() !== '' ? String(rawMsg.folder).trim() : 'INBOX'
  // Thread/dedupe key: IMAP has no provider-native thread id, so flag-on it keys
  // on the GUEST-derived Message-ID (no orchestrator header parse). `rawMsg.headers`
  // is empty flag-on; the guest result supplies `threadingHints.messageId`.
  const imapRfcMessageId = threadingHints?.messageId?.trim() || rawMsg.headers?.messageId?.trim() || null

  // Preserve sealed originals; build the canonical attachment refs (no plaintext
  // child rows — these blobs are sealed to the sandbox, openable only via the
  // future view-attachment job).
  const attachmentsCanonical: ChildAttachmentDescriptor[] = artifacts.map((a) => {
    const w = writeQuarantineBlob(a.blob)
    return {
      attachment_id: w.storage_id,
      filename: a.filename || 'sealed-artifact',
      content_type: a.content_type || 'application/octet-stream',
      size_bytes: w.blob_size_bytes,
      content_sha256: w.blob_sha256,
      extracted_text_sha256: null,
    }
  })

  const payload = await buildPlainEmailInboxPayload(
    inboxMessageId, messageId, accountId, rawMsg, fromAddr, fromName,
    safeText.subject, safeText.body_text, null, toList, ccList, receivedAt,
    attachmentsCanonical,
  )

  const sealedInbox = prepareSealedInsert(db, INBOX_INSERT_SQL)
  const parentBindArgs = [
    inboxMessageId, payload.sourceType, null, accountId, messageId,
    fromAddr, fromName, JSON.stringify(toAddrs), JSON.stringify(ccAddrs),
    safeText.subject, safeText.body_text, null, null,
    payload.depackagedJson, null, attachmentsCanonical.length > 0 ? 1 : 0, attachmentsCanonical.length,
    receivedAt, now, folder, imapRfcMessageId,
    payload.validatedAt, payload.validatorVersion, payload.validationReason,
    payload.seal, payload.sealInputJson, 'ledger',
  ]
  runSealedTransaction(
    db, sealedInbox, parentBindArgs,
    { seal: payload.seal, seal_input_json: payload.sealInputJson, canonical_json: payload.depackagedJson, row_id: inboxMessageId },
    [],
    'outer',
  )
  return { type: 'plain', messageId, inboxMessageId }
}

// ── Plain email inbox payload builder ────────────────────────────────────────

async function buildPlainEmailInboxPayload(
  inboxMessageId: string,
  messageId: string,
  accountId: string,
  rawMsg: RawEmailMessage,
  fromAddr: string,
  fromName: string | null,
  subject: string,
  bodyText: string,
  bodyHtml: string | null,
  toList: Array<{ address: string; name?: string }>,
  ccList: Array<{ address: string; name?: string }>,
  receivedAt: string,
  attachmentsCanonical: ChildAttachmentDescriptor[],
): Promise<{
  kind: 'inbox'
  sourceType: 'email_plain'
  depackagedJson: string
  seal: string
  sealInputJson: string
  validatedAt: string
  validatorVersion: string
  validationReason: 'plain_email_no_validation_required'
}> {
  const attachments = rawMsg.attachments ?? []
  const sanitized: SanitizedMessageDetail = {
    id: messageId,
    accountId,
    subject,
    from: { email: fromAddr, name: fromName ?? undefined },
    to: toList.map((r) => ({ email: r.address ?? (r as any).email ?? '', name: r.name })),
    cc: ccList.length ? ccList.map((r) => ({ email: r.address ?? (r as any).email ?? '', name: r.name })) : undefined,
    date: receivedAt,
    timestamp: new Date(receivedAt).getTime(),
    snippet: bodyText.slice(0, 100),
    flags: { seen: false, flagged: false, answered: false, draft: false, deleted: false, labels: [] },
    folder: 'INBOX',
    hasAttachments: (attachments?.length ?? 0) > 0,
    attachmentCount: attachments?.length ?? 0,
    bodyText,
    bodySafeHtml: bodyHtml ?? undefined,
  }
  const plainMsg = plainEmailToBeapMessage(sanitized, accountId)
  const enriched = enrichWithAttachments(plainMsg, attachmentsCanonical.map((a) => ({
    id: a.attachment_id,
    filename: a.filename,
    mimeType: a.content_type,
    size: a.size_bytes,
  })))
  // Att-2 (PR B-3.1): include attachments_canonical so the seal covers each
  // attachment's content_sha256.  Validator verifies the array structure.
  const canonicalObj = {
    content_type: 'plain_email' as const,
    transport_sender: fromAddr,
    transport_received_at: receivedAt,
    ...enriched,
    ...(attachmentsCanonical.length > 0 ? { attachments_canonical: attachmentsCanonical } : {}),
  }
  const canonicalJson = JSON.stringify(canonicalObj)
  const nowIso = new Date().toISOString()
  const { seal, seal_input_json } = computeSeal(canonicalJson, inboxMessageId, 'outer')

  return {
    kind: 'inbox',
    sourceType: 'email_plain',
    depackagedJson: canonicalJson,
    seal,
    sealInputJson: seal_input_json,
    sealKeySource: 'ledger',
    validatedAt: nowIso,
    validatorVersion: 'outer-ledger-v1',
    validationReason: 'plain_email_no_validation_required',
  }
}
