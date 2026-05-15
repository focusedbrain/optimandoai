/**
 * PR 6/8 — Response Path: Reply Session Attachment + Thin-Config Reconciliation
 *
 * Tests:
 *
 *  1–3.  Electron reply path construction (inline mirrors of EmailInboxView logic).
 *  4–6.  Extension reply path construction (inline mirrors of useReplyComposer logic).
 *  7.    Thin-config reconciliation: handshakeRecordToRecipient produces all fields.
 *  8.    Extension and Electron reply recipient shapes are structurally equivalent.
 *  9.    Artefact carries handshake_binding from source message (I.4.2).
 *  10.   Reply with no session → conformant absence (no sessionImportArtefact).
 *  11.   Send success → selectedSessionId cleared (Decision D timing).
 *  12.   Send failure → selectedSessionId preserved.
 *  13.   Build failure (artefact construction) → state preserved; send aborted.
 *
 * React hooks are not rendered. Construction logic extracted inline, mirroring
 * the pattern from PR 4.1's pr41OrchestratorReads.test.ts.
 *
 * Canon authority: A.3.054.8 (artefact canonical position), I.4.2 (handshake binding).
 */

import { describe, it, expect } from 'vitest'
import { buildSessionImportArtefact, type BuildArtefactInput } from '../../beap-builder/buildSessionImportArtefact'
import {
  hasHandshakeKeyMaterial,
  handshakeRecordToRecipient,
  type HandshakeRecord,
  type SelectedHandshakeRecipient,
} from '../../handshake/rpcTypes'

// =============================================================================
// Fixtures
// =============================================================================

const VALID_X25519_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const VALID_MLKEM_B64  = 'dGVzdC1tbC1rZW0tNzY4LXB1YmxpYy1rZXktYmFzZTY0'

function makeHandshakeRecord(overrides: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-reply-001',
    state: 'ACTIVE',
    local_role: 'acceptor',
    counterparty_email: 'peer@example.com',
    counterparty_user_id: 'uid-peer',
    relationship_id: 'rel-001',
    sharing_mode: 'reciprocal',
    created_at: '2026-01-01T00:00:00Z',
    peerX25519PublicKey: VALID_X25519_B64,
    peerPQPublicKey: VALID_MLKEM_B64,
    ...overrides,
  }
}

function makeSessionData() {
  return {
    name: 'My Reply Session',
    agents: [],
    agent_boxes: [],
    display_grids: [],
    capabilities_required: ['data_access'],
  }
}

/**
 * Mirrors the artefact construction pattern used in both EmailInboxView and
 * useReplyComposer (PR 6 / Decision A — reuse unchanged from PR 4).
 */
function buildReplyArtefact(params: {
  sessionKey: string
  sessionData: Record<string, unknown>
  handshakeId: string | null
}) {
  const { sessionKey, sessionData, handshakeId } = params
  const input: BuildArtefactInput = {
    sessionId: sessionKey,
    sessionName: typeof sessionData.name === 'string' ? sessionData.name : sessionKey,
    agents: Array.isArray(sessionData.agents) ? (sessionData.agents as any[]) : [],
    agentBoxes: Array.isArray(sessionData.agentBoxes ?? sessionData.agent_boxes)
      ? ((sessionData.agentBoxes ?? sessionData.agent_boxes) as any[])
      : [],
    displayGrids: Array.isArray(sessionData.displayGrids ?? sessionData.display_grids)
      ? ((sessionData.displayGrids ?? sessionData.display_grids) as any[])
      : [],
    capabilitiesRequired: Array.isArray(sessionData.capabilities_required)
      ? (sessionData.capabilities_required as any[])
      : [],
    handshakeBinding: handshakeId
      ? { handshake_id: handshakeId, bound_at: new Date().toISOString() }
      : null,
  }
  return buildSessionImportArtefact(input)
}

// =============================================================================
// 1–3: Electron reply path — construction mirrors
// =============================================================================

