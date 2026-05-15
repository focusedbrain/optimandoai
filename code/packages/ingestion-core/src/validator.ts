/**
 * Stage 2: Validator
 *
 * Validates structural correctness of CandidateCapsuleEnvelope.
 * Produces ValidatedCapsule on success.
 *
 * Fail-closed: ANY structural violation → rejection.
 */

import type {
  CandidateCapsuleEnvelope,
  ValidatedCapsule,
  ValidatedCapsulePayload,
  MessagePackageCapsulePayload,
  ValidationResult,
  ValidationReasonCode,
  ArtefactValidationResult,
  CapsuleType,
} from './types.js';
import { INGESTION_CONSTANTS } from './types.js';

const VALID_CAPSULE_TYPES = new Set([
  'accept',
  'context_sync',
  'initiate',
  'internal_draft',
  'refresh',
  'revoke',
]);

const MESSAGE_PACKAGE_REQUIRED_TOP_LEVEL = ['header', 'metadata'] as const;
const VALID_MESSAGE_PACKAGE_ENCODINGS = new Set(['qBEAP', 'pBEAP', 'qbeap', 'pbeap']);

const VALID_SHARING_MODES = new Set(['receive-only', 'reciprocal']);

const VALID_EXTERNAL_PROCESSING = new Set(['none', 'local_only']);

const VALID_CLOUD_PAYLOAD_MODES = new Set(['none', 'snippet', 'full']);

interface RequiredFieldSpec {
  field: string;
  types?: string[];
  nullable?: boolean;
}

const REQUIRED_FIELDS_BY_TYPE: Record<string, RequiredFieldSpec[]> = {
  initiate: [
    { field: 'handshake_id' },
    { field: 'sender_id' },
    { field: 'capsule_hash' },
    { field: 'timestamp' },
    { field: 'wrdesk_policy_hash' },
    { field: 'seq' },
    { field: 'sender_public_key' },
    { field: 'sender_signature' },
  ],
  accept: [
    { field: 'handshake_id' },
    { field: 'sender_id' },
    { field: 'capsule_hash' },
    { field: 'timestamp' },
    { field: 'sharing_mode' },
    { field: 'wrdesk_policy_hash' },
    { field: 'seq' },
    { field: 'sender_public_key' },
    { field: 'sender_signature' },
    { field: 'countersigned_hash' },
  ],
  refresh: [
    { field: 'handshake_id' },
    { field: 'sender_id' },
    { field: 'capsule_hash' },
    { field: 'timestamp' },
    { field: 'wrdesk_policy_hash' },
    { field: 'seq' },
    { field: 'prev_hash' },
    { field: 'sender_public_key' },
    { field: 'sender_signature' },
  ],
  revoke: [
    { field: 'handshake_id' },
    { field: 'sender_id' },
    { field: 'capsule_hash' },
    { field: 'timestamp' },
    { field: 'sender_public_key' },
    { field: 'sender_signature' },
  ],
  context_sync: [
    { field: 'handshake_id' },
    { field: 'sender_id' },
    { field: 'capsule_hash' },
    { field: 'timestamp' },
    { field: 'wrdesk_policy_hash' },
    { field: 'seq' },
    { field: 'prev_hash' },
    { field: 'context_hash' },
    { field: 'context_commitment', nullable: true },
    { field: 'sender_public_key' },
    { field: 'sender_signature' },
  ],
  internal_draft: [{ field: 'timestamp' }],
};

const HEX_REGEX = /^[0-9a-fA-F]+$/;
const POISONED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// =============================================================================
// Session Import Artefact Validator (Canon A.3.054.8, Annex I.3.3 — PR 1/7)
// =============================================================================

// --- Format regexes ---
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

// --- Closed-world key sets for every object level in the artefact ---

const ARTEFACT_TOP_LEVEL_KEYS = new Set([
  'schema_version', 'artefact_id', 'created_at', 'handshake_binding',
  'purpose', 'sessions', 'policy', 'requested_action', 'sensitive_subcapsule',
]);

const HANDSHAKE_BINDING_KEYS = new Set(['handshake_id', 'bound_at']);

const ARTEFACT_PURPOSE_KEYS = new Set(['declared_purpose', 'scope_constraints']);

const SCOPE_CONSTRAINTS_KEYS = new Set(['max_sessions']);

/** OrchestratorSessionContent — only valid session_kind in v1.0.0 per Resolution 2. */
const ORCHESTRATOR_SESSION_KEYS = new Set([
  'session_kind', 'session_id', 'session_name',
  'agents', 'agent_boxes', 'display_grids', 'capabilities_required',
]);

const PROCESSING_EVENT_KEYS = new Set(['event_class', 'boundary', 'scope']);

const ARTEFACT_POLICY_KEYS = new Set(['processing_events']);

const SENSITIVE_SUBCAPSULE_KEYS = new Set(['ciphertext_ref', 'gate_purpose']);

/** CanonicalDisplayGridConfig keys (canonical-types.ts CanonicalDisplayGridConfig). */
const DISPLAY_GRID_CONFIG_KEYS = new Set(['layout', 'sessionId', 'config', 'timestamp']);

/** DisplayGridInnerConfig keys. */
const DISPLAY_GRID_INNER_CONFIG_KEYS = new Set(['layout', 'sessionId', 'slots']);

