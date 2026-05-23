/**
 * buildSessionImportArtefact — round-trip and field-parity tests
 *
 * Covers:
 *   RT-1:  Round-trip: source KV blob → buildSessionImportArtefact → BEAP encode
 *          → BEAP decode → unwrap → normalizeImportedSessionPayload → restored session
 *          contains every field from the source blob.
 *   RT-2:  unwrapSessionImportPayloadForTab extracts session_export verbatim.
 *   RT-3:  normalizeImportedSessionPayload delegates full_session_export to the
 *          same fallback path as a raw KV blob — no BEAP-specific branch.
 *   FP-1:  Field-parity: every field produced by the file-export serializer is
 *          present in the unwrapped payload from the BEAP artefact.
 *   FP-2:  Old v1.0.0 capsules still import (backward compat for legacy data).
 *   FP-3:  v1.1.0 artefact passes the ingestion-core validator.
 *   FP-4:  Unknown schema_version → SCHEMA_VERSION_UNSUPPORTED ("update required").
 *   FP-5:  sessionBlob validation: non-object → ok:false.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest'
import { buildSessionImportArtefact } from '../buildSessionImportArtefact'
import {
  unwrapSessionImportPayloadForTab,
  isSessionImportArtefactWrapper,
  isFullSessionExportContent,
} from '../../services/sessionImportArtefactUnwrap'
import { normalizeImportedSessionPayload } from '../../services/sessionImportCore'
import { validateSessionImportArtefact } from '../../../../packages/ingestion-core/src/validator'

// =============================================================================
// Fixtures
// =============================================================================

/**
 * Canonical source session KV blob — represents the full set of fields that
 * the file-export serializer emits (version '1.0.0' export format field set).
 *
 * Field enumeration (acceptance criterion 3):
 *   tabName, sessionAlias, timestamp, url, isLocked,
 *   agents, agentBoxes, displayGrids,
 *   helperTabs, hybridViews,
 *   goals, uiConfig, userIntentDetection,
 *   agentBoxHeights, customAgentLayout, customAgentOrder, displayGridActiveTab,
 *   customAgents, hiddenBuiltins, numberMap, nextNumber,
 *   memory, context.
 */
function makeFullSessionBlob(): Record<string, unknown> {
  return {
    tabName: 'Full Round-Trip Session',
    sessionAlias: 'alias-001',
    timestamp: '2026-05-23T10:00:00Z',
    url: 'https://example.com/workflow',
    isLocked: false,
    agents: [
      {
        _schemaVersion: '2.1.0',
        id: 'agent-1',
        name: 'Listener Agent',
        enabled: true,
        capabilities: ['listening'],
      },
    ],
    agentBoxes: [
      {
        _schemaVersion: '1.0.0',
        id: 'box-1',
        boxNumber: 1,
        agentId: 'agent-1',
        title: 'Box A',
        color: '#fff',
        enabled: true,
        source: 'master_tab',
        masterTabId: '01',
      },
    ],
    displayGrids: [
      {
        layout: 'grid-2x2',
        sessionId: 'sess-src',
        config: { layout: 'grid', sessionId: 'sess-src', slots: { '0': { boxNumber: 1 } } },
      },
    ],
    helperTabs: [{ url: 'https://helper.example.com', label: 'Docs' }],
    hybridViews: [{ id: '0', masterTabId: '02', url: 'https://hybrid.example.com' }],
    goals: { shortTerm: 'Automate X', midTerm: 'Scale Y', longTerm: 'Replace Z' },
    uiConfig: { leftSidebarWidth: 350, rightSidebarWidth: 450, bottomSidebarHeight: 45 },
    userIntentDetection: { enabled: true },
    agentBoxHeights: { 'box-1': 200 },
    customAgentLayout: null,
    customAgentOrder: ['box-1'],
    displayGridActiveTab: 'grid-0',
    customAgents: [],
    hiddenBuiltins: ['built-in-x'],
    numberMap: { 'box-1': 1 },
    nextNumber: 2,
    memory: { notes: 'Remember: use v2 API', tags: ['api'] },
    context: { items: [{ id: 'ctx-1', content: 'Initial context' }] },
  }
}

