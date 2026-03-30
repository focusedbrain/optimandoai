/**
 * ProjectOptimizationPanel — compact card with INLINE project setup (PROMPT 4A REVISED v2).
 *
 * CRITICAL DESIGN: No modal. The setup form renders inline within the card.
 * The header AI chat (HybridSearch) stays accessible at all times.
 *
 * AI DRAFT PATTERN:
 *   Only ONE field can be selected at a time. When selected:
 *     1. Field highlights (blue border + faint bg)
 *     2. Pointing finger icon (☞) appears in textarea top-right
 *     3. Field content is pushed to useProjectSetupChatContextStore
 *     4. Header AI chat is focused so user can immediately draft
 *     5. "Paste from chat" button appears below the field
 *   V1: Paste-from-chat uses navigator.clipboard.readText()
 *   TODO V2: Auto-capture AI response via chat stream subscription
 *
 * MILESTONES (dual-checkbox per row):
 *   LEFT: "Set active" checkbox — marks which milestone shows in dashboard (radio behavior)
 *   RIGHT: "Done" checkbox — marks completion
 *
 * setupMode:
 *   'collapsed' — normal view (selector, controls, roadmap, footer)
 *   'creating'  — card expands with blank new-project form
 *   'editing'   — card expands pre-filled with active project data
 *
 * PRESERVED:
 *   - useEmailInboxStore: autoSyncEnabled, toggleAutoSyncForActiveAccounts, refreshInboxSyncBackendState
 *   - useProjectSetupChatContextStore: all draft fields + snippets
 *   - focusHeaderAiChat() dispatch (WRDESK_FOCUS_AI_CHAT_EVENT)
 *   - handleRunAnalysisNow, onAutoToggle callbacks
 *   - autoOptimizationEngine: startAutoOptimization, stopAutoOptimization, triggerSnapshotOptimization
 */

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { ProjectAttachment, ProjectMilestone } from '../../../types/projectTypes'
import type { AnalysisDashboardAutosortSessionMeta } from '../../../types/analysisDashboardSnapshot'
import {
  startAutoOptimization,
  stopAutoOptimization,
  triggerSnapshotOptimization,
} from '../../../lib/autoOptimizationEngine'
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

