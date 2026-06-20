/**
 * Sandbox→host email delivery — wire type + sender + host-side handler.
 *
 * After the sandbox depackages a message locally it needs to deliver the
 * GUEST-DERIVED safe content to the HOST inbox WITHOUT the host ever touching
 * raw attacker-controlled bytes. This module implements that push.
 *
 * Wire shape: `sandbox_email_delivery` (separate from the `critical_job_*`
 * family — that family is workstation→sandbox; this is sandbox→host).
 *
 * Protocol:
 *   1. Sandbox POSTs `sandbox_email_delivery` to the host's `/beap/ingest`.
 *      Bearer token = this device's `local_p2p_auth_token` (see
 *      `outboundP2pBearerToCounterpartyIngest` — same auth as Host AI direct HTTP).
 *   2. Host verifies the handshake record, calls `detectAndRouteMessageInline`
 *      with `viaSeam=true` (guest-derived content, not raw bytes), returns
 *      `{ accepted: true, inbox_row_id }`.
 *
 * INV-1: the host writes the inbox row from the guest-derived envelope ONLY.
 * It reads no raw bytes from the wire payload. The `display_envelope` and
 * `safe_text` fields are the outputs of the microVM guest worker.
 *
 * INV-5: delivery IDs and row IDs are logged; no message content.
 */

import type * as http from 'http'
import type { DepackageEmailJobResult } from '../../depackaging-microvm/hypervisorProvider'
import type { DepackageEmailResult } from '../../depackaging-microvm/emailDepackage'
import type { SandboxFetchedMessage } from '../../email/sandboxIngestion'
import type { SandboxDeliveryResult } from '../../email/sandboxIngestion'

// ─── Wire types ───────────────────────────────────────────────────────────────

export const SANDBOX_EMAIL_DELIVERY_TYPE = 'sandbox_email_delivery' as const
export const SANDBOX_EMAIL_DELIVERY_SCHEMA_VERSION = 1

export interface SandboxEmailDeliveryWire {
  type: typeof SANDBOX_EMAIL_DELIVERY_TYPE
  schema_version: number
  delivery_id: string
  handshake_id: string
  /** Provider-assigned message ID (for idempotency / dedup on the host side). */
  source_message_id: string
  /** ISO-8601 receivedAt from the provider (operational metadata, not content). */
  received_at?: string
  /** Provider folder name (not content). */
  folder?: string
  /** Guest-derived depackage result. Contains ONLY safe content produced by the guest. */
  depackaged_result: DepackageEmailResult
  /** Account ID the message belongs to (opaque routing key). */
  account_id: string
}

export function isSandboxEmailDeliveryShape(parsed: unknown): parsed is SandboxEmailDeliveryWire {
  if (!parsed || typeof parsed !== 'object') return false
  const p = parsed as Record<string, unknown>
  return (
    p.type === SANDBOX_EMAIL_DELIVERY_TYPE &&
    typeof p.schema_version === 'number' &&
    typeof p.delivery_id === 'string' &&
    typeof p.handshake_id === 'string' &&
    typeof p.source_message_id === 'string' &&
    typeof p.account_id === 'string' &&
    p.depackaged_result !== undefined
  )
}

// ─── Sender ───────────────────────────────────────────────────────────────────

export interface SandboxDeliveryTransport {
  (opts: { url: string; token: string; wire: SandboxEmailDeliveryWire }): Promise<{
    ok: boolean
    inboxRowId?: string
    error?: string
  }>
}

let deliveryIdCounter = 0
function nextDeliveryId(): string {
  return `sdel-${Date.now()}-${++deliveryIdCounter}`
}

/**
 * Post a guest-derived depackage result to the host's `/beap/ingest` endpoint.
 * Used as `deliverToHost` in `runSandboxIngestionPoll`.
 */
