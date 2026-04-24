import { describe, test, expect, vi, beforeEach } from 'vitest'
import { P2P_BEAP_INBOX_ACCOUNT_ID, type InternalSandboxListEntry } from '../../handshake/internalSandboxesApi'
import { HandshakeState, type HandshakeRecord, type SSOSession } from '../../handshake/types'
import { prepareBeapInboxSandboxClone } from '../beapInboxClonePrepare'

const { listAvailableInternalSandboxes, getHandshakeRecord } = vi.hoisted(() => ({
  listAvailableInternalSandboxes: vi.fn(),
  getHandshakeRecord: vi.fn(),
}))

vi.mock('../../handshake/internalSandboxesApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../handshake/internalSandboxesApi')>()
  return { ...mod, listAvailableInternalSandboxes }
})

vi.mock('../../handshake/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../handshake/db')>()
  return { ...mod, getHandshakeRecord }
})

function makeSession(): SSOSession {
  return {
    wrdesk_user_id: 'u-regression',
    email: 'h@example.com',
    sub: 'sub-1',
    iss: 'iss',
    email_verified: true,
    plan: 'free',
    currentHardwareAttestation: null,
    currentDnsVerification: null,
  } as SSOSession
}

function makeHandshakeRecord(id: string): HandshakeRecord {
  return {
    handshake_id: id,
    state: HandshakeState.ACTIVE,
    handshake_type: 'internal',
    relationship_id: 'rel-1',
    local_role: 'initiator',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    internal_coordination_identity_complete: true,
    p2p_endpoint: 'p2p://sandbox-target',
    local_x25519_public_key_b64: 'bG9jYWx4MjU1MTk=',
    peer_x25519_public_key_b64: 'cGVlcngyNTUxOQ==',
    peer_mlkem768_public_key_b64: 'bWxrZW0xMjM=',
    initiator: { wrdesk_user_id: 'u-regression' },
    acceptor: { wrdesk_user_id: 'u-regression' },
    internal_peer_pairing_code: '123456',
  } as HandshakeRecord
}

function makeEligibleEntry(over: Partial<InternalSandboxListEntry> = {}): InternalSandboxListEntry {
  return {
    handshake_id: 'hs-sbx-1',
    relationship_id: 'rel-1',
    state: 'ACTIVE',
    peer_role: 'sandbox',
    peer_label: 'Sandbox',
    peer_device_id: 'dev-sb',
    peer_device_name: 'Test Sandbox',
    peer_pairing_code_six: '123456',
    internal_coordination_identity_complete: true,
    p2p_endpoint_set: true,
    last_known_delivery_status: 'idle',
    live_status_optional: 'relay_connected',
    sandbox_keying_complete: true,
    beap_clone_eligible: true,
    ...over,
  }
}

function makeInboxDb(row: Record<string, unknown> | undefined) {
  return {
    prepare: (_sql: string) => ({
      get: (id: string) => (row && String(row.id) === String(id) ? row : undefined),
    }),
  }
}

