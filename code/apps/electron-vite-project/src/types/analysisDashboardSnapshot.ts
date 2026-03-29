/**
 * Production data contract for the Analysis dashboard (WR Desk™).
 *
 * Rules:
 * - Only fields backed by persisted SQLite / IPC today, or derivable in the
 *   renderer from those responses without inventing facts.
 * - No placeholder metrics, fake PoAE, or trend series without stored history.
 * - LLM-produced session summary is optional and only present when
 *   `autosort_sessions.ai_summary_json` was successfully written by
 *   `autosort:generateSummary`.
 *
 * Empty-state behavior: see JSDoc on `AnalysisDashboardSnapshot`; consumers
 * MUST treat `null` as “unknown / failed fetch” vs `[]` or explicit zero counts
 * as real observations.
 */

// ── Shared primitives ─────────────────────────────────────────────────────

/** ISO 8601 string from SQLite / gateways (same as inbox rows). */
export type IsoDateString = string

/**
 * `null` = fetch not attempted, bridge missing, or hard failure — UI: loading or error, not “zero”.
 * Use `0` only when IPC returned ok with a numeric total.
 */
export type TrustworthyCount = number | null

// ── 1) Top KPI / chart inputs ─────────────────────────────────────────────

/** Mirrors `InboxTabCounts` / workflow tabs (fast COUNT via `inbox:listMessages` + limit 1). */
export interface AnalysisDashboardInboxTabCounts {
  readonly all: TrustworthyCount
  readonly urgent: TrustworthyCount
  readonly pending_delete: TrustworthyCount
  readonly pending_review: TrustworthyCount
  readonly archived: TrustworthyCount
}

/**
 * Per product inbox semantics: `messageKind` on `window.emailInbox.listMessages`.
 * Each total is an independent COUNT for the same base workflow filter (typically `filter: 'all'`).
 * Do not assert handshake + depackaged === `all` unless product SQL guarantees a strict partition.
 */
export interface AnalysisDashboardMessageKindTotals {
  readonly nativeBeap: TrustworthyCount
  readonly depackagedEmail: TrustworthyCount
}

/**
 * Bar/pie-ready slice derived from **already-loaded** latest-session message rows
 * (aggregate `sort_category` in the renderer). No invented categories.
 */
export interface AnalysisDashboardCategoryCount {
  readonly category: string
  readonly count: number
}

export interface AnalysisDashboardTopSection {
  readonly inboxTabs: AnalysisDashboardInboxTabCounts
  readonly messageKind: AnalysisDashboardMessageKindTotals
  /**
   * From latest completed autosort session messages only.
   * Empty array = session existed but no rows / all null categories — still truthful.
   * `null` = no session or messages not loaded.
   */
  readonly autosortCategoryCounts: AnalysisDashboardCategoryCount[] | null
}

// ── 2) Latest autosort session + urgent rows ──────────────────────────────

/** Row shape aligned with `autosort:getSessionMessages` / `SessionReviewMessageRow`. */
export interface AnalysisDashboardAutosortMessageRef {
  readonly messageId: string
  readonly fromName: string | null
  readonly fromAddress: string | null
  readonly subject: string | null
  readonly receivedAt: IsoDateString | null
  readonly sortCategory: string | null
  readonly urgencyScore: number | null
  /** 1 = needs reply per DB; 0 or null = not flagged */
  readonly needsReply: number | null
  /** Model / sorter explanation text when present */
  readonly sortReason: string | null
  readonly pendingReviewAt: IsoDateString | null
  /** Inbox drill-down: link to handshake-scoped views when set */
  readonly handshakeId: string | null
  readonly accountId: string | null
  readonly lastAutosortSessionId: string
  readonly pendingDelete: number | null
  readonly archived: number | null
}

/**
 * Parsed `autosort_sessions.ai_summary_json` when present.
 * Provenance: persisted output of `autosort:generateSummary` (LLM); not cryptographic fact.
 */
export interface AnalysisDashboardAutosortAiSummary {
  readonly headline: string
  readonly patternsNote: string
}

