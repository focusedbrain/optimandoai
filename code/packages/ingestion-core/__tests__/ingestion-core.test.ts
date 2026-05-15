import { describe, test, expect } from 'vitest';
import {
  validateInput,
  ingestInput,
  validateCapsule,
  validateSessionImportArtefact,
  validateDecryptedBeapContent,
  CONTENT_VALIDATOR_VERSION,
  detectBeapCapsule,
  routeValidatedCapsule,
  isCoordinationRelayNativeBeap,
  isMessagePackageStructure,
  type RawInput,
  type TransportMetadata,
} from '@repo/ingestion-core';

const emptyTransport: TransportMetadata = {};

function validBeapPayload(): Record<string, unknown> {
  return {
    schema_version: 1,
    capsule_type: 'initiate',
    handshake_id: 'hs-001',
    sender_id: 'user-1',
    capsule_hash: 'a'.repeat(64),
    timestamp: new Date().toISOString(),
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
    sender_public_key: 'c'.repeat(64),
    sender_signature: 'd'.repeat(128),
  };
}

describe('ingestion-core', () => {
  test('validateInput: valid BEAP → success, handshake_pipeline', () => {
    const rawInput: RawInput = { body: JSON.stringify(validBeapPayload()) };
    const result = validateInput(rawInput, 'email', emptyTransport);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.validated).toBeDefined();
      expect(result.distribution).toBeDefined();
      expect(result.distribution!.target).toBe('handshake_pipeline');
      expect(result.validated!.__brand).toBe('ValidatedCapsule');
    }
  });

  test('validateInput: malformed JSON → rejected', () => {
    const rawInput: RawInput = {
      body: '{invalid json!',
      mime_type: 'application/vnd.beap+json',
    };
    const result = validateInput(rawInput, 'email', emptyTransport);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.validation_reason_code).toBe('INGESTION_ERROR_PROPAGATED');
    }
  });

  test('validateInput: plain content → internal_draft → sandbox', () => {
    const rawInput: RawInput = { body: 'Hello, plain email.' };
    const result = validateInput(rawInput, 'email', emptyTransport);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.distribution!.target).toBe('sandbox_sub_orchestrator');
      expect(result.validated!.capsule.capsule_type).toBe('internal_draft');
    }
  });

  test('validateInput: unsupported schema_version → rejected', () => {
    const rawInput: RawInput = {
      body: JSON.stringify({ schema_version: 99, capsule_type: 'initiate' }),
    };
    const result = validateInput(rawInput, 'api', emptyTransport);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.validation_reason_code).toBe('SCHEMA_VERSION_UNSUPPORTED');
    }
  });

  test('detectBeapCapsule: JSON structure detection', () => {
    const input: RawInput = { body: JSON.stringify(validBeapPayload()) };
    const result = detectBeapCapsule(input);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.detection_method).toBe('json_structure');
      expect((result.raw_capsule_json as Record<string, unknown>).capsule_type).toBe('initiate');
    }
  });

  test('ingestInput + validateCapsule: chain works', () => {
    const rawInput: RawInput = { body: JSON.stringify(validBeapPayload()) };
    const candidate = ingestInput(rawInput, 'p2p', emptyTransport);
    expect(candidate.__brand).toBe('CandidateCapsule');
    expect(candidate.ingestion_error_flag).toBe(false);

    const validation = validateCapsule(candidate);
    expect(validation.success).toBe(true);
    if (validation.success) {
      const distribution = routeValidatedCapsule(validation.validated);
      expect(distribution.target).toBe('handshake_pipeline');
    }
  });

  test('validateInput: message package (qBEAP/pBEAP) → success, message_relay', () => {
    const messagePackage = {
      header: {
        receiver_binding: { handshake_id: 'hs-msg-001' },
      },
      metadata: { created_at: new Date().toISOString() },
      envelope: { encrypted: 'base64...' },
    };
    const rawInput: RawInput = { body: JSON.stringify(messagePackage) };
    const result = validateInput(rawInput, 'coordination_service', emptyTransport);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.validated).toBeDefined();
      expect(result.distribution).toBeDefined();
      expect(result.distribution!.target).toBe('message_relay');
      expect(result.validated!.capsule.capsule_type).toBe('message_package');
      expect(result.validated!.capsule.handshake_id).toBe('hs-msg-001');
    }
  });

  test('validateInput: wire with capsule_type null → message_relay (relay gate)', () => {
    const wire = {
      header: { receiver_binding: { handshake_id: 'hs-null-ct' } },
      metadata: { created_at: new Date().toISOString() },
      payloadEnc: { chunking: { count: 1, enabled: true, maxChunkBytes: 262144, merkleRoot: 'z' } },
      capsule_type: null,
    };
    const rawInput: RawInput = { body: JSON.stringify(wire) };
    const result = validateInput(rawInput, 'coordination_service', emptyTransport);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.distribution!.target).toBe('message_relay');
      expect(result.validated!.capsule.capsule_type).toBe('message_package');
    }
  });

  test('validateInput: qBEAP wire shape (payloadEnc) → success, message_relay', () => {
    const qbeapPackage = {
      header: {
        encoding: 'qBEAP',
        receiver_binding: { handshake_id: 'hs-qbeap-1' },
      },
      metadata: { created_at: new Date().toISOString() },
      payloadEnc: {
        sha256Plain: 'a'.repeat(64),
        bytesPlain: 100,
        chunking: { enabled: true, count: 1, maxChunkBytes: 262144, merkleRoot: 'b'.repeat(64) },
        chunks: [],
      },
    };
    const rawInput: RawInput = { body: JSON.stringify(qbeapPackage) };
    const result = validateInput(rawInput, 'coordination_service', emptyTransport);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.distribution!.target).toBe('message_relay');
      expect(result.validated!.capsule.handshake_id).toBe('hs-qbeap-1');
    }
  });

  test('detectBeapCapsule: message package structure (json_structure path)', () => {
    const messagePackage = {
      header: {},
      metadata: {},
      envelope: {},
    };
    const input: RawInput = { body: JSON.stringify(messagePackage) };
    const result = detectBeapCapsule(input);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.is_message_package).toBe(true);
    }
  });

  test('detectBeapCapsule: message package via mime_type', () => {
    const messagePackage = {
      header: { receiver_binding: { handshake_id: 'hs-x' } },
      metadata: {},
      envelope: {},
    };
    const input: RawInput = {
      body: JSON.stringify(messagePackage),
      mime_type: 'application/vnd.beap+json',
    };
    const result = detectBeapCapsule(input);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.is_message_package).toBe(true);
    }
  });

  test('runs without Electron, DB, or better-sqlite3', () => {
    expect(typeof process).toBe('object');
    expect(typeof process.versions.node).toBe('string');
    const result = validateInput(
      { body: JSON.stringify(validBeapPayload()) },
      'internal',
      emptyTransport,
    );
    expect(result.success).toBe(true);
  });

  test('isCoordinationRelayNativeBeap: qBEAP wire without top-level capsule_type', () => {
    const wire = {
      handshake_id: 'h1',
      header: {},
      metadata: {},
      payloadEnc: { chunking: { count: 1 } },
    };
    expect(isCoordinationRelayNativeBeap(wire)).toBe(true);
    expect(isMessagePackageStructure(wire)).toBe(true);
  });

  test('isCoordinationRelayNativeBeap: stringified header/metadata', () => {
    const wire = {
      handshake_id: 'h2',
      header: JSON.stringify({}),
      metadata: JSON.stringify({}),
      payloadEnc: {},
    };
    expect(isMessagePackageStructure(wire)).toBe(false);
    expect(isCoordinationRelayNativeBeap(wire)).toBe(true);
  });

  test('isCoordinationRelayNativeBeap: false for initiate discriminator', () => {
    const w = {
      handshake_id: 'h3',
      capsule_type: 'initiate',
      header: {},
      metadata: {},
      payloadEnc: {},
    };
    expect(isCoordinationRelayNativeBeap(w)).toBe(false);
  });

  test('isCoordinationRelayNativeBeap: artefactsEnc alone as encrypted signal (pre-artefact)', () => {
    const w = {
      handshake_id: 'h4',
      header: {},
      metadata: {},
      artefactsEnc: [{ x: 1 }],
    };
    expect(isCoordinationRelayNativeBeap(w)).toBe(true);
  });

  test('validateInput: coordination_service + stringified header/metadata → message_relay (aligned with relay gate)', () => {
    const wire = {
      handshake_id: 'hs-str',
      header: JSON.stringify({
        receiver_binding: { handshake_id: 'hs-str' },
      }),
      metadata: JSON.stringify({ created_at: new Date().toISOString() }),
      payloadEnc: { chunking: { count: 1, enabled: true, maxChunkBytes: 262144, merkleRoot: 'a'.repeat(64) } },
    };
    const rawInput: RawInput = { body: JSON.stringify(wire) };
    const result = validateInput(rawInput, 'coordination_service', emptyTransport);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.distribution!.target).toBe('message_relay');
      expect(result.validated!.capsule.capsule_type).toBe('message_package');
    }
  });

  test('validateInput: coordination_service + artefactsEnc-only → message_relay', () => {
    const w = {
      handshake_id: 'hs-art',
      header: {
        receiver_binding: { handshake_id: 'hs-art' },
      },
      metadata: { created_at: new Date().toISOString() },
      artefactsEnc: [{ chunking: { count: 1, enabled: true, maxChunkBytes: 1024, merkleRoot: 'b'.repeat(64) } }],
    };
    const rawInput: RawInput = { body: JSON.stringify(w) };
    const result = validateInput(rawInput, 'coordination_service', emptyTransport);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.distribution!.target).toBe('message_relay');
    }
  });
});

