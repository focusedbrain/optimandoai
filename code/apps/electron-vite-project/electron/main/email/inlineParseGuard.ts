/**
 * B2.1 (D5.2) — the inline-parse guard: the runtime embodiment of invariant-0.
 *
 * Invariant-0 (types.ts §INV-1/INV-7): when the email-depackage cutover is ON,
 * untrusted message structure is parsed ONLY inside the isolated, key-less guest
 * — NEVER inline in the orchestrator. This guard makes that a *proof* rather than
 * an absence of logs: it is placed at every orchestrator-side inline-parse entry
 * point (the raw-byte carrier detection in `messageRouter`, the `gateway.ts`
 * HTML→text derivation). When the flag is ON, reaching one of those points throws
 * `InlineParseForbiddenError` (typed `E_INLINE_PARSE_FORBIDDEN`), which the
 * ingestion consumer maps to a quarantine reason. When the flag is OFF the guard
 * is inert (one cheap flag read) — zero behavior change.
 *
 * It is ALWAYS-ON with the flag (not test-only): in correct flag-on operation the
 * guarded points are never reached (the byte-courier path replaced them), so the
 * guard only ever fires on a regression / missed cutover location — and when it
 * does, it fails closed loudly instead of silently parsing untrusted bytes.
 */

import { isSeamDepackageCutoverEnabled } from '../critical-jobs/featureFlags'

export const INLINE_PARSE_FORBIDDEN_CODE = 'E_INLINE_PARSE_FORBIDDEN' as const

/** Thrown when an inline-parse entry point is reached while the cutover is ON. */
export class InlineParseForbiddenError extends Error {
  readonly code = INLINE_PARSE_FORBIDDEN_CODE
  constructor(public readonly entryPoint: string) {
    super(`inline parse forbidden while depackage cutover is on: ${entryPoint}`)
    this.name = 'InlineParseForbiddenError'
  }
}

/**
 * Assert that orchestrator-side inline parsing is permitted right now. Throws
 * `InlineParseForbiddenError` iff the depackage cutover flag is ON. Cheap and
 * side-effect-free when the flag is OFF.
 *
 * @param entryPoint stable identifier of the guarded site (for logs/quarantine).
 */
export function assertNoInlineParse(entryPoint: string): void {
  if (isSeamDepackageCutoverEnabled()) {
    throw new InlineParseForbiddenError(entryPoint)
  }
}
