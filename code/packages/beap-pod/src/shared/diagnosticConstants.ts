import type { DiagnosticContainerRole } from '@repo/beap-cert';

/** Global ceiling — same message must not exceed this processing window. */
export const STUCK_MESSAGE_GLOBAL_MAX_MS = 60_000;

/** Role-specific per-message processing budgets (Phase 5 — P5.3). */
export const ROLE_MESSAGE_TIMEOUT_MS: Record<DiagnosticContainerRole, number> = {
  depackager: 30_000,
  'pdf-parser': 30_000,
  validator: 10_000,
  certifier: 5_000,
  ingestor: STUCK_MESSAGE_GLOBAL_MAX_MS,
  sealer: STUCK_MESSAGE_GLOBAL_MAX_MS,
  verifier: STUCK_MESSAGE_GLOBAL_MAX_MS,
  'mail-fetcher': STUCK_MESSAGE_GLOBAL_MAX_MS,
};

export const DEFAULT_DIAGNOSTIC_REPORTS_DIR = '/tmp/diagnostic-reports';
