/**
 * ProjectOptimizationPanel — refactored Project AI Optimization section.
 *
 * Replaces ProjectSetupSection.tsx visually (same mount point in AnalysisCanvas).
 * The swap into AnalysisCanvas happens in Prompt 5 — this file is created now
 * but not yet referenced by AnalysisCanvas.
 *
 * PRESERVED from ProjectSetupSection (unchanged logic, exact store access patterns):
 *   - useEmailInboxStore: autoSyncEnabled, toggleAutoSyncForActiveAccounts,
 *     refreshInboxSyncBackendState, accountIds, primaryAccountId
 *   - useProjectSetupChatContextStore: all draft fields, snippets, includeInChat
 *   - focusHeaderAiChat() dispatch (WRDESK_FOCUS_AI_CHAT_EVENT)
 *   - handleRunAnalysisNow, onAutoToggle callbacks
 *
 * NEW in this version:
 *   - useProjectStore: project/session CRUD, milestone roadmap, agent grid
 *   - ProjectSetupModal: multi-tab setup (replaces inline modal)
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

// ── Milestone roadmap ─────────────────────────────────────────────────────────

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

// ── Agent grid ────────────────────────────────────────────────────────────────

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
  const accountIds      = useMemo(() => activeEmailAccountIdsForSync(emailAccounts), [emailAccounts])
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
  const autoMonitoringActive = !autoDisabled && autoSyncEnabled
  const hasRefreshHandler  = typeof onRefreshOperations === 'function'
  const runCommandDisabled = runBusy || !hasRefreshHandler

  const autoPillLabel = autoDisabled ? 'No accounts' : autoSyncEnabled ? 'Mail sync on' : 'Mail sync off'
  const autoPillMod   = autoDisabled ? 'none' : autoSyncEnabled ? 'active' : 'none'

  const completionPct = activeProject ? milestoneCompletionPct(activeProject.milestones) : null
  const selectorBadgeLabel =
    completionPct === null ? 'No milestones' :
    completionPct === 100  ? '100% complete' :
    completionPct > 0      ? `${completionPct}% done` : 'Not started'
  const selectorBadgeMod   =
    completionPct === 100  ? 'active' :
    completionPct !== null && completionPct > 0 ? 'partial' : 'none'

  const lastAnalysisLine =
    latestAutosortSession?.completedAt != null
      ? formatStatusDate(latestAutosortSession.completedAt)
      : latestAutosortSession?.status && latestAutosortSession.status !== 'completed'
        ? `In progress · ${latestAutosortSession.status}`
        : '—'

  const sessionContextLine =
    latestAutosortSession != null
      ? `${sessionIdShort(latestAutosortSession.sessionId)} · ${typeof latestAutosortSession.totalMessages === 'number' ? `${latestAutosortSession.totalMessages} msg` : '—'}`
      : '—'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="pop" aria-labelledby="pop-section-title">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="pop__header">
        <h2 id="pop-section-title" className="pop__title">Project AI Optimization</h2>
        <button
          type="button"
          className="dash-btn-ghost dash-btn-sm"
          onClick={() => setModalOpen(true)}
        >
          Full Setup
        </button>
      </div>

      {/* ── Project selector bar ──────────────────────────────────────────── */}
      <div className="pop__selector">
        <select
          className="pop__selector-select"
          value={activeProjectId ?? ''}
          onChange={(e) => setActiveProjectId(e.target.value || null)}
          aria-label="Select active project"
        >
          <option value="">— No project selected —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <span
          className={`pop__selector-badge pop__selector-badge--${selectorBadgeMod}`}
          aria-live="polite"
        >
          {activeProject ? selectorBadgeLabel : 'No project'}
        </span>

        <button
          type="button"
          className="dash-btn-secondary dash-btn-sm"
          onClick={() => setModalOpen(true)}
          title="Create a new project"
        >
          + New
        </button>
      </div>

      {/* ── Goal & roadmap (only when project selected) ───────────────────── */}
      {activeProject ? (
        <div className="pop__goal">
          <p className="pop__goal-title">Goal</p>
          {activeProject.goal.summary.trim() ? (
            <p className="pop__goal-summary">{activeProject.goal.summary}</p>
          ) : (
            <p className="pop__goal-empty">No goal summary · edit in Full Setup</p>
          )}
          <MilestoneRoadmap project={activeProject} />
        </div>
      ) : (
        <div className="pop__goal">
          <p className="pop__goal-empty">
            Select or create a project to see the goal &amp; milestone roadmap.
          </p>
        </div>
      )}

      {/* ── Controls row ──────────────────────────────────────────────────── */}
      <div className="pop__controls">
        <div className="pop__controls-toggles">
          {/* Auto-Analysis (project-level) */}
          <div className="pop__controls-toggle-row">
            <label className="dash-toggle" title="Automatically triggers analysis at set intervals">
              <input
                type="checkbox"
                className="dash-toggle__input"
                checked={activeProject?.autoOptimization ?? false}
                disabled={!activeProject}
                onChange={() => activeProject && toggleAutoOptimization(activeProject.id)}
              />
              <span className="dash-toggle__track" />
            </label>
            <span className="pop__controls-toggle-label">Auto-Analysis</span>
            {activeProject?.autoOptimization && (
              <span className="pop__controls-toggle-meta">on</span>
            )}
          </div>

          {/* Snapshot Capture (project-level) */}
          <div className="pop__controls-toggle-row">
            <label
              className="dash-toggle"
              title="Captures system state snapshots for optimization context"
            >
              <input
                type="checkbox"
                className="dash-toggle__input"
                checked={activeProject?.snapshotCapture ?? false}
                disabled={!activeProject}
                onChange={() => activeProject && toggleSnapshotCapture(activeProject.id)}
              />
              <span className="dash-toggle__track" />
            </label>
            <span className="pop__controls-toggle-label">Snapshot Capture</span>
          </div>

          {/* Mail sync toggle (preserved from ProjectSetupSection) */}
          <div className="pop__controls-toggle-row">
            <label
              className={`dash-toggle${autoDisabled || autoToggleBusy ? ' pop__toggle--disabled' : ''}`}
              title={
                autoDisabled
                  ? 'Add an Inbox account to enable'
                  : `Mail sync ${autoSyncEnabled ? 'off' : 'on'} for linked accounts`
              }
            >
              <input
                type="checkbox"
                className="dash-toggle__input"
                checked={autoSyncEnabled && !autoDisabled}
                disabled={autoDisabled || autoToggleBusy}
                onChange={(e) => void onAutoToggle(e.target.checked)}
                aria-label="Auto Mode: scheduled background mail sync"
              />
              <span className="dash-toggle__track" />
            </label>
            <span className="pop__controls-toggle-label">
              {autoToggleBusy ? 'Updating…' : (autoMonitoringActive ? 'Mail Sync on' : 'Mail Sync off')}
            </span>
            <span className="pop__controls-toggle-meta">
              <span
                className={`dash-badge${autoPillMod === 'active' ? ' dash-badge--secure' : ''}`}
                aria-live="polite"
              >
                {autoPillLabel}
              </span>
            </span>
          </div>
        </div>

        {/* Run Analysis button (preserved) */}
        <div className="pop__controls-run">
          <button
            type="button"
            className="dash-btn-primary"
            disabled={runCommandDisabled}
            onClick={() => void handleRunAnalysisNow()}
            title={
              !hasRefreshHandler
                ? 'Refresh is not wired in this view'
                : 'Refresh dashboard + inbox, then open Bulk Inbox'
            }
          >
            {runBusy ? 'Running…' : 'Run Analysis'}
          </button>
          <p className="pop__controls-run-hint">
            {!hasRefreshHandler
              ? 'Refresh not connected.'
              : 'Refresh snapshot · open Bulk Inbox'}
          </p>
        </div>
      </div>

      {/* ── Agent grid ────────────────────────────────────────────────────── */}
      {activeSession && (
        <div>
          <div className="pop__agents-header">
            <span className="pop__agents-title">
              Agent outputs · {activeSession.name}
            </span>
            <button
              type="button"
              className="dash-btn-ghost dash-btn-sm"
              onClick={focusHeaderAiChat}
              title="Open AI chat for this session"
            >
              Ask AI
            </button>
          </div>
          <AgentGrid agents={activeSession.agents} />
        </div>
      )}

      {/* ── Attachments ───────────────────────────────────────────────────── */}
      {activeProject && activeProject.attachments.length > 0 && (
        <details className="pop__attachments">
          <summary className="pop__attachments-summary">
            Attachments ({activeProject.attachments.length})
          </summary>
          <div className="pop__attachments-body">
            {activeProject.attachments.map((att) => (
              <div key={att.id} className="pop__attachment-row">
                <span className={`pop__attachment-type pop__attachment-type--${att.type}`}>
                  {att.type}
                </span>
                <span className="pop__attachment-label" title={att.label}>
                  {att.label}
                </span>
                <span className="pop__attachment-preview" title={att.content}>
                  {att.content.slice(0, 90)}{att.content.length > 90 ? '…' : ''}
                </span>
                <button
                  type="button"
                  className="pop__attachment-remove"
                  onClick={() => removeAttachment(activeProject.id, att.id)}
                  aria-label={`Remove attachment ${att.label}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Status board (preserved) ──────────────────────────────────────── */}
      <div className="pop__status-board" role="status" aria-live="polite">
        <div className="pop__status-row">
          <span className="pop__status-key">Active project</span>
          <span className="pop__status-val">
            {activeProject?.name ?? 'None · no project selected'}
          </span>
        </div>
        <div className="pop__status-row">
          <span className="pop__status-key">Auto mode</span>
          <span className="pop__status-val">
            {autoDisabled ? 'Off · add Inbox account' : autoSyncEnabled ? 'On · background mail sync' : 'Off · sync paused'}
          </span>
        </div>
        <div className="pop__status-row">
          <span className="pop__status-key">Last sort</span>
          <span className="pop__status-val">{lastAnalysisLine}</span>
        </div>
        <div className="pop__status-row">
          <span className="pop__status-key">Sort session</span>
          <span className="pop__status-val">{sessionContextLine}</span>
        </div>
      </div>

      {/* ── Chat context drafts (preserved, collapsible) ──────────────────── */}
      <details className="pop__drafts">
        <summary className="pop__drafts-summary">
          Context for AI Chat
          {includeInChat && (
            <span className="dash-badge dash-badge--secure" style={{ marginLeft: '8px' }}>Active</span>
          )}
        </summary>
        <div className="pop__drafts-body">
          <p className="pop__drafts-note">
            Session drafts only · not persisted as project records
          </p>

          <label className="dash-toggle pop__controls-toggle-row" style={{ gap: 'var(--ds-space-sm)' }}>
            <input
              type="checkbox"
              className="dash-toggle__input"
              checked={includeInChat}
              onChange={(e) => setIncludeInChat(e.target.checked)}
            />
            <span className="dash-toggle__track" />
            <span className="pop__controls-toggle-label">Send drafts to header AI (Analysis)</span>
          </label>

          <div>
            <label className="pop__label" htmlFor="pop-draft-name">Project name (draft)</label>
            <input
              id="pop-draft-name"
              className="pop__input"
              value={projectNameDraft}
              onChange={(e) => setProjectNameDraft(e.target.value)}
              placeholder="Working title"
              autoComplete="off"
            />
          </div>

          <div>
            <label className="pop__label" htmlFor="pop-draft-goals">Goals</label>
            <textarea
              id="pop-draft-goals"
              className="pop__textarea"
              value={goalsDraft}
              onChange={(e) => setGoalsDraft(e.target.value)}
              placeholder="Outcomes, metrics, success criteria…"
              rows={3}
            />
          </div>

          <div>
            <label className="pop__label" htmlFor="pop-draft-milestones">Milestones (draft)</label>
            <textarea
              id="pop-draft-milestones"
              className="pop__textarea"
              value={milestonesDraft}
              onChange={(e) => setMilestonesDraft(e.target.value)}
              placeholder="Phases or checkpoints…"
              rows={3}
            />
          </div>

          <div>
            <label className="pop__label" htmlFor="pop-draft-context">Context</label>
            <textarea
              id="pop-draft-context"
              className="pop__textarea"
              value={setupTextDraft}
              onChange={(e) => setSetupTextDraft(e.target.value)}
              placeholder="Constraints, systems, compliance notes…"
              rows={3}
            />
          </div>

          {/* Snippets (preserved) */}
          <div className="pop__snippets">
            <span className="pop__label">Context snippets (optional)</span>
            {snippets.map((sn) => (
              <div key={sn.id} className="pop__snippet-item">
                <span className="pop__snippet-label">{sn.label || '(untitled)'}</span>
                <span className="pop__snippet-preview">
                  {sn.text.trim().slice(0, 120)}{sn.text.length > 120 ? '…' : ''}
                </span>
                <button
                  type="button"
                  className="pop__snippet-remove"
                  onClick={() => removeSnippet(sn.id)}
                  aria-label={`Remove snippet ${sn.label}`}
                >
                  ×
                </button>
              </div>
            ))}

            <div className="pop__snippet-add">
              <input
                className="pop__input"
                value={snippetLabel}
                onChange={(e) => setSnippetLabel(e.target.value)}
                placeholder="Label"
                aria-label="Snippet label"
              />
              <textarea
                className="pop__textarea"
                value={snippetText}
                onChange={(e) => setSnippetText(e.target.value)}
                placeholder="Paste or type reference text (session only)"
                rows={2}
              />
              <button
                type="button"
                className="dash-btn-secondary dash-btn-sm"
                onClick={handleAddSnippet}
              >
                Add snippet
              </button>
            </div>
          </div>
        </div>
      </details>

      {/* ── Multi-tab setup modal ─────────────────────────────────────────── */}
      <ProjectSetupModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        activeProjectId={activeProjectId}
      />
    </section>
  )
}
