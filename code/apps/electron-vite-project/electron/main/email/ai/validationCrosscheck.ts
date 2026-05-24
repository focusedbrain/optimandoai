/**
 * Validation cross-check module (P2.3).
 *
 * Given the same depackaged content plus the structural validator's pass/fail
 * outcome, asks the LLM whether it independently agrees. Produces a
 * ValidationCrosscheck object matching the P2.1 schema.
 *
 * Rules:
 *   - AI output is advisory only — never changes the sealed validation outcome.
 *   - A disagreement sets a needs_review UI state; it does NOT re-validate.
 *   - Pure function: no SQLite writes, no IPC, no side effects.
 *   - P2.4 wires this into the IPC handler; this module is call-site-agnostic.
 */

import { validateAiAnalysisField } from '@repo/ingestion-core'
import type { ValidationCrosscheck, ValidationReasonCode } from '@repo/ingestion-core'
import { inboxLlmChat, InboxLlmTimeoutError } from '../inboxLlmChat'
import type { ResolvedLlmContext } from '../inboxLlmChat'
import {
  CROSSCHECK_VERSION,
  buildCrosscheckSystemPrompt,
  buildCrosscheckUserMessage,
} from './validationCrosscheck.prompt'

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * A single signal that the structural validator surfaced about this message.
 * reason_code mirrors ValidationReasonCode (the validator's output); details
 * is the human-readable rejection detail from ContentValidationResult.
 */
export interface ValidatorSignal {
  /** The ValidationReasonCode that the validator emitted, or null for a passing message. */
  reason_code: ValidationReasonCode | null;
  /** Human-readable detail string from the validator (may be null). */
  details: string | null;
}

/** Input to the validation cross-check. */
export interface CrosscheckInput {
  subject: string;
  body_text: string;
  /** Relevant transport headers (e.g. From, Reply-To, Received). */
  headers: Record<string, string>;
  sender_display_name: string;
  sender_email: string;
  /** Whether the structural validator passed this message. */
  validator_passed: boolean;
  /** Signals/reason codes the validator emitted (empty array for a clean pass). */
  validator_signals: ValidatorSignal[];
}

/**
 * The LLM provider to use.  Compatible with ResolvedLlmContext from
 * inboxLlmChat so callers can pass the result of preResolveInboxLlm()
 * directly without adaption.
 */
export type LlmProvider = ResolvedLlmContext & { timeoutMs?: number }

/** Typed result — never throws. */
export type CrosscheckResult =
  | { ok: true; crosscheck: ValidationCrosscheck }
  | {
      ok: false;
      reason: 'timeout' | 'model_unavailable' | 'malformed_output' | 'provider_error';
      detail: string;
    }

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default timeout for a validation cross-check LLM call (ms). */
export const CROSSCHECK_TIMEOUT_MS = 30_000

// ── Schema validation via P2.1 ────────────────────────────────────────────────

/**
 * Validate a parsed validation_crosscheck candidate using the P2.1 schema
 * validator (validateAiAnalysisField) as the single source of truth.
 *
 * Returns null if valid, or a human-readable error string if invalid.
 */
function validateCrosscheckCandidate(parsed: unknown): string | null {
  const wrapper: Record<string, unknown> = {
    ai_analysis_json: { validation_crosscheck: parsed },
  }
  const result = validateAiAnalysisField(wrapper, '', '1.0.0', 'validationCrosscheck')
  if (result === null) return null
  return result.validation_details ?? result.validation_reason ?? 'invalid'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Render the validator's signals into a short summary for the LLM system prompt.
 * Keeps it concise — the model doesn't need the full detail text.
 */
function buildValidatorSignalSummary(
  passed: boolean,
  signals: ValidatorSignal[],
): string {
  if (passed && signals.length === 0) {
    return '(no signals — message passed all structural checks)';
  }
  if (signals.length === 0) {
    return '(no specific signals provided)';
  }
  return signals
    .map((s) => {
      const code = s.reason_code ?? 'UNKNOWN'
      return s.details ? `  - ${code}: ${s.details}` : `  - ${code}`
    })
    .join('\n');
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Cross-check the structural validator's decision using the LLM.
 *
 * @param input   Email content, headers, and validator outcome.
 * @param provider  Pre-resolved LLM provider (from preResolveInboxLlm()).
 *
 * The function:
 *   1. Builds the cross-check prompt with the validator's outcome injected.
 *   2. Calls inboxLlmChat with the provider context.
 *   3. Parses the JSON response strictly (no repair, no re-prompt).
 *   4. Validates the parsed object against the P2.1 schema.
 *   5. Stamps model and generated_at from caller context and returns the result.
 */
export async function crosscheckValidation(
  input: CrosscheckInput,
  provider: LlmProvider,
): Promise<CrosscheckResult> {
  const nowIso = new Date().toISOString()
  const modelName = provider.model || 'unknown'
  const timeoutMs = provider.timeoutMs ?? CROSSCHECK_TIMEOUT_MS

  const validatorSignalSummary = buildValidatorSignalSummary(
    input.validator_passed,
    input.validator_signals,
  )

  const system = buildCrosscheckSystemPrompt({
    modelName,
    nowIso,
    validatorPassed: input.validator_passed,
    validatorSignalSummary,
  })
  const user = buildCrosscheckUserMessage({
    subject: input.subject,
    senderDisplayName: input.sender_display_name,
    senderEmail: input.sender_email,
    headers: input.headers,
    bodyText: input.body_text,
  })

  // ── Call the LLM ─────────────────────────────────────────────────────────
  let rawResponse: string
  try {
    rawResponse = await inboxLlmChat({
      system,
      user,
      timeoutMs,
      resolvedContext: provider,
    })
  } catch (err: unknown) {
    if (err instanceof InboxLlmTimeoutError) {
      return { ok: false, reason: 'timeout', detail: err.message }
    }
    const msg = err instanceof Error ? err.message : String(err)
    if (
      msg.includes('No AI model') ||
      msg.includes('no model') ||
      msg.includes('unavailable') ||
      msg.includes('MODEL_UNAVAILABLE')
    ) {
      return { ok: false, reason: 'model_unavailable', detail: msg }
    }
    return { ok: false, reason: 'provider_error', detail: msg }
  }

  // ── Parse JSON ───────────────────────────────────────────────────────────
  const trimmed = rawResponse.trim()
  const jsonText = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return {
      ok: false,
      reason: 'malformed_output',
      detail: `JSON parse failed. Raw response head: ${rawResponse.slice(0, 200)}`,
    }
  }

  // ── Schema validation (P2.1 single source of truth) ─────────────────────
  const validationError = validateCrosscheckCandidate(parsed)
  if (validationError !== null) {
    return {
      ok: false,
      reason: 'malformed_output',
      detail: `Schema validation failed: ${validationError}`,
    }
  }

  // Cast is safe — validateCrosscheckCandidate returned null (valid).
  const candidate = parsed as Record<string, unknown>

  // Stamp authoritative fields regardless of model output.
  const crosscheck: ValidationCrosscheck = {
    ...(candidate as ValidationCrosscheck),
    model: modelName,
    generated_at: nowIso,
  }

  return { ok: true, crosscheck }
}

// ── Re-export version token for callers ──────────────────────────────────────

export { CROSSCHECK_VERSION }
