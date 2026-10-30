/**
 * Execution Authorization Gate (Phase 5 — V4) [VII.10.1, VII.2.6, IX.19.2]
 *
 * EXECUTION GRANTS ARE DELETED. The former process-global granted-tools
 * set and the ACTIVE-handshake blanket execution authorization are gone:
 * there is no standing right to execute anything. Authorization comes
 * exclusively from a fresh, single-use, Intent-Hash-bound human consent
 * record (see `execution/executionConsent.ts`) — verified here per
 * invocation, never cached, never batch-approved [VII.10.5.5].
 *
 * Checks (in order, fail-closed):
 *   1. Consent-tap flow enabled (kill switch refuses ALL execution — it
 *      never restores a consent-free path)
 *   2. Relationship context is live (exists, not revoked, active window) —
 *      necessary but NEVER sufficient
 *   3. Consent record: exists, tapped by a human actor, unconsumed, and its
 *      Intent Hash matches the request about to execute [IX.19.2]
 *   4. Parameters are within constraints
 *   5. Attestation requirements met (if applicable)
 *
 * Divergence between the executed and presented action (intent-hash
 * mismatch) is a DEVIATION: the consent record is invalidated and the
 * denial is recorded as such.
 *
 * Logs an audit record for every decision (allow and deny).
 */

import {
  getHandshakeRecord,
  insertAuditLogEntry,
} from '../handshake/db'
import { diagnoseHandshakeInactive } from '../handshake/enforcement'
import { HandshakeState as HS } from '../handshake/types'
import {
  isConsentTapExecutionEnabled,
  verifyConsentForExecution,
  type ExecutionConsentRow,
} from '../execution/executionConsent'

// ── Types ──

export type AuthorizationDenialReason =
  | 'EXECUTION_DISABLED'
  | 'HANDSHAKE_INACTIVE'
  | 'HANDSHAKE_REVOKED'
  | 'CONSENT_REQUIRED'
  | 'CONSENT_NOT_FOUND'
  | 'CONSENT_NOT_TAPPED'
  | 'CONSENT_CONSUMED'
  | 'INTENT_HASH_MISMATCH'
  | 'PARAMETER_CONSTRAINT_VIOLATION'
  | 'ATTESTATION_REQUIRED';

export type ToolAuthorizationResult =
  | { readonly authorized: true; readonly consent: ExecutionConsentRow }
  | {
      readonly authorized: false
      readonly reason: AuthorizationDenialReason
      readonly details: string
      /** True when the denial is a deviation [IX.19.2] (executed ≠ presented). */
      readonly deviation?: boolean
    };

export interface ToolInvocationRequest {
  readonly request_id: string;
  readonly handshake_id: string;
  readonly tool_name: string;
  readonly parameters: Record<string, unknown>;
  readonly requested_scope: string;
  readonly requested_purpose: string;
  readonly origin: string;
  /** Reference to the per-tap consent record — REQUIRED, no default. */
  readonly consent_ref?: string | null;
}

// ── Main Function ──

export function authorizeToolInvocation(
  db: any,
  request: ToolInvocationRequest,
): ToolAuthorizationResult {
  const now = new Date()
  let result: ToolAuthorizationResult

  try {
    result = runAuthorization(db, request, now)
  } catch (err: any) {
    result = {
      authorized: false,
      reason: 'HANDSHAKE_INACTIVE',
      details: err?.message ?? 'Authorization check failed',
    }
  }

  // Audit every decision
  try {
    insertAuditLogEntry(db, {
      timestamp: now.toISOString(),
      action: result.authorized ? 'TOOL_AUTHORIZED' : 'TOOL_DENIED',
      handshake_id: request.handshake_id,
      reason_code: result.authorized ? 'OK' : result.reason,
      metadata: {
        tool_name: request.tool_name,
        requested_scope: request.requested_scope,
        requested_purpose: request.requested_purpose,
        authorized: result.authorized,
        denial_reason: result.authorized ? undefined : result.reason,
        consent_ref: request.consent_ref ?? null,
        deviation: result.authorized ? undefined : result.deviation === true || undefined,
      },
    })
  } catch { /* audit failure must not mask result */ }

  return result
}

function runAuthorization(
  db: any,
  request: ToolInvocationRequest,
  now: Date,
): ToolAuthorizationResult {
  // 1. Kill switch: refuses everything; never a consent-free path.
  if (!isConsentTapExecutionEnabled()) {
    return deny('EXECUTION_DISABLED', 'Tool execution is disabled (WRDESK_EXECUTION_CONSENT_TAP=0)')
  }

  // 2. Relationship context is live — necessary, never sufficient.
  const record = getHandshakeRecord(db, request.handshake_id)
  if (!record) {
    return deny('HANDSHAKE_INACTIVE', `Handshake ${request.handshake_id} not found`)
  }
  if (record.state === HS.REVOKED) {
    return deny('HANDSHAKE_REVOKED', `Handshake ${request.handshake_id} is revoked`)
  }
  const inactiveDiag = diagnoseHandshakeInactive(db, request.handshake_id, now)
  if (!inactiveDiag.active) {
    return deny('HANDSHAKE_INACTIVE', inactiveDiag.reason)
  }

  // 3. Per-tap consent with Intent Hash [VII.10.1, IX.19.2]. No consent
  //    reference → refused; there is no default, no auto-accept, no cache.
  if (!request.consent_ref) {
    return deny('CONSENT_REQUIRED', 'Every execution requires a fresh human consent tap — no consent reference presented')
  }
  const consent = verifyConsentForExecution(db, request.consent_ref, {
    request_id: request.request_id,
    handshake_id: request.handshake_id,
    tool_name: request.tool_name,
    scope_id: request.requested_scope,
    purpose_id: request.requested_purpose,
    parameters: request.parameters,
    origin: request.origin,
  })
  if (!consent.ok) {
    const deviation = consent.reason === 'INTENT_HASH_MISMATCH'
    return {
      authorized: false,
      reason: consent.reason,
      details: deviation
        ? 'Executed action diverges from the presented consent preview — consent record invalidated (deviation)'
        : `Consent record check failed: ${consent.reason}`,
      ...(deviation ? { deviation: true } : {}),
    }
  }

  // 4. Parameter constraints
  if (request.parameters) {
    for (const [key, value] of Object.entries(request.parameters)) {
      if (typeof value === 'string' && value.length > 1_000_000) {
        return deny('PARAMETER_CONSTRAINT_VIOLATION', `Parameter "${key}" exceeds maximum length`)
      }
    }
  }

  // 5. Attestation check (for enterprise tier with attestation requirements)
  if (record.tier_snapshot?.effectiveTier === 'enterprise') {
    const signals = record.current_tier_signals
    if (!signals.hardwareAttestation?.verified) {
      return deny('ATTESTATION_REQUIRED', 'Enterprise tier requires hardware attestation')
    }
  }

  return { authorized: true, consent: consent.consent }
}

function deny(reason: AuthorizationDenialReason, details: string): ToolAuthorizationResult {
  return { authorized: false, reason, details }
}
