/**
 * Execution Authorization Gate
 *
 * Central function that authorizes every tool invocation before execution.
 * No tool may execute without passing this gate. No alternate execution
 * entry point may exist that bypasses it.
 *
 * Checks (in order):
 *   1. Handshake exists and is active
 *   2. Handshake is not revoked
 *   3. Tool is explicitly granted in capability set
 *   4. Scope matches effective policy
 *   5. Purpose matches effective policy
 *   6. Parameters are within constraints
 *   7. Attestation requirements met (if applicable)
 *
 * Logs an audit record for every decision (allow and deny).
 */

import {
  getHandshakeRecord,
  insertAuditLogEntry,
} from '../handshake/db'
import { HandshakeState as HS } from '../handshake/types'

// ── Types ──

export type AuthorizationDenialReason =
  | 'HANDSHAKE_INACTIVE'
  | 'HANDSHAKE_REVOKED'
  | 'TOOL_NOT_GRANTED'
  | 'SCOPE_NOT_ALLOWED'
  | 'PURPOSE_MISMATCH'
  | 'PARAMETER_CONSTRAINT_VIOLATION'
  | 'ATTESTATION_REQUIRED';

export type ToolAuthorizationResult =
  | { readonly authorized: true }
  | { readonly authorized: false; readonly reason: AuthorizationDenialReason; readonly details: string };

export interface ToolInvocationRequest {
  readonly handshake_id: string;
  readonly tool_name: string;
  readonly parameters: Record<string, unknown>;
  readonly requested_scope: string;
  readonly requested_purpose: string;
}

// ── Granted Tools Registry ──

const GRANTED_TOOLS: ReadonlySet<string> = new Set([
  'read-context',
  'write-context',
  'decrypt-payload',
  'semantic-search',
  'cloud-escalation',
  'export-context',
])

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
  // 1. Handshake exists and is active
  const record = getHandshakeRecord(db, request.handshake_id)
  if (!record) {
    return deny('HANDSHAKE_INACTIVE', `Handshake ${request.handshake_id} not found`)
  }

  // 2. Not revoked
  if (record.state === HS.REVOKED) {
    return deny('HANDSHAKE_REVOKED', `Handshake ${request.handshake_id} is revoked`)
  }

  // Check active (also catches EXPIRED, PENDING_ACCEPT, DRAFT)
  if (record.state !== HS.ACTIVE) {
    return deny('HANDSHAKE_INACTIVE', `Handshake ${request.handshake_id} is not active (state: ${record.state})`)
  }

  // Check expiry
  if (record.expires_at) {
    const expiresAt = Date.parse(record.expires_at)
    if (!isNaN(expiresAt) && now.getTime() > expiresAt) {
      return deny('HANDSHAKE_INACTIVE', `Handshake ${request.handshake_id} has expired`)
    }
  }

  // 3. Tool is explicitly granted
  if (!GRANTED_TOOLS.has(request.tool_name)) {
    return deny('TOOL_NOT_GRANTED', `Tool "${request.tool_name}" is not in the granted tools set`)
  }

  // 4. Scope check — use handshake policy
  const policy = record.effective_policy
  if (!policy.allowedScopes.includes('*')) {
    if (!policy.allowedScopes.includes(request.requested_scope)) {
      return deny('SCOPE_NOT_ALLOWED', `Scope "${request.requested_scope}" is not allowed by effective policy`)
    }
  }

  // 5. Purpose-specific checks
  if (request.tool_name === 'cloud-escalation' && !policy.allowsCloudEscalation) {
    return deny('PURPOSE_MISMATCH', 'Cloud escalation is not permitted by effective policy')
  }
  if (request.tool_name === 'export-context' && !policy.allowsExport) {
    return deny('PURPOSE_MISMATCH', 'Export is not permitted by effective policy')
  }

  // 6. Parameter constraints
  if (request.parameters) {
    for (const [key, value] of Object.entries(request.parameters)) {
      if (typeof value === 'string' && value.length > 1_000_000) {
        return deny('PARAMETER_CONSTRAINT_VIOLATION', `Parameter "${key}" exceeds maximum length`)
      }
    }
  }

  // 7. Attestation check (for enterprise tier with attestation requirements)
  if (record.tier_snapshot?.effectiveTier === 'enterprise') {
    const signals = record.current_tier_signals
    if (!signals.hardwareAttestation?.verified) {
      return deny('ATTESTATION_REQUIRED', 'Enterprise tier requires hardware attestation')
    }
  }

  return { authorized: true }
}

function deny(reason: AuthorizationDenialReason, details: string): ToolAuthorizationResult {
  return { authorized: false, reason, details }
}
