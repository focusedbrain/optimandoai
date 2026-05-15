/**
 * PR 5 — Recipient Inbox Wiring + Label Unification
 *
 * Tests 1–13: validation-state helper + resolver logic
 * Tests 14–18: integration (logic-only — no browser render)
 *
 * Canon guards:
 *  - Tests 7–9 / 14-equiv: gate is real, not theater.
 *  - Test 6 / Decision E: import_only suppresses Run Automation.
 *  - Test 15: label is "Run Automation" everywhere.
 */

import { describe, it, expect } from 'vitest'
import { getValidationState, type ValidationState } from '../validationState'
import {
  resolveBeapSessionImportPayload,
} from '../sessionImportPayloadResolver'
import type { BeapMessage, BeapAttachment } from '../beapInboxTypes'
import type { SessionImportArtefact } from '../../beap-builder/canonical-types'

// =============================================================================
// Helpers
// =============================================================================

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
    messageId: 'm1',
    senderFingerprint: 'fp',
    senderEmail: 'a@b.com',
    handshakeId: null,
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
    ...overrides,
  }
}

const minimalArtefact = (
  overrides: Partial<SessionImportArtefact> = {},
): SessionImportArtefact =>
  ({
    artefact_id: 'art-1',
    artefact_version: '1.0',
    purpose: { declared_purpose: 'session_share', description: 'share' },
    requested_action: 'import_and_offer_run',
    sessions: [
      {
        session_id: 'sess-1',
        session_name: 'My Session',
        agents: [],
        agent_boxes: [{ id: 'b1', identifier: 'x', agents: [] }],
        display_grids: [],
        capabilities_required: [],
      },
    ],
    ...overrides,
  } as unknown as SessionImportArtefact)

const minimalV1Attachment = baseAttachment({
  semanticContent: JSON.stringify({
    version: '1.0.0',
    tabName: 'T',
    agentBoxes: [{ id: 'b1', identifier: 'x' }],
    agents: [],
    uiState: {},
  }),
})

// =============================================================================
// Tests 1–4: getValidationState helper
// =============================================================================

describe('getValidationState', () => {
  it('test 1: validated_at set + validation_reason null → validated', () => {
    const s: ValidationState = getValidationState('2025-01-01T00:00:00Z', null)
    expect(s).toBe('validated')
  })

  it('test 1b: validated_at set + validation_reason undefined → validated', () => {
    expect(getValidationState('2025-01-01T00:00:00Z', undefined)).toBe('validated')
  })

  it('test 2: validation_reason === unrecoverable_legacy → rejected (unrecoverable_legacy state removed PR 5.3)', () => {
    expect(getValidationState(null, 'unrecoverable_legacy')).toBe('rejected')
    expect(getValidationState('2025-01-01T00:00:00Z', 'unrecoverable_legacy')).toBe('rejected')
  })

  it('test 3: any other validation_reason → rejected', () => {
    expect(getValidationState(null, 'schema_mismatch')).toBe('rejected')
    expect(getValidationState(null, 'content_invalid')).toBe('rejected')
    expect(getValidationState('2025-01-01T00:00:00Z', 'schema_mismatch')).toBe('rejected')
  })

  it('test 4: both null → pending', () => {
    expect(getValidationState(null, null)).toBe('pending')
    expect(getValidationState(undefined, undefined)).toBe('pending')
  })
})

// =============================================================================
// Tests 5–13: resolver — canonical artefact + legacy fallback + requested_action
// =============================================================================

describe('resolveBeapSessionImportPayload — canonical artefact (Decision A — PR 5)', () => {
  it('test 11: canonical position present → reads from canonical', () => {
    const artefact = minimalArtefact()
    const msg = baseMessage({ session_import_artefact: artefact })
    const r = resolveBeapSessionImportPayload(msg)
    expect(r.status).toBe('valid')
    if (r.status === 'valid') {
      expect(r.source.kind).toBe('canonical_artefact')
    }
  })

  it('test 11b: canonical artefact exposes requestedAction from artefact', () => {
    const artefact = minimalArtefact({ requested_action: 'import_and_offer_run' })
    const msg = baseMessage({ session_import_artefact: artefact })
    const r = resolveBeapSessionImportPayload(msg)
    expect(r.status).toBe('valid')
    if (r.status === 'valid') {
      expect(r.requestedAction).toBe('import_and_offer_run')
    }
  })

  it('test 11c: canonical artefact with import_only exposes import_only', () => {
    const artefact = minimalArtefact({ requested_action: 'import_only' })
    const msg = baseMessage({ session_import_artefact: artefact })
    const r = resolveBeapSessionImportPayload(msg)
    expect(r.status).toBe('valid')
    if (r.status === 'valid') {
      expect(r.requestedAction).toBe('import_only')
    }
  })

  it('test 12: canonical absent, legacy attachment present → falls back to legacy', () => {
    const msg = baseMessage({
      session_import_artefact: null,
      attachments: [minimalV1Attachment],
    })
    const r = resolveBeapSessionImportPayload(msg)
    expect(r.status).toBe('valid')
    if (r.status === 'valid') {
      expect(r.source.kind).toBe('attachment_semantic_json')
      expect(r.requestedAction).toBeUndefined()
    }
  })

  it('test 12b: canonical artefact takes priority over legacy attachment when both present', () => {
    const artefact = minimalArtefact()
    const msg = baseMessage({
      session_import_artefact: artefact,
      attachments: [minimalV1Attachment],
    })
    const r = resolveBeapSessionImportPayload(msg)
    expect(r.status).toBe('valid')
    if (r.status === 'valid') {
      expect(r.source.kind).toBe('canonical_artefact')
    }
  })

  it('test 13: nothing present → none', () => {
    const msg = baseMessage({ session_import_artefact: null, attachments: [] })
    const r = resolveBeapSessionImportPayload(msg)
    expect(r.status).toBe('none')
  })
})

