/**
 * ProjectOptimizationPanel — compact card with INLINE project setup (PROMPT 4C).
 *
 * CRITICAL DESIGN: No modal. The setup form renders inline within the card.
 * The header AI chat (HybridSearch) stays accessible at all times.
 *
 * AI DRAFT PATTERN (updated in 4C):
 *   Only ONE field can be selected at a time. When selected:
 *     1. Field highlights (blue border + faint bg)
 *     2. Pointing finger icon (☞) appears in textarea top-right
 *     3. Full pre-role prompt + project context pushed to useProjectSetupChatContextStore
 *     4. Header AI chat is focused so user can immediately draft
 *   When AI responds in HybridSearch, a "Use in {field}" button appears.
 *   Clicking "Use" dispatches 'wrdesk:use-ai-draft' → panel listens → inserts text.
 *   No clipboard-paste required (Paste-from-chat buttons removed in 4C).
 *
 * MILESTONES (4C — card design):
 *   Each milestone is a card with an editable multi-line textarea.
 *   Active toggle (text button, blue when active, radio behavior).
 *   Done toggle (text button, green when done).
 *   "Quick edit with AI →" footer button sets quickEditMilestoneId so
 *   the "Use" button replaces that specific milestone's text.
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
import { BeapDocumentReaderModal } from '@ext/beap-builder/components/BeapDocumentReaderModal'
import { AttachmentStatusBadge } from '@ext/beap-builder/components/AttachmentStatusBadge'
import type { AttachmentParseStatus } from '@ext/beap-builder/components/AttachmentStatusBadge'
import { ComposerAttachmentButton } from '../../ComposerAttachmentButton'
import { extractTextForPackagePreview } from '../../../lib/beapPackageAttachmentPreview'
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

  // Document reader modal (reuses BeapDocumentReaderModal)
  const [readerOpen, setReaderOpen]         = useState(false)
  const [readerFilename, setReaderFilename] = useState('')
  const [readerText, setReaderText]         = useState('')

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

  // ── Chat context sync — full pre-role prompts per field ──────────────────
  useEffect(() => {
    if (setupMode === 'collapsed' || selectedField === null) {
      setSetupTextDraft('')
      setIncludeInChat(false)
      return
    }

    // Gather all available project context
    const projectContext = [
      formTitle ? `Project: "${formTitle}"` : null,
      formDescription ? `Current description: ${formDescription}` : null,
      formGoals ? `Current goals: ${formGoals}` : null,
      formMilestones.length > 0
        ? `Current milestones:\n${formMilestones.map((m) => `- ${m.title}`).join('\n')}`
        : null,
      formAttachments.length > 0
        ? `Attached context:\n${formAttachments.map((a) => `[${a.filename}]\n${a.content.slice(0, 2000)}`).join('\n---\n')}`
        : null,
    ].filter(Boolean).join('\n\n')

    // Field-specific pre-role (invisible to user — prepended via chat store)
    const preRoles: Record<string, string> = {
      description: [
        '[ROLE: You are helping the user write a project description.',
        'Generate a clear, concise project description based on the project context below.',
        'The description should explain what the project is about, its scope, and its purpose.',
        'Write in a professional tone. Output ONLY the description text, no headers or labels.]',
      ].join(' '),
      goals: [
        '[ROLE: You are helping the user define project goals.',
        'Based on the project context below, generate specific, measurable, achievable goals.',
        'Each goal should be actionable and clearly defined.',
        'Write in a professional tone. Output ONLY the goals text, no headers or labels.]',
      ].join(' '),
      milestones: [
        '[ROLE: You are helping the user define project milestones.',
        'Based on the project context below, suggest concrete milestones that mark',
        'key progress points toward the project goals.',
        'Output each milestone on a separate line, starting with "- ".',
        'Each milestone should be a clear deliverable or checkpoint.',
        'Keep each milestone title concise but descriptive (1-2 sentences max).]',
      ].join(' '),
    }

    const setupText = `${preRoles[selectedField]}\n\n${projectContext}`
    setSetupTextDraft(setupText)
    setIncludeInChat(true)
  }, [
    setupMode, selectedField,
    formTitle, formDescription, formGoals, formMilestones, formAttachments,
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

  // ── Refs so event handlers always see latest state ────────────────────────
  const selectedFieldRef = useRef<'description' | 'goals' | 'milestones' | null>(null)
  useEffect(() => { selectedFieldRef.current = selectedField }, [selectedField])

  // Track which milestone triggered "Quick edit with AI" (so "Use" replaces it)
  const [quickEditMilestoneId, setQuickEditMilestoneId] = useState<string | null>(null)
  const quickEditMilestoneIdRef = useRef<string | null>(null)
  useEffect(() => { quickEditMilestoneIdRef.current = quickEditMilestoneId }, [quickEditMilestoneId])

  // ── "Use in {field}" event from HybridSearch chat panel ───────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const { text } = (e as CustomEvent<{ text: string }>).detail
      if (!text?.trim()) return
      const field = selectedFieldRef.current
      if (field === 'description') {
        setFormDescription(text.trim())
      } else if (field === 'goals') {
        setFormGoals(text.trim())
      } else if (field === 'milestones') {
        const qmId = quickEditMilestoneIdRef.current
        if (qmId) {
          // Replace specific milestone (from "Quick edit with AI →")
          setFormMilestones((prev) => prev.map((m) => m.id === qmId ? { ...m, title: text.trim() } : m))
          setQuickEditMilestoneId(null)
        } else {
          // Append parsed lines as new milestones
          const newMs: ProjectMilestone[] = text
            .split('\n')
            .map((line) => line.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
            .filter((line) => line.length > 0)
            .map((title) => ({
              id: crypto.randomUUID(),
              title,
              isActive: false,
              completed: false,
              createdAt: new Date().toISOString(),
              completedAt: null,
            }))
          if (newMs.length > 0) setFormMilestones((prev) => [...prev, ...newMs])
        }
      }
    }
    window.addEventListener('wrdesk:use-ai-draft', handler)
    return () => window.removeEventListener('wrdesk:use-ai-draft', handler)
  }, [])

  // ── Quick-edit a specific milestone from inside the card ──────────────────
  const handleQuickEditMilestone = useCallback((milestoneId: string) => {
    setQuickEditMilestoneId(milestoneId)
    setSelectedField('milestones')
    focusHeaderAiChat()
  }, [])

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

  const updateFormMilestoneTitle = useCallback((id: string, title: string) => {
    setFormMilestones((prev) => prev.map((m) => m.id === id ? { ...m, title } : m))
  }, [])

  // ── Auto-grow textarea helper ──────────────────────────────────────────────
  const autoGrow = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  // ── Form file upload — uses the same BEAP parsing utility (IPC PDF extract) ─
  const handleFileSelect = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    for (const file of files) {
      const mimeType = file.type || 'text/plain'
      const id = crypto.randomUUID()
      const isPdf = mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

      // Insert attachment immediately with pending status for PDFs
      setFormAttachments((prev) => [
        ...prev,
        {
          id,
          filename: file.name,
          content: '',
          mimeType,
          addedAt: new Date().toISOString(),
          parseStatus: isPdf ? ('pending' as AttachmentParseStatus) : undefined,
        },
      ])

      // Convert File to base64 then call the shared BEAP parsing utility
      const buffer = await file.arrayBuffer()
      const bytes  = new Uint8Array(buffer)
      let binary   = ''
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
      const b64 = btoa(binary)

      const extracted = await extractTextForPackagePreview({ name: file.name, mimeType, base64: b64 })

      setFormAttachments((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                content:     extracted.text || '',
                parseStatus: (extracted.text ? 'success' : 'failed') as AttachmentParseStatus,
              }
            : a,
        ),
      )
    }
    if (e.target) e.target.value = ''
  }, [])

  // ── Attachment text reader ─────────────────────────────────────────────────
  const openAttachmentReader = useCallback((att: { filename: string; content: string }) => {
    setReaderFilename(att.filename)
    setReaderText(att.content)
    setReaderOpen(true)
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

          {/* BEAP-composer style form — mirrors BeapInlineComposer light theme */}
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 20, background: '#f8fafc' }}>

            {/* Form header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                {setupMode === 'creating' ? 'New project' : `Edit: ${formTitle}`}
              </span>
              <button
                type="button"
                onClick={handleCancelForm}
                tabIndex={-1}
                style={{ fontSize: 12, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
              >
                Cancel
              </button>
            </div>

            {/* Title */}
            <div>
              <label
                htmlFor="pop-form-title"
                style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6, letterSpacing: '0.5px' }}
              >
                Title
              </label>
              <input
                ref={titleInputRef}
                id="pop-form-title"
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Project title"
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1', fontSize: 13, outline: 'none' }}
                onFocus={(e) => { e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.4)' }}
                onBlur={(e) => { e.currentTarget.style.boxShadow = 'none' }}
              />
            </div>

            {/* Session (optional) */}
            <div>
              <label
                htmlFor="pop-form-session"
                style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6, letterSpacing: '0.5px' }}
              >
                Session (optional)
              </label>
              <select
                id="pop-form-session"
                value={formLinkedSessionId ?? ''}
                onChange={(e) => setFormLinkedSessionId(e.target.value || null)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1', fontSize: 13, outline: 'none' }}
                onFocus={(e) => { e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.4)' }}
                onBlur={(e) => { e.currentTarget.style.boxShadow = 'none' }}
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

            {/* Description */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>
                  Description
                </span>
                <button
                  type="button"
                  onClick={() => handleFieldSelect('description')}
                  style={{
                    flexShrink: 0,
                    background: selectedField === 'description' ? '#7c3aed' : '#ffffff',
                    color:      selectedField === 'description' ? '#ffffff' : '#374151',
                    border:     selectedField === 'description' ? '1px solid #7c3aed' : '1px solid #d1d5db',
                    borderRadius: 4, padding: '4px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {selectedField === 'description' ? '☞ AI connected' : 'Select for AI'}
                </button>
              </div>
              <div className="pop__form-textarea-wrap">
                <textarea
                  value={formDescription}
                  onChange={(e) => { setFormDescription(e.target.value); autoGrow(e.target) }}
                  onInput={(e) => autoGrow(e.target as HTMLTextAreaElement)}
                  placeholder="What is this project about?"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 8,
                    border: selectedField === 'description' ? '2px solid #7c3aed' : '1px solid #cbd5e1',
                    outline: 'none', background: '#ffffff', color: '#0f172a', fontSize: 13,
                    lineHeight: 1.5, resize: 'none', overflow: 'hidden', display: 'block', minHeight: 80,
                  }}
                  onFocus={(e) => { if (selectedField !== 'description') e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.4)' }}
                  onBlur={(e) => { e.currentTarget.style.boxShadow = 'none' }}
                />
                {selectedField === 'description' && (
                  <span className="pop__form-field-pin" aria-hidden="true">☞</span>
                )}
              </div>
            </div>

            {/* Goals */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>
                  Goals
                </span>
                <button
                  type="button"
                  onClick={() => handleFieldSelect('goals')}
                  style={{
                    flexShrink: 0,
                    background: selectedField === 'goals' ? '#7c3aed' : '#ffffff',
                    color:      selectedField === 'goals' ? '#ffffff' : '#374151',
                    border:     selectedField === 'goals' ? '1px solid #7c3aed' : '1px solid #d1d5db',
                    borderRadius: 4, padding: '4px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {selectedField === 'goals' ? '☞ AI connected' : 'Select for AI'}
                </button>
              </div>
              <div className="pop__form-textarea-wrap">
                <textarea
                  value={formGoals}
                  onChange={(e) => { setFormGoals(e.target.value); autoGrow(e.target) }}
                  onInput={(e) => autoGrow(e.target as HTMLTextAreaElement)}
                  placeholder="What do you want to achieve?"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 8,
                    border: selectedField === 'goals' ? '2px solid #7c3aed' : '1px solid #cbd5e1',
                    outline: 'none', background: '#ffffff', color: '#0f172a', fontSize: 13,
                    lineHeight: 1.5, resize: 'none', overflow: 'hidden', display: 'block', minHeight: 80,
                  }}
                  onFocus={(e) => { if (selectedField !== 'goals') e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.4)' }}
                  onBlur={(e) => { e.currentTarget.style.boxShadow = 'none' }}
                />
                {selectedField === 'goals' && (
                  <span className="pop__form-field-pin" aria-hidden="true">☞</span>
                )}
              </div>
            </div>

            {/* Milestones */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>
                  Milestones
                </span>
                <button
                  type="button"
                  onClick={() => handleFieldSelect('milestones')}
                  style={{
                    flexShrink: 0,
                    background: selectedField === 'milestones' ? '#7c3aed' : '#ffffff',
                    color:      selectedField === 'milestones' ? '#ffffff' : '#374151',
                    border:     selectedField === 'milestones' ? '1px solid #7c3aed' : '1px solid #d1d5db',
                    borderRadius: 4, padding: '4px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {selectedField === 'milestones' ? '☞ AI connected' : 'Select for AI'}
                </button>
              </div>

              {formMilestones.length > 0 && (
                <ul style={{ margin: '0 0 8px', padding: 0, listStyle: 'none' }}>
                  {formMilestones.map((m) => (
                    <li
                      key={m.id}
                      className={`pop__form-ms-card${m.isActive ? ' pop__form-ms-card--active' : ''}`}
                    >
                      <div className="pop__form-ms-card-header">
                        <button
                          type="button"
                          className={`pop__form-ms-active-toggle${m.isActive ? ' pop__form-ms-active-toggle--active' : ''}`}
                          onClick={() => setFormMilestoneActive(m.id)}
                          title="Mark as the active milestone shown in the dashboard"
                        >
                          {m.isActive ? '● Active' : '○ Set active'}
                        </button>
                        <div className="pop__form-ms-card-right">
                          <button
                            type="button"
                            className={`pop__form-ms-done-toggle${m.completed ? ' pop__form-ms-done-toggle--done' : ''}`}
                            onClick={() => toggleFormMilestoneDone(m.id)}
                            title={m.completed ? 'Mark incomplete' : 'Mark done'}
                          >
                            {m.completed ? '✓ Done' : 'Done'}
                          </button>
                          <button
                            type="button"
                            className="pop__form-ms-del"
                            onClick={() => removeFormMilestone(m.id)}
                            aria-label="Remove milestone"
                            title="Remove milestone"
                          >
                            ×
                          </button>
                        </div>
                      </div>

                      <textarea
                        className={`pop__form-ms-card-body${m.completed ? ' pop__form-ms-card-body--done' : ''}`}
                        value={m.title}
                        onChange={(e) => { updateFormMilestoneTitle(m.id, e.target.value); autoGrow(e.target) }}
                        onInput={(e) => autoGrow(e.target as HTMLTextAreaElement)}
                        placeholder="Describe this milestone…"
                      />

                      <div className="pop__form-ms-card-footer">
                        <button
                          type="button"
                          className="pop__form-ms-quick-edit"
                          onClick={() => handleQuickEditMilestone(m.id)}
                          title="Select this milestone for AI editing"
                        >
                          Quick edit with AI →
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="pop__form-ms-add-area">
                <textarea
                  className="pop__form-ms-add-textarea"
                  value={newMilestoneInput}
                  onChange={(e) => { setNewMilestoneInput(e.target.value); autoGrow(e.target) }}
                  onInput={(e) => autoGrow(e.target as HTMLTextAreaElement)}
                  placeholder="Describe a new milestone…"
                />
                <div className="pop__form-ms-add-actions">
                  <button type="button" className="pop__form-ms-add-btn" onClick={handleAddFormMilestone}>
                    Add milestone
                  </button>
                </div>
              </div>
            </div>

            {/* Attachments — identical to BEAP composer attachment section */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.5px' }}>
                Attachments
              </div>
              <ComposerAttachmentButton
                label="Add attachments"
                onClick={() => fileInputRef.current?.click()}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,.json,.csv"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => void handleFileSelect(e)}
              />
              {formAttachments.length > 0 && (
                <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none' }}>
                  {formAttachments.map((att) => (
                    <li
                      key={att.id}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 6,
                        padding: '8px 10px', marginBottom: 6,
                        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
                        fontSize: 12, color: '#0f172a',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {att.filename}
                          </span>
                          {att.parseStatus != null && (
                            <AttachmentStatusBadge status={att.parseStatus} />
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          {att.content?.trim() ? (
                            <button
                              type="button"
                              onClick={() => openAttachmentReader(att)}
                              style={{
                                fontSize: 11, fontWeight: 600, padding: '4px 8px',
                                borderRadius: 6, border: '1px solid #4f46e5',
                                background: '#ffffff', color: '#1e1b4b', cursor: 'pointer',
                              }}
                            >
                              View text
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setFormAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                            style={{ cursor: 'pointer', color: '#b91c1c', background: 'none', border: 'none', fontWeight: 600 }}
                            aria-label={`Remove ${att.filename}`}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      {att.parseStatus === 'failed' && (
                        <div style={{ fontSize: 11, color: '#b45309', lineHeight: 1.4 }}>
                          Could not extract text from this file. It may be scanned/image-based.
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Optimization interval */}
            <div>
              <label
                htmlFor="pop-form-interval"
                style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6, letterSpacing: '0.5px' }}
              >
                Optimization interval
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <select
                  id="pop-form-interval"
                  value={formIntervalMs}
                  onChange={(e) => setFormIntervalMs(Number(e.target.value))}
                  style={{ width: 110, boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1', fontSize: 13, outline: 'none' }}
                  onFocus={(e) => { e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.4)' }}
                  onBlur={(e) => { e.currentTarget.style.boxShadow = 'none' }}
                >
                  {AUTO_OPTIMIZATION_INTERVALS.map((i) => (
                    <option key={i.value} value={i.value}>{i.label}</option>
                  ))}
                </select>
                <span style={{ fontSize: 12, color: '#64748b' }}>when auto-optimization is enabled</span>
              </div>
            </div>

            {/* Save / Cancel footer — mirrors BEAP composer button row */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
              <button
                type="button"
                onClick={handleCancelForm}
                style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#ffffff', color: '#374151', cursor: 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!formTitle.trim()}
                onClick={handleSaveForm}
                style={{
                  padding: '12px 20px', borderRadius: 8, border: 'none',
                  background: formTitle.trim() ? '#7c3aed' : '#a78bfa',
                  color: '#ffffff', fontWeight: 700,
                  cursor: formTitle.trim() ? 'pointer' : 'not-allowed', fontSize: 13,
                }}
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
            <div className="pop__roadmap-none">No milestones defined — edit project to add milestones</div>
          ) : allDone ? (
            <div className="pop__roadmap-done">✓ All {totalCount} milestones complete</div>
          ) : activeMilestone ? (
            <>
              <div className="pop__roadmap-header">
                <span className="pop__roadmap-active-dot">●</span>
                <span className="pop__roadmap-active-label">Active milestone</span>
                <span className="pop__roadmap-progress-count">{completedCount}/{totalCount} complete</span>
              </div>
              <div className="pop__roadmap-content">
                {activeMilestone.title}
              </div>
              <button
                type="button"
                className="pop__roadmap-quick-edit"
                onClick={() => {
                  if (setupMode === 'collapsed') {
                    openEditMode()
                    setTimeout(() => {
                      setSelectedField('milestones')
                      focusHeaderAiChat()
                    }, 60)
                  } else {
                    setSelectedField('milestones')
                    focusHeaderAiChat()
                  }
                }}
                title="Open editor and select milestone field for AI editing"
              >
                Quick edit with AI →
              </button>
            </>
          ) : null}
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

      {/* Document reader modal — reuses BEAP composer's BeapDocumentReaderModal */}
      <BeapDocumentReaderModal
        open={readerOpen}
        onClose={() => setReaderOpen(false)}
        filename={readerFilename}
        semanticContent={readerText}
        theme="standard"
      />

    </section>
  )
}
