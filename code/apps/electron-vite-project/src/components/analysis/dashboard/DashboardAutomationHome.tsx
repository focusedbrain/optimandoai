/**
 * Default Analysis dashboard hero — compact starter automations (existing app shell routes only).
 * Run / Edit invoke the same callbacks as App.tsx → AnalysisCanvas; no new pipelines.
 * Hero “+ Add Automation” dispatches the same wizard event as WrMultiTriggerBar.
 * Project WIKI: full-width row; Active Project select includes + Add Project WIKI (last option) → WRDESK_OPEN_PROJECT_ASSISTANT_CREATION.
 * same guards and triggerSnapshotOptimization as ProjectOptimizationPanel.
 */

import { useMemo, useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ADD_AUTOMATION_ROW_UI_KIND,
  ADD_PROJECT_ASSISTANT_ROW_UI_KIND,
  WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT,
  WRDESK_OPEN_PROJECT_ASSISTANT_CREATION,
  WRDESK_TRIGGER_SYNC_AUTO_OPTIMIZER_PROJECT,
} from '@ext/ui/components'

/** Select sentinel — not a project id; triggers App.tsx projectAssistantCreateToken → POP create. */
const ADD_PROJECT_WIKI_SELECT_VALUE = '__wrdesk_add_project_wiki__'
import { applyOptimizationGuardFallback, canRunOptimization } from '../../../lib/autoOptimizationGuards'
import { triggerSnapshotOptimization } from '../../../lib/autoOptimizationEngine'
import type { Project } from '../../../types/projectTypes'
import { useProjectStore } from '../../../stores/useProjectStore'
import './DashboardAutomationHome.css'

export type DashboardAutomationHomeProps = {
  onOpenProjectAssistantWorkspace: (opts: { projectId: string; mode?: 'edit' | 'view' }) => void
  /** Primary mail stream (single-message workflow). */
  onNavigateInbox: () => void
  /** Assistant / drafting surface. */
  onNavigateWrChat: () => void
  /** Batch mail + document triage surface. */
  onNavigateBulkInbox: () => void
}

type Accent = 'mail' | 'compose' | 'document' | 'beap'

type AutomationCardDef = {
  id: string
  accent: Accent
  icon: string
  title: string
  /** One concise value line — no internal route names. */
  valueLine: string
  onRun: () => void
  onEdit: () => void
}

/** Same derivation as useProjectStore.getActiveMilestone / selectActiveMilestone, per project. */
function milestoneLine(project: Project): string {
  const m =
    project.milestones.find((x) => x.isActive) ??
    project.milestones.find((x) => !x.completed) ??
    null
  const t = m?.title?.trim()
  return t ? t : '—'
}

