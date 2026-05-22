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
 * - `validated` — passed the applicable gate (validator or conformant non-BEAP stamp)
 * - `rejected`  — validator rejection or tamper reason
 * - `pending`   — no stamp yet (should not occur for production ingest paths)
 */
export type ValidationState =
  | 'validated'
  | 'rejected'
  | 'pending'

/** Rows that passed ingest without a BEAP validator rejection (still require validated_at). */
const CONFORMANT_VALIDATION_REASONS = new Set<string>([
  'plain_email_no_validation_required',
  'non_confidential_ledger_sealed',
])

/**
 * Derive the validation state for a BEAP inbox row.
 */
export function getValidationState(
  validated_at: string | null | undefined,
  validation_reason: string | null | undefined,
): ValidationState {
  if (validation_reason && CONFORMANT_VALIDATION_REASONS.has(validation_reason)) {
    return validated_at != null ? 'validated' : 'pending'
  }
  if (validated_at != null && !validation_reason) return 'validated'
  if (validation_reason != null) return 'rejected'
  return 'pending'
}