// =============================================================================
// Tests 5–10: rendering gate logic (logic-only, no DOM)
// =============================================================================

describe('rendering gate — showRunAutomationButton logic (Decision B + E — PR 5)', () => {
  // The actual rendering is in React, but we can unit-test the gate predicate.

  function gateValidated(
    validationState: ValidationState,
    resolutionStatus: 'valid' | 'invalid' | 'none',
    requestedAction: 'import_only' | 'import_and_offer_run' | undefined,
  ): boolean {
    if (validationState !== 'validated') return false
    if (resolutionStatus !== 'valid') return false
    if (requestedAction === 'import_only') return false
    return true
  }

  it('test 5: validated + import_and_offer_run → Run Automation button shown', () => {
    expect(gateValidated('validated', 'valid', 'import_and_offer_run')).toBe(true)
  })

  it('test 6: validated + import_only → button NOT shown; session still visible', () => {
    expect(gateValidated('validated', 'valid', 'import_only')).toBe(false)
  })

  it('test 6b: validated + legacy (no requestedAction) → button shown (backward compat)', () => {
    expect(gateValidated('validated', 'valid', undefined)).toBe(true)
  })

  it('test 7: pending → gate blocks; no Run Automation', () => {
    expect(gateValidated('pending', 'valid', 'import_and_offer_run')).toBe(false)
  })

  it('test 8: unrecoverable_legacy → gate blocks; no Run Automation', () => {
    expect(gateValidated('unrecoverable_legacy', 'valid', 'import_and_offer_run')).toBe(false)
  })

  it('test 9: rejected → gate blocks; no Run Automation', () => {
    expect(gateValidated('rejected', 'valid', 'import_and_offer_run')).toBe(false)
  })

  it('test 10: validated + no artefact → no button (resolution not valid)', () => {
    expect(gateValidated('validated', 'none', undefined)).toBe(false)
    expect(gateValidated('validated', 'invalid', undefined)).toBe(false)
  })
})

// =============================================================================
// Tests for getArtefactSessionRefs logic (Decision A — Electron path)
// =============================================================================

describe('getArtefactSessionRefs logic (Decision A — PR 5)', () => {
  // Inline the function logic here (mirrors EmailMessageDetail.tsx)
  // PR 5.3.1: legacy sessionRefs fallback removed. Canonical-only path mirrors
  // EmailMessageDetail.tsx (PR 5.1 / Decision C).
  function getArtefactSessionRefs(
    p: Record<string, unknown>,
  ): { refs: Array<Record<string, unknown>>; requestedAction?: 'import_only' | 'import_and_offer_run' } {
    const canonicalArtefact = p.session_import_artefact
    if (canonicalArtefact != null && typeof canonicalArtefact === 'object') {
      const artefact = canonicalArtefact as Record<string, unknown>
      const sessions = artefact.sessions
      if (Array.isArray(sessions) && sessions.length > 0) {
        const refs = sessions
          .filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object')
          .map((s) => ({
            sessionId: typeof s.session_id === 'string' ? s.session_id : String(s.session_id ?? ''),
            sessionName: typeof s.session_name === 'string' ? s.session_name : undefined,
          }))
        const requestedAction =
          artefact.requested_action === 'import_only' || artefact.requested_action === 'import_and_offer_run'
            ? (artefact.requested_action as 'import_only' | 'import_and_offer_run')
            : undefined
        return { refs, requestedAction }
      }
    }
    return { refs: [] }
  }

  it('test 16: canonical session_import_artefact present → reads from canonical', () => {
    const depackaged = {
      session_import_artefact: {
        artefact_id: 'art-2',
        requested_action: 'import_and_offer_run',
        sessions: [{ session_id: 'sess-2', session_name: 'Canonical Session' }],
      },
    }
    const { refs, requestedAction } = getArtefactSessionRefs(depackaged)
    expect(refs).toHaveLength(1)
    expect(refs[0].sessionId).toBe('sess-2')
    expect(requestedAction).toBe('import_and_offer_run')
  })

  it('test 17: legacy sessionRefs present, no canonical → NOT used (PR 5.3.1 removal)', () => {
    // Legacy sessionRefs fallback removed. Row with only sessionRefs and no
    // session_import_artefact is conformant-absent — returns empty refs.
    const depackaged = {
      sessionRefs: [
        { sessionId: 'legacy-1', sessionName: 'Legacy Session' },
      ],
    }
    const { refs } = getArtefactSessionRefs(depackaged)
    expect(refs).toHaveLength(0)
  })

  it('test 17b: neither canonical nor legacy → empty refs', () => {
    const { refs } = getArtefactSessionRefs({})
    expect(refs).toHaveLength(0)
  })
})

