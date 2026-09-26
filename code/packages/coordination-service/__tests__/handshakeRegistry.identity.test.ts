/**
 * Handshake registry — full-claim identity binding regression tests
 * [VII.3.8–3.10], Phase 1.
 *
 * Covers the coordination-service defect sites:
 *   - sub-only ack/sender binding (cross-SSO `beap_ingest_ack` defect class):
 *     a caller with a matching `sub` but a different issuer must be rejected
 *     once the registry row carries a recorded issuer.
 *   - lazy `iss` backfill: legacy rows (NULL iss) keep working on sub alone
 *     and bind their issuer on the next register-handshake; a recorded issuer
 *     is immutable (first write wins) and conflicting re-registration is
 *     refused.
 */
import { createRequire } from 'module'
import { describe, it, expect, beforeEach } from 'vitest'

const require = createRequire(import.meta.url)
let Database: typeof import('better-sqlite3').default | null = null
try {
  const D = require('better-sqlite3') as typeof import('better-sqlite3').default
  const d = new D(':memory:')
  d.close()
  Database = D
} catch {
  Database = null
}

import { createHandshakeRegistry } from '../src/handshakeRegistry.js'
import { createWsManager } from '../src/wsManager.js'
import type { StoreAdapter } from '../src/store.js'

const REGISTRY_SCHEMA = `
CREATE TABLE IF NOT EXISTS coordination_handshake_registry (
  handshake_id TEXT PRIMARY KEY,
  initiator_user_id TEXT NOT NULL,
  acceptor_user_id TEXT NOT NULL,
  initiator_email TEXT,
  acceptor_email TEXT,
  initiator_device_id TEXT,
  acceptor_device_id TEXT,
  initiator_device_role TEXT,
  acceptor_device_role TEXT,
  initiator_device_name TEXT,
  acceptor_device_name TEXT,
  initiator_iss TEXT,
  acceptor_iss TEXT,
  created_at TEXT NOT NULL
);
`

const ISS_A = 'https://sso-a.example.com/realm/main'
const ISS_B = 'https://sso-b.example.com/realm/other'

function makeStore(): { store: StoreAdapter; db: InstanceType<NonNullable<typeof Database>> } {
  const db = new Database!(':memory:')
  db.exec(REGISTRY_SCHEMA)
  const store = { getDb: () => db } as unknown as StoreAdapter
  return { store, db }
}

