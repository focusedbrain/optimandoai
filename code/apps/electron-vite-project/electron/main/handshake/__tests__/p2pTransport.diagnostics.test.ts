import { describe, test, expect } from 'vitest'
import {
  describeOutboundPayloadForLogs,
  extractTopLevelKeysFromJsonBody,
  detectBodyLooksDoubleEncoded,
  buildOutboundRequestDebugSnapshot,
  summarizeCanonChunkingForOutboundDebug,
  buildCoordinationCapsulePostBody,
  analyzeCoordinationRoutingCompliance,
  describeCoordinationRelayNormalization,
  parseRelayCapsuleTypeNotAllowedHint,
  coordinationRelayContractSatisfied,
  analyzeSerializedCoordinationContract,
} from '../p2pTransport'

describe('describeOutboundPayloadForLogs', () => {
  test('context_sync capsule envelope', () => {
    const d = describeOutboundPayloadForLogs({
      schema_version: 1,
      capsule_type: 'context_sync',
      handshake_id: 'hs-1',
      seq: 1,
    })
    expect(d.value_kind).toBe('object')
    expect(d.top_level_keys).toContain('capsule_type')
    expect(d.looks_like_relay_capsule_envelope).toBe(true)
    expect(d.looks_like_beap_message_package).toBe(false)
    expect(d.has_top_level_handshake_id).toBe(true)
    expect(d.internal_wire).toBeUndefined()
  })

  test('internal routing fields produce internal_wire summary (no raw secrets)', () => {
    const d = describeOutboundPayloadForLogs({
      capsule_type: 'context_sync',
      handshake_id: 'hs-int',
      handshake_type: 'internal',
      sender_device_id: 'dev-a',
      receiver_device_id: 'dev-b',
      sender_device_role: 'host',
      receiver_device_role: 'sandbox',
      sender_computer_name: 'HostBox',
      receiver_computer_name: 'SandboxBox',
    })
    expect(d.internal_wire).toEqual({
      handshake_type: 'internal',
      has_sender_device_id: true,
      has_receiver_device_id: true,
      has_sender_device_role: true,
      has_receiver_device_role: true,
      has_sender_computer_name: true,
      has_receiver_computer_name: true,
    })
  })

  test('BEAP message package shape (no top-level capsule_type)', () => {
    const d = describeOutboundPayloadForLogs({
      header: { metadata: {}, receiver_binding: { handshake_id: 'hs-2' } },
      metadata: {},
      envelope: {},
    })
    expect(d.looks_like_beap_message_package).toBe(true)
    expect(d.has_message_header_receiver_binding_handshake_id).toBe(true)
  })

  test('qBEAP wire shape (payloadEnc) counts as message package for coordination', () => {
    const d = describeOutboundPayloadForLogs({
      header: { receiver_binding: { handshake_id: 'hs-q' } },
      metadata: {},
      payloadEnc: { chunking: { count: 3, enabled: true, maxChunkBytes: 262144, merkleRoot: 'x' } },
    })
    expect(d.looks_like_beap_message_package).toBe(true)
  })

  test('summarizeCanonChunkingForOutboundDebug — payload + artefact chunk counts', () => {
    const s = summarizeCanonChunkingForOutboundDebug({
      payloadEnc: {
        chunking: { count: 2, enabled: true, maxChunkBytes: 262144, merkleRoot: 'a' },
      },
      artefactsEnc: [{ chunking: { count: 4, enabled: true, maxChunkBytes: 1048576, merkleRoot: 'b' } }],
    })
    expect(s.payload_enc_chunk_count).toBe(2)
    expect(s.artefact_encrypted_chunk_total).toBe(4)
    expect(s.note).toMatch(/Canon A\.3/)
  })

  test('extractTopLevelKeysFromJsonBody — normal object', () => {
    const keys = extractTopLevelKeysFromJsonBody(JSON.stringify({ a: 1, b: 2 }))
    expect(keys).toContain('a')
    expect(keys).toContain('b')
  })

  test('detectBodyLooksDoubleEncoded — true when JSON string wraps JSON object', () => {
    const inner = JSON.stringify({ handshake_id: 'x' })
    const wire = JSON.stringify(inner)
    expect(detectBodyLooksDoubleEncoded(wire)).toBe(true)
  })

  test('buildOutboundRequestDebugSnapshot — includes safe fields only', () => {
    const cap = { handshake_id: 'hs', capsule_type: 'context_sync' }
    const body = JSON.stringify(cap)
    const s = buildOutboundRequestDebugSnapshot(
      'direct',
      'https://peer/beap',
      cap,
      body,
      'application/json',
      400,
      '{"error":"Bad request"}',
    )
    expect(s.route).toBe('direct')
    expect(s.url).toBe('https://peer/beap')
    expect(s.content_type).toBe('application/json')
    expect(s.content_length_bytes).toBeGreaterThan(0)
    expect(s.body_type).toBe('json_string')
    expect(s.top_level_keys).toContain('handshake_id')
    expect(s.body_looks_double_encoded).toBe(false)
    expect(s.http_status).toBe(400)
    expect(s.response_body_snippet).toContain('Bad request')
  })

  test('buildCoordinationCapsulePostBody — strips null capsule_type (relay message-package detection)', () => {
    const raw = {
      header: {},
      metadata: {},
      payloadEnc: {},
      capsule_type: null,
    } as Record<string, unknown>
    const merged = buildCoordinationCapsulePostBody(raw, 'hs-q') as Record<string, unknown>
    expect('capsule_type' in merged).toBe(false)
    expect(merged.handshake_id).toBe('hs-q')
  })

  test('describeCoordinationRelayNormalization — native wire → message_package', () => {
    const n = describeCoordinationRelayNormalization({
      header: {},
      metadata: {},
      payloadEnc: {},
      handshake_id: 'h1',
    })
    expect(n.coordination_source_format).toBe('beap_wire_message_package')
    expect(n.derived_relay_capsule_type).toBe('message_package')
    expect(n.relay_envelope_matches_expectations).toBe(true)
  })

  test('parseRelayCapsuleTypeNotAllowedHint — extracts detail from JSON', () => {
    const h = parseRelayCapsuleTypeNotAllowedHint(
      '{"error":"capsule_type_not_allowed","detail":"Relay accepts: a, b"}',
    )
    expect(h).toContain('Relay accepts')
  })

  test('buildCoordinationCapsulePostBody — merges queue handshake_id for coordination routing', () => {
    const raw = {
      header: { receiver_binding: { handshake_id: 'nested' } },
      metadata: {},
      payloadEnc: { chunking: { count: 1, enabled: true, maxChunkBytes: 262144, merkleRoot: 'z' } },
    }
    const merged = buildCoordinationCapsulePostBody(raw, 'hs-queue') as Record<string, unknown>
    expect(merged.handshake_id).toBe('hs-queue')
    expect(merged.header).toBe(raw.header)
    expect(merged.payloadEnc).toBe(raw.payloadEnc)
  })

  test('analyzeCoordinationRoutingCompliance — missing top-level handshake_id when no binding', () => {
    const a = analyzeCoordinationRoutingCompliance({
      header: {},
      metadata: {},
      payloadEnc: {},
    })
    expect(a.expected_coordination_routing_keys).toEqual(['handshake_id'])
    expect(a.missing_coordination_top_level_fields).toContain('handshake_id')
  })

  test('buildOutboundRequestDebugSnapshot — coordination includes routing contract hints', () => {
    const cap = { handshake_id: 'hs-x', header: {}, metadata: {}, payloadEnc: {} }
    const body = JSON.stringify(cap)
    const s = buildOutboundRequestDebugSnapshot(
      'coordination',
      'https://relay/beap/capsule',
      cap,
      body,
      'application/json',
      400,
      '{"error":"Bad request"}',
    )
    expect(s.expected_coordination_routing_keys).toEqual(['handshake_id'])
    expect(s.missing_coordination_top_level_fields).toEqual([])
  })

  test('coordinationRelayContractSatisfied — message package and allowed handshake types', () => {
    expect(
      coordinationRelayContractSatisfied({
        header: {},
        metadata: {},
        payloadEnc: {},
      }),
    ).toBe(true)
    expect(
      coordinationRelayContractSatisfied({
        schema_version: 1,
        capsule_type: 'context_sync',
        handshake_id: 'h',
      }),
    ).toBe(true)
    // 'initiate' is conditionally allowed by the relay for internal handshakes
    // (see packages/coordination-service/src/server.ts: RELAY_ALLOWED_TYPES and
    // the initiate-specific guard immediately after). The client-side contract
    // checker only validates wire shape — the server's per-capsule guard
    // enforces handshake_type === 'internal' and same-principal routing,
    // returning 400 'initiate_external_not_allowed' / 400
    // 'initiate_missing_routing_fields' / 404 'no_route_for_internal_initiate'
    // when those preconditions fail. So the contract checker correctly
    // returns true for an initiate envelope here; rejection happens server-side.
    expect(
      coordinationRelayContractSatisfied({
        schema_version: 1,
        capsule_type: 'initiate',
        handshake_id: 'h',
      }),
    ).toBe(true)
  })

  test('analyzeSerializedCoordinationContract — reflects final JSON wire', () => {
    const body = JSON.stringify({
      header: {},
      metadata: {},
      payloadEnc: {},
      handshake_id: 'h1',
    })
    const a = analyzeSerializedCoordinationContract(body)
    expect(a.relay_capsule_type_field_name).toBe('capsule_type')
    expect(a.serialized_capsule_type_field_present).toBe(false)
    expect(a.serialized_capsule_type_value).toBe(null)
    expect(a.relay_validator_contract_matches).toBe(true)
    const body2 = JSON.stringify({ handshake_id: 'h2', capsule_type: 'context_sync' })
    const a2 = analyzeSerializedCoordinationContract(body2)
    expect(a2.serialized_capsule_type_field_present).toBe(true)
    expect(a2.serialized_capsule_type_value).toBe('context_sync')
    expect(a2.relay_validator_contract_matches).toBe(true)
  })

  test('buildOutboundRequestDebugSnapshot — coordination includes serialized relay contract fields', () => {
    const cap = { handshake_id: 'hs-w', header: {}, metadata: {}, innerEnvelopeCiphertext: 'x' }
    const body = JSON.stringify(cap)
    const s = buildOutboundRequestDebugSnapshot(
      'coordination',
      'https://relay/beap/capsule',
      cap,
      body,
      'application/json',
      400,
      '{"error":"capsule_type_not_allowed"}',
    )
    expect(s.relay_capsule_type_field_name).toBe('capsule_type')
    expect(s.serialized_capsule_type_field_present).toBe(false)
    expect(s.relay_validator_contract_matches).toBe(true)
    expect(s.relay_envelope_matches_expectations).toBe(true)
  })

  test('buildOutboundRequestDebugSnapshot — coordination includes canon summary and single-post flag', () => {
    const cap = {
      header: {},
      metadata: {},
      payloadEnc: { chunking: { count: 1, enabled: true, maxChunkBytes: 262144, merkleRoot: 'z' } },
    }
    const s = buildOutboundRequestDebugSnapshot(
      'coordination',
      'https://relay/beap/capsule',
      cap as object,
      JSON.stringify(cap),
      'application/json',
      400,
      '{"error":"x"}',
    )
    expect(s.coordination_single_post_json).toBe(true)
    expect(s.canon_chunking_summary?.payload_enc_chunk_count).toBe(1)
  })
})
