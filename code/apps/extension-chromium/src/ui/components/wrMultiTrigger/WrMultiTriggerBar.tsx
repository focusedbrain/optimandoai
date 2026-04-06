import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WatchdogThreat } from '../../../utils/formatWatchdogAlert'
import { fetchTriggerProjects } from '../../../services/fetchTriggerProjects'
import {
  getOptimizerStatus,
  setOptimizerContinuous,
  triggerOptimizerSnapshot,
} from '../../../services/fetchOptimizerTrigger'
import type { ChatFocusMode, TriggerFunctionId, TriggerProjectEntry } from '../../../types/triggerTypes'
import { useChatFocusStore } from '../../../stores/chatFocusStore'
import { WATCHDOG_EMOJI } from '../WatchdogIcon'
import WrChatWatchdogButton from '../WrChatWatchdogButton'
import { TriggerButtonShell } from './TriggerButtonShell'

/** Dispatched on speech bubble click (also calls `onChatFocusRequest` if provided). */
export const WRCHAT_CHAT_FOCUS_REQUEST_EVENT = 'wrchat-chat-focus-request'

export type WrMultiTriggerBarProps = {
  theme?: string
  onWatchdogAlert: (threats: WatchdogThreat[]) => void
  /** Optional — if omitted, only the window event is fired. */
  onChatFocusRequest?: (mode: ChatFocusMode) => void
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

function buildDropdownRows(projects: TriggerProjectEntry[]) {
  const rows: { id: string; label: string; icon: string; functionId: TriggerFunctionId }[] = [
    {
      id: 'watchdog',
      label: 'Scam Watchdog',
      icon: WATCHDOG_EMOJI,
      functionId: { type: 'watchdog' },
    },
  ]
  for (const p of projects) {
    rows.push({
      id: p.projectId,
      label: p.title,
      icon: p.icon,
      functionId: { type: 'auto-optimizer', projectId: p.projectId },
    })
  }
  return rows
}

function functionIdKey(fid: TriggerFunctionId): string {
  return fid.type === 'watchdog' ? 'watchdog' : fid.projectId
}

export default function WrMultiTriggerBar({
  theme = 'pro',
  onWatchdogAlert,
  onChatFocusRequest,
}: WrMultiTriggerBarProps) {
  const [activeFunctionId, setActiveFunctionId] = useState<TriggerFunctionId>({ type: 'watchdog' })
  const [projectList, setProjectList] = useState<TriggerProjectEntry[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  /** Continuous optimization enabled per project (synced from GET …/optimize/status + checkbox). */
  const [optimizerIntervalByProject, setOptimizerIntervalByProject] = useState<Record<string, boolean>>({})
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

  const dropdownRows = useMemo(() => buildDropdownRows(projectList), [projectList])

  const activeProject = useMemo(() => {
    if (activeFunctionId.type !== 'auto-optimizer') return null
    return projectList.find((p) => p.projectId === activeFunctionId.projectId) ?? null
  }, [activeFunctionId, projectList])

  const selectedRowLabel = useMemo(() => {
    const row = dropdownRows.find((r) => functionIdKey(r.functionId) === functionIdKey(activeFunctionId))
    return row?.label ?? 'Scam Watchdog'
  }, [dropdownRows, activeFunctionId])

  const emitChatFocus = useCallback(() => {
    let mode: ChatFocusMode
    if (activeFunctionId.type === 'watchdog') {
      mode = { mode: 'scam-watchdog' }
      const intro = `🐕 **ScamWatchdog Mode Active**

I'm now focused on scam and fraud detection. You can:
- Share screenshots of suspicious messages, emails, or websites
- Paste suspicious text, URLs, or contact details for analysis
- Describe a situation you'd like me to evaluate for fraud potential

Send me anything you'd like analyzed.`
      useChatFocusStore.getState().setChatFocusWithIntro(mode, null, intro)
    } else {
      const pid = activeFunctionId.projectId
      const p = activeProject
      const icon = p?.icon?.trim() || '📊'
      const title = p?.title?.trim() || 'Project'
      const mile = p?.activeMilestoneTitle?.trim() || 'No active milestone'
      mode = {
        mode: 'auto-optimizer',
        projectId: pid,
        activeMilestoneId: undefined,
      }
      const meta = {
        projectTitle: title,
        activeMilestoneTitle: mile,
        projectIcon: icon,
      }
      const intro = `${icon} **Optimization Mode: ${title}**
Active milestone: ${mile}

I'm now focused on optimizing this project. You can:
- Share additional context about the current milestone
- Describe blockers or constraints the optimizer should consider
- Add reference materials or data relevant to the optimization

What information would you like to add?`
      useChatFocusStore.getState().setChatFocusWithIntro(mode, meta, intro)
    }
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
  }, [activeFunctionId, activeProject, onChatFocusRequest])

  const speechTooltipWatchdog = 'Focus chat on Scam Watchdog'
  const speechTooltipOptimizer = activeProject
    ? `Focus chat on ${activeProject.title}`
    : 'Focus chat on project'

  const optimizerPid =
    activeFunctionId.type === 'auto-optimizer' ? activeFunctionId.projectId : ''
  const optimizerIntervalOn = optimizerPid ? (optimizerIntervalByProject[optimizerPid] ?? false) : false
  const optimizerScanning = optimizerPid ? (optimizerScanningByProject[optimizerPid] ?? false) : false

  /** Refresh interval toggle from Electron when selecting an optimizer project. */
  useEffect(() => {
    if (activeFunctionId.type !== 'auto-optimizer') return
    const pid = activeFunctionId.projectId
    let cancelled = false
    void (async () => {
      const s = await getOptimizerStatus(pid)
      if (cancelled) return
      setOptimizerIntervalByProject((prev) => ({ ...prev, [pid]: s.enabled }))
    })()
    return () => {
      cancelled = true
    }
  }, [activeFunctionId])

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

  const handleOptimizerCheckbox = useCallback(
    async (enabled: boolean) => {
      if (activeFunctionId.type !== 'auto-optimizer') return
      const pid = activeFunctionId.projectId
      const result = await setOptimizerContinuous(pid, enabled)
      setOptimizerIntervalByProject((prev) => ({ ...prev, [pid]: result.enabled }))
    },
    [activeFunctionId],
  )

  const isLight = theme === 'standard'
  const isDark = theme === 'dark'
  const dropdownSurface = isLight
    ? { bg: '#ffffff', border: '#cbd5e1', text: '#0f172a', hover: '#f1f5f9' }
    : isDark
      ? { bg: 'rgba(15,23,42,0.95)', border: 'rgba(148,163,184,0.35)', text: '#f1f5f9', hover: 'rgba(99,102,241,0.25)' }
      : { bg: 'rgba(49,32,68,0.98)', border: 'rgba(167,139,250,0.45)', text: '#f5f3ff', hover: 'rgba(118,75,162,0.45)' }

  return (
    <div
      ref={rootRef}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
        position: 'relative',
      }}
    >
      <div style={{ position: 'relative' }}>
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
            width: 22,
            height: 22,
            padding: 0,
            borderRadius: 6,
            border: `1px solid ${dropdownSurface.border}`,
            background: isLight ? '#ffffff' : 'rgba(255,255,255,0.08)',
            color: dropdownSurface.text,
            cursor: 'pointer',
            fontSize: 10,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ▼
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
                    onClick={() => {
                      setActiveFunctionId(row.functionId)
                      setDropdownOpen(false)
                    }}
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
                    <span style={{ fontSize: 14, lineHeight: 1 }}>{row.icon}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.label}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>

      <div style={{ display: 'inline-flex', alignItems: 'center' }}>
        <div style={{ display: activeFunctionId.type === 'watchdog' ? 'inline-flex' : 'none' }}>
          <WrChatWatchdogButton
            theme={theme}
            onWatchdogAlert={onWatchdogAlert}
            middleSlot={
              <SpeechBubbleButton tooltip={speechTooltipWatchdog} onPress={emitChatFocus} />
            }
          />
        </div>
        <div style={{ display: activeFunctionId.type === 'auto-optimizer' ? 'inline-flex' : 'none' }}>
          <TriggerButtonShell
            theme={theme}
            icon={
              <span style={{ fontSize: 14, lineHeight: 1 }} aria-hidden>
                {activeProject?.icon ?? '📊'}
              </span>
            }
            scanning={optimizerScanning}
            intervalOn={optimizerIntervalOn}
            cleanFlash={false}
            onIconClick={() => void handleOptimizerIconClick()}
            onCheckboxToggle={(enabled) => void handleOptimizerCheckbox(enabled)}
            checkboxChecked={optimizerIntervalOn}
            disabled={false}
            middleSlot={
              <SpeechBubbleButton tooltip={speechTooltipOptimizer} onPress={emitChatFocus} />
            }
            scanButtonTitle={
              optimizerScanning
                ? 'Running optimization snapshot…'
                : 'Run optimization snapshot'
            }
            scanButtonAriaLabel="Run optimization snapshot for this project"
            cleanFlashAnnouncement="Nothing suspicious found on the screens"
          />
        </div>
      </div>
    </div>
  )
}
