/**
 * Phase 3 — Internal handshake initiate pushes via the coordination relay.
 *
 * Integration-style test that exercises the full handshake.initiate code path for an
 * internal handshake with coordination enabled:
 *
 *   initiate
 *     → registerHandshakeWithRelay (with acceptor_device_id populated)
 *     → enqueueOutboundCapsule    (capsule_type = 'initiate', receiver_device_id set)
 *     → processOutboundQueue      (POST to <coordination_url>/beap/capsule)
 *     → relay_delivery = 'pushed_live'
 *
 * External handshakes and internal handshakes without coordination are unaffected
 * (covered by existing suites in ipc.handshake.test.ts and handshake-e2e-hardened).
 *
 * Uses real better-sqlite3 (in-memory) because upsertP2PConfig, the outbound queue,
 * and the ingestion tables all issue SQL that the lightweight `handshakeTestDb` mock
 * doesn't intercept. Test is skipped automatically when better-sqlite3 can't load.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'node:os'
import Database from 'better-sqlite3'

// Electron `app.getPath` is referenced at module-load time by the email gateway which
// is transitively imported via `../ipc` → `emailTransport` → `messageRouter` → `gateway`.
// Without this mock the file fails to even collect (pre-existing in ipc.handshake.test.ts).
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: () => undefined, on: () => undefined, removeHandler: () => undefined },
  BrowserWindow: class {
    webContents = { send: () => undefined }
    static getAllWindows() {
      return []
    }
  },
}))

const registerHandshakeMock = vi.hoisted(() => vi.fn())

// orchestratorModeStore.getInstanceId drives `getLocalDeviceIdForRelay()` which gates
// the internal-endpoint validation and seeds the initiator's relay device id.
const INSTANCE_ID = '11111111-1111-4111-8111-111111111111'
vi.mock('../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: vi.fn(() => INSTANCE_ID),
}))

vi.mock('../device-keys/deviceKeyStore', () => ({
  getDeviceX25519PublicKey: vi.fn(async () => 'dGVzdC14MjU1MTktcHViLWtleS1iNjQ='),
  getDeviceX25519KeyPair: vi.fn(),
  DeviceKeyNotFoundError: class extends Error {
    code = 'DEVICE_KEY_NOT_FOUND'
  },
}))

vi.mock('../../p2p/relaySync', () => ({
  registerHandshakeWithRelay: (...args: unknown[]) => registerHandshakeMock(...args),
}))

import { handleHandshakeRPC, setSSOSessionProvider, _resetSSOSessionProvider } from '../ipc'
import { buildTestSession } from '../sessionFactory'
import { migrateHandshakeTables } from '../db'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { upsertP2PConfig } from '../../p2p/p2pConfig'
import { clearOutboundAutoDrainTimer, setOutboundQueueAuthRefresh } from '../outboundQueue'

let sqliteAvailable = false
try {
  const probe = new Database(':memory:')
  probe.close()
  sqliteAvailable = true
} catch {
  console.warn('[ipc.internal.relayPush] better-sqlite3 not available — tests skipped')
}

function createRealTestDb(): any {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  migrateIngestionTables(db)
  return db
}

const PEER_ID = '22222222-2222-4222-8222-222222222222'
const COORD_URL = 'https://coord.example.test'

describe.skipIf(!sqliteAvailable)('handshake.initiate internal — coordination relay push (Phase 3)', () => {
  let db: any
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    db = createRealTestDb()
    fetchSpy = vi.spyOn(globalThis, 'fetch')
    registerHandshakeMock.mockReset()
    registerHandshakeMock.mockResolvedValue({ success: true })
    _resetSSOSessionProvider()
    setSSOSessionProvider(() =>
      buildTestSession({
        wrdesk_user_id: 'user-int',
        email: 'user-int@test.com',
        sub: 'user-int',
      }),
    )
    upsertP2PConfig(db, {
      relay_mode: 'local',
      use_coordination: true,
      coordination_url: COORD_URL,
    })
  })

  afterEach(() => {
    clearOutboundAutoDrainTimer()
    setOutboundQueueAuthRefresh(undefined)
    fetchSpy?.mockRestore?.()
    vi.restoreAllMocks()
  })

  test('pushes initiate capsule through coordination; returns relay_delivery=pushed_live', async () => {
    // Coordination returns 200 → delivered live.
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = (await handleHandshakeRPC(
      'handshake.initiate',
      {
        receiverUserId: 'user-int',
        receiverEmail: 'user-int@test.com',
        fromAccountId: 'acct-alice-1',
        handshake_type: 'internal',
        device_role: 'host',
        device_name: 'HostBox',
        counterparty_device_id: PEER_ID,
        counterparty_device_role: 'sandbox',
        counterparty_computer_name: 'SandboxBox',
        p2pAuthToken: 'test-oidc-token',
      } as any,
      db,
      async () => 'test-oidc-token',
    )) as any

    expect(result.success).toBe(true)
    expect(result.handshake_id).toMatch(/^hs-/)

    // Register-on-send: acceptor_device_id must be populated on the registration so the
    // relay's handshakeRegistry can route the initiate capsule without a separate
    // acceptor-side registration round-trip.
    expect(registerHandshakeMock).toHaveBeenCalledTimes(1)
    const regArgs = registerHandshakeMock.mock.calls[0]
    const regOpts = regArgs[regArgs.length - 1]
    expect(regOpts).toMatchObject({
      initiator_device_id: INSTANCE_ID,
      acceptor_device_id: PEER_ID,
      handshake_type: 'internal',
    })

    // Outbound queue → POST to <coordination_url>/beap/capsule.
    expect(fetchSpy).toHaveBeenCalled()
    const coordinationCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).endsWith('/beap/capsule'),
    )
    expect(coordinationCall).toBeDefined()
    const url = String(coordinationCall![0])
    expect(url).toBe(`${COORD_URL}/beap/capsule`)
    const init = coordinationCall![1] as RequestInit | undefined
    expect(String(init?.method ?? 'POST').toUpperCase()).toBe('POST')
    const body = typeof init?.body === 'string' ? init.body : ''
    const parsed = body ? JSON.parse(body) : {}
    // Accept either a wrapped envelope (`{ capsule: {...} }`) or the capsule directly —
    // both shapes have surfaced in the repo's transport history; what matters is that the
    // initiate capsule carries the receiver_device_id that the relay routes on.
    const capsule = parsed.capsule ?? parsed
    expect(capsule?.capsule_type).toBe('initiate')
    expect(capsule?.handshake_id).toBe(result.handshake_id)
    const receiverId =
      capsule?.receiver_device_id ??
      capsule?.internalWire?.receiver_device_id ??
      capsule?.internal_wire?.receiver_device_id
    const senderId =
      capsule?.sender_device_id ??
      capsule?.internalWire?.sender_device_id ??
      capsule?.internal_wire?.sender_device_id
    expect(receiverId).toBe(PEER_ID)
    expect(senderId).toBe(INSTANCE_ID)

    // Renderer-visible delivery status.
    expect(result.relay_delivery).toBe('pushed_live')
    expect(result.relay_error).toBeUndefined()

    // Queue row drained on success.
    const remaining = db
      .prepare(`SELECT COUNT(*) AS c FROM outbound_capsule_queue WHERE handshake_id = ?`)
      .get(result.handshake_id) as { c: number }
    expect(remaining.c).toBe(0)
  })

  test('coordination failure surfaces relay_delivery=coordination_unavailable (fallback to download)', async () => {
    fetchSpy.mockResolvedValue(new Response('server exploded', { status: 500 }))

    const result = (await handleHandshakeRPC(
      'handshake.initiate',
      {
        receiverUserId: 'user-int',
        receiverEmail: 'user-int@test.com',
        fromAccountId: 'acct-alice-1',
        handshake_type: 'internal',
        device_role: 'host',
        device_name: 'HostBox',
        counterparty_device_id: PEER_ID,
        counterparty_device_role: 'sandbox',
        counterparty_computer_name: 'SandboxBox',
        p2pAuthToken: 'test-oidc-token',
      } as any,
      db,
      async () => 'test-oidc-token',
    )) as any

    // Local persist still succeeds — the user can retry or fall back to the .beap download.
    expect(result.success).toBe(true)
    expect(result.handshake_id).toMatch(/^hs-/)
    expect(result.relay_delivery).toBe('coordination_unavailable')
  })
})
