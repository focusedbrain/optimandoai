/**
 * Host side of sandbox → host mail delivery over the coordination relay (decision D-38).
 *
 * Takes a sealed, sender-authenticated `sandbox_email_delivery` from the paired sandbox,
 * writes the guest-derived content to this host's inbox (the host never sees raw MIME),
 * deduplicates per account + provider message id (delivery is at-least-once), and answers
 * with a sealed `sandbox_email_delivery_ack` so the sandbox stops resending.
 *
 * INV-5: ids and codes in logs; never message content.
 */

import type { HandshakeRecord } from '../../handshake/types'
import {
  claimSealedServiceRpcMessage,
  openServiceRpcPayloadResolvingLocalKey,
  sealServiceRpcPayloadAuthenticatedResolvingLocalKey,
} from '../../serviceRpc/sealedServiceRpc'
import {
  SANDBOX_EMAIL_DELIVERY_SCHEMA_VERSION,
  SANDBOX_EMAIL_DELIVERY_TYPE,
  isSandboxEmailDeliveryShape,
  writeSandboxDeliveryToHostInbox,
  type SandboxDeliveryHostWriter,
  type SandboxEmailDeliveryWire,
} from '../../critical-jobs/remote/sandboxEmailDelivery'
import { assertRecordForServiceRpc, deriveInternalHostAiPeerRoles } from '../../internalInference/policy'
import { getInstanceId } from '../../orchestrator/orchestratorModeStore'
import { SANDBOX_EMAIL_DELIVERY_ACK_TYPE, type SandboxEmailDeliveryAckWire } from './relayDelivery'
import type { IngestionPollRelayCapsuleContext } from '../ingestionPollTrigger/relayCapsuleHandler'

type DeliveryWire = SandboxEmailDeliveryWire & { trigger_account_id?: string; account_email?: string }

export interface SandboxDeliveryRelayHostDeps {
  getRecord?: (db: unknown, handshakeId: string) => HandshakeRecord | null | undefined
  writer?: SandboxDeliveryHostWriter
  /** Host account ids with their mailbox address. */
  listAccounts?: () => Promise<Array<{ id: string; email: string }>>
  isDuplicate?: (db: unknown, accountId: string, sourceMessageId: string) => boolean
  sendAck?: (db: unknown, record: HandshakeRecord, ack: SandboxEmailDeliveryAckWire, ctx: IngestionPollRelayCapsuleContext) => Promise<void>
  notifyInbox?: () => void
  localDeviceId?: () => string
}

/**
 * Which host account the row belongs to: the host account with the same mailbox address,
 * else the trigger account (the host account whose Sync started the poll), else the
 * sandbox read-account id (the row then shows under an unknown account — logged).
 */
export function resolveHostAccountForDelivery(
  wire: DeliveryWire,
  hostAccounts: ReadonlyArray<{ id: string; email: string }>,
): { accountId: string; via: 'email' | 'trigger' | 'sandbox_account' } {
  const email = (wire.account_email ?? '').trim().toLowerCase()
  if (email) {
    const hit = hostAccounts.find((a) => a.email.trim().toLowerCase() === email)
    if (hit) return { accountId: hit.id, via: 'email' }
  }
  const trigger = (wire.trigger_account_id ?? '').trim()
  if (trigger && hostAccounts.some((a) => a.id === trigger)) return { accountId: trigger, via: 'trigger' }
  return { accountId: wire.account_id, via: 'sandbox_account' }
}

function defaultIsDuplicate(db: unknown, accountId: string, sourceMessageId: string): boolean {
  try {
    const row = (db as { prepare: (s: string) => { get: (...a: unknown[]) => unknown } })
      .prepare('SELECT 1 FROM inbox_messages WHERE account_id = ? AND email_message_id = ? LIMIT 1')
      .get(accountId, sourceMessageId)
    return !!row
  } catch {
    return false
  }
}

async function defaultListAccounts(): Promise<Array<{ id: string; email: string }>> {
  const { emailGateway } = await import('../gateway')
  const list = await emailGateway.listAccounts()
  return list.map((a) => ({ id: a.id, email: a.email }))
}

async function defaultSendAck(
  db: unknown,
  record: HandshakeRecord,
  ack: SandboxEmailDeliveryAckWire,
  ctx: IngestionPollRelayCapsuleContext,
  senderDeviceId: string,
  receiverDeviceId: string,
): Promise<void> {
  const sealed = await sealServiceRpcPayloadAuthenticatedResolvingLocalKey(record, {
    handshake_id: record.handshake_id,
    sender_device_id: senderDeviceId,
    receiver_device_id: receiverDeviceId,
    plaintextJson: ack as unknown as Record<string, unknown>,
  })
  if (!sealed.ok) {
    console.warn(`[SandboxDelivery] receipt seal failed. delivery_id=${ack.delivery_id} code=${sealed.code}`)
    return
  }
  const { sendSealedServiceRpcViaCoordinationRelay } = await import('../ingestionPollTrigger/relaySend')
  const sent = await sendSealedServiceRpcViaCoordinationRelay(db, record, sealed.envelope, { getOidcToken: ctx.getOidcToken })
  if (!sent.ok) console.warn(`[SandboxDelivery] receipt send failed. delivery_id=${ack.delivery_id} code=${sent.code}`)
}

