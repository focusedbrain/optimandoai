/**
 * WR Desk™ — Analysis Canvas
 *
 * Dashboard refactored: 2026-03-30
 * New components: IntelligenceDashboard, ProjectOptimizationPanel, ActivityFeedColumn
 * Business logic preserved: see DASHBOARD_ARCHITECTURE.md §8
 *
 * Layout (CSS grid — AnalysisCanvas.css):
 *   ┌──────────────────────────────────────────┐
 *   │  IntelligenceDashboard  (full width)      │
 *   ├──────────────────────┬───────────────────┤
 *   │  ProjectOptimization  │  ActivityFeed     │
 *   │  Panel  (~60%)        │  Column  (~40%)   │
 *   └──────────────────────┴───────────────────┘
 *
 * Untouched by this refactor:
 *   - useAnalysisDashboardSnapshot  (data fetching + IPC)
 *   - useEmailInboxStore            (auto-sync state)
 *   - useProjectSetupChatContextStore
 *   - buildProjectSetupChatPrefix
 *   - collectReadOnlyDashboardSnapshot (electron main)
 *   - All IPC handlers in electron/main/email/ipc.ts
 */

import { useCallback, useEffect, useState } from 'react'
import '../styles/dashboard-tokens.css'
import '../styles/dashboard-base.css'
import './AnalysisCanvas.css'

// ── Canvas state helpers ──────────────────────────────────────────────────────
import { useCanvasState, type AnalysisOpenPayload, type DrawerTabId } from './analysis'
import { StatusBadge } from './analysis/StatusBadge'

// ── Dashboard components (all via barrel export) ──────────────────────────────
import {
  IntelligenceDashboard,
  ProjectOptimizationPanel,
  ActivityFeedColumn,
  type DashboardEmailAccountRow,
  type OpenInboxMessagePayload,
} from './analysis/dashboard'

// ── Data layer ────────────────────────────────────────────────────────────────
import { useAnalysisDashboardSnapshot } from '../lib/useAnalysisDashboardSnapshot'
import { activeEmailAccountIdsForSync, useEmailInboxStore } from '../stores/useEmailInboxStore'
import { useProjectStore, selectActiveProject } from '../stores/useProjectStore'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'

// ── Types ─────────────────────────────────────────────────────────────────────

