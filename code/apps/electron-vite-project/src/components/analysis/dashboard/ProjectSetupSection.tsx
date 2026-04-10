/**
 * Command-center module: Project Assistant — controls first, optional context collapsed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'
import { WRDESK_FOCUS_AI_CHAT_EVENT } from '../../../lib/wrdeskUiEvents'
import { useProjectSetupChatContextStore } from '../../../stores/useProjectSetupChatContextStore'
import { activeEmailAccountIdsForSync, useEmailInboxStore } from '../../../stores/useEmailInboxStore'
import type {
  AnalysisDashboardAutosortSessionMeta,
  AnalysisDashboardProjectSetupSection,
} from '../../../types/analysisDashboardSnapshot'
import './ProjectSetupSection.css'

const FALLBACK_SETUP: AnalysisDashboardProjectSetupSection = {
  mode: 'v1_activation_placeholder',
  headline: 'Drafts only until project storage ships.',
  body: 'Optional fields below · session memory · not persisted as project records.',
}

export type ProjectSetupModalTab = 'overview' | 'create' | 'select'

export type DashboardEmailAccountRow = { id: string; email?: string; status?: string; processingPaused?: boolean }

export interface ProjectSetupSectionProps {
  /** From dashboard snapshot (`projectSetup`); falls back if snapshot not loaded */
  projectSetup: AnalysisDashboardProjectSetupSection | null
  /** When true, show subdued loading hint in the status row only */
  loading?: boolean
  /** Connected mail accounts (from app shell) — used for Auto sync toggle */
  emailAccounts?: DashboardEmailAccountRow[]
  /** Refresh dashboard snapshot + inbox list, then optionally navigate to bulk inbox */
  onRefreshOperations?: () => void | Promise<void>
  /** Open Bulk Inbox so user can run AI Auto-Sort (after refresh) */
  onOpenBulkInboxForAnalysis?: () => void
  /** Latest autosort session from dashboard snapshot (read-only status — no invented fields) */
  latestAutosortSession?: AnalysisDashboardAutosortSessionMeta | null
}

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

export type ProjectSetupModalDraftBindings = {
  projectName: string
  setProjectName: (v: string) => void
  goals: string
  setGoals: (v: string) => void
  setupContext: string
  setSetupContext: (v: string) => void
  firstMilestone: string
  setFirstMilestone: (v: string) => void
  includeInChat: boolean
  setIncludeInChat: (v: boolean) => void
}

interface SetupModalProps {
  open: boolean
  initialTab: ProjectSetupModalTab
  subtitle: string
  onClose: () => void
  drafts: ProjectSetupModalDraftBindings
}

