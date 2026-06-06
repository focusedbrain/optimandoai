/**
 * Phase-1 item 10 — the pairing-code-vs-relay-device-id gap, proven against a
 * REAL local coordination relay (no mocks, no relay.wrdesk.com).
 *
 * The defect (HEAD before the fix): internal initiates that traverse the relay
 * never carried a resolved `receiver_device_id` on the wire, because the client
 * function the comments referenced (`resolvePairingCodeViaCoordination`) did not
 * exist. With a real relay the same-principal initiate guard then rejects the
 * capsule with `initiate_missing_routing_fields`. In production this is masked by
 * the email/file fallback; in mocked tests it is masked by pre-supplied device ids.
 *
 * This suite proves the causal chain end-to-end on a real relay:
 *   1. resolvePairingCodeViaCoordination resolves a registered 6-digit code →
 *      the peer's orchestrator instance id (and null for unknown codes).
 *   2. WITHOUT a resolved receiver_device_id (the pre-fix wire) the relay rejects
 *      the internal initiate with 400 initiate_missing_routing_fields  → RED.
 *   3. WITH the resolved receiver_device_id threaded onto the wire by the fix the
 *      relay accepts/routes the initiate (not the missing-routing-fields error),
 *      and the registry carries acceptor_device_id  → GREEN.
 *
 * Run under Electron's Node ABI: `pnpm test:native-db <thisFile>`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'

import { startRelayHarness, type RelayHarness } from './rig/coordinationRelayHarness'
import { migrateHandshakeTables } from '../db'
import { upsertP2PConfig } from '../../p2p/p2pConfig'
import { setOrchestratorMode } from '../../orchestrator/orchestratorModeStore'
import { buildInitiateCapsuleWithContent } from '../capsuleBuilder'
import { buildTestSession } from '../sessionFactory'
import { resolvePairingCodeViaCoordination } from '../resolvePairingCode'

// Same principal (internal handshake): both devices share one wrdesk_user_id.
// COORD_TEST_MODE parses bearer `test-<userId>-<tier>` by splitting on '-', so the
// user id must not contain dashes.
const USER = 'riguser'
const TOKEN = `test-${USER}-pro` // → sub = USER, tier = pro
const ACC_INSTANCE = 'acc-instance-22222222'
const ACC_CODE = '482917'

function makeInitiatorDb(coordUrl: string): any {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  upsertP2PConfig(db, {
    enabled: true,
    coordination_enabled: true,
    relay_mode: 'local',
    coordination_url: coordUrl,
    coordination_ws_url: coordUrl.replace('http', 'ws') + '/beap/ws',
  })
  return db
}

function buildInternalInitiate(opts: { withReceiverDeviceId: boolean }): {
  capsule: any
  handshakeId: string
} {
  const session = buildTestSession({ wrdesk_user_id: USER, sub: USER, email: `${USER}@dev.test` })
  const handshakeId = `hs-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const { capsule } = buildInitiateCapsuleWithContent(session, {
    receiverUserId: USER, // internal: same principal
    receiverEmail: `${USER}@dev.test`,
    handshake_id: handshakeId,
    initiatorDeviceRole: 'sandbox',
    initiatorComputerName: 'Rig-Initiator',
    internalReceiverPairingCode: ACC_CODE,
    ...(opts.withReceiverDeviceId ? { internalReceiverDeviceId: ACC_INSTANCE } : {}),
  })
  return { capsule, handshakeId }
}

async function registerHandshake(
  relay: RelayHarness,
  handshakeId: string,
  initiatorDeviceId: string,
  acceptorDeviceId: string,
): Promise<{ status: number; body: string }> {
  return relay.request('POST', '/beap/register-handshake', {
    auth: TOKEN,
    contentType: 'application/json',
    body: JSON.stringify({
      handshake_id: handshakeId,
      initiator_user_id: USER,
      acceptor_user_id: USER, // same principal
      initiator_email: `${USER}@dev.test`,
      acceptor_email: `${USER}@dev.test`,
      initiator_device_id: initiatorDeviceId,
      acceptor_device_id: acceptorDeviceId,
      handshake_type: 'internal',
    }),
  })
}

describe('pairing-code ↔ relay-device-id gap (real relay)', () => {
  let relay: RelayHarness

  beforeAll(async () => {
    // Isolate orchestrator-mode.json so getInstanceId() is deterministic and we
    // never pollute the developer's real ~/.opengiraffe config.
    const ud = mkdtempSync(join(tmpdir(), 'rig-userdata-'))
    try {
      app.setPath('userData', ud)
    } catch {
      /* under ELECTRON_RUN_AS_NODE app.setPath may be a no-op; getInstanceId still mints one */
    }
    setOrchestratorMode({
      mode: 'sandbox',
      instanceId: 'init-instance-11111111',
      pairingCode: '100200',
      deviceName: 'Rig-Initiator',
      connectedPeers: [],
    })
    relay = await startRelayHarness()
  })

  afterAll(async () => {
    if (relay) await relay.dispose()
  })

  beforeEach(() => {
    relay.resetState()
    // Re-register the acceptor's pairing code each test (resetState wipes it).
    return relay
      .request('POST', '/api/coordination/register-pairing-code', {
        auth: TOKEN,
        contentType: 'application/json',
        body: JSON.stringify({
          user_id: USER,
          instance_id: ACC_INSTANCE,
          pairing_code: ACC_CODE,
          device_name: 'Rig-Acceptor',
        }),
      })
      .then((r) => {
        expect([200, 201]).toContain(r.status)
      })
  })

  it('resolvePairingCodeViaCoordination resolves a registered code to the peer instance id', async () => {
    const db = makeInitiatorDb(relay.baseUrl())
    const resolved = await resolvePairingCodeViaCoordination(db, ACC_CODE, async () => TOKEN)
    expect(resolved?.instance_id).toBe(ACC_INSTANCE)
  })

  it('returns null for an unknown / unregistered pairing code (fail-open)', async () => {
    const db = makeInitiatorDb(relay.baseUrl())
    const resolved = await resolvePairingCodeViaCoordination(db, '000000', async () => TOKEN)
    expect(resolved).toBeNull()
  })

  it('RED: without a resolved receiver_device_id the relay rejects the internal initiate', async () => {
    const { capsule, handshakeId } = buildInternalInitiate({ withReceiverDeviceId: false })
    expect(capsule.receiver_device_id).toBeUndefined() // exactly HEAD's pre-fix wire
    const reg = await registerHandshake(relay, handshakeId, capsule.sender_device_id, ACC_INSTANCE)
    expect(reg.status).toBe(200)

    const res = await relay.request('POST', '/beap/capsule', {
      auth: TOKEN,
      contentType: 'application/json',
      body: JSON.stringify(capsule),
    })
    expect(res.status).toBe(400)
    expect(res.body).toContain('initiate_missing_routing_fields')
    expect(res.body).toContain('receiver_device_id')
  })

  it('GREEN: with the resolved receiver_device_id the relay routes the internal initiate', async () => {
    const { capsule, handshakeId } = buildInternalInitiate({ withReceiverDeviceId: true })
    expect(capsule.receiver_device_id).toBe(ACC_INSTANCE)
    expect(capsule.sender_device_id).not.toBe(ACC_INSTANCE) // distinct, per relay guard

    const reg = await registerHandshake(relay, handshakeId, capsule.sender_device_id, ACC_INSTANCE)
    expect(reg.status).toBe(200)

    const res = await relay.request('POST', '/beap/capsule', {
      auth: TOKEN,
      contentType: 'application/json',
      body: JSON.stringify(capsule),
    })
    // Accepted (live 200) or stored offline (202) — but never the routing-fields defect.
    expect([200, 202]).toContain(res.status)
    expect(res.body).not.toContain('initiate_missing_routing_fields')

    // Registry carries acceptor_device_id — the routing the gap previously dropped.
    const row = relay
      .db()
      .prepare('SELECT acceptor_device_id FROM coordination_handshake_registry WHERE handshake_id = ?')
      .get(handshakeId) as { acceptor_device_id: string } | undefined
    expect(row?.acceptor_device_id).toBe(ACC_INSTANCE)
  })
})
