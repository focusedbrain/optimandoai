import type { PipelineStep } from '../types'
import { ReasonCode, HandshakeState } from '../types'

export const checkStateTransition: PipelineStep = {
  name: 'check_state_transition',
  execute(ctx) {
    const { input, handshakeRecord } = ctx
    const capsuleType = input.capsuleType
    const currentState = handshakeRecord?.state ?? null

    // Create mode: only handshake-initiate is valid when no record exists
    if (currentState === null) {
      if (capsuleType === 'handshake-initiate') return { passed: true }
      return { passed: false, reason: ReasonCode.HANDSHAKE_NOT_FOUND }
    }

    // Terminal states reject everything
    if (currentState === HandshakeState.REVOKED) {
      return { passed: false, reason: ReasonCode.HANDSHAKE_REVOKED }
    }
    if (currentState === HandshakeState.EXPIRED) {
      return { passed: false, reason: ReasonCode.HANDSHAKE_EXPIRED }
    }

    // PENDING_ACCEPT
    if (currentState === HandshakeState.PENDING_ACCEPT) {
      if (capsuleType === 'handshake-accept') return { passed: true }
      if (capsuleType === 'handshake-revoke') return { passed: true }
      // refresh on PENDING_ACCEPT is invalid
      if (capsuleType === 'handshake-refresh') {
        return { passed: false, reason: ReasonCode.INVALID_STATE_TRANSITION }
      }
      // duplicate initiate on existing record
      if (capsuleType === 'handshake-initiate') {
        return { passed: false, reason: ReasonCode.INVALID_STATE_TRANSITION }
      }
      return { passed: false, reason: ReasonCode.INVALID_STATE_TRANSITION }
    }

    // ACTIVE (Critical Finding #3: context-sync enforcement)
    // When handshake is ACTIVE and last_seq_received === 0, the first post-activation
    // capsule MUST be context-sync. This ensures the counterparty delivers context
    // blocks before any refresh/revoke. Any other type at seq 1 is rejected.
    if (currentState === HandshakeState.ACTIVE) {
      const lastSeq = handshakeRecord!.last_seq_received
      if (lastSeq === 0) {
        // First post-activation capsule: ONLY handshake-context-sync allowed
        if (capsuleType === 'handshake-context-sync') return { passed: true }
        if (capsuleType === 'handshake-refresh' || capsuleType === 'handshake-revoke') {
          console.warn('[HANDSHAKE] CONTEXT_SYNC_REQUIRED', { handshake_id: input.handshake_id, capsule_hash: input.capsule_hash })
          return { passed: false, reason: ReasonCode.CONTEXT_SYNC_REQUIRED }
        }
      } else {
        // After context-sync (last_seq_received >= 1): allow refresh and revoke
        if (capsuleType === 'handshake-refresh') return { passed: true }
        if (capsuleType === 'handshake-revoke') return { passed: true }
        if (capsuleType === 'handshake-context-sync') {
          // context-sync allowed only as first post-activation; subsequent is invalid
          return { passed: false, reason: ReasonCode.INVALID_STATE_TRANSITION }
        }
      }
      if (capsuleType === 'handshake-initiate') {
        return { passed: false, reason: ReasonCode.INVALID_STATE_TRANSITION }
      }
      if (capsuleType === 'handshake-accept') {
        return { passed: false, reason: ReasonCode.INVALID_STATE_TRANSITION }
      }
      return { passed: false, reason: ReasonCode.INVALID_STATE_TRANSITION }
    }

    // DRAFT is UI-only — should never reach the pipeline
    return { passed: false, reason: ReasonCode.INVALID_STATE_TRANSITION }
  },
}
