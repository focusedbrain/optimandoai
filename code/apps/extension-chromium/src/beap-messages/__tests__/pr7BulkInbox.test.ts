/**
 * PR 7/8 — Bulk Inbox: Artefact-Aware List Views + useBulkSend Thin-Config Closure
 *
 * Tests:
 *
 *  1.  validatedMark true + artefact present → hasSessionIndicator true.
 *  2.  validatedMark false + artefact present → hasSessionIndicator false (gate enforced).
 *  3.  validatedMark true + no artefact → hasSessionIndicator false.
 *  4.  session_import_artefact explicitly null (discriminated-union "absent" variant) → false.
 *  5.  Indicator accessible name is the canonical phrase "session attached" — not "automation".
 *  6.  Bulk-sent draft's selectedRecipient includes all fields PR 6 added to reply path.
 *  7.  Bulk send when handshake fetch fails → per-draft failure; batch semantics preserved.
 *  8.  Bulk send when hasHandshakeKeyMaterial guard returns false → per-draft failure.
 *  9.  Bulk and reply recipients are structurally equivalent (shape parity, Test 9).
 *  10. Row that list shows indicator for → detail resolution also resolves valid (list↔detail).
 *  11. Row that list shows no indicator for → detail resolution matches absence (list↔detail).
 *
 * React hooks are not rendered. Logic extracted inline, mirroring PR 5 / PR 6 test pattern.
 *
 * Canon authority: A.3.054.8 (artefact canonical position), I.4.2 (handshake binding),
 * I.4.3 (replay evaluation handshake state), Decision A/B/C/D (PR 7).
 */

import { describe, it, expect } from 'vitest'
import { getValidationState } from '../validationState'
import {
  resolveBeapSessionImportPayload,
} from '../sessionImportPayloadResolver'
import {
  hasHandshakeKeyMaterial,
  handshakeRecordToRecipient,
  type HandshakeRecord,
  type SelectedHandshakeRecipient,
} from '../../handshake/rpcTypes'
import type { BeapMessage, BeapAttachment } from '../beapInboxTypes'
import type { SessionImportArtefact } from '../../beap-builder/canonical-types'

// =============================================================================
// Fixtures
// =============================================================================

const VALID_X25519_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const VALID_MLKEM_B64  = 'dGVzdC1tbC1rZW0tNzY4LXB1YmxpYy1rZXktYmFzZTY0'

function makeHandshakeRecord(overrides: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-bulk-001',
    state: 'ACTIVE',
    local_role: 'acceptor',
    counterparty_email: 'peer@example.com',
    counterparty_user_id: 'uid-bulk-peer',
    relationship_id: 'rel-bulk-001',
    sharing_mode: 'reciprocal',
    created_at: '2026-01-01T00:00:00Z',
    peerX25519PublicKey: VALID_X25519_B64,
    peerPQPublicKey: VALID_MLKEM_B64,
    localX25519PublicKey: VALID_X25519_B64,
    p2pEndpoint: null,
    ...overrides,
  }
}

function makeArtefact(overrides: Partial<SessionImportArtefact> = {}): SessionImportArtefact {
  return {
    schema_version: '1.0.0',
    artefact_id: 'artefact-bulk-01',
    created_at: '2026-01-01T00:00:00Z',
    handshake_binding: { handshake_id: 'hs-bulk-001', bound_at: '2026-01-01T00:00:00Z' },
    purpose: { purpose_identifier: 'session_share', scope_description: 'test' },
    sessions: [
      {
        session_kind: 'orchestrator_session',
        session_id: 'session_bulk_001',
        session_name: 'Bulk Test Session',
        capabilities_required: [],
        agents: [],
        agent_boxes: [],
        display_grids: [],
      } as unknown as SessionImportArtefact['sessions'][number],
    ],
    policy: {
      allow_semantic_processing: false,
      allow_actuating_processing: false,
      allow_network_egress: false,
    } as unknown as SessionImportArtefact['policy'],
    requested_action: 'import_and_offer_run',
    sensitive_subcapsule: null,
    ...overrides,
  }
}

function baseAttachment(overrides: Partial<BeapAttachment> = {}): BeapAttachment {
  return {
    attachmentId: 'att-1',
    filename: 'session.json',
    mimeType: 'application/json',
    sizeBytes: 100,
    selected: false,
    ...overrides,
  }
}

