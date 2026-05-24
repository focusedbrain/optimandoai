/**
 * Phishing assessor (P2.2).
 *
 * Provider-agnostic module that, given a depackaged email body + headers +
 * extracted URLs, produces a PhishingAssessment object matching the schema
 * from P2.1. Returns a typed result — never throws.
 *
 * Rules:
 *   - AI output is advisory only — never gates, quarantines, or rejects.
 *   - Pure function: no SQLite writes, no IPC, no side effects.
 *   - P2.3 wires this into the IPC handler; this module is call-site-agnostic.
 */

import { validateAiAnalysisField } from '@repo/ingestion-core'
import type { PhishingAssessment } from '@repo/ingestion-core'
import { inboxLlmChat, InboxLlmTimeoutError } from '../inboxLlmChat'
import type { ResolvedLlmContext } from '../inboxLlmChat'
import {
  DISCLAIMER_VERSION,
  buildPhishingSystemPrompt,
  buildPhishingUserMessage,
} from './phishingAssessor.prompt'

// ── Public types ──────────────────────────────────────────────────────────────

/** An extracted URL from the email body. */
export interface ExtractedUrl {
  href: string;
  display_text?: string;
}

/** Input to the phishing assessor. */
export interface PhishingAssessorInput {
  subject: string;
  body_text: string;
  body_html?: string;
  /** Relevant transport headers (e.g. From, Reply-To, X-Mailer, Received). */
  headers: Record<string, string>;
  urls: ExtractedUrl[];
  sender_display_name: string;
  sender_email: string;
}

/**
 * The LLM provider to use.  Compatible with ResolvedLlmContext from
 * inboxLlmChat so callers can pass the result of preResolveInboxLlm()
 * directly without adaption.
 */
export type LlmProvider = ResolvedLlmContext & { timeoutMs?: number }

/** Typed result — never throws. */
export type PhishingAssessmentResult =
  | { ok: true; assessment: PhishingAssessment }
  | {
      ok: false;
      reason: 'timeout' | 'model_unavailable' | 'malformed_output' | 'provider_error';
      detail: string;
    }

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default timeout for a phishing-assessment LLM call (ms). */
export const PHISHING_ASSESSOR_TIMEOUT_MS = 30_000

// ── Schema validation via P2.1 ────────────────────────────────────────────────

/**
 * Validate a parsed phishing_assessment candidate using the P2.1 schema
 * validator (validateAiAnalysisField) as the single source of truth.
 *
 * Returns null if valid, or a human-readable error string if invalid.
 */
function validateAssessmentCandidate(parsed: unknown): string | null {
  const wrapper: Record<string, unknown> = {
    ai_analysis_json: { phishing_assessment: parsed },
  }
  const result = validateAiAnalysisField(wrapper, '', '1.0.0', 'phishingAssessor')
  if (result === null) return null
  return result.validation_details ?? result.validation_reason ?? 'invalid'
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Assess the phishing/scam risk of a depackaged email.
 *
 * @param input   Email body, headers, extracted URLs, and sender info.
 * @param provider  Pre-resolved LLM provider (from preResolveInboxLlm()).
 *
 * The function:
 *   1. Builds the structured-output prompt.
 *   2. Calls inboxLlmChat with the provider context.
 *   3. Parses the JSON response strictly (no repair, no re-prompt).
 *   4. Validates the parsed object against the P2.1 schema.
 *   5. Stamps disclaimer_version = DISCLAIMER_VERSION and returns the result.
 */
export async function assessPhishing(
  input: PhishingAssessorInput,
  provider: LlmProvider,
): Promise<PhishingAssessmentResult> {
  const nowIso = new Date().toISOString()
  const modelName = provider.model || 'unknown'
  const timeoutMs = provider.timeoutMs ?? PHISHING_ASSESSOR_TIMEOUT_MS

  const system = buildPhishingSystemPrompt({ modelName, nowIso })
  const user = buildPhishingUserMessage({
    subject: input.subject,
    senderDisplayName: input.sender_display_name,
    senderEmail: input.sender_email,
    headers: input.headers,
    bodyText: input.body_text,
    bodyHtml: input.body_html,
    urls: input.urls,
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
    // No-model / no-API-key errors
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
  // Strip optional markdown code fence if the model ignored the no-prose rule.
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
  const validationError = validateAssessmentCandidate(parsed)
  if (validationError !== null) {
    return {
      ok: false,
      reason: 'malformed_output',
      detail: `Schema validation failed: ${validationError}`,
    }
  }

  // Cast is safe — validateAssessmentCandidate returned null (valid).
  const candidate = parsed as Record<string, unknown>

  // Enforce disclaimer_version and generated_at from our prompt constants
  // regardless of what the model returned — the model's values are advisory.
  const assessment: PhishingAssessment = {
    ...(candidate as PhishingAssessment),
    disclaimer_version: DISCLAIMER_VERSION,
    generated_at: nowIso,
    model: modelName,
  }

  return { ok: true, assessment }
}
