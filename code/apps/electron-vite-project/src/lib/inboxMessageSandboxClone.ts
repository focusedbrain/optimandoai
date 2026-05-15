/**
 * Detect sandbox-cloned BEAP inbox messages (Host → internal Sandbox) from persisted row fields.
 * Clones carry audit metadata in depackaged / package JSON or embedded plaintext markers — no new DB column required.
 */

import type { InboxMessage } from '../stores/useEmailInboxStore'
import { deriveInboxMessageKind } from './inboxMessageKind'

const BANNER = '[BEAP sandbox clone — sent by you]'

/**
 * Prepended to the sandbox clone public `body_text` on send. UI strips this for display; keep in sync
 * with `beapInboxCloneToSandbox` (imports this constant).
 */
export const SANDBOX_CLONE_INBOX_LEAD_IN =
  `${BANNER}\n` +
  'This is a test clone for your sandbox; the original inbox message is unchanged. New qBEAP only — no original ciphertext reuse.\n' +
  'Automation: sandbox_clone=true in metadata below.\n\n'
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

/**
 * When true, {@link EmailMessageDetail} may use the pBEAP + qBEAP section layout. When false, use the same
 * `body_text` / `body_html` + `beapInboxMessageBodyToLinkParts` path as depackaged email — required for
 * sandbox clones of depackaged BEAP (no qBEAP-only representation).
 */
export function inboxMessageUsesNativeBeapPbeapQbeapSplit(m: InboxMessage | null | undefined): boolean {
  if (!m) return false
  if (inboxMessageIsSandboxBeapClone(m)) return false
  return deriveInboxMessageKind(m) === 'handshake'
}

export const INBOX_SANDBOX_CLONE_BADGE_TOOLTIP =
  'Sandboxed BEAP message — cloned from the Host inbox for safe inspection.'

export const INBOX_DIRECT_BEAP_BADGE_TOOLTIP = 'BEAP message (direct or depackaged in this inbox).'

/** Shown in the compact Sandbox Clone disclosure; parsed from `depackaged_json.beap_sandbox_clone` when present. */
export type SandboxCloneUiMeta = {
  clonedAtLabel?: string
  sourceMessageIdShort?: string
  sourceOrchestratorLine?: string
  targetSandboxName?: string
}

function shortenId(id: string): string {
  const t = id.trim()
  if (!t) return ''
  if (t.length <= 16) return t
  return `${t.slice(0, 8)}…${t.slice(-4)}`
}

/**
 * Metadata for the Sandbox Clone disclosure.
 * Reads clone provenance from `beap_package_json.metadata.inbox_response_path.sandbox_clone_provenance`
 * (the canonical location since PR 5.2). Legacy body-embedded provenance and
 * `depackaged_json.beap_sandbox_clone` fallbacks removed in PR 5.3.
 */
export function extractSandboxCloneUiMeta(
  m: InboxMessage | null | undefined,
  _depackaged: Record<string, unknown> | null,
): SandboxCloneUiMeta {
  if (!m) return {}
  const b = tryGetCloneBlockFromPackageJson(m)
  if (!b) return {}
  const clonedAt =
    typeof b.cloned_at === 'string' && b.cloned_at.trim() ? b.cloned_at.trim() : undefined
  const omid =
    typeof b.original_message_id === 'string' && b.original_message_id.trim()
      ? b.original_message_id.trim()
      : undefined
  const tsn =
    typeof b.target_sandbox_device_name === 'string' && b.target_sandbox_device_name.trim()
      ? b.target_sandbox_device_name.trim()
      : undefined
  const ohs =
    typeof b.original_handshake_id === 'string' && b.original_handshake_id.trim()
      ? b.original_handshake_id.trim()
      : undefined
  const acc = (() => {
    if (typeof b.cloned_by_account === 'string' && b.cloned_by_account.trim()) {
      return b.cloned_by_account.trim()
    }
    if (typeof b.account_tag === 'string' && b.account_tag.trim()) return b.account_tag.trim()
    return undefined
  })()
  let sourceOrchestratorLine: string | undefined
  if (ohs) {
    sourceOrchestratorLine = `Host handshake ${shortenId(ohs)}`
  } else if (acc) {
    sourceOrchestratorLine = `Account ${acc}`
  }
  let clonedAtLabel: string | undefined
  if (clonedAt) {
    const d = new Date(clonedAt)
    clonedAtLabel = Number.isFinite(d.getTime())
      ? d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
      : clonedAt
  }
  return {
    clonedAtLabel,
    sourceMessageIdShort: omid ? shortenId(omid) : undefined,
    sourceOrchestratorLine,
    targetSandboxName: tsn,
  }
}

/**
 * PR 5.2 / Decision B: read the `beap_sandbox_clone` block from the new metadata location.
 * Clone provenance now lives at `beap_package_json.metadata.inbox_response_path.sandbox_clone_provenance`
 * instead of being appended to body text.
 */
function tryGetCloneBlockFromPackageJson(m: InboxMessage): Record<string, unknown> | null {
  const pkgStr = m.beap_package_json
  if (!pkgStr?.trim()) return null
  try {
    const pkg = JSON.parse(pkgStr) as Record<string, unknown>
    const metadata = pkg.metadata as Record<string, unknown> | null | undefined
    if (!metadata) return null
    const irp = metadata.inbox_response_path as Record<string, unknown> | null | undefined
    if (!irp) return null
    const prov = irp.sandbox_clone_provenance
    if (!prov || typeof prov !== 'object' || Array.isArray(prov)) return null
    const provObj = prov as Record<string, unknown>
    const b = provObj.beap_sandbox_clone
    if (b && typeof b === 'object' && b !== null) return b as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

/**
 * Strips the synthetic inbox lead-in so the main body matches the Host-visible content (plus safe links).
 */
export function stripSandboxCloneLeadInFromBodyText(raw: string | null | undefined): string {
  const s = raw ?? ''
  if (!s) return ''
  if (s.startsWith(SANDBOX_CLONE_INBOX_LEAD_IN)) {
    return s.slice(SANDBOX_CLONE_INBOX_LEAD_IN.length)
  }
  if (s.startsWith(BANNER)) {
    return s.slice(BANNER.length).replace(/^\n+/, '')
  }
  return s
}
