/**
 * Phishing-assessment prompt (P2.2).
 *
 * VERSION controls disclaimer_version in every PhishingAssessment output.
 * Bump when the scoring rubric, label boundaries, or signal taxonomy changes
 * in a way that could change scores meaningfully for the same input.
 *
 * Consumers MUST NOT rely on DISCLAIMER_VERSION staying constant across
 * app updates — treat it as an opaque token for display and audit purposes.
 */

export const DISCLAIMER_VERSION = 'v1' as const;

/**
 * Build the system prompt for the phishing assessment LLM call.
 *
 * The model name and current ISO 8601 timestamp are injected so that
 * generated_at is authoritative (the model doesn't know the real time)
 * and model is traceable to the exact version that produced the score.
 *
 * The prompt requests strict JSON output with no prose. Callers MUST
 * parse the response with JSON.parse; any non-JSON output is treated as
 * malformed_output and discarded.
 */
export function buildPhishingSystemPrompt(opts: {
  modelName: string;
  nowIso: string;
}): string {
  return `You are a security analysis engine. Your only job is to assess the phishing/scam risk of an email.

OUTPUT RULES — read carefully:
- Respond with ONLY a single JSON object. No markdown, no code fences, no prose before or after.
- The JSON must conform EXACTLY to the schema below. Extra fields are allowed; missing required fields are not.
- If you are not confident, prefer a lower score. False positives cost users trust. Real phishing is your priority, but uncertainty should resolve toward 'low' with low-weight signals listed.

SCHEMA:
{
  "score": <integer 0–100>,
  "label": <"low" | "elevated" | "high">,
  "signals": [{ "kind": <string>, "evidence": <string>, "weight": <number 0–1> }],
  "flagged_urls": [{ "url": <string>, "reason": <string>, "open_policy": "sandbox_only" }],
  "disclaimer_version": "${DISCLAIMER_VERSION}",
  "model": "${opts.modelName}",
  "generated_at": "${opts.nowIso}"
}

LABEL BOUNDARIES (apply these consistently):
- "low"      : score  0–30  — likely legitimate; minor anomalies at most
- "elevated" : score 31–69  — suspicious; user should inspect before acting
- "high"     : score 70–100 — strong phishing/scam indicators present

SIGNAL KINDS (non-exhaustive taxonomy — add others as needed):
  urgency_language, threat_language, impersonation, brand_spoofing, lookalike_domain,
  suspicious_link, link_domain_mismatch, credential_request, payment_request,
  unexpected_attachment, unusual_sender, poor_grammar, template_mismatch,
  excessive_personalisation, unusual_time, bulk_headers_absent, reply_to_mismatch

SCORING RUBRIC:
- Each signal contributes weight × 20 to the base score (capped at 100).
- Two or more high-weight signals (≥ 0.7) should push score above 50.
- A single unambiguous impersonation + credential_request should reach ≥ 75.
- Absence of signals → score 0–5.
- If the email is clearly a known newsletter or transactional email, score 0–10.

UNCERTAINTY RULE:
- If you are unsure whether a signal is present, list it with weight ≤ 0.3.
- If you cannot determine the label with reasonable confidence, choose "low" and list one signal: { "kind": "analysis_uncertainty", "evidence": "<reason>", "weight": 0.1 }.

FLAGGED URLS:
- Only include URLs that are materially suspicious (not every link in the email).
- Set open_policy to "sandbox_only" for every entry — this field is fixed.

Do not explain your reasoning outside the JSON. Do not add commentary.`;
}

/**
 * Build the user message for the phishing assessment LLM call.
 */
export function buildPhishingUserMessage(opts: {
  subject: string;
  senderDisplayName: string;
  senderEmail: string;
  headers: Record<string, string>;
  bodyText: string;
  bodyHtml?: string;
  urls: Array<{ href: string; display_text?: string }>;
}): string {
  const headerLines = Object.entries(opts.headers)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  const urlLines =
    opts.urls.length > 0
      ? opts.urls.map((u) => `  - ${u.href}${u.display_text ? ` (text: "${u.display_text}")` : ''}`).join('\n')
      : '  (none)';

  const htmlNote =
    opts.bodyHtml && opts.bodyHtml.trim().length > 0
      ? `\nHTML BODY (stripped):\n${opts.bodyHtml.slice(0, 4000)}`
      : '';

  return `Assess the following email for phishing/scam risk.

FROM: ${opts.senderDisplayName} <${opts.senderEmail}>
SUBJECT: ${opts.subject}
HEADERS:
${headerLines}

EXTRACTED URLS:
${urlLines}

PLAIN TEXT BODY:
${opts.bodyText.slice(0, 6000)}${htmlNote}

Respond with the JSON object only.`;
}
