/**
 * ProjectSetupModal — multi-tab project setup for WR Desk™.
 *
 * Tabs:
 *   1. Project  — name, goal title, goal summary
 *   2. Milestones — add/reorder/remove milestones
 *   3. Session  — choose agent template, configure slots, link to project
 *   4. Context  — attachments, snippets, "Include in AI Chat" toggle
 *
 * Store connections:
 *   - useProjectStore    → project/session CRUD (persisted to localStorage)
 *   - useProjectSetupChatContextStore → snippets + includeInChat (session-only)
 *
 * DO NOT modify: useEmailInboxStore, useProjectSetupChatContextStore,
 * HybridSearch.tsx, buildProjectSetupChatPrefix.ts.
 */

import { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { WRDESK_FOCUS_AI_CHAT_EVENT } from '../../../lib/wrdeskUiEvents'
import { useProjectSetupChatContextStore } from '../../../stores/useProjectSetupChatContextStore'
import {
  useProjectStore,
  buildNewProject,
  buildNewSession,
  SESSION_TEMPLATES,
  selectActiveProject,
} from '../../../stores/useProjectStore'
import type { AttachmentType, MilestoneStatus, ProjectMilestone } from '../../../types/projectTypes'
import '../../../styles/dashboard-tokens.css'
import '../../../styles/dashboard-base.css'
import './ProjectSetupModal.css'

// ── Types ─────────────────────────────────────────────────────────────────────

export type SetupTab = 'project' | 'milestones' | 'session' | 'context'

export interface ProjectSetupModalProps {
  open: boolean
  onClose: () => void
  /** When set, the modal opens in edit mode for this project. */
  activeProjectId?: string | null
}

// ── Helper ────────────────────────────────────────────────────────────────────

function focusHeaderAiChat() {
  window.dispatchEvent(new CustomEvent(WRDESK_FOCUS_AI_CHAT_EVENT, { bubbles: true }))
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function ProjectSetupModal({ open, onClose, activeProjectId }: ProjectSetupModalProps) {
  const [tab, setTab] = useState<SetupTab>('project')

  // ── Project store ──────────────────────────────────────────────────────────
  const {
    projects,
    sessions,
    addProject,
    updateProject,
    addMilestone,
    updateMilestoneStatus,
    moveMilestone,
    removeMilestone,
    addSession,
    linkSessionToProject,
    addAttachment,
  } = useProjectStore(
    useShallow((s) => ({
      projects:              s.projects,
      sessions:              s.sessions,
      addProject:            s.addProject,
      updateProject:         s.updateProject,
      addMilestone:          s.addMilestone,
      updateMilestoneStatus: s.updateMilestoneStatus,
      moveMilestone:         s.moveMilestone,
      removeMilestone:       s.removeMilestone,
      addSession:            s.addSession,
      linkSessionToProject:  s.linkSessionToProject,
      addAttachment:         s.addAttachment,
    })),
  )

  const editingProject = useProjectStore((s) =>
    activeProjectId ? (s.projects.find((p) => p.id === activeProjectId) ?? null) : selectActiveProject(s),
  )

  // ── Tab 1 — Project form state ─────────────────────────────────────────────
  const [projectName, setProjectName]     = useState('')
  const [goalTitle, setGoalTitle]         = useState('')
  const [goalSummary, setGoalSummary]     = useState('')

  // ── Tab 2 — Milestone form state ───────────────────────────────────────────
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('')
  const [newMilestoneDesc,  setNewMilestoneDesc]  = useState('')

  // ── Tab 3 — Session form state ─────────────────────────────────────────────
  type TemplateKey = keyof typeof SESSION_TEMPLATES
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateKey>('security')
  const [sessionName, setSessionName]           = useState('')

  // ── Tab 4 — Attachment form state ──────────────────────────────────────────
  const [attachLabel, setAttachLabel]       = useState('')
  const [attachContent, setAttachContent]   = useState('')
  const [attachType, setAttachType]         = useState<AttachmentType>('context')

  // ── Chat context store (Tab 4 — snippets + includeInChat) ─────────────────
  const {
    includeInChat,
    setIncludeInChat,
    snippets,
    addSnippet,
    removeSnippet,
  } = useProjectSetupChatContextStore(
    useShallow((s) => ({
      includeInChat:    s.includeInChat,
      setIncludeInChat: s.setIncludeInChat,
      snippets:         s.snippets,
      addSnippet:       s.addSnippet,
      removeSnippet:    s.removeSnippet,
    })),
  )

  const [snippetLabel, setSnippetLabel] = useState('')
  const [snippetText,  setSnippetText]  = useState('')

  // ── Populate form when editing an existing project ─────────────────────────
  useEffect(() => {
    if (!open) return
    setTab('project')
    if (editingProject) {
      setProjectName(editingProject.name)
      setGoalTitle(editingProject.goal.title)
      setGoalSummary(editingProject.goal.summary)
    } else {
      setProjectName('')
      setGoalTitle('')
      setGoalSummary('')
    }
  }, [open, editingProject])

  // ── Focus first input when tab 1 opens ────────────────────────────────────
  useEffect(() => {
    if (!open || tab !== 'project') return
    const id = window.requestAnimationFrame(() => {
      document.getElementById('psm-project-name')?.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [open, tab])

  // ── Escape key ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleSaveProject = useCallback(() => {
    const name = projectName.trim()
    if (!name) return
    if (editingProject) {
      updateProject(editingProject.id, {
        name,
        goal: {
          ...editingProject.goal,
          title: goalTitle.trim() || 'Project Goal',
          summary: goalSummary.trim(),
          updatedAt: new Date().toISOString(),
        },
      })
    } else {
      const project = buildNewProject(name, goalTitle, goalSummary)
      addProject(project)
      useProjectStore.getState().setActiveProjectId(project.id)
    }
    setTab('milestones')
  }, [projectName, goalTitle, goalSummary, editingProject, addProject, updateProject])

  const handleAddMilestone = useCallback(() => {
    const title = newMilestoneTitle.trim()
    if (!title) return
    const target = editingProject ?? projects[0]
    if (!target) return
    const order = target.milestones.length
    const milestone: ProjectMilestone = {
      id: crypto.randomUUID(),
      title,
      description: newMilestoneDesc.trim(),
      status: 'pending',
      order,
      completedAt: null,
    }
    addMilestone(target.id, milestone)
    setNewMilestoneTitle('')
    setNewMilestoneDesc('')
  }, [newMilestoneTitle, newMilestoneDesc, editingProject, projects, addMilestone])

  const handleConnectSession = useCallback(() => {
    const target = editingProject ?? projects[0]
    if (!target) return
    const name = sessionName.trim() || `${target.name} — ${selectedTemplate}`
    const session = buildNewSession(name, selectedTemplate)
    addSession(session)
    linkSessionToProject(target.id, session.id)
    setSessionName('')
    setTab('context')
  }, [sessionName, selectedTemplate, editingProject, projects, addSession, linkSessionToProject])

  const handleAddAttachment = useCallback(() => {
    const label = attachLabel.trim()
    if (!label || !attachContent.trim()) return
    const target = editingProject ?? projects[0]
    if (!target) return
    addAttachment(target.id, label, attachContent, attachType)
    setAttachLabel('')
    setAttachContent('')
    setAttachType('context')
  }, [attachLabel, attachContent, attachType, editingProject, projects, addAttachment])

  const handleAddSnippet = useCallback(() => {
    if (!snippetLabel.trim() && !snippetText.trim()) return
    addSnippet({ label: snippetLabel, text: snippetText })
    setSnippetLabel('')
    setSnippetText('')
  }, [snippetLabel, snippetText, addSnippet])

  // ── Derived ───────────────────────────────────────────────────────────────

  const targetProject = editingProject ?? (projects.length > 0 ? projects[projects.length - 1] : null)
  const milestones = targetProject
    ? [...targetProject.milestones].sort((a, b) => a.order - b.order)
    : []
  const linkedSession = targetProject?.linkedSessionId
    ? (sessions.find((s) => s.id === targetProject.linkedSessionId) ?? null)
    : null

  if (!open) return null

  const TABS: Array<[SetupTab, string]> = [
    ['project',    'Project'],
    ['milestones', 'Milestones'],
    ['session',    'Session'],
    ['context',    'Context'],
  ]

  const TEMPLATE_LABELS: Record<TemplateKey, string> = {
    security: 'Security',
    growth:   'Growth',
    full:     'Full',
    custom:   'Custom',
  }

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
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="psm__header">
          <div>
            <h2 id="psm-title" className="psm__title">
              {editingProject ? `Edit — ${editingProject.name}` : 'New Project Setup'}
            </h2>
            <p className="psm__subtitle">
              Project AI Optimization · persisted to local storage · V2 moves to cloud
            </p>
          </div>
          <button type="button" className="psm__close" onClick={onClose} aria-label="Close modal">
            ×
          </button>
        </div>

        {/* ── Tab bar ───────────────────────────────────────────────────── */}
        <div className="psm__tabs" role="tablist" aria-label="Setup steps">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`psm__tab${tab === id ? ' psm__tab--active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div className="psm__body">

          {/* ── TAB 1: Project ────────────────────────────────────────────*/}
          {tab === 'project' && (
            <>
              <div className="psm__field">
                <label className="psm__label" htmlFor="psm-project-name">
                  Project name
                  <button type="button" className="psm__label-action" onClick={focusHeaderAiChat}>
                    Draft with AI ↗
                  </button>
                </label>
                <input
                  id="psm-project-name"
                  className="psm__input"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. Q2 Security Hardening"
                  autoComplete="off"
                />
              </div>

              <div className="psm__field">
                <label className="psm__label" htmlFor="psm-goal-title">
                  Goal title
                  <button type="button" className="psm__label-action" onClick={focusHeaderAiChat}>
                    Draft with AI ↗
                  </button>
                </label>
                <input
                  id="psm-goal-title"
                  className="psm__input"
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  placeholder="One-line goal headline"
                  autoComplete="off"
                />
              </div>

              <div className="psm__field">
                <label className="psm__label" htmlFor="psm-goal-summary">
                  Goal summary
                  <button type="button" className="psm__label-action" onClick={focusHeaderAiChat}>
                    Draft with AI ↗
                  </button>
                </label>
                <textarea
                  id="psm-goal-summary"
                  className="psm__textarea"
                  value={goalSummary}
                  onChange={(e) => setGoalSummary(e.target.value)}
                  placeholder="2–4 sentences: what optimized email handling should achieve for this initiative"
                  rows={4}
                />
              </div>

              <p className="psm__hint">
                Project is saved locally. IPC/SQLite persistence arrives in V2.
              </p>
            </>
          )}

          {/* ── TAB 2: Milestones ─────────────────────────────────────────*/}
          {tab === 'milestones' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p className="psm__section-title">Milestones</p>
                <button type="button" className="psm__label-action" onClick={focusHeaderAiChat}>
                  Suggest with AI ↗
                </button>
              </div>

              {milestones.length > 0 ? (
                <ul className="psm__milestone-list">
                  {milestones.map((m, idx) => (
                    <li key={m.id} className="psm__milestone-item">
                      <div className="psm__milestone-arrows">
                        <button
                          type="button"
                          className="psm__milestone-arrow"
                          disabled={idx === 0 || !targetProject}
                          onClick={() => targetProject && moveMilestone(targetProject.id, m.id, 'up')}
                          aria-label="Move up"
                        >▲</button>
                        <button
                          type="button"
                          className="psm__milestone-arrow"
                          disabled={idx === milestones.length - 1 || !targetProject}
                          onClick={() => targetProject && moveMilestone(targetProject.id, m.id, 'down')}
                          aria-label="Move down"
                        >▼</button>
                      </div>

                      <span className="psm__milestone-item-title" title={m.description || m.title}>
                        {m.title}
                      </span>

                      <button
                        type="button"
                        className={`psm__milestone-item-status psm__milestone-item-status--${m.status}`}
                        onClick={() => {
                          if (!targetProject) return
                          const next: MilestoneStatus =
                            m.status === 'pending' ? 'in_progress'
                            : m.status === 'in_progress' ? 'completed'
                            : 'pending'
                          updateMilestoneStatus(targetProject.id, m.id, next)
                        }}
                        title="Click to cycle status"
                      >
                        {m.status.replace('_', ' ')}
                      </button>

                      <button
                        type="button"
                        className="psm__milestone-remove"
                        disabled={!targetProject}
                        onClick={() => targetProject && removeMilestone(targetProject.id, m.id)}
                        aria-label={`Remove ${m.title}`}
                      >×</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="psm__empty">
                  <p className="psm__empty-title">No milestones yet</p>
                  <p className="psm__empty-body">Add your first checkpoint below</p>
                </div>
              )}

              {/* Add milestone form */}
              <div className="psm__field">
                <label className="psm__label" htmlFor="psm-milestone-title">
                  New milestone title
                </label>
                <input
                  id="psm-milestone-title"
                  className="psm__input"
                  value={newMilestoneTitle}
                  onChange={(e) => setNewMilestoneTitle(e.target.value)}
                  placeholder="Checkpoint name"
                  disabled={!targetProject}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddMilestone()}
                />
              </div>
              <div className="psm__field">
                <label className="psm__label" htmlFor="psm-milestone-desc">
                  Description <span style={{ fontWeight: 400, color: 'var(--ds-text-disabled)' }}>(optional)</span>
                </label>
                <textarea
                  id="psm-milestone-desc"
                  className="psm__textarea"
                  value={newMilestoneDesc}
                  onChange={(e) => setNewMilestoneDesc(e.target.value)}
                  placeholder="What does completing this milestone look like?"
                  rows={2}
                  disabled={!targetProject}
                />
              </div>

              {!targetProject && (
                <p className="psm__hint">Save a project on the Project tab first.</p>
              )}
            </>
          )}

          {/* ── TAB 3: Session / agent grid ────────────────────────────────*/}
          {tab === 'session' && (
            <>
              <p className="psm__section-title">Agent template</p>

              <div className="psm__templates">
                {(Object.keys(SESSION_TEMPLATES) as TemplateKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`psm__template-btn${selectedTemplate === key ? ' psm__template-btn--active' : ''}`}
                    onClick={() => setSelectedTemplate(key)}
                  >
                    {TEMPLATE_LABELS[key]}
                  </button>
                ))}
              </div>

              {/* Preview of selected template slots */}
              {SESSION_TEMPLATES[selectedTemplate].length > 0 ? (
                <ul className="psm__agent-list">
                  {SESSION_TEMPLATES[selectedTemplate].map((a, i) => (
                    <li key={i} className="psm__agent-item">
                      <span className="psm__agent-item-label">{a.label}</span>
                      <span className="psm__agent-item-enabled">
                        {a.enabled ? (
                          <span className="dash-badge dash-badge--secure">on</span>
                        ) : (
                          <span className="dash-badge">off</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="psm__empty">
                  <p className="psm__empty-title">Custom template</p>
                  <p className="psm__empty-body">Connect the session — then add agent slots in Full Setup</p>
                </div>
              )}

              {linkedSession ? (
                <p className="psm__hint">
                  Session already linked: <strong style={{ color: 'var(--ds-teal-300)' }}>{linkedSession.name}</strong>
                  {' — '}to replace it, connect a new one below.
                </p>
              ) : null}

              <div className="psm__field">
                <label className="psm__label" htmlFor="psm-session-name">
                  Session name <span style={{ fontWeight: 400, color: 'var(--ds-text-disabled)' }}>(optional)</span>
                </label>
                <input
                  id="psm-session-name"
                  className="psm__input"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder={targetProject ? `${targetProject.name} — ${selectedTemplate}` : 'Session name'}
                  disabled={!targetProject}
                />
              </div>

              {!targetProject && (
                <p className="psm__hint">Save a project on the Project tab first.</p>
              )}
            </>
          )}

          {/* ── TAB 4: Context ─────────────────────────────────────────────*/}
          {tab === 'context' && (
            <>
              {/* Include in AI Chat */}
              <label className="dash-toggle" style={{ display: 'flex', alignItems: 'center', gap: 'var(--ds-space-sm)' }}>
                <input
                  type="checkbox"
                  className="dash-toggle__input"
                  checked={includeInChat}
                  onChange={(e) => setIncludeInChat(e.target.checked)}
                />
                <span className="dash-toggle__track" />
                <span style={{ fontSize: 'var(--ds-type-body-size)', color: 'var(--ds-text-secondary)' }}>
                  Include context in header AI chats (Analysis view)
                </span>
              </label>

              {/* Attachments */}
              <p className="psm__section-title">Attachments</p>

              {targetProject && targetProject.attachments.length > 0 ? (
                <ul className="psm__milestone-list">
                  {targetProject.attachments.map((att) => (
                    <li key={att.id} className="psm__milestone-item">
                      <span
                        className={`pop__attachment-type pop__attachment-type--${att.type}`}
                        style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '999px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', background: 'var(--ds-surface-04)', color: 'var(--ds-text-muted)', flexShrink: 0 }}
                      >
                        {att.type}
                      </span>
                      <span className="psm__milestone-item-title" title={att.content}>
                        {att.label}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="psm__empty">
                  <p className="psm__empty-body">No attachments yet</p>
                </div>
              )}

              {/* Add attachment form */}
              <div className="psm__attachment-add">
                <div className="psm__attachment-type-row">
                  {(['context', 'note', 'snippet'] as AttachmentType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`psm__type-btn${attachType === t ? ' psm__type-btn--active' : ''}`}
                      onClick={() => setAttachType(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <input
                  className="psm__input"
                  value={attachLabel}
                  onChange={(e) => setAttachLabel(e.target.value)}
                  placeholder="Label"
                  disabled={!targetProject}
                  aria-label="Attachment label"
                />
                <textarea
                  className="psm__textarea"
                  value={attachContent}
                  onChange={(e) => setAttachContent(e.target.value)}
                  placeholder="Paste context, policy text, or notes…"
                  rows={3}
                  disabled={!targetProject}
                />
                <button
                  type="button"
                  className="dash-btn-secondary dash-btn-sm"
                  disabled={!targetProject || !attachLabel.trim() || !attachContent.trim()}
                  onClick={handleAddAttachment}
                >
                  Add attachment
                </button>
              </div>

              {/* Snippets (from useProjectSetupChatContextStore) */}
              <p className="psm__section-title" style={{ marginTop: 'var(--ds-space-xs)' }}>
                Context snippets (session-only)
              </p>
              {snippets.map((sn) => (
                <div
                  key={sn.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--ds-space-xs)',
                    padding: 'var(--ds-space-xs) var(--ds-space-sm)',
                    background: 'var(--ds-surface-02)',
                    borderRadius: 'var(--ds-radius-sharp)',
                    border: '1px solid var(--ds-border-00)',
                  }}
                >
                  <span style={{ flex: 1, fontSize: 'var(--ds-type-caption-size)', color: 'var(--ds-text-secondary)' }}>
                    {sn.label || '(untitled)'}: {sn.text.slice(0, 60)}{sn.text.length > 60 ? '…' : ''}
                  </span>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: 'var(--ds-text-muted)', cursor: 'pointer', fontSize: '14px' }}
                    onClick={() => removeSnippet(sn.id)}
                    aria-label={`Remove snippet ${sn.label}`}
                  >×</button>
                </div>
              ))}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ds-space-2xs)' }}>
                <input
                  className="psm__input"
                  value={snippetLabel}
                  onChange={(e) => setSnippetLabel(e.target.value)}
                  placeholder="Snippet label"
                  aria-label="Snippet label"
                />
                <textarea
                  className="psm__textarea"
                  value={snippetText}
                  onChange={(e) => setSnippetText(e.target.value)}
                  placeholder="Reference text (session only, not persisted)"
                  rows={2}
                />
                <button
                  type="button"
                  className="dash-btn-secondary dash-btn-sm"
                  onClick={handleAddSnippet}
                  style={{ alignSelf: 'flex-start' }}
                >
                  Add snippet
                </button>
              </div>

              {!targetProject && (
                <p className="psm__hint">Save a project on the Project tab first to add attachments.</p>
              )}
            </>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="psm__footer">
          {tab === 'project' && (
            <button
              type="button"
              className="dash-btn-primary"
              disabled={!projectName.trim()}
              onClick={handleSaveProject}
            >
              {editingProject ? 'Save changes' : 'Create project →'}
            </button>
          )}

          {tab === 'milestones' && (
            <button
              type="button"
              className="dash-btn-secondary"
              disabled={!newMilestoneTitle.trim() || !targetProject}
              onClick={handleAddMilestone}
            >
              Add milestone
            </button>
          )}

          {tab === 'session' && (
            <button
              type="button"
              className="dash-btn-primary"
              disabled={!targetProject}
              onClick={handleConnectSession}
            >
              Connect session →
            </button>
          )}

          <button type="button" className="dash-btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
