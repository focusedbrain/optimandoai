/**
 * Generic “active automation” hero for the Analysis dashboard — wraps {@link ProjectOptimizationPanel}
 * without duplicating its logic. Sub-actions call the same imperative handlers as the panel (no new backends).
 */

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { useProjectStore, selectActiveProject } from '../../../stores/useProjectStore'
import { StatusToggle } from './StatusToggle'
import {
  ProjectOptimizationPanel,
  type ProjectOptimizationPanelHandle,
  type ProjectOptimizationPanelOpenCreateOpts,
  type ProjectOptimizationPanelProps,
} from './ProjectOptimizationPanel'
import './ActiveAutomationWorkspace.css'

const WORKSPACE_TITLE_ID = 'active-automation-workspace-title'

/** Optional hooks for a monitor-style automation — only rendered when callbacks/labels are provided. */
export type MonitorWorkspaceSubActions = {
  onScanNow?: () => void
  onToggleEnabled?: (enabled: boolean) => void
  /** Current on/off state for the optional toggle. */
  enabled?: boolean
  /** Short status line (e.g. last scan). */
  statusLabel?: string
}

export type ActiveAutomationWorkspaceProps = ProjectOptimizationPanelProps & {
  /** Mirrors Analysis canvas `isFormEditing` — disables hero actions while the inline form is open. */
  isWorkspaceFormEditing: boolean
  /**
   * Which automation surface this hero represents. `project_assistant` uses POP snapshot/session actions.
   * `monitor` shows scan/toggle/status only when {@link monitorSubActions} supplies the matching hooks.
   */
  workspaceSurface?: 'project_assistant' | 'monitor'
  /** When `workspaceSurface === 'monitor'`, optional — no invented defaults. */
  monitorSubActions?: MonitorWorkspaceSubActions
}

export const ActiveAutomationWorkspace = forwardRef<
  ProjectOptimizationPanelHandle,
  ActiveAutomationWorkspaceProps
