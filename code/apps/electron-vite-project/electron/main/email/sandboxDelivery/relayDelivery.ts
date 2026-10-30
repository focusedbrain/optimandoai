/**
 * Sandbox → host delivery of depackaged mail over the coordination relay (decision D-38).
 *
 * Replaces the retired direct-LAN `/beap/ingest` POST (Schema v71). The sandbox seals the
 * guest-derived result in a sender-authenticated service-RPC envelope (schema_version 2)
 * to the paired host's device key; the relay stores and forwards ciphertext only.
 *
 * Delivery is at-least-once with a receipt:
 *   1. The sandbox seals + sends `sandbox_email_delivery` and records the message as `sent`.
 *   2. The host writes the inbox row (deduplicated per account + provider message id) and
 *      answers with a sealed `sandbox_email_delivery_ack` (`stored` | `duplicate` | `failed`).
 *   3. `stored`/`duplicate` mark the message `acked`: later polls skip it. `failed` and a
 *      missing receipt after RESEND_AFTER_MS make the next poll send it again.
 *
 * What travels: the guest-derived SafeText, display envelope, threading hints and (for
 * carriers) the extracted BEAP packages. The custody-sealed original artifacts stay on the
 * sandbox — only the sandbox can open them, so shipping them would add size, not value.
 *
 * INV-5: ids, counts and codes in logs; never message content.
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { getInstanceId } from '../../orchestrator/orchestratorModeStore'
import type { HandshakeRecord } from '../../handshake/types'
import type { DepackageEmailResult } from '../../depackaging-microvm/emailDepackage'
import {
  SANDBOX_EMAIL_DELIVERY_SCHEMA_VERSION,
  SANDBOX_EMAIL_DELIVERY_TYPE,
  type SandboxEmailDeliveryWire,
} from '../../critical-jobs/remote/sandboxEmailDelivery'
import {
  claimSealedServiceRpcMessage,
  openServiceRpcPayloadResolvingLocalKey,
  sealServiceRpcPayloadAuthenticatedResolvingLocalKey,
  type SealedServiceRpcEnvelope,
} from '../../serviceRpc/sealedServiceRpc'
import { assertSandboxMaySealServiceRpcInnerType } from '../../sandbox/sandboxOutboundPolicy'
import { deriveInternalHostAiPeerRoles } from '../../internalInference/policy'
import type { SandboxFetchedMessage, SandboxDeliveryResult } from '../sandboxIngestion'

export const SANDBOX_EMAIL_DELIVERY_ACK_TYPE = 'sandbox_email_delivery_ack' as const

/** Mail stays in the relay queue this long while the host is offline. */
export const DELIVERY_ENVELOPE_TTL_MS = 24 * 60 * 60 * 1000
/** A `sent` message without a receipt is sent again after this. */
export const RESEND_AFTER_MS = 30 * 60 * 1000
/**
 * Plaintext ceiling before sealing. Ciphertext is base64 (×4/3) inside a capsule that the
 * relay validator caps at 10 MB; 6 MB plaintext stays clear of it.
 */
export const MAX_DELIVERY_PLAINTEXT_BYTES = 6 * 1024 * 1024

export interface SandboxEmailDeliveryAckWire {
  type: typeof SANDBOX_EMAIL_DELIVERY_ACK_TYPE
  schema_version: 1
  delivery_id: string
  handshake_id: string
  /** Sandbox read-account id + provider message id: the ledger key. */
  account_id: string
  source_message_id: string
  status: 'stored' | 'duplicate' | 'failed'
  /** Short code for `failed` (no content). */
  reason?: string
}

// ── Delivery ledger (sandbox) ─────────────────────────────────────────────────

type LedgerState = 'sent' | 'acked'
interface LedgerEntry {
  deliveryId: string
  state: LedgerState
  at: number
}

const LEDGER_FILE = 'sandbox-delivery-ledger.json'
const LEDGER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

let ledgerPathOverride: string | null = null
let ledgerCache: Record<string, LedgerEntry> | null = null

/** Test-only: point the ledger at a temp file (null → reset to the userData default). */
export function __setSandboxDeliveryLedgerPathForTests(p: string | null): void {
  ledgerPathOverride = p
  ledgerCache = null
}

function ledgerPath(): string | null {
  if (ledgerPathOverride) return ledgerPathOverride
  try {
    return path.join(app.getPath('userData'), LEDGER_FILE)
  } catch {
    return null
  }
}

function loadLedger(): Record<string, LedgerEntry> {
  if (ledgerCache) return ledgerCache
  const p = ledgerPath()
  try {
    ledgerCache = p && fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, LedgerEntry>) : {}
  } catch {
    ledgerCache = {}
  }
  return ledgerCache
}

