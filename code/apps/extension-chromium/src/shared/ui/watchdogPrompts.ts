/**
 * Scam Watchdog vision scan system prompt — shared by main-process watchdogService and built-in mode seed.
 */

export const WATCHDOG_SYSTEM_PROMPT = `You are a cybersecurity watchdog assistant. You are shown screenshots of a user's computer screens and text content from their open browser tabs.
Analyse ALL content for security threats including but not limited to:

Phishing attempts (fake login pages, credential harvesting)
Scam websites or messages (fake prizes, urgency tactics, too-good-to-be-true offers)
Fraud indicators (fake invoices, impersonation, business email compromise)
Suspicious or malicious links (URL mismatches, homograph attacks, shortened URLs to unknown destinations)
Chat fraud (romance scams, fake tech support, social engineering in messaging apps)
Social engineering (urgency, impersonation, manipulation outside chat contexts)
Malware indicators (fake download buttons, deceptive install prompts, suspicious executables)
Fishy emails (spoofed senders, urgent action requests, unexpected attachments)
Fake or spoofed websites (banking, social media, government impersonation)
Suspicious browser extensions or popups

Respond ONLY with a JSON object. No markdown, no explanation outside the JSON.
If threats are found:
{
"threats": [
{
"severity": "low|medium|high|critical",
"category": "phishing|scam|malware|social_engineering|suspicious_link|fake_login|chat_fraud|fraud|other",
"source": "Screen 1|Tab: example.com|etc",
"summary": "Brief description of what was detected",
"advice": "What the user should do"
}
]
}
If everything looks safe:
{ "threats": [] }`

/** WR Chat prefix copy (formerly hard-coded in chatFocusLlmPrefix). */
export const SCAM_WATCHDOG_CHAT_INSTRUCTION =
  'User has Scam Watchdog automation focus. Analyze input for potential scam, fraud, or phishing indicators.'

/** Marker between chat and scan sections in legacy bundled `searchFocus` (pre chat/scan split). */
export const SCAM_WATCHDOG_SCAN_SECTION_MARKER = '\n\nFor screen scans:\n'

/** Legacy bundled default — used for one-time backfill only. */
export const SCAM_WATCHDOG_LEGACY_BUNDLED_SEARCH_FOCUS = `${SCAM_WATCHDOG_CHAT_INSTRUCTION}${SCAM_WATCHDOG_SCAN_SECTION_MARKER}${WATCHDOG_SYSTEM_PROMPT}`

/** Default editable `searchFocus` for the built-in Scam Watchdog mode (chat-facing only). */
export const SCAM_WATCHDOG_DEFAULT_SEARCH_FOCUS = SCAM_WATCHDOG_CHAT_INSTRUCTION

/** Returns the scan-only portion from a legacy bundled `searchFocus`, or null. */
export function extractScamWatchdogScanPromptFromLegacySearchFocus(focus: string): string | null {
  const t = focus.trim()
  if (!t) return null
  if (t.includes(SCAM_WATCHDOG_SCAN_SECTION_MARKER)) {
    const scanPart = t.split(SCAM_WATCHDOG_SCAN_SECTION_MARKER).slice(1).join(SCAM_WATCHDOG_SCAN_SECTION_MARKER).trim()
    if (scanPart.includes('"threats"') || scanPart.includes('Respond ONLY with a JSON')) return scanPart
  }
  if (t.includes('Respond ONLY with a JSON object') && t.includes('"threats"')) return t
  return null
}

/** Strip legacy scan JSON from bundled searchFocus; returns chat-only text or null if unchanged. */
export function scamWatchdogSearchFocusToChatOnly(focus: string): string | null {
  const t = focus.trim()
  if (!t) return null
  if (t === SCAM_WATCHDOG_LEGACY_BUNDLED_SEARCH_FOCUS.trim()) return SCAM_WATCHDOG_CHAT_INSTRUCTION
  const scanPart = extractScamWatchdogScanPromptFromLegacySearchFocus(t)
  if (!scanPart) return null
  const chatPart = t.slice(0, t.indexOf(SCAM_WATCHDOG_SCAN_SECTION_MARKER)).trim()
  if (chatPart && !chatPart.includes('Respond ONLY with a JSON object')) return chatPart
  return SCAM_WATCHDOG_CHAT_INSTRUCTION
}
