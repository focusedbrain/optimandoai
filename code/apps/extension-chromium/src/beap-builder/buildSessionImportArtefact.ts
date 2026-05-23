/**
 * buildSessionImportArtefact
 *
 * Shared helper that maps a session's runtime state into a conforming
 * SessionImportArtefact. One source of truth; all sender surfaces call
 * this function at send time (Decision E: send-time bind, not select-time bind).
 *
 * Design decisions encoded here:
 *   Decision A — PurposeIdentifier is always 'session_share' (canonical).
 *   Decision B — capabilities_required is CapabilityClass[].
 *   Decision C — empty capabilities_required → requested_action = 'import_only'.
 *   Decision D — structural failures return { ok: false } so callers can abort
 *                and display an error instead of silently omitting the artefact.
 *   Decision F — schema_version '1.1.0': sessions[0] is FullSessionExportContent,
 *                carrying the full session KV blob in session_export. This makes
 *                the BEAP-embedded session byte-equivalent to a file export of the
 *                same source. Old receivers surface SCHEMA_VERSION_UNSUPPORTED
 *                ("update required") — they do not silently drop fields.
 *
 * This helper does NOT call validateSessionImportArtefact. The receive-side
 * validator is the conformance authority. This helper performs only the
 * structural sanity checks needed to guarantee well-formed output.
 *
 * per Canon A.3.054.8, A.3.054.9.1, A.3.054.14.1, I.11.5
 */

import type {
  SessionImportArtefact,
  FullSessionExportContent,
  CapabilityClass,
} from './canonical-types'

// =============================================================================
// Public API
// =============================================================================

export interface BuildArtefactInput {
  sessionId: string
  sessionName: string
  /**
   * Complete session KV blob as stored in the orchestrator DB / chrome.storage.local.
   * This is the authoritative source of session state. All fields present in the
   * file-export path — agents, agentBoxes, displayGrids, helperTabs, hybridViews,
   * goals, uiConfig, url, memory, context, etc. — are embedded verbatim.
   *
   * Do not decompose this blob before passing it. The builder embeds it opaquely
   * so the receive side can delegate directly to normalizeImportedSessionPayload.
   */
  sessionBlob: Record<string, unknown>
  /**
   * Capabilities declared by this session.
   * The caller is responsible for extracting them from the stored session config
   * (capabilities_required field on the session record).
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
  if (!input.sessionBlob || typeof input.sessionBlob !== 'object' || Array.isArray(input.sessionBlob)) {
    return { ok: false, reason: 'sessionBlob must be a non-null object' }
  }
  if (!Array.isArray(input.capabilitiesRequired)) {
    return { ok: false, reason: 'capabilitiesRequired must be an array' }
  }

  // 2. Apply Decision C: dedupe, sort, and determine requested_action.
  const capabilitySet = new Set(input.capabilitiesRequired)
  const capabilities: CapabilityClass[] = [...capabilitySet].sort() as CapabilityClass[]
  const requestedAction = capabilities.length === 0 ? 'import_only' : 'import_and_offer_run'

  // 3. Compose FullSessionExportContent (schema v1.1.0).
  //    The full KV blob travels verbatim in session_export so the receiver can
  //    delegate directly to normalizeImportedSessionPayload without any BEAP-specific
  //    normalization branch — it is handled identically to a file import.
  const sessionContent: FullSessionExportContent = {
    session_kind: 'full_session_export',
    session_id: input.sessionId,
    session_name: input.sessionName,
    capabilities_required: capabilities,
    session_export: input.sessionBlob,
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
    schema_version: '1.1.0',
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
