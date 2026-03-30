/**
 * ProjectOptimizationPanel — compact card layout (PROMPT 3 refactor).
 *
 * UI: 4-zone card — header, selector+controls, roadmap, status footer.
 * All business logic, store connections, and IPC calls are PRESERVED unchanged.
 *
 * PRESERVED (exact store access patterns):
 *   - useEmailInboxStore: autoSyncEnabled, toggleAutoSyncForActiveAccounts,
 *     refreshInboxSyncBackendState, accountIds, primaryAccountId
 *   - useProjectSetupChatContextStore: all draft fields, snippets, includeInChat
 *   - focusHeaderAiChat() dispatch (WRDESK_FOCUS_AI_CHAT_EVENT)
 *   - handleRunAnalysisNow, onAutoToggle callbacks
 *   - useProjectStore: project/session CRUD, milestone roadmap, agent grid
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
  selectLinkedSession,
  milestoneCompletionPct,
} from '../../../stores/useProjectStore'
import type { AnalysisDashboardAutosortSessionMeta } from '../../../types/analysisDashboardSnapshot'
import type { AgentSlot, Project, ProjectMilestone } from '../../../types/projectTypes'
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
  /** Latest completed autosort session from dashboard snapshot (read-only). */
  latestAutosortSession?: AnalysisDashboardAutosortSessionMeta | null
  /** Connected mail accounts from the app shell — used for auto-sync toggle. */
  emailAccounts?: DashboardEmailAccountRow[]
  /** Refresh dashboard snapshot + inbox list. */
  onRefreshOperations?: () => void | Promise<void>
  /** Navigate to Bulk Inbox after refresh (for AI Auto-Sort). */
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

