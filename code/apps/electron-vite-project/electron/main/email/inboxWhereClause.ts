/**
 * Inbox list WHERE clause — shared by `inbox:listMessages`, `inbox:listMessageIds`,
 * and read-only `inbox:dashboardSnapshot`. Keep a single implementation.
 */

/** Options shared by inbox:listMessages and inbox:listMessageIds (WHERE clause only). */
export type InboxListFilterOptions = {
  filter?: string
  sourceType?: string
  /** Product-facing kind — aligned with `deriveInboxMessageKind` in renderer (`src/lib/inboxMessageKind.ts`). */
  messageKind?: 'handshake' | 'depackaged'
  handshakeId?: string
  category?: string
  search?: string
}

/**
 * Build WHERE + bind params for inbox message lists. Must stay aligned across list handlers.
 */
export function buildInboxMessagesWhereClause(options: InboxListFilterOptions = {}): { where: string; params: unknown[] } {
  const { filter, sourceType, messageKind, handshakeId, category, search } = options
  const conditions: string[] = []
  const params: unknown[] = []

  if (filter === 'deleted') conditions.push('deleted = 1')
  else if (filter === 'pending_delete') {
    conditions.push('deleted = 0', 'pending_delete = 1')
  } else if (filter === 'pending_review') {
    conditions.push(
      'deleted = 0',
      'archived = 0',
      '(pending_delete = 0 OR pending_delete IS NULL)',
      'sort_category = ?',
    )
    params.push('pending_review')
  } else if (filter === 'urgent') {
    conditions.push(
      'deleted = 0',
      'archived = 0',
      '(pending_delete = 0 OR pending_delete IS NULL)',
      'sort_category = ?',
    )
    params.push('urgent')
  } else if (filter === 'unread') {
    conditions.push(
      'deleted = 0',
      'archived = 0',
      'read_status = 0',
      '(pending_delete = 0 OR pending_delete IS NULL)',
      '(sort_category IS NULL OR sort_category NOT IN (?, ?))',
    )
    params.push('pending_review', 'urgent')
  } else if (filter === 'starred') {
    conditions.push(
      'deleted = 0',
      'archived = 0',
      'starred = 1',
      '(pending_delete = 0 OR pending_delete IS NULL)',
      '(sort_category IS NULL OR sort_category NOT IN (?, ?))',
    )
    params.push('pending_review', 'urgent')
  } else if (filter === 'archived') {
    conditions.push('archived = 1', 'deleted = 0')
  } else {
    /* all: main inbox — exclude archived, deleted, pending_delete, pending_review, urgent */
    conditions.push(
      'deleted = 0',
      'archived = 0',
      '(pending_delete = 0 OR pending_delete IS NULL)',
      '(sort_category IS NULL OR sort_category NOT IN (?, ?))',
    )
    params.push('pending_review', 'urgent')
  }
  if (sourceType) {
    conditions.push('source_type = ?')
    params.push(sourceType)
  }
  if (messageKind === 'handshake') {
    conditions.push(
      '((handshake_id IS NOT NULL AND trim(handshake_id) != ?) OR source_type = ?)',
    )
    params.push('', 'direct_beap')
  } else if (messageKind === 'depackaged') {
    conditions.push(
      '((handshake_id IS NULL OR trim(handshake_id) = ?) AND (source_type IS NULL OR source_type != ?))',
    )
    params.push('', 'direct_beap')
  }
  if (handshakeId) {
    conditions.push('handshake_id = ?')
    params.push(handshakeId)
  }
  if (category) {
    conditions.push('sort_category = ?')
    params.push(category)
  }
  if (search && search.trim()) {
    const q = `%${search.trim()}%`
    conditions.push('(subject LIKE ? OR body_text LIKE ? OR from_address LIKE ? OR from_name LIKE ?)')
    params.push(q, q, q, q)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return { where, params }
}
