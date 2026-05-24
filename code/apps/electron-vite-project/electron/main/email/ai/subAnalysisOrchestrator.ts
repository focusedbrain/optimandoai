/**
 * Sub-analysis orchestrator (P2.4).
 *
 * Runs phishingAssessor and validationCrosscheck in parallel (Promise.allSettled)
 * and returns a typed result. Both analyses are best-effort: a failure is logged
 * and omitted from the result; it never blocks the caller.
 *
 * `applySubAnalysesToRow` merges the results into the row's existing
 * ai_analysis_json and reseals via resealWithAiAnalysis. The caller (ipc.ts)
 * invokes this after the main LLM analysis succeeds.
 *
 * Rules:
 *   - AI is advisory only — neither failure nor success changes validation outcome.
 *   - If both fail, the existing ai_analysis_json is left untouched (no reseal).
 *   - Reseal failure is logged and swallowed; the main analysis result is still
 *     returned to the renderer.
 */

import type { PhishingAssessment, ValidationCrosscheck } from '@repo/ingestion-core'
import { assessPhishing } from './phishingAssessor'
import type { PhishingAssessorInput } from './phishingAssessor'
import { crosscheckValidation } from './validationCrosscheck'
import type { CrosscheckInput, ValidatorSignal } from './validationCrosscheck'
import type { LlmProvider } from './phishingAssessor'
import { extractUrlsFromText } from './extractUrls'
import { resealWithAiAnalysis } from '../sealedContentUpdate'

// ── Types ─────────────────────────────────────────────────────────────────────

/** Flat message-row fields required by both sub-analyses. */
export interface SubAnalysisRowData {
  subject?: string | null;
  body_text?: string | null;
  from_address?: string | null;
  from_name?: string | null;
  /** Raw `validation_reason` column value from inbox_messages. */
  validation_reason?: string | null;
}

/** A single sub-analysis failure for structured logging. */
export interface SubAnalysisFailure {
  kind: 'phishing' | 'crosscheck';
  reason: string;
  detail: string;
}

/** Result of running both sub-analyses in parallel. */
export interface SubAnalysisOutcome {
  phishing_assessment?: PhishingAssessment;
  validation_crosscheck?: ValidationCrosscheck;
  failures: SubAnalysisFailure[];
}

// ── Pure orchestrator ─────────────────────────────────────────────────────────

/**
 * Build the phishing assessor input from a row.
 */
export function buildPhishingInput(row: SubAnalysisRowData): PhishingAssessorInput {
  const subject = row.subject ?? '(No subject)'
  const bodyText = row.body_text ?? ''
  const senderEmail = row.from_address ?? ''
  const senderDisplayName = row.from_name ?? senderEmail

  const headers: Record<string, string> = {}
  if (senderEmail) headers['From'] = `${senderDisplayName} <${senderEmail}>`

  return {
    subject,
    body_text: bodyText,
    headers,
    urls: extractUrlsFromText(bodyText),
    sender_display_name: senderDisplayName,
    sender_email: senderEmail,
  }
}

/**
 * Build the crosscheck input from a row.
 */
export function buildCrosscheckInput(row: SubAnalysisRowData): CrosscheckInput {
  const subject = row.subject ?? '(No subject)'
  const bodyText = row.body_text ?? ''
  const senderEmail = row.from_address ?? ''
  const senderDisplayName = row.from_name ?? senderEmail

  const headers: Record<string, string> = {}
  if (senderEmail) headers['From'] = `${senderDisplayName} <${senderEmail}>`

  // Map the stored validation_reason to a ValidatorSignal.
  const signals: ValidatorSignal[] = []
  if (row.validation_reason) {
    signals.push({
      reason_code: row.validation_reason as import('@repo/ingestion-core').ValidationReasonCode,
      details: null,
    })
  }
  const validatorPassed = !row.validation_reason

  return {
    subject,
    body_text: bodyText,
    headers,
    sender_display_name: senderDisplayName,
    sender_email: senderEmail,
    validator_passed: validatorPassed,
    validator_signals: signals,
  }
}