function ProjectSetupModal({ open, initialTab, subtitle, onClose, drafts }: SetupModalProps) {
  const [tab, setTab] = useState<ProjectSetupModalTab>(initialTab)

  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  useEffect(() => {
    if (!open || tab !== 'create') return
    const id = window.requestAnimationFrame(() => {
      document.getElementById('ps-modal-project-name')?.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [open, tab])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const draftSummary = (() => {
    const name = drafts.projectName.trim()
    if (name) return name.length > 64 ? `${name.slice(0, 61)}…` : name
    if (drafts.goals.trim()) return 'Untitled · objective drafted'
    if (drafts.setupContext.trim() || drafts.firstMilestone.trim()) return 'Untitled · context or milestone drafted'
    return null
  })()

  return (
    <div
      className="project-setup-modal__overlay"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="project-setup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-setup-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="project-setup-modal__header">
          <div className="project-setup-modal__header-text">
            <h2 id="project-setup-modal-title" className="project-setup-modal__title">
              Project Assistant
            </h2>
            <p className="project-setup-modal__subtitle">{subtitle}</p>
          </div>
          <button type="button" className="project-setup-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="project-setup-modal__tabs" role="tablist" aria-label="Setup views">
          {(
            [
              ['overview', 'Full Setup'],
              ['create', 'New Project'],
              ['select', 'Select Project'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`project-setup-modal__tab${tab === id ? ' project-setup-modal__tab--active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="project-setup-modal__body">
          {tab === 'overview' && (
            <div className="project-setup-modal__panel" role="tabpanel" aria-labelledby="project-setup-full-setup-heading">
              <h3 id="project-setup-full-setup-heading" className="project-setup-modal__section-heading">
                Full Setup
              </h3>
              {draftSummary ? (
                <p className="project-setup-modal__draft-glance" aria-live="polite">
                  <span className="project-setup-modal__draft-glance-k">Draft · </span>
                  {draftSummary}
                </p>
              ) : (
                <p className="project-setup-modal__muted project-setup-modal__micro">No draft · New Project</p>
              )}
              <div className="project-setup-modal__actions project-setup-modal__actions--row">
                <button
                  type="button"
                  className="project-setup-modal__btn project-setup-modal__btn--purple"
                  onClick={() => setTab('create')}
                >
                  New Project
                </button>
                <button type="button" className="project-setup-modal__btn project-setup-modal__btn--primary" onClick={focusHeaderAiChat}>
                  Header AI
                </button>
              </div>
            </div>
          )}

          {tab === 'create' && (
            <div className="project-setup-modal__panel" role="tabpanel" aria-labelledby="project-setup-new-heading">
              <h3 id="project-setup-new-heading" className="project-setup-modal__section-heading">
                New project
              </h3>
              <p className="project-setup-modal__muted project-setup-modal__micro">Session drafts only · not saved as project records.</p>
              <form className="project-setup-modal__form" onSubmit={(e) => e.preventDefault()}>
                <label className="project-setup-modal__label" htmlFor="ps-modal-project-name">
                  Project name
                </label>
                <input
                  id="ps-modal-project-name"
                  className="project-setup-modal__input"
                  value={drafts.projectName}
                  onChange={(e) => drafts.setProjectName(e.target.value)}
                  placeholder="Working name"
                  autoComplete="off"
                />
                <label className="project-setup-modal__label" htmlFor="ps-modal-objective">
                  Objective / goal
                </label>
                <textarea
                  id="ps-modal-objective"
                  className="project-setup-modal__textarea"
                  value={drafts.goals}
                  onChange={(e) => drafts.setGoals(e.target.value)}
                  placeholder="What optimized email handling should achieve for this initiative"
                  rows={3}
                />
                <label className="project-setup-modal__label" htmlFor="ps-modal-context">
                  Initial context <span className="project-setup-modal__optional">(optional)</span>
                </label>
                <textarea
                  id="ps-modal-context"
                  className="project-setup-modal__textarea"
                  value={drafts.setupContext}
                  onChange={(e) => drafts.setSetupContext(e.target.value)}
                  placeholder="Constraints, systems, notes"
                  rows={3}
                />
                <label className="project-setup-modal__label" htmlFor="ps-modal-milestone">
                  First milestone <span className="project-setup-modal__optional">(optional)</span>
                </label>
                <textarea
                  id="ps-modal-milestone"
                  className="project-setup-modal__textarea project-setup-modal__textarea--compact"
                  value={drafts.firstMilestone}
                  onChange={(e) => drafts.setFirstMilestone(e.target.value)}
                  placeholder="Checkpoint (text)"
                  rows={2}
                />
                <label className="project-setup-modal__check">
                  <input
                    type="checkbox"
                    checked={drafts.includeInChat}
                    onChange={(e) => drafts.setIncludeInChat(e.target.checked)}
                  />
                  <span>Include in header AI chats (Analysis)</span>
                </label>
                <div className="project-setup-modal__form-actions">
                  <button
                    type="button"
                    className="project-setup-modal__btn project-setup-modal__btn--purple"
                    onClick={() => setTab('overview')}
                  >
                    Full Setup
                  </button>
                  <button type="button" className="project-setup-modal__btn" onClick={focusHeaderAiChat}>
                    Header AI
                  </button>
                </div>
              </form>
            </div>
          )}

          {tab === 'select' && (
            <div className="project-setup-modal__panel" role="tabpanel">
              <h3 className="project-setup-modal__section-heading">Select project</h3>
              <div className="project-setup-modal__empty" aria-live="polite">
                <p className="project-setup-modal__empty-title">No saved projects</p>
                <p className="project-setup-modal__empty-body">Persistence pending · use New Project for drafts.</p>
              </div>
            </div>
          )}
        </div>

        <div className="project-setup-modal__footer">
          <button type="button" className="project-setup-modal__btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export function ProjectSetupSection({
  projectSetup,
  loading,
  emailAccounts = [],
  onRefreshOperations,
  onOpenBulkInboxForAnalysis,
  latestAutosortSession = null,
}: ProjectSetupSectionProps) {
  const copy = projectSetup ?? FALLBACK_SETUP
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTab, setModalTab] = useState<ProjectSetupModalTab>('overview')
  const [snippetLabel, setSnippetLabel] = useState('')
  const [snippetText, setSnippetText] = useState('')
  const [runBusy, setRunBusy] = useState(false)
  const [autoToggleBusy, setAutoToggleBusy] = useState(false)

  const accountIds = useMemo(() => activeEmailAccountIdsForSync(emailAccounts), [emailAccounts])
  const primaryAccountId = useMemo(() => pickDefaultEmailAccountRowId(emailAccounts), [emailAccounts])
  const autoSyncEnabled = useEmailInboxStore((s) => s.autoSyncEnabled)
  const toggleAutoSyncForActiveAccounts = useEmailInboxStore((s) => s.toggleAutoSyncForActiveAccounts)
  const refreshInboxSyncBackendState = useEmailInboxStore((s) => s.refreshInboxSyncBackendState)

  useEffect(() => {
    if (accountIds.length === 0) return
    void refreshInboxSyncBackendState({ syncTargetIds: accountIds, primaryAccountId: primaryAccountId ?? null })
  }, [accountIds, primaryAccountId, refreshInboxSyncBackendState])

  const onAutoToggle = useCallback(
    async (enabled: boolean) => {
      if (accountIds.length === 0 || autoToggleBusy) return
      setAutoToggleBusy(true)
      try {
        await toggleAutoSyncForActiveAccounts(enabled, accountIds, primaryAccountId)
      } finally {
        setAutoToggleBusy(false)
      }
    },
    [accountIds, primaryAccountId, toggleAutoSyncForActiveAccounts, autoToggleBusy],
  )

  const handleRunAnalysisNow = useCallback(async () => {
    if (runBusy || loading) return
    if (!onRefreshOperations) return
    setRunBusy(true)
    try {
      await onRefreshOperations()
      onOpenBulkInboxForAnalysis?.()
    } finally {
      setRunBusy(false)
    }
  }, [onRefreshOperations, onOpenBulkInboxForAnalysis, runBusy, loading])

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
      includeInChat: s.includeInChat,
      setIncludeInChat: s.setIncludeInChat,
      projectNameDraft: s.projectNameDraft,
      setProjectNameDraft: s.setProjectNameDraft,
      goalsDraft: s.goalsDraft,
      setGoalsDraft: s.setGoalsDraft,
      milestonesDraft: s.milestonesDraft,
      setMilestonesDraft: s.setMilestonesDraft,
      setupTextDraft: s.setupTextDraft,
      setSetupTextDraft: s.setSetupTextDraft,
      snippets: s.snippets,
      addSnippet: s.addSnippet,
      removeSnippet: s.removeSnippet,
    })),
  )

  const openModal = useCallback((t: ProjectSetupModalTab) => {
    setModalTab(t)
    setModalOpen(true)
  }, [])

  const handleAddSnippet = useCallback(() => {
    if (!snippetLabel.trim() && !snippetText.trim()) return
    addSnippet({ label: snippetLabel, text: snippetText })
    setSnippetLabel('')
    setSnippetText('')
  }, [snippetLabel, snippetText, addSnippet])

  const autoDisabled = accountIds.length === 0
  const autoMonitoringActive = !autoDisabled && autoSyncEnabled
  const hasRefreshHandler = typeof onRefreshOperations === 'function'
  const hasBulkOpenHandler = typeof onOpenBulkInboxForAnalysis === 'function'
  const runCommandDisabled = loading || runBusy || !hasRefreshHandler

  /** No persisted project id in this build — do not imply a draft name is the “active project”. */
  const activeProjectLine = 'None · no persisted project'

  const autoModeLine = autoDisabled
    ? 'Off · add Inbox account'
    : autoSyncEnabled
      ? 'On · background mail sync'
      : 'Off · sync paused'

  const autoPillLabel = autoDisabled ? 'Unavailable' : autoSyncEnabled ? 'Mail sync on' : 'Mail sync off'
  const autoPillMod = autoDisabled ? 'na' : autoSyncEnabled ? 'on' : 'off'

  const lastAnalysisLine =
    latestAutosortSession?.completedAt != null
      ? formatStatusDate(latestAutosortSession.completedAt)
      : latestAutosortSession != null && latestAutosortSession.status && latestAutosortSession.status !== 'completed'
        ? `In progress · ${latestAutosortSession.status}`
        : '—'

  const sessionContextLine =
    latestAutosortSession != null
      ? `${sessionIdShort(latestAutosortSession.sessionId)} · ${typeof latestAutosortSession.totalMessages === 'number' ? `${latestAutosortSession.totalMessages} msg` : '—'}`
      : '—'

  return (
    <section
      className="project-setup-section project-setup-section--primary project-setup-section--command"
      aria-labelledby="project-setup-display-title"
    >
      <header className="project-setup-section__hero project-setup-section__hero--command">
        <div className="project-setup-section__hero-top">
          <h2 id="project-setup-display-title" className="project-setup-section__display-title">
            Project Assistant
          </h2>
        </div>
        <p className="project-setup-section__tagline">{copy.headline}</p>
      </header>

      <div
        className="project-setup-section__ops"
        aria-label="Operational controls"
        title="Auto: scheduled mail sync only. Does not run Auto-Sort."
      >
        <p className="project-setup-section__ops-heading">Operations</p>

        <div className="project-setup-section__ops-row project-setup-section__ops-row--auto">
          <div className="project-setup-section__ops-copy">
            <span className="project-setup-section__ops-label">Auto Mode</span>
            <span className="project-setup-section__ops-meta">
              <span
                className={`project-setup-section__ops-pill project-setup-section__ops-pill--${autoPillMod}`}
                aria-live="polite"
              >
                {autoToggleBusy ? 'Updating…' : autoPillLabel}
              </span>
            </span>
          </div>
          <label
            className={`project-setup-section__auto project-setup-section__auto--ops${
              autoDisabled || autoToggleBusy ? ' project-setup-section__auto--disabled' : ''
            }`}
            title={
              autoDisabled
                ? 'Add an Inbox account to enable'
                : `Mail sync ${autoSyncEnabled ? 'off' : 'on'} for linked accounts`
            }
          >
            <span className="project-setup-section__auto-label">{autoMonitoringActive ? 'Sync on' : 'Sync off'}</span>
            <input
              type="checkbox"
              checked={autoSyncEnabled && !autoDisabled}
              disabled={autoDisabled || loading || autoToggleBusy}
              onChange={(e) => void onAutoToggle(e.target.checked)}
              aria-label="Auto Mode: scheduled background mail sync for linked accounts"
            />
          </label>
        </div>

        <div className="project-setup-section__ops-row project-setup-section__ops-row--run">
          <div className="project-setup-section__ops-run-block">
            <button
              type="button"
              className="project-setup-section__btn project-setup-section__btn--command"
              disabled={runCommandDisabled}
              onClick={() => void handleRunAnalysisNow()}
              title={
                !hasRefreshHandler
                  ? 'Refresh is not wired in this view'
                  : 'Run now: refresh dashboard and inbox, then open Bulk Inbox when available'
              }
            >
              {runBusy ? 'Running…' : 'Run Analysis Now'}
            </button>
            <p className="project-setup-section__ops-run-hint">
              {!hasRefreshHandler
                ? 'Refresh not connected.'
                : hasBulkOpenHandler
                  ? 'Refresh snapshot + inbox · open Bulk Inbox (run Auto-Sort there).'
                  : 'Refresh snapshot + inbox · open Inbox for Auto-Sort.'}
            </p>
          </div>
        </div>
      </div>

      <div className="project-setup-section__workspace-strip" role="group" aria-label="Project workspace">
        <button
          type="button"
          className="project-setup-section__btn project-setup-section__btn--primary project-setup-section__cmd"
          onClick={() => openModal('create')}
        >
          New Project
        </button>
        <button
          type="button"
          className="project-setup-section__btn project-setup-section__btn--secondary project-setup-section__cmd"
          onClick={() => openModal('select')}
        >
          Select Project
        </button>
        <button
          type="button"
          className="project-setup-section__btn project-setup-section__btn--outline project-setup-section__cmd"
          onClick={() => openModal('overview')}
        >
          Full Setup
        </button>
        <button
          type="button"
          className="project-setup-section__btn project-setup-section__btn--link project-setup-section__cmd"
          onClick={focusHeaderAiChat}
        >
          Header AI
        </button>
      </div>

      <div className="project-setup-section__status-board" role="status" aria-live="polite">
        {loading ? (
          <p className="project-setup-section__status-loading">Loading status…</p>
        ) : (
          <>
            <div className="project-setup-section__status-row">
              <span className="project-setup-section__status-key">Active project</span>
              <span className="project-setup-section__status-val">{activeProjectLine}</span>
            </div>
            <div className="project-setup-section__status-row">
              <span className="project-setup-section__status-key">Auto mode</span>
              <span className="project-setup-section__status-val">{autoModeLine}</span>
            </div>
            <div className="project-setup-section__status-row">
              <span className="project-setup-section__status-key">Last sort</span>
              <span className="project-setup-section__status-val">{lastAnalysisLine}</span>
            </div>
            <div className="project-setup-section__status-row">
              <span className="project-setup-section__status-key">Sort session</span>
              <span className="project-setup-section__status-val">{sessionContextLine}</span>
            </div>
          </>
        )}
      </div>

      <details className="project-setup-section__drafts project-setup-section__drafts--advanced">
        <summary className="project-setup-section__drafts-summary">Drafts &amp; snippets</summary>
        <div className="project-setup-section__drafts-inner">
          <p className="project-setup-section__more-body project-setup-section__note-inline">{copy.body}</p>
          <label className="project-setup-section__toggle">
            <input
              type="checkbox"
              checked={includeInChat}
              onChange={(e) => setIncludeInChat(e.target.checked)}
            />
            <span>Send drafts to header AI (Analysis)</span>
          </label>
          <label className="project-setup-section__label" htmlFor="ps-name">
            Project name (draft)
          </label>
          <input
            id="ps-name"
            className="project-setup-section__input"
            value={projectNameDraft}
            onChange={(e) => setProjectNameDraft(e.target.value)}
            placeholder="Working title"
            autoComplete="off"
          />
          <label className="project-setup-section__label" htmlFor="ps-goals">
            Goals
          </label>
          <textarea
            id="ps-goals"
            className="project-setup-section__textarea"
            value={goalsDraft}
            onChange={(e) => setGoalsDraft(e.target.value)}
            placeholder="Outcomes, metrics, success criteria…"
            rows={3}
          />
          <label className="project-setup-section__label" htmlFor="ps-milestones">
            Milestones (draft)
          </label>
          <textarea
            id="ps-milestones"
            className="project-setup-section__textarea"
            value={milestonesDraft}
            onChange={(e) => setMilestonesDraft(e.target.value)}
            placeholder="Phases or checkpoints…"
            rows={3}
          />
          <label className="project-setup-section__label" htmlFor="ps-setup">
            Context
          </label>
          <textarea
            id="ps-setup"
            className="project-setup-section__textarea"
            value={setupTextDraft}
            onChange={(e) => setSetupTextDraft(e.target.value)}
            placeholder="Constraints, systems, compliance notes…"
            rows={3}
          />

          <div className="project-setup-section__snippets">
            <span className="project-setup-section__label">Context snippets (optional)</span>
            {snippets.length > 0 ? (
              <ul className="project-setup-section__snippet-list">
                {snippets.map((sn) => (
                  <li key={sn.id} className="project-setup-section__snippet-item">
                    <span className="project-setup-section__snippet-label">{sn.label || '(untitled)'}</span>
                    <span className="project-setup-section__snippet-preview">{sn.text.trim().slice(0, 120)}{sn.text.length > 120 ? '…' : ''}</span>
                    <button type="button" className="project-setup-section__snippet-remove" onClick={() => removeSnippet(sn.id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="project-setup-section__snippet-add">
              <input
                className="project-setup-section__input"
                value={snippetLabel}
                onChange={(e) => setSnippetLabel(e.target.value)}
                placeholder="Label"
                aria-label="Snippet label"
              />
              <textarea
                className="project-setup-section__textarea project-setup-section__textarea--snippet"
                value={snippetText}
                onChange={(e) => setSnippetText(e.target.value)}
                placeholder="Paste or type reference text (session only)"
                rows={2}
              />
              <button type="button" className="project-setup-section__btn project-setup-section__btn--small" onClick={handleAddSnippet}>
                Add snippet
              </button>
            </div>
          </div>
        </div>
      </details>

      <ProjectSetupModal
        open={modalOpen}
        initialTab={modalTab}
        subtitle={copy.headline}
        onClose={() => setModalOpen(false)}
        drafts={{
          projectName: projectNameDraft,
          setProjectName: setProjectNameDraft,
          goals: goalsDraft,
          setGoals: setGoalsDraft,
          setupContext: setupTextDraft,
          setSetupContext: setSetupTextDraft,
          firstMilestone: milestonesDraft,
          setFirstMilestone: setMilestonesDraft,
          includeInChat,
          setIncludeInChat,
        }}
      />
    </section>
  )
}