>(function ActiveAutomationWorkspace(
  {
    isWorkspaceFormEditing,
    workspaceSurface = 'project_assistant',
    monitorSubActions,
    onSnapshotRunBusyChange: parentOnSnapshotBusy,
    ...panelProps
  },
  ref,
) {
  const panelRef = useRef<ProjectOptimizationPanelHandle>(null)
  const [snapshotBusy, setSnapshotBusy] = useState(false)
  const activeProject = useProjectStore(selectActiveProject)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)

  useImperativeHandle(
    ref,
    () => ({
      openCreateMode: (opts?: ProjectOptimizationPanelOpenCreateOpts) =>
        panelRef.current?.openCreateMode(opts),
      openEditMode: () => panelRef.current?.openEditMode(),
      runAssistantSnapshotNow: () => panelRef.current?.runAssistantSnapshotNow() ?? Promise.resolve(),
      openLinkedWrChatSession: () => panelRef.current?.openLinkedWrChatSession() ?? Promise.resolve(),
      openLinkedSessionThenSnapshot: () =>
        panelRef.current?.openLinkedSessionThenSnapshot() ?? Promise.resolve(),
    }),
    [],
  )

  const displayTitle = activeProject?.title?.trim() ? activeProject.title.trim() : 'No project selected'
  const linkedSessionKey = activeProject?.linkedSessionIds?.[0]?.trim() ?? ''
  const hasLinkedSession = Boolean(linkedSessionKey)

  const monitorHasActions =
    workspaceSurface === 'monitor' &&
    monitorSubActions &&
    (monitorSubActions.onScanNow ||
      monitorSubActions.onToggleEnabled ||
      (monitorSubActions.statusLabel != null && String(monitorSubActions.statusLabel).trim() !== ''))

  const showProjectAssistantSubRow =
    workspaceSurface === 'project_assistant' && activeProjectId && !isWorkspaceFormEditing

  return (
    <div className="active-automation-workspace">
      <header className="active-automation-workspace__hero" aria-label="Active automation workspace">
        <p className="active-automation-workspace__eyebrow">Active automation workspace</p>
        <h2 id={WORKSPACE_TITLE_ID} className="active-automation-workspace__title">
          {displayTitle}
        </h2>
        <p className="active-automation-workspace__lede">
          {workspaceSurface === 'monitor'
            ? 'Monitor automations — scan, enablement, and status when connected from the trigger surface.'
            : 'Project Assistant — milestones, attachments, linked WR Chat sessions, snapshot runs, and AI-assisted fields.'}
        </p>

        <div className="active-automation-workspace__actions">
          {workspaceSurface === 'project_assistant' ? (
            <>
              <button
                type="button"
                className="active-automation-workspace__btn active-automation-workspace__btn--secondary"
                onClick={() => panelRef.current?.openCreateMode()}
                disabled={isWorkspaceFormEditing}
                title="Create a new project"
              >
                + New project
              </button>
              <button
                type="button"
                className="active-automation-workspace__btn active-automation-workspace__btn--primary"
                onClick={() => panelRef.current?.openEditMode()}
                disabled={!activeProjectId || isWorkspaceFormEditing}
                title={activeProjectId ? 'Edit this project' : 'Select a project first'}
              >
                Edit
              </button>
            </>
          ) : (
            <p className="active-automation-workspace__monitor-placeholder">
              Primary monitor actions use the controls below when this surface is wired.
            </p>
          )}
        </div>

        {workspaceSurface === 'project_assistant' && showProjectAssistantSubRow ? (
          <div
            className="active-automation-workspace__subactions"
            role="toolbar"
            aria-label="Project Assistant quick actions"
          >
            <button
              type="button"
              className="active-automation-workspace__chip"
              disabled={!activeProjectId || snapshotBusy}
              title="One-shot assistant snapshot on the linked session (same as panel Snapshot run)"
              onClick={() => void panelRef.current?.runAssistantSnapshotNow()}
            >
              {snapshotBusy ? 'Running…' : 'Snapshot'}
            </button>
            <button
              type="button"
              className="active-automation-workspace__chip"
              disabled={!activeProjectId || !hasLinkedSession || snapshotBusy}
              title="Open linked WR Chat session, then run the same snapshot (existing steps, sequential)"
              onClick={() => void panelRef.current?.openLinkedSessionThenSnapshot()}
            >
              Open + run
            </button>
            <button
              type="button"
              className="active-automation-workspace__chip"
              disabled={!activeProjectId || !hasLinkedSession}
              title="Open linked WR Chat session in display grids"
              onClick={() => void panelRef.current?.openLinkedWrChatSession()}
            >
              Session
            </button>
          </div>
        ) : null}

        {workspaceSurface === 'monitor' && monitorHasActions && monitorSubActions ? (
          <div className="active-automation-workspace__subactions" role="toolbar" aria-label="Monitor actions">
            {monitorSubActions.onScanNow ? (
              <button
                type="button"
                className="active-automation-workspace__chip"
                onClick={() => monitorSubActions.onScanNow?.()}
              >
                Scan now
              </button>
            ) : null}
            {monitorSubActions.onToggleEnabled ? (
              <label className="active-automation-workspace__monitor-toggle">
                <span className="active-automation-workspace__meta">Enable</span>
                <StatusToggle
                  enabled={monitorSubActions.enabled ?? false}
                  onToggle={(v) => monitorSubActions.onToggleEnabled?.(v)}
                  label="Enable monitor"
                />
              </label>
            ) : null}
            {monitorSubActions.statusLabel ? (
              <span className="active-automation-workspace__meta" title="Monitor status">
                {monitorSubActions.statusLabel}
              </span>
            ) : null}
          </div>
        ) : null}

        {workspaceSurface === 'monitor' && !monitorHasActions ? (
          <p className="active-automation-workspace__subactions-fallback">
            Connect monitor callbacks from the host to show scan, enable, and status here.
          </p>
        ) : null}

        {workspaceSurface === 'project_assistant' && !activeProjectId ? (
          <p className="active-automation-workspace__subactions-fallback">
            Select or create a project to use Snapshot, Session, and Open + run.
          </p>
        ) : null}

        {workspaceSurface === 'project_assistant' && activeProjectId && isWorkspaceFormEditing ? (
          <p className="active-automation-workspace__subactions-fallback">
            Quick actions return when you finish or cancel the inline form.
          </p>
        ) : null}
      </header>

      <div className="active-automation-workspace__body">
        <ProjectOptimizationPanel
          ref={panelRef}
          {...panelProps}
          onSnapshotRunBusyChange={(busy) => {
            setSnapshotBusy(busy)
            parentOnSnapshotBusy?.(busy)
          }}
          workspaceSuppressedCap
          workspaceSectionLabelId={WORKSPACE_TITLE_ID}
        />
      </div>
    </div>
  )
})

ActiveAutomationWorkspace.displayName = 'ActiveAutomationWorkspace'
