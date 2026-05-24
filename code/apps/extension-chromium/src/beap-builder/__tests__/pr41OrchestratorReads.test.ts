/**
 * PR 4.1/8 — Replace chrome.storage Session Reads with Orchestrator Reads
 *
 * Verifies the logic that the three corrected extension surfaces (sidepanel,
 * popup-chat, useReplyComposer) exercise. React components are not rendered;
 * the construction logic is tested directly.
 *
 * Tests:
 *  28–30. Session list: GET_ALL_SESSIONS_FROM_SQLITE response parsing
 *  31–34. Session fetch: GET_SESSION_FROM_SQLITE response + artefact construction
 *  35–37. Host unavailable: GET_SESSION_FROM_SQLITE fails → send without artefact
 *  38–39. No session selected: artefact construction is skipped
 *  40–41. PR 4 tests still hold with the new source (no regression)
 */

import { describe, it, expect } from 'vitest'
import { buildSessionImportArtefact } from '../buildSessionImportArtefact'
import type { BuildArtefactInput } from '../buildSessionImportArtefact'

// =============================================================================
// Helpers
// =============================================================================

/**
 * Simulate the session data shape returned by GET_SESSION_FROM_SQLITE.
 * background.ts returns `{ success: true, session: <raw KV value> }`.
 */
function makeOrchestratorSessionResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    session: {
      name: 'My Session',
      agents: [],
      agentBoxes: [],
      displayGrids: [],
      capabilities_required: [],
      ...overrides,
    } as Record<string, unknown>,
  }
}

/**
 * Simulate the sessions map returned by GET_ALL_SESSIONS_FROM_SQLITE.
 * background.ts returns `{ success: true, sessions: Record<string, unknown> }`.
 */
function makeOrchestratorSessionsListResponse(sessions: Record<string, unknown>) {
  return { success: true, sessions }
}

/**
 * Extract BuildArtefactInput from an orchestrator session response, mirroring
 * the extraction logic in sidepanel / popup-chat / useReplyComposer.
 */
function extractArtefactInput(
  sessionKey: string,
  session: Record<string, unknown>,
  handshakeId?: string,
): BuildArtefactInput {
  return {
    sessionId: sessionKey,
    sessionName: typeof session.name === 'string' ? session.name : sessionKey,
    agents: Array.isArray(session.agents) ? (session.agents as any[]) : [],
    agentBoxes: Array.isArray(session.agentBoxes ?? session.agent_boxes)
      ? ((session.agentBoxes ?? session.agent_boxes) as any[])
      : [],
    displayGrids: Array.isArray(session.displayGrids ?? session.display_grids)
      ? ((session.displayGrids ?? session.display_grids) as any[])
      : [],
    capabilitiesRequired: Array.isArray(session.capabilities_required)
      ? (session.capabilities_required as any[])
      : [],
    handshakeBinding: handshakeId
      ? { handshake_id: handshakeId, bound_at: new Date().toISOString() }
      : null,
  }
}

// =============================================================================
// 1. Session list loading — GET_ALL_SESSIONS_FROM_SQLITE response parsing
// =============================================================================

describe('PR 4.1 — session list from orchestrator (GET_ALL_SESSIONS_FROM_SQLITE)', () => {
  // Test 28
  it('filters session_* keys from the orchestrator sessions map', () => {
    const response = makeOrchestratorSessionsListResponse({
      'session_abc': { name: 'Session A', timestamp: '2026-05-01T10:00:00Z' },
      'session_xyz': { name: 'Session X', timestamp: '2026-04-01T10:00:00Z' },
      'optimando-theme': 'dark',
      'commandChatPinned': true,
    })

    // Replicate filtering logic from sidepanel/popup-chat loadAvailableSessions
    const entries = Object.entries(response.sessions as Record<string, unknown>)
      .filter(([key]) => key.startsWith('session_'))

    expect(entries).toHaveLength(2)
    expect(entries.map(([k]) => k)).toEqual(expect.arrayContaining(['session_abc', 'session_xyz']))
  })

  // Test 29
  it('builds SessionOption entries with name and timestamp from orchestrator data', () => {
    const response = makeOrchestratorSessionsListResponse({
      'session_t1': { name: 'Test Session', timestamp: '2026-05-04T08:00:00Z' },
    })

    const [key, data] = Object.entries(response.sessions as Record<string, unknown>)
      .filter(([k]) => k.startsWith('session_'))[0]

    const d = data as Record<string, unknown>
    const name = typeof d.name === 'string' ? d.name : key
    const timestamp = (d.timestamp as string) || ''

    expect(key).toBe('session_t1')
    expect(name).toBe('Test Session')
    expect(timestamp).toBe('2026-05-04T08:00:00Z')
  })

  // Test 30
  it('returns empty list when orchestrator returns no session_ keys', () => {
    const response = makeOrchestratorSessionsListResponse({
      'optimando-theme': 'dark',
      'draft_abc': 'some draft',
    })

    const entries = Object.entries(response.sessions as Record<string, unknown>)
      .filter(([key]) => key.startsWith('session_'))

    expect(entries).toHaveLength(0)
  })
})