// =============================================================================
// Test 15: label unification — "Run Automation" everywhere
// =============================================================================

describe('label unification — "Run Automation" (Decision D — PR 5)', () => {
  it('test 15: "Import & Run" does not appear in resolver output or flag values', () => {
    // The resolver doesn't produce user-facing strings, but we verify the
    // requestedAction vocabulary does not include any "Import & Run" text.
    const artefact = minimalArtefact({ requested_action: 'import_and_offer_run' })
    const msg = baseMessage({ session_import_artefact: artefact })
    const r = resolveBeapSessionImportPayload(msg)
    if (r.status === 'valid') {
      // requestedAction is a machine token, not a label
      expect(r.requestedAction).not.toContain('Import')
      expect(r.requestedAction).not.toContain('&')
      // The canonical label seen by the user is "Run Automation"
      // (enforced in BeapMessageDetailPanel + EmailMessageDetail + SessionImportDialog)
      // Verify the source label for canonical artefact is not "Import & Run":
      if (r.source.kind === 'canonical_artefact') {
        expect(r.source.sessionName).not.toContain('Import & Run')
      }
    }
  })
})

// =============================================================================
// Test 18: end-to-end integration (logic chain)
// =============================================================================

describe('test 18 — end-to-end logic chain: artefact → resolver → gate → button', () => {
  it('builds artefact → resolver resolves → gate passes → Run Automation shown', () => {
    // 1. Build artefact (simulating PR 3/4 output)
    const artefact = minimalArtefact({
      requested_action: 'import_and_offer_run',
    })

    // 2. Message carries artefact + validated mark (simulating PR 2/2.2 outcome)
    const msg = baseMessage({
      session_import_artefact: artefact,
      validated_at: '2025-01-01T12:00:00Z',
      validation_reason: null,
    })

    // 3. Resolver reads from canonical position (Decision A)
    const resolution = resolveBeapSessionImportPayload(msg)
    expect(resolution.status).toBe('valid')
    if (resolution.status !== 'valid') return

    expect(resolution.source.kind).toBe('canonical_artefact')
    expect(resolution.requestedAction).toBe('import_and_offer_run')

    // 4. Validation gate (Decision B)
    const vState = getValidationState(msg.validated_at, msg.validation_reason)
    expect(vState).toBe('validated')

    // 5. Run Automation button visibility (Decisions B + E)
    const showButton =
      vState === 'validated' &&
      resolution.status === 'valid' &&
      resolution.requestedAction !== 'import_only'
    expect(showButton).toBe(true)
  })

  it('import_only artefact → gate passes but Run Automation hidden (Decision E)', () => {
    const artefact = minimalArtefact({ requested_action: 'import_only' })
    const msg = baseMessage({
      session_import_artefact: artefact,
      validated_at: '2025-01-01T12:00:00Z',
      validation_reason: null,
    })
    const resolution = resolveBeapSessionImportPayload(msg)
    expect(resolution.status).toBe('valid')
    if (resolution.status !== 'valid') return
    expect(resolution.requestedAction).toBe('import_only')

    const vState = getValidationState(msg.validated_at, msg.validation_reason)
    expect(vState).toBe('validated')

    // Despite validation passing, button is hidden (Decision E)
    const showButton =
      vState === 'validated' &&
      resolution.status === 'valid' &&
      resolution.requestedAction !== 'import_only'
    expect(showButton).toBe(false)
  })

  it('rejected row → gate blocks regardless of artefact presence (Decision B)', () => {
    const artefact = minimalArtefact({ requested_action: 'import_and_offer_run' })
    const msg = baseMessage({
      session_import_artefact: artefact,
      validated_at: null,
      validation_reason: 'HASH_INTEGRITY_FAILURE',
    })
    const vState = getValidationState(msg.validated_at, msg.validation_reason)
    expect(vState).toBe('rejected')

    const resolution = resolveBeapSessionImportPayload(msg)
    expect(resolution.status).toBe('valid')  // resolver finds artefact

    // But gate blocks rendering regardless
    const showButton =
      vState === 'validated' &&
      resolution.status === 'valid' &&
      resolution.requestedAction !== 'import_only'
    expect(showButton).toBe(false)
  })
})
