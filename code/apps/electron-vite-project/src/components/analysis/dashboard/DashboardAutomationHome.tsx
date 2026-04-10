/**
 * Default Analysis dashboard hero — compact starter automations (existing app shell routes only).
 * Run / Edit invoke the same callbacks as App.tsx → AnalysisCanvas; no new pipelines.
 * Creation toolbar dispatches the same window events as WrMultiTriggerBar (no duplicate systems).
 * Project WIKI strip: selection + Open/Edit use existing workspace + trigger sync; Snapshot uses
 * the same guards and triggerSnapshotOptimization as ProjectOptimizationPanel.
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

  const starterCards: AutomationCardDef[] = useMemo(
    () => [
      {
        id: 'reply-letter',
        accent: 'mail',
        icon: '✉️',
        title: 'Reply to Incoming Letter',
        valueLine: 'Read and respond to incoming mail.',
        onRun: onNavigateInbox,
        onEdit: onNavigateWrChat,
      },
      {
        id: 'email-composer',
        accent: 'compose',
        icon: '✍️',
        title: 'Email Composer',
        valueLine: 'Draft outbound mail with assistance.',
        onRun: onNavigateWrChat,
        onEdit: onNavigateInbox,
      },
      {
        id: 'document-actions',
        accent: 'document',
        icon: '📄',
        title: 'Document Actions',
        valueLine: 'Sort, open attachments, and triage in batch.',
        onRun: onNavigateBulkInbox,
        onEdit: onNavigateInbox,
      },
      {
        id: 'beap-composer',
        accent: 'beap',
        icon: '📦',
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

  /** Same as WrMultiTriggerBar `handleAddProjectAssistantRowClick` → App projectAssistantCreateToken → POP openCreateMode. */
  const launchAddProjectWikiCreation = useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent(WRDESK_OPEN_PROJECT_ASSISTANT_CREATION))
    } catch {
      /* noop */
    }
  }, [])

  return (
    <div className="dash-auto-home" aria-label="Automation workspace">
      <header className="dash-auto-home__starters-header">
        <div className="dash-auto-home__starters-header-main">
          <span className="dash-auto-home__kicker">Automation workspace</span>
          <h2 className="dash-auto-home__starters-title">Starter automations</h2>
        </div>
        <div className="dash-auto-home__creation-toolbar" role="toolbar" aria-label="Add automations and projects">
          <button
            type="button"
            className="dash-auto-home__create-btn"
            data-automation-ui-kind={ADD_AUTOMATION_ROW_UI_KIND}
            onClick={launchAddAutomationWizard}
          >
            <span className="dash-auto-home__create-btn-icon" aria-hidden>
              ✨
            </span>
            <span>+ Add Automation</span>
          </button>
          <button
            type="button"
            className="dash-auto-home__create-btn"
            data-automation-ui-kind={ADD_PROJECT_ASSISTANT_ROW_UI_KIND}
            onClick={launchAddProjectWikiCreation}
          >
            <span className="dash-auto-home__create-btn-icon" aria-hidden>
              📋
            </span>
            <span>+ Add Project WIKI</span>
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
            Tap to sync the header · Open for full workspace · Snapshot matches the panel run.
          </p>
        </div>

        {projects.length === 0 ? (
          <p className="dash-auto-home__empty">
            No projects yet. Use <strong>+ Add Project WIKI</strong> in the bar or above.
          </p>
        ) : (
          <div
            className="dash-auto-home__wiki-strip"
            role="list"
            aria-label="Project WIKI entries"
          >
            {projects.map((p) => {
              const selected = p.id === activeProjectId
              const snapOk = canRunOptimization('dashboard_snapshot', p.id).ok
              const snapBusy = snapshotBusyId === p.id
              return (
                <div
                  key={p.id}
                  role="listitem"
                  className={[
                    'dash-auto-home__wiki-chip',
                    selected ? 'dash-auto-home__wiki-chip--selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <button
                    type="button"
                    className="dash-auto-home__wiki-chip-select"
                    onClick={() => selectProject(p.id)}
                    aria-pressed={selected}
                    aria-label={`Select project ${p.title}`}
                  >
                    <span className="dash-auto-home__wiki-chip-icon" aria-hidden>
                      {p.icon?.trim() || '📊'}
                    </span>
                    <span className="dash-auto-home__wiki-chip-text">
                      <span className="dash-auto-home__wiki-chip-title">{p.title}</span>
                      <span className="dash-auto-home__wiki-chip-mile">{milestoneLine(p)}</span>
                    </span>
                  </button>
                  <div className="dash-auto-home__wiki-chip-actions">
                    <button
                      type="button"
                      className="dash-auto-home__btn dash-auto-home__btn--xs dash-auto-home__btn--primary"
                      onClick={() => openProject(p.id, 'view')}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="dash-auto-home__btn dash-auto-home__btn--xs dash-auto-home__btn--ghost"
                      onClick={() => openProject(p.id, 'edit')}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="dash-auto-home__btn dash-auto-home__btn--xs dash-auto-home__btn--ghost"
                      disabled={!snapOk || snapBusy}
                      title={
                        snapOk
                          ? 'One-shot assistant snapshot (same as Project WIKI panel)'
                          : 'Link a session in the project to run a snapshot'
                      }
                      onClick={() => runSnapshotForProject(p.id)}
                    >
                      {snapBusy ? '…' : 'Snapshot'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