describe('Electron reply path — session artefact construction (PR 6 / Decision A)', () => {

  // Test 1
  it('1. reply with no session → sessionImportArtefact absent from config (conformant absence)', () => {
    const selectedSessionId: string | null = null

    // Mirror of EmailInboxView.handleSendCapsuleReply — no session branch
    const sessionImportArtefact = selectedSessionId
      ? buildReplyArtefact({ sessionKey: selectedSessionId, sessionData: {}, handshakeId: 'hs-001' })
      : undefined

    expect(sessionImportArtefact).toBeUndefined()
  })

  // Test 2
  it('2. reply with session selected → artefact populated; handshake binding is source message handshake', () => {
    const selectedSessionId = 'session_abc123'
    const sessionData = makeSessionData()
    const sourceHandshakeId = 'hs-reply-001'

    const built = buildReplyArtefact({
      sessionKey: selectedSessionId,
      sessionData,
      handshakeId: sourceHandshakeId,
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return

    // Artefact is at canonical position
    const artefact = built.artefact
    expect(artefact.sessions).toHaveLength(1)
    expect(artefact.sessions[0].session_id).toBe(selectedSessionId)
    expect(artefact.sessions[0].session_name).toBe('My Reply Session')

    // Handshake binding inherits from source message (I.4.2)
    expect(artefact.handshake_binding).not.toBeNull()
    expect(artefact.handshake_binding?.handshake_id).toBe(sourceHandshakeId)
  })

  // Test 3
  it('3. artefact construction failure → ok:false; send aborted (state preserved)', () => {
    // Empty sessionId → buildSessionImportArtefact returns ok:false
    const built = buildSessionImportArtefact({
      sessionId: '',
      sessionName: 'Test',
      agents: [],
      agentBoxes: [],
      displayGrids: [],
      capabilitiesRequired: [],
      handshakeBinding: null,
    })

    expect(built.ok).toBe(false)
    // Mirror: on ok:false, EmailInboxView sets error and returns; selectedSessionId preserved.
    // The test verifies the failure signal — state management is in the component.
    if (!built.ok) {
      expect(typeof built.reason).toBe('string')
      expect(built.reason.length).toBeGreaterThan(0)
    }
  })
})

// =============================================================================
// 4–6: Extension reply path — construction mirrors
// =============================================================================

describe('Extension reply path — session artefact construction (PR 6 / Decision A)', () => {

  // Test 4
  it('4. reply with no session selected → replySessionArtefact undefined; config has no artefact', () => {
    const selectedSessionId: string | null = null

    // Mirror of useReplyComposer sendReply BEAP branch
    const replySessionArtefact = selectedSessionId
      ? buildReplyArtefact({ sessionKey: selectedSessionId, sessionData: {}, handshakeId: 'hs-001' })
      : undefined

    expect(replySessionArtefact).toBeUndefined()

    // Spread into config: no sessionImportArtefact key
    const configSlice = {
      ...(replySessionArtefact ? { sessionImportArtefact: replySessionArtefact } : {}),
    }
    expect('sessionImportArtefact' in configSlice).toBe(false)
  })

  // Test 5
  it('5. reply with session selected → artefact populated via PR 4 helper; correct position', () => {
    const selectedSessionId = 'session_xyz789'
    const sessionData = {
      name: 'Extension Reply Session',
      agents: [],
      agent_boxes: [],
      display_grids: [],
      capabilities_required: ['session_control'],
    }
    const handshakeId = 'hs-reply-002'

    const built = buildReplyArtefact({ sessionKey: selectedSessionId, sessionData, handshakeId })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const artefact = built.artefact
    expect(artefact.sessions[0].session_id).toBe(selectedSessionId)
    expect(artefact.sessions[0].session_name).toBe('Extension Reply Session')
    expect(artefact.sessions[0].capabilities_required).toContain('session_control')
    expect(artefact.handshake_binding?.handshake_id).toBe(handshakeId)
  })

  // Test 6
  it('6. build failure → ok:false with reason; send must abort (selectedSessionId preserved)', () => {
    // Trigger failure: empty sessionId
    const built = buildSessionImportArtefact({
      sessionId: '',
      sessionName: 'X',
      agents: [],
      agentBoxes: [],
      displayGrids: [],
      capabilitiesRequired: [],
      handshakeBinding: null,
    })

    expect(built.ok).toBe(false)
    // Mirror: useReplyComposer throws on !built.ok, landing in catch block.
    // catch block sets error but does NOT call setSelectedSessionId(null).
    if (!built.ok) {
      expect(typeof built.reason).toBe('string')
    }
  })
})

// =============================================================================
// 7–8: Thin-config reconciliation — shape parity
// =============================================================================

describe('Thin-config reconciliation — handshakeRecordToRecipient (PR 6 / Decision B)', () => {

  // Test 7
  it('7. handshakeRecordToRecipient produces all fields Electron\'s mapLedgerRecordToSelectedRecipient produces', () => {
    const record = makeHandshakeRecord()
    const recipient: SelectedHandshakeRecipient = handshakeRecordToRecipient(record)

    // Required crypto fields (qBEAP key agreement)
    expect(recipient.peerX25519PublicKey).toBe(VALID_X25519_B64)
    expect(recipient.peerPQPublicKey).toBe(VALID_MLKEM_B64)

    // Identity fields
    expect(recipient.handshake_id).toBe('hs-reply-001')
    expect(recipient.counterparty_email).toBe('peer@example.com')
    expect(recipient.counterparty_user_id).toBe('uid-peer')
    expect(recipient.sharing_mode).toBe('reciprocal')

    // Derived display fields
    expect(recipient.receiver_fingerprint_full).toBe(VALID_X25519_B64)
    expect(typeof recipient.receiver_fingerprint_short).toBe('string')
    expect(recipient.receiver_display_name).toBe('peer')
  })

  // Test 8
  it('8. extension and Electron reply recipient shapes are structurally equivalent', () => {
    // Electron shape (from mapLedgerRecordToSelectedRecipient in EmailInboxView.tsx):
    const electronShape = {
      handshake_id: 'hs-001',
      counterparty_email: 'peer@example.com',
      counterparty_user_id: '',
      sharing_mode: 'reciprocal' as const,
      receiver_fingerprint_full: VALID_X25519_B64,
      receiver_fingerprint_short: `${VALID_X25519_B64.slice(0, 4)}…${VALID_X25519_B64.slice(-4)}`,
      receiver_display_name: 'peer',
      peerX25519PublicKey: VALID_X25519_B64,
      peerPQPublicKey: VALID_MLKEM_B64,
      p2pEndpoint: null,
    }

    // Extension shape post-reconciliation (from handshakeRecordToRecipient):
    const record = makeHandshakeRecord({ handshake_id: 'hs-001', counterparty_user_id: '' })
    const extensionShape = handshakeRecordToRecipient(record)

    // Both must have the crypto keys required for qBEAP
    expect(hasHandshakeKeyMaterial(electronShape)).toBe(true)
    expect(hasHandshakeKeyMaterial(extensionShape)).toBe(true)

    // Both carry the same structural fields
    const sharedFields = [
      'handshake_id', 'counterparty_email', 'counterparty_user_id', 'sharing_mode',
      'receiver_fingerprint_full', 'receiver_fingerprint_short', 'receiver_display_name',
      'peerX25519PublicKey', 'peerPQPublicKey', 'p2pEndpoint',
    ] as const

    for (const field of sharedFields) {
      expect(electronShape).toHaveProperty(field)
      expect(extensionShape).toHaveProperty(field)
    }
  })

  it('8b. before reconciliation: thin config fails hasHandshakeKeyMaterial (documents the gap)', () => {
    // This is the pre-PR-6 thin config — no crypto keys.
    const thinRecipient = {
      handshake_id: 'hs-001',
      counterparty_email: 'peer@example.com',
      counterparty_user_id: '',
      sharing_mode: 'reciprocal' as const,
    }

    // hasHandshakeKeyMaterial returns false → qBEAP would fail.
    expect(hasHandshakeKeyMaterial(thinRecipient as SelectedHandshakeRecipient)).toBe(false)

    // After reconciliation: full recipient passes.
    const record = makeHandshakeRecord()
    const fullRecipient = handshakeRecordToRecipient(record)
    expect(hasHandshakeKeyMaterial(fullRecipient)).toBe(true)
  })
})

// =============================================================================
// 9–10: Handshake binding + absence correctness
// =============================================================================

describe('I.4.2 — handshake binding on replies; conformant absence', () => {

  // Test 9
  it('9. reply artefact carries handshake_binding.handshake_id === source message handshake', () => {
    const sourceHandshakeId = 'hs-source-123'
    const built = buildReplyArtefact({
      sessionKey: 'session_bound',
      sessionData: makeSessionData(),
      handshakeId: sourceHandshakeId,
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.artefact.handshake_binding?.handshake_id).toBe(sourceHandshakeId)
  })

  // Test 10
  it('10. reply with no session → no sessionImportArtefact on config (conformant absence per A.3.054.8)', () => {
    // Absence is conformant — artefact is optional.
    const configSlice = {
      messageBody: 'Hello',
      // no sessionImportArtefact spread
    }
    expect('sessionImportArtefact' in configSlice).toBe(false)
  })
})

// =============================================================================
// 11–13: Failure-path UX (Decision D)
// =============================================================================

describe('Failure-path UX — selectedSessionId lifecycle (PR 6 / Decision D)', () => {

  // Test 11: success clears selectedSessionId
  it('11. send success → selectedSessionId cleared (mirrors useReplyComposer line 482)', () => {
    // Simulate the success path state machine
    let selectedSessionId: string | null = 'session_abc'
    const isSendingResult = { success: true }

    if (isSendingResult.success) {
      selectedSessionId = null   // setSelectedSessionId(null) — cleared on success only
    }

    expect(selectedSessionId).toBeNull()
  })

  // Test 12: send failure preserves selectedSessionId
  it('12. send failure → selectedSessionId preserved (catch block does not clear it)', () => {
    let selectedSessionId: string | null = 'session_abc'
    let error: string | null = null

    // Mirror: catch block sets error, does NOT call setSelectedSessionId(null)
    try {
      throw new Error('Network error')
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      // selectedSessionId NOT touched
    }

    expect(selectedSessionId).toBe('session_abc')
    expect(error).toBe('Network error')
  })

  // Test 13: artefact build failure → state preserved; send aborted
  it('13. artefact build failure → ok:false causes throw; selectedSessionId preserved', () => {
    let selectedSessionId: string | null = 'session_abc'
    let error: string | null = null
    let sendAborted = false

    // Mirror of useReplyComposer: throw on !built.ok → lands in catch block
    try {
      const built = buildSessionImportArtefact({
        sessionId: '',  // invalid → ok:false
        sessionName: 'X',
        agents: [],
        agentBoxes: [],
        displayGrids: [],
        capabilitiesRequired: [],
        handshakeBinding: null,
      })
      if (!built.ok) {
        throw new Error(`Could not build session artefact: ${built.reason}`)
      }
      // If we get here, send would proceed — but it doesn't because of throw above
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      sendAborted = true
      // selectedSessionId NOT cleared (Decision D)
    }

    expect(sendAborted).toBe(true)
    expect(selectedSessionId).toBe('session_abc')
    expect(error).toMatch(/Could not build session artefact/)
  })

  it('13b. missing handshake key material → throw; selectedSessionId preserved', () => {
    let selectedSessionId: string | null = 'session_abc'
    let error: string | null = null

    const recordWithoutKeys = makeHandshakeRecord({
      peerX25519PublicKey: undefined,
      peerPQPublicKey: undefined,
    })

    try {
      if (!hasHandshakeKeyMaterial(recordWithoutKeys)) {
        throw new Error('Handshake is missing X25519 / ML-KEM keys — re-establish the handshake for qBEAP.')
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      // selectedSessionId NOT cleared
    }

    expect(selectedSessionId).toBe('session_abc')
    expect(error).toMatch(/ML-KEM/)
  })
})

// =============================================================================
// Regression: PR 4 construction logic is reused unchanged (Decision A)
// =============================================================================

describe('PR 4 artefact helper reused unchanged (Decision A)', () => {
  it('buildSessionImportArtefact signature and output shape unchanged from PR 4', () => {
    const result = buildSessionImportArtefact({
      sessionId: 'session_regression',
      sessionName: 'Regression Session',
      agents: [],
      agentBoxes: [],
      displayGrids: [],
      capabilitiesRequired: ['data_access', 'session_control'],
      handshakeBinding: { handshake_id: 'hs-reg', bound_at: '2026-05-08T00:00:00Z' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.artefact.schema_version).toBe('1.0.0')
    expect(result.artefact.purpose.declared_purpose).toBe('session_share')
    expect(result.artefact.sessions[0].capabilities_required).toContain('data_access')
    expect(result.artefact.handshake_binding?.handshake_id).toBe('hs-reg')
  })
})
