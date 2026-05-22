import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/ingestion-core', () => ({
  validateSessionImportArtefact: vi.fn((artefact: unknown) => {
    if (artefact == null || typeof artefact !== 'object' || Array.isArray(artefact)) {
      return { success: false, reason: 'STRUCTURAL_INTEGRITY_FAILURE' }
    }
    const o = artefact as Record<string, unknown>
    if (o.requested_action === 'import_only') {
      return { success: true }
    }
    if (o.requested_action === 'import_and_offer_run') {
      return { success: true }
    }
    return { success: false, reason: 'UNSUPPORTED_REQUESTED_ACTION' }
  }),
}))

import { importAndRunBeapSessionFromArtefact } from '../beapSessionImportRun'

function validRunArtefact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: '1.0.0',
    artefact_id: '550e8400-e29b-41d4-a716-446655440000',
    created_at: '2026-05-04T17:36:00Z',
    handshake_binding: null,
    purpose: { declared_purpose: 'session_share', scope_constraints: {} },
    sessions: [
      {
        session_kind: 'orchestrator_session',
        session_id: 'session_1714000000000',
        session_name: 'Test Session',
        agents: [{ id: 'a1', name: 'Agent', mode: 'mode_trigger' }],
        agent_boxes: [{ id: 'b1', identifier: 'box', agents: [] }],
        display_grids: [],
        capabilities_required: ['session_control'],
      },
    ],
    policy: {
      processing_events: [{ event_class: 'semantic_processing', boundary: 'LOCAL', scope: 'SELECTED' }],
    },
    requested_action: 'import_and_offer_run',
    sensitive_subcapsule: null,
    ...overrides,
  }
}

function successWaiter() {
  return vi.fn(async () => ({
    ok: true as const,
    sessionKey: 'session_test',
    executed: ['Agent'],
  }))
}

describe('importAndRunBeapSessionFromArtefact', () => {
  const orchestrator = {
    connect: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
  }

  it('rejects missing artefact', async () => {
    const r = await importAndRunBeapSessionFromArtefact(
      {
        sessionId: 's1',
        sessionName: 'S',
        importArtefact: null,
        sourceMessageId: 'msg-1',
        handshakeId: null,
      },
      {
        orchestrator: orchestrator as any,
        broadcastToExtensions: vi.fn(),
        extensionClientCount: () => 1,
        waitForRunAutomationResult: successWaiter(),
      },
    )
    expect(r).toEqual({ success: false, error: 'INVALID_ARTEFACT' })
  })

  it('allows import_only artefacts when user explicitly runs automation', async () => {
    const broadcast = vi.fn()
    const artefact = validRunArtefact({
      requested_action: 'import_only',
      sessions: [
        {
          session_kind: 'orchestrator_session',
          session_id: 'session_1714000000000',
          session_name: 'Test Session',
          agents: [],
          agent_boxes: [],
          display_grids: [],
          capabilities_required: [],
        },
      ],
    })
    const waitForRunAutomationResult = successWaiter()
    const r = await importAndRunBeapSessionFromArtefact(
      {
        sessionId: 'session_1714000000000',
        sessionName: 'Test Session',
        importArtefact: artefact,
        sourceMessageId: 'msg-1',
        handshakeId: null,
      },
      {
        orchestrator: orchestrator as any,
        broadcastToExtensions: broadcast,
        extensionClientCount: () => 1,
        waitForRunAutomationResult,
      },
    )
    expect(r.success).toBe(true)
    expect(broadcast).toHaveBeenCalled()
    expect(orchestrator.set).toHaveBeenCalled()
  })

  it('rejects handshake binding mismatch', async () => {
    const r = await importAndRunBeapSessionFromArtefact(
      {
        sessionId: 's1',
        sessionName: 'S',
        importArtefact: validRunArtefact({
          handshake_binding: { handshake_id: 'hs-expected', bound_at: '2026-05-04T17:00:00Z' },
        }),
        sourceMessageId: 'msg-1',
        handshakeId: 'hs-other',
      },
      {
        orchestrator: orchestrator as any,
        broadcastToExtensions: vi.fn(),
        extensionClientCount: () => 1,
        waitForRunAutomationResult: successWaiter(),
      },
    )
    expect(r).toEqual({ success: false, error: 'HANDSHAKE_BINDING_MISMATCH' })
  })

  it('dispatches unwrapped tab payload to extension when valid', async () => {
    const broadcast = vi.fn()
    const artefact = validRunArtefact()
    const waitForRunAutomationResult = successWaiter()
    const r = await importAndRunBeapSessionFromArtefact(
      {
        sessionId: 'session_1714000000000',
        sessionName: 'Test Session',
        importArtefact: artefact,
        sourceMessageId: 'msg-1',
        handshakeId: null,
      },
      {
        orchestrator: orchestrator as any,
        broadcastToExtensions: broadcast,
        extensionClientCount: () => 1,
        waitForRunAutomationResult,
      },
    )
    expect(r.success).toBe(true)
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BEAP_DESKTOP_RUN_AUTOMATION',
        sourceMessageId: 'msg-1',
        sessionKey: expect.stringMatching(/^session_/),
        importData: expect.objectContaining({
          tabName: 'Test Session',
          agentBoxes: expect.any(Array),
          agents: expect.any(Array),
        }),
      }),
    )
    expect(r).toMatchObject({
      success: true,
      dispatched: true,
      sessionKey: 'session_test',
      executed: ['Agent'],
    })
  })

  it('fails when extension bridge is offline', async () => {
    const r = await importAndRunBeapSessionFromArtefact(
      {
        sessionId: 's1',
        sessionName: 'S',
        importArtefact: validRunArtefact(),
        sourceMessageId: 'msg-1',
        handshakeId: null,
      },
      {
        orchestrator: orchestrator as any,
        broadcastToExtensions: vi.fn(),
        extensionClientCount: () => 0,
        waitForRunAutomationResult: successWaiter(),
      },
    )
    expect(r).toEqual({ success: false, error: 'EXTENSION_NOT_CONNECTED' })
  })
})
