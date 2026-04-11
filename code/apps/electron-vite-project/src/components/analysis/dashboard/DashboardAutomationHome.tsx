/**
 * Default Analysis dashboard hero — compact starter automations (existing app shell routes only).
 * Run opens full-width compose on AnalysisCanvas (Email/BEAP); Edit and other cards unchanged.
 * Hero “+ Add Automation” dispatches the same wizard event as WrMultiTriggerBar.
 * Project WIKI: full-width row; Active Project select includes + Add Project WIKI (last option) → WRDESK_OPEN_PROJECT_ASSISTANT_CREATION.
 * same guards and triggerSnapshotOptimization as ProjectOptimizationPanel.
 */

import { useMemo, useCallback, useState, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ADD_AUTOMATION_ROW_UI_KIND,
  ADD_PROJECT_ASSISTANT_ROW_UI_KIND,
  WRCHAT_CHAT_FOCUS_REQUEST_EVENT,
  WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT,
  WRDESK_OPEN_PROJECT_ASSISTANT_CREATION,
  WRDESK_TRIGGER_SYNC_AUTO_OPTIMIZER_PROJECT,
} from '@ext/ui/components'

/** Select sentinel — not a project id; triggers App.tsx projectAssistantCreateToken → POP create. */
const ADD_PROJECT_WIKI_SELECT_VALUE = '__wrdesk_add_project_wiki__'
import { applyOptimizationGuardFallback, canRunOptimization } from '../../../lib/autoOptimizationGuards'
import { triggerSnapshotOptimization } from '../../../lib/autoOptimizationEngine'
import type { Project } from '../../../types/projectTypes'
import {
  useProjectStore,
  type ComposerIconSlot,
  type ComposerIconsState,
} from '../../../stores/useProjectStore'
import { useCustomModesStore } from '@ext/stores/useCustomModesStore'
import { useChatFocusStore, WRCHAT_APPEND_ASSISTANT_EVENT } from '@ext/stores/chatFocusStore'
import { useUIStore } from '@ext/stores/useUIStore'
import { getCustomModeTriggerBarIcon } from '@ext/shared/ui/customModeTypes'
import { PROJECT_ICON_CHOICES } from './projectIconChoices'
import './DashboardAutomationHome.css'

const SMART_SUMMARY_HTTP_BASE = 'http://127.0.0.1:51248'

async function getDashboardLaunchSecret(): Promise<string | null> {
  try {
    const fn = (
      window as unknown as {
        handshakeView?: { pqHeaders?: () => Promise<Record<string, string>> }
      }
    ).handshakeView?.pqHeaders
    if (typeof fn === 'function') {
      const h = await fn()
      const s = h?.['X-Launch-Secret']
      return typeof s === 'string' && s.trim() ? s.trim() : null
    }
  } catch {
    /* noop */
  }
  return null
}

function appendWrChatAssistant(text: string) {
  try {
    window.dispatchEvent(new CustomEvent(WRCHAT_APPEND_ASSISTANT_EVENT, { detail: { text } }))
  } catch {
    /* noop */
  }
}

