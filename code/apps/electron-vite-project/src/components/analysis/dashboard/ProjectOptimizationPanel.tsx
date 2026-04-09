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
 *   Clicking "Use" calls window.__wrdeskInsertDraft (set when field is selected) → inserts text.
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
 *   - handleRunAnalysisNow (snapshot optimization only — stays on Analysis), onAutoToggle callbacks
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
  applyOptimizationGuardFallback,
  canRunOptimization,
} from '../../../lib/autoOptimizationGuards'
import {
  startAutoOptimization,
  stopAutoOptimization,
  triggerSnapshotOptimization,
} from '../../../lib/autoOptimizationEngine'
import { refreshOrchestratorSessionsFromBridge } from '../../../lib/refreshOrchestratorSessions'
import { BeapDocumentReaderModal } from '@ext/beap-builder/components/BeapDocumentReaderModal'
import { AttachmentStatusBadge } from '@ext/beap-builder/components/AttachmentStatusBadge'
import type { AttachmentParseStatus } from '@ext/beap-builder/components/AttachmentStatusBadge'
import { ComposerAttachmentButton } from '../../ComposerAttachmentButton'
import { extractTextForPackagePreview } from '../../../lib/beapPackageAttachmentPreview'
import { StatusToggle } from './StatusToggle'
import '../../../styles/dashboard-tokens.css'
import '../../../styles/dashboard-base.css'
import './ProjectOptimizationPanel.css'

/** Preset icons for project allocation (emoji strings). */
const PROJECT_ICON_CHOICES = [
  '🎯', '📊', '🚀', '⚡', '🔧', '💡', '📈', '🏗️', '🧪', '🔍',
  '📋', '🛠️', '🎨', '📦', '🌐', '💻', '🔒', '📝', '⭐', '🏆',
] as const

// ── Global draft-insertion callback ───────────────────────────────────────────
// Set fresh every time the user selects a field or a specific milestone.
// HybridSearch calls this directly instead of dispatching a DOM event, so
// there is no stale-closure / ref-timing issue.
declare global {
  interface Window {
    __wrdeskInsertDraft?: (text: string, mode: 'append' | 'replace') => void
  }
}

