/**
 * Sandbox → host mail delivery over the sealed coordination relay (decision D-38).
 *
 * Real crypto end to end: the sandbox seals a sender-authenticated envelope, the host
 * opens it, writes the inbox row, deduplicates, and answers with a sealed receipt that
 * the sandbox's ledger applies. Only ciphertext and routing metadata are on the wire.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { HandshakeState, type HandshakeRecord } from '../../../handshake/types'
import { buildSealedServiceRpcRelayCapsule } from '../../ingestionPollTrigger/relaySend'
import {
  __resetSealedRpcReplayGuardForTests,
  sealServiceRpcPayloadAuthenticated,
  type SealedServiceRpcEnvelope,
} from '../../../serviceRpc/sealedServiceRpc'
import {
  MAX_DELIVERY_PLAINTEXT_BYTES,
  RESEND_AFTER_MS,
  __setSandboxDeliveryLedgerPathForTests,
  applySandboxEmailDeliveryAck,
  deliverDepackagedMailViaSealedRelay,
  isAlreadyDeliveredToHost,
  tryHandleSandboxEmailDeliveryAckRelayCapsule,
  type SandboxEmailDeliveryAckWire,
} from '../relayDelivery'
import { resolveHostAccountForDelivery, tryHandleSandboxEmailDeliveryRelayCapsule } from '../relayDeliveryHostHandler'
import type { DepackageEmailResult } from '../../../depackaging-microvm/emailDepackage'

// The pair gate (`assertRecordForServiceRpc`) reads this device's coordination id.
const instance = vi.hoisted(() => ({ id: 'dev-host' }))
vi.mock('../../../orchestrator/orchestratorModeStore', async (io) => ({
  ...(await io<typeof import('../../../orchestrator/orchestratorModeStore')>()),
  getInstanceId: () => instance.id,
}))

function pair() {
  const priv = x25519.utils.randomPrivateKey()
  return {
    privB64: Buffer.from(priv).toString('base64'),
    pubB64: Buffer.from(x25519.getPublicKey(priv)).toString('base64'),
  }
}
const party = (uid: string) => ({ email: 'a@test.dev', wrdesk_user_id: uid, iss: 'https://idp', sub: `sub-${uid}` })
const hostKeys = pair()
const sandboxKeys = pair()
const hid = 'hs-delivery'

function rec(local: ReturnType<typeof pair>, peer: ReturnType<typeof pair>, localRole: 'initiator' | 'acceptor'): HandshakeRecord {
  return {
    handshake_id: hid,
    handshake_type: 'internal',
    same_principal: true,
    state: HandshakeState.ACTIVE,
    local_role: localRole,
    initiator: party('u1'),
    acceptor: party('u1'),
    internal_coordination_identity_complete: true,
    internal_coordination_repair_needed: false,
    initiator_coordination_device_id: 'dev-host',
    acceptor_coordination_device_id: 'dev-sand',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    peer_x25519_public_key_b64: peer.pubB64,
    local_x25519_private_key_b64: local.privB64,
    local_x25519_public_key_b64: local.pubB64,
  } as HandshakeRecord
}
const hostRecord = rec(hostKeys, sandboxKeys, 'initiator')
const sandboxRecord = rec(sandboxKeys, hostKeys, 'acceptor')

const SECRET_BODY = 'Kontonummer DE00 1234 — streng vertraulich'
const plainResult: DepackageEmailResult = {
  ok: true,
  type: 'plain',
  safeText: { subject: 'Rechnung', body_text: SECRET_BODY, attachment_refs: ['a1'] } as never,
  artifacts: [{ blob_id: 'b1', content_type: 'application/pdf', filename: 'r.pdf', blob: { ciphertext_b64: 'X'.repeat(64) } } as never],
  displayEnvelope: { from: { email: 'billing@shop.test', name: 'Shop' }, to: [], cc: [], subject: 'Rechnung', date: '' } as never,
  threadingHints: {} as never,
}
const msg = { id: 'prov-1', opaqueBytes: Buffer.from('raw'), receivedAt: '2026-10-30T10:00:00.000Z', folder: 'INBOX' }

function relayCtx(capsule: Record<string, unknown>) {
  return {
    relayMessageId: `relay-${Math.random()}`,
    capsule,
    db: {},
    ssoSession: { wrdesk_user_id: 'u1' } as never,
    sendAck: vi.fn(),
    getOidcToken: async () => 'tok',
  }
}

/** Sandbox side: deliver and capture the envelope the relay would carry. */
async function deliverFromSandbox(over: Partial<Parameters<typeof deliverDepackagedMailViaSealedRelay>[0]> = {}) {
  const sent: SealedServiceRpcEnvelope[] = []
  const out = await deliverDepackagedMailViaSealedRelay(
    { db: {}, record: sandboxRecord, readAccountId: 'sand-acc', triggerAccountId: 'host-acc-2', accountEmail: 'Me@Mail.test', msg, result: plainResult, ...over },
    {
      localDeviceId: () => 'dev-sand',
      sealAuthenticated: async (r, input, opts) => sealServiceRpcPayloadAuthenticated(r, input, sandboxKeys.privB64, opts),
      sendSealedRelay: async (_db, _r, env) => {
        sent.push(env)
        return { ok: true }
      },
    },
  )
  return { out, sent }
}

