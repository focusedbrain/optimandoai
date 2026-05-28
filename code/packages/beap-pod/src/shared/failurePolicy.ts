/**
 * Fail-closed escalation policy for BEAP pod roles (Stream A — A6).
 */

export type FailureCode =
  | 'message_rejected'
  | 'peer_validation_flood'
  | 'tamper_suspected'
  | 'uncaught_exception'
  | 'stuck_health_probe'
  | 'seccomp_violation'
  | 'resource_exhausted'

/** Exit container only (supervisor may replace). */
export const EXIT_CONTAINER_CODES: ReadonlySet<FailureCode> = new Set([
  'uncaught_exception',
  'stuck_health_probe',
  'peer_validation_flood',
  'tamper_suspected',
  'seccomp_violation',
  'resource_exhausted',
])

/** Tear down entire pod — write escalation-*.json diagnostic. */
export const TEARDOWN_POD_CODES: ReadonlySet<FailureCode> = new Set([
  'tamper_suspected',
  'peer_validation_flood',
])

export const PEER_VALIDATION_FLOOD_MAX = 10
export const PEER_VALIDATION_FLOOD_WINDOW_MS = 60_000

export function isEscalationReportFilename(filename: string): boolean {
  return filename.startsWith('escalation-') && filename.endsWith('.json')
}

export function escalationReportFilename(code: FailureCode, timestampIso: string): string {
  const safeTs = timestampIso.replace(/[:.]/g, '-')
  return `escalation-${code}-${safeTs}.json`
}

export interface FailureContext {
  readonly peerId?: string
  readonly detail?: string
}

export type EscalateFailureFn = (
  code: FailureCode,
  context: FailureContext,
) => Promise<never>
