import type { InboxFilter } from '../stores/useEmailInboxStore'

/**
 * Row shape for AutoSort Session Review lists and “open in inbox” navigation.
 * Aligns with `autosort:getSessionMessages` projection and list tab semantics.
 */
export type SessionReviewMessageRow = {
  id: string
  received_at?: string | null
  sort_category?: string | null
  urgency_score?: number | null
  needs_reply?: number | null
  sort_reason?: string | null
  from_name?: string | null
  from_address?: string | null
  subject?: string | null
  pending_delete?: number | null
  pending_review_at?: string | null
  archived?: number | null
}

/**
 * Maps a live inbox row to the workflow tab filter that lists it, matching
 * `buildInboxMessagesWhereClause` / `filterByInboxFilter` precedence.
 */
export function workflowFilterFromSessionReviewRow(
  msg: Pick<SessionReviewMessageRow, 'sort_category' | 'urgency_score' | 'pending_delete' | 'archived'>,
): InboxFilter['filter'] {
  if ((msg.archived ?? 0) === 1) return 'archived'
  if ((msg.pending_delete ?? 0) === 1) return 'pending_delete'
  const cat = (msg.sort_category || '').trim().toLowerCase()
  if (cat === 'urgent') return 'urgent'
  const u = msg.urgency_score
  if (typeof u === 'number' && !Number.isNaN(u) && u >= 7) return 'urgent'
  if (cat === 'pending_review') return 'pending_review'
  return 'all'
}