/** Dispatch-chain handler on the host: takes `sandbox_email_delivery`, declines the rest. */
export async function tryHandleSandboxEmailDeliveryRelayCapsule(
  ctx: IngestionPollRelayCapsuleContext,
  deps: SandboxDeliveryRelayHostDeps = {},
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
  if (!inner || typeof inner !== 'object' || (inner as { type?: unknown }).type !== SANDBOX_EMAIL_DELIVERY_TYPE) {
    return false
  }

  const claimed = claimSealedServiceRpcMessage(envelope)
  ctx.sendAck([ctx.relayMessageId])
  if (!claimed.ok) {
    console.warn(`[SandboxDelivery] replayed delivery envelope dropped. handshake=${envelope.handshake_id}`)
    return true
  }

  // Only an internal, same-principal, ACTIVE pair where the PEER is the sandbox may deliver.
  const gate = assertRecordForServiceRpc(record)
  const localDeviceId = (deps.localDeviceId ?? getInstanceId)().trim()
  const roles = deriveInternalHostAiPeerRoles(record, localDeviceId)
  if (!gate.ok || !roles.ok || roles.localRole !== 'host' || roles.peerRole !== 'sandbox') {
    console.warn(`[SandboxDelivery] delivery refused — not from this host's paired sandbox. handshake=${envelope.handshake_id}`)
    return true
  }
  if (!isSandboxEmailDeliveryShape(inner) || inner.schema_version !== SANDBOX_EMAIL_DELIVERY_SCHEMA_VERSION) {
    console.warn(`[SandboxDelivery] delivery refused — invalid wire. handshake=${envelope.handshake_id}`)
    return true
  }
  const wire = inner as DeliveryWire
  const pairRecord = gate.record
  const hostDeviceId = roles.localCoordinationDeviceId
  const sandboxDeviceId = roles.peerCoordinationDeviceId

  const reply = async (status: SandboxEmailDeliveryAckWire['status'], reason?: string) => {
    const ack: SandboxEmailDeliveryAckWire = {
      type: SANDBOX_EMAIL_DELIVERY_ACK_TYPE,
      schema_version: 1,
      delivery_id: wire.delivery_id,
      handshake_id: record.handshake_id,
      account_id: wire.account_id,
      source_message_id: wire.source_message_id,
      status,
      ...(reason ? { reason } : {}),
    }
    if (deps.sendAck) return deps.sendAck(ctx.db, pairRecord, ack, ctx)
    return defaultSendAck(ctx.db, pairRecord, ack, ctx, hostDeviceId, sandboxDeviceId)
  }

  if (!wire.depackaged_result?.ok) {
    await reply('failed', 'depackaged_result_not_ok')
    return true
  }

  let hostAccounts: Array<{ id: string; email: string }> = []
  try {
    hostAccounts = await (deps.listAccounts ?? defaultListAccounts)()
  } catch {
    hostAccounts = []
  }
  const target = resolveHostAccountForDelivery(wire, hostAccounts)
  if (target.via === 'sandbox_account') {
    console.warn(`[SandboxDelivery] no matching host account — row keeps the sandbox account id. delivery_id=${wire.delivery_id}`)
  }

  if ((deps.isDuplicate ?? defaultIsDuplicate)(ctx.db, target.accountId, wire.source_message_id)) {
    console.log(`[SandboxDelivery] duplicate delivery — already in inbox. delivery_id=${wire.delivery_id}`)
    await reply('duplicate')
    return true
  }

  try {
    const r = await (deps.writer ?? writeSandboxDeliveryToHostInbox)(ctx.db, target.accountId, wire.depackaged_result, {
      sourceMessageId: wire.source_message_id,
      receivedAt: wire.received_at,
      folder: wire.folder,
      handshakeId: wire.handshake_id,
    })
    console.log(`[SandboxDelivery] stored via relay. delivery_id=${wire.delivery_id} inbox_row_id=${r.inboxRowId ?? 'null'}`)
    await reply('stored')
    ;(deps.notifyInbox ?? defaultNotifyInbox)()
  } catch (err) {
    const code = err instanceof Error ? err.message.slice(0, 80) : 'host_write_failed'
    console.warn(`[SandboxDelivery] host write failed. delivery_id=${wire.delivery_id} err=${code}`)
    await reply('failed', 'host_write_failed')
  }
  return true
}

function defaultNotifyInbox(): void {
  void import('../beapInboxDashboardNotify').then((m) => m.notifyBeapInboxDashboard(null)).catch(() => {})
}