/** Subset of `autosort_sessions` columns exposed to the dashboard. */
export interface AnalysisDashboardAutosortSessionMeta {
  readonly sessionId: string
  readonly startedAt: IsoDateString
  readonly completedAt: IsoDateString | null
  readonly status: string
  readonly totalMessages: number
  readonly urgentCount: number
  readonly pendingReviewCount: number
  readonly pendingDeleteCount: number
  readonly archivedCount: number
  readonly errorCount: number
  readonly durationMs: number | null
  /** Present only after successful `autosort:generateSummary` for this session id */
  readonly aiSummary: AnalysisDashboardAutosortAiSummary | null
}

export interface AnalysisDashboardAutosortSection {
  /**
   * Latest **completed** session from `autosort:listSessions` ordering, or `null` if none.
   */
  readonly latestSession: AnalysisDashboardAutosortSessionMeta | null
  /**
   * All messages tagged with this session (`autosort:getSessionMessages`), or `null` if not loaded.
   */
  readonly sessionMessages: AnalysisDashboardAutosortMessageRef[] | null
  /**
   * Subset of `sessionMessages` that qualify as urgent using the same idea as inbox workflow:
   * `sort_category` (trimmed, lower) === `'urgent'` OR numeric `urgency_score >= 7`.
   * Computed in renderer from `sessionMessages` only — no duplicate IPC.
   */
  readonly urgentSessionMessages: AnalysisDashboardAutosortMessageRef[] | null
}

// ── 3) PoAE (first-class, non-faked) ──────────────────────────────────────

/** One inbox row that has non-empty `beap_package_json` (package = PoAE anchor surface in product). */
export interface AnalysisDashboardPoAEHistoryRow {
  readonly messageId: string
  readonly receivedAt: IsoDateString | null
  readonly fromName: string | null
  readonly fromAddress: string | null
  readonly subject: string | null
  /** `inbox_messages.source_type` — workflow / ingest channel */
  readonly sourceType: string | null
  readonly handshakeId: string | null
}

/**
 * Read-only history: recent messages with stored BEAP package JSON.
 * No PoAE hashes, verification flags, or export payloads—open message in Inbox for inspection.
 */
export interface AnalysisDashboardPoAESection {
  readonly mode: 'v1_package_history'
  readonly title: string
  readonly lead: string
  readonly rows: readonly AnalysisDashboardPoAEHistoryRow[]
  /** Server-side LIMIT used for this query (for “showing N of …” copy). */
  readonly rowLimit: number
  /** True when more rows exist than returned (LIMIT+1 probe). */
  readonly truncated: boolean
}

// ── 4) Derived analytics (renderer-assembled from wire data) ─────────────────
//
// These sections are computed in `fetchAnalysisDashboardSnapshot` from the
// existing wire payload. They do NOT require any new IPC or main-process changes.
// `null` throughout means "not enough data to compute" — never treat as zero.

/**
 * Threat-adjacent message counts derived from `autosortCategoryCounts` on the
 * latest completed session.
 *
 * Category mapping reality (as of V1 sort model):
 *   - `spam`         → AI classified as delete-worthy / spam (stored via sortCategoryMap)
 *   - `phish*`       → not a current model output; phishingDetected = 0 until model ships it
 *   - `malicious*`   → not a current model output; maliciousAttachments = 0 until model ships it
 *
 * Consumers MUST treat `0` as "zero observed in latest session" and render it
 * neutrally — not as "no threats possible". Trend is null until baseline exists.
 */
export interface AnalysisDashboardThreatMetrics {
  /** Messages in categories matching phish/phishing patterns in latest session. */
  readonly phishingDetected: number
  /**
   * Messages in spam/suspicious/junk/scam-matching categories in latest session.
   * Includes the `spam` category produced by the sort model for delete-flagged mail.
   */
  readonly suspiciousSenders: number
  /** Messages in malicious/virus/malware categories — 0 until model ships those labels. */
  readonly maliciousAttachments: number
  /** Sum of phishingDetected + suspiciousSenders + maliciousAttachments. */
  readonly totalThreats: number
  /**
   * Percentage change vs prior session.
   * `null` = no prior session available; do not render a trend arrow.
   */
  readonly threatTrend: number | null
}

/**
 * Automation efficiency metrics derived from the latest completed autosort session.
 *
 * `accuracyRate` and `manualOverrides` require user feedback tracking — not yet
 * persisted; both are null/0 until that feature ships.
 * `timeSavedMinutes` is an estimate at 0.5 min (30 s) per message — clearly labelled
 * as an estimate in the UI.
 */