/** DisplayGridSlotConfig keys — only boxNumber. */
const DISPLAY_GRID_SLOT_CONFIG_KEYS = new Set(['boxNumber']);

/**
 * CanonicalAgentConfig top-level keys (schema v2.1.0).
 * Recursive checking of nested trigger/listener/reasoning sub-types is deferred:
 * CanonicalTrigger and CanonicalDestination contain `any`-typed arrays which
 * cannot be meaningfully closed without false positives. Top-level key checking
 * still provides meaningful adversarial closure on the agent object envelope.
 */
const CANONICAL_AGENT_CONFIG_TOP_KEYS = new Set([
  '_schemaVersion', '_exportedAt',
  'id', 'name', 'description', 'icon', 'number', 'enabled', 'capabilities',
  'contextSettings', 'memorySettings',
  'listening', 'reasoningSections', 'executionSections',
  'agentContextFiles', 'wrExperts',
]);

/**
 * CanonicalAgentBoxConfig top-level keys (schema v1.0.0).
 * Same rationale as agent config: top-level-only. The runtime may write
 * additional fields (gridLayout, timestamp from grid-script-v2.js) that are
 * NOT in the canonical interface; the artefact builder (PR 3) must strip them.
 */
const CANONICAL_AGENT_BOX_CONFIG_TOP_KEYS = new Set([
  '_schemaVersion', '_exportedAt', '_source', '_helper',
  'id', 'boxNumber', 'agentNumber', 'identifier', 'agentId',
  'title', 'color', 'enabled',
  'provider', 'model', 'userSelectedInferenceModel', 'tools', 'wrExperts',
  'source', 'masterTabId', 'tabIndex', 'side', 'tabUrl',
  'slotId', 'gridSessionId', 'locationId', 'locationLabel',
  'outputId', 'number',
]);

// --- Enum value sets ---
const VALID_REQUESTED_ACTIONS = new Set(['import_only', 'import_and_offer_run']);
const VALID_SESSION_KINDS = new Set(['orchestrator_session']);
const VALID_EVENT_CLASSES = new Set(['semantic_processing', 'actuating_processing']);
const VALID_BOUNDARIES = new Set(['NONE', 'LOCAL', 'REMOTE']);
const VALID_SCOPES = new Set(['MINIMAL', 'SELECTED', 'FULL']);

/**
 * CapabilityClass values mirrored from canonical-types.ts.
 * Hardcoded here because ingestion-core is a zero-dependency package and
 * cannot import from apps/extension-chromium. Must be kept in sync manually
 * when CapabilityClass evolves. (Soft-underbelly — see PR description.)
 */
const VALID_CAPABILITY_CLASSES = new Set([
  'critical_automation', 'monetary', 'ui_actions', 'data_access',
  'session_control', 'network_egress', 'network_ingress',
]);

/** Pinned vocabulary for PurposeIdentifier — Decision A, PR 4/8. v1.0.0 has exactly one value. */
const VALID_PURPOSE_IDENTIFIERS = new Set<string>(['session_share']);

// --- Helpers ---

function failArtefact(reason: ValidationReasonCode, details: string): ArtefactValidationResult {
  return { success: false, reason, details };
}

/**
 * Closed-world key check. Returns a fail result if any key in `obj` is not
 * in `allowedKeys`; returns null if all keys are permitted.
 */
function checkNoUnknownKeys(
  obj: Record<string, unknown>,
  allowedKeys: Set<string>,
  context: string,
): ArtefactValidationResult | null {
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      return failArtefact('ARTEFACT_UNKNOWN_KEY', `${context}: unknown key '${key}'`);
    }
  }
  return null;
}

/** Validate one CanonicalDisplayGridConfig entry. Returns null on success. */
function validateDisplayGridEntry(
  grid: unknown,
  path: string,
): ArtefactValidationResult | null {
  if (typeof grid !== 'object' || grid === null || Array.isArray(grid)) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${path} must be a non-null object`);
  }
  const g = grid as Record<string, unknown>;

  // Resolution 1 — explicit prohibition: agentBoxes must not appear in artefact grid entries.
  if ('agentBoxes' in g) {
    return failArtefact(
      'ARTEFACT_UNKNOWN_KEY',
      `${path}: 'agentBoxes' is prohibited in artefact display grid entries — boxes are declared in agent_boxes[] only (strip before sending, per Resolution 1)`,
    );
  }

  const gCheck = checkNoUnknownKeys(g, DISPLAY_GRID_CONFIG_KEYS, path);
  if (gCheck) return gCheck;

  if (typeof g.layout !== 'string' || g.layout.length === 0) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${path}.layout must be a non-empty string`);
  }
  if (typeof g.sessionId !== 'string' || g.sessionId.length === 0) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${path}.sessionId must be a non-empty string`);
  }
  if (!('config' in g)) {
    return failArtefact('MISSING_REQUIRED_FIELD', `${path}.config is required`);
  }
  if (typeof g.config !== 'object' || g.config === null || Array.isArray(g.config)) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${path}.config must be a non-null object`);
  }
  const config = g.config as Record<string, unknown>;
  const configCheck = checkNoUnknownKeys(config, DISPLAY_GRID_INNER_CONFIG_KEYS, `${path}.config`);
  if (configCheck) return configCheck;

  if (!('slots' in config)) {
    return failArtefact('MISSING_REQUIRED_FIELD', `${path}.config.slots is required`);
  }
  if (typeof config.slots !== 'object' || config.slots === null || Array.isArray(config.slots)) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${path}.config.slots must be a non-null object`);
  }
  const slots = config.slots as Record<string, unknown>;
  for (const slotId of Object.keys(slots)) {
    const slot = slots[slotId];
    const slotPath = `${path}.config.slots[${slotId}]`;
    if (typeof slot !== 'object' || slot === null || Array.isArray(slot)) {
      return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${slotPath} must be a non-null object`);
    }
    const slotObj = slot as Record<string, unknown>;
    const slotCheck = checkNoUnknownKeys(slotObj, DISPLAY_GRID_SLOT_CONFIG_KEYS, slotPath);
    if (slotCheck) return slotCheck;
    if (typeof slotObj.boxNumber !== 'number') {
      return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${slotPath}.boxNumber must be a number`);
    }
  }

  if ('timestamp' in g && g.timestamp !== undefined && typeof g.timestamp !== 'string') {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${path}.timestamp must be a string if present`);
  }
  return null;
}

