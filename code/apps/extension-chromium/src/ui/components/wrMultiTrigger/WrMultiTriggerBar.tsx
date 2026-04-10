/**
 * Header **pinned automation launcher**: **Scam Watchdog** (security monitor) vs **Project WIKI** rows (per-project snapshot + chat focus).
 *
 * **Semantics:** Only **Scam Watchdog** uses `TriggerButtonShell` **continuous-monitor** — scan + **continuous** checkbox → `/api/wrchat/watchdog/*`. **Project** rows use **`mode="snapshot"`** — one-shot `triggerOptimizerSnapshot` + 💬; **no** continuous checkbox (repeat cadence lives on the Analysis dashboard).
 *
 * **Stable event names (do not rename):** `WRCHAT_CHAT_FOCUS_REQUEST_EVENT`, `WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT`, etc.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { WatchdogThreat } from '../../../utils/formatWatchdogAlert'
import { fetchTriggerProjects } from '../../../services/fetchTriggerProjects'
import { triggerOptimizerSnapshot } from '../../../services/fetchOptimizerTrigger'
import type { ChatFocusMode, TriggerFunctionId, TriggerProjectEntry } from '../../../types/triggerTypes'
import { useChatFocusStore } from '../../../stores/chatFocusStore'
import { useCustomModesStore } from '../../../stores/useCustomModesStore'
import { getCustomModeTriggerBarIcon } from '../../../shared/ui/customModeTypes'
import WatchdogIcon from '../WatchdogIcon'
import WrChatWatchdogButton from '../WrChatWatchdogButton'
import {
  ADD_AUTOMATION_ROW_UI_KIND,
  ADD_PROJECT_ASSISTANT_ROW_UI_KIND,
  automationUiKindFromTriggerFunctionId,
} from './automationUiKind'
import { TriggerButtonShell } from './TriggerButtonShell'

/**
 * Dispatched on speech bubble click (also calls `onChatFocusRequest` if provided).
 * **Do not rename** the string without updating all `addEventListener` / `dispatchEvent` sites.
 */
export const WRCHAT_CHAT_FOCUS_REQUEST_EVENT = 'wrchat-chat-focus-request'

/**
 * Opens the Add Automation flow (`AddModeWizardHost` in Electron `App.tsx` and extension surfaces).
 * **Do not rename** the string without updating `AddModeWizardHost` and any other listeners.
 */
export const WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT = 'wrchat-open-custom-mode-wizard'

/**
 * After Add Automation → Custom mode wizard saves successfully. Used for ModeSelect success toast.
 * **Do not rename** without updating `AddModeWizardHost` and `ModeSelect` listeners.
 */
export const WRCHAT_CUSTOM_MODE_WIZARD_SAVED = 'wrchat-custom-mode-wizard-saved'

/**
 * Request Project WIKI creation on the WR Desk Analysis dashboard (desktop shell).
 * **Do not rename** the event string without updating `App.tsx` and listeners.
 */
export const WRDESK_OPEN_PROJECT_ASSISTANT_CREATION = 'wrdesk-open-project-assistant-creation'

/**
 * Desktop Analysis dashboard: select the given project row in the trigger bar (auto-optimizer).
 * Keeps header selection aligned when opening Project WIKI from the dashboard home list.
 */
export const WRDESK_TRIGGER_SYNC_AUTO_OPTIMIZER_PROJECT = 'wrdesk-trigger-sync-auto-optimizer-project'

export type WrMultiTriggerBarProps = {
  theme?: string
  /** Fires whenever the selected trigger row (watchdog vs project) changes — for dashboard gating. */
  onActiveFunctionChange?: (functionId: TriggerFunctionId) => void
  onWatchdogAlert: (threats: WatchdogThreat[]) => void
  /** Optional — if omitted, only the window event is fired. */
  onChatFocusRequest?: (mode: ChatFocusMode) => void
  /**
   * When enabling WR Chat focus (speech / same-row toggle), host can show WR Chat first,
   * then call `applyFocus()` so intro messages reach a mounted chat surface.
   */
  onEnsureWrChatOpen?: (applyFocus: () => void) => void
}

function SpeechBubbleButton({
  tooltip,
  onPress,
}: {
  tooltip: string
  onPress: () => void
}) {
  return (
    <button
      type="button"
      title={tooltip}
      aria-label={tooltip}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onPress()
      }}
      style={{
        border: 'none',
        background: 'rgba(255,255,255,0.1)',
        borderRadius: 4,
        cursor: 'pointer',
        padding: '0 3px',
        fontSize: 12,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 22,
        height: 22,
        color: 'inherit',
        boxSizing: 'border-box',
      }}
    >
      💬
    </button>
  )
}