export interface AnalysisDashboardAutomationMetrics {
  /** `latestSession.totalMessages` — messages processed by the last run. */
  readonly totalAutoSorted: number
  /**
   * Fraction of sort decisions not subsequently overridden by the user.
   * `null` until feedback-loop tracking ships.
   */
  readonly accuracyRate: number | null
  /**
   * Count of messages the user manually re-categorised after a sort run.
   * `0` means "not tracked yet" in V1 — render as N/A, not as a positive metric.
   */
  readonly manualOverrides: number
  /**
   * Estimated minutes saved: `totalAutoSorted × 0.5` (30 s per message).
   * `null` when `totalAutoSorted === 0` (no session, or empty session).
   * Always label this as an estimate in the UI.
   */
  readonly timeSavedMinutes: number | null
}

/**
 * BEAP transport channel split for the main inbox (filter: 'all').
 *
 * Note: `nativeBeap + depackaged` does NOT necessarily equal `total` —
 * the counts are independent queries (see `AnalysisDashboardMessageKindTotals` JSDoc).
 * `total` here is simply the arithmetic sum of the two known slices.
 */
export interface AnalysisDashboardTransportRatio {
  /** Count of native BEAP (handshake-sourced) messages. */
  readonly nativeBeap: number
  /** Count of depackaged email messages. */
  readonly depackaged: number
  /** Arithmetic sum: nativeBeap + depackaged (may be less than inbox `all` count). */
  readonly total: number
  /**
   * `(nativeBeap / total) × 100`, rounded to one decimal place.
   * `0` when total is 0 to avoid division by zero.
   */
  readonly nativePercent: number
}

/**
 * Workflow queue pressure snapshot.
 *
 * `resolved24h` and `trend` require time-series history — not yet tracked
 * per-session on the wire; both are null until that ships.
 */
export interface AnalysisDashboardQueueVelocity {
  /** Current `pending_review` count from inbox tabs. */
  readonly pending: number
  /**
   * Messages moved out of pending_review in the last 24 h.
   * `null` = no time-series data available yet.
   */
  readonly resolved24h: number | null
  /**
   * Direction of pending queue relative to last snapshot.
   * `null` = no prior baseline to compare against.
   */
  readonly trend: 'growing' | 'shrinking' | 'stable' | null
}

// ── 5) Project / AI optimization (no persistence in V1) ─────────────────────

/**
 * No `projectId`, milestones, or “runs” — activation copy only until a real model exists.
 */
export interface AnalysisDashboardProjectSetupSection {
  readonly mode: 'v1_activation_placeholder'
  readonly headline: string
  readonly body: string
}

// ── 6) Handshakes (optional, real handshake DB rows) ─────────────────────

export type AnalysisDashboardHandshakeState =
  | 'PENDING_ACCEPT'
  | 'PENDING_REVIEW'
  | 'ACCEPTED'
  | 'ACTIVE'
  | 'REVOKED'
  | 'EXPIRED'

export interface AnalysisDashboardHandshakeCounts {
  readonly total: number
  readonly byState: Partial<Record<AnalysisDashboardHandshakeState, number>>
}

export interface AnalysisDashboardHandshakeSection {
  /** Derived from `window.handshakeView.listHandshakes()` only — no inferred trust */
  readonly counts: AnalysisDashboardHandshakeCounts | null
}

/**
 * Success payload from `inbox:dashboardSnapshot` (`collectReadOnlyDashboardSnapshot` in main).
 * Counts are plain numbers — `ok: false` means the whole fetch failed (use snapshot `null` / error UI).
 */
export interface InboxDashboardSnapshotWire {
  readonly assembledAt: IsoDateString
  readonly inboxTabs: {
    readonly all: number
    readonly urgent: number
    readonly pending_delete: number
    readonly pending_review: number
    readonly archived: number
  }
  readonly messageKindOnMainInbox: {
    readonly nativeBeap: number
    readonly depackagedEmail: number
  }
  readonly autosortCategoryCounts: AnalysisDashboardCategoryCount[] | null
  readonly latestCompletedAutosort: AnalysisDashboardAutosortSessionMeta | null
  readonly latestSessionUrgentMessages: AnalysisDashboardAutosortMessageRef[]
  /**
   * Recent messages with `beap_package_json` set (read-only). Same DB as inbox; ordered by `received_at` DESC.
   */
  readonly poaePackageHistory: ReadonlyArray<{
    readonly messageId: string
    readonly receivedAt: IsoDateString | null
    readonly fromName: string | null
    readonly fromAddress: string | null
    readonly subject: string | null
    readonly sourceType: string | null
    readonly handshakeId: string | null
  }>
  readonly poaePackageHistoryTruncated: boolean
  readonly poaePackageHistoryLimit: number
}