export function DashboardAutomationHome({
  onOpenProjectAssistantWorkspace,
  onNavigateInbox,
  onNavigateWrChat,
  onNavigateBulkInbox,
}: DashboardAutomationHomeProps) {
  const { projects, activeProjectId, setActiveProject } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      activeProjectId: s.activeProjectId,
      setActiveProject: s.setActiveProject,
    })),
  )

  const [snapshotBusyId, setSnapshotBusyId] = useState<string | null>(null)

  const wikiProjectId = useMemo(() => {
    if (projects.length === 0) return null
    if (activeProjectId && projects.some((p) => p.id === activeProjectId)) return activeProjectId
    return projects[0].id
  }, [projects, activeProjectId])

  const wikiProject = useMemo(
    () => (wikiProjectId ? projects.find((p) => p.id === wikiProjectId) ?? null : null),
    [projects, wikiProjectId],
  )

  const starterCards: AutomationCardDef[] = useMemo(
    () => [
      {
        id: 'reply-letter',
        accent: 'mail',
        icon: '\u{2709}\u{FE0F}',
        title: 'Reply to Incoming Letter',
        valueLine: 'Read and respond to incoming mail.',
        onRun: onNavigateInbox,
        onEdit: onNavigateWrChat,
      },
      {
        id: 'email-composer',
        accent: 'compose',
        icon: '\u{270D}\u{FE0F}',
        title: 'Email Composer',
        valueLine: 'Draft outbound mail with assistance.',
        onRun: onNavigateWrChat,
        onEdit: onNavigateInbox,
      },
      {
        id: 'document-actions',
        accent: 'document',
        icon: '\u{1F4C4}',
        title: 'Document Actions',
        valueLine: 'Sort, open attachments, and triage in batch.',
        onRun: onNavigateBulkInbox,
        onEdit: onNavigateInbox,
      },
      {
        id: 'beap-composer',
        accent: 'beap',
        icon: '\u{1F4E6}',
        title: 'BEAP Composer',
        valueLine: 'BEAP packages, handshakes, and encrypted flows.',
        onRun: onNavigateBulkInbox,
        onEdit: onNavigateWrChat,
      },
    ],
    [onNavigateBulkInbox, onNavigateInbox, onNavigateWrChat],
  )

  const openProject = useCallback(
    (projectId: string, mode: 'edit' | 'view') => {
      onOpenProjectAssistantWorkspace({ projectId, mode })
    },
    [onOpenProjectAssistantWorkspace],
  )

  /** Select only: wr-desk-projects active id + header trigger sync (no workspace open — no duplicate surface). */
  const selectProject = useCallback(
    (projectId: string) => {
      setActiveProject(projectId)
      try {
        window.dispatchEvent(
          new CustomEvent(WRDESK_TRIGGER_SYNC_AUTO_OPTIMIZER_PROJECT, { detail: { projectId } }),
        )
      } catch {
        /* noop */
      }
    },
    [setActiveProject],
  )

  /** Same pipeline as ProjectOptimizationPanel.handleRunAnalysisNow for dashboard_snapshot. */
  const runSnapshotForProject = useCallback(
    (projectId: string) => {
      if (snapshotBusyId !== null) return
      const guard = canRunOptimization('dashboard_snapshot', projectId)
      if (!guard.ok) {
        applyOptimizationGuardFallback(guard.fallback, guard.message)
        return
      }
      const project = useProjectStore.getState().projects.find((x) => x.id === projectId)
      if (!project) return
      setSnapshotBusyId(projectId)
      setActiveProject(projectId)
      try {
        window.dispatchEvent(
          new CustomEvent(WRDESK_TRIGGER_SYNC_AUTO_OPTIMIZER_PROJECT, { detail: { projectId } }),
        )
      } catch {
        /* noop */
      }
      triggerSnapshotOptimization(project, 'dashboard_snapshot')
      window.setTimeout(() => setSnapshotBusyId(null), 900)
    },
    [setActiveProject, snapshotBusyId],
  )

  /** Same as WrMultiTriggerBar `handleAddModeRowClick` → AddModeWizardHost / CustomModeWizard. */
  const launchAddAutomationWizard = useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT))
    } catch {
      /* noop */
    }
  }, [])

  /** Same path as WrMultiTriggerBar “+ Add Project WIKI” row — does not change active project id. */
  const launchAddProjectWikiFromSelector = useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent(WRDESK_OPEN_PROJECT_ASSISTANT_CREATION))
    } catch {
      /* noop */
    }
  }, [])

  const onWikiProjectSelectChange = useCallback(
    (value: string) => {
      if (value === ADD_PROJECT_WIKI_SELECT_VALUE) {
        launchAddProjectWikiFromSelector()
        return
      }
      selectProject(value)
    },
    [launchAddProjectWikiFromSelector, selectProject],
  )

  return (
    <div className="dash-auto-home" aria-label="Automation workspace">
      <header className="dash-auto-home__starters-header">
        <div className="dash-auto-home__starters-header-main">
          <span className="dash-auto-home__kicker">Automation workspace</span>
        </div>
        <div className="dash-auto-home__creation-toolbar" role="toolbar" aria-label="Add automations">
          <button
            type="button"
            className="dash-auto-home__create-btn"
            data-automation-ui-kind={ADD_AUTOMATION_ROW_UI_KIND}
            onClick={launchAddAutomationWizard}
          >
            <span className="dash-auto-home__create-btn-icon" aria-hidden>
              {'\u2728'}
            </span>
            <span>+ Add Automation</span>
          </button>
        </div>
      </header>

      <div className="dash-auto-home__starters-grid" role="list">
        {starterCards.map((card) => (
          <article
            key={card.id}
            role="listitem"
            className={['dash-auto-home__starter', `dash-auto-home__starter--accent-${card.accent}`].join(' ')}
          >
            <div className="dash-auto-home__starter-top">
              <span className="dash-auto-home__starter-icon" aria-hidden>
                {card.icon}
              </span>
              <h3 className="dash-auto-home__starter-title">{card.title}</h3>
            </div>
            <p className="dash-auto-home__starter-value">{card.valueLine}</p>
            <div className="dash-auto-home__starter-actions">
              <button type="button" className="dash-auto-home__btn dash-auto-home__btn--primary" onClick={card.onRun}>
                Run
              </button>
              <button type="button" className="dash-auto-home__btn dash-auto-home__btn--ghost" onClick={card.onEdit}>
                Edit
              </button>
            </div>
          </article>
        ))}
      </div>

      <section
        className="dash-auto-home__wiki"
        aria-labelledby="dash-auto-home-wiki-heading"
      >
        <div className="dash-auto-home__wiki-head">
          <h3 id="dash-auto-home-wiki-heading" className="dash-auto-home__wiki-heading">
            Project WIKI
          </h3>
          <p className="dash-auto-home__wiki-line">
            Choose a project below · Open for full workspace · Snapshot matches the panel run.
          </p>
        </div>

        <div className="dash-auto-home__wiki-body">
          <div className="dash-auto-home__wiki-row dash-auto-home__wiki-row--controls">
            <label className="dash-auto-home__wiki-select-label" htmlFor="dash-auto-home-wiki-project">
              Active project
            </label>
            <select
              id="dash-auto-home-wiki-project"
              className="dash-auto-home__wiki-select"
              value={wikiProjectId ?? ''}
              aria-label="Select project for Project WIKI actions"
              onChange={(e) => onWikiProjectSelectChange(e.target.value)}
            >
              {projects.length === 0 ? (
                <option value="" disabled>
                  —
                </option>
              ) : (
                projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {(p.icon?.trim() ? `${p.icon.trim()} ` : '') + p.title}
                  </option>
                ))
              )}
              <option value={ADD_PROJECT_WIKI_SELECT_VALUE} data-automation-ui-kind={ADD_PROJECT_ASSISTANT_ROW_UI_KIND}>
                + Add Project WIKI
              </option>
            </select>
          </div>
          {wikiProject ? (
            <div className="dash-auto-home__wiki-row dash-auto-home__wiki-row--detail">
              <div className="dash-auto-home__wiki-meta">
                <span className="dash-auto-home__wiki-meta-label">Milestone</span>
                <span className="dash-auto-home__wiki-meta-value">{milestoneLine(wikiProject)}</span>
              </div>
              <div className="dash-auto-home__wiki-actions">
                <button
                  type="button"
                  className="dash-auto-home__btn dash-auto-home__btn--xs dash-auto-home__btn--primary"
                  onClick={() => openProject(wikiProject.id, 'view')}
                >
                  Open
                </button>
                <button
                  type="button"
                  className="dash-auto-home__btn dash-auto-home__btn--xs dash-auto-home__btn--ghost"
                  onClick={() => openProject(wikiProject.id, 'edit')}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="dash-auto-home__btn dash-auto-home__btn--xs dash-auto-home__btn--ghost"
                  disabled={
                    !canRunOptimization('dashboard_snapshot', wikiProject.id).ok ||
                    snapshotBusyId === wikiProject.id
                  }
                  title={
                    canRunOptimization('dashboard_snapshot', wikiProject.id).ok
                      ? 'One-shot assistant snapshot (same as Project WIKI panel)'
                      : 'Link a session in the project to run a snapshot'
                  }
                  onClick={() => runSnapshotForProject(wikiProject.id)}
                >
                  {snapshotBusyId === wikiProject.id ? '…' : 'Snapshot'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
