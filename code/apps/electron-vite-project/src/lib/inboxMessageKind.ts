/**
 * Product-facing inbox message classification (BEAP inbox).
 * Independent of raw `source_type` transport labels — use this for filters and UI logic.
 *
 * Rules (renderer + main must stay aligned):
 * - `handshake`: non-empty `handshake_id` OR `source_type === 'direct_beap'`
 * - `depackaged`: everything else
 */

/** Filter dimension: All, or restrict to one product-facing kind. */
export type InboxMessageKindFilter = 'all' | 'handshake' | 'depackaged'

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
