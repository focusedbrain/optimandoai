/**
 * Assembles `AnalysisDashboardSnapshot` from read-only sources:
 * - `inbox:dashboardSnapshot` (SQLite inbox + autosort)
 * - optional `window.handshakeView.listHandshakes()` (separate DB — never blocks inbox aggregate).
 *
 * Wire contract (`InboxDashboardSnapshotWire`) is STABLE — no changes to IPC or main process.
 * All derived analytics sections are computed here in the renderer from existing wire data.
 */

import '../components/handshakeViewTypes'
import type {
  AnalysisDashboardAutomationMetrics,
  AnalysisDashboardCategoryCount,
  AnalysisDashboardHandshakeState,
  AnalysisDashboardPoAESection,
  AnalysisDashboardQueueVelocity,
  AnalysisDashboardSnapshot,
  AnalysisDashboardThreatMetrics,
  AnalysisDashboardTransportRatio,
  InboxDashboardSnapshotWire,
} from '../types/analysisDashboardSnapshot'

const PROJECT_SECTION = {
  mode: 'v1_activation_placeholder' as const,
  headline: 'Drafts only until project storage ships.',
  body: 'Optional fields below · session memory · not persisted as project records.',
}

const HANDSHAKE_STATES: readonly AnalysisDashboardHandshakeState[] = [
  'PENDING_ACCEPT',
  'PENDING_REVIEW',
  'ACCEPTED',
  'ACTIVE',
  'REVOKED',
  'EXPIRED',
] as const

function isHandshakeState(s: string): s is AnalysisDashboardHandshakeState {
  return (HANDSHAKE_STATES as readonly string[]).includes(s)
}

async function summarizeHandshakes(): Promise<AnalysisDashboardSnapshot['handshakes']> {
  try {
    const records = (await window.handshakeView?.listHandshakes?.()) ?? []
    const byState: Partial<Record<AnalysisDashboardHandshakeState, number>> = {}
    for (const r of records as Array<{ state?: string }>) {
      const st = typeof r.state === 'string' ? r.state : ''
      if (!isHandshakeState(st)) continue
      byState[st] = (byState[st] ?? 0) + 1
    }
    return { counts: { total: records.length, byState } }
  } catch {
    return { counts: null }
  }
}

function wireToPoaeSection(wire: InboxDashboardSnapshotWire): AnalysisDashboardPoAESection {
  const pack = wire.poaePackageHistory ?? []
  const rows = pack.map((r) => ({
    messageId: r.messageId,
    receivedAt: r.receivedAt,
    fromName: r.fromName,
    fromAddress: r.fromAddress,
    subject: r.subject,
    sourceType: r.sourceType,
    handshakeId: r.handshakeId,
  }))
  return {
    mode: 'v1_package_history',
    title: 'PoAE™ artifact registry',
    lead: '',
    rows,
    rowLimit: wire.poaePackageHistoryLimit ?? 25,
    truncated: wire.poaePackageHistoryTruncated ?? false,
  }
}

function wireToSnapshot(wire: InboxDashboardSnapshotWire): Pick<AnalysisDashboardSnapshot, 'top' | 'autosort'> {
  const { inboxTabs, messageKindOnMainInbox, autosortCategoryCounts, latestCompletedAutosort, latestSessionUrgentMessages } =
    wire

  return {
    top: {
      inboxTabs: {
        all: inboxTabs.all,
        urgent: inboxTabs.urgent,
        pending_delete: inboxTabs.pending_delete,
        pending_review: inboxTabs.pending_review,
        archived: inboxTabs.archived,
      },
      messageKind: {
        nativeBeap: messageKindOnMainInbox.nativeBeap,
        depackagedEmail: messageKindOnMainInbox.depackagedEmail,
      },
      autosortCategoryCounts,
    },
    autosort: {
      latestSession: latestCompletedAutosort,
      sessionMessages: null,
      urgentSessionMessages: latestSessionUrgentMessages,
    },
  }
}

// ── Renderer-side derived metrics ────────────────────────────────────────────
//
// All functions below are pure — no async, no IPC, no side-effects.
// They operate only on already-fetched wire data and return null when
// the underlying data is absent, never inventing zeros for missing state.

/**
 * Returns true when a sort_category value matches any of the provided lowercase
 * substring patterns. Normalises underscores to spaces before comparing.
 */
function categoryMatches(category: string, patterns: readonly string[]): boolean {
  const normalised = category.trim().toLowerCase().replace(/_/g, ' ')
  return patterns.some((p) => normalised.includes(p))
}

/**
 * Sums the `count` for every category row that matches at least one pattern.
 */
function sumMatchingCategories(
  rows: readonly AnalysisDashboardCategoryCount[],
  patterns: readonly string[],
): number {
  return rows.reduce((acc, r) => (categoryMatches(r.category, patterns) ? acc + r.count : acc), 0)
}

/**
 * Derives threat-adjacent metrics from the latest session's category histogram.
 *
 * V1 sort model persists these sort_category values:
 *   urgent | pending_review | spam | newsletter | important | normal
 *
 *   - `spam` is written when the AI chose "pending_delete" (junk/unwanted mail).
 *   - Phishing and malicious-attachment categories are not produced by the current
 *     model — those fields will be 0 until a future model revision emits them.
 *
 * Returns null when autosortCategoryCounts is null (no session completed yet).
 */
