/**
 * Scam Watchdog — phishing / social-engineering signal section for inbox AI analysis.
 *
 * Design: Scam Watchdog is a PEER analysis category of the existing combined inbox
 * analysis (summary / urgency / needsReply / …). It does NOT add a new model or a new
 * inference call — it appends extra JSON keys to the SAME `inbox:aiAnalyzeMessageStream`
 * prompt and is parsed alongside the other fields. It runs identically on host and
 * sandbox because the analysis IPC handler is mode-agnostic (routing differs only in
 * transport, not in the prompt).
 *
 * Hard constraints (asserted by tests):
 * - Text / metadata / link-STRING only. This module performs NO network access, NO
 *   link-following / fetching, and NO original-artifact / attachment access. Link
 *   extraction is pure regex over the already-validated message body string.
 * - Informational only: it flags concrete, nameable signals. It never auto-acts, blocks,
 *   or deletes.
 */

/** JSON keys the model is asked to add to the combined analysis object. */
export const SCAM_WATCHDOG_JSON_KEYS = ['scamStatus', 'scamFindings'] as const

/**
 * Prompt section appended to the analysis system prompt (after the existing keys, the
 * same way tone / sort-rules / context blocks are appended). Encodes the detection
 * signals and the first-class false-positive discipline, including the brand
 * cross-check and the stay-silent cases.
 */
export const SCAM_WATCHDOG_PROMPT_SECTION = `

ADDITIONAL ANALYSIS — Scam Watchdog (phishing / social-engineering detector). Add these keys to the SAME JSON object:
- scamStatus: "clear" | "flagged" — "flagged" ONLY when one or more specific, nameable scam/phishing signals are concretely present in THIS message; otherwise "clear".
- scamFindings: string[] — one concrete sentence per signal that the user can self-verify, naming the exact evidence (sender, brand, phrase, or link). MUST be an empty array when scamStatus is "clear".

Analyze ONLY the sender fields, the message text, and the link strings provided below. You did NOT and must NOT visit, follow, or fetch any link, attachment, or external resource — reason about links purely as text strings.

Flag ONLY these signals, and only when concretely present:
1. Sender structural mismatch: display name vs actual email address mismatch; lookalike / punycode sender domain; reply-to differing from the from-address; or a raw-IP / malformed sender. Name the mismatch (e.g. 'Display name says "PayPal" but the address is billing@secure-pay-alerts.ru').
2. Brand impersonation — this is a CROSS-CHECK and requires ALL THREE: (a) the content invokes a recognizable, widely-known brand/service, AND (b) it requests an account / credential / login / payment action, AND (c) the sender's email domain is unrelated to that brand. Only then flag, naming the brand and the actual sender domain (e.g. 'Asks you to update your eBay account, but was sent from peter@xxx.com, which is not an eBay domain'). Do NOT flag brand impersonation for unknown/unfamiliar brands or when the sender domain plausibly matches the brand.
3. Content pressure: urgency / threats ("verify now or lose access"), credential-harvest phrasing, or payment / gift-card / wire-transfer requests, especially when they conflict with who the sender claims to be. Quote or paraphrase the specific phrase.
4. Link strings (analyze as STRINGS ONLY — never follow/fetch): lookalike / punycode domain; anchor-text-vs-href mismatch (visible text claims one destination, the URL points elsewhere); URL-shortener hiding the real destination; raw-IP URL; or a credential-harvest URL shape. Name the specific link.

FALSE-POSITIVE DISCIPLINE (mandatory — this is a first-class requirement):
- Never output a vague risk score or generic worry. Every finding must name specific evidence found in THIS message.
- An unremarkable message — including an unfamiliar sender that makes NO brand claim and shows NO suspicious signal — is "clear" with an empty scamFindings array. NEVER flag merely because you do not recognize the sender.
- Brand impersonation applies to RECOGNIZABLE brands only.
- A legitimate transactional message (a real invoice, receipt, or account notice from a domain that matches the claimed brand/service) is "clear".
- When nothing concrete is present, return scamStatus "clear" and scamFindings [].`

const BARE_URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi
const MD_LINK_RE = /\[([^\]]+)]\((https?:\/\/[^)\s<]+)\)/gi
const HTML_ANCHOR_RE = /<a\b[^>]*?href\s*=\s*["']?(https?:\/\/[^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi

const MAX_LINKS = 30
const MAX_ENTRY_LEN = 300

function stripHtmlTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function clamp(s: string): string {
  const t = s.trim()
  return t.length > MAX_ENTRY_LEN ? `${t.slice(0, MAX_ENTRY_LEN)}…` : t
}

/**
 * Extract link strings from an already-validated message body for string-only analysis.
 *
 * PURE: regex over the input string only. Performs NO network access and NEVER follows,
 * resolves, or fetches any link. When an anchor/label is present (Markdown or HTML), the
 * entry exposes the visible text alongside the URL so the model can detect
 * anchor-text-vs-href mismatches.
 */
export function extractScamWatchdogLinkStrings(body: string): string[] {
  if (!body || typeof body !== 'string') return []
  const seen = new Set<string>()
  const out: string[] = []

  const push = (entry: string) => {
    const e = clamp(entry)
    if (!e) return
    if (seen.has(e)) return
    seen.add(e)
    if (out.length < MAX_LINKS) out.push(e)
  }

  for (const m of body.matchAll(MD_LINK_RE)) {
    const label = (m[1] || '').trim()
    const url = (m[2] || '').trim()
    if (url) push(label ? `"${label}" -> ${url}` : url)
  }

  for (const m of body.matchAll(HTML_ANCHOR_RE)) {
    const url = (m[1] || '').trim()
    const label = stripHtmlTags(m[2] || '')
    if (url) push(label ? `"${label}" -> ${url}` : url)
  }

  for (const m of body.matchAll(BARE_URL_RE)) {
    const url = (m[0] || '').trim().replace(/[.,;:]+$/, '')
    if (url) push(url)
  }

  return out
}

/**
 * Build the user-prompt context block listing the detected link strings. Appended to the
 * existing analysis user prompt. The sender fields are already present in that prompt, so
 * this block only adds the link strings (with an explicit no-fetch reminder).
 */
export function buildScamWatchdogUserContext(body: string): string {
  const links = extractScamWatchdogLinkStrings(body)
  if (links.length === 0) {
    return '\n\nLink strings detected for Scam Watchdog: none.'
  }
  const list = links.map((l) => `- ${l}`).join('\n')
  return `\n\nLink strings detected for Scam Watchdog (analyze as TEXT ONLY — do NOT visit or fetch):\n${list}`
}

/** Append the Scam Watchdog key declarations + guidance to an analysis system prompt. */
export function appendScamWatchdogToSystemPrompt(systemPrompt: string): string {
  return systemPrompt + SCAM_WATCHDOG_PROMPT_SECTION
}
