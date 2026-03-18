/**
 * Inbox AI — Shared type contracts for advisory (Normal) vs authoritative (Bulk) modes.
 *
 * Product model:
 * - Normal Inbox: AI is informative, assistive, non-authoritative. No silent moves or reclassifications.
 * - Bulk Inbox: AI is authoritative for triage. Classifies, recommends cleanup actions, triggers pending delete.
 */

// ── Sort category (Bulk only) ───────────────────────────────────────────────────

export type SortCategory =
  | 'urgent'
  | 'important'
  | 'normal'
  | 'newsletter'
  | 'spam'
  | 'irrelevant'

export const SORT_CATEGORIES: SortCategory[] = [
  'urgent',
  'important',
  'normal',
  'newsletter',
  'spam',
  'irrelevant',
]

// ── Normal Inbox: Advisory AI ───────────────────────────────────────────────────

/** Suggested action — advisory only. UI shows recommendation; user must explicitly act. */
export type AdvisoryRecommendedAction = 'archive' | 'keep'

/**
 * Result of aiAnalyzeMessage for Normal Inbox.
 * Advisory: informative only. No DB writes, no auto-actions, no silent reclassification.
 */
export interface NormalInboxAiResult {
  needsReply: boolean
  needsReplyReason: string
  summary: string
  urgencyScore: number
  urgencyReason: string
  actionItems: string[]
  /** Advisory: suggested archive/keep. User must click Archive to act. */
  archiveRecommendation: AdvisoryRecommendedAction
  archiveReason: string
}

/**
 * Draft reply in Normal Inbox.
 * Always shown inline, editable before send. Never locked or treated as final.
 */
export interface NormalInboxDraftReply {
  draft: string
  /** True if AI returned an error message as draft (e.g. "Error: Ollama 404") */
  error?: boolean
}

// ── Bulk Inbox: Authoritative AI ───────────────────────────────────────────────

/** Actionable recommendation used in workflow. Can trigger pending_delete, archive, etc. */
export type BulkRecommendedAction =
  | 'pending_delete'
  | 'archive'
  | 'keep_for_manual_action'
  | 'draft_reply_ready'

/**
 * Single classification from aiCategorize (bulk triage) — IPC response shape (snake_case).
 * Authoritative: writes to DB (sort_category, sort_reason, urgency_score, needs_reply).
 */
export interface BulkClassification {
  id: string
  category: SortCategory
  summary?: string
  reason: string
  needs_reply: boolean
  urgency_score: number
  recommended_action?: string
  action_explanation?: string
  draft_reply?: string
  /** True when category is spam or irrelevant — used to trigger markPendingDelete after grace period */
  pending_delete: boolean
}

/**
 * Full triage result for one message in Bulk Inbox — frontend state shape.
 * Used in aiOutputs Record. Draft replies are editable by UI layers.
 */
export interface BulkAiResult {
  category: SortCategory
  urgencyScore: number
  /** One sentence explaining the urgency level (matches Normal Inbox). */
  urgencyReason: string
  summary: string
  reason: string
  needsReply: boolean
  /** One sentence explaining why reply is or is not needed (matches Normal Inbox). */
  needsReplyReason: string
  recommendedAction: BulkRecommendedAction
  actionExplanation: string
  /** Extracted action items (matches Normal Inbox). */
  actionItems: string[]
  /** Prepared draft. Shown inline, editable before send. */
  draftReply?: string
  status: 'pending' | 'classified' | 'action_taken'
  /** ISO timestamp: show "pending delete" preview until this time */
  pendingDeletePreviewUntil?: string
  /** ISO timestamp: show "archive" preview until this time */
  archivePreviewUntil?: string
}

/** Per-message entry: full or partial result + optional loading state. */
export type BulkAiResultEntry = Partial<BulkAiResult> & {
  /** When loading: 'summary' | 'draft' | 'triage' */
  loading?: string
}

/** aiOutputs state: Record<messageId, BulkAiResultEntry> */
export type AiOutputs = Record<string, BulkAiResultEntry>

// ── Shared: Draft reply behavior ───────────────────────────────────────────────

/**
 * Draft replies in BOTH modes:
 * - Shown inline in the UI
 * - Editable before send (user can modify text)
 * - Not locked or treated as final — always a starting point for the user
 */