function ComposerIconPickerDialog({
  composerId,
  currentIcon,
  onClose,
}: {
  composerId: ComposerIconSlot
  currentIcon?: string
  onClose: () => void
}) {
  const label =
    composerId === 'emailComposer' ? 'Email Composer' : 'BEAP Composer'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pick = (emoji: string) => {
    useProjectStore.getState().setComposerIcon(composerId, emoji)
    onClose()
  }

  const clear = () => {
    useProjectStore.getState().clearComposerIcon(composerId)
    onClose()
  }

  const active = currentIcon?.trim() ?? ''

  return (
    <div
      className="dash-auto-home__icon-dialog-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClose()
      }}
    >
      <div
        className="dash-auto-home__icon-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dash-composer-icon-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dash-composer-icon-dialog-title" className="dash-auto-home__icon-dialog-title">
          Set Shortcut Icon
        </h2>
        <p className="dash-auto-home__icon-dialog-sub">
          Choose an icon to add this composer as a shortcut in the top bar. ({label})
        </p>
        <div className="dash-auto-home__icon-dialog-grid">
          {PROJECT_ICON_CHOICES.map((emoji) => {
            const selected = active === emoji
            return (
              <button
                key={emoji}
                type="button"
                className={[
                  'dash-auto-home__icon-dialog-cell',
                  selected ? 'dash-auto-home__icon-dialog-cell--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={emoji}
                aria-label={`Select ${emoji}`}
                aria-pressed={selected}
                onClick={() => pick(emoji)}
              >
                {emoji}
              </button>
            )
          })}
        </div>
        <div className="dash-auto-home__icon-dialog-actions">
          <button type="button" className="dash-auto-home__btn dash-auto-home__btn--ghost" onClick={clear}>
            Clear
          </button>
          <button type="button" className="dash-auto-home__btn dash-auto-home__btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export type DashboardAutomationHomeProps = {
  onOpenProjectAssistantWorkspace: (opts: { projectId: string; mode?: 'edit' | 'view' }) => void
  /** Primary mail stream (single-message workflow). */
  onNavigateInbox: () => void
  /** Assistant / drafting surface. */
  onNavigateWrChat: () => void
  /** Batch mail + document triage surface. */
  onNavigateBulkInbox: () => void
  /** Open full-width Email Composer (Analysis canvas) — no popup, no route change. */
  onOpenEmailComposer?: () => void
  /** Open full-width BEAP Composer (Analysis canvas). */
  onOpenBeapComposer?: () => void
  /** Open full-width Letter Composer (Analysis canvas). */
  onOpenLetterComposer?: () => void
}

type Accent = 'mail' | 'compose' | 'document' | 'beap' | 'summary'

type AutomationCardDef = {
  id: string
  accent: Accent
  icon: string
  title: string
  /** One concise value line — no internal route names. */
  valueLine: string
  onRun: () => void
  onEdit: () => void
  /** When set, Edit opens icon picker and allocated icon can show on the card. */
  composerId?: ComposerIconSlot
}

/**
 * Single icon for Automation Workspace cards: allocated shortcut wins; else built-in default.
 * Whitespace-only allocation does not suppress the default.
 */
function resolveAutomationCardIcon(
  composerId: ComposerIconSlot | undefined,
  composerIcons: ComposerIconsState,
  defaultIcon: string,
): string | null {
  if (composerId != null) {
    const a = composerIcons[composerId]?.trim() ?? ''
    if (a.length > 0) return a
  }
  const d = (defaultIcon || '').trim()
  return d.length > 0 ? d : null
}

/** Strip leading pictographic emoji (incl. ZWJ sequences) and spaces — display-only. */
const EMOJI_DISPLAY_HEAD =
  /^(?:\s|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)+/u

function stripLeadingEmojiRuns(s: string, maxPasses: number): string {
  let t = s
  for (let i = 0; i < maxPasses; i++) {
    const next = t.replace(EMOJI_DISPLAY_HEAD, '')
    if (next === t) break
    t = next
  }
  return t.trimStart()
}

/**
 * Visible title when the icon is rendered separately: remove duplicated leading icon string(s)
 * and any remaining leading emoji (covers embedded title emoji vs default/allocated icon).
 */
function stripLeadingDisplayEmoji(title: string, resolvedIcon: string | null): string {
  const original = title
  let t = title.trimStart()
  const icon = resolvedIcon?.trim() ?? ''
  if (icon.length > 0) {
    for (let i = 0; i < 8; i++) {
      if (!t.startsWith(icon)) break
      const next = t.slice(icon.length).trimStart()
      if (next === t) break
      t = next
    }
  }
  t = stripLeadingEmojiRuns(t, 8)
  const out = t.trim()
  return out.length > 0 ? out : original.trim()
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
  onOpenEmailComposer,
  onOpenBeapComposer,
  onOpenLetterComposer,
}: DashboardAutomationHomeProps) {
  const { projects, activeProjectId, setActiveProject, composerIcons } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      activeProjectId: s.activeProjectId,
      setActiveProject: s.setActiveProject,
      composerIcons: s.composerIcons ?? {},
    })),
  )

  const [snapshotBusyId, setSnapshotBusyId] = useState<string | null>(null)
  const [iconPickerTarget, setIconPickerTarget] = useState<ComposerIconSlot | null>(null)
  const customModes = useCustomModesStore((s) => s.modes)
  const [selectedAutomationId, setSelectedAutomationId] = useState('')

  const customModesSorted = useMemo(
    () =>
      [...customModes].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }),
      ),
    [customModes],
  )

  const handleSmartSummaryRun = useCallback(async () => {
    onNavigateWrChat?.()
    await new Promise((r) => setTimeout(r, 200))

    appendWrChatAssistant(
      '\u{1F4CA} **Smart Summary** — Capturing workspace and generating summary\u2026',
    )

    try {
      const secret = await getDashboardLaunchSecret()
      const res = await fetch(`${SMART_SUMMARY_HTTP_BASE}/api/wrchat/smart-summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'X-Launch-Secret': secret } : {}),
        },
        signal: AbortSignal.timeout(600_000),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; summary?: string; error?: string }
        | null

      if (res.ok && data?.ok === true && typeof data.summary === 'string' && data.summary.trim()) {
        appendWrChatAssistant(`\u{1F4CA} **Smart Summary**\n\n${data.summary.trimEnd()}`)
        return
      }

      const errMsg =
        (data && typeof data.error === 'string' && data.error.trim()) ||
        (res.status === 429
          ? 'Capture or summary already in progress. Try again in a few seconds.'
          : `HTTP ${res.status}`)
      appendWrChatAssistant(`\u{1F4CA} **Smart Summary** — Could not generate summary: ${errMsg}`)
    } catch {
      appendWrChatAssistant('\u{1F4CA} **Smart Summary** — Failed to reach the scan service.')
    }
  }, [onNavigateWrChat])

  const handleAutomationRun = useCallback(
    (modeId: string) => {
      if (!modeId) return

      const def = useCustomModesStore.getState().getById(modeId)
      if (!def) {
        console.warn('[MyAutomations] Mode not found:', modeId)
        return
      }

      const icon =
        getCustomModeTriggerBarIcon(def.metadata as Record<string, unknown> | undefined) ||
        def.icon?.trim() ||
        '\u26A1'
      const name = def.name.trim() || 'Automation'
      const desc = def.description?.trim()

      const mode = {
        mode: 'custom-automation' as const,
        modeId: def.id,
        modeName: name,
        triggerBarIcon: icon,
        startedAt: new Date().toISOString(),
      }

      const intro = `${icon} **${name}**${desc ? `\n\n${desc}` : ''}

Automation activated from the dashboard. Continue in WR Chat.`

      onNavigateWrChat?.()

      window.setTimeout(() => {
        useUIStore.getState().setWorkspace('wr-chat')
        if (def.modelName?.trim()) {
          useUIStore.getState().setMode(def.id)
        }

        useChatFocusStore.getState().setChatFocusWithIntro(mode, null, intro)

        try {
          window.dispatchEvent(new CustomEvent(WRCHAT_CHAT_FOCUS_REQUEST_EVENT, { detail: mode }))
        } catch {
          /* noop */
        }
      }, 100)
    },
    [onNavigateWrChat],
  )

  useEffect(() => {
    if (!selectedAutomationId) return
    if (!customModes.some((m) => m.id === selectedAutomationId)) setSelectedAutomationId('')
  }, [customModes, selectedAutomationId])

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
      // --- Row 1: Composers ---
      {
        id: 'reply-letter',
        accent: 'mail',
        icon: '\u{2709}\u{FE0F}',
        title: 'Letter Composer',
        valueLine: 'Create business letters with AI assistance.',
        onRun: () => onOpenLetterComposer?.(),
        onEdit: onNavigateWrChat,
      },
      {
        id: 'email-composer',
        accent: 'compose',
        icon: '\u{270D}\u{FE0F}',
        title: 'Email Composer',
        valueLine: 'Draft outbound mail with assistance.',
        composerId: 'emailComposer',
        onRun: () => onOpenEmailComposer?.(),
        onEdit: () => setIconPickerTarget('emailComposer'),
      },
      {
        id: 'beap-composer',
        accent: 'beap',
        icon: '\u{1F4E6}',
        title: 'BEAP Composer',
        valueLine: 'BEAP packages, handshakes, and encrypted flows.',
        composerId: 'beapComposer',
        onRun: () => onOpenBeapComposer?.(),
        onEdit: () => setIconPickerTarget('beapComposer'),
      },
      // --- Row 2: Actions + Intelligence (Card 6 follows as custom JSX) ---
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
        id: 'smart-summary',
        accent: 'summary',
        icon: '\u{1F4CA}',
        title: 'Smart Summary',
        valueLine: 'One-click overview of your workspace activity.',
        onRun: () => handleSmartSummaryRun?.(),
        onEdit: onNavigateWrChat,
      },
    ],
    [
      onNavigateBulkInbox,
      onNavigateInbox,
      onNavigateWrChat,
      onOpenEmailComposer,
      onOpenBeapComposer,
      onOpenLetterComposer,
      handleSmartSummaryRun,
    ],
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

  const handleAutomationEdit = useCallback((modeId: string) => {
    if (!modeId) return
    try {
      window.dispatchEvent(
        new CustomEvent(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, {
          detail: { editModeId: modeId },
        }),
      )
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
      {iconPickerTarget ? (
        <ComposerIconPickerDialog
          composerId={iconPickerTarget}
          currentIcon={composerIcons[iconPickerTarget]}
          onClose={() => setIconPickerTarget(null)}
        />
      ) : null}
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

      <div className="dash-auto-home__starters-grid automation-cards-grid" role="list">
        {starterCards.map((card) => {
          const resolvedIcon = resolveAutomationCardIcon(card.composerId, composerIcons, card.icon)
          const displayTitle = stripLeadingDisplayEmoji(card.title, resolvedIcon)
          return (
            <article
              key={card.id}
              role="listitem"
              className={['dash-auto-home__starter', `dash-auto-home__starter--accent-${card.accent}`].join(' ')}
            >
              <div className="dash-auto-home__starter-top">
                <span className="dash-auto-home__starter-icon-wrap" aria-hidden>
                  <span className="dash-auto-home__starter-icon">{resolvedIcon ?? ''}</span>
                </span>
                <h3 className="dash-auto-home__starter-title">{displayTitle}</h3>
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
          )
        })}

        <article
          role="listitem"
          className="dash-auto-home__starter dash-auto-home__starter--accent-automation"
          aria-labelledby="dash-auto-home-my-automations-title"
        >
          <div className="dash-auto-home__starter-header">
            <span className="dash-auto-home__starter-icon" aria-hidden>
              {'\u26A1'}
            </span>
            <h3 id="dash-auto-home-my-automations-title" className="dash-auto-home__starter-title">
              My Automations
            </h3>
          </div>

          {customModes.length === 0 ? (
            <p className="dash-auto-home__starter-value">No automations yet. Create one to get started.</p>
          ) : (
            <div className="dash-auto-home__automation-selector">
              <select
                id="dash-auto-home-automation-select"
                value={selectedAutomationId}
                onChange={(e) => setSelectedAutomationId(e.target.value)}
                className="dash-auto-home__automation-select"
                aria-label="Select a custom automation to run"
              >
                <option value="">Select an automation…</option>
                {customModesSorted.map((m) => (
                  <option key={m.id} value={m.id}>
                    {(m.icon?.trim() ? `${m.icon.trim()} ` : '') + m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="dash-auto-home__starter-actions">
            <button
              type="button"
              className="dash-auto-home__btn dash-auto-home__btn--primary"
              onClick={() => handleAutomationRun(selectedAutomationId)}
              disabled={customModes.length === 0 || !selectedAutomationId}
            >
              Run
            </button>
            {selectedAutomationId ? (
              <button
                type="button"
                className="dash-auto-home__btn dash-auto-home__btn--ghost"
                onClick={() => handleAutomationEdit(selectedAutomationId)}
              >
                Edit
              </button>
            ) : (
              <button
                type="button"
                className="dash-auto-home__btn dash-auto-home__btn--ghost dash-auto-home__btn--add-link"
                data-automation-ui-kind={ADD_AUTOMATION_ROW_UI_KIND}
                onClick={launchAddAutomationWizard}
              >
                + Add
              </button>
            )}
          </div>
        </article>
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
