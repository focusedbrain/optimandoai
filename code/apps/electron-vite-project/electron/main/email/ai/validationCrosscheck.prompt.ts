/**
 * Validation cross-check prompt (P2.3).
 *
 * CROSSCHECK_VERSION tracks the prompt version — distinct from the phishing
 * assessor's DISCLAIMER_VERSION. Bump when the question framing, finding
 * taxonomy, or confidence rubric changes materially.
 *
 * The cross-check is advisory only: disagreement triggers a needs_review UI
 * state; it never changes the validator's sealed outcome.
 */

export const CROSSCHECK_VERSION = 'v1' as const;

/**
 * Build the system prompt for the validation cross-check LLM call.
 *
 * The model name and authoritative timestamp are injected so that the
 * cross-check record is fully self-describing without relying on the model
 * to know the current time.
 */
export function buildCrosscheckSystemPrompt(opts: {
  modelName: string;
  nowIso: string;
  validatorPassed: boolean;
  validatorSignalSummary: string;
}): string {
  const outcome = opts.validatorPassed
    ? 'PASSED (the validator accepted this message as structurally valid)'
    : 'FAILED (the validator rejected this message)';

  return `You are a security analyst performing an independent cross-check of a structural validator's decision.

AUTHORITY RULE — read this first:
The structural validator is the CANONICAL AUTHORITY. Its decision is final and sealed.
You are a cross-check, not an override. Your role is to describe what you observed in the email that might corroborate or warrant a second look at the validator's outcome. You MUST NOT assert that the validator is wrong. If you disagree, describe the signals you observed and explain why a human reviewer might want to inspect the message — nothing more.

OUTPUT RULES:
- Respond with ONLY a single JSON object. No markdown, no code fences, no prose before or after.
- The JSON must conform EXACTLY to the schema below. Extra fields are allowed; missing required fields are not.

SCHEMA:
{
  "agrees_with_validator": <boolean>,
  "findings": [{ "kind": <string>, "evidence": <string> }],
  "confidence": <"low" | "medium" | "high">,
  "model": "${opts.modelName}",
  "generated_at": "${opts.nowIso}"
}

VALIDATOR OUTCOME: ${outcome}

VALIDATOR SIGNALS:
${opts.validatorSignalSummary}

CONFIDENCE RUBRIC:
- "high"   : you have clear, specific observations that support or challenge the outcome with strong evidence
- "medium" : you have some relevant observations but the picture is not unambiguous
- "low"    : you cannot form a clear view based on the content; prefer this when uncertain

FINDING KINDS (non-exhaustive taxonomy — add others as needed):
  urgency_pressure, sender_display_mismatch, unusual_attachment, link_domain_mismatch,
  missing_authentication_headers, lookalike_domain, credential_request, payment_request,
  corroborates_validator, contradicts_validator_outcome, insufficient_evidence,
  analysis_uncertainty

DISAGREEMENT RULE:
If agrees_with_validator is false, you MUST include at least one finding with kind "contradicts_validator_outcome" explaining what specific observable signal made you flag the message for human review. Do NOT use emotionally charged language. Be precise and factual.

Do not explain your reasoning outside the JSON. Do not add commentary.`;
}

/**
 * Build the user message for the validation cross-check LLM call.
 */
export function buildCrosscheckUserMessage(opts: {
  subject: string;
  senderDisplayName: string;
  senderEmail: string;
  headers: Record<string, string>;
  bodyText: string;
}): string {
  const headerLines = Object.entries(opts.headers)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  return `Cross-check the following email against the validator outcome provided in the system prompt.

FROM: ${opts.senderDisplayName} <${opts.senderEmail}>
SUBJECT: ${opts.subject}
HEADERS:
${headerLines}

PLAIN TEXT BODY:
${opts.bodyText.slice(0, 6000)}

Respond with the JSON object only.`;
}
