/**
 * Context Governance — Policy baseline and resolution tests
 *
 * Verifies baselineFromPolicySelections, baselineFromHandshake, and fallback behavior.
 */

import { describe, test, expect } from 'vitest'
import {
  baselineFromPolicySelections,
  baselineFromHandshake,
} from '../contextGovernance'
import type { HandshakeRecord } from '../types'

describe('contextGovernance — baselineFromPolicySelections', () => {
  test('explicit cloud_ai and internal_ai override effective_policy', () => {
    const baseline = baselineFromPolicySelections(
      { cloud_ai: true, internal_ai: false },
      { allowsCloudEscalation: false, allowsExport: false },
    )
    expect(baseline.cloud_ai_allowed).toBe(true)
    expect(baseline.local_ai_allowed).toBe(false)
  })

  test('undefined selections fall back to effective_policy', () => {
    const baseline = baselineFromPolicySelections(undefined, {
      allowsCloudEscalation: true,
      allowsExport: true,
    })
    expect(baseline.cloud_ai_allowed).toBe(true)
    expect(baseline.local_ai_allowed).toBe(true)
  })

  test('null selections use defaults', () => {
    const baseline = baselineFromPolicySelections(null, null)
    expect(baseline.local_ai_allowed).toBe(true)
    expect(baseline.cloud_ai_allowed).toBe(false)
  })

  test('partial selections: cloud_ai only', () => {
    const baseline = baselineFromPolicySelections(
      { cloud_ai: true },
      { allowsCloudEscalation: false },
    )
    expect(baseline.cloud_ai_allowed).toBe(true)
    expect(baseline.local_ai_allowed).toBe(true)
  })
})

describe('contextGovernance — baselineFromHandshake', () => {
  function mockRecord(overrides: Partial<HandshakeRecord> = {}): HandshakeRecord {
    return {
      handshake_id: 'hs-test',
      relationship_id: 'rel-test',
      state: 'PENDING_ACCEPT',
      initiator: { email: 'a@test.com', wrdesk_user_id: 'u1', iss: 'iss', sub: 'sub' },
      acceptor: null,
      local_role: 'initiator',
      sharing_mode: null,
      reciprocal_allowed: true,
      tier_snapshot: {} as any,
      current_tier_signals: {} as any,
      last_seq_sent: 0,
      last_seq_received: 0,
      last_capsule_hash_sent: '',
      last_capsule_hash_received: '',
      effective_policy: { allowsCloudEscalation: false, allowsExport: false },
      external_processing: 'none',
      created_at: new Date().toISOString(),
      activated_at: null,
      expires_at: null,
      revoked_at: null,
      revocation_source: null,
      initiator_wrdesk_policy_hash: '',
      initiator_wrdesk_policy_version: '',
      acceptor_wrdesk_policy_hash: null,
      acceptor_wrdesk_policy_version: null,
      initiator_context_commitment: null,
      acceptor_context_commitment: null,
      p2p_endpoint: null,
      counterparty_p2p_token: null,
      local_public_key: null,
      local_private_key: null,
      counterparty_public_key: null,
      receiver_email: null,
      ...overrides,
    }
  }

  test('policy_selections override effective_policy for cloud_ai', () => {
    const record = mockRecord({
      effective_policy: { allowsCloudEscalation: false },
      policy_selections: { cloud_ai: true, internal_ai: true },
    })
    const baseline = baselineFromHandshake(record)
    expect(baseline.cloud_ai_allowed).toBe(true)
    expect(baseline.local_ai_allowed).toBe(true)
  })

  test('missing policy_selections uses effective_policy', () => {
    const record = mockRecord({
      effective_policy: { allowsCloudEscalation: true },
      policy_selections: undefined,
    })
    const baseline = baselineFromHandshake(record)
    expect(baseline.cloud_ai_allowed).toBe(true)
  })
})