type TriggerBarDropdownRow = {
  id: string
  label: string
  icon: string
  functionId: TriggerFunctionId
  /** Derived in UI only; exposed on DOM for tests / future styling — does not affect selection or APIs. */
  automationUiKind: ReturnType<typeof automationUiKindFromTriggerFunctionId>
}

function buildProjectDropdownRows(projects: TriggerProjectEntry[]): TriggerBarDropdownRow[] {
  const rows: TriggerBarDropdownRow[] = []
  for (const p of projects) {
    const functionId: TriggerFunctionId = { type: 'auto-optimizer', projectId: p.projectId }
    rows.push({
      id: p.projectId,
      label: p.title,
      icon: p.icon,
      functionId,
      automationUiKind: automationUiKindFromTriggerFunctionId(functionId),
    })
  }
  return rows
}

function functionIdKey(fid: TriggerFunctionId): string {
  if (fid.type === 'watchdog') return 'watchdog'
  if (fid.type === 'auto-optimizer') return fid.projectId
  return fid.modeId
}

export default function WrMultiTriggerBar({
  theme = 'pro',
  onActiveFunctionChange,
  onWatchdogAlert,
  onChatFocusRequest,
  onEnsureWrChatOpen,
}: WrMultiTriggerBarProps) {
  const [activeFunctionId, setActiveFunctionId] = useState<TriggerFunctionId>({ type: 'watchdog' })
  const [projectList, setProjectList] = useState<TriggerProjectEntry[]>([])
  const customModes = useCustomModesStore(useShallow((s) => s.modes))
  const [dropdownOpen, setDropdownOpen] = useState(false)
  /** Snapshot request in flight per project (scanning pulse on icon). */
  const [optimizerScanningByProject, setOptimizerScanningByProject] = useState<Record<string, boolean>>({})

  const rootRef = useRef<HTMLDivElement>(null)

  const refreshProjects = useCallback(async () => {
    const list = await fetchTriggerProjects()
    setProjectList(list)
  }, [])

  useEffect(() => {
    void refreshProjects()
  }, [refreshProjects])

  useEffect(() => {
    onActiveFunctionChange?.(activeFunctionId)
  }, [activeFunctionId, onActiveFunctionChange])

  useEffect(() => {
    setActiveFunctionId((current) => {
      if (current.type !== 'custom-automation') return current
      const def = customModes.find((m) => m.id === current.modeId)
      const pin = def ? getCustomModeTriggerBarIcon(def.metadata as Record<string, unknown> | undefined) : ''
      if (!def || !pin) return { type: 'watchdog' }
      return current
    })
  }, [customModes])

  useEffect(() => {
    const onSync = (ev: Event) => {
      const pid = (ev as CustomEvent<{ projectId?: string }>).detail?.projectId
      if (typeof pid !== 'string' || !pid.trim()) return
      setActiveFunctionId({ type: 'auto-optimizer', projectId: pid.trim() })
    }
    window.addEventListener(WRDESK_TRIGGER_SYNC_AUTO_OPTIMIZER_PROJECT, onSync)
    return () => window.removeEventListener(WRDESK_TRIGGER_SYNC_AUTO_OPTIMIZER_PROJECT, onSync)
  }, [])

  useEffect(() => {
    if (dropdownOpen) void refreshProjects()
  }, [dropdownOpen, refreshProjects])

  useEffect(() => {
    if (!dropdownOpen) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [dropdownOpen])

  const pinnedCustomRows = useMemo(() => {
    const rows: TriggerBarDropdownRow[] = []
    for (const m of customModes) {
      const icon = getCustomModeTriggerBarIcon(m.metadata as Record<string, unknown> | undefined)
      if (!icon) continue
      const functionId: TriggerFunctionId = { type: 'custom-automation', modeId: m.id }
      rows.push({
        id: m.id,
        label: m.name.trim() || 'Automation',
        icon,
        functionId,
        automationUiKind: automationUiKindFromTriggerFunctionId(functionId),
      })
    }
    rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    return rows
  }, [customModes])

  const dropdownRows = useMemo((): TriggerBarDropdownRow[] => {
    const watchdogRow: TriggerBarDropdownRow = {
      id: 'watchdog',
      label: 'Scam Watchdog',
      icon: '',
      functionId: { type: 'watchdog' },
      automationUiKind: automationUiKindFromTriggerFunctionId({ type: 'watchdog' }),
    }
    return [watchdogRow, ...pinnedCustomRows, ...buildProjectDropdownRows(projectList)]
  }, [projectList, pinnedCustomRows])

  const activeProject = useMemo(() => {
    if (activeFunctionId.type !== 'auto-optimizer') return null
    return projectList.find((p) => p.projectId === activeFunctionId.projectId) ?? null
  }, [activeFunctionId, projectList])

  const activeCustomMode = useMemo(() => {
    if (activeFunctionId.type !== 'custom-automation') return null
    return customModes.find((m) => m.id === activeFunctionId.modeId) ?? null
  }, [activeFunctionId, customModes])

  const selectedRowLabel = useMemo(() => {
    const row = dropdownRows.find((r) => functionIdKey(r.functionId) === functionIdKey(activeFunctionId))
    return row?.label ?? 'Scam Watchdog'
  }, [dropdownRows, activeFunctionId])

  const emitChatFocus = useCallback(() => {
    const store = useChatFocusStore.getState()
    const current = store.chatFocusMode

    const clearAndNotify = () => {
      const mode: ChatFocusMode = { mode: 'default' }
      store.clearChatFocusMode()
      try {
        onChatFocusRequest?.(mode)
      } catch {
        /* noop */
      }
      try {
        window.dispatchEvent(new CustomEvent(WRCHAT_CHAT_FOCUS_REQUEST_EVENT, { detail: mode }))
      } catch {
        /* noop */
      }
    }

    const runAfterOpen = (applyFocus: () => void) => {
      if (onEnsureWrChatOpen) {
        onEnsureWrChatOpen(applyFocus)
      } else {
        applyFocus()
      }
    }

    if (activeFunctionId.type === 'custom-automation') {
      const def = activeCustomMode
      if (!def) return
      const icon =
        getCustomModeTriggerBarIcon(def.metadata as Record<string, unknown> | undefined) ||
        def.icon?.trim() ||
        '\u26A1'
      const name = def.name.trim() || 'Automation'
      if (current.mode === 'custom-automation' && current.modeId === def.id) {
        clearAndNotify()
        return
      }
      const mode: ChatFocusMode = {
        mode: 'custom-automation',
        modeId: def.id,
        modeName: name,
        triggerBarIcon: icon,
        startedAt: new Date().toISOString(),
      }
      const desc = def.description?.trim()
      const intro = `${icon} **${name}**${desc ? `\n\n${desc}` : ''}

I'm focused on this automation. Continue in WR Chat with the same model and settings you chose for this mode.`
      runAfterOpen(() => {
        useChatFocusStore.getState().setChatFocusWithIntro(mode, null, intro)
        try {
          onChatFocusRequest?.(mode)
        } catch {
          /* noop */
        }
        try {
          window.dispatchEvent(new CustomEvent(WRCHAT_CHAT_FOCUS_REQUEST_EVENT, { detail: mode }))
        } catch {
          /* noop */
        }
      })
      return
    }

    if (activeFunctionId.type === 'watchdog') {
      if (current.mode === 'scam-watchdog') {
        clearAndNotify()
        return
      }
      const mode: ChatFocusMode = { mode: 'scam-watchdog' }
      const intro = `🐕 **Scam Watchdog automation active**

I'm now focused on scam and fraud detection. You can:
- Share screenshots of suspicious messages, emails, or websites
- Paste suspicious text, URLs, or contact details for analysis
- Describe a situation you'd like me to evaluate for fraud potential

Send me anything you'd like analyzed.`
      runAfterOpen(() => {
        useChatFocusStore.getState().setChatFocusWithIntro(mode, null, intro)
        try {
          onChatFocusRequest?.(mode)
        } catch {
          /* noop */
        }
        try {
          window.dispatchEvent(new CustomEvent(WRCHAT_CHAT_FOCUS_REQUEST_EVENT, { detail: mode }))
        } catch {
          /* noop */
        }
      })
      return
    }

    const pid = activeFunctionId.projectId
    if (current.mode === 'auto-optimizer' && current.projectId === pid) {
      clearAndNotify()
      return
    }

    const p = activeProject
    const icon = p?.icon?.trim() || '📊'
    const title = p?.title?.trim() || 'Project'
    const mile = p?.activeMilestoneTitle?.trim() || 'No active milestone'
    const mode: ChatFocusMode = {
      mode: 'auto-optimizer',
      projectId: pid,
      projectTitle: title,
      startedAt: new Date().toISOString(),
      projectIcon: icon,
      milestoneTitle: mile !== 'No active milestone' ? mile : undefined,
      activeMilestoneId: undefined,
    }
    const meta = {
      projectTitle: title,
      activeMilestoneTitle: mile,
      projectIcon: icon,
    }
    const intro = `${icon} **Project WIKI: ${title}**
Active milestone: ${mile}

I'm focused on this project’s workspace. You can:
- Share context for the current milestone
- Describe blockers or constraints
- Add reference materials for the next snapshot run

What would you like to add?`
    runAfterOpen(() => {
      useChatFocusStore.getState().setChatFocusWithIntro(mode, meta, intro)
      try {
        onChatFocusRequest?.(mode)
      } catch {
        /* noop */
      }
      try {
        window.dispatchEvent(new CustomEvent(WRCHAT_CHAT_FOCUS_REQUEST_EVENT, { detail: mode }))
      } catch {
        /* noop */
      }
    })
  }, [activeFunctionId, activeProject, activeCustomMode, onChatFocusRequest, onEnsureWrChatOpen])

  const speechTooltipWatchdog = 'Toggle Scam Watchdog chat focus (on / off)'
  const speechTooltipOptimizer = activeProject
    ? `Toggle Project WIKI chat focus for ${activeProject.title} (on / off)`
    : 'Toggle Project WIKI chat focus (on / off)'
  const speechTooltipCustom = activeCustomMode
    ? `Toggle chat focus for ${activeCustomMode.name.trim() || 'automation'} (on / off)`
    : 'Toggle automation chat focus (on / off)'

  const optimizerPid =
    activeFunctionId.type === 'auto-optimizer' ? activeFunctionId.projectId : ''
  const optimizerScanning = optimizerPid ? (optimizerScanningByProject[optimizerPid] ?? false) : false

  const handleOptimizerIconClick = useCallback(async () => {
    if (activeFunctionId.type !== 'auto-optimizer') return
    const pid = activeFunctionId.projectId
    setOptimizerScanningByProject((prev) => ({ ...prev, [pid]: true }))
    try {
      await triggerOptimizerSnapshot(pid)
    } finally {
      setOptimizerScanningByProject((prev) => ({ ...prev, [pid]: false }))
    }
  }, [activeFunctionId])

  const handleDropdownRowClick = useCallback(
    (row: TriggerBarDropdownRow) => {
      const key = functionIdKey(row.functionId)
      const activeKey = functionIdKey(activeFunctionId)
      if (key === activeKey) {
        emitChatFocus()
        setDropdownOpen(false)
        return
      }
      setActiveFunctionId(row.functionId)
      setDropdownOpen(false)
    },
    [activeFunctionId, emitChatFocus],
  )

  const handleAddModeRowClick = useCallback(() => {
    setDropdownOpen(false)
    try {
      window.dispatchEvent(new CustomEvent(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT))
    } catch {
      /* noop */
    }
  }, [])

  const handleAddProjectAssistantRowClick = useCallback(() => {
    setDropdownOpen(false)
    try {
      window.dispatchEvent(new CustomEvent(WRDESK_OPEN_PROJECT_ASSISTANT_CREATION))
    } catch {
      /* noop */
    }
  }, [])

  const isLight = theme === 'standard'
  const isDark = theme === 'dark'
  const dropdownSurface = isLight
    ? { bg: '#ffffff', border: '#cbd5e1', text: '#0f172a', hover: '#f1f5f9' }
    : isDark
      ? { bg: 'rgba(15,23,42,0.95)', border: 'rgba(148,163,184,0.35)', text: '#f1f5f9', hover: 'rgba(99,102,241,0.25)' }
      : { bg: 'rgba(49,32,68,0.98)', border: 'rgba(167,139,250,0.45)', text: '#f5f3ff', hover: 'rgba(118,75,162,0.45)' }

  const dropdownLeadingSlot = (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => setDropdownOpen((o) => !o)}
        title={selectedRowLabel}
        aria-expanded={dropdownOpen}
        aria-haspopup="listbox"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 24,
          height: 28,
          padding: '0 5px',
          borderRadius: 6,
          border: 'none',
          background: isLight ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.08)',
          color: dropdownSurface.text,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 9, lineHeight: 1, opacity: 0.85 }} aria-hidden>
          ▼
        </span>
      </button>
      {dropdownOpen ? (
        <ul
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: 200,
            maxWidth: 280,
            maxHeight: 240,
            overflowY: 'auto',
            zIndex: 50,
            listStyle: 'none',
            margin: 0,
            padding: '6px 0',
            borderRadius: 8,
            border: `1px solid ${dropdownSurface.border}`,
            background: dropdownSurface.bg,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          {dropdownRows.map((row) => {
            const selected = functionIdKey(row.functionId) === functionIdKey(activeFunctionId)
            return (
              <li key={row.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-automation-ui-kind={row.automationUiKind}
                  onClick={() => handleDropdownRowClick(row)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    border: 'none',
                    background: selected ? dropdownSurface.hover : 'transparent',
                    color: dropdownSurface.text,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                  onMouseEnter={(e) => {
                    if (!selected) e.currentTarget.style.background = dropdownSurface.hover
                  }}
                  onMouseLeave={(e) => {
                    if (!selected) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {row.id === 'watchdog' ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                      <WatchdogIcon size={14} />
                    </span>
                  ) : (
                    <span style={{ fontSize: 14, lineHeight: 1 }}>{row.icon}</span>
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.label}
                  </span>
                </button>
              </li>
            )
          })}
          <li
            role="presentation"
            style={{
              borderTop: `1px solid ${dropdownSurface.border}`,
              marginTop: 4,
              paddingTop: 4,
            }}
          >
            <button
              type="button"
              role="option"
              data-automation-ui-kind={ADD_AUTOMATION_ROW_UI_KIND}
              onClick={handleAddModeRowClick}
              style={{
                width: '100%',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                border: 'none',
                background: 'transparent',
                color: dropdownSurface.text,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = dropdownSurface.hover
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }} aria-hidden>
                ✨
              </span>
              <span>+ Add Automation</span>
            </button>
          </li>
          <li role="presentation">
            <button
              type="button"
              role="option"
              data-automation-ui-kind={ADD_PROJECT_ASSISTANT_ROW_UI_KIND}
              onClick={handleAddProjectAssistantRowClick}
              style={{
                width: '100%',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                border: 'none',
                background: 'transparent',
                color: dropdownSurface.text,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = dropdownSurface.hover
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }} aria-hidden>
                📋
              </span>
              <span>+ Add Project WIKI</span>
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  )

  const customBarIcon =
    (activeCustomMode &&
      (getCustomModeTriggerBarIcon(activeCustomMode.metadata as Record<string, unknown> | undefined) ||
        activeCustomMode.icon?.trim())) ||
    '\u26A1'

  return (
    <div
      ref={rootRef}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center' }}>
        {activeFunctionId.type === 'watchdog' ? (
          <WrChatWatchdogButton
            theme={theme}
            onWatchdogAlert={onWatchdogAlert}
            selectorSlot={dropdownLeadingSlot}
            middleSlot={
              <SpeechBubbleButton tooltip={speechTooltipWatchdog} onPress={emitChatFocus} />
            }
          />
        ) : activeFunctionId.type === 'custom-automation' ? (
          <TriggerButtonShell
            mode="snapshot"
            theme={theme}
            selectorSlot={dropdownLeadingSlot}
            icon={
              <span style={{ fontSize: 14, lineHeight: 1 }} aria-hidden>
                {customBarIcon}
              </span>
            }
            scanning={false}
            cleanFlash={false}
            onIconClick={() => {
              /* Pinned automation: no project snapshot — icon is display-only. */
            }}
            disabled={false}
            middleSlot={<SpeechBubbleButton tooltip={speechTooltipCustom} onPress={emitChatFocus} />}
            scanButtonTitle="Pinned automation (no snapshot)"
            scanButtonAriaLabel="Pinned automation shortcut"
          />
        ) : (
          <TriggerButtonShell
            mode="snapshot"
            theme={theme}
            selectorSlot={dropdownLeadingSlot}
            icon={
              <span style={{ fontSize: 14, lineHeight: 1 }} aria-hidden>
                {activeProject?.icon ?? '\uD83D\uDCCA'}
              </span>
            }
            scanning={optimizerScanning}
            cleanFlash={false}
            onIconClick={() => void handleOptimizerIconClick()}
            disabled={false}
            middleSlot={
              <SpeechBubbleButton tooltip={speechTooltipOptimizer} onPress={emitChatFocus} />
            }
            scanButtonTitle={
              optimizerScanning ? 'Running snapshot…' : 'Run one-shot snapshot for this project'
            }
            scanButtonAriaLabel="Run one-shot snapshot for this project (Project WIKI)"
          />
        )}
      </div>
    </div>
  )
}