/** Validate one OrchestratorSessionContent entry. Returns null on success. */
function validateSessionEntry(
  session: unknown,
  idx: number,
): ArtefactValidationResult | null {
  const path = `sessions[${idx}]`;
  if (typeof session !== 'object' || session === null || Array.isArray(session)) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${path} must be a non-null object`);
  }
  const s = session as Record<string, unknown>;

  // Closed-world check on session object
  const sessCheck = checkNoUnknownKeys(s, ORCHESTRATOR_SESSION_KEYS, path);
  if (sessCheck) return sessCheck;

  // session_kind: must be 'orchestrator_session' in v1.0.0
  if (!('session_kind' in s)) {
    return failArtefact('MISSING_REQUIRED_FIELD', `${path}.session_kind is required`);
  }
  if (!VALID_SESSION_KINDS.has(s.session_kind as string)) {
    return failArtefact(
      'ARTEFACT_SESSION_KIND_INVALID',
      `${path}.session_kind must be 'orchestrator_session' in v1.0.0, got: ${String(s.session_kind)}`,
    );
  }

  if (typeof s.session_id !== 'string' || s.session_id.length === 0) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${path}.session_id must be a non-empty string`);
  }
  if (typeof s.session_name !== 'string') {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${path}.session_name must be a string`);
  }

  // agents[]
  if (!Array.isArray(s.agents)) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${path}.agents must be an array`);
  }
  for (let j = 0; j < (s.agents as unknown[]).length; j++) {
    const agent = (s.agents as unknown[])[j];
    const agPath = `${path}.agents[${j}]`;
    if (typeof agent !== 'object' || agent === null || Array.isArray(agent)) {
      return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${agPath} must be a non-null object`);
    }
    const agentCheck = checkNoUnknownKeys(agent as Record<string, unknown>, CANONICAL_AGENT_CONFIG_TOP_KEYS, agPath);
    if (agentCheck) return agentCheck;
  }

  // agent_boxes[]
  if (!Array.isArray(s.agent_boxes)) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${path}.agent_boxes must be an array`);
  }
  for (let j = 0; j < (s.agent_boxes as unknown[]).length; j++) {
    const box = (s.agent_boxes as unknown[])[j];
    const boxPath = `${path}.agent_boxes[${j}]`;
    if (typeof box !== 'object' || box === null || Array.isArray(box)) {
      return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${boxPath} must be a non-null object`);
    }
    const boxCheck = checkNoUnknownKeys(box as Record<string, unknown>, CANONICAL_AGENT_BOX_CONFIG_TOP_KEYS, boxPath);
    if (boxCheck) return boxCheck;
  }

  // display_grids[]
  if (!Array.isArray(s.display_grids)) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${path}.display_grids must be an array`);
  }
  for (let j = 0; j < (s.display_grids as unknown[]).length; j++) {
    const gridResult = validateDisplayGridEntry(
      (s.display_grids as unknown[])[j],
      `${path}.display_grids[${j}]`,
    );
    if (gridResult) return gridResult;
  }

  // capabilities_required[]
  if (!('capabilities_required' in s)) {
    return failArtefact('MISSING_REQUIRED_FIELD', `${path}.capabilities_required is required`);
  }
  if (!Array.isArray(s.capabilities_required)) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${path}.capabilities_required must be an array`);
  }
  for (let k = 0; k < (s.capabilities_required as unknown[]).length; k++) {
    const cap = (s.capabilities_required as unknown[])[k];
    if (typeof cap !== 'string') {
      return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${path}.capabilities_required[${k}] must be a string`);
    }
    if (!VALID_CAPABILITY_CLASSES.has(cap)) {
      return failArtefact('INVALID_ENUM_VALUE', `${path}.capabilities_required[${k}]: unknown capability '${cap}'`);
    }
  }

  return null;
}

/**
 * Structurally validate a session import artefact.
 *
 * Performs every check from Canon A.3.054.8 and Annex I.3.3, in order,
 * fail-closed. Returns { success: true } on full conformance, or
 * { success: false, reason, details } on the first violation.
 *
 * This function does NOT execute, render, or interpret the artefact.
 * Per Annex I.3.3 structural validation is the Validator's sole role.
 * Artefact contents are never logged — only the failed check name.
 *
 * per Canon A.3.054.8, Annex I.3.3
 */