function deriveThreatMetrics(
  autosortCategoryCounts: readonly AnalysisDashboardCategoryCount[] | null,
): AnalysisDashboardThreatMetrics | null {
  if (autosortCategoryCounts === null) return null

  const phishingDetected = sumMatchingCategories(autosortCategoryCounts, [
    'phish',
    'phishing',
    'credential harvest',
  ])

  const suspiciousSenders = sumMatchingCategories(autosortCategoryCounts, [
    'spam',
    'junk',
    'suspicious',
    'scam',
    'unwanted',
    'unsolicited',
  ])

  const maliciousAttachments = sumMatchingCategories(autosortCategoryCounts, [
    'malicious',
    'virus',
    'malware',
    'ransomware',
    'trojan',
  ])

  return {
    phishingDetected,
    suspiciousSenders,
    maliciousAttachments,
    totalThreats: phishingDetected + suspiciousSenders + maliciousAttachments,
    // No prior-session baseline available in V1; trend cannot be computed honestly.
    threatTrend: null,
  }
}

/**
 * Derives automation efficiency metrics from the latest completed session meta.
 *
 * - `accuracyRate` requires a user-feedback table that does not yet exist → null.
 * - `manualOverrides` not tracked in V1 → 0 (render as "N/A", not as a positive).
 * - `timeSavedMinutes` is an estimate at 0.5 min (30 s) per message.
 *
 * Returns null when no completed session exists.
 */
function deriveAutomationMetrics(
  wire: InboxDashboardSnapshotWire,
): AnalysisDashboardAutomationMetrics | null {
  const session = wire.latestCompletedAutosort
  if (session === null) return null

  const totalAutoSorted = typeof session.totalMessages === 'number' ? session.totalMessages : 0
  const timeSavedMinutes = totalAutoSorted > 0 ? Math.round(totalAutoSorted * 0.5) : null

  return {
    totalAutoSorted,
    accuracyRate: null,  // Feedback loop not tracked — do not render as a known value.
    manualOverrides: 0,  // Not yet tracked in V1; render as "N/A".
    timeSavedMinutes,
  }
}

/**
 * Derives the BEAP channel split from the main inbox kind counts.
 *
 * Both source values are guaranteed numbers on the wire. Their sum may be less
 * than the `all` inbox tab count because those counts are independent queries
 * over different message-kind filters (see AnalysisDashboardMessageKindTotals).
 */
function deriveTransportRatio(
  wire: InboxDashboardSnapshotWire,
): AnalysisDashboardTransportRatio | null {
  const { nativeBeap, depackagedEmail } = wire.messageKindOnMainInbox
  const nativeBeapN = typeof nativeBeap === 'number' ? nativeBeap : 0
  const depackagedN = typeof depackagedEmail === 'number' ? depackagedEmail : 0
  const total = nativeBeapN + depackagedN
  // Round to one decimal place (e.g. 66.7%).
  const nativePercent = total > 0 ? Math.round((nativeBeapN / total) * 1000) / 10 : 0

  return {
    nativeBeap: nativeBeapN,
    depackaged: depackagedN,
    total,
    nativePercent,
  }
}

/**
 * Derives the workflow queue velocity snapshot.
 *
 * `resolved24h` and `trend` require per-period resolution tracking that does not
 * yet exist — both are null. `pending` is the only live datum.
 *
 * Returns null when the wire pending_review count is unavailable.
 */
function deriveQueueVelocity(
  wire: InboxDashboardSnapshotWire,
): AnalysisDashboardQueueVelocity | null {
  const pending = wire.inboxTabs.pending_review
  if (typeof pending !== 'number') return null

  return {
    pending,
    resolved24h: null,  // No per-period resolution tracking in V1.
    trend: null,        // No prior baseline to diff against.
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export type FetchAnalysisDashboardSnapshotResult = {
  snapshot: AnalysisDashboardSnapshot | null
  /** Set when `inbox:dashboardSnapshot` fails or bridge missing */
  error?: string
}

/**
 * @param options.includeHandshakes — default true; uses `listHandshakes` only (read-only).
 * @param options.urgentMessageLimit — passed through to IPC (clamped 1–100 in main).
 */
export async function fetchAnalysisDashboardSnapshot(options?: {
  includeHandshakes?: boolean
  urgentMessageLimit?: number
}): Promise<FetchAnalysisDashboardSnapshotResult> {
  const bridge = window.emailInbox?.dashboardSnapshot
  if (typeof bridge !== 'function') {
    return { snapshot: null, error: 'emailInbox.dashboardSnapshot is not available' }
  }

  const res = await bridge({
    urgentMessageLimit: options?.urgentMessageLimit,
  })

  if (!res?.ok || !('data' in res) || !res.data) {
    const err = res && 'error' in res && typeof res.error === 'string' ? res.error : 'Dashboard snapshot failed'
    return { snapshot: null, error: err }
  }

  const wire = res.data as InboxDashboardSnapshotWire
  const { top, autosort } = wireToSnapshot(wire)
  const poae = wireToPoaeSection(wire)

  const includeHs = options?.includeHandshakes !== false
  const handshakes = includeHs ? await summarizeHandshakes() : null

  // Derived analytics — computed purely from wire data, no extra IPC.
  const threatMetrics = deriveThreatMetrics(wire.autosortCategoryCounts)
  const automationMetrics = deriveAutomationMetrics(wire)
  const transportRatio = deriveTransportRatio(wire)
  const queueVelocity = deriveQueueVelocity(wire)

  const snapshot: AnalysisDashboardSnapshot = {
    assembledAt: wire.assembledAt,
    loadComplete: true,
    top,
    autosort,
    poae,
    projectSetup: PROJECT_SECTION,
    handshakes,
    threatMetrics,
    automationMetrics,
    transportRatio,
    queueVelocity,
  }

  return { snapshot }
}