describe('prepareBeapInboxSandboxClone', () => {
  const session = makeSession()
  const allowed = new Set<string>(['acc-1'])

  beforeEach(() => {
    listAvailableInternalSandboxes.mockReset()
    getHandshakeRecord.mockReset()
  })

  function mockHappyList(entries: InternalSandboxListEntry[]) {
    listAvailableInternalSandboxes.mockReturnValue({
      success: true,
      sandboxes: entries,
      incomplete: [],
      sandbox_availability: {
        status: entries.some((e) => e.beap_clone_eligible) ? 'connected' : 'not_configured',
        relay_connected: true,
        use_coordination: true,
      },
    })
  }

  test('13: direct_beap with body_text succeeds and returns clone_reason sandbox_test', () => {
    const row = {
      id: 'm-direct',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'S',
      body_text: 'Extractable public body for clone.',
      depackaged_json: null,
      has_attachments: 0,
      from_address: 'from@x.com',
      account_id: P2P_BEAP_INBOX_ACCOUNT_ID,
      received_at: '2020-01-01T00:00:00.000Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry({ handshake_id: 'hs-sbx-1' })])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-1'))
    const db = makeInboxDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-direct', undefined, 'tag', allowed)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.source_type).toBe('direct_beap')
      expect(r.clone_reason).toBe('sandbox_test')
      expect(r.encrypted_text).toContain('Extractable')
    }
  })

  test('13: email_beap with beap_qbeap_decrypted depackaging succeeds', () => {
    const dep = JSON.stringify({
      format: 'beap_qbeap_decrypted',
      transport_plaintext: 'Public',
      body: 'Secret body',
    })
    const row = {
      id: 'm-email',
      source_type: 'email_beap',
      handshake_id: 'hs-orig',
      subject: 'Subj',
      body_text: '',
      depackaged_json: dep,
      has_attachments: 0,
      from_address: 'from@x.com',
      account_id: 'acc-1',
      received_at: '2020-01-01T00:00:00.000Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry({ handshake_id: 'hs-sbx-1' })])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-1'))
    const db = makeInboxDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-email', undefined, null, allowed)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.source_type).toBe('email_beap')
      expect(r.encrypted_text).toContain('Secret')
    }
  })

  test('13: empty body and no depack returns SOURCE_NO_EXTRACTABLE_CONTENT with actionable error', () => {
    const row = {
      id: 'm-empty',
      source_type: 'email_beap',
      handshake_id: 'hs-orig',
      subject: 'S',
      body_text: '',
      depackaged_json: null,
      has_attachments: 0,
      from_address: 'from@x.com',
      account_id: 'acc-1',
      received_at: '2020-01-01T00:00:00.000Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-1'))
    const db = makeInboxDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-empty', undefined, null, allowed)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('SOURCE_NO_EXTRACTABLE_CONTENT')
      expect(r.error.toLowerCase()).toMatch(/extract|decrypt|content|merge|pending/)
    }
  })

  test('rejects depackaged outbound qBEAP row', () => {
    const row = {
      id: 'm-out',
      source_type: 'email_beap',
      handshake_id: 'hs-orig',
      subject: 'S',
      body_text: 'x',
      depackaged_json: JSON.stringify({ format: 'beap_qbeap_outbound' }),
      has_attachments: 0,
      from_address: 'from@x.com',
      account_id: 'acc-1',
      received_at: '2020-01-01T00:00:00.000Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    const db = makeInboxDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-out', undefined, null, allowed)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('SOURCE_NOT_RECEIVED_BEAP')
  })

  test('rejects non-BEAP source_type when set', () => {
    const row = {
      id: 'm-plain',
      source_type: 'email_plain',
      beap_package_json: null,
      handshake_id: null,
      subject: 'S',
      body_text: 'plain body',
      depackaged_json: null,
      has_attachments: 0,
      from_address: 'from@x.com',
      account_id: 'acc-1',
      received_at: '2020-01-01T00:00:00.000Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    const db = makeInboxDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-plain', undefined, null, allowed)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('SOURCE_NOT_RECEIVED_BEAP')
  })

  test('email_plain with beap_package_json is accepted as received BEAP for prepare', () => {
    const row = {
      id: 'm-ep-pkg',
      source_type: 'email_plain',
      beap_package_json: '{"wire":true}',
      handshake_id: null,
      subject: 'S',
      body_text: 'body for clone path',
      depackaged_json: null,
      has_attachments: 0,
      from_address: 'from@x.com',
      account_id: 'acc-1',
      received_at: '2020-01-01T00:00:00.000Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry({ handshake_id: 'hs-sbx-1' })])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-1'))
    const db = makeInboxDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-ep-pkg', undefined, null, allowed)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.source_type).toBe('email_plain')
      expect(r.encrypted_text).toContain('body for clone')
    }
  })

  test('NO_SANDBOX_CONNECTED when no eligible internal sandboxes', () => {
    const row = {
      id: 'm-1',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'S',
      body_text: 'ok',
      depackaged_json: null,
      has_attachments: 0,
      from_address: 'from@x.com',
      account_id: P2P_BEAP_INBOX_ACCOUNT_ID,
      received_at: '2020-01-01T00:00:00.000Z',
      ingested_at: null,
    }
    listAvailableInternalSandboxes.mockReturnValue({
      success: true,
      sandboxes: [makeEligibleEntry({ beap_clone_eligible: false, live_status_optional: 'relay_disconnected' })],
      incomplete: [],
      sandbox_availability: { status: 'exists_but_offline', relay_connected: false, use_coordination: true },
    })
    const db = makeInboxDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-1', undefined, null, allowed)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NO_SANDBOX_CONNECTED')
  })

  test('TARGET_HANDSHAKE_REQUIRED when two eligible sandboxes and no target id', () => {
    const row = {
      id: 'm-2',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'S',
      body_text: 'ok',
      depackaged_json: null,
      has_attachments: 0,
      from_address: 'from@x.com',
      account_id: P2P_BEAP_INBOX_ACCOUNT_ID,
      received_at: '2020-01-01T00:00:00.000Z',
      ingested_at: null,
    }
    mockHappyList([
      makeEligibleEntry({ handshake_id: 'hs-a' }),
      makeEligibleEntry({ handshake_id: 'hs-b', peer_device_id: 'd2' }),
    ])
    const db = makeInboxDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-2', undefined, null, allowed)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('TARGET_HANDSHAKE_REQUIRED')
  })
})