/** Reserved for future deep-link child consumers; consumed once via payload today. */
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
  /** Mail accounts from app shell — Auto mode toggle. */
  emailAccounts?: DashboardEmailAccountRow[]
  /** After refresh, open Bulk Inbox for AI Auto-Sort. */
  onOpenBulkInboxForAnalysis?: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AnalysisCanvas({
  deepLinkPayload,
  onDeepLinkConsumed,
  onOpenInboxMessage,
  onOpenInbox,
  emailAccounts,
  onOpenBulkInboxForAnalysis,
}: AnalysisCanvasProps) {
  // ── Data layer — unchanged from original ──────────────────────────────────
  const {
    snapshot: dashboardSnapshot,
    loading:  dashboardLoading,
    error:    dashboardError,
    refresh:  refreshDashboard,
  } = useAnalysisDashboardSnapshot({ urgentMessageLimit: 10 })

  // ── Project store (drives StatusCard wiring) ───────────────────────────────
  const activeProject   = useProjectStore(selectActiveProject)
  const projects        = useProjectStore((s) => s.projects)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const autoSyncEnabled = useEmailInboxStore((s) => s.autoSyncEnabled)

  /**
   * Combined refresh: snapshot + inbox message list.
   * Passed to ProjectOptimizationPanel.onRefreshOperations and ActivityFeedColumn.onRefresh.
   */
  const refreshOperations = useCallback(async () => {
    await refreshDashboard()
    await useEmailInboxStore.getState().refreshMessages()
  }, [refreshDashboard])

  // ── Status card callbacks (bidirectional sync via Zustand) ─────────────────

  /** Select a project in the Status card — syncs with ProjectOptimizationPanel. */
  const handleSelectProject = useCallback((projectId: string | null) => {
    setActiveProject(projectId)
  }, [setActiveProject])

  /** Toggle Auto-Optimization from the Status card — calls the same store action. */
  const handleToggleAutoOptimization = useCallback((enabled: boolean) => {
    if (!activeProjectId) return
    useProjectStore.getState().setAutoOptimization(activeProjectId, enabled)
  }, [activeProjectId])

  /** Toggle Auto-Sync from the Status card — calls the same mechanism as ProjectOptimizationPanel. */
  const handleToggleAutoSync = useCallback(async (enabled: boolean) => {
    const accounts   = emailAccounts ?? []
    const accountIds = activeEmailAccountIdsForSync(accounts)
    if (accountIds.length === 0) {
      console.warn('[StatusCard] Cannot toggle auto-sync: no email accounts configured')
      return
    }
    const primaryId = pickDefaultEmailAccountRowId(accounts) ?? null
    await useEmailInboxStore.getState().toggleAutoSyncForActiveAccounts(enabled, accountIds, primaryId)
    // toggleAutoSyncForActiveAccounts already calls refreshInboxSyncBackendState internally
  }, [emailAccounts])

  // ── Canvas state (drives StatusBadge flags) — unchanged ───────────────────
  const [, , helpers] = useCanvasState()

  // ── Deep-link handling — unchanged ─────────────────────────────────────────
  const [_liveDeepLink, setLiveDeepLink] = useState<DeepLinkState | null>(null)
  void _liveDeepLink

  useEffect(() => {
    if (!deepLinkPayload) return

    const childDeepLink: DeepLinkState = {}
    if (deepLinkPayload.traceId)   childDeepLink.traceId   = deepLinkPayload.traceId
    if (deepLinkPayload.eventId)   childDeepLink.eventId   = deepLinkPayload.eventId
    if (deepLinkPayload.drawerTab) childDeepLink.drawerTab = deepLinkPayload.drawerTab
    if (deepLinkPayload.ruleId)    childDeepLink.ruleId    = deepLinkPayload.ruleId

    if (Object.keys(childDeepLink).length > 0) {
      const targetPhase = deepLinkPayload.phase || 'live'
      if (targetPhase === 'live') setLiveDeepLink(childDeepLink)
    }

    queueMicrotask(() => onDeepLinkConsumed?.())
  }, [deepLinkPayload, onDeepLinkConsumed])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="analysis-canvas" style={{ backgroundColor: '#F8F8F7', color: '#1C1C1A' }}>
      {/* StatusBadge — hidden via CSS but preserved for canvas state flags */}
      <div className="analysis-header">
        <StatusBadge flags={helpers.currentFlags} size="medium" />
      </div>

      <div className="analysis-canvas__dashboard">
        <div className="analysis-dashboard__main-grid">

          {/* Row 1: Intelligence Dashboard — full-width top strip */}
          <div className="analysis-dashboard__intel-area">
            <IntelligenceDashboard
              snapshot={dashboardSnapshot}
              loading={dashboardLoading}
              error={dashboardError}
              onRetry={refreshDashboard}
              projects={projects.map((p) => ({ id: p.id, title: p.title }))}
              activeProjectId={activeProjectId}
              onSelectProject={handleSelectProject}
              autoOptimizationEnabled={activeProject?.autoOptimizationEnabled ?? false}
              onToggleAutoOptimization={handleToggleAutoOptimization}
              autoSyncEnabled={autoSyncEnabled}
              onToggleAutoSync={handleToggleAutoSync}
              syncActive={false /* TODO: wire to real sync-in-progress state */}
              accountCount={emailAccounts?.length ?? 0}
              unopenedBeapCount={0 /* TODO: derive from snapshot or dedicated IPC */}
            />
          </div>

          {/* Row 2 left: Project AI Optimization (~60%) */}
          <div
            className="analysis-dashboard__project-area"
            aria-label="Project AI optimization controls"
          >
            <ProjectOptimizationPanel
              latestAutosortSession={dashboardSnapshot?.autosort?.latestSession ?? null}
              emailAccounts={emailAccounts ?? []}
              onRefreshOperations={refreshOperations}
              onOpenBulkInboxForAnalysis={onOpenBulkInboxForAnalysis}
            />
          </div>

          {/* Row 2 right: Activity Feed — Priority Inbox + PoAE Registry (~40%) */}
          <div
            className="analysis-dashboard__activity-area"
            aria-label="Priority inbox and PoAE artifact history"
          >
            <ActivityFeedColumn
              snapshot={dashboardSnapshot}
              loading={dashboardLoading}
              error={dashboardError}
              onRefresh={refreshDashboard}
              onOpenInbox={onOpenInbox}
              onOpenInboxMessage={onOpenInboxMessage}
            />
          </div>

        </div>
      </div>
    </div>
  )
}