describe.skipIf(!Database)('handshake registry — full-claim identity binding', () => {
  let store: StoreAdapter
  let db: InstanceType<NonNullable<typeof Database>>
  let registry: ReturnType<typeof createHandshakeRegistry>

  beforeEach(() => {
    const made = makeStore()
    store = made.store
    db = made.db
    registry = createHandshakeRegistry(store)
  })

  /** `callerIss: null` simulates a legacy pre-Phase-1 registration (no caller identity). */
  function register(hsId: string, callerIss: string | null = ISS_A) {
    return registry.registerHandshake(
      hsId,
      'user-init',
      'user-acc',
      'init@example.com',
      'acc@example.com',
      'dev-init',
      'dev-acc',
      undefined,
      undefined,
      undefined,
      undefined,
      callerIss !== null ? { sub: 'user-init', iss: callerIss } : undefined,
    )
  }

  it('stamps the caller issuer onto their side on registration', () => {
    expect(register('hs-1').ok).toBe(true)
    const row = registry.getHandshake('hs-1')!
    expect(row.initiator_iss).toBe(ISS_A)
    expect(row.acceptor_iss).toBeNull()
  })

  it('cross-SSO regression: matching sub under a different issuer is rejected as sender', () => {
    register('hs-1')
    // Same sub, recorded issuer → authorized.
    expect(registry.isSenderAuthorized('hs-1', 'user-init', ISS_A)).toBe(true)
    // Same sub, DIFFERENT issuer → rejected [VII.3.8/3.10].
    expect(registry.isSenderAuthorized('hs-1', 'user-init', ISS_B)).toBe(false)
    // Missing issuer against a recorded binding → rejected (no sub-only shortcut).
    expect(registry.isSenderAuthorized('hs-1', 'user-init', null)).toBe(false)
  })

  it('cross-SSO regression: getRecipientForSender refuses a different-issuer sender', () => {
    register('hs-1')
    expect(registry.getRecipientForSender('hs-1', 'user-init', 'dev-init', ISS_A)).toEqual({
      userId: 'user-acc',
      deviceId: 'dev-acc',
    })
    expect(registry.getRecipientForSender('hs-1', 'user-init', 'dev-init', ISS_B)).toBeNull()
  })

  it('cross-SSO regression: identityMatchesRegisteredPrincipal (beap_ingest_ack binding)', () => {
    register('hs-1')
    expect(
      registry.identityMatchesRegisteredPrincipal('hs-1', { sub: 'user-init', iss: ISS_A }),
    ).toBe(true)
    expect(
      registry.identityMatchesRegisteredPrincipal('hs-1', { sub: 'user-init', iss: ISS_B }),
    ).toBe(false)
    expect(registry.identityMatchesRegisteredPrincipal('hs-missing', { sub: 'user-init', iss: ISS_A })).toBe(false)
  })

  it('legacy row without recorded iss keeps working on sub (lazy backfill window)', () => {
    // Simulate a pre-Phase-1 row: no callerIdentity → no iss recorded.
    register('hs-legacy', null)
    const row = registry.getHandshake('hs-legacy')!
    expect(row.initiator_iss).toBeNull()
    expect(registry.isSenderAuthorized('hs-legacy', 'user-init', ISS_A)).toBe(true)
    expect(registry.isSenderAuthorized('hs-legacy', 'user-init', null)).toBe(true)
  })

  it('lazy backfill: re-registration binds the issuer; it is then enforced', () => {
    register('hs-legacy', null)
    expect(register('hs-legacy', ISS_A).ok).toBe(true)
    expect(registry.getHandshake('hs-legacy')!.initiator_iss).toBe(ISS_A)
    expect(registry.isSenderAuthorized('hs-legacy', 'user-init', ISS_B)).toBe(false)
  })

  it('recorded issuer is immutable: conflicting re-registration is refused (first write wins)', () => {
    register('hs-1', ISS_A)
    const result = register('hs-1', ISS_B)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('issuer_mismatch')
    // Row unchanged.
    expect(registry.getHandshake('hs-1')!.initiator_iss).toBe(ISS_A)
  })

  it('same-principal internal pair: both sides stamped when subs are identical', () => {
    const r = registry.registerHandshake(
      'hs-internal',
      'user-same',
      'user-same',
      'same@example.com',
      'same@example.com',
      'dev-host',
      'dev-sandbox',
      'host',
      'sandbox',
      undefined,
      undefined,
      { sub: 'user-same', iss: ISS_A },
    )
    expect(r.ok).toBe(true)
    const row = registry.getHandshake('hs-internal')!
    expect(row.initiator_iss).toBe(ISS_A)
    expect(row.acceptor_iss).toBe(ISS_A)
    // Device-scoped routing still works with the issuer supplied.
    expect(registry.getRecipientForSender('hs-internal', 'user-same', 'dev-host', ISS_A)).toEqual({
      userId: 'user-same',
      deviceId: 'dev-sandbox',
    })
    expect(registry.getRecipientForSender('hs-internal', 'user-same', 'dev-host', ISS_B)).toBeNull()
  })
})

/**
 * server.ts relay identity defect site: the WS connection must carry the full
 * (sub, iss) identity so the `beap_ingest_ack` handler can run the full-claim
 * check instead of a sub-only comparison.
 */
describe('wsManager — full identity bound to the WebSocket', () => {
  function makeWsStoreStub(): StoreAdapter {
    return {
      getPendingCapsules: () => [],
      getPendingDeviceAggregateForUser: () => [],
      markPushed: () => {},
      acknowledgeCapsules: () => {},
    } as unknown as StoreAdapter
  }

  function makeFakeWs(): any {
    return { send: () => {}, on: () => {}, terminate: () => {}, ping: () => {} }
  }

  it('getIdentityForWs returns sub AND iss from the validated connection token', () => {
    const wsManager = createWsManager(makeWsStoreStub())
    const ws = makeFakeWs()
    wsManager.handleConnection(
      ws,
      { userId: 'user-1', email: 'u1@example.com', tier: 'free', iss: ISS_A } as any,
      'dev-1',
    )
    expect(wsManager.getIdentityForWs(ws)).toEqual({ userId: 'user-1', iss: ISS_A })
  })

  it('getIdentityForWs is undefined for an unknown socket (ack cannot bind)', () => {
    const wsManager = createWsManager(makeWsStoreStub())
    expect(wsManager.getIdentityForWs(makeFakeWs())).toBeUndefined()
  })
})