// =============================================================================
// validateSessionImportArtefact — Unit Tests (PR 1/7, Canon A.3.054.8)
// Tests 1–19: structural validation of the artefact in isolation.
// Tests 20–22: integration with validateCapsule (Step D wiring).
// All artefacts in tests are synthetic fixtures (no real builder output exists
// until PR 3).
// =============================================================================

/** Minimal valid OrchestratorSessionContent with empty sub-arrays. */
function validSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_kind: 'orchestrator_session',
    session_id: 'session_1714000000000',
    session_name: 'Test Session',
    agents: [],
    agent_boxes: [],
    display_grids: [],
    capabilities_required: [],
    ...overrides,
  };
}

/** Minimal valid import_only artefact. */
function validImportOnlyArtefact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: '1.0.0',
    artefact_id: '550e8400-e29b-41d4-a716-446655440000',
    created_at: '2026-05-04T17:36:00Z',
    handshake_binding: null,
    purpose: {
      declared_purpose: 'session_share',
      scope_constraints: {},
    },
    sessions: [validSession()],
    policy: { processing_events: [] },
    requested_action: 'import_only',
    sensitive_subcapsule: null,
    ...overrides,
  };
}

/** Valid import_and_offer_run artefact with capabilities declared. */
function validRunArtefact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...validImportOnlyArtefact(),
    requested_action: 'import_and_offer_run',
    sessions: [validSession({ capabilities_required: ['session_control'] })],
    policy: {
      processing_events: [
        { event_class: 'semantic_processing', boundary: 'LOCAL', scope: 'SELECTED' },
      ],
    },
    ...overrides,
  };
}