/**
 * Run both sub-analyses in parallel. Never throws.
 *
 * Failures are captured in the `failures` array with structured context for
 * the caller to log with the appropriate severity (console.log, not console.error,
 * because these are advisory and expected to fail in some environments).
 */
export async function runSubAnalyses(
  row: SubAnalysisRowData,
  provider: LlmProvider,
): Promise<SubAnalysisOutcome> {
  const phishingInput = buildPhishingInput(row)
  const crosscheckInput = buildCrosscheckInput(row)

  const [phishingSettled, crosscheckSettled] = await Promise.allSettled([
    assessPhishing(phishingInput, provider),
    crosscheckValidation(crosscheckInput, provider),
  ])

  const outcome: SubAnalysisOutcome = { failures: [] }

  if (phishingSettled.status === 'fulfilled') {
    const r = phishingSettled.value
    if (r.ok) {
      outcome.phishing_assessment = r.assessment
    } else {
      outcome.failures.push({ kind: 'phishing', reason: r.reason, detail: r.detail })
    }
  } else {
    const err = phishingSettled.reason
    outcome.failures.push({
      kind: 'phishing',
      reason: 'provider_error',
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  if (crosscheckSettled.status === 'fulfilled') {
    const r = crosscheckSettled.value
    if (r.ok) {
      outcome.validation_crosscheck = r.crosscheck
    } else {
      outcome.failures.push({ kind: 'crosscheck', reason: r.reason, detail: r.detail })
    }
  } else {
    const err = crosscheckSettled.reason
    outcome.failures.push({
      kind: 'crosscheck',
      reason: 'provider_error',
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  return outcome
}

// ── DB merge + reseal ─────────────────────────────────────────────────────────

/**
 * Merge sub-analysis results into the row's existing ai_analysis_json and reseal.
 *
 * - If both sub-analyses failed, no reseal is attempted (nothing to merge).
 * - Reseal failure is logged and swallowed; the main analysis result is still
 *   returned to the renderer by the caller.
 *
 * @returns `{ ok: true }` if resealed, `{ ok: false, reason }` otherwise.
 */
export async function applySubAnalysesToRow(
  db: unknown,
  messageId: string,
  outcome: SubAnalysisOutcome,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { phishing_assessment, validation_crosscheck, failures } = outcome

  // Log any failures.
  for (const f of failures) {
    console.log(
      `[AI_ANALYZE] ${JSON.stringify({
        ai_subanalysis_failed: f.kind,
        reason: f.reason,
        detail: f.detail.slice(0, 200),
        messageId,
      })}`,
    )
  }

  // Nothing to write.
  if (!phishing_assessment && !validation_crosscheck) {
    return { ok: false, reason: 'no_sub_analyses_succeeded' }
  }

  // Read existing ai_analysis_json.
  const existingRow = (db as { prepare: (sql: string) => { get: (id: string) => unknown } })
    .prepare('SELECT ai_analysis_json FROM inbox_messages WHERE id = ?')
    .get(messageId) as { ai_analysis_json?: string | null } | undefined

  let merged: Record<string, unknown> = {}
  if (existingRow?.ai_analysis_json) {
    try {
      merged = JSON.parse(existingRow.ai_analysis_json) as Record<string, unknown>
    } catch {
      /* malformed existing data — start fresh */
    }
  }

  if (phishing_assessment) merged['phishing_assessment'] = phishing_assessment
  if (validation_crosscheck) merged['validation_crosscheck'] = validation_crosscheck

  const sealRes = await resealWithAiAnalysis(db, messageId, merged)
  if (!sealRes.ok) {
    console.log(
      `[AI_ANALYZE] ${JSON.stringify({
        ai_subanalysis_reseal_failed: true,
        error: sealRes.error,
        messageId,
      })}`,
    )
    return { ok: false, reason: sealRes.error ?? 'reseal_failed' }
  }

  return { ok: true }
}
