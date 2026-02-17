// ============================================================================
// WRVault Autofill — Write Boundary (Import Guard)
// ============================================================================
//
// This module is the ONLY sanctioned public surface for DOM-write operations.
//
// EXPORTED (safe for external callers):
//   commitInsert   — full pipeline: consent → safety → atomic write
//   runSafetyChecks — pre-commit safety gate (no side effects)
//   setTelemetryHook — register local diagnostics
//
// NOT EXPORTED:
//   setValueSafely — raw DOM write. Only committer.ts and inlinePopover.ts
//                    may import it directly from ./committer.
//
// If you need setValueSafely, you are almost certainly doing something wrong.
// All DOM writes must flow through commitInsert (overlay consent path) or
// inlinePopover (click-to-fill path). Both enforce isTrusted / safety checks
// before any value touches the DOM.
//
// See also: scripts/check-write-boundary.sh (CI guardrail)
// ============================================================================

export { commitInsert, runSafetyChecks, setTelemetryHook } from './committer'
export type { SetValueResult, CommitTelemetryEvent } from './committer'
