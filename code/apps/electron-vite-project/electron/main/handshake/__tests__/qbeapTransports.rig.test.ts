/**
 * Phase-1 item 3 — qBEAP `message_package` over relay transports, proven on a
 * REAL local relay (no relay.wrdesk.com):
 *
 *   T2  coordination WS   — recipient online → relay pushes the capsule live (200),
 *                           byte-identical to what was sent.
 *   T3  relay store-pull  — recipient offline → relay stores (202); the pulled bytes
 *                           are byte-identical to what was sent.
 *
 * Direct-LAN P2P HTTP (legacy T1 / createP2PServer) was removed — sealed relay only.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import WebSocket from 'ws'

import { startRelayHarness, type RelayHarness } from './rig/coordinationRelayHarness'
import { setEmailSendFn, _resetEmailSendFn } from '../emailTransport'
import { buildTestSession } from '../sessionFactory'
import type { SSOSession } from '../types'

function session(user: string): SSOSession {
  return buildTestSession({ wrdesk_user_id: user, sub: user, email: `${user}@dev.test` })
}

const ALICE = 'qbalice'
const BOB = 'qbbob'
const ALICE_TOKEN = `test-${ALICE}-pro`
const BOB_TOKEN = `test-${BOB}-pro`

/** Minimal qBEAP message_package wire (native BEAP, no top-level capsule_type). */
function makeMessagePackage(handshakeId: string) {
  return {
    handshake_id: handshakeId,
    header: { encoding: 'qBEAP', version: '1.0', kem: 'X25519_HKDF_AES256GCM' },
    metadata: { sender: `${ALICE}@dev.test`, timestamp: new Date().toISOString() },
    envelope: Buffer.from(`sealed-${handshakeId}`).toString('base64'),
  }
}

async function registerHs(relay: RelayHarness, hsId: string, alice: SSOSession, bob: SSOSession) {
  return relay.request('POST', '/beap/register-handshake', {
    auth: ALICE_TOKEN,
    contentType: 'application/json',
    body: JSON.stringify({
      handshake_id: hsId,
      initiator_user_id: alice.wrdesk_user_id,
      acceptor_user_id: bob.wrdesk_user_id,
      initiator_email: alice.email,
      acceptor_email: bob.email,
    }),
  })
}

describe('qBEAP message_package over relay transports (real relay)', () => {
  let relay: RelayHarness

  beforeAll(async () => {
    relay = await startRelayHarness()
  })

  afterAll(async () => {
    if (relay) await relay.dispose()
  })

  beforeEach(() => {
    relay.resetState()
    _resetEmailSendFn()
    setEmailSendFn(vi.fn().mockResolvedValue({ success: true, messageId: 'm1' }))
  })

  it('T2: recipient online → relay WS-pushes the qBEAP byte-identical (200)', async () => {
    const alice = session(ALICE)
    const bob = session(BOB)
    const hsId = `hs-qb-ws-${Date.now()}`
    expect((await registerHs(relay, hsId, alice, bob)).status).toBe(200)
    const pkg = makeMessagePackage(hsId)

    const pushed: any = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${relay.wsUrl()}?token=${encodeURIComponent(BOB_TOKEN)}`)
      const timer = setTimeout(() => { ws.close(); reject(new Error('no WS push')) }, 4000)
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'capsule') { clearTimeout(timer); ws.close(); resolve(msg.capsule) }
      })
      ws.on('open', async () => {
        const res = await relay.request('POST', '/beap/capsule', { auth: ALICE_TOKEN, contentType: 'application/json', body: JSON.stringify(pkg) })
        expect(res.status).toBe(200) // recipient online → live push
      })
      ws.on('error', reject)
    })
    expect(pushed.envelope).toBe(pkg.envelope)
    expect(pushed.header).toEqual(pkg.header)
    expect(pushed.handshake_id).toBe(hsId)
  })

  it('T3: recipient offline → relay stores the qBEAP byte-identical (202)', async () => {
    const alice = session(ALICE)
    const bob = session(BOB)
    const hsId = `hs-qb-store-${Date.now()}`
    expect((await registerHs(relay, hsId, alice, bob)).status).toBe(200)
    const pkg = makeMessagePackage(hsId)

    const res = await relay.request('POST', '/beap/capsule', { auth: ALICE_TOKEN, contentType: 'application/json', body: JSON.stringify(pkg) })
    expect(res.status).toBe(202) // no recipient WS → stored offline

    const row = relay.db().prepare('SELECT capsule_json FROM coordination_capsules WHERE handshake_id=? ORDER BY received_at DESC LIMIT 1').get(hsId) as { capsule_json: string } | undefined
    expect(row?.capsule_json).toBeTruthy()
    const stored = JSON.parse(row!.capsule_json)
    expect(stored.envelope).toBe(pkg.envelope)
    expect(stored.header).toEqual(pkg.header)
    expect(stored.handshake_id).toBe(hsId)
  })
})
