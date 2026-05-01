/**
 * Inbox Type filter: message origin only (not status, not Handshakes tab).
 * Aligned with main-process AI routes via {@link classifyInboxRowForAi} (sandbox clone-of-plain override).
 *
 * The store uses `source_type` ∈ {`direct_beap`, `email_beap`, `email_plain`} — BEAP payloads can also
 * live on `email_plain` with `beap_package_json` / depackaged JSON (see `inboxBeapRowEligibility`).
 * Depackaging state (e.g. `beap_qbeap_decrypted` in `depackaged_json`) is orthogonal to this filter.
 *
 * Rules:
 * - `handshake` (UI: Native BEAP): same boolean as IPC “native BEAP” for analyze/draft after clone override.
 * - `depackaged`: everything else (including P2P `direct_beap` rows that are clones of plain email).
 */

import { classifyInboxRowForAi, type InboxMessageAiClassificationRow } from './inboxAiCloneClassification'

/** Filter dimension: All, or one origin slice. Internal values stable for IPC. */
export type InboxMessageKindFilter = 'all' | 'handshake' | 'depackaged'

/** Normalize legacy or invalid persisted values (e.g. removed `auto_filed`). */
export function coerceInboxMessageKindFilter(v: unknown): InboxMessageKindFilter {
  if (v === 'handshake' || v === 'depackaged') return v
  return 'all'
}

/** Derived kind for a single row (no `all`). */
export type InboxMessageKindDerived = 'handshake' | 'depackaged'

/** Minimal row shape for classification (avoids circular imports with the inbox store). */
export type InboxMessageKindFields = {
  handshake_id: string | null
  source_type: string
  depackaged_json?: string | null
  beap_package_json?: string | null
  body_text?: string | null
  body_html?: string | null
  original_source_type?: string | null
}

export function deriveInboxMessageKind(m: InboxMessageKindFields): InboxMessageKindDerived {
  return classifyInboxRowForAi(m as InboxMessageAiClassificationRow).isNativeBeap ? 'handshake' : 'depackaged'
}

export function messageMatchesKindFilter(m: InboxMessageKindFields, kind: InboxMessageKindFilter): boolean {
  if (kind === 'all') return true
  return deriveInboxMessageKind(m) === kind
}

/**
 * Handshake nav icon: product kind is handshake **and** we have a stable `handshake_id` for navigation.
 * (`direct_beap` without id → no affordance — see product rules.)
 */
export function showHandshakeNavIcon(m: InboxMessageKindFields): boolean {
  const id = m.handshake_id != null ? String(m.handshake_id).trim() : ''
  if (!id) return false
  return deriveInboxMessageKind(m) === 'handshake'
}