let tmpDir: string
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdl-'))
  __setSandboxDeliveryLedgerPathForTests(path.join(tmpDir, 'ledger.json'))
  __resetSealedRpcReplayGuardForTests()
  instance.id = 'dev-host'
})
afterEach(() => {
  __setSandboxDeliveryLedgerPathForTests(null)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('sandbox side: sealed delivery', () => {
  it('sends a sender-authenticated envelope that carries no content in the clear', async () => {
    const { out, sent } = await deliverFromSandbox()
    expect(out.delivered).toBe(true)
    expect(sent).toHaveLength(1)
    const capsule = buildSealedServiceRpcRelayCapsule(sent[0])
    expect(capsule.schema_version).toBe(2)
    const onWire = JSON.stringify(capsule)
    expect(onWire).not.toContain('Kontonummer')
    expect(onWire).not.toContain('billing@shop.test')
    expect(onWire).not.toContain('sandbox_email_delivery')
  })

  it('is skipped while in flight, resent after the window, skipped for good once acknowledged', async () => {
    await deliverFromSandbox()
    const now = Date.now()
    expect(isAlreadyDeliveredToHost('sand-acc', 'prov-1', now)).toBe(true)
    expect(isAlreadyDeliveredToHost('sand-acc', 'prov-1', now + RESEND_AFTER_MS + 1)).toBe(false)
    applySandboxEmailDeliveryAck({ type: 'sandbox_email_delivery_ack', schema_version: 1, delivery_id: 'd', handshake_id: hid, account_id: 'sand-acc', source_message_id: 'prov-1', status: 'stored' })
    expect(isAlreadyDeliveredToHost('sand-acc', 'prov-1', now + 10 * RESEND_AFTER_MS)).toBe(true)
  })

  it('a failed receipt makes the message eligible again', async () => {
    await deliverFromSandbox()
    applySandboxEmailDeliveryAck({ type: 'sandbox_email_delivery_ack', schema_version: 1, delivery_id: 'd', handshake_id: hid, account_id: 'sand-acc', source_message_id: 'prov-1', status: 'failed', reason: 'host_write_failed' })
    expect(isAlreadyDeliveredToHost('sand-acc', 'prov-1')).toBe(false)
  })

  it('a relay send failure is not delivered and not recorded', async () => {
    const out = await deliverDepackagedMailViaSealedRelay(
      { db: {}, record: sandboxRecord, readAccountId: 'sand-acc', msg, result: plainResult },
      {
        localDeviceId: () => 'dev-sand',
        sealAuthenticated: async (r, input, opts) => sealServiceRpcPayloadAuthenticated(r, input, sandboxKeys.privB64, opts),
        sendSealedRelay: async () => ({ ok: false, code: 'E_INGESTION_POLL_LINK_DOWN', message: 'down' }),
      },
    )
    expect(out).toEqual({ delivered: false, error: 'E_INGESTION_POLL_LINK_DOWN' })
    expect(isAlreadyDeliveredToHost('sand-acc', 'prov-1')).toBe(false)
  })

  it('refuses an oversize message loudly instead of truncating', async () => {
    const big: DepackageEmailResult = { ...plainResult, safeText: { subject: 's', body_text: 'x'.repeat(MAX_DELIVERY_PLAINTEXT_BYTES), attachment_refs: [] } as never } as DepackageEmailResult
    const { out, sent } = await deliverFromSandbox({ result: big })
    expect(out).toEqual({ delivered: false, error: 'too_large_for_relay' })
    expect(sent).toHaveLength(0)
  })

  it('only the sandbox side of the pair may deliver', async () => {
    const out = await deliverDepackagedMailViaSealedRelay(
      { db: {}, record: hostRecord, readAccountId: 'acc', msg, result: plainResult },
      { localDeviceId: () => 'dev-host', sendSealedRelay: async () => ({ ok: true }) },
    )
    expect(out.delivered).toBe(false)
  })
})

describe('host side: open, write, deduplicate, receipt', () => {
  function hostDeps(overrides: Record<string, unknown> = {}) {
    const writes: Array<{ accountId: string; result: DepackageEmailResult }> = []
    const acks: SandboxEmailDeliveryAckWire[] = []
    return {
      writes,
      acks,
      deps: {
        getRecord: () => hostRecord,
        localDeviceId: () => 'dev-host',
        listAccounts: async () => [
          { id: 'host-acc-1', email: 'me@mail.test' },
          { id: 'host-acc-2', email: 'other@mail.test' },
        ],
        isDuplicate: () => false,
        writer: async (_db: unknown, accountId: string, result: DepackageEmailResult) => {
          writes.push({ accountId, result })
          return { inboxRowId: 'row-1' }
        },
        sendAck: async (_db: unknown, _r: HandshakeRecord, ack: SandboxEmailDeliveryAckWire) => {
          acks.push(ack)
        },
        notifyInbox: () => {},
        ...overrides,
      },
    }
  }

  it('writes the guest-derived content to the mailbox-matched host account and acknowledges', async () => {
    const { sent } = await deliverFromSandbox()
    const h = hostDeps()
    const taken = await tryHandleSandboxEmailDeliveryRelayCapsule(relayCtx(buildSealedServiceRpcRelayCapsule(sent[0])), h.deps as never)
    expect(taken).toBe(true)
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0].accountId).toBe('host-acc-1')
    expect(h.writes[0].result.ok && h.writes[0].result.type === 'plain' && h.writes[0].result.safeText.body_text).toBe(SECRET_BODY)
    // The sandbox-only custody artifacts are not shipped.
    expect(h.writes[0].result.ok && h.writes[0].result.artifacts).toEqual([])
    expect(h.acks.map((a) => a.status)).toEqual(['stored'])
  })

  it('a duplicate is acknowledged without writing again', async () => {
    const { sent } = await deliverFromSandbox()
    const h = hostDeps({ isDuplicate: () => true })
    await tryHandleSandboxEmailDeliveryRelayCapsule(relayCtx(buildSealedServiceRpcRelayCapsule(sent[0])), h.deps as never)
    expect(h.writes).toHaveLength(0)
    expect(h.acks.map((a) => a.status)).toEqual(['duplicate'])
  })

  it('a replayed envelope is dropped (claimed once)', async () => {
    const { sent } = await deliverFromSandbox()
    const capsule = buildSealedServiceRpcRelayCapsule(sent[0])
    const h = hostDeps()
    await tryHandleSandboxEmailDeliveryRelayCapsule(relayCtx(capsule), h.deps as never)
    await tryHandleSandboxEmailDeliveryRelayCapsule(relayCtx(capsule), h.deps as never)
    expect(h.writes).toHaveLength(1)
  })

  it('a write failure answers failed so the sandbox resends', async () => {
    const { sent } = await deliverFromSandbox()
    const h = hostDeps({ writer: async () => { throw new Error('db locked') } })
    await tryHandleSandboxEmailDeliveryRelayCapsule(relayCtx(buildSealedServiceRpcRelayCapsule(sent[0])), h.deps as never)
    expect(h.acks.map((a) => [a.status, a.reason])).toEqual([['failed', 'host_write_failed']])
  })

  it('refuses a delivery when the peer is not this host\'s sandbox', async () => {
    const { sent } = await deliverFromSandbox()
    // Same keys, but this device is the sandbox of the pair: roles do not fit a host.
    instance.id = 'dev-sand'
    const h = hostDeps({ localDeviceId: () => 'dev-sand' })
    await tryHandleSandboxEmailDeliveryRelayCapsule(relayCtx(buildSealedServiceRpcRelayCapsule(sent[0])), h.deps as never)
    expect(h.writes).toHaveLength(0)
    expect(h.acks).toHaveLength(0)
  })

  it('declines other inner types so dispatch reaches their handler', async () => {
    const other = sealServiceRpcPayloadAuthenticated(sandboxRecord, { handshake_id: hid, sender_device_id: 'dev-sand', receiver_device_id: 'dev-host', plaintextJson: { type: 'ingestion_poll_result' } }, sandboxKeys.privB64)
    if (!other.ok) throw new Error(other.message)
    const ctx = relayCtx(buildSealedServiceRpcRelayCapsule(other.envelope))
    expect(await tryHandleSandboxEmailDeliveryRelayCapsule(ctx, hostDeps().deps as never)).toBe(false)
    expect(ctx.sendAck).not.toHaveBeenCalled()
  })
})

