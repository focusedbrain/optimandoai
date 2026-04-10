/**
 * ProjectSetupModal — project creation and editing for WR Desk™.
 *
 * Single scrollable form with fields:
 *   1. Title + Linked session (side by side)
 *   2. Description     (with "Include in AI Chat" toggle)
 *   3. Goals           (with "Include in AI Chat" toggle)
 *   4. Milestones      (with "Include in AI Chat" toggle)
 *   5. Context attachments (file upload)
 *   6. Repeat cadence (linked WR Chat — persisted ms unchanged)
 *
 * Store connections:
 *   - useProjectStore        → project CRUD, session linking, persisted
 *   - useProjectSetupChatContextStore → setSetupTextDraft, setIncludeInChat
 *
 * DO NOT modify: useProjectSetupChatContextStore, buildProjectSetupChatPrefix.ts,
 *   HybridSearch.tsx, any IPC handler, any electron/main code.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { WRDESK_FOCUS_AI_CHAT_EVENT } from '../../../lib/wrdeskUiEvents'
import { refreshOrchestratorSessionsFromBridge } from '../../../lib/refreshOrchestratorSessions'
import { useProjectSetupChatContextStore } from '../../../stores/useProjectSetupChatContextStore'
import { useProjectStore } from '../../../stores/useProjectStore'
import {
  AUTO_OPTIMIZATION_INTERVALS,
} from '../../../types/projectTypes'
import type { ProjectAttachment, ProjectMilestone } from '../../../types/projectTypes'
import './ProjectSetupModal.css'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProjectSetupModalProps {
  open: boolean
  onClose: () => void
  /** When set, modal opens in edit mode for this project. null/undefined = create. */
  activeProjectId?: string | null
}

/** Milestone as managed within the modal (before persisting to store). */
type ModalMilestone = {
  id: string
  title: string
  description: string
  completed: boolean
  createdAt: string
  completedAt: string | null
}

// ── Helper ────────────────────────────────────────────────────────────────────

