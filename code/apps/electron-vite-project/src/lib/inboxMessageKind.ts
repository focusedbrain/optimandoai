/**
 * Inbox Type filter: message origin only (not status, not Handshakes tab).
 * Independent of raw `source_type` for display — renderer + main stay aligned on filter SQL.
 *
 * “Received BEAP” (clone / Redirect / Sandbox product rules) is *not* this dimension.
 * The store uses `source_type` ∈ {`direct_beap`, `email_beap`, `email_plain`} — BEAP payloads can also
 * live on `email_plain` with `beap_package_json` / depackaged JSON (see `inboxBeapRowEligibility`).
 * Depackaging state (e.g. `beap_qbeap_decrypted` in `depackaged_json`) is orthogonal to this filter.
 *
 * Rules (this file only):
 * - `handshake` (UI: Native BEAP): non-empty `handshake_id` OR `source_type === 'direct_beap'`
 * - `depackaged` (UI: Depackaged Email): everything else
 */

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
}

export function deriveInboxMessageKind(m: InboxMessageKindFields): InboxMessageKindDerived {
  if (m.source_type === 'direct_beap') return 'handshake'
  const h = m.handshake_id
  if (h != null && String(h).trim() !== '') return 'handshake'
  return 'depackaged'
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