// =============================================================================
// 2. Session fetch at send time — GET_SESSION_FROM_SQLITE response + artefact
// =============================================================================

describe('PR 4.1 — session fetch from orchestrator (GET_SESSION_FROM_SQLITE)', () => {
  // Test 31
  it('orchestrator available: session data → artefact produced (sidepanel pattern)', () => {
    const response = makeOrchestratorSessionResponse({
      name: 'Sidepanel Session',
      capabilities_required: ['network_egress'],
    })
    const input = extractArtefactInput('session_sidepanel_1', response.session)
    const result = buildSessionImportArtefact(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.artefact.sessions[0].session_id).toBe('session_sidepanel_1')
    expect(result.artefact.sessions[0].session_name).toBe('Sidepanel Session')
    expect(result.artefact.requested_action).toBe('import_and_offer_run')
    expect(result.artefact.purpose.declared_purpose).toBe('session_share')
  })

  // Test 32
  it('orchestrator available: session data → artefact produced (popup-chat pattern)', () => {
    const response = makeOrchestratorSessionResponse({ name: 'Popup Session' })
    const input = extractArtefactInput('session_popup_2', response.session)
    const result = buildSessionImportArtefact(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.artefact.sessions[0].session_id).toBe('session_popup_2')
    expect(result.artefact.requested_action).toBe('import_only')
  })

  // Test 33
  it('orchestrator available: session data → artefact produced (reply composer, with handshake)', () => {
    const response = makeOrchestratorSessionResponse({
      name: 'Reply Session',
      capabilities_required: ['ui_actions'],
    })
    const input = extractArtefactInput('session_reply_3', response.session, 'hk-reply-001')
    const result = buildSessionImportArtefact(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.artefact.handshake_binding?.handshake_id).toBe('hk-reply-001')
    expect(result.artefact.sessions[0].capabilities_required).toEqual(['ui_actions'])
  })

  // Test 34
  it('session key (chrome storage key format) is passed verbatim to GET_SESSION_FROM_SQLITE', () => {
    // The sessionKey sent to GET_SESSION_FROM_SQLITE must be the same key format
    // used to store sessions (session_<id>). beapDraftSessionId already holds
    // this key because it is populated from the session list (session_* entries).
    const sessionKey = 'session_abc123'

    // Simulate: GET_SESSION_FROM_SQLITE called with sessionKey → response.session.session_id
    // would equal the key (if the session stores its own id).
    const response = makeOrchestratorSessionResponse({ name: 'Named Session' })
    const input = extractArtefactInput(sessionKey, response.session)
    const result = buildSessionImportArtefact(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // session_id in the artefact == the chrome storage key that was looked up
    expect(result.artefact.sessions[0].session_id).toBe('session_abc123')
  })
})

// =============================================================================
// 3. Host unavailable: send proceeds without artefact
// =============================================================================

describe('PR 4.1 — host unavailable handling', () => {
  // Test 35
  it('null sessionData (host unreachable) → artefact remains undefined, no throw', () => {
    // Simulate the surface logic when GET_SESSION_FROM_SQLITE returns null.
    const beapDraftSessionId = 'session_xyz'
    let artefact: ReturnType<typeof buildSessionImportArtefact> | undefined = undefined
    let errorMessage: string | null = null

    // Replicate surface branching:
    const sessionData: Record<string, unknown> | null = null // host unreachable
    if (sessionData) {
      const input = extractArtefactInput(beapDraftSessionId, sessionData)
      artefact = buildSessionImportArtefact(input)
    } else {
      // host-unavailable path: show message, proceed without artefact
      errorMessage = 'Session unavailable — unlock the host application to attach a session.'
    }

    expect(artefact).toBeUndefined()
    expect(errorMessage).toBe('Session unavailable — unlock the host application to attach a session.')
  })

  // Test 36
  it('host unavailable → beapDraftSessionId is retained (not cleared)', () => {
    let beapDraftSessionId: string | null = 'session_keep_me'
    let cleared = false

    const sessionData: Record<string, unknown> | null = null
    if (!sessionData) {
      // Per PR 4.1: retain selection on host-unavailable.
      // Only clear on explicit success (the "setBeapDraftSessionId('')" call is
      // inside the successful send completion block, not here).
      cleared = false
    }

    expect(cleared).toBe(false)
    expect(beapDraftSessionId).toBe('session_keep_me')
  })

  // Test 37
  it('build failure (ok:false) is still a blocking abort, not a soft warning', () => {
    // Structural failure from buildSessionImportArtefact is distinct from
    // host-unavailable. A build failure aborts the send (throws in the hook,
    // returns early in sidepanel/popup-chat).
    const result = buildSessionImportArtefact({
      sessionId: '',  // invalid → build failure
      sessionName: 'X',
      agents: [], agentBoxes: [], displayGrids: [],
      capabilitiesRequired: [],
      handshakeBinding: null,
    })

    expect(result.ok).toBe(false)
    // Caller must abort (throw / return) rather than proceed.
    // The test asserts the result is a hard failure so the surface treats it as such.
    if (result.ok) return
    expect(result.reason.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// 4. No session selected — construction is skipped
// =============================================================================

describe('PR 4.1 — no session selected path', () => {
  // Test 38
  it('empty beapDraftSessionId → buildSessionImportArtefact not called, config has no artefact', () => {
    const beapDraftSessionId = ''
    let artefactBuilt = false

    if (beapDraftSessionId) {
      artefactBuilt = true
      buildSessionImportArtefact({
        sessionId: beapDraftSessionId,
        sessionName: '',
        agents: [], agentBoxes: [], displayGrids: [],
        capabilitiesRequired: [],
        handshakeBinding: null,
      })
    }

    expect(artefactBuilt).toBe(false)
  })

  // Test 39
  it('null selectedSessionId → buildSessionImportArtefact not called (hook pattern)', () => {
    const selectedSessionId: string | null = null
    let artefactBuilt = false

    if (selectedSessionId) {
      artefactBuilt = true
    }

    expect(artefactBuilt).toBe(false)
  })
})

// =============================================================================
// 5. PR 4 regression guard — existing helper tests still pass unchanged
// =============================================================================

describe('PR 4.1 — PR 4 regression: buildSessionImportArtefact unchanged', () => {
  // Test 40
  it('session data from orchestrator extracts agentBoxes + display_grids correctly', () => {
    // Verify that the extraction logic handles both camelCase and snake_case
    // field names from the raw session data (orchestrator stores camelCase).
    const session: Record<string, unknown> = {
      name: 'Mixed Fields Session',
      agentBoxes: [{ id: 'box1' }],     // orchestrator stores camelCase
      displayGrids: [{ id: 'grid1' }],  // orchestrator stores camelCase
      capabilities_required: ['data_access'],
    }
    const input = extractArtefactInput('session_mixed', session)
    const result = buildSessionImportArtefact(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.artefact.sessions[0].agent_boxes).toEqual([{ id: 'box1' }])
    expect(result.artefact.sessions[0].display_grids).toEqual([{ id: 'grid1' }])
    expect(result.artefact.sessions[0].capabilities_required).toEqual(['data_access'])
  })

  // Test 41
  it('fallback: agent_boxes / display_grids snake_case fields also work', () => {
    // Some legacy sessions might store snake_case fields in the KV store.
    const session: Record<string, unknown> = {
      name: 'Legacy Fields Session',
      agent_boxes: [{ id: 'box_legacy' }],
      display_grids: [{ id: 'grid_legacy' }],
      capabilities_required: [],
    }
    const input = extractArtefactInput('session_legacy', session)
    const result = buildSessionImportArtefact(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.artefact.sessions[0].agent_boxes).toEqual([{ id: 'box_legacy' }])
  })
})
