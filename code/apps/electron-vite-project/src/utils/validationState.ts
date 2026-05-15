/**
 * Validation-state helper — single source of truth for the inbox UI gate.
 *
 * Per Decision B (PR 5 / Canon I.3.4): artefact-related UI (Run Automation,
 * session preview, artefact details) MUST NOT render unless the row is in
 * 'validated' state. Only validated capsules are distributed to any trust
 * domain; the inbox UI is a trust domain.
 *
 * Identical copy lives in apps/extension-chromium/src/beap-messages/validationState.ts
 * for use by BeapMessageDetailPanel.
 */

/**
 * Discriminated validation state for an inbox row.
 *
 * - `validated` — validated_at set, no rejection reason
 * - `rejected`  — any non-null validation_reason
 * - `pending`   — validated_at null AND validation_reason null (defended against
 *                 future bugs; should not occur in production after PR 2.2)
 *
 * `unrecoverable_legacy` removed in PR 5.3 — no production customers; no rows
 * in this state. per Canon Decision D (PR 5.3).
 */
export type ValidationState =
  | 'validated'
  | 'rejected'
  | 'pending'

/**
 * Derive the validation state for a BEAP inbox row.
 *
 * Three branches, one invariant per branch. Both `BeapMessageDetailPanel`
 * (extension) and `EmailMessageDetail` (Electron) import their respective
 * copy of this function.
 *
 * @param validated_at     ISO-8601 UTC timestamp from the validation gate,
 *                         or null/undefined when not yet validated.
 * @param validation_reason  Rejection reason code, or null/undefined when
 *                         validation passed or is still pending.
 */
export function getValidationState(
  validated_at: string | null | undefined,
  validation_reason: string | null | undefined,
): ValidationState {
  if (validated_at != null && !validation_reason) return 'validated'
  if (validation_reason != null) return 'rejected'
  return 'pending'
}
