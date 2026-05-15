/**
 * buildSessionImportArtefact
 *
 * Shared helper that maps a session's runtime state into a conforming
 * SessionImportArtefact. One source of truth; all four sender surfaces call
 * this function at send time (Decision E: send-time bind, not select-time bind).
 *
 * Design decisions encoded here:
 *   Decision A — PurposeIdentifier is always 'session_share' (v1.0.0 canonical).
 *   Decision B — capabilities_required is CapabilityClass[].
 *   Decision C — empty capabilities_required → requested_action = 'import_only'.
 *   Decision D — structural failures return { ok: false } so callers can abort
 *                and display an error instead of silently omitting the artefact.
 *
 * This helper does NOT call validateSessionImportArtefact. The receive-side
 * Validator is the conformance authority. This helper performs only the
 * structural sanity checks needed to guarantee well-formed output.
 *
 * Capability note: CanonicalAgentBoxConfig and CanonicalAgentConfig do not
 * carry CapabilityClass fields. Capabilities must be supplied by the caller
 * from the session's own capability declaration (OrchestratorSessionContent
 * .capabilities_required in the orchestrator DB / chrome.storage.local).
 *
 * per Canon A.3.054.8, A.3.054.9.1, A.3.054.14.1, I.11.5
 */

import type {
  SessionImportArtefact,
  OrchestratorSessionContent,
  CapabilityClass,
} from './canonical-types'
import type { CanonicalAgentConfig } from '../types/CanonicalAgentConfig'
import type { CanonicalAgentBoxConfig } from '../types/CanonicalAgentBoxConfig'
import type { CanonicalDisplayGridConfig } from '../types/CanonicalDisplayGridConfig'

// =============================================================================
// Public API
// =============================================================================

export interface BuildArtefactInput {
  sessionId: string
  sessionName: string
  agents: CanonicalAgentConfig[]
  agentBoxes: CanonicalAgentBoxConfig[]
  displayGrids: CanonicalDisplayGridConfig[]
  /**
   * Capabilities declared by this session.
   *
   * These come from OrchestratorSessionContent.capabilities_required in the
   * orchestrator DB (Electron) or chrome.storage.local (extension). The caller
   * is responsible for extracting them from the stored session config.
   *
   * Note: CanonicalAgentBoxConfig and CanonicalAgentConfig do not carry
   * CapabilityClass fields; capability data lives on the session record itself.
   */
  capabilitiesRequired: CapabilityClass[]
  /** Cryptographic handshake binding, or null when sending unbound. */
  handshakeBinding: { handshake_id: string; bound_at: string } | null
}

export type BuildArtefactResult =
  | { ok: true; artefact: SessionImportArtefact }
  | { ok: false; reason: string }

// =============================================================================
// Implementation
// =============================================================================

export function buildSessionImportArtefact(
  input: BuildArtefactInput,
): BuildArtefactResult {
  // 1. Validate inputs are well-formed.
  if (!input.sessionId || typeof input.sessionId !== 'string') {
    return { ok: false, reason: 'sessionId must be a non-empty string' }
  }
  if (!input.sessionName || typeof input.sessionName !== 'string') {
    return { ok: false, reason: 'sessionName must be a non-empty string' }
  }
  if (!Array.isArray(input.agents)) {
    return { ok: false, reason: 'agents must be an array' }
  }
  if (!Array.isArray(input.agentBoxes)) {
    return { ok: false, reason: 'agentBoxes must be an array' }
  }
  if (!Array.isArray(input.displayGrids)) {
    return { ok: false, reason: 'displayGrids must be an array' }
  }
  if (!Array.isArray(input.capabilitiesRequired)) {
    return { ok: false, reason: 'capabilitiesRequired must be an array' }
  }

  // 2. Apply Decision C: dedupe, sort, and determine requested_action.
  const capabilitySet = new Set(input.capabilitiesRequired)
  const capabilities: CapabilityClass[] = [...capabilitySet].sort() as CapabilityClass[]
  const requestedAction = capabilities.length === 0 ? 'import_only' : 'import_and_offer_run'

  // 3. Compose OrchestratorSessionContent.
  const sessionContent: OrchestratorSessionContent = {
    session_kind: 'orchestrator_session',
    session_id: input.sessionId,
    session_name: input.sessionName,
    agents: input.agents,
    agent_boxes: input.agentBoxes,
    display_grids: input.displayGrids,
    capabilities_required: capabilities,
  }

  // 4. Build SessionImportArtefact.
  let artefactId: string
  try {
    artefactId = crypto.randomUUID()
  } catch {
    return { ok: false, reason: 'Failed to generate artefact UUID' }
  }

  const createdAt = new Date().toISOString()

  const artefact: SessionImportArtefact = {
    schema_version: '1.0.0',
    artefact_id: artefactId,
    created_at: createdAt,
    handshake_binding: input.handshakeBinding,
    purpose: {
      declared_purpose: 'session_share',
      scope_constraints: {},
    },
    sessions: [sessionContent],
    policy: {
      processing_events: [],  // default-deny per A.3.054.14.1
    },
    requested_action: requestedAction,
    sensitive_subcapsule: null,  // PR 4 does not produce sensitive sub-capsules
  }

  return { ok: true, artefact }
}
