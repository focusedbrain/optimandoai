/**
 * ActivityFeedColumn — layout wrapper that composes UrgentMessagesPanel and
 * PoaeArtifactsPanel into a single right-side activity feed column.
 *
 * Receives the full snapshot and callbacks, splits the relevant slices, and
 * forwards them to the two child panels. No data transformation happens here.
 *
 * Swap into AnalysisCanvas in Prompt 5 in place of the existing side panels.
 */

import type { AnalysisDashboardSnapshot } from '../../../types/analysisDashboardSnapshot'
import type { OpenInboxMessagePayload } from './UrgentAutosortSessionSection'
import { UrgentMessagesPanel } from './UrgentMessagesPanel'
import { PoaeArtifactsPanel } from './PoaeArtifactsPanel'
import '../../../styles/dashboard-tokens.css'
import '../../../styles/dashboard-base.css'
import './ActivityFeedColumn.css'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ActivityFeedColumnProps {
  snapshot: AnalysisDashboardSnapshot | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  onOpenInbox?: () => void
  onOpenInboxMessage?: (payload: OpenInboxMessagePayload) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ActivityFeedColumn({
  snapshot,
  loading,
  error,
  onRefresh,
  onOpenInbox,
  onOpenInboxMessage,
}: ActivityFeedColumnProps) {
  const poae = snapshot?.poae ?? null

  return (
    <div className="afc">
      {/* ── Urgent / Priority Inbox ──────────────────────────────────── */}
      <div className="afc__panel">
        <UrgentMessagesPanel
          snapshot={snapshot}
          loading={loading}
          error={error}
          onRefresh={onRefresh}
          onOpenInboxMessage={onOpenInboxMessage}
        />
      </div>

      {/* ── PoAE™ Registry ──────────────────────────────────────────── */}
      <div className="afc__panel">
        <PoaeArtifactsPanel
          poae={poae}
          loading={loading}
          onOpenInbox={onOpenInbox}
          onOpenInboxMessage={onOpenInboxMessage}
        />
      </div>
    </div>
  )
}
