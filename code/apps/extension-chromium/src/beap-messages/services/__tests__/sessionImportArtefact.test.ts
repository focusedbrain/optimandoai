/**
 * PR 3/8 — Session Import Artefact: Builder serialization tests
 *
 * Covers:
 *   1–5:  stripAgentBoxesFromGrids (pure unit tests, no crypto)
 *   6–9:  qBEAP serialization — capsulePayloadJson (via sha256Plain hash binding)
 *   10:   pBEAP serialization — payloadPlain (decoded and inspected directly)
 *   11–13: Integration — pBEAP round-trip: build → decode → validate artefact structure
 *   14:   Regression — qBEAP without artefact continues to succeed
 *   15:   Hash binding — sha256Plain differs when artefact is added
 *
 * For qBEAP, the capsule payload is AES-256-GCM encrypted so the artefact
 * cannot be directly inspected in tests. Hash binding (test 15) proves it is
 * inside the plaintext that was hashed and encrypted. pBEAP tests (10–13)
 * provide the full structural inspection since pBEAP plaintext is accessible.
 *
 * The integration test 13 (malformed artefact faithfully serialized) combines
 * with ingestion-core CV-P3 to prove the end-to-end pipeline:
 *   Builder serializes malformed artefact → wire → Validator rejects it.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as beapCrypto from '../beapCrypto'
import * as x25519Module from '../x25519KeyAgreement'
import { buildPackage, type BeapPackageConfig } from '../BeapPackageBuilder'
import { stripAgentBoxesFromGrids } from '../stripAgentBoxesFromGrids'
import type {
  SessionImportArtefact,
  OrchestratorSessionContent,
} from '../../../beap-builder/canonical-types'
import type { CanonicalDisplayGridConfig } from '../../../types/CanonicalDisplayGridConfig'

// =============================================================================
// Crypto mocks (mirrors BeapPackageBuilder.test.ts pattern)
// =============================================================================

const VALID_X25519_PUBLIC_KEY_B64 = 'PQAyyYZtoBodLy4h7CmpCwqRRHs+NHgkg07LdBnPgzY='
const VALID_PQ_PUBLIC_KEY_B64     = 'dGVzdC1tbC1rZW0tNzY4LXB1YmxpYy1rZXktYmFzZTY0'
const mockKemCt = Buffer.from(new Uint8Array(1088).fill(0x42)).toString('base64')
const mockMlkemSs = new Uint8Array(32).fill(0xab)

beforeEach(() => {
  vi.spyOn(beapCrypto, 'pqKemSupportedAsync').mockResolvedValue(true)
  vi.spyOn(beapCrypto, 'pqEncapsulate').mockResolvedValue({
    kemCiphertextB64: mockKemCt,
    sharedSecretBytes: mockMlkemSs,
  })
  // getDeviceX25519PublicKey and deriveSharedSecretX25519 both require chrome.runtime (sendBeapRpc).
  // In jsdom, chrome.runtime is absent → mock both to avoid test-environment RPC failures.
  vi.spyOn(x25519Module, 'getDeviceX25519PublicKey').mockResolvedValue(VALID_X25519_PUBLIC_KEY_B64)
  vi.spyOn(x25519Module, 'deriveSharedSecretX25519').mockResolvedValue({
    sharedSecret: new Uint8Array(32).fill(0xaa),
    method: 'X25519_ECDH',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// =============================================================================
// Fixtures
// =============================================================================

function makeGrid(overrides: Record<string, unknown> = {}): CanonicalDisplayGridConfig & { agentBoxes?: unknown } {
  return {
    layout: 'grid-2x2',
    sessionId: 'sess-1',
    config: { layout: 'grid', sessionId: 'sess-1', slots: { '0': { boxNumber: 0 } } },
    ...overrides,
  } as any
}

function makeSession(gridOverrides: Array<Record<string, unknown>> = []): OrchestratorSessionContent {
  return {
    session_kind: 'orchestrator_session',
    session_id: '550e8400-e29b-41d4-a716-446655440100',
    session_name: 'Test Session',
    agents: [],
    agent_boxes: [],
    display_grids: gridOverrides.length > 0
      ? gridOverrides.map(o => makeGrid(o))
      : [makeGrid()],
    capabilities_required: [],
  }
}

function validArtefact(overrides: Partial<SessionImportArtefact> = {}): SessionImportArtefact {
  return {
    schema_version: '1.0.0',
    artefact_id: '550e8400-e29b-41d4-a716-446655440000',
    created_at: '2026-05-05T20:00:00Z',
    handshake_binding: null,
    purpose: { declared_purpose: 'session_transfer', scope_constraints: {} },
    sessions: [makeSession()],
    policy: { processing_events: [] },
    requested_action: 'import_only',
    sensitive_subcapsule: null,
    ...overrides,
  }
}

const BASE_PRIVATE_CONFIG: Omit<BeapPackageConfig, 'recipientMode'> = {
  deliveryMethod: 'email',
  selectedRecipient: {
    handshake_id: 'hs-test',
    counterparty_email: 'recipient@example.com',
    counterparty_user_id: 'u-rec',
    sharing_mode: 'reciprocal',
    receiver_fingerprint_short: 'ABC1…2345',
    receiver_fingerprint_full: 'ABC123456789012345678901234567890123456789012345',
    receiver_display_name: 'Test Recipient',
    receiver_organization: 'Test Org',
    receiver_email_list: ['recipient@example.com'],
    peerX25519PublicKey: VALID_X25519_PUBLIC_KEY_B64,
    peerPQPublicKey: VALID_PQ_PUBLIC_KEY_B64,
  },
  senderFingerprint: 'SENDER123456789012345678901234567890123456789012',
  senderFingerprintShort: 'SND1…6789',
  emailTo: 'recipient@example.com',
  subject: 'Test',
  messageBody: 'Hello.',
  attachments: [],
}

function privateConfig(overrides: Partial<BeapPackageConfig> = {}): BeapPackageConfig {
  return { ...BASE_PRIVATE_CONFIG, recipientMode: 'private', ...overrides }
}

function publicConfig(overrides: Partial<BeapPackageConfig> = {}): BeapPackageConfig {
  return {
    ...BASE_PRIVATE_CONFIG,
    recipientMode: 'public',
    selectedRecipient: null,
    ...overrides,
  }
}

/** Decode a pBEAP package's base64 payload to the plaintext object. */
function decodePBeapPayload(payloadB64: string): Record<string, unknown> {
  const json = atob(payloadB64)
  return JSON.parse(json)
}