export function validateSessionImportArtefact(artefact: unknown): ArtefactValidationResult {
  // 1. Top-level shape
  if (artefact === null || artefact === undefined || typeof artefact !== 'object' || Array.isArray(artefact)) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'artefact must be a non-null object');
  }
  const obj = artefact as Record<string, unknown>;

  // 7. Closed-world — top level (checked early so unknown-key failures surface before type errors)
  const topCheck = checkNoUnknownKeys(obj, ARTEFACT_TOP_LEVEL_KEYS, 'SessionImportArtefact');
  if (topCheck) return topCheck;

  // 2. schema_version exact match
  if (obj.schema_version !== '1.0.0') {
    return failArtefact('SCHEMA_VERSION_UNSUPPORTED', `schema_version must be '1.0.0', got: ${String(obj.schema_version)}`);
  }

  // 3. Required-field presence
  const requiredFields = [
    'schema_version', 'artefact_id', 'created_at', 'handshake_binding',
    'purpose', 'sessions', 'policy', 'requested_action', 'sensitive_subcapsule',
  ];
  for (const field of requiredFields) {
    if (!(field in obj)) {
      return failArtefact('MISSING_REQUIRED_FIELD', `missing required field: ${field}`);
    }
  }

  // 4+5. Type + format: artefact_id (string, UUID v4)
  if (typeof obj.artefact_id !== 'string') {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'artefact_id must be a string');
  }
  if (!UUID_V4_REGEX.test(obj.artefact_id)) {
    return failArtefact('ARTEFACT_FORMAT_INVALID', 'artefact_id must be a valid UUID v4');
  }

  // 4+5. Type + format: created_at (string, RFC 3339 UTC)
  if (typeof obj.created_at !== 'string') {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'created_at must be a string');
  }
  if (!RFC3339_UTC_REGEX.test(obj.created_at)) {
    return failArtefact('ARTEFACT_FORMAT_INVALID', 'created_at must be RFC 3339 UTC (e.g. 2024-01-01T00:00:00Z)');
  }

  // 4+7. handshake_binding: HandshakeBinding | null
  if (obj.handshake_binding !== null) {
    if (typeof obj.handshake_binding !== 'object' || Array.isArray(obj.handshake_binding)) {
      return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'handshake_binding must be a HandshakeBinding object or null');
    }
    const hb = obj.handshake_binding as Record<string, unknown>;
    const hbCheck = checkNoUnknownKeys(hb, HANDSHAKE_BINDING_KEYS, 'handshake_binding');
    if (hbCheck) return hbCheck;
    if (typeof hb.handshake_id !== 'string' || hb.handshake_id.length === 0) {
      return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'handshake_binding.handshake_id must be a non-empty string');
    }
    if (typeof hb.bound_at !== 'string' || !RFC3339_UTC_REGEX.test(hb.bound_at)) {
      return failArtefact('ARTEFACT_FORMAT_INVALID', 'handshake_binding.bound_at must be RFC 3339 UTC');
    }
  }

  // 4+7. purpose: ArtefactPurpose
  if (typeof obj.purpose !== 'object' || obj.purpose === null || Array.isArray(obj.purpose)) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'purpose must be an ArtefactPurpose object');
  }
  const purpose = obj.purpose as Record<string, unknown>;
  const purposeCheck = checkNoUnknownKeys(purpose, ARTEFACT_PURPOSE_KEYS, 'purpose');
  if (purposeCheck) return purposeCheck;
  if (!('declared_purpose' in purpose) || typeof purpose.declared_purpose !== 'string') {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'purpose.declared_purpose must be a string');
  }
  if (!VALID_PURPOSE_IDENTIFIERS.has(purpose.declared_purpose as string)) {
    return failArtefact('ARTEFACT_PURPOSE_INVALID', `purpose.declared_purpose: unknown purpose '${purpose.declared_purpose}'; v1.0.0 only accepts 'session_share'`);
  }
  if (!('scope_constraints' in purpose)) {
    return failArtefact('MISSING_REQUIRED_FIELD', 'purpose.scope_constraints is required');
  }
  if (typeof purpose.scope_constraints !== 'object' || purpose.scope_constraints === null || Array.isArray(purpose.scope_constraints)) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'purpose.scope_constraints must be a non-null object');
  }
  const sc = purpose.scope_constraints as Record<string, unknown>;
  const scCheck = checkNoUnknownKeys(sc, SCOPE_CONSTRAINTS_KEYS, 'purpose.scope_constraints');
  if (scCheck) return scCheck;
  if ('max_sessions' in sc && sc.max_sessions !== undefined && typeof sc.max_sessions !== 'number') {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'purpose.scope_constraints.max_sessions must be a number');
  }

  // 4+8. sessions: array, length >= 1
  if (!Array.isArray(obj.sessions)) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'sessions must be an array');
  }
  if ((obj.sessions as unknown[]).length < 1) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'sessions must contain at least one entry');
  }
  for (let i = 0; i < (obj.sessions as unknown[]).length; i++) {
    const sessionResult = validateSessionEntry((obj.sessions as unknown[])[i], i);
    if (sessionResult) return sessionResult;
  }

  // 4+6+7. policy: ArtefactPolicy
  if (typeof obj.policy !== 'object' || obj.policy === null || Array.isArray(obj.policy)) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'policy must be an ArtefactPolicy object');
  }
  const policy = obj.policy as Record<string, unknown>;
  const policyCheck = checkNoUnknownKeys(policy, ARTEFACT_POLICY_KEYS, 'policy');
  if (policyCheck) return policyCheck;
  if (!('processing_events' in policy) || !Array.isArray(policy.processing_events)) {
    return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'policy.processing_events must be an array');
  }
  for (let i = 0; i < (policy.processing_events as unknown[]).length; i++) {
    const ev = (policy.processing_events as unknown[])[i];
    const evPath = `policy.processing_events[${i}]`;
    if (typeof ev !== 'object' || ev === null || Array.isArray(ev)) {
      return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', `${evPath} must be a non-null object`);
    }
    const evObj = ev as Record<string, unknown>;
    const evCheck = checkNoUnknownKeys(evObj, PROCESSING_EVENT_KEYS, evPath);
    if (evCheck) return evCheck;
    if (!VALID_EVENT_CLASSES.has(evObj.event_class as string)) {
      return failArtefact('INVALID_ENUM_VALUE', `${evPath}.event_class must be 'semantic_processing' or 'actuating_processing'`);
    }
    if (!VALID_BOUNDARIES.has(evObj.boundary as string)) {
      return failArtefact('INVALID_ENUM_VALUE', `${evPath}.boundary must be NONE, LOCAL, or REMOTE`);
    }
    if (!VALID_SCOPES.has(evObj.scope as string)) {
      return failArtefact('INVALID_ENUM_VALUE', `${evPath}.scope must be MINIMAL, SELECTED, or FULL`);
    }
  }

  // 6. requested_action enum
  if (!VALID_REQUESTED_ACTIONS.has(obj.requested_action as string)) {
    return failArtefact('INVALID_ENUM_VALUE', `requested_action must be 'import_only' or 'import_and_offer_run', got: ${String(obj.requested_action)}`);
  }

  // 4+7. sensitive_subcapsule: SensitiveSubcapsuleRef | null
  if (obj.sensitive_subcapsule !== null) {
    if (typeof obj.sensitive_subcapsule !== 'object' || Array.isArray(obj.sensitive_subcapsule)) {
      return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'sensitive_subcapsule must be a SensitiveSubcapsuleRef object or null');
    }
    const ss = obj.sensitive_subcapsule as Record<string, unknown>;
    const ssCheck = checkNoUnknownKeys(ss, SENSITIVE_SUBCAPSULE_KEYS, 'sensitive_subcapsule');
    if (ssCheck) return ssCheck;
    if (typeof ss.ciphertext_ref !== 'string' || ss.ciphertext_ref.length === 0) {
      return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'sensitive_subcapsule.ciphertext_ref must be a non-empty string');
    }
    if (typeof ss.gate_purpose !== 'string') {
      return failArtefact('STRUCTURAL_INTEGRITY_FAILURE', 'sensitive_subcapsule.gate_purpose must be a string');
    }
  }

  // 9a. Cross-field: import_only MUST NOT have actuating_processing + non-NONE boundary
  if (obj.requested_action === 'import_only') {
    for (let i = 0; i < (policy.processing_events as unknown[]).length; i++) {
      const evObj = (policy.processing_events as unknown[])[i] as Record<string, unknown>;
      if (evObj.event_class === 'actuating_processing' && evObj.boundary !== 'NONE') {
        return failArtefact(
          'ARTEFACT_ACTION_POLICY_INCONSISTENT',
          `import_only artefact may not declare actuating_processing with boundary != NONE (policy.processing_events[${i}])`,
        );
      }
    }
  }

  // 9b. Cross-field: import_and_offer_run MUST have non-empty capabilities_required on >= 1 session
  if (obj.requested_action === 'import_and_offer_run') {
    const sessions = obj.sessions as Record<string, unknown>[];
    const hasCapabilities = sessions.some((s) => {
      const caps = s.capabilities_required;
      return Array.isArray(caps) && (caps as unknown[]).length > 0;
    });
    if (!hasCapabilities) {
      return failArtefact(
        'ARTEFACT_CAPABILITY_DECLARATION_MISSING',
        'import_and_offer_run requires at least one session with non-empty capabilities_required',
      );
    }
  }

  // 9c. Cross-field: non-null sensitive_subcapsule implies import_and_offer_run
  if (obj.sensitive_subcapsule !== null && obj.requested_action !== 'import_and_offer_run') {
    return failArtefact(
      'ARTEFACT_SENSITIVE_SUBCAPSULE_REQUIRES_RUN',
      'sensitive_subcapsule_requires_run_action: non-null sensitive_subcapsule requires requested_action = import_and_offer_run',
    );
  }

  return { success: true };
}

