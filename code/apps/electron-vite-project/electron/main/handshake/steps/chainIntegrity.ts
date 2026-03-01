import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'

export const verifyChainIntegrity: PipelineStep = {
  name: 'verify_chain_integrity',
  execute(ctx) {
    const { input, handshakeRecord } = ctx
    const { capsuleType, seq, prev_hash } = input

    // handshake-initiate: seq MUST be 0, no prev_hash
    if (capsuleType === 'handshake-initiate') {
      if (seq !== 0) return { passed: false, reason: ReasonCode.INVALID_CHAIN }
      if (prev_hash != null) return { passed: false, reason: ReasonCode.INVALID_CHAIN }
      return { passed: true }
    }

    // handshake-accept: seq MUST be 0 (independent direction), no prev_hash
    if (capsuleType === 'handshake-accept') {
      if (seq !== 0) return { passed: false, reason: ReasonCode.INVALID_CHAIN }
      if (prev_hash != null) return { passed: false, reason: ReasonCode.INVALID_CHAIN }
      return { passed: true }
    }

    // refresh/revoke: need handshakeRecord to validate chain
    if (!handshakeRecord) {
      return { passed: false, reason: ReasonCode.HANDSHAKE_NOT_FOUND }
    }

    // Determine if sender is initiator or acceptor
    // The seq we expect from this sender is last_seq_received + 1
    // (from our perspective, we track what we received from them)
    const lastSeq = handshakeRecord.last_seq_received
    const lastHash = handshakeRecord.last_capsule_hash_received

    // If we are the initiator receiving from acceptor (or vice versa),
    // we use last_seq_received / last_capsule_hash_received which tracks
    // the last capsule we received from the counterparty.
    // But since the handshake record is from OUR perspective:
    //   - If sender is the counterparty, check against last_seq_received
    const expectedSeq = lastSeq + 1

    if (seq < expectedSeq) {
      return { passed: false, reason: ReasonCode.SEQ_REPLAY }
    }
    if (seq > expectedSeq) {
      return { passed: false, reason: ReasonCode.INVALID_CHAIN }
    }

    // prev_hash must match the last capsule hash we received from this direction
    if (prev_hash !== lastHash) {
      return { passed: false, reason: ReasonCode.INVALID_CHAIN }
    }

    return { passed: true }
  },
}