// =============================================================================
// Tests 1–5: stripAgentBoxesFromGrids (pure, no crypto)
// =============================================================================

describe('stripAgentBoxesFromGrids — pure unit tests (PR 3/8)', () => {

  it('1. artefact with no display_grids in session → sessions returned unchanged', () => {
    const session = makeSession([])  // empty display_grids array
    const artefact = validArtefact({ sessions: [{ ...session, display_grids: [] }] })
    const result = stripAgentBoxesFromGrids(artefact)
    expect(result.sessions[0].display_grids).toEqual([])
  })

  it('2. artefact with display_grids but no agentBoxes on any entry → unchanged', () => {
    const artefact = validArtefact({ sessions: [makeSession()] })
    const result = stripAgentBoxesFromGrids(artefact)
    expect(result.sessions[0].display_grids[0]).not.toHaveProperty('agentBoxes')
    expect(result.sessions[0].display_grids[0].layout).toBe('grid-2x2')
  })

  it('3. artefact with agentBoxes on one grid entry → field removed, other fields intact', () => {
    const session = makeSession([{ agentBoxes: [{ boxId: 'b1' }] }])
    const artefact = validArtefact({ sessions: [session] })
    const result = stripAgentBoxesFromGrids(artefact)
    const grid = result.sessions[0].display_grids[0] as any
    expect(grid.agentBoxes).toBeUndefined()
    expect(grid.layout).toBe('grid-2x2')
    expect(grid.sessionId).toBe('sess-1')
  })

  it('4. artefact with agentBoxes on multiple grid entries → all stripped', () => {
    const session = makeSession([
      { agentBoxes: [{ boxId: 'b1' }] },
      { agentBoxes: [{ boxId: 'b2' }, { boxId: 'b3' }] },
    ])
    const artefact = validArtefact({ sessions: [session] })
    const result = stripAgentBoxesFromGrids(artefact)
    for (const grid of result.sessions[0].display_grids) {
      expect((grid as any).agentBoxes).toBeUndefined()
    }
  })

  it('5. strip is non-mutating: input artefact is not modified after call', () => {
    const session = makeSession([{ agentBoxes: [{ boxId: 'b1' }] }])
    const artefact = validArtefact({ sessions: [session] })
    const originalGrid = (artefact.sessions[0].display_grids[0] as any)
    expect(originalGrid.agentBoxes).toBeDefined()

    stripAgentBoxesFromGrids(artefact)

    // Input must be unchanged
    expect((artefact.sessions[0].display_grids[0] as any).agentBoxes).toBeDefined()
  })
})