function focusHeaderAiChat() {
  window.dispatchEvent(new CustomEvent(WRDESK_FOCUS_AI_CHAT_EVENT, { bubbles: true }))
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function ProjectSetupModal({ open, onClose, activeProjectId }: ProjectSetupModalProps) {
  // ── Store access ───────────────────────────────────────────────────────────
  const createProject       = useProjectStore((s) => s.createProject)
  const updateProject       = useProjectStore((s) => s.updateProject)
  const setActiveProject    = useProjectStore((s) => s.setActiveProject)
  const orchestratorSessions = useProjectStore((s) => s.orchestratorSessions)

  const editingProject = useProjectStore((s) =>
    activeProjectId ? (s.projects.find((p) => p.id === activeProjectId) ?? null) : null,
  )

  const isEditMode = editingProject !== null

  // ── Form state ─────────────────────────────────────────────────────────────
  const [title,              setTitle]              = useState('')
  const [description,        setDescription]        = useState('')
  const [goals,              setGoals]              = useState('')
  const [milestones,         setMilestones]         = useState<ModalMilestone[]>([])
  const [localAttachments,   setLocalAttachments]   = useState<ProjectAttachment[]>([])
  const [linkedSessionIds,   setLinkedSessionIds]   = useState<string[]>([])
  const [intervalMs,         setIntervalMs]         = useState(300000)
  const [newMilestoneInput,  setNewMilestoneInput]  = useState('')

  // ── Chat inclusion toggles ─────────────────────────────────────────────────
  const [includeDescription, setIncludeDescription] = useState(false)
  const [includeGoals,       setIncludeGoals]       = useState(false)
  const [includeMilestones,  setIncludeMilestones]  = useState(false)

  // ── File upload ────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // ── Populate form when modal opens ─────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    if (editingProject) {
      setTitle(editingProject.title)
      setDescription(editingProject.description)
      setGoals(editingProject.goals)
      setMilestones(
        editingProject.milestones.map((m) => ({
          id: m.id,
          title: m.title,
          description: m.description ?? '',
          completed: m.completed,
          createdAt: m.createdAt,
          completedAt: m.completedAt,
        })),
      )
      setLocalAttachments([...editingProject.attachments])
      setLinkedSessionIds((editingProject.linkedSessionIds ?? []).slice(0, 1))
      setIntervalMs(editingProject.autoOptimizationIntervalMs)
    } else {
      setTitle('')
      setDescription('')
      setGoals('')
      setMilestones([])
      setLocalAttachments([])
      setLinkedSessionIds([])
      setIntervalMs(300000)
      setNewMilestoneInput('')
      setIncludeDescription(false)
      setIncludeGoals(false)
      setIncludeMilestones(false)
    }

    void refreshOrchestratorSessionsFromBridge()
  }, [open, editingProject])

  // ── Focus title input on open ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const id = window.requestAnimationFrame(() => titleInputRef.current?.focus())
    return () => window.cancelAnimationFrame(id)
  }, [open])

  // ── Escape key ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // ── Chat context sync ──────────────────────────────────────────────────────
  useEffect(() => {
    const chatStore = useProjectSetupChatContextStore.getState()
    let setupText = ''
    if (includeDescription && description.trim()) {
      setupText += `[Project Description]\n${description.trim()}\n\n`
    }
    if (includeGoals && goals.trim()) {
      setupText += `[Project Goals]\n${goals.trim()}\n\n`
    }
    if (includeMilestones && milestones.length > 0) {
      const text = milestones.map((m) => `${m.completed ? '✓' : '○'} ${m.title}`).join('\n')
      setupText += `[Milestones]\n${text}\n\n`
    }
    chatStore.setSetupTextDraft(setupText.trim())
    chatStore.setIncludeInChat(setupText.trim().length > 0)
  }, [includeDescription, description, includeGoals, goals, includeMilestones, milestones])

  // ── Milestone actions ─────────────────────────────────────────────────────
  const handleAddMilestone = useCallback(() => {
    const t = newMilestoneInput.trim()
    if (!t) return
    setMilestones((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        title: t,
        description: '',
        completed: false,
        createdAt: new Date().toISOString(),
        completedAt: null,
      },
    ])
    setNewMilestoneInput('')
  }, [newMilestoneInput])

  const toggleMilestone = useCallback((id: string) => {
    setMilestones((prev) =>
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

  const removeLocalMilestone = useCallback((id: string) => {
    setMilestones((prev) => prev.filter((m) => m.id !== id))
  }, [])

  // ── Attachment actions ────────────────────────────────────────────────────
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      for (const file of files) {
        const content = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = (ev) => resolve((ev.target?.result as string) ?? '')
          // TODO: extract PDF text via IPC when mimeType is application/pdf
          reader.readAsText(file)
        })
        setLocalAttachments((prev) => [
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
    },
    [],
  )

  const removeLocalAttachment = useCallback((id: string) => {
    setLocalAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  /** Auto-optimization uses a single linked WR Chat session (stored as a one-element array). */
  const setLinkedSessionSingle = useCallback((id: string | null) => {
    setLinkedSessionIds(id ? [id] : [])
  }, [])

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    const milestonesOut: ProjectMilestone[] = milestones.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description ?? '',
      isActive: editingProject?.milestones.find((em) => em.id === m.id)?.isActive ?? false,
      completed: m.completed,
      completedAt: m.completedAt,
      createdAt: m.createdAt,
    }))

    const projectData = {
      title: trimmedTitle,
      description: description.trim(),
      goals: goals.trim(),
      milestones: milestonesOut,
      attachments: localAttachments,
      linkedSessionIds: linkedSessionIds[0] ? [linkedSessionIds[0]] : [],
      autoOptimizationEnabled: editingProject?.autoOptimizationEnabled ?? false,
      autoOptimizationIntervalMs: intervalMs,
    }

    if (isEditMode && editingProject) {
      updateProject(editingProject.id, projectData)
    } else {
      const newId = createProject(projectData)
      setActiveProject(newId)
    }

    onClose()
  }, [
    title, description, goals, milestones, localAttachments,
    linkedSessionIds, intervalMs, isEditMode, editingProject,
    createProject, updateProject, setActiveProject, onClose,
  ])

  if (!open) return null

  return (
    <div
      className="psm__overlay"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="psm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="psm-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="psm__header">
          <h2 id="psm-title" className="psm__title">
            {isEditMode ? `Edit — ${editingProject.title}` : 'New Project'}
          </h2>
          <button
            type="button"
            className="psm__close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="psm__body">

          {/* ── Field 1: Title + Session (side by side) ── */}
          <div className="psm__field-row">
            <div className="psm__field-col psm__field-col--flex">
              <div className="psm__label-row">
                <label className="psm__label" htmlFor="psm-title">Project title</label>
              </div>
              <input
                ref={titleInputRef}
                id="psm-title"
                className="psm__input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter project title"
                autoComplete="off"
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              />
            </div>
            <div className="psm__field-col psm__field-col--fixed">
              <div className="psm__label-row">
                <label className="psm__label" id="psm-session-label">Linked WR Chat session (assistant)</label>
              </div>
              <div
                className="psm__select"
                role="group"
                aria-labelledby="psm-session-label"
                style={{
                  maxHeight: 140,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '8px 10px',
                  height: 'auto',
                }}
              >
                {orchestratorSessions.length === 0 ? (
                  <span className="psm__session-hint" style={{ margin: 0 }}>
                    No WR Chat sessions found — open WR Chat at least once.
                  </span>
                ) : (
                  <>
                    <label
                      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}
                    >
                      <input
                        type="radio"
                        name="psm-linked-session"
                        checked={linkedSessionIds.length === 0}
                        onChange={() => setLinkedSessionSingle(null)}
                      />
                      <span>None</span>
                    </label>
                    {orchestratorSessions.map((s) => (
                      <label
                        key={s.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}
                      >
                        <input
                          type="radio"
                          name="psm-linked-session"
                          checked={linkedSessionIds[0] === s.id}
                          onChange={() => setLinkedSessionSingle(s.id)}
                        />
                        <span>{s.name}</span>
                      </label>
                    ))}
                  </>
                )}
              </div>
              <p className="psm__session-hint">Pick one WR Chat session for scheduled assistant runs (same list as session history).</p>
            </div>
          </div>

          {/* ── Field 2: Description ── */}
          <div>
            <div className="psm__label-row">
              <label className="psm__label" htmlFor="psm-description">Description</label>
              <div className="psm__label-actions">
                <button type="button" className="psm__ai-btn" onClick={focusHeaderAiChat}>
                  Draft with AI →
                </button>
                <button
                  type="button"
                  className={`psm__include-btn${includeDescription ? ' psm__include-btn--active' : ''}`}
                  onClick={() => setIncludeDescription((v) => !v)}
                >
                  {includeDescription ? 'Included in AI Chat ✓' : 'Include in AI Chat'}
                </button>
              </div>
            </div>
            <textarea
              id="psm-description"
              className="psm__textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              rows={3}
            />
          </div>

          {/* ── Field 3: Goals ── */}
          <div>
            <div className="psm__label-row">
              <label className="psm__label" htmlFor="psm-goals">Goals</label>
              <div className="psm__label-actions">
                <button type="button" className="psm__ai-btn" onClick={focusHeaderAiChat}>
                  Draft with AI →
                </button>
                <button
                  type="button"
                  className={`psm__include-btn${includeGoals ? ' psm__include-btn--active' : ''}`}
                  onClick={() => setIncludeGoals((v) => !v)}
                >
                  {includeGoals ? 'Included in AI Chat ✓' : 'Include in AI Chat'}
                </button>
              </div>
            </div>
            <textarea
              id="psm-goals"
              className="psm__textarea"
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              placeholder="What do you want to achieve?"
              rows={3}
            />
          </div>

          {/* ── Field 4: Milestones ── */}
          <div>
            <div className="psm__label-row">
              <label className="psm__label">Milestones</label>
              <div className="psm__label-actions">
                <button type="button" className="psm__ai-btn" onClick={focusHeaderAiChat}>
                  Suggest with AI →
                </button>
                <button
                  type="button"
                  className={`psm__include-btn${includeMilestones ? ' psm__include-btn--active' : ''}`}
                  onClick={() => setIncludeMilestones((v) => !v)}
                >
                  {includeMilestones ? 'Included in AI Chat ✓' : 'Include in AI Chat'}
                </button>
              </div>
            </div>
            <div className="psm__milestones">
              {milestones.map((m) => (
                <div key={m.id} className="psm__milestone-row">
                  <button
                    type="button"
                    className={`psm__milestone-check${m.completed ? ' psm__milestone-check--done' : ''}`}
                    onClick={() => toggleMilestone(m.id)}
                    aria-label={m.completed ? 'Mark incomplete' : 'Mark complete'}
                  >
                    {m.completed ? '✓' : ''}
                  </button>
                  <span className={`psm__milestone-title${m.completed ? ' psm__milestone-title--done' : ''}`}>
                    {m.title}
                  </span>
                  <button
                    type="button"
                    className="psm__milestone-del"
                    onClick={() => removeLocalMilestone(m.id)}
                    aria-label={`Remove ${m.title}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="psm__milestone-add">
                <input
                  className="psm__input psm__input--sm"
                  value={newMilestoneInput}
                  onChange={(e) => setNewMilestoneInput(e.target.value)}
                  placeholder="Add milestone..."
                  onKeyDown={(e) => e.key === 'Enter' && handleAddMilestone()}
                  aria-label="New milestone title"
                />
                <button type="button" className="psm__add-btn" onClick={handleAddMilestone}>
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* ── Field 5: Attachments ── */}
          <div>
            <div className="psm__label-row">
              <label className="psm__label">Context attachments</label>
            </div>
            <p className="psm__sub-label">
              PDFs and text files embedded as context when project is active
            </p>
            {localAttachments.length > 0 && (
              <div className="psm__attachments">
                {localAttachments.map((a) => (
                  <div key={a.id} className="psm__attachment-row">
                    <span className="psm__file-icon" aria-hidden="true">📄</span>
                    <span className="psm__attachment-name" title={a.filename}>{a.filename}</span>
                    <span className="psm__attachment-meta">{a.mimeType.split('/')[1] ?? a.mimeType}</span>
                    <button
                      type="button"
                      className="psm__attachment-del"
                      onClick={() => removeLocalAttachment(a.id)}
                      aria-label={`Remove ${a.filename}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.json"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileSelect}
              aria-hidden="true"
            />
            <button
              type="button"
              className="psm__upload-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              Add attachment…
            </button>
          </div>

          {/* ── Field 6: Repeat cadence (persisted ms unchanged) ── */}
          <div>
            <div className="psm__label-row">
              <label className="psm__label" htmlFor="psm-interval">Repeat cadence (linked session)</label>
            </div>
            <p className="psm__sub-label">
              How often to re-run the linked WR Chat assistant when repeat is on — not inbox mail monitoring
            </p>
            <select
              id="psm-interval"
              className="psm__select psm__select--sm"
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
            >
              {AUTO_OPTIMIZATION_INTERVALS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

        </div>{/* /body */}

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="psm__footer">
          <button type="button" className="psm__cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="psm__save-btn"
            disabled={!title.trim()}
            onClick={handleSave}
          >
            {isEditMode ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  )
}