/** Minimal valid internal_draft capsule payload. */
function draftCapsule(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    capsule_type: 'internal_draft',
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

describe('validateSessionImportArtefact — unit tests', () => {

  // Test 1: valid minimal import_only artefact
  test('1. valid minimal import_only artefact → ok', () => {
    const result = validateSessionImportArtefact(validImportOnlyArtefact());
    expect(result.success).toBe(true);
  });

  // Test 2: valid import_and_offer_run with capabilities and policy
  test('2. valid import_and_offer_run with capabilities → ok', () => {
    const result = validateSessionImportArtefact(validRunArtefact());
    expect(result.success).toBe(true);
  });

  // Test 3: valid handshake-bound artefact with sensitive sub-capsule
  test('3. valid handshake-bound artefact with sensitive_subcapsule → ok', () => {
    const artefact = validRunArtefact({
      handshake_binding: {
        handshake_id: 'hs-abc123',
        bound_at: '2026-05-04T17:00:00Z',
      },
      sensitive_subcapsule: {
        ciphertext_ref: 'beap-cipher-ref-xyz',
        gate_purpose: 'session_transfer',
      },
    });
    const result = validateSessionImportArtefact(artefact);
    expect(result.success).toBe(true);
  });

  // Test 4: wrong schema_version
  test('4. wrong schema_version → reject', () => {
    const result = validateSessionImportArtefact(validImportOnlyArtefact({ schema_version: '2.0.0' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('SCHEMA_VERSION_UNSUPPORTED');
    }
  });

  // Test 5: missing required field (artefact_id)
  test('5. missing artefact_id → reject', () => {
    const artefact = validImportOnlyArtefact();
    delete artefact.artefact_id;
    const result = validateSessionImportArtefact(artefact);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('MISSING_REQUIRED_FIELD');
      expect(result.details).toMatch(/artefact_id/);
    }
  });

  // Test 6: type mismatch — sessions is a string instead of array
  test('6. sessions is not an array → reject', () => {
    const result = validateSessionImportArtefact(validImportOnlyArtefact({ sessions: 'not an array' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('STRUCTURAL_INTEGRITY_FAILURE');
      expect(result.details).toMatch(/sessions/);
    }
  });

  // Test 7: unknown enum value for requested_action
  test('7. requested_action "run_now" → reject (enum)', () => {
    const result = validateSessionImportArtefact(validImportOnlyArtefact({ requested_action: 'run_now' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('INVALID_ENUM_VALUE');
      expect(result.details).toMatch(/requested_action/);
    }
  });

  // Test 8: unknown key at top level — proves closed-world enforcement
  test('8. unknown top-level key → reject (closed-world)', () => {
    const result = validateSessionImportArtefact(validImportOnlyArtefact({ malware_hook: 'payload' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ARTEFACT_UNKNOWN_KEY');
      expect(result.details).toMatch(/malware_hook/);
    }
  });

  // Test 9: unknown key inside session object — proves nested adversarial closure
  test('9. unknown key inside session object → reject (closed-world at nested level)', () => {
    const session = validSession({ exec_hook: 'eval(payload)' });
    const result = validateSessionImportArtefact(validImportOnlyArtefact({ sessions: [session] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ARTEFACT_UNKNOWN_KEY');
      expect(result.details).toMatch(/exec_hook/);
    }
  });

  // Test 10: sessions array empty — cardinality violation
  test('10. sessions: [] → reject (cardinality)', () => {
    const result = validateSessionImportArtefact(validImportOnlyArtefact({ sessions: [] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('STRUCTURAL_INTEGRITY_FAILURE');
      expect(result.details).toMatch(/sessions/);
    }
  });

  // Test 11: import_only with actuating_processing + LOCAL boundary
  test('11. import_only + actuating_processing/LOCAL → reject (cross-field)', () => {
    const artefact = validImportOnlyArtefact({
      policy: {
        processing_events: [
          { event_class: 'actuating_processing', boundary: 'LOCAL', scope: 'FULL' },
        ],
      },
    });
    const result = validateSessionImportArtefact(artefact);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ARTEFACT_ACTION_POLICY_INCONSISTENT');
    }
  });

  // Test 12: import_and_offer_run with empty capabilities_required
  test('12. import_and_offer_run + empty capabilities_required → reject (cross-field)', () => {
    const artefact = validRunArtefact({
      sessions: [validSession({ capabilities_required: [] })],
    });
    const result = validateSessionImportArtefact(artefact);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ARTEFACT_CAPABILITY_DECLARATION_MISSING');
    }
  });

  // Test 13: sensitive_subcapsule non-null with import_only
  test('13. sensitive_subcapsule non-null + import_only → reject (cross-field)', () => {
    const artefact = validImportOnlyArtefact({
      sensitive_subcapsule: {
        ciphertext_ref: 'ref-xyz',
        gate_purpose: 'session_transfer',
      },
    });
    const result = validateSessionImportArtefact(artefact);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ARTEFACT_SENSITIVE_SUBCAPSULE_REQUIRES_RUN');
    }
  });

  // Test 14: UUID v4 format violation on artefact_id
  test('14. artefact_id not UUID v4 → reject (format)', () => {
    const result = validateSessionImportArtefact(
      validImportOnlyArtefact({ artefact_id: 'not-a-uuid' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ARTEFACT_FORMAT_INVALID');
      expect(result.details).toMatch(/artefact_id/);
    }
  });

  // Test 15: RFC 3339 format violation on created_at
  test('15. created_at not RFC 3339 UTC → reject (format)', () => {
    const result = validateSessionImportArtefact(
      validImportOnlyArtefact({ created_at: '2026-05-04 17:36:00' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ARTEFACT_FORMAT_INVALID');
      expect(result.details).toMatch(/created_at/);
    }
  });

  // Test 16a: session_kind 'workflow_graph' → reject (Resolution 2)
  test('16a. session_kind "workflow_graph" → reject (future kind, v1.0.0 receiver)', () => {
    const session = validSession({ session_kind: 'workflow_graph' });
    const result = validateSessionImportArtefact(validImportOnlyArtefact({ sessions: [session] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ARTEFACT_SESSION_KIND_INVALID');
      expect(result.details).toMatch(/workflow_graph/);
    }
  });

  // Test 16b: session_kind 'composite' → reject (Resolution 2)
  test('16b. session_kind "composite" → reject (future kind, v1.0.0 receiver)', () => {
    const session = validSession({ session_kind: 'composite' });
    const result = validateSessionImportArtefact(validImportOnlyArtefact({ sessions: [session] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ARTEFACT_SESSION_KIND_INVALID');
      expect(result.details).toMatch(/composite/);
    }
  });

  // Test 17: display grid entry carries agentBoxes → reject (Resolution 1 prohibition)
  test('17. display_grid entry with agentBoxes → reject (Resolution 1 prohibition)', () => {
    const grid = {
      layout: '4-slot',
      sessionId: 'grid-session-1',
      config: { slots: {} },
      agentBoxes: [],  // prohibited in artefact
    };
    const session = validSession({ display_grids: [grid] });
    const result = validateSessionImportArtefact(validImportOnlyArtefact({ sessions: [session] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ARTEFACT_UNKNOWN_KEY');
      expect(result.details).toMatch(/agentBoxes/);
    }
  });

  // Test 18: unknown key inside display_grid config (DisplayGridInnerConfig level)
  test('18. unknown key inside display_grid config → reject (closed-world at config level)', () => {
    const grid = {
      layout: '4-slot',
      sessionId: 'grid-session-1',
      config: {
        slots: {},
        malicious_field: 'payload',  // unknown key in DisplayGridInnerConfig
      },
    };
    const session = validSession({ display_grids: [grid] });
    const result = validateSessionImportArtefact(validImportOnlyArtefact({ sessions: [session] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ARTEFACT_UNKNOWN_KEY');
      expect(result.details).toMatch(/malicious_field/);
    }
  });

  // Test 19: unknown key inside slot config (DisplayGridSlotConfig level)
  test('19. unknown key inside slot config → reject (closed-world at slot level)', () => {
    const grid = {
      layout: '4-slot',
      sessionId: 'grid-session-1',
      config: {
        slots: {
          slot_1: { boxNumber: 1, injected_code: 'exec()' },  // unknown key in DisplayGridSlotConfig
        },
      },
    };
    const session = validSession({ display_grids: [grid] });
    const result = validateSessionImportArtefact(validImportOnlyArtefact({ sessions: [session] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ARTEFACT_UNKNOWN_KEY');
      expect(result.details).toMatch(/injected_code/);
    }
  });
});

// =============================================================================
// validateDecryptedBeapContent — unit tests (PR 2/7, Canon A.3.054.8 post-decrypt pass)
// All tests use synthetic content only (no real qBEAP decryption output).
// =============================================================================

describe('validateDecryptedBeapContent — unit tests', () => {

  // CV-1: content with no artefact field → validated, no reason
  test('CV-1. content with no session_import_artefact → validated (conformant absence)', () => {
    const content = JSON.stringify({ format: 'beap_qbeap_decrypted', body: { text: 'hello' } });
    const result = validateDecryptedBeapContent(content);
    expect(result.validated_at).toBeTruthy();
    expect(result.validator_version).toBe(CONTENT_VALIDATOR_VERSION);
    expect(result.validation_reason).toBeNull();
    expect(result.validation_details).toBeNull();
  });

  // CV-2: content with valid minimal artefact → validated, no reason
  test('CV-2. content with valid session_import_artefact → validated', () => {
    const content = JSON.stringify({
      format: 'beap_qbeap_decrypted',
      session_import_artefact: validImportOnlyArtefact(),
    });
    const result = validateDecryptedBeapContent(content);
    expect(result.validation_reason).toBeNull();
    expect(result.validated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // CV-3: content with invalid artefact → rejected, reason set
  test('CV-3. content with malformed artefact → validation_reason set', () => {
    const content = JSON.stringify({
      format: 'beap_qbeap_decrypted',
      session_import_artefact: {
        schema_version: '1.0.0',
        artefact_id: '550e8400-e29b-41d4-a716-446655440000',
        created_at: '2026-05-04T17:36:00Z',
        handshake_binding: null,
        purpose: { declared_purpose: 'session_share', scope_constraints: {} },
        sessions: [validSession()],
        policy: { processing_events: [] },
        requested_action: 'import_only',
        sensitive_subcapsule: null,
        injected_field: 'malicious',  // unknown key → ARTEFACT_UNKNOWN_KEY
      },
    });
    const result = validateDecryptedBeapContent(content);
    expect(result.validation_reason).toBe('ARTEFACT_UNKNOWN_KEY');
    expect(result.validation_details).toMatch(/injected_field/);
    expect(result.validated_at).toBeTruthy();
    expect(result.validator_version).toBe(CONTENT_VALIDATOR_VERSION);
  });

  // CV-4: non-JSON string → treated as no artefact, conformant
  test('CV-4. non-JSON string content → treated as no artefact, conformant', () => {
    const result = validateDecryptedBeapContent('plain text, not JSON');
    expect(result.validation_reason).toBeNull();
  });

  // CV-5: already-parsed object with valid artefact → validated
  test('CV-5. pre-parsed object input with valid artefact → validated', () => {
    const parsed = {
      format: 'beap_qbeap_decrypted',
      session_import_artefact: validImportOnlyArtefact(),
    };
    const result = validateDecryptedBeapContent(parsed);
    expect(result.validation_reason).toBeNull();
  });

  // CV-6: JSON string with artefact containing unknown key inside session → ARTEFACT_UNKNOWN_KEY
  test('CV-6. artefact with unknown key nested inside session object → rejected', () => {
    const session = validSession({ command: 'exec()' });  // unknown key in OrchestratorSessionContent
    const content = JSON.stringify({
      session_import_artefact: validImportOnlyArtefact({ sessions: [session] }),
    });
    const result = validateDecryptedBeapContent(content);
    expect(result.validation_reason).toBe('ARTEFACT_UNKNOWN_KEY');
  });

  // CV-7: empty string → conformant (no artefact)
  test('CV-7. empty string content → conformant (no artefact)', () => {
    const result = validateDecryptedBeapContent('');
    expect(result.validation_reason).toBeNull();
  });

  // CV-8: null content → conformant (no artefact)
  test('CV-8. null content → conformant (no artefact)', () => {
    const result = validateDecryptedBeapContent(null);
    expect(result.validation_reason).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // PR 2.1/7 — pBEAP capsule content shapes (raw decoded capsule as input)
  // ---------------------------------------------------------------------------
  // These tests call validateDecryptedBeapContent with the object that
  // extractPBeapCapsule returns — i.e., the decoded capsule, not the outer
  // depackaged_json wrapper.  This proves that the correct source of truth
  // (the capsule, which carries session_import_artefact) is what the
  // validator sees in the pBEAP receive path.

  // CV-P1: pBEAP capsule decoded to object, no artefact → validated
  test('CV-P1. pBEAP decoded capsule, no artefact → validated_at set, no reason', () => {
    const capsule = {
      body: 'hello world',
      title: 'Test pBEAP',
      attachments: [],
    };
    const result = validateDecryptedBeapContent(capsule);
    expect(result.validated_at).toBeTruthy();
    expect(result.validator_version).toBe(CONTENT_VALIDATOR_VERSION);
    expect(result.validation_reason).toBeNull();
    expect(result.validation_details).toBeNull();
  });

  // CV-P2: pBEAP capsule with valid session_import_artefact → validated
  test('CV-P2. pBEAP decoded capsule with valid artefact → validated_at set, no reason', () => {
    const capsule = {
      body: 'hello',
      session_import_artefact: validImportOnlyArtefact(),
    };
    const result = validateDecryptedBeapContent(capsule);
    expect(result.validation_reason).toBeNull();
    expect(result.validated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // CV-P3: pBEAP capsule with malformed artefact (unknown key) → rejection columns set
  // This is the critical test that proves the gap is closed.
  test('CV-P3. pBEAP decoded capsule with malformed artefact → validation_reason populated', () => {
    const capsule = {
      body: 'hello',
      session_import_artefact: validImportOnlyArtefact({ injected_pbeap_key: 'exec()' }),
    };
    const result = validateDecryptedBeapContent(capsule);
    expect(result.validation_reason).toBe('ARTEFACT_UNKNOWN_KEY');
    expect(result.validation_details).toMatch(/injected_pbeap_key/);
    expect(result.validated_at).toBeTruthy();
    expect(result.validator_version).toBe(CONTENT_VALIDATOR_VERSION);
  });

  // CV-P4: malformed pBEAP plaintext (capsule is not an object) → treated as no artefact
  // If the decoded payload is unparseable/primitive, validator returns success (no artefact).
  // This mirrors the validator's fail-safe: a primitive payload carries no artefact.
  test('CV-P4. pBEAP decoded payload is primitive (not object) → treated as no artefact', () => {
    const result = validateDecryptedBeapContent(42);   // primitive, not an object
    expect(result.validation_reason).toBeNull();
    expect(result.validated_at).toBeTruthy();
  });
});

describe('validateCapsule + session_import_artefact — integration tests (Step D)', () => {

  // Test 20: capsule with no artefact field → no regression on existing behavior
  test('20. capsule without artefact field → existing validation, no regression', () => {
    const rawInput: RawInput = { body: JSON.stringify(draftCapsule()) };
    const candidate = ingestInput(rawInput, 'internal', emptyTransport);
    const result = validateCapsule(candidate);
    expect(result.success).toBe(true);
  });

  // Test 21: capsule with valid artefact field → ok
  test('21. capsule with valid artefact field → capsule accepted', () => {
    const rawInput: RawInput = {
      body: JSON.stringify(
        draftCapsule({ session_import_artefact: validImportOnlyArtefact() }),
      ),
    };
    const candidate = ingestInput(rawInput, 'internal', emptyTransport);
    const result = validateCapsule(candidate);
    expect(result.success).toBe(true);
  });

  // Test 22: capsule with invalid artefact field → entire capsule rejected.
  // Fixture: unknown top-level key drives ARTEFACT_UNKNOWN_KEY so the test
  // also proves that closed-world rejection propagates from artefact → capsule.
  test('22. capsule with invalid artefact field → capsule rejected with artefact reason', () => {
    const rawInput: RawInput = {
      body: JSON.stringify(
        draftCapsule({
          session_import_artefact: {
            schema_version: '1.0.0',
            artefact_id: '550e8400-e29b-41d4-a716-446655440000',
            created_at: '2026-05-04T17:36:00Z',
            handshake_binding: null,
            purpose: { declared_purpose: 'session_share', scope_constraints: {} },
            sessions: [validSession()],
            policy: { processing_events: [] },
            requested_action: 'import_only',
            sensitive_subcapsule: null,
            malicious_field: 'exec()',  // unknown key → ARTEFACT_UNKNOWN_KEY
          },
        }),
      ),
    };
    const candidate = ingestInput(rawInput, 'internal', emptyTransport);
    const result = validateCapsule(candidate);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ARTEFACT_UNKNOWN_KEY');
      expect(result.details).toMatch(/session_import_artefact/);
    }
  });
});

// =============================================================================
// PR 4/8 — Pinned Vocabulary Tests (Tests 15–18) + Round-Trip (Tests 14, 26–27)
// =============================================================================

describe('PR4-VAL: Validator vocabulary tightening (PR 4/8)', () => {
  function validArtefactBase(purposeOverride = 'session_share', capsOverride: unknown[] = []): Record<string, unknown> {
    return {
      schema_version: '1.0.0',
      artefact_id: '550e8400-e29b-41d4-a716-446655440001',
      created_at: '2026-05-04T17:36:00Z',
      handshake_binding: null,
      purpose: { declared_purpose: purposeOverride, scope_constraints: {} },
      sessions: [{
        session_kind: 'orchestrator_session',
        session_id: 'sid-pr4',
        session_name: 'PR4 Session',
        agents: [], agent_boxes: [], display_grids: [],
        capabilities_required: capsOverride,
      }],
      policy: { processing_events: [] },
      requested_action: capsOverride.length > 0 ? 'import_and_offer_run' : 'import_only',
      sensitive_subcapsule: null,
    };
  }

  // Test 15 — PR4-VAL-15
  test('PR4-VAL-15: declared_purpose arbitrary string → ARTEFACT_PURPOSE_INVALID', () => {
    const result = validateSessionImportArtefact(validArtefactBase('arbitrary_string'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ARTEFACT_PURPOSE_INVALID');
    }
  });

  // Test 16 — PR4-VAL-16
  test('PR4-VAL-16: declared_purpose "session_share" → accepted', () => {
    const result = validateSessionImportArtefact(validArtefactBase('session_share'));
    expect(result.success).toBe(true);
  });

  // Test 17 — PR4-VAL-17
  test('PR4-VAL-17: capabilities_required ["arbitrary_capability"] → INVALID_ENUM_VALUE', () => {
    const result = validateSessionImportArtefact(validArtefactBase('session_share', ['arbitrary_capability']));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('INVALID_ENUM_VALUE');
    }
  });

  // Test 18 — PR4-VAL-18
  test('PR4-VAL-18: capabilities_required ["data_access"] → accepted', () => {
    const result = validateSessionImportArtefact(validArtefactBase('session_share', ['data_access']));
    expect(result.success).toBe(true);
  });

  // Test 14 / Round-trip helper conformance — PR4-RT-14
  // Replicated fixture (mirrors buildSessionImportArtefact output shape).
  test('PR4-RT-14: well-formed artefact from builder shape → passes validator', () => {
    const artefact = {
      schema_version: '1.0.0' as const,
      artefact_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      handshake_binding: null,
      purpose: { declared_purpose: 'session_share' as const, scope_constraints: {} },
      sessions: [{
        session_kind: 'orchestrator_session' as const,
        session_id: 'session_builder_rt',
        session_name: 'Builder Round-Trip Session',
        agents: [] as any[],
        agent_boxes: [] as any[],
        display_grids: [] as any[],
        capabilities_required: ['ui_actions' as const],
      }],
      policy: { processing_events: [] },
      requested_action: 'import_and_offer_run' as const,
      sensitive_subcapsule: null,
    };
    const result = validateSessionImportArtefact(artefact);
    expect(result.success).toBe(true);
  });

  // Test 26 — PR4-RT-26: qBEAP-style (with handshake binding + capabilities)
  test('PR4-RT-26: qBEAP-style well-formed artefact → validator accepts', () => {
    const artefact = {
      schema_version: '1.0.0' as const,
      artefact_id: '550e8400-e29b-41d4-a716-446655440002',
      created_at: '2026-05-04T15:00:00Z',
      handshake_binding: { handshake_id: 'hk-rt-001', bound_at: '2026-05-04T15:00:00Z' },
      purpose: { declared_purpose: 'session_share' as const, scope_constraints: {} },
      sessions: [{
        session_kind: 'orchestrator_session' as const,
        session_id: 'session_qbeap_rt',
        session_name: 'qBEAP Round-Trip Session',
        agents: [] as any[],
        agent_boxes: [] as any[],
        display_grids: [] as any[],
        capabilities_required: ['data_access' as const, 'session_control' as const],
      }],
      policy: { processing_events: [] },
      requested_action: 'import_and_offer_run' as const,
      sensitive_subcapsule: null,
    };
    const result = validateSessionImportArtefact(artefact);
    expect(result.success).toBe(true);
  });

  // Test 27 — PR4-RT-27: pBEAP-style (unbound, empty capabilities → import_only)
  test('PR4-RT-27: pBEAP-style unbound artefact → validator accepts', () => {
    const artefact = {
      schema_version: '1.0.0' as const,
      artefact_id: '550e8400-e29b-41d4-a716-446655440003',
      created_at: '2026-05-04T16:00:00Z',
      handshake_binding: null,
      purpose: { declared_purpose: 'session_share' as const, scope_constraints: {} },
      sessions: [{
        session_kind: 'orchestrator_session' as const,
        session_id: 'session_pbeap_rt',
        session_name: 'pBEAP Round-Trip Session',
        agents: [] as any[],
        agent_boxes: [] as any[],
        display_grids: [] as any[],
        capabilities_required: [],
      }],
      policy: { processing_events: [] },
      requested_action: 'import_only' as const,
      sensitive_subcapsule: null,
    };
    const result = validateSessionImportArtefact(artefact);
    expect(result.success).toBe(true);
  });
});