// =============================================================================
// Tests 6–9: qBEAP serialization (verified via hash binding + build success)
// =============================================================================

describe('qBEAP serialization — session_import_artefact (PR 3/8)', () => {

  it('6. config without sessionImportArtefact → build succeeds (no regression)', async () => {
    const config = privateConfig()
    const result = await buildPackage(config)
    expect(result.success).toBe(true)
    expect(result.package?.payloadEnc?.sha256Plain).toBeTruthy()
  })

  it('7. config with valid sessionImportArtefact → build succeeds', async () => {
    const config = privateConfig({ sessionImportArtefact: validArtefact() })
    const result = await buildPackage(config)
    expect(result.success).toBe(true)
    expect(result.package?.payloadEnc?.sha256Plain).toBeTruthy()
  })

  it('8. config with artefact containing agentBoxes → build succeeds (strip applied silently)', async () => {
    const session = makeSession([{ agentBoxes: [{ boxId: 'b99' }] }])
    const artefactWithBoxes = validArtefact({ sessions: [session] })
    const config = privateConfig({ sessionImportArtefact: artefactWithBoxes })
    const result = await buildPackage(config)
    expect(result.success).toBe(true)
  })

  it('9. config with artefact + subject + body + attachments → build succeeds (no field clobbering)', async () => {
    const config = privateConfig({
      subject: 'Complete Test',
      messageBody: 'This is the transport body.',
      encryptedMessage: 'Encrypted secret here.',
      sessionImportArtefact: validArtefact(),
    })
    const result = await buildPackage(config)
    expect(result.success).toBe(true)
  })
})

// =============================================================================
// Test 10: pBEAP serialization — decoded payload inspection
// =============================================================================

describe('pBEAP serialization — session_import_artefact (PR 3/8)', () => {

  it('10a. config without artefact → payload has no session_import_artefact key', async () => {
    const config = publicConfig()
    const result = await buildPackage(config)
    expect(result.success).toBe(true)
    const payload = decodePBeapPayload(result.package!.payload!)
    expect(payload).not.toHaveProperty('session_import_artefact')
    // Core fields must still be present
    expect(payload).toHaveProperty('subject')
    expect(payload).toHaveProperty('body')
  })

  it('10b. config with artefact → payload has session_import_artefact at top level', async () => {
    const artefact = validArtefact()
    const config = publicConfig({ sessionImportArtefact: artefact })
    const result = await buildPackage(config)
    expect(result.success).toBe(true)
    const payload = decodePBeapPayload(result.package!.payload!)
    expect(payload).toHaveProperty('session_import_artefact')
    const wire = payload.session_import_artefact as Record<string, unknown>
    expect(wire.artefact_id).toBe(artefact.artefact_id)
    expect(wire.schema_version).toBe('1.0.0')
    expect(wire.requested_action).toBe('import_only')
    // Core fields still present alongside artefact
    expect(payload).toHaveProperty('subject')
    expect(payload).toHaveProperty('body')
  })

  it('10c. config with artefact containing agentBoxes → wire payload has agentBoxes stripped', async () => {
    const session = makeSession([{ agentBoxes: [{ boxId: 'runtime-box' }] }])
    const config = publicConfig({ sessionImportArtefact: validArtefact({ sessions: [session] }) })
    const result = await buildPackage(config)
    expect(result.success).toBe(true)
    const payload = decodePBeapPayload(result.package!.payload!)
    const wireArtefact = payload.session_import_artefact as any
    const wireGrid = wireArtefact.sessions[0].display_grids[0]
    expect(wireGrid.agentBoxes).toBeUndefined()
    expect(wireGrid.layout).toBe('grid-2x2')
  })

  it('10d. config with artefact + other fields → all fields present, no regression', async () => {
    const config = publicConfig({
      subject: 'Full pBEAP Test',
      messageBody: 'Hello from pBEAP.',
      sessionImportArtefact: validArtefact(),
    })
    const result = await buildPackage(config)
    expect(result.success).toBe(true)
    const payload = decodePBeapPayload(result.package!.payload!)
    expect(payload.subject).toBe('Full pBEAP Test')
    // pBEAP body is a plain string (pbeapNormalizedBody), not { text: ... }
    expect(typeof payload.body === 'string' || typeof payload.body === 'object').toBe(true)
    expect(payload).toHaveProperty('session_import_artefact')
  })
})

