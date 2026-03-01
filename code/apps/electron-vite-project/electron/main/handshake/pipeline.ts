/**
 * Deny-by-default pipeline runner for handshake verification.
 *
 * Each step returns { passed: true } or { passed: false, reason }.
 * Any exception from a step is treated as denial (INTERNAL_ERROR).
 * The pipeline is a frozen array — insertion/reordering is a compile-time decision.
 */

import type {
  PipelineStep,
  HandshakeVerificationContext,
  HandshakeVerificationResult,
  ReasonCode,
  VerifiedCapsuleInput,
  ReceiverPolicy,
  SSOSession,
  HandshakeRecord,
} from './types'
import { ReasonCode as RC } from './types'

export function runHandshakeVerification(
  steps: readonly PipelineStep[],
  input: VerifiedCapsuleInput,
  receiverPolicy: ReceiverPolicy,
  ssoSession: SSOSession,
  handshakeRecord: HandshakeRecord | null,
  lookups: {
    seenCapsuleHashes: ReadonlySet<string>;
    contextBlockVersions: ReadonlyMap<string, number>;
    existingHandshakes: readonly HandshakeRecord[];
    localUserId: string;
  },
): HandshakeVerificationResult {
  const ctx: HandshakeVerificationContext = {
    input,
    receiverPolicy,
    ssoSession,
    handshakeRecord,
    signals: {},
    tierDecision: null,
    seenCapsuleHashes: lookups.seenCapsuleHashes,
    contextBlockVersions: lookups.contextBlockVersions,
    existingHandshakes: lookups.existingHandshakes,
    localUserId: lookups.localUserId,
  }

  for (const step of steps) {
    let result
    try {
      result = step.execute(ctx)
    } catch (err) {
      return {
        success: false,
        reason: RC.INTERNAL_ERROR,
        failedStep: step.name,
        error: err,
      }
    }

    if (result === null || result === undefined || typeof result.passed !== 'boolean') {
      return {
        success: false,
        reason: RC.INTERNAL_ERROR,
        failedStep: step.name,
        error: 'invalid step result',
      }
    }

    if (!result.passed) {
      return {
        success: false,
        reason: (result as { passed: false; reason: ReasonCode }).reason,
        failedStep: step.name,
      }
    }

    if (result.signals) {
      Object.assign(ctx.signals, result.signals)
    }
  }

  return { success: true, context: ctx }
}
