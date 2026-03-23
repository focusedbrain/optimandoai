/**
 * Structured audit logging for handshake operations.
 * Entries are persisted in the audit_log table within the same transaction.
 * No PII is stored in audit metadata.
 */

import type { AuditLogEntry, VerifiedCapsuleInput, HandshakeRecord, ReasonCode } from './types'

export function buildSuccessAuditEntry(
  input: VerifiedCapsuleInput,
  record: HandshakeRecord,
  durationMs: number,
  blocksCount: number,
): AuditLogEntry {
  return {
    timestamp: new Date().toISOString(),
    action: 'handshake_pipeline_success',
    handshake_id: input.handshake_id,
    capsule_type: input.capsuleType,
    reason_code: 'OK',
    pipeline_duration_ms: durationMs,
    actor_wrdesk_user_id: input.sender_wrdesk_user_id,
    metadata: {
      tier: record.tier_snapshot.effectiveTier,
      scopes: input.scopes ?? [],
      blocks_count: blocksCount,
      sharing_mode: record.sharing_mode,
      state: record.state,
      seq: input.seq,
    },
  }
}

export function buildDenialAuditEntry(
  input: VerifiedCapsuleInput,
  reason: ReasonCode,
  failedStep: string,
  durationMs: number,
): AuditLogEntry {
  return {
    timestamp: new Date().toISOString(),
    action: 'handshake_pipeline_denial',
    handshake_id: input.handshake_id,
    capsule_type: input.capsuleType,
    reason_code: reason,
    failed_step: failedStep,
    pipeline_duration_ms: durationMs,
    actor_wrdesk_user_id: input.sender_wrdesk_user_id,
    metadata: {
      seq: input.seq,
    },
  }
}

export function buildRevocationAuditEntry(
  handshakeId: string,
  source: 'local-user' | 'remote-capsule',
  actorUserId?: string,
): AuditLogEntry {
  return {
    timestamp: new Date().toISOString(),
    action: 'handshake_revoked',
    handshake_id: handshakeId,
    reason_code: 'OK',
    actor_wrdesk_user_id: actorUserId,
    metadata: { source },
  }
}