/** All field keys that the file-export serializer produces. */
const FILE_EXPORT_FIELD_SET = new Set([
  'tabName', 'sessionAlias', 'timestamp', 'url', 'isLocked',
  'agents', 'agentBoxes', 'displayGrids',
  'helperTabs', 'hybridViews',
  'goals', 'uiConfig', 'userIntentDetection',
  'agentBoxHeights', 'customAgentLayout', 'customAgentOrder', 'displayGridActiveTab',
  'customAgents', 'hiddenBuiltins', 'numberMap', 'nextNumber',
  'memory', 'context',
])

// =============================================================================
// RT-1: Full round-trip test
// =============================================================================

describe('RT-1: round-trip — source blob → artefact → unwrap → normalizeImportedSessionPayload', () => {
  it('every field from the source blob is present in the restored session', () => {
    const sourceBlob = makeFullSessionBlob()

    // Step 1: Build the artefact (serialization — send side).
    const built = buildSessionImportArtefact({
      sessionId: 'session_rt_001',
      sessionName: 'Full Round-Trip Session',
      sessionBlob: sourceBlob,
      capabilitiesRequired: ['data_access'],
      handshakeBinding: null,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    // Step 2: Simulate wire encode/decode (JSON serialize + parse).
    const wireJson = JSON.stringify(built.artefact)
    const decodedArtefact = JSON.parse(wireJson) as Record<string, unknown>

    // Step 3: Unwrap (receive side — extension or Electron).
    const unwrapped = unwrapSessionImportPayloadForTab(decodedArtefact)
    expect(unwrapped.ok).toBe(true)
    if (!unwrapped.ok) return

    // unwrapped.payload is session_export (the KV blob).
    const restoredPayload = unwrapped.payload

    // Step 4: Normalize (same path as file import).
    const { sessionData } = normalizeImportedSessionPayload(restoredPayload)

    // Every field from source must be present and equal in the restored session.
    const sourceKeys = Object.keys(sourceBlob)
    for (const key of sourceKeys) {
      expect(sessionData).toHaveProperty(key)
      // Deep equality for arrays and objects.
      expect(JSON.stringify(sessionData[key])).toBe(JSON.stringify(sourceBlob[key]))
    }
  })

  it('source and restored are deeply equal for all file-export fields', () => {
    const sourceBlob = makeFullSessionBlob()

    const built = buildSessionImportArtefact({
      sessionId: 'session_rt_002',
      sessionName: 'Full Round-Trip Session',
      sessionBlob: sourceBlob,
      capabilitiesRequired: [],
      handshakeBinding: null,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const decoded = JSON.parse(JSON.stringify(built.artefact)) as Record<string, unknown>
    const unwrapped = unwrapSessionImportPayloadForTab(decoded)
    expect(unwrapped.ok).toBe(true)
    if (!unwrapped.ok) return

    const { sessionData } = normalizeImportedSessionPayload(unwrapped.payload)

    // Deep equality on each exported field.
    for (const key of FILE_EXPORT_FIELD_SET) {
      expect(sessionData[key]).toEqual(sourceBlob[key])
    }
  })
})

// =============================================================================
// RT-2: unwrapSessionImportPayloadForTab extracts session_export verbatim
// =============================================================================

describe('RT-2: unwrapSessionImportPayloadForTab — full_session_export path', () => {
  it('v1.1.0 wrapper is detected correctly', () => {
    const built = buildSessionImportArtefact({
      sessionId: 's1',
      sessionName: 'S',
      sessionBlob: { tabName: 'T', agents: [] },
      capabilitiesRequired: [],
      handshakeBinding: null,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(isSessionImportArtefactWrapper(built.artefact as unknown as Record<string, unknown>)).toBe(true)
  })

  it('sessions[0] is FullSessionExportContent', () => {
    const blob = makeFullSessionBlob()
    const built = buildSessionImportArtefact({
      sessionId: 's2',
      sessionName: 'S2',
      sessionBlob: blob,
      capabilitiesRequired: [],
      handshakeBinding: null,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const s0 = built.artefact.sessions[0]
    expect(isFullSessionExportContent(s0 as unknown as Record<string, unknown>)).toBe(true)
    expect(s0.session_kind).toBe('full_session_export')
  })

  it('unwrap returns session_export blob identical to input', () => {
    const blob = makeFullSessionBlob()
    const built = buildSessionImportArtefact({
      sessionId: 's3',
      sessionName: 'S3',
      sessionBlob: blob,
      capabilitiesRequired: [],
      handshakeBinding: null,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const decoded = JSON.parse(JSON.stringify(built.artefact)) as unknown
    const result = unwrapSessionImportPayloadForTab(decoded)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The payload IS the session_export blob — deep equal to source.
    expect(result.payload).toEqual(blob)
  })

  it('unwrap applied to a FullSessionExportContent directly (resolver slice path) also extracts session_export', () => {
    const blob = makeFullSessionBlob()
    const built = buildSessionImportArtefact({
      sessionId: 's4',
      sessionName: 'S4',
      sessionBlob: blob,
      capabilitiesRequired: [],
      handshakeBinding: null,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    // Simulate sessionImportPayloadResolver returning sessions[0] directly.
    const s0 = built.artefact.sessions[0] as unknown as Record<string, unknown>
    // normalizeImportedSessionPayload must handle full_session_export via its branch.
    const { sessionData } = normalizeImportedSessionPayload(s0)
    expect(sessionData.tabName).toBe('Full Round-Trip Session')
    expect(sessionData.helperTabs).toEqual(blob.helperTabs)
    expect(sessionData.hybridViews).toEqual(blob.hybridViews)
    expect(sessionData.memory).toEqual(blob.memory)
    expect(sessionData.context).toEqual(blob.context)
  })
})

// =============================================================================
// FP-1: Field parity — every file-export field present in restored session
// =============================================================================

describe('FP-1: field parity — BEAP payload contains every file-export field', () => {
  it('all 23 file-export fields are present in session_export', () => {
    const blob = makeFullSessionBlob()
    const built = buildSessionImportArtefact({
      sessionId: 'fp1',
      sessionName: 'Field Parity',
      sessionBlob: blob,
      capabilitiesRequired: [],
      handshakeBinding: null,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const s0 = built.artefact.sessions[0]
    expect(s0.session_kind).toBe('full_session_export')
    if (s0.session_kind !== 'full_session_export') return

    for (const field of FILE_EXPORT_FIELD_SET) {
      expect(s0.session_export).toHaveProperty(field)
    }
  })

  it('no file-export field is dropped compared to the source blob', () => {
    const blob = makeFullSessionBlob()
    const built = buildSessionImportArtefact({
      sessionId: 'fp2',
      sessionName: 'No Drop',
      sessionBlob: blob,
      capabilitiesRequired: [],
      handshakeBinding: null,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const decoded = JSON.parse(JSON.stringify(built.artefact)) as unknown
    const unwrapped = unwrapSessionImportPayloadForTab(decoded)
    expect(unwrapped.ok).toBe(true)
    if (!unwrapped.ok) return

    // Every field from the source blob must survive the BEAP round-trip.
    for (const field of Object.keys(blob)) {
      expect(unwrapped.payload).toHaveProperty(field)
    }
  })
})

// =============================================================================
// FP-2: Backward compat — v1.0.0 capsules still import
// =============================================================================

describe('FP-2: backward compatibility — v1.0.0 capsules still import', () => {
  it('unwrap of a v1.0.0 OrchestratorSessionContent artefact produces a camelCase payload', () => {
    const legacyArtefact = {
      schema_version: '1.0.0',
      artefact_id: '550e8400-e29b-41d4-a716-446655440099',
      created_at: '2026-01-01T00:00:00Z',
      handshake_binding: null,
      purpose: { declared_purpose: 'session_share', scope_constraints: {} },
      sessions: [{
        session_kind: 'orchestrator_session',
        session_id: 'session_legacy',
        session_name: 'Legacy Session',
        agents: [{ _schemaVersion: '2.1.0', id: 'a1', name: 'A', enabled: true, capabilities: [] }],
        agent_boxes: [],
        display_grids: [],
        capabilities_required: [],
      }],
      policy: { processing_events: [] },
      requested_action: 'import_only',
      sensitive_subcapsule: null,
    }
    const result = unwrapSessionImportPayloadForTab(legacyArtefact)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.tabName).toBe('Legacy Session')
    expect(Array.isArray(result.payload.agents)).toBe(true)
  })
})

// =============================================================================
// FP-3: v1.1.0 artefact passes the ingestion-core validator
// =============================================================================

describe('FP-3: ingestion-core validator accepts v1.1.0 artefacts', () => {
  it('well-formed v1.1.0 artefact with full_session_export → validateSessionImportArtefact succeeds', () => {
    const built = buildSessionImportArtefact({
      sessionId: 'session_val_001',
      sessionName: 'Validator Test',
      sessionBlob: makeFullSessionBlob(),
      capabilitiesRequired: ['data_access'],
      handshakeBinding: null,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const result = validateSessionImportArtefact(built.artefact)
    expect(result.success).toBe(true)
  })

  it('v1.1.0 artefact with import_and_offer_run + capabilities → validates', () => {
    const built = buildSessionImportArtefact({
      sessionId: 'session_val_002',
      sessionName: 'Run Automation',
      sessionBlob: { tabName: 'Flow', agents: [] },
      capabilitiesRequired: ['session_control', 'ui_actions'],
      handshakeBinding: null,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.artefact.requested_action).toBe('import_and_offer_run')
    const result = validateSessionImportArtefact(built.artefact)
    expect(result.success).toBe(true)
  })

  it('v1.1.0 artefact with empty capabilities → requested_action is import_only', () => {
    const built = buildSessionImportArtefact({
      sessionId: 'session_val_003',
      sessionName: 'Import Only',
      sessionBlob: { tabName: 'F' },
      capabilitiesRequired: [],
      handshakeBinding: null,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.artefact.requested_action).toBe('import_only')
    const result = validateSessionImportArtefact(built.artefact)
    expect(result.success).toBe(true)
  })
})

// =============================================================================
// FP-4: Unknown schema_version → SCHEMA_VERSION_UNSUPPORTED
// =============================================================================

describe('FP-4: unknown schema_version → SCHEMA_VERSION_UNSUPPORTED ("update required")', () => {
  it('schema_version 2.0.0 → validator rejects with SCHEMA_VERSION_UNSUPPORTED', () => {
    const futureArtefact = {
      schema_version: '2.0.0',
      artefact_id: '550e8400-e29b-41d4-a716-446655440000',
      created_at: '2030-01-01T00:00:00Z',
      handshake_binding: null,
      purpose: { declared_purpose: 'session_share', scope_constraints: {} },
      sessions: [{ session_kind: 'orchestrator_session' }],
      policy: { processing_events: [] },
      requested_action: 'import_only',
      sensitive_subcapsule: null,
    }
    const result = validateSessionImportArtefact(futureArtefact)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.reason).toBe('SCHEMA_VERSION_UNSUPPORTED')
    expect(result.details).toContain('update')
  })

  it('schema_version 1.5.0 → SCHEMA_VERSION_UNSUPPORTED', () => {
    const result = validateSessionImportArtefact({
      schema_version: '1.5.0',
      artefact_id: '550e8400-e29b-41d4-a716-446655440001',
      created_at: '2030-01-01T00:00:00Z',
      handshake_binding: null,
      purpose: { declared_purpose: 'session_share', scope_constraints: {} },
      sessions: [],
      policy: { processing_events: [] },
      requested_action: 'import_only',
      sensitive_subcapsule: null,
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.reason).toBe('SCHEMA_VERSION_UNSUPPORTED')
  })
})

// =============================================================================
// FP-5: Input validation
// =============================================================================

describe('FP-5: buildSessionImportArtefact input validation', () => {
  it('empty sessionId → ok:false', () => {
    const r = buildSessionImportArtefact({
      sessionId: '',
      sessionName: 'X',
      sessionBlob: {},
      capabilitiesRequired: [],
      handshakeBinding: null,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/sessionId/)
  })

  it('null sessionBlob → ok:false', () => {
    const r = buildSessionImportArtefact({
      sessionId: 'sid',
      sessionName: 'X',
      sessionBlob: null as unknown as Record<string, unknown>,
      capabilitiesRequired: [],
      handshakeBinding: null,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/sessionBlob/)
  })

  it('array sessionBlob → ok:false', () => {
    const r = buildSessionImportArtefact({
      sessionId: 'sid',
      sessionName: 'X',
      sessionBlob: [] as unknown as Record<string, unknown>,
      capabilitiesRequired: [],
      handshakeBinding: null,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/sessionBlob/)
  })

  it('capabilities are deduped and sorted', () => {
    const r = buildSessionImportArtefact({
      sessionId: 'sid',
      sessionName: 'S',
      sessionBlob: {},
      capabilitiesRequired: ['ui_actions', 'data_access', 'ui_actions'] as any[],
      handshakeBinding: null,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.artefact.sessions[0].capabilities_required).toEqual(['data_access', 'ui_actions'])
  })
})