export async function postSandboxEmailDelivery(
  msg: SandboxFetchedMessage,
  result: DepackageEmailJobResult,
  opts: {
    accountId: string
    handshakeId: string
    hostEndpoint: string
    hostP2pToken: string
    transport?: SandboxDeliveryTransport
  },
): Promise<SandboxDeliveryResult> {
  const wire: SandboxEmailDeliveryWire = {
    type: SANDBOX_EMAIL_DELIVERY_TYPE,
    schema_version: SANDBOX_EMAIL_DELIVERY_SCHEMA_VERSION,
    delivery_id: nextDeliveryId(),
    handshake_id: opts.handshakeId,
    source_message_id: msg.id,
    received_at: msg.receivedAt,
    folder: msg.folder,
    depackaged_result: result.result,
    account_id: opts.accountId,
  }

  const transport = opts.transport ?? httpSandboxDeliveryTransport
  try {
    const res = await transport({ url: opts.hostEndpoint, token: opts.hostP2pToken, wire })
    if (res.ok) {
      return { delivered: true, inboxMessageId: res.inboxRowId }
    }
    console.warn(`[SandboxDelivery] host rejected delivery. delivery_id=${wire.delivery_id} err=${res.error ?? 'unknown'}`)
    return { delivered: false }
  } catch (err) {
    const msg2 = err instanceof Error ? err.message : String(err)
    console.warn(`[SandboxDelivery] transport error. delivery_id=${wire.delivery_id} err=${msg2}`)
    return { delivered: false }
  }
}

/** Default HTTP transport for sandbox→host delivery. */
export const httpSandboxDeliveryTransport: SandboxDeliveryTransport = async ({ url, token, wire }) => {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(wire),
  })
  if (!resp.ok) {
    return { ok: false, error: `HTTP ${resp.status}` }
  }
  let json: any
  try { json = await resp.json() } catch { return { ok: false, error: 'invalid JSON response' } }
  return { ok: true, inboxRowId: json?.inbox_row_id ?? undefined }
}

// ─── Host-side handler ────────────────────────────────────────────────────────

/** Seam into the host message-router: injectable for tests. */
export type SandboxDeliveryHostWriter = (
  db: unknown,
  accountId: string,
  depackaged: DepackageEmailResult,
  meta: { sourceMessageId: string; receivedAt?: string; folder?: string; handshakeId?: string },
) => Promise<{ inboxRowId: string | null }>

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

let hostWriterOverride: SandboxDeliveryHostWriter | null = null

/** Test seam: override the host writer. */
export function _setSandboxDeliveryHostWriterForTests(w: SandboxDeliveryHostWriter | null): void {
  hostWriterOverride = w
}

/**
 * Handle an inbound `sandbox_email_delivery` on the host's `/beap/ingest`.
 * Returns true once the response has been written.
 */
export async function tryHandleSandboxEmailDelivery(
  db: unknown,
  parsed: unknown,
  res: http.ServerResponse,
): Promise<boolean> {
  if (!isSandboxEmailDeliveryShape(parsed)) return false

  const msg = parsed
  const deliveryId = msg.delivery_id

  if (msg.schema_version !== SANDBOX_EMAIL_DELIVERY_SCHEMA_VERSION) {
    writeJson(res, 400, { error: 'unsupported_schema_version', delivery_id: deliveryId })
    return true
  }

  const result = msg.depackaged_result
  if (!result || !result.ok) {
    writeJson(res, 400, { error: 'depackaged_result_not_ok', delivery_id: deliveryId })
    return true
  }

  const writer = hostWriterOverride ?? defaultHostWriter
  let inboxRowId: string | null = null
  try {
    const r = await writer(db, msg.account_id, result, {
      sourceMessageId: msg.source_message_id,
      receivedAt: msg.received_at,
      folder: msg.folder,
      handshakeId: msg.handshake_id,
    })
    inboxRowId = r.inboxRowId
  } catch (err) {
    const e = err instanceof Error ? err.message : String(err)
    console.warn(`[SandboxDelivery] host writer error. delivery_id=${deliveryId} err=${e}`)
    writeJson(res, 500, { error: 'host_write_failed', delivery_id: deliveryId })
    return true
  }

  console.log(`[SandboxDelivery] accepted. delivery_id=${deliveryId} inbox_row_id=${inboxRowId ?? 'null'}`)
  writeJson(res, 200, { accepted: true, delivery_id: deliveryId, inbox_row_id: inboxRowId })
  return true
}

