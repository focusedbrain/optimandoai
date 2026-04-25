/**
 * Detect sandbox-cloned BEAP inbox messages (Host → internal Sandbox) from persisted row fields.
 * Clones carry audit metadata in depackaged / package JSON or embedded plaintext markers — no new DB column required.
 */

import type { InboxMessage } from '../stores/useEmailInboxStore'

const BANNER = '[BEAP sandbox clone — sent by you]'
const PROV_KEY = 'inbox_sandbox_clone_provenance'

function stringHintsSandboxClone(s: string): boolean {
  if (!s) return false
  if (s.includes(BANNER)) return true
  if (s.includes(PROV_KEY)) return true
  if (s.includes('"beap_sandbox_clone"') && (s.includes('original_message_id') || s.includes('clone_reason'))) return true
  if (/sandbox_clone"?\s*:\s*true/.test(s) && /automation_sandbox_clone"?\s*:\s*true/.test(s)) return true
  return false
}

function walkValue(v: unknown, depth: number): boolean {
  if (depth > 14) return false
  if (v == null) return false
  if (typeof v === 'string') {
    return stringHintsSandboxClone(v)
  }
  if (Array.isArray(v)) {
    return v.some((x) => walkValue(x, depth + 1))
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o.beap_sandbox_clone != null) {
      if (o.beap_sandbox_clone === true) return true
      if (typeof o.beap_sandbox_clone === 'object' && o.beap_sandbox_clone !== null) return true
    }
    if (o[PROV_KEY] != null) return true
    if (o.sandbox_clone === true && o.automation_sandbox_clone === true) return true
    for (const k of Object.keys(o)) {
      if (walkValue(o[k], depth + 1)) return true
    }
  }
  return false
}

function tryParseJson(s: string | null | undefined): boolean {
  if (!s || !s.trim()) return false
  try {
    return walkValue(JSON.parse(s) as unknown, 0)
  } catch {
    return stringHintsSandboxClone(s)
  }
}

/**
 * True when this inbox row is a BEAP message cloned from another inbox for Sandbox inspection
 * (not normal direct BEAP to this orchestrator from a peer in the product sense of “B” vs “S”).
 */
export function inboxMessageIsSandboxBeapClone(m: InboxMessage | null | undefined): boolean {
  if (!m) return false
  if (stringHintsSandboxClone(m.body_text ?? '')) return true
  if (stringHintsSandboxClone(m.body_html ?? '')) return true
  if (tryParseJson(m.depackaged_json)) return true
  if (tryParseJson(m.beap_package_json)) return true
  return false
}

export const INBOX_SANDBOX_CLONE_BADGE_TOOLTIP =
  'Sandboxed BEAP message — cloned from another inbox message for safe inspection.'

export const INBOX_DIRECT_BEAP_BADGE_TOOLTIP = 'BEAP message (direct or depackaged in this inbox).'
