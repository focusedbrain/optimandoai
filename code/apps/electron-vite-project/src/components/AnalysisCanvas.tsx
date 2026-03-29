import { useCallback, useEffect, useState } from 'react'
import './AnalysisCanvas.css'
import { useCanvasState, type AnalysisOpenPayload, type DrawerTabId } from './analysis'
import { StatusBadge } from './analysis/StatusBadge'
import {
  UrgentAutosortSessionSection,
  type OpenInboxMessagePayload,
} from './analysis/dashboard/UrgentAutosortSessionSection'
import { DashboardTopCardsRow } from './analysis/dashboard/DashboardTopCardsRow'
import { PoaeArchiveSection } from './analysis/dashboard/PoaeArchiveSection'
import { ProjectSetupSection, type DashboardEmailAccountRow } from './analysis/dashboard/ProjectSetupSection'
import { useAnalysisDashboardSnapshot } from '../lib/useAnalysisDashboardSnapshot'
import { useEmailInboxStore } from '../stores/useEmailInboxStore'

/**
 * Analysis command center: operational summary strip → Project AI Optimization (primary) + compact Urgent + PoAE stack.
 * App shell header lives in `App.tsx` — not duplicated here.
 *
 * Deep-link state below is reserved for future child consumers (consumed once via payload only today).
 */
interface DeepLinkState {
  traceId?: string
  eventId?: string
  drawerTab?: DrawerTabId
  ruleId?: string
}

interface AnalysisCanvasProps {
  deepLinkPayload?: AnalysisOpenPayload
  onDeepLinkConsumed?: () => void
  onOpenInboxMessage?: (payload: OpenInboxMessagePayload) => void
  /** Navigate to Inbox from PoAE / fallbacks (optional in embedded contexts). */
  onOpenInbox?: () => void
  /** Mail accounts from app shell — Auto mode toggle */
  emailAccounts?: DashboardEmailAccountRow[]
  /** After refresh, open Bulk Inbox for AI Auto-Sort */
  onOpenBulkInboxForAnalysis?: () => void
}

export default function AnalysisCanvas({
  deepLinkPayload,
  onDeepLinkConsumed,
  onOpenInboxMessage,
  onOpenInbox,
  emailAccounts,
  onOpenBulkInboxForAnalysis,
}: AnalysisCanvasProps) {
  const { snapshot: dashboardSnapshot, loading: dashboardLoading, error: dashboardError, refresh: refreshDashboard } =
    useAnalysisDashboardSnapshot({ urgentMessageLimit: 10 })

  const refreshOperations = useCallback(async () => {
    await refreshDashboard()
    await useEmailInboxStore.getState().refreshMessages()
  }, [refreshDashboard])

  const [, , helpers] = useCanvasState()

  const [_liveDeepLink, setLiveDeepLink] = useState<DeepLinkState | null>(null)
  void _liveDeepLink

  useEffect(() => {
    if (!deepLinkPayload) return

    const childDeepLink: DeepLinkState = {}
    if (deepLinkPayload.traceId) childDeepLink.traceId = deepLinkPayload.traceId
    if (deepLinkPayload.eventId) childDeepLink.eventId = deepLinkPayload.eventId
    if (deepLinkPayload.drawerTab) childDeepLink.drawerTab = deepLinkPayload.drawerTab
    if (deepLinkPayload.ruleId) childDeepLink.ruleId = deepLinkPayload.ruleId

    if (Object.keys(childDeepLink).length > 0) {
      const targetPhase = deepLinkPayload.phase || 'live'
      if (targetPhase === 'live') {
        setLiveDeepLink(childDeepLink)
      }
    }

    queueMicrotask(() => onDeepLinkConsumed?.())
  }, [deepLinkPayload, onDeepLinkConsumed])

  return (
    <div className="analysis-canvas">
      <div className="analysis-header">
        <StatusBadge flags={helpers.currentFlags} size="medium" />
      </div>

      <div className="analysis-canvas__dashboard">
        <DashboardTopCardsRow
          snapshot={dashboardSnapshot}
          loading={dashboardLoading}
          error={dashboardError}
          onRetry={refreshDashboard}
        />

        <div className="analysis-dashboard__command-grid">
          <div className="analysis-dashboard__command-primary" aria-label="Project AI optimization controls">
            <ProjectSetupSection
              projectSetup={dashboardSnapshot?.projectSetup ?? null}
              loading={dashboardLoading}
              emailAccounts={emailAccounts}
              onRefreshOperations={refreshOperations}
              onOpenBulkInboxForAnalysis={onOpenBulkInboxForAnalysis}
              latestAutosortSession={dashboardSnapshot?.autosort?.latestSession ?? null}
            />
          </div>

          <div className="analysis-dashboard__ops-stack" aria-label="Urgent messages and artifact history">
            <UrgentAutosortSessionSection
              onOpenInboxMessage={onOpenInboxMessage}
              snapshot={dashboardSnapshot}
              loading={dashboardLoading}
              error={dashboardError}
              onRefresh={refreshDashboard}
            />
            <PoaeArchiveSection
              poae={dashboardSnapshot?.poae}
              loading={dashboardLoading}
              onOpenInbox={onOpenInbox}
              onOpenInboxMessage={onOpenInboxMessage}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