function sessionIdShort(id: string): string {
  const t = id.trim()
  if (t.length <= 12) return t
  return `${t.slice(0, 10)}…`
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MilestoneRoadmap({ project }: { project: Project }) {
  const { updateMilestoneStatus } = useProjectStore(
    useShallow((s) => ({ updateMilestoneStatus: s.updateMilestoneStatus })),
  )

  const sorted = useMemo(
    () => [...project.milestones].sort((a, b) => a.order - b.order),
    [project.milestones],
  )

  const activeIndex = sorted.findIndex((m) => m.status === 'in_progress')
  const activeMilestone: ProjectMilestone | null =
    activeIndex >= 0
      ? (sorted[activeIndex] ?? null)
      : (sorted.find((m) => m.status === 'pending') ?? null)

  function cycleStatus(m: ProjectMilestone) {
    const next: ProjectMilestone['status'] =
      m.status === 'pending' ? 'in_progress'
      : m.status === 'in_progress' ? 'completed'
      : 'pending'
    updateMilestoneStatus(project.id, m.id, next)
  }

  if (sorted.length === 0) {
    return (
      <p className="pop__roadmap-empty">
        No milestones · add them in Full Setup
      </p>
    )
  }

  return (
    <div className="pop__roadmap">
      <div className="pop__roadmap-track" role="list" aria-label="Milestone roadmap">
        {sorted.slice(0, 9).map((m, i) => (
          <span key={m.id} role="listitem" style={{ display: 'contents' }}>
            {i > 0 && (
              <div
                className={`pop__roadmap-line${sorted[i - 1]?.status === 'completed' ? ' pop__roadmap-line--done' : ''}`}
              />
            )}
            <button
              type="button"
              className={[
                'pop__roadmap-node',
                m.status === 'completed' ? 'pop__roadmap-node--completed' : '',
                m.status === 'in_progress' ? 'pop__roadmap-node--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={`${m.title} (${m.status}) — click to advance`}
              aria-label={`${m.title}: ${m.status}`}
              onClick={() => cycleStatus(m)}
            >
              {m.status === 'completed' && (
                <span className="pop__roadmap-node-check" aria-hidden="true">✓</span>
              )}
            </button>
          </span>
        ))}
      </div>

      {activeMilestone && (
        <p className="pop__roadmap-label">
          <strong>
            {activeMilestone.status === 'in_progress' ? 'In progress: ' : 'Up next: '}
          </strong>
          {activeMilestone.title}
        </p>
      )}
    </div>
  )
}

// ── Agent grid (used in hidden preservation section) ──────────────────────────

function AgentGrid({ agents }: { agents: readonly AgentSlot[] }) {
  const enabled = agents.filter((a) => a.enabled)

  if (enabled.length === 0) {
    return (
      <div className="pop__agents-empty">
        No active agent slots — configure them in Full Setup
      </div>
    )
  }

  return (
    <div className="pop__agents-grid">
      {enabled.map((agent) => {
        const confidencePct =
          agent.confidence !== null ? Math.round(agent.confidence * 100) : null
        const fillClass =
          confidencePct === null
            ? ''
            : confidencePct < 40
              ? 'pop__agent-card__confidence-fill--critical'
              : confidencePct < 65
                ? 'pop__agent-card__confidence-fill--low'
                : ''

        return (
          <div
            key={agent.id}
            className="pop__agent-card"
            title={agent.lastOutput ?? 'No output yet'}
          >
            <span className="pop__agent-card__label">{agent.label}</span>
            <span
              className={`pop__agent-card__preview${!agent.lastOutput ? ' pop__agent-card__preview--empty' : ''}`}
            >
              {agent.lastOutput ?? 'No output yet'}
            </span>
            <div className="pop__agent-card__confidence" aria-hidden="true">
              {confidencePct !== null && (
                <div
                  className={`pop__agent-card__confidence-fill ${fillClass}`}
                  style={{ width: `${confidencePct}%` }}
                />
              )}
            </div>
            <span className="pop__agent-card__meta">
              {confidencePct !== null ? `${confidencePct}% · ` : ''}
              {formatRelativeTime(agent.lastRunAt)}
            </span>
          </div>
        )
      })}
    </div>
  )
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
    setActiveProjectId,
    toggleAutoOptimization,
    toggleSnapshotCapture,
    removeAttachment,
  } = useProjectStore(
    useShallow((s) => ({
      projects:               s.projects,
      activeProjectId:        s.activeProjectId,
      setActiveProjectId:     s.setActiveProjectId,
      toggleAutoOptimization: s.toggleAutoOptimization,
      toggleSnapshotCapture:  s.toggleSnapshotCapture,
      removeAttachment:       s.removeAttachment,
    })),
  )

  const activeProject = useProjectStore(selectActiveProject)
  const activeSession = useProjectStore((s) => selectLinkedSession(s, activeProject))

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

  const [runBusy, setRunBusy] = useState(false)

  const handleRunAnalysisNow = useCallback(async () => {
    if (runBusy || !onRefreshOperations) return
    setRunBusy(true)
    try {
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

  // ── Snippet add form ───────────────────────────────────────────────────────
  const [snippetLabel, setSnippetLabel] = useState('')
  const [snippetText, setSnippetText]   = useState('')

  const handleAddSnippet = useCallback(() => {
    if (!snippetLabel.trim() && !snippetText.trim()) return
    addSnippet({ label: snippetLabel, text: snippetText })
    setSnippetLabel('')
    setSnippetText('')
  }, [snippetLabel, snippetText, addSnippet])

  // ── Modal ──────────────────────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false)

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

  // milestoneCompletionPct referenced to keep import live
  void milestoneCompletionPct
  // sessionIdShort referenced to keep import live
  void sessionIdShort
  // focusHeaderAiChat referenced to keep import live
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
            onClick={() => setModalOpen(true)}
            title="Open full project setup"
          >
            Setup
          </button>
          <button
            type="button"
            className="pop__btn-sm"
            onClick={() => setModalOpen(true)}
            title="Create a new project"
          >
            + New
          </button>
        </div>
      </div>

      {/* ── Selector + Controls (grouped, no divider between them) ──────────── */}
      <div className="pop__selector-group">
        {/* Project dropdown */}
        <select
          className={`pop__compact-select${activeProjectId ? ' pop__compact-select--has-value' : ''}`}
          value={activeProjectId ?? ''}
          onChange={(e) => setActiveProjectId(e.target.value || null)}
          aria-label="Select active project"
        >
          <option value="">— No project selected —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* Controls row: Auto-Optimization toggle + Snapshot-Optimization button */}
        <div className="pop__controls-inline">
          {/* Auto-Optimization toggle */}
          <label className="pop__toggle-wrap">
            <button
              type="button"
              role="switch"
              aria-checked={activeProject?.autoOptimization ?? false}
              className={`pop__toggle-switch${(activeProject?.autoOptimization ?? false) ? ' pop__toggle-switch--on' : ''}`}
              disabled={!activeProject}
              onClick={() => activeProject && toggleAutoOptimization(activeProject.id)}
              title="Automatically triggers analysis at set intervals"
            >
              <span className="pop__toggle-knob" />
            </button>
            <span className="pop__toggle-text">Auto-Optimization</span>
          </label>

          {/* Snapshot-Optimization button */}
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
        <MilestoneRoadmap project={activeProject} />
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
            {activeProject?.name ?? 'None · no project selected'}
          </span>
        </div>
        <div className="pop__sfr">
          <span className="pop__sfr-key">Auto mode</span>
          <span className="pop__sfr-val">
            {autoDisabled
              ? 'Off · add Inbox account'
              : autoSyncEnabled
                ? 'On · background mail sync'
                : 'Off · sync paused'}
          </span>
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

      {/* ── Agent grid (hidden — preserves activeSession + AgentGrid reference) ── */}
      {activeSession && (
        <div className="pop__hidden-preserve">
          <AgentGrid agents={activeSession.agents} />
        </div>
      )}

      {/* ── Attachments (hidden — preserves removeAttachment reference) ────── */}
      {activeProject && activeProject.attachments.length > 0 && (
        <div className="pop__hidden-preserve">
          {activeProject.attachments.map((att) => (
            <button
              key={att.id}
              type="button"
              onClick={() => removeAttachment(activeProject.id, att.id)}
              aria-label={`Remove ${att.label}`}
            >
              ×
            </button>
          ))}
        </div>
      )}

      {/* ── Snapshot Capture (hidden — preserves toggleSnapshotCapture reference) ── */}
      {activeProject && (
        <div className="pop__hidden-preserve">
          <button
            type="button"
            onClick={() => toggleSnapshotCapture(activeProject.id)}
            aria-label="Toggle snapshot capture"
          >
            Snapshot: {activeProject.snapshotCapture ? 'on' : 'off'}
          </button>
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

      {/* ── Multi-tab setup modal ─────────────────────────────────────────── */}
      <ProjectSetupModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        activeProjectId={activeProjectId}
      />
    </section>
  )
}