function measureJsonDepth(value: unknown, currentDepth = 0): number {
  if (currentDepth > INGESTION_CONSTANTS.MAX_JSON_DEPTH) return currentDepth;
  if (value === null || value === undefined || typeof value !== 'object') return currentDepth;
  if (Array.isArray(value)) {
    let max = currentDepth;
    for (const item of value) {
      max = Math.max(max, measureJsonDepth(item, currentDepth + 1));
      if (max > INGESTION_CONSTANTS.MAX_JSON_DEPTH) return max;
    }
    return max;
  }
  let max = currentDepth;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    max = Math.max(max, measureJsonDepth((value as Record<string, unknown>)[key], currentDepth + 1));
    if (max > INGESTION_CONSTANTS.MAX_JSON_DEPTH) return max;
  }
  return max;
}

function countFields(value: unknown, limit: number, count: { n: number }): boolean {
  if (value === null || value === undefined || typeof value !== 'object') return true;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!countFields(item, limit, count)) return false;
    }
    return true;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    count.n++;
    if (count.n > limit) return false;
    if (!countFields((value as Record<string, unknown>)[key], limit, count)) return false;
  }
  return true;
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(obj)) {
    if (POISONED_KEYS.has(key)) continue;
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      safe[key] = sanitizeObject(val as Record<string, unknown>);
    } else if (Array.isArray(val)) {
      safe[key] = val.map((item) =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? sanitizeObject(item as Record<string, unknown>)
          : item,
      );
    } else {
      safe[key] = val;
    }
  }
  return safe;
}

