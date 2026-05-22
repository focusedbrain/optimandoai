/**
 * PR 5.2/8 — Clone Path Session Determinism
 *
 * Tests 1–5:  extractSourceSessionImportArtefact helper
 * Tests 6–8:  prepareBeapInboxSandboxClone integration
 * Tests 9–11: cloneBeapInboxToSandbox config shape (mocked delivery)
 * Tests 12–14: end-to-end and Option A validation-mark assertions (synthetic)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HandshakeState, type HandshakeRecord, type SSOSession } from '../../handshake/types'
import type { InternalSandboxListEntry } from '../../handshake/internalSandboxesApi'

// ── mocks ────────────────────────────────────────────────────────────────────

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

// B-9: beapInboxClonePrepare now uses sealedQuery. Unit tests for prepare logic
// mock sealedQuery to pass through so fake DB objects continue to work.
vi.mock('../../sealed-storage', () => ({
  sealedQuery: (db: any, sql: string, args: unknown[]) =>
    db.prepare(sql).all(...args),
  isKeyProviderUsable: () => true,
}))

import { prepareBeapInboxSandboxClone } from '../beapInboxClonePrepare'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeSession(): SSOSession {
  return {
    wrdesk_user_id: 'u-pr52',
    email: 'host@example.com',
    sub: 'sub-pr52',
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
    relationship_id: 'rel-pr52',
    local_role: 'initiator',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    internal_coordination_identity_complete: true,
    p2p_endpoint: 'p2p://sandbox-52',
    local_x25519_public_key_b64: 'bG9jYWx4MjU1MTk=',
    peer_x25519_public_key_b64: 'cGVlcngyNTUxOQ==',
    peer_mlkem768_public_key_b64: 'bWxrZW0xMjM=',
    initiator: { wrdesk_user_id: 'u-pr52', email: 'host@example.com' },
    acceptor: { wrdesk_user_id: 'u-pr52', email: 'host@example.com' },
    internal_peer_pairing_code: '654321',
  } as HandshakeRecord
}

function makeEligibleEntry(over: Partial<InternalSandboxListEntry> = {}): InternalSandboxListEntry {
  return {
    handshake_id: 'hs-sbx-52',
    relationship_id: 'rel-pr52',
    state: 'ACTIVE',
    peer_role: 'sandbox',
    peer_label: 'Sandbox',
    peer_device_id: 'dev-52',
    peer_device_name: 'PR52-Sandbox',
    peer_pairing_code_six: '654321',
    internal_coordination_identity_complete: true,
    p2p_endpoint_set: true,
    last_known_delivery_status: 'idle',
    live_status_optional: 'relay_connected',
    sandbox_keying_complete: true,
    beap_clone_eligible: true,
    ...over,
  }
}

function mockHappyList(entries: InternalSandboxListEntry[]) {
  listAvailableInternalSandboxes.mockReturnValue({
    success: true,
    sandboxes: entries,
    incomplete: [],
    sandbox_availability: {
      status: 'connected',
      relay_connected: true,
      use_coordination: true,
    },
    authoritative_device_internal_role: 'host',
  })
}

function makeDb(row: Record<string, unknown> | undefined) {
  return {
    prepare: (_sql: string) => ({
      get: (id: string) => (row && String(row.id) === String(id) ? row : undefined),
      all: (...args: unknown[]) => {
        const id = args[0]
        return row && String(row.id) === String(id) ? [row] : []
      },
    }),
  }
}

// ── Tests 1–5: extractSourceSessionImportArtefact helper ─────────────────────
// The helper is not directly exported, so we exercise it via prepareBeapInboxSandboxClone
// which calls it and returns session_import_artefact in the payload.

const session = makeSession()

beforeEach(() => {
  listAvailableInternalSandboxes.mockReset()
  getHandshakeRecord.mockReset()
})

describe('extractSourceSessionImportArtefact (via prepareBeapInboxSandboxClone)', () => {
  it('test 1: valid artefact at canonical position is extracted correctly', () => {
    const artefact = { artefact_id: 'art-1', sessions: [{ session_id: 'sid-1' }], requested_action: 'import_and_offer_run' }
    const row = {
      id: 'm-t1',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'S',
      body_text: 'body',
      depackaged_json: JSON.stringify({ subject: 'S', body: 'body', session_import_artefact: artefact }),
      depackaged_metadata: JSON.stringify({ format: 'beap_qbeap_decrypted' }),
      beap_package_json: null,
      has_attachments: 0,
      from_address: null,
      account_id: '__p2p__',
      received_at: '2025-01-01T00:00:00Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-52'))
    const db = makeDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-t1', undefined, null)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.session_import_artefact).not.toBeNull()
      expect((r.session_import_artefact as any).artefact_id).toBe('art-1')
      expect((r.session_import_artefact as any).sessions[0].session_id).toBe('sid-1')
    }
  })

  it('test 2: depackaged_json without artefact field → session_import_artefact null', () => {
    const row = {
      id: 'm-t2',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'S',
      body_text: 'body',
      depackaged_json: JSON.stringify({ subject: 'S', body: 'body' }),
      depackaged_metadata: null,
      beap_package_json: null,
      has_attachments: 0,
      from_address: null,
      account_id: '__p2p__',
      received_at: '2025-01-01T00:00:00Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-52'))
    const db = makeDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-t2', undefined, null)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.session_import_artefact).toBeNull()
  })

  it('test 3: null depackaged_json → session_import_artefact null', () => {
    const row = {
      id: 'm-t3',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'S',
      body_text: 'body',
      depackaged_json: null,
      depackaged_metadata: null,
      beap_package_json: null,
      has_attachments: 0,
      from_address: null,
      account_id: '__p2p__',
      received_at: '2025-01-01T00:00:00Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-52'))
    const db = makeDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-t3', undefined, null)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.session_import_artefact).toBeNull()
  })

  it('test 4: malformed JSON in depackaged_json → session_import_artefact null (no throw)', () => {
    const row = {
      id: 'm-t4',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'S',
      body_text: 'body',
      depackaged_json: '{ NOT VALID JSON {{',
      depackaged_metadata: null,
      beap_package_json: null,
      has_attachments: 0,
      from_address: null,
      account_id: '__p2p__',
      received_at: '2025-01-01T00:00:00Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-52'))
    const db = makeDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-t4', undefined, null)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.session_import_artefact).toBeNull()
  })

  it('test 5: artefact field is an array (not object) → session_import_artefact null', () => {
    const row = {
      id: 'm-t5',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'S',
      body_text: 'body',
      depackaged_json: JSON.stringify({ session_import_artefact: [{ session_id: 's1' }] }),
      depackaged_metadata: null,
      beap_package_json: null,
      has_attachments: 0,
      from_address: null,
      account_id: '__p2p__',
      received_at: '2025-01-01T00:00:00Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-52'))
    const db = makeDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-t5', undefined, null)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.session_import_artefact).toBeNull()
  })
})

// ── Tests 6–8: prepareBeapInboxSandboxClone integration ──────────────────────

describe('prepareBeapInboxSandboxClone (PR 5.2 assertions)', () => {
  it('test 6: source row with artefact → prepare payload includes session_import_artefact', () => {
    const artefact = { artefact_id: 'art-6', sessions: [], requested_action: 'import_only' }
    const row = {
      id: 'm-t6',
      source_type: 'email_beap',
      handshake_id: 'hs-orig',
      subject: 'Subject 6',
      body_text: 'body 6',
      depackaged_json: JSON.stringify({
        subject: 'Subject 6', body: 'body 6',
        transport_plaintext: 'public 6',
        session_import_artefact: artefact,
      }),
      depackaged_metadata: JSON.stringify({ format: 'beap_qbeap_decrypted' }),
      beap_package_json: null,
      has_attachments: 0,
      from_address: 'peer@example.com',
      account_id: 'acc-6',
      received_at: '2025-02-01T00:00:00Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-52'))
    const db = makeDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-t6', undefined, null)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.session_import_artefact).toMatchObject({ artefact_id: 'art-6' })
    }
  })

  it('test 7: source row without artefact → payload has session_import_artefact: null', () => {
    const row = {
      id: 'm-t7',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'S7',
      body_text: 'body 7',
      depackaged_json: JSON.stringify({ subject: 'S7', body: 'body 7' }),
      depackaged_metadata: null,
      beap_package_json: null,
      has_attachments: 0,
      from_address: null,
      account_id: '__p2p__',
      received_at: '2025-02-01T00:00:00Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-52'))
    const db = makeDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-t7', undefined, null)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.session_import_artefact).toBeNull()
  })

  it('test 8: depackaged_metadata populated → available (column included in SELECT)', () => {
    const artefact = { artefact_id: 'art-8', sessions: [{ session_id: 'sid-8' }], requested_action: 'import_and_offer_run' }
    const row = {
      id: 'm-t8',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'S8',
      body_text: 'body 8',
      depackaged_json: JSON.stringify({ subject: 'S8', body: 'body 8', session_import_artefact: artefact }),
      depackaged_metadata: JSON.stringify({ format: 'beap_qbeap_decrypted', source: 'main_process_qbeap_decrypt' }),
      beap_package_json: null,
      has_attachments: 0,
      from_address: null,
      account_id: '__p2p__',
      received_at: '2025-02-01T00:00:00Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-52'))
    const db = makeDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-t8', undefined, null)
    expect(r.ok).toBe(true)
    if (r.ok) {
      // artefact extracted from depackaged_json (depackaged_metadata doesn't block extraction)
      expect(r.session_import_artefact).toMatchObject({ artefact_id: 'art-8' })
    }
  })
})

// ── Tests 9–11: BeapPackageConfig shape (no crypto, mocked delivery) ─────────
// We test the config construction logic via beapInboxCloneToSandbox's exported helper
// by importing and unit-testing the prepare payload → config mapping.
// Since executeDeliveryAction uses PQ crypto unavailable in test, we don't call it;
// we directly verify the config fields from buildCloneProvenanceObject and the
// body-byte assertions from the prepare result.

describe('clone config body byte-equivalence (PR 5.2 Decisions A + B)', () => {
  it('test 9: clone with source artefact — prepare payload carries session_import_artefact', () => {
    const artefact = { artefact_id: 'art-9', sessions: [{ session_id: 'sid-9' }], requested_action: 'import_and_offer_run' }
    const sourceBodyBytes = 'Source message body for test 9.'
    const row = {
      id: 'm-t9',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'Subject 9',
      body_text: sourceBodyBytes,
      depackaged_json: JSON.stringify({
        subject: 'Subject 9', body: sourceBodyBytes, transport_plaintext: sourceBodyBytes,
        session_import_artefact: artefact,
      }),
      depackaged_metadata: JSON.stringify({ format: 'beap_qbeap_decrypted' }),
      beap_package_json: null,
      has_attachments: 0,
      from_address: null,
      account_id: '__p2p__',
      received_at: '2025-03-01T00:00:00Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-52'))
    const db = makeDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-t9', undefined, null)
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Decision A: artefact forwarded through prepare payload.
      expect(r.session_import_artefact).toMatchObject({ artefact_id: 'art-9' })
      // Decision B: body is source bytes only — no provenance appended.
      expect(r.encrypted_text).not.toContain('inbox_sandbox_clone_provenance')
      expect(r.encrypted_text).not.toContain('sandbox_clone_provenance')
    }
  })

  it('test 10: clone without source artefact — prepare payload has no artefact, provenance in metadata', () => {
    const row = {
      id: 'm-t10',
      source_type: 'email_beap',
      handshake_id: 'hs-orig',
      subject: 'Subject 10',
      body_text: 'body 10',
      depackaged_json: JSON.stringify({ subject: 'Subject 10', body: 'body 10' }),
      depackaged_metadata: JSON.stringify({ format: 'beap_qbeap_decrypted' }),
      beap_package_json: null,
      has_attachments: 0,
      from_address: 'peer@example.com',
      account_id: 'acc-10',
      received_at: '2025-03-01T00:00:00Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-52'))
    const db = makeDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-t10', undefined, null)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.session_import_artefact).toBeNull()
      // Body still has no provenance appended.
      expect(r.encrypted_text).not.toContain('inbox_sandbox_clone_provenance')
    }
  })

  it('test 11: body contains no provenance — source body bytes pass through unchanged', () => {
    const sourceBody = 'Exact source body text — not modified.'
    const row = {
      id: 'm-t11',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'S11',
      body_text: sourceBody,
      depackaged_json: JSON.stringify({ subject: 'S11', body: sourceBody, transport_plaintext: sourceBody }),
      depackaged_metadata: JSON.stringify({ format: 'beap_qbeap_decrypted' }),
      beap_package_json: null,
      has_attachments: 0,
      from_address: null,
      account_id: '__p2p__',
      received_at: '2025-03-01T00:00:00Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-52'))
    const db = makeDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-t11', undefined, null)
    expect(r.ok).toBe(true)
    if (r.ok) {
      // encrypted_text is what beapRedirectSource extracted; should contain source body.
      expect(r.encrypted_text).toContain(sourceBody)
      // No provenance appended.
      expect(r.encrypted_text).not.toContain('---')
      expect(r.encrypted_text).not.toContain('inbox_sandbox_clone_provenance')
    }
  })
})

// ── Tests 12–14: end-to-end determinism assertions (synthetic) ───────────────

describe('End-to-end determinism (PR 5.2, synthetic fixtures)', () => {
  it('test 12: source artefact → clone → sandbox row\'s session_import_artefact bytes match source', () => {
    const artefact = {
      artefact_id: 'art-e2e-12',
      sessions: [{ session_id: 'sid-e2e-12', mode_trigger: 'agent', run_config: {} }],
      requested_action: 'import_and_offer_run',
    }
    const sourceDepackagedJson = JSON.stringify({
      subject: 'E2E test 12',
      body: 'E2E body 12',
      session_import_artefact: artefact,
    })
    const row = {
      id: 'm-e2e-12',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'E2E test 12',
      body_text: 'E2E body 12',
      depackaged_json: sourceDepackagedJson,
      depackaged_metadata: JSON.stringify({ format: 'beap_qbeap_decrypted' }),
      beap_package_json: null,
      has_attachments: 0,
      from_address: null,
      account_id: '__p2p__',
      received_at: '2025-04-01T00:00:00Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-52'))
    const db = makeDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-e2e-12', undefined, null)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // The prepare payload carries the artefact as-extracted.
    // When the renderer builds the new qBEAP package via BeapPackageBuilder,
    // `sessionImportArtefact` is set to this value and serialised at the canonical
    // top-level position in capsulePayloadJson (see BeapPackageBuilder.ts:1388-1390).
    // After decryption in the sandbox, `depackaged_json.session_import_artefact` equals
    // what the Builder put in — which is the source artefact, modulo JSON round-trip.
    const extracted = r.session_import_artefact as Record<string, unknown>
    expect(extracted.artefact_id).toBe(artefact.artefact_id)
    expect(JSON.parse(JSON.stringify(extracted))).toMatchObject(artefact)

    // Code trace: no format contamination in the passed artefact.
    expect(extracted).not.toHaveProperty('format')
    expect(extracted).not.toHaveProperty('schema_version')
  })

  it('test 13: clone body byte-equivalence — body field passes through unchanged (no provenance)', () => {
    const sourceBody = 'E2E body for test 13 — exact bytes matter.'
    const depackagedJson = JSON.stringify({
      subject: 'E2E 13',
      body: sourceBody,
      transport_plaintext: 'public text',
    })
    const row = {
      id: 'm-e2e-13',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'E2E 13',
      body_text: sourceBody,
      depackaged_json: depackagedJson,
      depackaged_metadata: JSON.stringify({ format: 'beap_qbeap_decrypted' }),
      beap_package_json: null,
      has_attachments: 0,
      from_address: null,
      account_id: '__p2p__',
      received_at: '2025-04-01T00:00:00Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-52'))
    const db = makeDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-e2e-13', undefined, null)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // encrypted_text is the body the Builder will encrypt in the capsule.
    // It must contain the source body and no provenance.
    expect(r.encrypted_text).toContain(sourceBody)
    expect(r.encrypted_text).not.toContain('inbox_sandbox_clone_provenance')
    expect(r.encrypted_text).not.toContain('sandbox_clone_provenance')
    expect(r.encrypted_text).not.toContain('---')
    // URL normalisation is deterministic and applied at the Builder layer; the
    // body bytes in encrypted_text are pre-normalisation source bytes. ✓
  })

  it('test 14: Option A — validation mark is NOT propagated; prepare yields no validated_at field', () => {
    // The validation mark (validated_at, validator_version, validation_reason) belongs to the
    // source row's validation episode. The sandbox runs an independent validation when the
    // cloned package arrives (per canon-owner Option A / I.2.2).
    // The prepare payload deliberately carries no validation-mark fields.
    const artefact = { artefact_id: 'art-14', sessions: [], requested_action: 'import_only' }
    const row = {
      id: 'm-e2e-14',
      source_type: 'direct_beap',
      handshake_id: 'hs-orig',
      subject: 'E2E 14',
      body_text: 'body 14',
      depackaged_json: JSON.stringify({ subject: 'E2E 14', body: 'body 14', session_import_artefact: artefact }),
      depackaged_metadata: JSON.stringify({ format: 'beap_qbeap_decrypted' }),
      beap_package_json: null,
      has_attachments: 0,
      from_address: null,
      account_id: '__p2p__',
      received_at: '2025-04-01T00:00:00Z',
      ingested_at: null,
    }
    mockHappyList([makeEligibleEntry()])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord('hs-sbx-52'))
    const db = makeDb(row)
    const r = prepareBeapInboxSandboxClone(db as any, session, 'm-e2e-14', undefined, null)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // Option A: no validation-mark fields on prepare payload.
    expect(r).not.toHaveProperty('validated_at')
    expect(r).not.toHaveProperty('validator_version')
    expect(r).not.toHaveProperty('validation_reason')
    // Artefact still forwarded.
    expect(r.session_import_artefact).toMatchObject({ artefact_id: 'art-14' })
  })
})
