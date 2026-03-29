/**
 * Assembles `AnalysisDashboardSnapshot` from read-only sources:
 * - `inbox:dashboardSnapshot` (SQLite inbox + autosort)
 * - optional `window.handshakeView.listHandshakes()` (separate DB — never blocks inbox aggregate).
 */

import '../components/handshakeViewTypes'
import type {
  AnalysisDashboardHandshakeState,
  AnalysisDashboardPoAESection,
  AnalysisDashboardSnapshot,
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

  const snapshot: AnalysisDashboardSnapshot = {
    assembledAt: wire.assembledAt,
    loadComplete: true,
    top,
    autosort,
    poae,
    projectSetup: PROJECT_SECTION,
    handshakes,
  }

  return { snapshot }
}