export function validateCapsule(candidate: CandidateCapsuleEnvelope): ValidationResult {
  try {
    return runValidation(candidate);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown validation error';
    return { success: false, reason: 'INTERNAL_VALIDATION_ERROR', details: msg };
  }
}

const RELAY_HANDSHAKE_CAPSULE_TYPES = new Set(['accept', 'context_sync', 'refresh', 'revoke', 'initiate']);

/** Matches `hasEncryptedMessagePackageBody` in beapDetection — native wire encrypted artefacts. */
function hasMessagePackageEncryptedBody(obj: Record<string, unknown>): boolean {
  const artefacts = obj.artefactsEnc;
  return (
    'envelope' in obj ||
    'payload' in obj ||
    'payloadEnc' in obj ||
    'innerEnvelopeCiphertext' in obj ||
    (Array.isArray(artefacts) && artefacts.length > 0)
  );
}

function isMessagePackageShape(obj: Record<string, unknown>): boolean {
  const hasHeader = 'header' in obj && obj.header != null && typeof obj.header === 'object';
  const hasMetadata = 'metadata' in obj && obj.metadata != null && typeof obj.metadata === 'object';
  if (!hasHeader || !hasMetadata) return false;

  const ct = obj.capsule_type;
  if (typeof ct === 'string' && RELAY_HANDSHAKE_CAPSULE_TYPES.has(ct.trim())) {
    return false;
  }

  return hasMessagePackageEncryptedBody(obj);
}

function runValidationMessagePackage(
  candidate: CandidateCapsuleEnvelope,
  obj: Record<string, unknown>,
): ValidationResult {
  const depth = measureJsonDepth(obj);
  if (depth > INGESTION_CONSTANTS.MAX_JSON_DEPTH) {
    return fail('STRUCTURAL_INTEGRITY_FAILURE', `JSON depth ${depth} exceeds limit ${INGESTION_CONSTANTS.MAX_JSON_DEPTH}`);
  }

  const fieldCount = { n: 0 };
  if (!countFields(obj, INGESTION_CONSTANTS.MAX_FIELDS, fieldCount)) {
    return fail('STRUCTURAL_INTEGRITY_FAILURE', `Field count exceeds limit ${INGESTION_CONSTANTS.MAX_FIELDS}`);
  }

  for (const field of MESSAGE_PACKAGE_REQUIRED_TOP_LEVEL) {
    if (!(field in obj) || obj[field] === undefined) {
      return fail('MISSING_REQUIRED_FIELD', `Message package missing required field: ${field}`);
    }
    if (typeof obj[field] !== 'object' || obj[field] === null) {
      return fail('MISSING_REQUIRED_FIELD', `Message package field ${field} must be a non-empty object`);
    }
  }

  if (!hasMessagePackageEncryptedBody(obj)) {
    return fail(
      'MISSING_REQUIRED_FIELD',
      'Message package must have envelope, payload, encrypted fields (payloadEnc / innerEnvelopeCiphertext), or artefactsEnc',
    );
  }

  // Validate header.encoding if present (qBEAP or pBEAP, case-insensitive)
  const header = obj.header;
  if (header && typeof header === 'object') {
    const enc = (header as Record<string, unknown>).encoding;
    if (typeof enc === 'string' && enc.trim().length > 0) {
      const encNorm = enc.toUpperCase();
      if (encNorm !== 'QBEAP' && encNorm !== 'PBEAP') {
        return fail('INVALID_ENUM_VALUE', `Message package header.encoding must be qBEAP or pBEAP, got: ${enc}`);
      }
    }
  }

  const payloadSize = Buffer.byteLength(JSON.stringify(obj));
  if (payloadSize > INGESTION_CONSTANTS.MAX_PAYLOAD_BYTES) {
    return fail('PAYLOAD_SIZE_EXCEEDED', `Payload size ${payloadSize} exceeds limit ${INGESTION_CONSTANTS.MAX_PAYLOAD_BYTES}`);
  }

  const safeObj = sanitizeObject(obj);
  // Construction note: `safeObj` is a Record<string, unknown> spread of the entire
  // sanitized capsule.  We use `as unknown as MessagePackageCapsulePayload` because
  // the spread carries all wire fields; downstream consumers that need fields not
  // enumerated in the type cast to `Record<string, any>` at their call site.
  const validatedPayload = {
    ...safeObj,
    handshake_id: extractHandshakeIdFromMessagePackage(safeObj),
    capsule_type: 'message_package' as const,
    content_type: 'beap_message_package' as const,
    schema_version: 2,
  } as unknown as MessagePackageCapsulePayload;

  const validated = createValidatedCapsule(candidate, validatedPayload);
  return { success: true, validated };
}