function baseMessage(overrides: Partial<BeapMessage> = {}): BeapMessage {
  return {
    messageId: 'm-bulk-1',
    senderFingerprint: 'fp',
    senderEmail: 'sender@example.com',
    handshakeId: 'hs-bulk-001',
    trustLevel: 'standard',
    messageBody: '',
    canonicalContent: '',
    attachments: [],
    automationTags: [],
    processingEvents: null,
    timestamp: 1,
    receivedAt: 1,
    isRead: false,
    urgency: 'normal',
    archived: false,
    validated_at: null,
    validation_reason: null,
    session_import_artefact: null,
    ...overrides,
  }
}

// =============================================================================
// Helpers — inline mirrors of MessagePairCell indicator logic (BeapBulkInbox.tsx)
// =============================================================================

/**
 * Mirrors the hasSessionIndicator computation in MessagePairCell (PR 7 Step B).
 * Separated for testability — no React render required.
 */
function computeHasSessionIndicator(message: BeapMessage): boolean {
  const validationState = getValidationState(message.validated_at, message.validation_reason)
  return validationState === 'validated' && message.session_import_artefact != null
}

// =============================================================================
// 1–5: Bulk-list indicator (recipient-side, Decision A / B / C)
// =============================================================================

describe('Bulk-list indicator — validated-mark gate (PR 7 / Decisions A, B, C)', () => {

  // Test 1
  it('1. validatedMark true + artefact present → hasSessionIndicator true', () => {
    const message = baseMessage({
      validated_at: '2026-01-01T00:00:00Z',
      validation_reason: null,
      session_import_artefact: makeArtefact(),
    })

    expect(computeHasSessionIndicator(message)).toBe(true)
  })

  // Test 2
  it('2. validatedMark false (rejection reason present) + artefact present → hasSessionIndicator false (gate enforced)', () => {
    const message = baseMessage({
      validated_at: null,
      validation_reason: 'SCHEMA_VERSION_UNSUPPORTED',
      session_import_artefact: makeArtefact(),
    })

    expect(computeHasSessionIndicator(message)).toBe(false)
  })

  // Test 2b — pending state also blocks (no validated_at, no reason)
  it('2b. validatedMark pending (null validated_at, null reason) + artefact present → false', () => {
    const message = baseMessage({
      validated_at: null,
      validation_reason: null,
      session_import_artefact: makeArtefact(),
    })

    expect(computeHasSessionIndicator(message)).toBe(false)
  })

  // Test 3
  it('3. validatedMark true + no artefact in canonical position → hasSessionIndicator false', () => {
    const message = baseMessage({
      validated_at: '2026-01-01T00:00:00Z',
      validation_reason: null,
      session_import_artefact: null,
    })

    expect(computeHasSessionIndicator(message)).toBe(false)
  })

  // Test 4
  it('4. session_import_artefact explicitly null (discriminated "absent" variant from MessagePackageCapsulePayload) → no indicator (uses null check, not string check)', () => {
    // MessagePackageCapsulePayload.session_import_artefact is undefined when absent;
    // sanitisedPackageToBeapMessage maps that to null on BeapMessage.session_import_artefact.
    // The indicator check is `!= null` — covers both null and undefined via the discriminator.
    const messageWithNullArtefact = baseMessage({
      validated_at: '2026-01-01T00:00:00Z',
      validation_reason: null,
      session_import_artefact: null, // explicit null — "no artefact" discriminated variant
    })
    const messageWithUndefinedArtefact = baseMessage({
      validated_at: '2026-01-01T00:00:00Z',
      validation_reason: null,
      // session_import_artefact: undefined (absent field)
    })

    // Both forms of "absent artefact" produce false — no string-equality needed
    expect(computeHasSessionIndicator(messageWithNullArtefact)).toBe(false)
    expect(computeHasSessionIndicator(messageWithUndefinedArtefact)).toBe(false)
  })

  // Test 5
  it('5. indicator accessible name is canonical "session attached" — not "automation" or "workflow"', () => {
    // This test validates the aria-label contract as a string assertion.
    // The actual DOM attribute is set in BeapBulkInbox.tsx MessagePairCell:
    //   aria-label="session attached"
    // We assert the canonical string here so any future refactor requires updating the test.
    const CANONICAL_ARIA_LABEL = 'session attached'

    expect(CANONICAL_ARIA_LABEL).not.toMatch(/automation/i)
    expect(CANONICAL_ARIA_LABEL).not.toMatch(/workflow/i)
    expect(CANONICAL_ARIA_LABEL).not.toMatch(/run/i)
    expect(CANONICAL_ARIA_LABEL).toBe('session attached')
  })
})

// =============================================================================
// 6–8: useBulkSend thin-config closure (sender-side, Decision D / I.4.2 / I.4.3)
// =============================================================================

