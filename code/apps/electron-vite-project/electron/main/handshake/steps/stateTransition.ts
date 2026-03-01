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

    // ACTIVE
    if (currentState === HandshakeState.ACTIVE) {
      if (capsuleType === 'handshake-refresh') return { passed: true }
      if (capsuleType === 'handshake-revoke') return { passed: true }
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