function extractHandshakeIdFromMessagePackage(obj: Record<string, unknown>): string | undefined {
  const header = obj.header;
  if (header && typeof header === 'object') {
    const rb = (header as Record<string, unknown>)?.receiver_binding;
    if (rb && typeof rb === 'object' && 'handshake_id' in rb) {
      const id = (rb as Record<string, unknown>).handshake_id;
      if (typeof id === 'string' && id.trim().length > 0) return id.trim();
    }
  }
  return undefined;
}

function runValidation(candidate: CandidateCapsuleEnvelope): ValidationResult {
  if (candidate.ingestion_error_flag) {
    return fail('INGESTION_ERROR_PROPAGATED', candidate.ingestion_error_details ?? 'Ingestion error propagated');
  }

  const payload = candidate.raw_payload;
  if (payload === null || payload === undefined || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail('MALFORMED_JSON', 'raw_payload is not a valid JSON object');
  }

  const obj = payload as Record<string, unknown>;

  if (
    Object.prototype.hasOwnProperty.call(obj, '__proto__') ||
    Object.prototype.hasOwnProperty.call(obj, 'prototype')
  ) {
    return fail('STRUCTURAL_INTEGRITY_FAILURE', 'Prototype pollution attempt detected');
  }

  if (isMessagePackageShape(obj)) {
    return runValidationMessagePackage(candidate, obj);
  }

  const depth = measureJsonDepth(obj);
  if (depth > INGESTION_CONSTANTS.MAX_JSON_DEPTH) {
    return fail('STRUCTURAL_INTEGRITY_FAILURE', `JSON depth ${depth} exceeds limit ${INGESTION_CONSTANTS.MAX_JSON_DEPTH}`);
  }

  const fieldCount = { n: 0 };
  if (!countFields(obj, INGESTION_CONSTANTS.MAX_FIELDS, fieldCount)) {
    return fail('STRUCTURAL_INTEGRITY_FAILURE', `Field count exceeds limit ${INGESTION_CONSTANTS.MAX_FIELDS}`);
  }

  if (!('schema_version' in obj)) {
    return fail('MISSING_REQUIRED_FIELD', 'Missing required field: schema_version');
  }
  if (!INGESTION_CONSTANTS.SUPPORTED_SCHEMA_VERSIONS.includes(obj.schema_version as number)) {
    return fail('SCHEMA_VERSION_UNSUPPORTED', `Unsupported schema_version: ${obj.schema_version}`);
  }

  if (!('capsule_type' in obj)) {
    return fail('MISSING_REQUIRED_FIELD', 'Missing required field: capsule_type');
  }
  if (typeof obj.capsule_type !== 'string' || !VALID_CAPSULE_TYPES.has(obj.capsule_type)) {
    return fail('INVALID_ENUM_VALUE', `Invalid capsule_type: ${obj.capsule_type}`);
  }
  const capsuleType = obj.capsule_type as CapsuleType;

  const requiredFields = REQUIRED_FIELDS_BY_TYPE[capsuleType] ?? [];
  for (const spec of requiredFields) {
    if (!(spec.field in obj) || obj[spec.field] === undefined) {
      return fail('MISSING_REQUIRED_FIELD', `Missing required field: ${spec.field} for capsule_type ${capsuleType}`);
    }
    if (!spec.nullable && obj[spec.field] === null) {
      return fail('MISSING_REQUIRED_FIELD', `Required field ${spec.field} cannot be null for capsule_type ${capsuleType}`);
    }
  }

  if ('sharing_mode' in obj && obj.sharing_mode !== undefined) {
    if (typeof obj.sharing_mode !== 'string' || !VALID_SHARING_MODES.has(obj.sharing_mode)) {
      return fail('INVALID_ENUM_VALUE', `Invalid sharing_mode: ${obj.sharing_mode}`);
    }
  }
  if ('external_processing' in obj && obj.external_processing !== undefined) {
    if (typeof obj.external_processing !== 'string') {
      return fail('INVALID_ENUM_VALUE', `Invalid external_processing: ${obj.external_processing}`);
    }
    if (!VALID_EXTERNAL_PROCESSING.has(obj.external_processing) && !String(obj.external_processing).match(/^[a-z0-9_-]+$/i)) {
      return fail('INVALID_ENUM_VALUE', `Invalid external_processing: ${obj.external_processing}`);
    }
  }
  if ('cloud_payload_mode' in obj && obj.cloud_payload_mode !== undefined) {
    if (typeof obj.cloud_payload_mode !== 'string' || !VALID_CLOUD_PAYLOAD_MODES.has(obj.cloud_payload_mode)) {
      return fail('INVALID_ENUM_VALUE', `Invalid cloud_payload_mode: ${obj.cloud_payload_mode}`);
    }
  }

  if ('seq' in obj && obj.seq !== undefined) {
    if (typeof obj.seq !== 'number' || !Number.isInteger(obj.seq) || obj.seq < 0) {
      return fail('STRUCTURAL_INTEGRITY_FAILURE', 'Invalid seq: must be a non-negative integer');
    }
  }
  if ('timestamp' in obj && obj.timestamp !== undefined) {
    if (typeof obj.timestamp !== 'string') {
      return fail('STRUCTURAL_INTEGRITY_FAILURE', 'timestamp must be a string');
    }
  }
  if ('handshake_id' in obj && obj.handshake_id !== undefined) {
    if (typeof obj.handshake_id !== 'string' || obj.handshake_id.length === 0) {
      return fail('STRUCTURAL_INTEGRITY_FAILURE', 'handshake_id must be a non-empty string');
    }
  }
  if ('context_blocks' in obj && obj.context_blocks !== undefined) {
    if (!Array.isArray(obj.context_blocks)) {
      return fail('STRUCTURAL_INTEGRITY_FAILURE', 'context_blocks must be an array');
    }
  }

  if (capsuleType !== 'internal_draft') {
    if (!('capsule_hash' in obj) || typeof obj.capsule_hash !== 'string') {
      return fail('CRYPTOGRAPHIC_FIELD_MISSING', 'capsule_hash is required');
    }
    if (!('sender_id' in obj) || typeof obj.sender_id !== 'string') {
      return fail('CRYPTOGRAPHIC_FIELD_MISSING', 'sender_id is required');
    }
  }

  if ('capsule_hash' in obj && typeof obj.capsule_hash === 'string') {
    if (!HEX_REGEX.test(obj.capsule_hash)) {
      return fail('HASH_BINDING_MISMATCH', 'capsule_hash is not valid hex');
    }
    if (obj.capsule_hash.length !== 64) {
      return fail('HASH_BINDING_MISMATCH', `capsule_hash wrong length: expected 64, got ${obj.capsule_hash.length}`);
    }
  }
  if ('prev_hash' in obj && obj.prev_hash !== undefined && typeof obj.prev_hash === 'string') {
    if (!HEX_REGEX.test(obj.prev_hash)) {
      return fail('HASH_BINDING_MISMATCH', 'prev_hash is not valid hex');
    }
    if (obj.prev_hash.length !== 64) {
      return fail('HASH_BINDING_MISMATCH', `prev_hash wrong length: expected 64, got ${(obj.prev_hash as string).length}`);
    }
  }

  if ('sender_public_key' in obj && obj.sender_public_key !== undefined) {
    if (typeof obj.sender_public_key !== 'string' || !HEX_REGEX.test(obj.sender_public_key) || obj.sender_public_key.length !== 64) {
      return fail('STRUCTURAL_INTEGRITY_FAILURE', 'sender_public_key must be exactly 64-char hex');
    }
  }
  if ('sender_signature' in obj && obj.sender_signature !== undefined) {
    if (typeof obj.sender_signature !== 'string' || !HEX_REGEX.test(obj.sender_signature) || obj.sender_signature.length !== 128) {
      return fail('STRUCTURAL_INTEGRITY_FAILURE', 'sender_signature must be exactly 128-char hex');
    }
  }
  if ('countersigned_hash' in obj && obj.countersigned_hash !== undefined) {
    if (typeof obj.countersigned_hash !== 'string' || !HEX_REGEX.test(obj.countersigned_hash) || obj.countersigned_hash.length !== 128) {
      return fail('STRUCTURAL_INTEGRITY_FAILURE', 'countersigned_hash must be exactly 128-char hex');
    }
  }

  const payloadSize = Buffer.byteLength(JSON.stringify(payload));
  if (payloadSize > INGESTION_CONSTANTS.MAX_PAYLOAD_BYTES) {
    return fail('PAYLOAD_SIZE_EXCEEDED', `Payload size ${payloadSize} exceeds limit ${INGESTION_CONSTANTS.MAX_PAYLOAD_BYTES}`);
  }

  const safeObj = sanitizeObject(obj);
  // Same intentional cast as the message_package path — see note in runValidationMessagePackage.
  const validatedPayload = {
    capsule_type: capsuleType,
    content_type: 'handshake_capsule' as const,
    schema_version: (obj.schema_version as number) ?? 2,
    handshake_id: typeof safeObj.handshake_id === 'string' ? safeObj.handshake_id : undefined,
    ...safeObj,
  } as unknown as ValidatedCapsulePayload;

  // Step D (PR 1/7): if the capsule plaintext carries a session_import_artefact,
  // validate it structurally. Absence is conformant; presence of a malformed
  // artefact fails the entire capsule. per Canon A.3.054.8, Annex I.3.3.
  if ('session_import_artefact' in safeObj && safeObj.session_import_artefact !== undefined) {
    const artefactResult = validateSessionImportArtefact(safeObj.session_import_artefact);
    if (!artefactResult.success) {
      return fail(
        artefactResult.reason,
        `session_import_artefact failed validation: ${artefactResult.details}`,
      );
    }
  }

  const validated = createValidatedCapsule(candidate, validatedPayload);
  return { success: true, validated };
}

function createValidatedCapsule(
  candidate: CandidateCapsuleEnvelope,
  parsedPayload: ValidatedCapsulePayload,
): ValidatedCapsule {
  return {
    __brand: 'ValidatedCapsule',
    provenance: candidate.provenance,
    capsule: parsedPayload,
    validated_at: new Date().toISOString(),
    validator_version: INGESTION_CONSTANTS.VALIDATOR_VERSION,
    schema_version: (parsedPayload.schema_version as number) ?? 2,
  };
}

function fail(reason: ValidationReasonCode, details: string): ValidationResult {
  return { success: false, reason, details };
}