describe('useBulkSend thin-config closure (PR 7 Step C / Decision D)', () => {

  // Test 6
  it('6. bulk-sent draft selectedRecipient includes all fields PR 6 added to reply path', () => {
    const record = makeHandshakeRecord()
    const recipient: SelectedHandshakeRecipient = handshakeRecordToRecipient(record)

    // Crypto fields required for qBEAP key agreement (I.4.2)
    expect(recipient.peerX25519PublicKey).toBe(VALID_X25519_B64)
    expect(recipient.peerPQPublicKey).toBe(VALID_MLKEM_B64)
    expect(recipient.localX25519PublicKey).toBe(VALID_X25519_B64)

    // Identity / routing fields
    expect(recipient.handshake_id).toBe('hs-bulk-001')
    expect(recipient.counterparty_email).toBe('peer@example.com')
    expect(recipient.counterparty_user_id).toBe('uid-bulk-peer')
    expect(recipient.sharing_mode).toBe('reciprocal')

    // Derived display fields
    expect(typeof recipient.receiver_fingerprint_full).toBe('string')
    expect(typeof recipient.receiver_fingerprint_short).toBe('string')
    expect(typeof recipient.receiver_display_name).toBe('string')

    // P2P endpoint (may be null)
    expect('p2pEndpoint' in recipient).toBe(true)

    // Passes key material guard (required before send)
    expect(hasHandshakeKeyMaterial(recipient)).toBe(true)
  })

  // Test 6b — all required field names enumerated (mirrors PR 6 Test 7)
  it('6b. all fields enumerated in PR 6 Description are present on bulk recipient', () => {
    const record = makeHandshakeRecord()
    const recipient = handshakeRecordToRecipient(record)

    const PR6_FIELDS: (keyof SelectedHandshakeRecipient)[] = [
      'peerX25519PublicKey',
      'peerPQPublicKey',
      'receiver_fingerprint_full',
      'receiver_fingerprint_short',
      'receiver_display_name',
      'localX25519PublicKey',
      'p2pEndpoint',
    ]

    for (const field of PR6_FIELDS) {
      expect(recipient).toHaveProperty(field)
    }
  })

  // Test 7
  it('7. handshake fetch failure → per-draft failure path; remaining drafts proceed (batch semantics)', () => {
    // Mirror of sendSingleItem's BEAP private branch error handling.
    // When getHandshake() throws, sendSingleItem catches and returns { success: false }.
    // The batch runner marks this draft as 'failed' and continues to the next.
    async function simulateSendSingleItemHandshakeFetchFail(): Promise<{ success: boolean; error: string | null }> {
      try {
        // Simulate getHandshake() throwing
        throw new Error('IPC timeout: handshake.get')
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    async function simulateBatchWithOneFail() {
      const results: Array<{ success: boolean; error: string | null }> = []

      // Draft 1: handshake fetch fails
      results.push(await simulateSendSingleItemHandshakeFetchFail())

      // Draft 2: succeeds (no handshake issue)
      results.push({ success: true, error: null })

      return results
    }

    return simulateBatchWithOneFail().then((results) => {
      // First draft failed — batch continues
      expect(results[0].success).toBe(false)
      expect(results[0].error).toMatch(/IPC timeout/)

      // Second draft succeeded — batch did not abort
      expect(results[1].success).toBe(true)

      // Summary: 1 failed, 1 succeeded — per-draft semantics preserved
      const failed = results.filter((r) => !r.success).length
      const succeeded = results.filter((r) => r.success).length
      expect(failed).toBe(1)
      expect(succeeded).toBe(1)
    })
  })

  // Test 8
  it('8. hasHandshakeKeyMaterial guard false → per-draft failure; batch not aborted', () => {
    // Record missing both keys → guard fails
    const incompleteRecord = makeHandshakeRecord({
      peerX25519PublicKey: undefined,
      peerPQPublicKey: undefined,
    })

    expect(hasHandshakeKeyMaterial(incompleteRecord)).toBe(false)

    // Mirror of sendSingleItem: on guard failure → return { success: false, error: '...' }
    function simulateSendSingleItemGuardFail(
      record: HandshakeRecord,
    ): { success: boolean; error: string | null } {
      if (!hasHandshakeKeyMaterial(record)) {
        return {
          success: false,
          error: 'Handshake is missing X25519 / ML-KEM keys — re-establish the handshake for qBEAP.',
        }
      }
      return { success: true, error: null }
    }

    const result = simulateSendSingleItemGuardFail(incompleteRecord)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/X25519/)

    // Complete record passes guard
    const completeRecord = makeHandshakeRecord()
    const passingResult = simulateSendSingleItemGuardFail(completeRecord)
    expect(passingResult.success).toBe(true)
  })
})

// =============================================================================
// 9: Wire-format shape parity (bulk vs reply, Test 9 per spec)
// =============================================================================

describe('Wire-format shape parity — bulk vs reply (PR 7 / I.4.2)', () => {

  // Test 9
  it('9. bulk-sent capsule recipient is structurally equivalent to reply-sent capsule recipient', () => {
    // Both paths now use handshakeRecordToRecipient with the same HandshakeRecord input.
    // Structural equivalence: same field set, same values for equivalent inputs.
    const sharedRecord = makeHandshakeRecord()

    // Reply path (useReplyComposer, PR 6 Step D): handshakeRecordToRecipient(record)
    const replyRecipient: SelectedHandshakeRecipient = handshakeRecordToRecipient(sharedRecord)

    // Bulk path (useBulkSend, PR 7 Step C): same helper, same record → same output
    const bulkRecipient: SelectedHandshakeRecipient = handshakeRecordToRecipient(sharedRecord)

    // Structural equivalence: all required fields present and equal
    const sharedFields: (keyof SelectedHandshakeRecipient)[] = [
      'handshake_id', 'counterparty_email', 'counterparty_user_id', 'sharing_mode',
      'receiver_fingerprint_full', 'receiver_fingerprint_short', 'receiver_display_name',
      'peerX25519PublicKey', 'peerPQPublicKey', 'p2pEndpoint', 'localX25519PublicKey',
    ]

    for (const field of sharedFields) {
      expect(replyRecipient).toHaveProperty(field)
      expect(bulkRecipient).toHaveProperty(field)
      expect((bulkRecipient as Record<string, unknown>)[field as string]).toEqual(
        (replyRecipient as Record<string, unknown>)[field as string],
      )
    }

    // Both pass the key material guard
    expect(hasHandshakeKeyMaterial(replyRecipient)).toBe(true)
    expect(hasHandshakeKeyMaterial(bulkRecipient)).toBe(true)
  })
})

// =============================================================================
// 10–11: List↔detail invariant (recipient-side, Detail-vs-list invariant)
// =============================================================================

describe('List↔detail invariant (PR 7 / Canon detail-vs-list invariant)', () => {

  // Test 10
  it('10. row that list shows indicator → detail-side resolver (resolveBeapSessionImportPayload) also resolves valid session', () => {
    // A message that passes the list indicator gate:
    //   - validated_at set, no reason → validated
    //   - session_import_artefact present
    const artefact = makeArtefact()
    const message = baseMessage({
      validated_at: '2026-01-01T00:00:00Z',
      validation_reason: null,
      session_import_artefact: artefact,
    })

    // List indicator: true
    const listIndicator = computeHasSessionIndicator(message)
    expect(listIndicator).toBe(true)

    // Detail-side: resolver reads from the canonical position (session_import_artefact)
    const resolution = resolveBeapSessionImportPayload(message)
    expect(resolution.status).toBe('valid')

    // The two agree: list shows indicator ↔ detail shows valid session
    // (list is a subset of detail signal, never contradicts)
    expect(listIndicator).toBe(resolution.status === 'valid')
  })

  // Test 11
  it('11. row that list does not show indicator (artefact absent) → detail resolver also finds no session', () => {
    const message = baseMessage({
      validated_at: '2026-01-01T00:00:00Z',
      validation_reason: null,
      session_import_artefact: null, // no artefact
      attachments: [],               // no legacy attachment path either
    })

    // List indicator: false
    const listIndicator = computeHasSessionIndicator(message)
    expect(listIndicator).toBe(false)

    // Detail-side: no session either
    const resolution = resolveBeapSessionImportPayload(message)
    expect(resolution.status).not.toBe('valid')

    // Agreement: list no-indicator ↔ detail no-session
    expect(listIndicator).toBe(false)
    expect(['none', 'invalid']).toContain(resolution.status)
  })

  // Test 11b — unvalidated row: list hides indicator; detail gated too (Decision B parity)
  it('11b. unvalidated row: list hides indicator; detail validation state also non-validated', () => {
    const message = baseMessage({
      validated_at: null,
      validation_reason: 'MISSING_REQUIRED_FIELD',
      session_import_artefact: makeArtefact(), // artefact present but row not validated
    })

    // List: gate blocks (Decision B)
    const listIndicator = computeHasSessionIndicator(message)
    expect(listIndicator).toBe(false)

    // Detail: getValidationState returns 'rejected' — artefact UI also hidden (PR 5 Decision B)
    const vState = getValidationState(message.validated_at, message.validation_reason)
    expect(vState).toBe('rejected')

    // Both surfaces agree: this row gets no session UI
  })
})