/**
 * Default host writer: converts the guest-derived `DepackageEmailResult`
 * to a host inbox row.
 *
 * - `plain`:        builds a `RawEmailMessage` and calls `detectAndRouteMessageInline`
 *                   with `viaSeam=true` (guest-derived content; host never parses raw bytes).
 * - `beap-carrier`/`mixed`: hands the first extracted BEAP package (opaque bytes
 *                   from the guest) to `processBeapPackageInline` — the same pipeline
 *                   used for native P2P BEAP ingestion. Produces a host inbox row with
 *                   `source_type='p2p_relay'`. Errors throw so the delivery is HELD
 *                   (retryable), never silently dropped.
 */
const defaultHostWriter: SandboxDeliveryHostWriter = async (db, accountId, result, meta) => {
  if (!result.ok) return { inboxRowId: null }
  const out = result

  if (out.type === 'plain') {
    const { detectAndRouteMessageInline } = await import('../../email/messageRouter')
    const env = out.displayEnvelope
    const rawMsg: any = {
      id: meta.sourceMessageId,
      messageId: meta.sourceMessageId,
      subject: out.safeText.subject ?? '',
      from: env.from ? { address: env.from.email, name: env.from.name } : { address: '' },
      to: (env.to ?? []).map((a: any) => ({ address: a.email, name: a.name })),
      cc: (env.cc ?? []).map((a: any) => ({ address: a.email, name: a.name })),
      text: out.safeText.body_text ?? '',
      html: null,
      date: meta.receivedAt ?? new Date().toISOString(),
      folder: meta.folder ?? 'INBOX',
      attachments: (out.safeText.attachment_refs ?? []).map((_ref: unknown, i: number) => ({
        filename: `attachment-${i + 1}`,
        contentType: 'application/octet-stream',
        size: 0,
      })),
      flags: { seen: false, flagged: false, answered: false, draft: false, deleted: false },
      labels: [],
      headers: {},
    }
    const r = await detectAndRouteMessageInline(db, accountId, rawMsg, null, true)
    return { inboxRowId: r.inboxMessageId ?? null }
  }

  if (out.type === 'beap-carrier' || out.type === 'mixed') {
    const { processBeapPackageInline } = await import('../../email/beapEmailIngestion')
    const pkg = out.packages[0]
    if (!pkg?.bytesB64) {
      const hid = meta.handshakeId ?? 'unknown'
      console.warn(`[SandboxDelivery] beap-carrier missing package bytes. handshake_id=${hid}`)
      throw new Error('beap_carrier_no_package_bytes')
    }
    const pkgJson = Buffer.from(pkg.bytesB64, 'base64').toString('utf-8')
    const handshakeId = meta.handshakeId ?? '__seam_carrier__'
    const r = await processBeapPackageInline(db as any, pkgJson, handshakeId, {
      sourceType: 'p2p_relay',
      receivedAt: meta.receivedAt,
    })
    if (r.outcome === 'inbox' || r.outcome === 'quarantine') {
      return { inboxRowId: r.rowId ?? null }
    }
    const failReason = r.error ?? 'beap_carrier_routing_failed'
    console.warn(
      `[SandboxDelivery] beap-carrier routing error. handshake_id=${handshakeId} outcome=${r.outcome} reason=${failReason}`,
    )
    throw new Error(`beap_carrier_routing_failed: ${failReason}`)
  }

  return { inboxRowId: null }
}