describe('receipt back to the sandbox', () => {
  it('the sandbox ack handler applies a sealed receipt from its host', async () => {
    await deliverFromSandbox()
    const ack: SandboxEmailDeliveryAckWire = { type: 'sandbox_email_delivery_ack', schema_version: 1, delivery_id: 'd1', handshake_id: hid, account_id: 'sand-acc', source_message_id: 'prov-1', status: 'stored' }
    const sealed = sealServiceRpcPayloadAuthenticated(hostRecord, { handshake_id: hid, sender_device_id: 'dev-host', receiver_device_id: 'dev-sand', plaintextJson: ack as never }, hostKeys.privB64)
    if (!sealed.ok) throw new Error(sealed.message)
    const ctx = relayCtx(buildSealedServiceRpcRelayCapsule(sealed.envelope))
    expect(await tryHandleSandboxEmailDeliveryAckRelayCapsule(ctx, { getRecord: () => sandboxRecord })).toBe(true)
    expect(ctx.sendAck).toHaveBeenCalled()
    expect(isAlreadyDeliveredToHost('sand-acc', 'prov-1', Date.now() + 10 * RESEND_AFTER_MS)).toBe(true)
  })
})

describe('host account mapping', () => {
  const accounts = [{ id: 'h1', email: 'me@mail.test' }, { id: 'h2', email: 'x@mail.test' }]
  const base = { account_id: 'sand-acc' } as never
  it('mailbox address first, then trigger account, then the sandbox account id', () => {
    expect(resolveHostAccountForDelivery({ ...(base as object), account_email: 'ME@mail.test', trigger_account_id: 'h2' } as never, accounts)).toEqual({ accountId: 'h1', via: 'email' })
    expect(resolveHostAccountForDelivery({ ...(base as object), trigger_account_id: 'h2' } as never, accounts)).toEqual({ accountId: 'h2', via: 'trigger' })
    expect(resolveHostAccountForDelivery({ ...(base as object), trigger_account_id: 'nope' } as never, accounts)).toEqual({ accountId: 'sand-acc', via: 'sandbox_account' })
  })
})