/** Flash the element that has `data-field="<dataField>"` after insertion */
function flashFieldEl(dataField: string) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-field="${dataField}"]`) as HTMLElement | null
    if (!el) return
    el.style.height = 'auto'
    if (el instanceof HTMLTextAreaElement) el.style.height = el.scrollHeight + 'px'
    el.classList.add('project-field--just-inserted')
    setTimeout(() => el.classList.remove('project-field--just-inserted'), 650)
  })
}

/** Flash the milestone textarea that has `data-milestone-id="<id>"` */
function flashMilestoneEl(milestoneId: string) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-milestone-id="${milestoneId}"]`) as HTMLElement | null
    if (!el) return
    el.style.height = 'auto'
    if (el instanceof HTMLTextAreaElement) el.style.height = el.scrollHeight + 'px'
    el.classList.add('project-field--just-inserted')
    setTimeout(() => el.classList.remove('project-field--just-inserted'), 650)
  })
}

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
  /** Called whenever the form opens or closes (editing ↔ collapsed). */
  onSetupModeChange?: (editing: boolean) => void
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
  onRefreshOperations: _onRefreshOperations,
  onOpenBulkInboxForAnalysis: _onOpenBulkInboxForAnalysis,
  onSetupModeChange,
}: ProjectOptimizationPanelProps) {
  // ── Project store ──────────────────────────────────────────────────────────
  const {
    projects,
    activeProjectId,
    orchestratorSessions,
    setActiveProject,
    setAutoOptimization,
    setProjectIcon,
    removeAttachment,
  } = useProjectStore(
    useShallow((s) => ({
      projects:             s.projects,
      activeProjectId:      s.activeProjectId,
      orchestratorSessions: s.orchestratorSessions,
      setActiveProject:     s.setActiveProject,
      setAutoOptimization:  s.setAutoOptimization,
      setProjectIcon:       s.setProjectIcon,
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
  const linkedSessionIdsKey = activeProject?.linkedSessionIds?.join('\u0001') ?? ''

  useEffect(() => {
    const project = useProjectStore.getState().getActiveProject()
    if (project?.autoOptimizationEnabled) {
      startAutoOptimization(project)
    } else {
      stopAutoOptimization()
    }
    return () => stopAutoOptimization()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, autoOptEnabled, autoOptInterval, linkedSessionIdsKey])

  const [runBusy, setRunBusy] = useState(false)

  const handleOpenLinkedSessionDisplayGrids = useCallback(async () => {
    const p = useProjectStore.getState().getActiveProject()
    const sessionKey = p?.linkedSessionIds?.[0]?.trim()
    if (!sessionKey) {
      console.log('[AutoOpt] No linked session, cannot open display grids')
      return
    }
    try {
      const { openSessionDisplayGridsFromDashboard } = await import('../../../lib/openSessionDisplayGridsFromDashboard')
      const r = await openSessionDisplayGridsFromDashboard(sessionKey, 'dashboard-session-icon')
      if (!r.ok) console.warn('[SessionGrids]', r.message)
    } catch (e) {
      console.warn('[SessionGrids] open failed:', e instanceof Error ? e.message : e)
    }
  }, [])

  const handleRunAnalysisNow = useCallback(async () => {
    if (runBusy) return
    setRunBusy(true)
    try {
      const guard = canRunOptimization('dashboard_snapshot')
      if (!guard.ok) {
        applyOptimizationGuardFallback(guard.fallback, guard.message)
        return
      }
      const project = useProjectStore.getState().getActiveProject()
      if (!project) return
      triggerSnapshotOptimization(project, 'dashboard_snapshot')
    } finally {
      setRunBusy(false)
    }
  }, [runBusy])

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
  const [formLinkedSessionIds, setFormLinkedSessionIds]   = useState<string[]>([])
  const [formIntervalMs, setFormIntervalMs]             = useState(300_000)
  /** Emoji or empty — persisted with project; edits can sync via setProjectIcon immediately. */
  const [formIcon, setFormIcon]                         = useState('')
  const [newMilestoneInput, setNewMilestoneInput]       = useState('')

  // Document reader modal (reuses BeapDocumentReaderModal)
  const [readerOpen, setReaderOpen]         = useState(false)
  const [readerFilename, setReaderFilename] = useState('')
  const [readerText, setReaderText]         = useState('')

  // Single selected field — only one field connected to AI chat at a time
  const [selectedField, setSelectedField] = useState<'title' | 'description' | 'goals' | 'milestones' | null>(null)
  const selectedFieldRef = useRef<'title' | 'description' | 'goals' | 'milestones' | null>(null)
  const [quickEditMilestoneId, setQuickEditMilestoneId] = useState<string | null>(null)
  const quickEditMilestoneIdRef = useRef<string | null>(null)

  const fileInputRef  = useRef<HTMLInputElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refreshOrchestratorSessionsFromBridge()
  }, [])

  /** Main broadcasts `orchestrator-session-display-updated` when POST /api/orchestrator/set writes a session_* key (e.g. extension rename). */
  useEffect(() => {
    const onOrchestratorSession = () => void refreshOrchestratorSessionsFromBridge()
    window.addEventListener('orchestrator-session-display-updated', onOrchestratorSession)
    return () => window.removeEventListener('orchestrator-session-display-updated', onOrchestratorSession)
  }, [])

  useEffect(() => {
    if (setupMode === 'collapsed') return
    void refreshOrchestratorSessionsFromBridge()
  }, [setupMode])

  const setFormLinkedSessionSingle = useCallback((id: string | null) => {
    setFormLinkedSessionIds(id ? [id] : [])
  }, [])

  // Notify parent when editing state changes (for sticky/stretch layout toggle)
  useEffect(() => {
    onSetupModeChange?.(setupMode !== 'collapsed')
  }, [setupMode, onSetupModeChange])

  // Focus title input when form opens
  useEffect(() => {
    if (setupMode !== 'collapsed') {
      const t = setTimeout(() => titleInputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [setupMode])

  // ── Chat context sync — content-only, no instruction headers ─────────────
  // setupTextDraft stores a lightweight tag + raw field content.
  // Format: "[field:<name>]\n<content>"
  // HybridSearch strips the tag, wraps content in triple-quotes, and appends
  // the user's message — keeping ALL instruction framing OUT of the user query.
  useEffect(() => {
    if (setupMode === 'collapsed' || selectedField === null) {
      setSetupTextDraft('')
      setIncludeInChat(false)
      return
    }

    // Wipe stale legacy draft fields to prevent cross-field contamination
    const store = useProjectSetupChatContextStore.getState()
    store.setGoalsDraft('')
    store.setMilestonesDraft('')
    store.clearSnippets()

    if (selectedField === 'title') {
      setSetupTextDraft(`[field:title]\n${formTitle || ''}`)
      setIncludeInChat(true)
      return
    }

    // Specific milestone edit — just the raw milestone text
    if (selectedField === 'milestones' && quickEditMilestoneId) {
      const milestone = formMilestones.find((m) => m.id === quickEditMilestoneId)
      setSetupTextDraft(`[field:milestone]\n${milestone?.title ?? ''}`)
      setIncludeInChat(true)
      return
    }

    if (selectedField === 'description') {
      const content = [
        formTitle       ? `Project: "${formTitle}"` : null,
        formDescription ? `Current description:\n${formDescription}` : 'Current description: (none yet)',
      ].filter(Boolean).join('\n\n')
      setSetupTextDraft(`[field:description]\n${content}`)
      setIncludeInChat(true)
      return
    }

    if (selectedField === 'goals') {
      const content = [
        formTitle       ? `Project: "${formTitle}"` : null,
        formDescription ? `Description: ${formDescription}` : null,
        formGoals       ? `Current goals:\n${formGoals}` : 'Current goals: (none yet)',
      ].filter(Boolean).join('\n\n')
      setSetupTextDraft(`[field:goals]\n${content}`)
      setIncludeInChat(true)
      return
    }

    // milestones — general (new milestone suggestions)
    const milestoneList = formMilestones.length > 0
      ? formMilestones.map((m) => `${m.isActive ? '● ' : '○ '}${m.completed ? '[DONE] ' : ''}${m.title}`).join('\n')
      : '(none yet)'
    const content = [
      formTitle  ? `Project: "${formTitle}"` : null,
      formGoals  ? `Goals:\n${formGoals}` : null,
      `Current milestones:\n${milestoneList}`,
    ].filter(Boolean).join('\n\n')
    setSetupTextDraft(`[field:milestones]\n${content}`)
    setIncludeInChat(true)
  }, [
    setupMode, selectedField, quickEditMilestoneId,
    formTitle, formDescription, formGoals, formMilestones,
    setSetupTextDraft, setIncludeInChat,
  ])

  // Keep project name draft in sync for AI chat prefix
  useEffect(() => {
    if (setupMode === 'collapsed') return
    setProjectNameDraft(formTitle)
  }, [setupMode, formTitle, setProjectNameDraft])

  // Clean up the global callback on unmount so stale handlers don't leak
  useEffect(() => {
    return () => {
      window.__wrdeskInsertDraft = undefined
    }
  }, [])

  // ── Field selection handler — also sets window.__wrdeskInsertDraft ──────────
  // When the user picks a field section header, we create a fresh insertion
  // callback on window. That closure captures `field` at call-time, so it is
  // always correct — no stale refs, no useEffect timing.
  const handleFieldSelect = useCallback(
    (field: 'title' | 'description' | 'goals' | 'milestones') => {
      // Clear stale store draft data
      const store = useProjectSetupChatContextStore.getState()
      store.setGoalsDraft('')
      store.setMilestonesDraft('')
      store.clearSnippets()
      store.setSetupTextDraft('')
      store.setIncludeInChat(false)
      // Section header = general mode, not specific milestone edit
      setQuickEditMilestoneId(null)
      window.dispatchEvent(new CustomEvent('wrdesk:clear-chat-attachments'))
      window.dispatchEvent(new CustomEvent('wrdesk:clear-chat-conversation'))

      if (selectedField === field && !quickEditMilestoneId) {
        // Deselect entirely
        selectedFieldRef.current = null
        setSelectedField(null)
        window.__wrdeskInsertDraft = undefined
        return
      }

      selectedFieldRef.current = field
      setSelectedField(field)

      // SET fresh insertion callback for this field
      window.__wrdeskInsertDraft = (text: string, mode: 'append' | 'replace') => {
        const trimmed = text.trim()
        if (!trimmed) return
        console.log('[Insert Draft] field:', field, 'mode:', mode)

        if (field === 'title') {
          const clean = trimmed
            .split('\n')[0]
            .replace(/^[\d.)\-*\s]+/, '')
            .replace(/^["'\u201C\u2018]|["'\u201D\u2019]$/g, '')
            .replace(/\*\*/g, '')
            .trim()
          setFormTitle(clean)
          flashFieldEl('title')
        } else if (field === 'description') {
          setFormDescription(trimmed)
          flashFieldEl('description')
        } else if (field === 'goals') {
          setFormGoals(trimmed)
          flashFieldEl('goals')
        } else if (field === 'milestones') {
          // General milestones section → create new milestones from lines
          console.log('[Insert Draft] Creating NEW milestones')
          const newMs: ProjectMilestone[] = trimmed
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

      // Context pre-frame is built by the context-sync useEffect on next tick
      focusHeaderAiChat()
    },
    [selectedField, quickEditMilestoneId],
  )

  // ── Quick-edit a specific milestone — sets window.__wrdeskInsertDraft ───────
  // No useCallback deps needed: the closure only captures `milestoneId` (the
  // argument passed at call-time) and stable setState functions.
  const handleQuickEditMilestone = useCallback((milestoneId: string) => {
    // Clear all stale store draft data
    const store = useProjectSetupChatContextStore.getState()
    store.setGoalsDraft('')
    store.setMilestonesDraft('')
    store.clearSnippets()
    store.setIncludeInChat(false)
    window.dispatchEvent(new CustomEvent('wrdesk:clear-chat-attachments'))
    window.dispatchEvent(new CustomEvent('wrdesk:clear-chat-conversation'))

    setQuickEditMilestoneId(milestoneId)
    selectedFieldRef.current = 'milestones'
    setSelectedField('milestones')

    // Set the global callback — captures milestoneId right now (not stale)
    window.__wrdeskInsertDraft = (text: string, mode: 'append' | 'replace') => {
      const trimmed = text.trim()
      if (!trimmed) return
      console.log('[Insert Draft] SPECIFIC milestone:', milestoneId, 'mode:', mode)

      const projectStore = useProjectStore.getState()
      const projectId = projectStore.activeProjectId
      if (!projectId) return
      const project = projectStore.projects.find((p) => p.id === projectId)
      if (!project) return

      const newContent = trimmed

      // Persist to store
      projectStore.updateProject(projectId, {
        milestones: project.milestones.map((m) =>
          m.id === milestoneId ? { ...m, title: newContent } : m
        ),
      })
      // Mirror in local form state
      setFormMilestones((prev) =>
        prev.map((m) => (m.id === milestoneId ? { ...m, title: newContent } : m))
      )
      flashMilestoneEl(milestoneId)
    }

    // Build milestone-specific pre-frame directly (no useEffect needed)
    // Minimal content-only format — NO verbose instruction headers that the AI
    // might treat as text to rewrite. Just the content + user request is enough.
    const milestone = useProjectStore.getState().getActiveProject()?.milestones.find((m) => m.id === milestoneId)
    store.setSetupTextDraft(`[field:milestone]\n${milestone?.title ?? ''}`)
    store.setIncludeInChat(true)

    focusHeaderAiChat()
  }, [])

  // ── Open / cancel / save ──────────────────────────────────────────────────
  const clearFormChatContext = useCallback(() => {
    const store = useProjectSetupChatContextStore.getState()
    store.setSetupTextDraft('')
    store.setGoalsDraft('')
    store.setMilestonesDraft('')
    store.clearSnippets()
    store.setIncludeInChat(false)
    setSelectedField(null)
    selectedFieldRef.current = null
    setQuickEditMilestoneId(null)
    quickEditMilestoneIdRef.current = null
    window.__wrdeskInsertDraft = undefined
    window.dispatchEvent(new CustomEvent('wrdesk:clear-chat-attachments'))
    window.dispatchEvent(new CustomEvent('wrdesk:clear-chat-conversation'))
  }, [])

  const openCreateMode = useCallback(() => {
    setFormTitle('')
    setFormDescription('')
    setFormGoals('')
    setFormMilestones([])
    setFormAttachments([])
    setFormLinkedSessionIds([])
    setFormIntervalMs(300_000)
    setFormIcon('')
    setNewMilestoneInput('')
    selectedFieldRef.current = null
    setSelectedField(null)
    quickEditMilestoneIdRef.current = null
    setQuickEditMilestoneId(null)
    window.__wrdeskInsertDraft = undefined
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
    setFormLinkedSessionIds((p.linkedSessionIds ?? []).slice(0, 1))
    setFormIntervalMs(p.autoOptimizationIntervalMs)
    setFormIcon(p.icon ?? '')
    setNewMilestoneInput('')
    selectedFieldRef.current = null
    setSelectedField(null)
    quickEditMilestoneIdRef.current = null
    setQuickEditMilestoneId(null)
    window.__wrdeskInsertDraft = undefined
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
      linkedSessionIds: formLinkedSessionIds[0] ? [formLinkedSessionIds[0]] : [],
      /** New projects must start with auto-optimization OFF; user enables manually. */
      autoOptimizationEnabled: setupMode === 'creating' ? false : currentEnabled,
      autoOptimizationIntervalMs: formIntervalMs,
      ...(formIcon.trim() ? { icon: formIcon.trim() } : { icon: undefined }),
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
    formLinkedSessionIds, formIntervalMs, formIcon, setupMode, activeProjectId,
    clearFormChatContext,
  ])

  const handleFormIconPick = useCallback(
    (emoji: string) => {
      setFormIcon(emoji)
      if (setupMode === 'editing' && activeProjectId) {
        setProjectIcon(activeProjectId, emoji)
      }
    },
    [setupMode, activeProjectId, setProjectIcon],
  )

  const handleFormIconClear = useCallback(() => {
    setFormIcon('')
    if (setupMode === 'editing' && activeProjectId) {
      setProjectIcon(activeProjectId, '')
    }
  }, [setupMode, activeProjectId, setProjectIcon])

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
  const runCommandDisabled = runBusy
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
            <>
              <button
                type="button"
                className="pop__edit-btn"
                onClick={openEditMode}
                title="Edit this project"
              >
                Edit
              </button>
              {activeProject?.linkedSessionIds?.[0]?.trim() ? (
                <button
                  type="button"
                  className="pop__edit-btn"
                  onClick={() => void handleOpenLinkedSessionDisplayGrids()}
                  title="Open linked WR Chat session in display grids (Chrome extension)"
                >
                  Open session
                </button>
              ) : null}
            </>
          )}
        </div>

        <div className="pop__controls-inline">
          <label className="pop__toggle-wrap">
            <StatusToggle
              enabled={autoOptOn}
              onToggle={(v) => {
                if (!activeProject) return
                if (v) {
                  const guard = canRunOptimization('dashboard_toggle')
                  if (!guard.ok) {
                    applyOptimizationGuardFallback(guard.fallback, guard.message)
                    return
                  }
                }
                setAutoOptimization(activeProject.id, v)
              }}
              disabled={!activeProject}
              label="Auto-Optimization"
            />
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
              title="Run snapshot optimization for the linked WR Chat session (stays on Analysis)"
            >
              {runBusy ? 'Running…' : 'Snapshot-Optimization'}
            </button>
            <span className="pop__action-hint">One-shot optimization run</span>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <label
                  htmlFor="pop-form-title"
                  style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}
                >
                  Title
                </label>
                <button
                  type="button"
                  onClick={() => handleFieldSelect('title')}
                  style={{
                    flexShrink: 0,
                    background: selectedField === 'title' ? '#7c3aed' : '#ffffff',
                    color:      selectedField === 'title' ? '#ffffff' : '#374151',
                    border:     selectedField === 'title' ? '1px solid #7c3aed' : '1px solid #d1d5db',
                    borderRadius: 4, padding: '4px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {selectedField === 'title' ? '☞ AI connected' : 'Select for AI'}
                </button>
              </div>
              <div className="pop__form-textarea-wrap">
                <input
                  ref={titleInputRef}
                  id="pop-form-title"
                  data-field="title"
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Project title"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
                    background: '#ffffff', color: '#0f172a',
                    border: selectedField === 'title' ? '2px solid #7c3aed' : '1px solid #cbd5e1',
                    fontSize: 13, outline: 'none',
                  }}
                  onFocus={(e) => { if (selectedField !== 'title') e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.4)' }}
                  onBlur={(e) => { e.currentTarget.style.boxShadow = 'none' }}
                />
                {selectedField === 'title' && (
                  <span className="pop__form-field-pin" aria-hidden="true">☞</span>
                )}
              </div>
            </div>

            {/* Linked session for auto-optimization (single select) */}
            <div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                Linked session (auto-optimization, optional)
              </span>
              <div
                id="pop-form-sessions"
                style={{
                  maxHeight: 160,
                  overflowY: 'auto',
                  boxSizing: 'border-box',
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  fontSize: 13,
                }}
              >
                {orchestratorSessions.length === 0 ? (
                  <span style={{ color: '#64748b', fontSize: 12 }}>
                    No WR Chat sessions found — open WR Chat at least once, or ensure the orchestrator database is connected.
                  </span>
                ) : (
                  <>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 6,
                        cursor: 'pointer',
                        color: '#0f172a',
                      }}
                    >
                      <input
                        type="radio"
                        name="pop-form-linked-session"
                        checked={formLinkedSessionIds.length === 0}
                        onChange={() => setFormLinkedSessionSingle(null)}
                      />
                      <span>None</span>
                    </label>
                    {orchestratorSessions.map((s) => (
                      <label
                        key={s.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 6,
                          cursor: 'pointer',
                          color: '#0f172a',
                        }}
                      >
                        <input
                          type="radio"
                          name="pop-form-linked-session"
                          checked={formLinkedSessionIds[0] === s.id}
                          onChange={() => setFormLinkedSessionSingle(s.id)}
                        />
                        <span>{s.name}</span>
                      </label>
                    ))}
                  </>
                )}
              </div>
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
                  data-field="description"
                  value={formDescription}
                  onChange={(e) => { setFormDescription(e.target.value); autoGrow(e.target) }}
                  onInput={(e) => autoGrow(e.target as HTMLTextAreaElement)}
                  placeholder="What is this project about?"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 8,
                    border: selectedField === 'description' ? '2px solid #7c3aed' : '1px solid #cbd5e1',
                    outline: 'none', background: '#ffffff', color: '#0f172a', fontSize: 13,
                    lineHeight: 1.6, resize: 'none', overflow: 'hidden', display: 'block', minHeight: 100,
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
                  data-field="goals"
                  value={formGoals}
                  onChange={(e) => { setFormGoals(e.target.value); autoGrow(e.target) }}
                  onInput={(e) => autoGrow(e.target as HTMLTextAreaElement)}
                  placeholder="What do you want to achieve?"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 8,
                    border: selectedField === 'goals' ? '2px solid #7c3aed' : '1px solid #cbd5e1',
                    outline: 'none', background: '#ffffff', color: '#0f172a', fontSize: 13,
                    lineHeight: 1.6, resize: 'none', overflow: 'hidden', display: 'block', minHeight: 100,
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
              </div>

              {formMilestones.length > 0 && (
                <ul style={{ margin: '0 0 8px', padding: 0, listStyle: 'none' }}>
                  {formMilestones.map((m) => (
                    <li
                      key={m.id}
                      className={`pop__form-ms-card${m.isActive ? ' pop__form-ms-card--active' : ''}${quickEditMilestoneId === m.id ? ' pop__form-ms-card--ai-connected' : ''}`}
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
                            className={`pop__form-ms-ai-toggle${quickEditMilestoneId === m.id ? ' pop__form-ms-ai-toggle--connected' : ''}`}
                            title={quickEditMilestoneId === m.id ? 'AI connected — click to disconnect' : 'Select this milestone for AI editing'}
                            onClick={() => {
                              if (quickEditMilestoneId === m.id) {
                                clearFormChatContext()
                              } else {
                                handleQuickEditMilestone(m.id)
                              }
                            }}
                          >
                            {quickEditMilestoneId === m.id ? '☞ AI' : 'AI edit'}
                          </button>
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
                        data-milestone-id={m.id}
                        className={`pop__form-ms-card-body${m.completed ? ' pop__form-ms-card-body--done' : ''}`}
                        value={m.title}
                        onChange={(e) => { updateFormMilestoneTitle(m.id, e.target.value); autoGrow(e.target) }}
                        onInput={(e) => autoGrow(e.target as HTMLTextAreaElement)}
                        placeholder="Describe this milestone…"
                      />

                      <div className="pop__form-ms-card-footer" style={{ display: 'none' }} />
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
                  <button
                    type="button"
                    className={`pop__form-ms-ai-toggle${selectedField === 'milestones' && !quickEditMilestoneId ? ' pop__form-ms-ai-toggle--connected' : ''}`}
                    title={selectedField === 'milestones' && !quickEditMilestoneId ? 'AI connected — click to disconnect' : 'Use AI to suggest new milestones'}
                    onClick={() => handleFieldSelect('milestones')}
                  >
                    {selectedField === 'milestones' && !quickEditMilestoneId ? '☞ AI' : 'AI'}
                  </button>
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

            {/* Project icon (Watchdog / trigger surfaces) */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Project icon
                </span>
                <button
                  type="button"
                  onClick={handleFormIconClear}
                  style={{
                    fontSize: 11,
                    color: formIcon ? '#64748b' : '#cbd5e1',
                    background: 'none',
                    border: 'none',
                    cursor: formIcon ? 'pointer' : 'default',
                    textDecoration: formIcon ? 'underline' : 'none',
                    padding: 0,
                  }}
                  disabled={!formIcon}
                  title="Clear icon"
                >
                  Clear
                </button>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  alignItems: 'center',
                  maxWidth: '100%',
                }}
              >
                {PROJECT_ICON_CHOICES.map((emoji) => {
                  const selected = formIcon === emoji
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleFormIconPick(emoji)}
                      title={emoji}
                      aria-label={`Select icon ${emoji}`}
                      aria-pressed={selected}
                      style={{
                        width: 32,
                        height: 32,
                        padding: 0,
                        fontSize: 18,
                        lineHeight: 1,
                        borderRadius: 8,
                        border: selected ? '2px solid #7c3aed' : '1px solid #e2e8f0',
                        background: selected ? 'rgba(124,58,237,0.12)' : '#ffffff',
                        cursor: 'pointer',
                        boxSizing: 'border-box',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {emoji}
                    </button>
                  )
                })}
              </div>
              {!formIcon.trim() ? (
                <p style={{ margin: '8px 0 0', fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                  Assign icon to enable in Watchdog trigger
                </p>
              ) : null}
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
                      handleQuickEditMilestone(activeMilestone.id)
                    }, 60)
                  } else {
                    handleQuickEditMilestone(activeMilestone.id)
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
