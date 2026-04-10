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
 *   │  Automation home OR  │  ActivityFeed     │
 *   │  Project WIKI (POP)    │  Column  (~40%)   │
 *   │  (exclusive)         │                   │
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

import { useCallback, useEffect, useRef, useState } from 'react'
import '../styles/dashboard-tokens.css'
import '../styles/dashboard-base.css'
import './AnalysisCanvas.css'

// ── Canvas state helpers ──────────────────────────────────────────────────────
import { useCanvasState, type AnalysisOpenPayload, type DrawerTabId } from './analysis'
import { StatusBadge } from './analysis/StatusBadge'

// ── Dashboard components (all via barrel export) ──────────────────────────────
import {
  DashboardAutomationHome,
  IntelligenceDashboard,
  ActivityFeedColumn,
  ProjectOptimizationPanel,
  type DashboardEmailAccountRow,
  type OpenInboxMessagePayload,
  type ProjectOptimizationPanelHandle,
} from './analysis/dashboard'

// ── Data layer ────────────────────────────────────────────────────────────────
import { useAnalysisDashboardSnapshot } from '../lib/useAnalysisDashboardSnapshot'
import { activeEmailAccountIdsForSync, useEmailInboxStore } from '../stores/useEmailInboxStore'
import { useProjectStore, selectActiveProject } from '../stores/useProjectStore'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'
import type { TriggerFunctionId } from '@ext/types/triggerTypes'
import { WRDESK_TRIGGER_SYNC_AUTO_OPTIMIZER_PROJECT } from '@ext/ui/components'

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
  /** Navigate to WR Chat (starter cards, automation home). */
  onNavigateToWrChat?: () => void
  /** Header multi-trigger selection — closes Project WIKI hero when switching to Watchdog (see workspace rules below). */
  activeTriggerFunctionId: TriggerFunctionId
  /**
   * Increment when + Add Project WIKI should open create in {@link ProjectOptimizationPanel}
   * (modal form — desktop dispatches `WRDESK_OPEN_PROJECT_ASSISTANT_CREATION`).
   */
  projectAssistantCreateToken?: number
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AnalysisCanvas({
  deepLinkPayload,
  onDeepLinkConsumed,
  onOpenInboxMessage,
  onOpenInbox,
  emailAccounts,
  onOpenBulkInboxForAnalysis,
  onNavigateToWrChat,
  activeTriggerFunctionId,
  projectAssistantCreateToken = 0,
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
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const autoSyncEnabled = useEmailInboxStore((s) => s.autoSyncEnabled)

  const automationWorkspaceRef = useRef<ProjectOptimizationPanelHandle>(null)
  /** When true, Project WIKI ({@link ProjectOptimizationPanel}) is shown (exclusive with {@link DashboardAutomationHome} in the hero slot). */
  const [projectAssistantWorkspaceOpen, setProjectAssistantWorkspaceOpen] = useState(false)
  /** True while “+ Add Project WIKI” create-from-bar is active (trigger may still be Watchdog). */
  const [pendingProjectAssistantCreateSession, setPendingProjectAssistantCreateSession] = useState(false)
  const lastHandledAssistCreateTokenRef = useRef(0)

  const showProjectAssistantWorkspace =
    projectAssistantWorkspaceOpen &&
    (activeTriggerFunctionId.type === 'auto-optimizer' || pendingProjectAssistantCreateSession)

  /**
   * Hero stays automation-first by default. Project WIKI opens only from explicit actions (home list, Add WIKI).
   * - Watchdog → close Project WIKI unless Add-WIKI create is pending.
   * - Auto-optimizer row alone → do not auto-open (no project-centric default hero).
   */
  useEffect(() => {
    if (pendingProjectAssistantCreateSession) {
      setProjectAssistantWorkspaceOpen(true)
      return
    }
    if (activeTriggerFunctionId.type === 'watchdog') {
      setProjectAssistantWorkspaceOpen(false)
    }
  }, [activeTriggerFunctionId, pendingProjectAssistantCreateSession])

  /** Once a project row is selected in the trigger bar, drop the “pending create” flag. */
  useEffect(() => {
    if (activeTriggerFunctionId.type === 'auto-optimizer' && pendingProjectAssistantCreateSession) {
      setPendingProjectAssistantCreateSession(false)
    }
  }, [activeTriggerFunctionId, pendingProjectAssistantCreateSession])

  /**
   * + Add Project WIKI (header) bumps `projectAssistantCreateToken`; open create once per token
   * after the panel mounts (same imperative path as the automation-home list).
   */
  useEffect(() => {
    if (projectAssistantCreateToken < 1) return
    if (projectAssistantCreateToken === lastHandledAssistCreateTokenRef.current) return
    lastHandledAssistCreateTokenRef.current = projectAssistantCreateToken
    setPendingProjectAssistantCreateSession(true)
    setProjectAssistantWorkspaceOpen(true)
    const t = window.setTimeout(() => {
      automationWorkspaceRef.current?.openCreateMode({ omitIntervalFields: true })
    }, 0)
    return () => clearTimeout(t)
  }, [projectAssistantCreateToken])

  /**
   * Combined refresh: snapshot + inbox message list.
   * Passed to ProjectOptimizationPanel.onRefreshOperations and ActivityFeedColumn.onRefresh.
   */
  const refreshOperations = useCallback(async () => {
    await refreshDashboard()
    await useEmailInboxStore.getState().refreshMessages()
  }, [refreshDashboard])

  // ── Status card callbacks (bidirectional sync via Zustand) ─────────────────

  /** Toggle repeat on linked WR Chat from the Status card — same `setAutoOptimization` as Project WIKI. */
  const handleToggleAutoOptimization = useCallback((enabled: boolean) => {
    if (!activeProjectId) return
    useProjectStore.getState().setAutoOptimization(activeProjectId, enabled)
  }, [activeProjectId])

  /** Open Project WIKI for a project (automation-home list). */
  const handleOpenProjectAssistantWorkspace = useCallback(
    (opts: { projectId: string; mode?: 'edit' | 'view' }) => {
      try {
        window.dispatchEvent(
          new CustomEvent(WRDESK_TRIGGER_SYNC_AUTO_OPTIMIZER_PROJECT, { detail: { projectId: opts.projectId } }),
        )
      } catch {
        /* noop */
      }
      setActiveProject(opts.projectId)
      setProjectAssistantWorkspaceOpen(true)
      if (opts.mode === 'edit') {
        window.setTimeout(() => {
          automationWorkspaceRef.current?.openEditMode()
        }, 0)
      }
    },
    [setActiveProject],
  )

  const handleCloseProjectAssistantWorkspace = useCallback(() => {
    setPendingProjectAssistantCreateSession(false)
    setProjectAssistantWorkspaceOpen(false)
  }, [])

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

  // ── Form editing state — drives layout modifier (stretch ↔ sticky right col) ──
  const [isFormEditing, setIsFormEditing] = useState(false)

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
        <div className={['analysis-dashboard__main-grid', isFormEditing ? 'analysis-dashboard__main-grid--editing' : ''].filter(Boolean).join(' ')}>

          {/* Row 1: Intelligence Dashboard — full-width top strip */}
          <div className="analysis-dashboard__intel-area">
            <IntelligenceDashboard
              snapshot={dashboardSnapshot}
              loading={dashboardLoading}
              error={dashboardError}
              onRetry={refreshDashboard}
              activeProjectId={activeProjectId}
              suppressProjectAssistantDuplicateSurface={showProjectAssistantWorkspace}
              autoOptimizationEnabled={activeProject?.autoOptimizationEnabled ?? false}
              onToggleAutoOptimization={handleToggleAutoOptimization}
              autoSyncEnabled={autoSyncEnabled}
              onToggleAutoSync={handleToggleAutoSync}
              syncActive={false /* TODO: wire to real sync-in-progress state */}
              accountCount={emailAccounts?.length ?? 0}
              unopenedBeapCount={0 /* TODO: derive from snapshot or dedicated IPC */}
            />
          </div>

          {/* Row 2 left: Automation-first hero OR Project WIKI (exclusive, ~60%) */}
          <div
            className="analysis-dashboard__project-area"
            aria-label={showProjectAssistantWorkspace ? 'Project WIKI workspace' : 'Automation home'}
          >
            {showProjectAssistantWorkspace ? (
              <div className="analysis-pa-workspace">
                <div className="analysis-pa-workspace__bar">
                  <button
                    type="button"
                    className="analysis-pa-workspace__back"
                    onClick={handleCloseProjectAssistantWorkspace}
                  >
                    ← Automation workspace
                  </button>
                </div>
                <ProjectOptimizationPanel
                  ref={automationWorkspaceRef}
                  latestAutosortSession={dashboardSnapshot?.autosort?.latestSession ?? null}
                  emailAccounts={emailAccounts ?? []}
                  onRefreshOperations={refreshOperations}
                  onOpenBulkInboxForAnalysis={onOpenBulkInboxForAnalysis}
                  onSetupModeChange={setIsFormEditing}
                  workspaceSuppressedCap={false}
                />
              </div>
            ) : (
              <DashboardAutomationHome
                onOpenProjectAssistantWorkspace={handleOpenProjectAssistantWorkspace}
                onNavigateInbox={() => onOpenInbox?.()}
                onNavigateWrChat={() => onNavigateToWrChat?.()}
                onNavigateBulkInbox={() => onOpenBulkInboxForAnalysis?.()}
              />
            )}
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
