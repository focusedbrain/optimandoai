/**
 * ProjectOptimizationPanel — compact card layout (PROMPT 4A update).
 *
 * UI: 4-zone card — header, selector+controls, roadmap, status footer.
 * All business logic, store connections, and IPC calls are PRESERVED.
 *
 * Schema change notes (PROMPT 4A):
 *   - Project.name → Project.title
 *   - Project.autoOptimization → Project.autoOptimizationEnabled
 *   - Milestones now use `completed: boolean` (was `status` enum)
 *   - No more AnalysisSession or AgentSlot on projects
 *   - useProjectStore actions updated: setActiveProject, setAutoOptimization
 *
 * PRESERVED:
 *   - useEmailInboxStore: autoSyncEnabled, toggleAutoSyncForActiveAccounts,
 *     refreshInboxSyncBackendState
 *   - useProjectSetupChatContextStore: all draft fields + snippets
 *   - focusHeaderAiChat() dispatch (WRDESK_FOCUS_AI_CHAT_EVENT)
 *   - handleRunAnalysisNow, onAutoToggle callbacks
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'
import { WRDESK_FOCUS_AI_CHAT_EVENT } from '../../../lib/wrdeskUiEvents'
import { activeEmailAccountIdsForSync, useEmailInboxStore } from '../../../stores/useEmailInboxStore'
import { useProjectSetupChatContextStore } from '../../../stores/useProjectSetupChatContextStore'
import {
  useProjectStore,
  selectActiveProject,
} from '../../../stores/useProjectStore'
import { AUTO_OPTIMIZATION_INTERVALS } from '../../../types/projectTypes'
import type { AnalysisDashboardAutosortSessionMeta } from '../../../types/analysisDashboardSnapshot'
import {
  startAutoOptimization,
  stopAutoOptimization,
  triggerSnapshotOptimization,
} from '../../../lib/autoOptimizationEngine'
import { ProjectSetupModal } from './ProjectSetupModal'
import '../../../styles/dashboard-tokens.css'
import '../../../styles/dashboard-base.css'
import './ProjectOptimizationPanel.css'

// ── Props ─────────────────────────────────────────────────────────────────────

export type DashboardEmailAccountRow = {
  id: string
  email?: string
  status?: string
  processingPaused?: boolean
}

export interface ProjectOptimizationPanelProps {
  latestAutosortSession?: AnalysisDashboardAutosortSessionMeta | null
  emailAccounts?: DashboardEmailAccountRow[]
  onRefreshOperations?: () => void | Promise<void>
  onOpenBulkInboxForAnalysis?: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function focusHeaderAiChat() {
  window.dispatchEvent(new CustomEvent(WRDESK_FOCUS_AI_CHAT_EVENT, { bubbles: true }))
}

function formatStatusDate(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === '') return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatIntervalLabel(ms: number): string {
  const opt = AUTO_OPTIMIZATION_INTERVALS.find((i) => i.value === ms)
  return opt ? `every ${opt.label}` : `every ${Math.round(ms / 60000)} min`
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProjectOptimizationPanel({
  latestAutosortSession = null,
  emailAccounts = [],
  onRefreshOperations,
  onOpenBulkInboxForAnalysis,
}: ProjectOptimizationPanelProps) {
  // ── Project store ──────────────────────────────────────────────────────────
  const {
    projects,
    activeProjectId,
    setActiveProject,
    setAutoOptimization,
    removeAttachment,
  } = useProjectStore(
    useShallow((s) => ({
      projects:           s.projects,
      activeProjectId:    s.activeProjectId,
      setActiveProject:   s.setActiveProject,
      setAutoOptimization: s.setAutoOptimization,
      removeAttachment:   s.removeAttachment,
    })),
  )

  const activeProject = useProjectStore(selectActiveProject)

  // ── Roadmap derived values ─────────────────────────────────────────────────
  const completedCount  = activeProject?.milestones.filter((m) => m.completed).length ?? 0
  const totalCount      = activeProject?.milestones.length ?? 0
  const activeMilestone = activeProject?.milestones.find((m) => !m.completed) ?? null
  const allDone         = totalCount > 0 && completedCount === totalCount

  // ── Email inbox store (preserved exactly) ─────────────────────────────────
  const accountIds       = useMemo(() => activeEmailAccountIdsForSync(emailAccounts), [emailAccounts])
  const primaryAccountId = useMemo(() => pickDefaultEmailAccountRowId(emailAccounts), [emailAccounts])

  const autoSyncEnabled                 = useEmailInboxStore((s) => s.autoSyncEnabled)
  const toggleAutoSyncForActiveAccounts = useEmailInboxStore((s) => s.toggleAutoSyncForActiveAccounts)
  const refreshInboxSyncBackendState    = useEmailInboxStore((s) => s.refreshInboxSyncBackendState)

  useEffect(() => {
    if (accountIds.length === 0) return
    void refreshInboxSyncBackendState({
      syncTargetIds: accountIds,
      primaryAccountId: primaryAccountId ?? null,
    })
  }, [accountIds, primaryAccountId, refreshInboxSyncBackendState])

  const [autoToggleBusy, setAutoToggleBusy] = useState(false)

  const onAutoToggle = useCallback(
    async (enabled: boolean) => {
      if (accountIds.length === 0 || autoToggleBusy) return
      setAutoToggleBusy(true)
      try {
        await toggleAutoSyncForActiveAccounts(enabled, accountIds, primaryAccountId ?? null)
      } finally {
        setAutoToggleBusy(false)
      }
    },
    [accountIds, primaryAccountId, toggleAutoSyncForActiveAccounts, autoToggleBusy],
  )

  // ── Auto-optimization engine (V1 stub) ───────────────────────────────────
  const autoOptEnabled  = activeProject?.autoOptimizationEnabled ?? false
  const autoOptInterval = activeProject?.autoOptimizationIntervalMs ?? 300_000

  useEffect(() => {
    const project = useProjectStore.getState().getActiveProject()
    if (project?.autoOptimizationEnabled) {
      startAutoOptimization(project)
    } else {
      stopAutoOptimization()
    }
    return () => stopAutoOptimization()
  // Re-run when the active project changes or auto-opt is toggled / interval changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, autoOptEnabled, autoOptInterval])

  const [runBusy, setRunBusy] = useState(false)

  const handleRunAnalysisNow = useCallback(async () => {
    if (runBusy || !onRefreshOperations) return
    setRunBusy(true)
    try {
      // V1: trigger optimization run (console log only; V2: orchestrator IPC)
      const project = useProjectStore.getState().getActiveProject()
      if (project) triggerSnapshotOptimization(project)
      await onRefreshOperations()
      onOpenBulkInboxForAnalysis?.()
    } finally {
      setRunBusy(false)
    }
  }, [onRefreshOperations, onOpenBulkInboxForAnalysis, runBusy])

  // ── Chat context store (preserved exactly) ────────────────────────────────
  const {
    includeInChat,
    setIncludeInChat,
    projectNameDraft,
    setProjectNameDraft,
    goalsDraft,
    setGoalsDraft,
    milestonesDraft,
    setMilestonesDraft,
    setupTextDraft,
    setSetupTextDraft,
    snippets,
    addSnippet,
    removeSnippet,
  } = useProjectSetupChatContextStore(
    useShallow((s) => ({
      includeInChat:       s.includeInChat,
      setIncludeInChat:    s.setIncludeInChat,
      projectNameDraft:    s.projectNameDraft,
      setProjectNameDraft: s.setProjectNameDraft,
      goalsDraft:          s.goalsDraft,
      setGoalsDraft:       s.setGoalsDraft,
      milestonesDraft:     s.milestonesDraft,
      setMilestonesDraft:  s.setMilestonesDraft,
      setupTextDraft:      s.setupTextDraft,
      setSetupTextDraft:   s.setSetupTextDraft,
      snippets:            s.snippets,
      addSnippet:          s.addSnippet,
      removeSnippet:       s.removeSnippet,
    })),
  )

  const [snippetLabel, setSnippetLabel] = useState('')
  const [snippetText,  setSnippetText]  = useState('')

  const handleAddSnippet = useCallback(() => {
    if (!snippetLabel.trim() && !snippetText.trim()) return
    addSnippet({ label: snippetLabel, text: snippetText })
    setSnippetLabel('')
    setSnippetText('')
  }, [snippetLabel, snippetText, addSnippet])

  // ── Modal state (create vs edit) ──────────────────────────────────────────
  const [modalOpen,   setModalOpen]   = useState(false)
  const [modalEditId, setModalEditId] = useState<string | null>(null)

  const openCreateModal = () => { setModalEditId(null); setModalOpen(true) }
  const openEditModal   = () => { setModalEditId(activeProjectId); setModalOpen(true) }

  // ── Derived display values ────────────────────────────────────────────────
  const autoDisabled       = accountIds.length === 0
  const hasRefreshHandler  = typeof onRefreshOperations === 'function'
  const runCommandDisabled = runBusy || !hasRefreshHandler

  const lastAnalysisLine =
    latestAutosortSession?.completedAt != null
      ? formatStatusDate(latestAutosortSession.completedAt)
      : latestAutosortSession?.status && latestAutosortSession.status !== 'completed'
        ? `In progress · ${latestAutosortSession.status}`
        : '—'

  const autoOptOn     = autoOptEnabled
  const autoModeLabel = autoOptOn
    ? `On · ${formatIntervalLabel(activeProject!.autoOptimizationIntervalMs)}`
    : 'Off'

  // Keep focusHeaderAiChat in scope (used by hidden section below)
  void focusHeaderAiChat

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="pop" aria-labelledby="pop-heading">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="pop__head">
        <span id="pop-heading" className="pop__cap-label">PROJECT AI OPTIMIZATION</span>
        <div className="pop__head-btns">
          <button
            type="button"
            className="pop__btn-sm"
            onClick={openCreateModal}
            title="Create a new project"
          >
            + New Project
          </button>
        </div>
      </div>

      {/* ── Selector + Controls ─────────────────────────────────────────────── */}
      <div className="pop__selector-group">
        {/* Project dropdown + optional edit button */}
        <div className="pop__select-row">
          <select
            className={`pop__compact-select${activeProjectId ? ' pop__compact-select--has-value' : ''}`}
            value={activeProjectId ?? ''}
            onChange={(e) => setActiveProject(e.target.value || null)}
            aria-label="Select active project"
          >
            <option value="">— No project selected —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
          {activeProjectId && (
            <button
              type="button"
              className="pop__edit-btn"
              onClick={openEditModal}
              title="Edit this project"
            >
              Edit
            </button>
          )}
        </div>

        {/* Controls: Auto-Optimization toggle + Snapshot-Optimization button */}
        <div className="pop__controls-inline">
          <label className="pop__toggle-wrap">
            <button
              type="button"
              role="switch"
              aria-checked={autoOptOn}
              className={`pop__toggle-switch${autoOptOn ? ' pop__toggle-switch--on' : ''}`}
              disabled={!activeProject}
              onClick={() =>
                activeProject && setAutoOptimization(activeProject.id, !autoOptOn)
              }
              title="Automatically triggers analysis at set intervals"
            >
              <span className="pop__toggle-knob" />
            </button>
            <span className="pop__toggle-text">Auto-Optimization</span>
            {autoOptOn && activeProject && (
              <span className="pop__interval-hint">
                {formatIntervalLabel(activeProject.autoOptimizationIntervalMs)}
              </span>
            )}
          </label>

          <div className="pop__action-group">
            <button
              type="button"
              className="pop__action-btn"
              disabled={runCommandDisabled}
              onClick={() => void handleRunAnalysisNow()}
              title="Refresh snapshot · open Bulk Inbox for AI Auto-Sort"
            >
              {runBusy ? 'Running…' : 'Snapshot-Optimization'}
            </button>
            <span className="pop__action-hint">Refresh snapshot · open Bulk Inbox</span>
          </div>
        </div>
      </div>

      {/* ── Divider ─────────────────────────────────────────────────────────── */}
      <div className="pop__divider" aria-hidden="true" />

      {/* ── Roadmap area ────────────────────────────────────────────────────── */}
      {activeProject ? (
        <div className="pop__roadmap-area">
          {totalCount === 0 ? (
            <p className="pop__roadmap-none">No milestones set</p>
          ) : allDone ? (
            <p className="pop__roadmap-done">All milestones complete ✓</p>
          ) : (
            <div>
              <p className="pop__roadmap-current">
                Current: {activeMilestone?.title ?? ''}
              </p>
              <p className="pop__roadmap-progress">
                {completedCount}/{totalCount} milestones
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="pop__roadmap-placeholder">
          Select or create a project to see the goal and milestone roadmap
        </div>
      )}

      {/* ── Divider ─────────────────────────────────────────────────────────── */}
      <div className="pop__divider" aria-hidden="true" />

      {/* ── Status footer (3 rows) ──────────────────────────────────────────── */}
      <div className="pop__status-footer" role="status" aria-live="polite">
        <div className="pop__sfr">
          <span className="pop__sfr-key">Active project</span>
          <span className="pop__sfr-val">
            {activeProject?.title ?? 'None · no project selected'}
          </span>
        </div>
        <div className="pop__sfr">
          <span className="pop__sfr-key">Auto mode</span>
          <span className="pop__sfr-val">{autoModeLabel}</span>
        </div>
        <div className="pop__sfr">
          <span className="pop__sfr-key">Last sort</span>
          <span className="pop__sfr-val">{lastAnalysisLine}</span>
        </div>
      </div>

      {/* ── Chat context (hidden — preserves useProjectSetupChatContextStore) ── */}
      <details className="pop__drafts--hidden" aria-hidden="true">
        <summary>Context for AI Chat</summary>
        <div>
          <label>
            <input
              type="checkbox"
              checked={includeInChat}
              onChange={(e) => setIncludeInChat(e.target.checked)}
            />
            Send drafts to AI
          </label>
          <input
            className="pop__input"
            value={projectNameDraft}
            onChange={(e) => setProjectNameDraft(e.target.value)}
            placeholder="Project name"
          />
          <textarea
            className="pop__textarea"
            value={goalsDraft}
            onChange={(e) => setGoalsDraft(e.target.value)}
            placeholder="Goals"
          />
          <textarea
            className="pop__textarea"
            value={milestonesDraft}
            onChange={(e) => setMilestonesDraft(e.target.value)}
            placeholder="Milestones"
          />
          <textarea
            className="pop__textarea"
            value={setupTextDraft}
            onChange={(e) => setSetupTextDraft(e.target.value)}
            placeholder="Context"
          />
          {snippets.map((sn) => (
            <div key={sn.id}>
              <span>{sn.label}</span>
              <button type="button" onClick={() => removeSnippet(sn.id)}>×</button>
            </div>
          ))}
          <input
            className="pop__input"
            value={snippetLabel}
            onChange={(e) => setSnippetLabel(e.target.value)}
            placeholder="Snippet label"
          />
          <textarea
            className="pop__textarea"
            value={snippetText}
            onChange={(e) => setSnippetText(e.target.value)}
            placeholder="Snippet text"
          />
          <button type="button" onClick={handleAddSnippet}>Add snippet</button>
        </div>
      </details>

      {/* ── Attachments (hidden — preserves removeAttachment reference) ────── */}
      {activeProject && activeProject.attachments.length > 0 && (
        <div className="pop__hidden-preserve">
          {activeProject.attachments.map((att) => (
            <button
              key={att.id}
              type="button"
              onClick={() => removeAttachment(activeProject.id, att.id)}
              aria-label={`Remove ${att.filename}`}
            >
              ×
            </button>
          ))}
        </div>
      )}

      {/* ── Mail sync handler (hidden — preserves onAutoToggle + store bindings) ── */}
      <div className="pop__hidden-preserve">
        <button
          type="button"
          disabled={autoDisabled || autoToggleBusy}
          onClick={() => void onAutoToggle(!autoSyncEnabled)}
          aria-label="Toggle mail sync"
        >
          {autoSyncEnabled ? 'Sync on' : 'Sync off'}
        </button>
      </div>

      {/* ── Project Setup Modal ─────────────────────────────────────────────── */}
      <ProjectSetupModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        activeProjectId={modalEditId}
      />
    </section>
  )
}