// ── Root snapshot ─────────────────────────────────────────────────────────

export interface AnalysisDashboardSnapshot {
  /** When the snapshot was assembled (client clock). */
  readonly assembledAt: IsoDateString
  /**
   * `true` once all **required** fetches for V1 have attempted;
   * individual sections may still hold `null` on failure.
   */
  readonly loadComplete: boolean
  readonly top: AnalysisDashboardTopSection | null
  readonly autosort: AnalysisDashboardAutosortSection | null
  readonly poae: AnalysisDashboardPoAESection
  readonly projectSetup: AnalysisDashboardProjectSetupSection
  /** Omitted from UI when `counts === null` (vault locked / error) */
  readonly handshakes: AnalysisDashboardHandshakeSection | null
  /**
   * Threat-adjacent message counts from the latest sort session.
   * `null` when no completed session exists or `autosortCategoryCounts` is null.
   * Derived entirely in the renderer — no new IPC required.
   */
  readonly threatMetrics: AnalysisDashboardThreatMetrics | null
  /**
   * Automation efficiency derived from the latest completed autosort session.
   * `null` when no session exists.
   */
  readonly automationMetrics: AnalysisDashboardAutomationMetrics | null
  /**
   * BEAP channel split for the main inbox.
   * `null` when the wire `messageKindOnMainInbox` data is unavailable.
   */
  readonly transportRatio: AnalysisDashboardTransportRatio | null
  /**
   * Workflow queue pressure snapshot.
   * `null` when inbox tab counts are unavailable.
   */
  readonly queueVelocity: AnalysisDashboardQueueVelocity | null
}

/**
 * IPC / store mapping (existing paths — no new main-process code required for core V1):
 *
 * | Field area            | Source |
 * |-----------------------|--------|
 * | inboxTabs.*           | `window.emailInbox.listMessages` per workflow tab, `limit: 1`, read `data.total` (same as `fetchBulkTabCountsServer` in `useEmailInboxStore.ts`). |
 * | messageKind.*         | `listMessages` with `filter: 'all'`, `messageKind: 'handshake' | 'depackaged'`, `limit: 1`, `data.total`. |
 * | autosortCategoryCounts| Derive from `autosort:getSessionMessages` rows (aggregate `sort_category`). |
 * | latestSession         | First row of `autosort:listSessions` (completed only per handler). |
 * | sessionMessages       | `autosort:getSessionMessages(sessionId)`. |
 * | urgentSessionMessages | Filter `sessionMessages` in renderer (urgent category or urgency ≥ 7). |
 * | aiSummary             | Parse `getSession` row `ai_summary_json` if non-null JSON. |
 * | handshake counts      | `window.handshakeView.listHandshakes()` — count by `state`. |
 * | poae package history   | `inbox_messages` WHERE `beap_package_json` non-empty; dashboard lists rows only — **no** parsed PoAE fields or hashes on wire. |
 * | projectSetup          | Static placeholder — **no** IPC. |
 *
 * New read-only query (optional later):
 * - Single `inbox:dashboardSnapshot` combining COUNTs to reduce round-trips.
 * - Richer PoAE columns: JSON1 on `beap_package_json` — **not** on the wire today (honest list only).
 */

/** @internal V1 fields that must not appear on the wire or UI */
export type AnalysisDashboardV1Omit =
  | 'poaeRecordId'
  | 'poaeHash'
  | 'poaeVerificationStatus'
  | 'executionTimeline'
  | 'optimizationRunCount'
  | 'consentPendingCount'
  | 'policyGateFailureCount'
  | 'trendSeries'
  | 'percentageDelta'
  | 'threatCategoryCounts'
  | 'simulatedActivityFeed'
  | 'mockRuntimeState'