function getMimeLabel(mimeType: string, filename: string): string {
  if (mimeType.includes('pdf')) return 'PDF'
  if (mimeType.includes('json')) return 'JSON'
  return filename.split('.').pop()?.toUpperCase() ?? 'TXT'
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
    orchestratorSessions,
    setActiveProject,
    setAutoOptimization,
    removeAttachment,
  } = useProjectStore(
    useShallow((s) => ({
      projects:             s.projects,
      activeProjectId:      s.activeProjectId,
      orchestratorSessions: s.orchestratorSessions,
      setActiveProject:     s.setActiveProject,
      setAutoOptimization:  s.setAutoOptimization,
      removeAttachment:     s.removeAttachment,
    })),
  )

  const activeProject = useProjectStore(selectActiveProject)

  // ── Roadmap derived values ─────────────────────────────────────────────────
  const completedCount  = activeProject?.milestones.filter((m) => m.completed).length ?? 0
  const totalCount      = activeProject?.milestones.length ?? 0
  // Active milestone: prefer isActive flag, fall back to first incomplete
  const activeMilestone =
    activeProject?.milestones.find((m) => m.isActive) ??
    activeProject?.milestones.find((m) => !m.completed) ??
    null
  const allDone = totalCount > 0 && completedCount === totalCount

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

  // ── Auto-optimization engine (V1 stub) ────────────────────────────────────
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, autoOptEnabled, autoOptInterval])

  const [runBusy, setRunBusy] = useState(false)

  const handleRunAnalysisNow = useCallback(async () => {
    if (runBusy || !onRefreshOperations) return
    setRunBusy(true)
    try {
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

  // ── Inline setup form state ────────────────────────────────────────────────
  const [setupMode, setSetupMode] = useState<'collapsed' | 'creating' | 'editing'>('collapsed')
  const [formTitle, setFormTitle]                       = useState('')
  const [formDescription, setFormDescription]           = useState('')
  const [formGoals, setFormGoals]                       = useState('')
  const [formMilestones, setFormMilestones]             = useState<ProjectMilestone[]>([])
  const [formAttachments, setFormAttachments]           = useState<ProjectAttachment[]>([])
  const [formLinkedSessionId, setFormLinkedSessionId]   = useState<string | null>(null)
  const [formIntervalMs, setFormIntervalMs]             = useState(300_000)
  const [newMilestoneInput, setNewMilestoneInput]       = useState('')

  // Single selected field — only one field connected to AI chat at a time
  const [selectedField, setSelectedField] = useState<'description' | 'goals' | 'milestones' | null>(null)

  const fileInputRef  = useRef<HTMLInputElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Focus title input when form opens
  useEffect(() => {
    if (setupMode !== 'collapsed') {
      const t = setTimeout(() => titleInputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [setupMode])

  // ── Chat context sync — one field at a time ────────────────────────────────
  useEffect(() => {
    if (setupMode === 'collapsed' || selectedField === null) return

    let text = ''
    if (selectedField === 'description') {
      const content = formDescription.trim()
      text = `[Project Description — draft this]\n${content || '(empty — write a description)'}\n\n`
    } else if (selectedField === 'goals') {
      const content = formGoals.trim()
      text = `[Project Goals — draft this]\n${content || '(empty — suggest goals)'}\n\n`
    } else if (selectedField === 'milestones') {
      const lines = formMilestones.length > 0
        ? formMilestones.map((m) => `${m.completed ? '✓' : '○'} ${m.title}`).join('\n')
        : '(no milestones yet — suggest some)'
      text = `[Milestones — draft this]\n${lines}\n\n`
    }

    const trimmed = text.trim()
    setSetupTextDraft(trimmed)
    setIncludeInChat(trimmed.length > 0)
  }, [
    setupMode, selectedField,
    formDescription, formGoals, formMilestones,
    setSetupTextDraft, setIncludeInChat,
  ])

  // Keep project name draft in sync for AI chat prefix
  useEffect(() => {
    if (setupMode === 'collapsed') return
    setProjectNameDraft(formTitle)
  }, [setupMode, formTitle, setProjectNameDraft])

  // ── Field selection handler ────────────────────────────────────────────────
  const handleFieldSelect = useCallback(
    (field: 'description' | 'goals' | 'milestones') => {
      if (selectedField === field) {
        // Deselect — clear chat context
        setSelectedField(null)
        setSetupTextDraft('')
        setIncludeInChat(false)
      } else {
        setSelectedField(field)
        // Chat context is updated by the effect above on next render
        // Focus AI chat immediately so user can start drafting
        focusHeaderAiChat()
      }
    },
    [selectedField, setSetupTextDraft, setIncludeInChat],
  )

  // ── Paste from chat (V1: clipboard) ───────────────────────────────────────
  const handlePasteFromChat = useCallback(
    async (field: 'description' | 'goals' | 'milestones') => {
      // TODO V2: Auto-capture AI response via chat stream subscription
      try {
        const text = await navigator.clipboard.readText()
        if (!text.trim()) return
        if (field === 'description') {
          setFormDescription(text.trim())
        } else if (field === 'goals') {
          setFormGoals(text.trim())
        } else if (field === 'milestones') {
          // Parse each line as a new milestone; strip list markers
          const newMilestones: ProjectMilestone[] = text
            .split('\n')
            .map((line) => line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '').trim())
            .filter((line) => line.length > 0)
            .map((title) => ({
              id: crypto.randomUUID(),
              title,
              isActive: false,
              completed: false,
              createdAt: new Date().toISOString(),
              completedAt: null,
            }))
          if (newMilestones.length > 0) {
            setFormMilestones((prev) => [...prev, ...newMilestones])
          }
        }
      } catch {
        // Clipboard access denied — silently fail
      }
    },
    [],
  )

  // ── Open / cancel / save ──────────────────────────────────────────────────
  const clearFormChatContext = useCallback(() => {
    setSetupTextDraft('')
    setIncludeInChat(false)
    setSelectedField(null)
  }, [setSetupTextDraft, setIncludeInChat])

  const openCreateMode = useCallback(() => {
    setFormTitle('')
    setFormDescription('')
    setFormGoals('')
    setFormMilestones([])
    setFormAttachments([])
    setFormLinkedSessionId(null)
    setFormIntervalMs(300_000)
    setNewMilestoneInput('')
    setSelectedField(null)
    setSetupMode('creating')
  }, [])

  const openEditMode = useCallback(() => {
    const p = useProjectStore.getState().getActiveProject()
    if (!p) return
    setFormTitle(p.title)
    setFormDescription(p.description)
    setFormGoals(p.goals)
    setFormMilestones(p.milestones.map((m) => ({ ...m })))
    setFormAttachments(p.attachments.map((a) => ({ ...a })))
    setFormLinkedSessionId(p.linkedSessionId)
    setFormIntervalMs(p.autoOptimizationIntervalMs)
    setNewMilestoneInput('')
    setSelectedField(null)
    setSetupMode('editing')
  }, [])

  const handleCancelForm = useCallback(() => {
    clearFormChatContext()
    setSetupMode('collapsed')
  }, [clearFormChatContext])

  const handleSaveForm = useCallback(() => {
    const trimmedTitle = formTitle.trim()
    if (!trimmedTitle) return
    const store = useProjectStore.getState()
    const currentEnabled = store.getActiveProject()?.autoOptimizationEnabled ?? false
    const data = {
      title: trimmedTitle,
      description: formDescription.trim(),
      goals: formGoals.trim(),
      milestones: formMilestones,
      attachments: formAttachments,
      linkedSessionId: formLinkedSessionId,
      autoOptimizationEnabled: currentEnabled,
      autoOptimizationIntervalMs: formIntervalMs,
    }
    if (setupMode === 'editing' && activeProjectId) {
      store.updateProject(activeProjectId, data)
    } else {
      const newId = store.createProject(data)
      store.setActiveProject(newId)
    }
    clearFormChatContext()
    setSetupMode('collapsed')
  }, [
    formTitle, formDescription, formGoals, formMilestones, formAttachments,
    formLinkedSessionId, formIntervalMs, setupMode, activeProjectId,
    clearFormChatContext,
  ])

  // ── Form milestone handlers ────────────────────────────────────────────────
  const handleAddFormMilestone = useCallback(() => {
    const t = newMilestoneInput.trim()
    if (!t) return
    setFormMilestones((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        title: t,
        isActive: false,
        completed: false,
        createdAt: new Date().toISOString(),
        completedAt: null,
      },
    ])
    setNewMilestoneInput('')
  }, [newMilestoneInput])

  const setFormMilestoneActive = useCallback((id: string) => {
    setFormMilestones((prev) => prev.map((m) => ({ ...m, isActive: m.id === id })))
  }, [])

  const toggleFormMilestoneDone = useCallback((id: string) => {
    setFormMilestones((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              completed: !m.completed,
              completedAt: !m.completed ? new Date().toISOString() : null,
            }
          : m,
      ),
    )
  }, [])

  const removeFormMilestone = useCallback((id: string) => {
    setFormMilestones((prev) => prev.filter((m) => m.id !== id))
  }, [])

  // ── Form file upload ───────────────────────────────────────────────────────
  const handleFileSelect = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    for (const file of files) {
      // TODO V2: PDF text extraction via IPC. readAsText works for txt/md/json.
      const content = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = (ev) => resolve((ev.target?.result as string) ?? '')
        reader.readAsText(file)
      })
      setFormAttachments((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          filename: file.name,
          content,
          mimeType: file.type || 'text/plain',
          addedAt: new Date().toISOString(),
        },
      ])
    }
    if (e.target) e.target.value = ''
  }, [])

  // ── Derived display values ─────────────────────────────────────────────────
  const autoDisabled       = accountIds.length === 0
  const hasRefreshHandler  = typeof onRefreshOperations === 'function'
  const runCommandDisabled = runBusy || !hasRefreshHandler
  const isFormOpen         = setupMode !== 'collapsed'

  const lastAnalysisLine =
    latestAutosortSession?.completedAt != null
      ? formatStatusDate(latestAutosortSession.completedAt)
      : latestAutosortSession?.status && latestAutosortSession.status !== 'completed'
        ? `In progress · ${latestAutosortSession.status}`
        : '—'

  const autoOptOn     = autoOptEnabled
  const autoModeLabel = autoOptOn && activeProject
    ? `On · ${formatIntervalLabel(activeProject.autoOptimizationIntervalMs)}`
    : 'Off'

  // Keep focusHeaderAiChat reachable in scope (avoids lint warning)
  void focusHeaderAiChat

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="pop" aria-labelledby="pop-heading">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="pop__head">
        <span id="pop-heading" className="pop__cap-label">PROJECT AI OPTIMIZATION</span>
        {!isFormOpen && (
          <div className="pop__head-btns">
            <button
              type="button"
              className="pop__btn-sm"
              onClick={openCreateMode}
              title="Create a new project"
            >
              + New Project
            </button>
          </div>
        )}
      </div>

      {/* ── Selector + Controls (always visible) ─────────────────────────────*/}
      <div className="pop__selector-group">
        <div className="pop__select-row">
          <select
            className={[
              'pop__compact-select',
              activeProjectId ? 'pop__compact-select--has-value' : '',
              isFormOpen      ? 'pop__compact-select--dimmed'    : '',
            ].filter(Boolean).join(' ')}
            value={activeProjectId ?? ''}
            onChange={(e) => { if (!isFormOpen) setActiveProject(e.target.value || null) }}
            disabled={isFormOpen}
            aria-label="Select active project"
          >
            <option value="">— No project selected —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
          {activeProjectId && !isFormOpen && (
            <button
              type="button"
              className="pop__edit-btn"
              onClick={openEditMode}
              title="Edit this project"
            >
              Edit
            </button>
          )}
        </div>

        <div className="pop__controls-inline">
          <label className="pop__toggle-wrap">
            <button
              type="button"
              role="switch"
              aria-checked={autoOptOn}
              className={`pop__toggle-switch${autoOptOn ? ' pop__toggle-switch--on' : ''}`}
              disabled={!activeProject}
              onClick={() => activeProject && setAutoOptimization(activeProject.id, !autoOptOn)}
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

      {/* ── Inline Setup Form ───────────────────────────────────────────────── */}
      {isFormOpen && (
        <>
          <div className="pop__divider" aria-hidden="true" />

          <div className="pop__setup-form">

            {/* Form header */}
            <div className="pop__form-hdr">
              <span className="pop__form-hdr-title">
                {setupMode === 'creating' ? 'New project' : `Edit: ${formTitle}`}
              </span>
              <button
                type="button"
                className="pop__form-cancel-link"
                onClick={handleCancelForm}
                tabIndex={-1}
              >
                Cancel
              </button>
            </div>

            {/* Title + Session (side by side) */}
            <div className="pop__form-field-row">
              <div className="pop__form-field" style={{ flex: 1, minWidth: 0 }}>
                <label className="pop__form-label" htmlFor="pop-form-title">Title</label>
                <input
                  ref={titleInputRef}
                  id="pop-form-title"
                  className="pop__form-input"
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Project title"
                />
              </div>
              <div className="pop__form-field" style={{ width: 160, flexShrink: 0 }}>
                <label className="pop__form-label" htmlFor="pop-form-session">Session</label>
                <select
                  id="pop-form-session"
                  className="pop__form-select"
                  value={formLinkedSessionId ?? ''}
                  onChange={(e) => setFormLinkedSessionId(e.target.value || null)}
                >
                  <option value="">— No session —</option>
                  {orchestratorSessions.length === 0
                    ? <option value="" disabled>No sessions available</option>
                    : orchestratorSessions.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))
                  }
                </select>
              </div>
            </div>

            {/* ── Description ── */}
            <div className="pop__form-field pop__form-field--mt">
              <div className="pop__form-label-row">
                <span className="pop__form-label">Description</span>
                <button
                  type="button"
                  className={`pop__form-ai-select-btn${selectedField === 'description' ? ' pop__form-ai-select-btn--active' : ''}`}
                  onClick={() => handleFieldSelect('description')}
                >
                  {selectedField === 'description' ? '☞ Connected to AI' : 'Select for AI'}
                </button>
              </div>
              <div className="pop__form-textarea-wrap">
                <textarea
                  className={`pop__form-textarea${selectedField === 'description' ? ' pop__form-textarea--selected' : ''}`}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="What is this project about?"
                  rows={4}
                />
                {selectedField === 'description' && (
                  <span className="pop__form-field-pin" aria-hidden="true">☞</span>
                )}
              </div>
              {selectedField === 'description' && (
                <button
                  type="button"
                  className="pop__form-paste-btn"
                  onClick={() => void handlePasteFromChat('description')}
                  title="Paste the AI chat response into this field"
                >
                  Paste from chat
                </button>
              )}
            </div>

            {/* ── Goals ── */}
            <div className="pop__form-field pop__form-field--mt">
              <div className="pop__form-label-row">
                <span className="pop__form-label">Goals</span>
                <button
                  type="button"
                  className={`pop__form-ai-select-btn${selectedField === 'goals' ? ' pop__form-ai-select-btn--active' : ''}`}
                  onClick={() => handleFieldSelect('goals')}
                >
                  {selectedField === 'goals' ? '☞ Connected to AI' : 'Select for AI'}
                </button>
              </div>
              <div className="pop__form-textarea-wrap">
                <textarea
                  className={`pop__form-textarea${selectedField === 'goals' ? ' pop__form-textarea--selected' : ''}`}
                  value={formGoals}
                  onChange={(e) => setFormGoals(e.target.value)}
                  placeholder="What do you want to achieve?"
                  rows={4}
                />
                {selectedField === 'goals' && (
                  <span className="pop__form-field-pin" aria-hidden="true">☞</span>
                )}
              </div>
              {selectedField === 'goals' && (
                <button
                  type="button"
                  className="pop__form-paste-btn"
                  onClick={() => void handlePasteFromChat('goals')}
                  title="Paste the AI chat response into this field"
                >
                  Paste from chat
                </button>
              )}
            </div>

            {/* ── Milestones ── */}
            <div className="pop__form-field pop__form-field--mt">
              <div className="pop__form-label-row">
                <span className="pop__form-label">Milestones</span>
                <button
                  type="button"
                  className={`pop__form-ai-select-btn${selectedField === 'milestones' ? ' pop__form-ai-select-btn--active' : ''}`}
                  onClick={() => handleFieldSelect('milestones')}
                >
                  {selectedField === 'milestones' ? '☞ Connected to AI' : 'Select for AI'}
                </button>
              </div>

              {formMilestones.length > 0 && (
                <div className={`pop__form-milestones-wrap${selectedField === 'milestones' ? ' pop__form-milestones-wrap--selected' : ''}`}>
                  {formMilestones.map((m) => (
                    <div key={m.id} className="pop__form-ms-row">

                      {/* Left: Set-active checkbox + title */}
                      <div className="pop__form-ms-left">
                        <div className="pop__form-ms-active-wrap">
                          <button
                            type="button"
                            className={`pop__form-ms-active-check${m.isActive ? ' pop__form-ms-active-check--active' : ''}`}
                            onClick={() => setFormMilestoneActive(m.id)}
                            aria-label={m.isActive ? 'Active milestone' : 'Set as active milestone'}
                            title="Mark as the current active milestone shown in dashboard"
                          />
                          {m.isActive && (
                            <span className="pop__form-ms-active-label">Active</span>
                          )}
                        </div>
                        <span className={`pop__form-ms-title${m.completed ? ' pop__form-ms-title--done' : ''}`}>
                          {m.title}
                        </span>
                      </div>

                      {/* Right: Done checkbox + remove */}
                      <div className="pop__form-ms-right">
                        <div className="pop__form-ms-done-wrap">
                          <button
                            type="button"
                            className={`pop__form-ms-done-check${m.completed ? ' pop__form-ms-done-check--done' : ''}`}
                            onClick={() => toggleFormMilestoneDone(m.id)}
                            aria-label={m.completed ? 'Mark incomplete' : 'Mark done'}
                          />
                          <span className={`pop__form-ms-done-label${m.completed ? ' pop__form-ms-done-label--done' : ' pop__form-ms-done-label--pending'}`}>
                            Done
                          </span>
                        </div>
                        <button
                          type="button"
                          className="pop__form-ms-del"
                          onClick={() => removeFormMilestone(m.id)}
                          aria-label={`Remove milestone: ${m.title}`}
                        >
                          ×
                        </button>
                      </div>

                    </div>
                  ))}
                </div>
              )}

              {/* Add milestone input */}
              <div className="pop__form-ms-add-row">
                <input
                  className="pop__form-input pop__form-ms-input"
                  type="text"
                  value={newMilestoneInput}
                  onChange={(e) => setNewMilestoneInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleAddFormMilestone() }
                  }}
                  placeholder="Add a milestone…"
                />
                <button
                  type="button"
                  className="pop__form-ms-add-btn"
                  onClick={handleAddFormMilestone}
                >
                  Add
                </button>
              </div>

              {selectedField === 'milestones' && (
                <button
                  type="button"
                  className="pop__form-paste-btn"
                  onClick={() => void handlePasteFromChat('milestones')}
                  title="Paste AI-suggested milestones — each line becomes a milestone"
                >
                  Paste from chat
                </button>
              )}
            </div>

            {/* ── Context Attachments ── */}
            <div className="pop__form-field pop__form-field--mt">
              <div className="pop__form-label-row">
                <span className="pop__form-label">Context attachments</span>
              </div>
              <p className="pop__form-sub-label">Embedded as LLM context when project is active</p>
              {formAttachments.length > 0 && (
                <div className="pop__form-attachments">
                  {formAttachments.map((att) => (
                    <div key={att.id} className="pop__form-att-row">
                      <span className="pop__form-att-name">{att.filename}</span>
                      <span className="pop__form-att-type">
                        {getMimeLabel(att.mimeType, att.filename)}
                      </span>
                      <button
                        type="button"
                        className="pop__form-ms-del"
                        onClick={() =>
                          setFormAttachments((prev) => prev.filter((a) => a.id !== att.id))
                        }
                        aria-label={`Remove ${att.filename}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="pop__form-upload-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                Add file…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,.json"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => void handleFileSelect(e)}
              />
            </div>

            {/* ── Auto-Optimization interval ── */}
            <div className="pop__form-field pop__form-field--mt">
              <label className="pop__form-label" htmlFor="pop-form-interval">
                Optimization interval
              </label>
              <div className="pop__form-interval-row">
                <select
                  id="pop-form-interval"
                  className="pop__form-select pop__form-select--sm"
                  value={formIntervalMs}
                  onChange={(e) => setFormIntervalMs(Number(e.target.value))}
                >
                  {AUTO_OPTIMIZATION_INTERVALS.map((i) => (
                    <option key={i.value} value={i.value}>{i.label}</option>
                  ))}
                </select>
                <span className="pop__form-interval-hint">when auto-optimization is enabled</span>
              </div>
            </div>

            {/* ── Save / Cancel ── */}
            <div className="pop__form-footer">
              <button
                type="button"
                className="pop__form-footer-cancel"
                onClick={handleCancelForm}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pop__form-footer-save"
                disabled={!formTitle.trim()}
                onClick={handleSaveForm}
              >
                Save project
              </button>
            </div>

          </div>
        </>
      )}

      {/* ── Divider ─────────────────────────────────────────────────────────── */}
      <div className="pop__divider" aria-hidden="true" />

      {/* ── Roadmap area (always visible, pushed down when form is open) ──────── */}
      {activeProject ? (
        <div className="pop__roadmap-area">
          {totalCount === 0 ? (
            <p className="pop__roadmap-none">No milestones set</p>
          ) : allDone ? (
            <p className="pop__roadmap-done">All milestones complete ✓</p>
          ) : (
            <div>
              <p className="pop__roadmap-current">
                Current: {activeMilestone?.title ?? '—'}
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

      {/* ── Status footer (3 compact rows) ──────────────────────────────────── */}
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

      {/* ── Attachments (hidden — preserves removeAttachment store reference) ── */}
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

      {/* ── Mail sync (hidden — preserves onAutoToggle + store bindings) ──────── */}
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

    </section>
  )
}