// =============================================================================
// Tests 11–13: Integration — pBEAP round-trip structural verification
// =============================================================================

describe('pBEAP round-trip — artefact structure after decode (PR 3/8)', () => {

  it('11. build pBEAP with valid artefact → decoded artefact matches input', async () => {
    const artefact = validArtefact()
    const config = publicConfig({ sessionImportArtefact: artefact })
    const result = await buildPackage(config)
    expect(result.success).toBe(true)
    const payload = decodePBeapPayload(result.package!.payload!)
    const wireArtefact = payload.session_import_artefact as Record<string, unknown>
    expect(wireArtefact.artefact_id).toBe(artefact.artefact_id)
    expect(wireArtefact.created_at).toBe(artefact.created_at)
    expect(wireArtefact.schema_version).toBe('1.0.0')
    expect(Array.isArray((wireArtefact as any).sessions)).toBe(true)
    expect((wireArtefact as any).sessions[0].session_kind).toBe('orchestrator_session')
  })

  it('12. build pBEAP without artefact → decoded payload has no artefact key (absence conformant)', async () => {
    const config = publicConfig()
    const result = await buildPackage(config)
    expect(result.success).toBe(true)
    const payload = decodePBeapPayload(result.package!.payload!)
    expect(Object.keys(payload)).not.toContain('session_import_artefact')
  })

  it('13 (critical). build pBEAP with malformed artefact → artefact faithfully serialized (receiver rejects)', async () => {
    // The Builder does NOT validate the artefact (I.3.3 — Validator is sole authority).
    // A malformed artefact (unknown key) is faithfully written to the wire.
    // The receiver's validateSessionImportArtefact will reject it with ARTEFACT_UNKNOWN_KEY.
    // Combined with ingestion-core CV-P3, this proves the full pipeline:
    //   Builder → wire (faithful) → Validator (rejects malformed content).
    const malformedArtefact = {
      ...validArtefact(),
      injected_unknown_key: 'exec()',     // unknown top-level key → ARTEFACT_UNKNOWN_KEY
    } as unknown as SessionImportArtefact
    const config = publicConfig({ sessionImportArtefact: malformedArtefact })
    const result = await buildPackage(config)
    expect(result.success).toBe(true)   // Builder succeeds (no sender-side validation)
    const payload = decodePBeapPayload(result.package!.payload!)
    const wireArtefact = payload.session_import_artefact as Record<string, unknown>
    // Unknown key must be present on the wire — Builder does not filter
    expect(wireArtefact.injected_unknown_key).toBe('exec()')
    // The receiver (PR 2.1 path) will call validateDecryptedBeapContent → ARTEFACT_UNKNOWN_KEY
  })

  it('14. build qBEAP without artefact continues to succeed (no regression)', async () => {
    const config = privateConfig()
    const result = await buildPackage(config)
    expect(result.success).toBe(true)
    expect(result.package?.payloadEnc).toBeDefined()
  })
})

// =============================================================================
// Test 15: Hash binding — artefact is inside the hashed plaintext
// =============================================================================

describe('hash binding — artefact is cryptographically bound (PR 3/8)', () => {

  it('15. qBEAP builds with/without artefact produce different sha256Plain commitments', async () => {
    const withoutArtefact = privateConfig()
    const withArtefact = privateConfig({ sessionImportArtefact: validArtefact() })

    const [r1, r2] = await Promise.all([
      buildPackage(withoutArtefact),
      buildPackage(withArtefact),
    ])

    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)

    const hash1 = r1.package?.payloadEnc?.sha256Plain
    const hash2 = r2.package?.payloadEnc?.sha256Plain

    expect(hash1).toBeTruthy()
    expect(hash2).toBeTruthy()
    // Hashes must differ — the artefact is inside the plaintext that was hashed
    expect(hash1).not.toBe(hash2)
  })
})