function saveLedger(now: number): void {
  const l = loadLedger()
  for (const [k, v] of Object.entries(l)) if (now - v.at > LEDGER_RETENTION_MS) delete l[k]
  const p = ledgerPath()
  if (!p) return
  try {
    fs.writeFileSync(p, JSON.stringify(l))
  } catch (err) {
    console.warn(`[SandboxDelivery] ledger write failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const ledgerKey = (readAccountId: string, sourceMessageId: string) => `${readAccountId}\u0000${sourceMessageId}`

/**
 * Should this poll skip the message? Yes once the host acknowledged it, and while a send
 * is in flight (relay store-and-forward) for less than RESEND_AFTER_MS.
 */
export function isAlreadyDeliveredToHost(readAccountId: string, sourceMessageId: string, now = Date.now()): boolean {
  const e = loadLedger()[ledgerKey(readAccountId, sourceMessageId)]
  if (!e) return false
  if (e.state === 'acked') return true
  return now - e.at < RESEND_AFTER_MS
}

function markLedger(readAccountId: string, sourceMessageId: string, entry: LedgerEntry): void {
  loadLedger()[ledgerKey(readAccountId, sourceMessageId)] = entry
  saveLedger(entry.at)
}

// ── Sender (sandbox) ──────────────────────────────────────────────────────────

/** Strip the custody-sealed originals: only the sandbox can open them. */
function forDelivery(result: DepackageEmailResult): DepackageEmailResult {
  if (!result.ok) return result
  return { ...result, artifacts: [] }
}

export interface SealedRelayDeliveryDeps {
  sealAuthenticated?: typeof sealServiceRpcPayloadAuthenticatedResolvingLocalKey
  sendSealedRelay?: (
    db: unknown,
    record: HandshakeRecord,
    envelope: SealedServiceRpcEnvelope,
  ) => Promise<{ ok: true } | { ok: false; code: string; message: string }>
  localDeviceId?: () => string
  now?: () => number
}

/**
 * Seal and send one depackaged message to the paired host. `delivered: true` means the
 * relay accepted the sealed envelope for the host (it holds it until the host is online);
 * the host's receipt later marks it acknowledged.
 */
export async function deliverDepackagedMailViaSealedRelay(
  args: {
    db: unknown
    record: HandshakeRecord
    readAccountId: string
    /** The host's account id from the poll trigger — the host maps the row to it. */
    triggerAccountId?: string
    /** Mailbox address of the read account — the host maps by address first. */
    accountEmail?: string
    msg: SandboxFetchedMessage
    result: DepackageEmailResult
  },
  deps: SealedRelayDeliveryDeps = {},
): Promise<SandboxDeliveryResult & { error?: string }> {
  const now = (deps.now ?? Date.now)()
  const { record, msg } = args
  if (!args.result.ok) return { delivered: false, error: 'depackage_not_ok' }

  const localDeviceId = (deps.localDeviceId ?? defaultLocalDeviceId)().trim()
  const roles = deriveInternalHostAiPeerRoles(record, localDeviceId)
  if (!roles.ok || roles.localRole !== 'sandbox' || roles.peerRole !== 'host') {
    return { delivered: false, error: 'not_sandbox_to_host' }
  }

  const gate = assertSandboxMaySealServiceRpcInnerType(SANDBOX_EMAIL_DELIVERY_TYPE)
  if (!gate.ok) return { delivered: false, error: gate.code }

  const wire: SandboxEmailDeliveryWire & { trigger_account_id?: string; account_email?: string } = {
    type: SANDBOX_EMAIL_DELIVERY_TYPE,
    schema_version: SANDBOX_EMAIL_DELIVERY_SCHEMA_VERSION,
    delivery_id: randomUUID(),
    handshake_id: record.handshake_id,
    source_message_id: msg.id,
    ...(msg.receivedAt ? { received_at: msg.receivedAt } : {}),
    ...(msg.folder ? { folder: msg.folder } : {}),
    depackaged_result: forDelivery(args.result),
    account_id: args.readAccountId,
    ...(args.triggerAccountId ? { trigger_account_id: args.triggerAccountId } : {}),
    ...(args.accountEmail ? { account_email: args.accountEmail } : {}),
  }
  const plaintext = JSON.stringify(wire)
  if (Buffer.byteLength(plaintext, 'utf8') > MAX_DELIVERY_PLAINTEXT_BYTES) {
    console.warn(`[SandboxDelivery] too large for the relay — held. delivery_id=${wire.delivery_id} message=${msg.id}`)
    return { delivered: false, error: 'too_large_for_relay' }
  }

  const seal = deps.sealAuthenticated ?? sealServiceRpcPayloadAuthenticatedResolvingLocalKey
  const sealed = await seal(
    record,
    {
      handshake_id: record.handshake_id,
      sender_device_id: localDeviceId,
      receiver_device_id: roles.peerCoordinationDeviceId,
      plaintextJson: plaintext,
    },
    { ttlMs: DELIVERY_ENVELOPE_TTL_MS },
  )
  if (!sealed.ok) {
    console.warn(`[SandboxDelivery] seal failed — no plaintext fallback. delivery_id=${wire.delivery_id} code=${sealed.code}`)
    return { delivered: false, error: sealed.code }
  }

  const send = deps.sendSealedRelay ?? defaultSendSealedRelay
  const sent = await send(args.db, record, sealed.envelope)
  if (!sent.ok) {
    console.warn(`[SandboxDelivery] relay send failed. delivery_id=${wire.delivery_id} code=${sent.code}`)
    return { delivered: false, error: sent.code }
  }

  markLedger(args.readAccountId, msg.id, { deliveryId: wire.delivery_id, state: 'sent', at: now })
  console.log(`[SandboxDelivery] sealed delivery sent via relay. delivery_id=${wire.delivery_id} handshake=${record.handshake_id}`)
  return { delivered: true }
}

function defaultLocalDeviceId(): string {
  return getInstanceId()
}

async function defaultSendSealedRelay(
  db: unknown,
  record: HandshakeRecord,
  envelope: SealedServiceRpcEnvelope,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const { sendSealedServiceRpcViaCoordinationRelay } = await import('../ingestionPollTrigger/relaySend')
  return sendSealedServiceRpcViaCoordinationRelay(db, record, envelope)
}

// ── Receipt handler (sandbox) ─────────────────────────────────────────────────

export function isSandboxEmailDeliveryAckWire(v: unknown): v is SandboxEmailDeliveryAckWire {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    o.type === SANDBOX_EMAIL_DELIVERY_ACK_TYPE &&
    typeof o.delivery_id === 'string' &&
    typeof o.account_id === 'string' &&
    typeof o.source_message_id === 'string' &&
    (o.status === 'stored' || o.status === 'duplicate' || o.status === 'failed')
  )
}

/** Apply a host receipt to the ledger. `failed` keeps the message eligible for resend. */
export function applySandboxEmailDeliveryAck(ack: SandboxEmailDeliveryAckWire, now = Date.now()): void {
  if (ack.status === 'failed') {
    loadLedger()
    delete ledgerCache![ledgerKey(ack.account_id, ack.source_message_id)]
    saveLedger(now)
    console.warn(`[SandboxDelivery] host could not store delivery — will resend. delivery_id=${ack.delivery_id} reason=${ack.reason ?? 'unknown'}`)
    return
  }
  markLedger(ack.account_id, ack.source_message_id, { deliveryId: ack.delivery_id, state: 'acked', at: now })
  console.log(`[SandboxDelivery] host receipt ${ack.status}. delivery_id=${ack.delivery_id}`)
}

type RelayCtx = import('../ingestionPollTrigger/relayCapsuleHandler').IngestionPollRelayCapsuleContext

/** Dispatch-chain handler on the sandbox: takes `sandbox_email_delivery_ack`, declines the rest. */
export async function tryHandleSandboxEmailDeliveryAckRelayCapsule(
  ctx: RelayCtx,
  deps: { getRecord?: (db: unknown, hid: string) => HandshakeRecord | null | undefined } = {},
): Promise<boolean> {
  const { parseSealedServiceRpcEnvelopeFromRelayCapsule } = await import('../ingestionPollTrigger/relayCapsuleHandler')
  const envelope = parseSealedServiceRpcEnvelopeFromRelayCapsule(ctx.capsule)
  if (!envelope) return false
  const getRecord = deps.getRecord ?? (await import('../../handshake/db')).getHandshakeRecord
  const record = getRecord(ctx.db, envelope.handshake_id)
  if (!record) return false

  const opened = await openServiceRpcPayloadResolvingLocalKey(record, envelope, { requireAuthenticated: true })
  if (!opened.ok) return false
  let inner: unknown
  try {
    inner = JSON.parse(opened.plaintextJson)
  } catch {
    return false
  }
  if (!isSandboxEmailDeliveryAckWire(inner)) return false

  const claimed = claimSealedServiceRpcMessage(envelope)
  ctx.sendAck([ctx.relayMessageId])
  if (!claimed.ok) return true
  applySandboxEmailDeliveryAck(inner)
  return true
}
