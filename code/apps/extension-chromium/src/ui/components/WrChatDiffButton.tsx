/**
 * WR Chat top-bar "Diff" control: folder diff watchers + dialog + orchestrator sync.
 * Relays DIFF_RESULT / DIFF_ERROR from background (Electron WebSocket → runtime message).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DiffTrigger } from '@shared/wrChat/diffTrigger'
import { DiffTriggerDialog } from './DiffTriggerDialog'

const BASE_URL = 'http://127.0.0.1:51248'
const DIFF_TITLE = 'Folder diff watchers — configure and monitor paths'

function getLaunchSecret(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string | null } | undefined) => {
        if (chrome.runtime.lastError) resolve(null)
        else resolve(resp?.secret?.trim() ? resp.secret : null)
      })
    } catch {
      resolve(null)
    }
  })
}

/** Minimal icon — matches capture button visual weight */
export function WrChatDiffIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Left column — removed lines */}
      <line x1="3" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="3" y1="10" x2="10" y2="10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {/* Minus badge */}
      <circle cx="7" cy="15" r="4" stroke="currentColor" strokeWidth="1.6" />
      <line x1="4.8" y1="15" x2="9.2" y2="15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {/* Right column — added lines */}
      <line x1="14" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="14" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {/* Plus badge */}
      <circle cx="17" cy="15" r="4" stroke="currentColor" strokeWidth="1.6" />
      <line x1="14.8" y1="15" x2="19.2" y2="15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="17" y1="12.8" x2="17" y2="17.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export type WrChatDiffButtonProps = {
  variant: 'compact' | 'comfortable'
  theme: 'pro' | 'dark' | 'standard'
  sidepanelPreset?: 'enterprise' | 'appBar'
  /** Parent injects diff text into WR Chat (same role as send). */
  onDiffMessage: (message: string) => void
  /** IDs of diff watchers pinned to the top-edge strip. */
  pinnedDiffIds?: string[]
  /** Toggle pin state for a diff watcher. */
  onToggleDiffPin?: (id: string) => void
}

export const WrChatDiffButton: React.FC<WrChatDiffButtonProps> = ({
  variant,
  theme,
  sidepanelPreset,
  onDiffMessage,
  pinnedDiffIds = [],
  onToggleDiffPin,
}) => {
  const [watchers, setWatchers] = useState<DiffTrigger[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [statusFlash, setStatusFlash] = useState<string | null>(null)
  const [hostOffline, setHostOffline] = useState(false)
  const [diffPulse, setDiffPulse] = useState(false)
  const lastGoodRef = useRef<DiffTrigger[]>([])

  const anyActive = useMemo(
    () => watchers.some((w) => w.type === 'diff' && w.enabled),
    [watchers],
  )

  const loadWatchers = useCallback(async () => {
    try {
      const secret = await getLaunchSecret()
      const r = await fetch(`${BASE_URL}/api/wrchat/diff-watchers`, {
        headers: { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' },
        signal: AbortSignal.timeout(15000),
      })
      if (!r.ok) {
        setHostOffline(true)
        return
      }
      const j = (await r.json().catch(() => ({}))) as { watchers?: unknown }
      if (Array.isArray(j.watchers)) {
        const list = j.watchers as DiffTrigger[]
        setWatchers(list)
        lastGoodRef.current = list
      }
      setHostOffline(false)
    } catch {
      setHostOffline(true)
    }
  }, [])

  useEffect(() => {
    void loadWatchers().catch(() => {
      /* ignore */
    })
  }, [loadWatchers])

  useEffect(() => {
    if (!dialogOpen) return
    void loadWatchers().catch(() => {
      /* ignore */
    })
  }, [dialogOpen, loadWatchers])

  useEffect(() => {
    if (!diffPulse) return
    const t = window.setTimeout(() => setDiffPulse(false), 900)
    return () => window.clearTimeout(t)
  }, [diffPulse])

  const postWatchers = useCallback(async (next: DiffTrigger[], rollback: DiffTrigger[]) => {
    setWatchers(next)
    try {
      const secret = await getLaunchSecret()
      const r = await fetch(`${BASE_URL}/api/wrchat/diff-watchers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' },
        body: JSON.stringify({ watchers: next }),
        signal: AbortSignal.timeout(30000),
      })
      const text = await r.text().catch(() => '')
      if (!r.ok) {
        throw new Error(text.slice(0, 200) || `HTTP ${r.status}`)
      }
      lastGoodRef.current = next
      setHostOffline(false)
    } catch (e) {
      setWatchers(rollback)
      const msg = e instanceof Error ? e.message : String(e)
      alert(`Diff watchers sync failed — reverted.\n${msg}`)
    }
  }, [])

  const handleSave = useCallback(
    (w: DiffTrigger) => {
      const rollback = [...watchers]
      const idx = watchers.findIndex((x) => x.id === w.id)
      const next =
        idx >= 0 ? [...watchers.slice(0, idx), w, ...watchers.slice(idx + 1)] : [...watchers, w]
      void postWatchers(next, rollback)
    },
    [watchers, postWatchers],
  )

  const handleToggle = useCallback(
    (id: string, enabled: boolean) => {
      const rollback = [...watchers]
      const next = watchers.map((w) => (w.id === id ? { ...w, enabled, updatedAt: Date.now() } : w))
      void postWatchers(next, rollback)
    },
    [watchers, postWatchers],
  )

  const handleDelete = useCallback(
    (id: string) => {
      const rollback = [...watchers]
      const next = watchers.filter((w) => w.id !== id)
      void postWatchers(next, rollback)
    },
    [watchers, postWatchers],
  )

  useEffect(() => {
    const onMsg = (message: unknown) => {
      if (!message || typeof message !== 'object') return
      const msg = message as { type?: string; message?: string; triggerId?: string; error?: string }
      if (msg.type === 'DIFF_RESULT' && typeof msg.message === 'string' && msg.message.length > 0) {
        setDiffPulse(true)
        try {
          onDiffMessage(msg.message)
        } catch {
          /* noop */
        }
        return
      }
      if (msg.type === 'DIFF_ERROR') {
        const tid = msg.triggerId
        const err = typeof msg.error === 'string' && msg.error.trim() ? msg.error : 'Diff watcher error'
        if (tid) {
          setWatchers((prev) =>
            prev.map((w) => (w.id === tid ? { ...w, enabled: false, updatedAt: Date.now() } : w)),
          )
        }
        setStatusFlash(err)
        window.setTimeout(() => setStatusFlash(null), 5000)
      }
    }
    try {
      chrome.runtime.onMessage.addListener(onMsg)
      return () => {
        try {
          chrome.runtime.onMessage.removeListener(onMsg)
        } catch {
          /* noop */
        }
      }
    } catch {
      return undefined
    }
  }, [onDiffMessage])

  const onClick = useCallback(() => setDialogOpen(true), [])

  const isLight = theme === 'standard'
  const isDark = theme === 'dark'
  /** Compact sidepanel: smaller glyph + dot so workspace/trigger selects are not squeezed */
  const iconSize = variant === 'comfortable' ? 12 : 11
  const preset = sidepanelPreset ?? 'enterprise'
  const dotSize = variant === 'comfortable' ? 6 : 4

  const dot = anyActive ? (
    <span
      title="At least one watcher is on"
      style={{
        width: dotSize,
        height: dotSize,
        borderRadius: '50%',
        background: '#22c55e',
        flexShrink: 0,
        boxShadow: '0 0 0 1px rgba(0,0,0,0.15)',
      }}
    />
  ) : null

  if (variant === 'comfortable') {
    return (
      <>
        {statusFlash ? (
          <div
            role="status"
            style={{
              position: 'fixed',
              bottom: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 100001,
              maxWidth: '90vw',
              padding: '8px 12px',
              fontSize: 11,
              borderRadius: 8,
              background: 'rgba(15,23,42,0.92)',
              color: '#fecaca',
              border: '1px solid rgba(248,113,113,0.4)',
              pointerEvents: 'none',
            }}
          >
            {statusFlash}
          </div>
        ) : null}
        <DiffTriggerDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          watchers={watchers}
          onSave={handleSave}
          onToggle={handleToggle}
          onDelete={handleDelete}
          theme={theme}
          hostOffline={hostOffline}
          pinnedDiffIds={pinnedDiffIds}
          onToggleDiffPin={onToggleDiffPin}
        />
        <button
          type="button"
          onClick={onClick}
          title={DIFF_TITLE}
          aria-label="Diff watchers"
          style={{
            padding: '0 10px',
            height: '22px',
            fontSize: '10px',
            fontWeight: 500,
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            boxShadow: diffPulse
              ? '0 0 0 2px rgba(250,204,21,0.95), 0 0 14px rgba(250,204,21,0.45)'
              : 'none',
            border: isLight
              ? '1px solid #94a3b8'
              : isDark
                ? '1px solid rgba(255,255,255,0.2)'
                : '1px solid rgba(255,255,255,0.45)',
            background: isLight ? '#ffffff' : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(118,75,162,0.35)',
            color: isLight ? '#0f172a' : isDark ? '#f1f5f9' : '#ffffff',
            transition: 'background 0.2s ease, box-shadow 0.2s ease',
            minWidth: 28,
            boxSizing: 'border-box',
          }}
          onMouseEnter={(e) => {
            if (isLight) {
              e.currentTarget.style.background = '#eef3f6'
              e.currentTarget.style.color = '#0f172a'
            } else if (isDark) {
              e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
            } else {
              e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
            }
          }}
          onMouseLeave={(e) => {
            if (isLight) {
              e.currentTarget.style.background = '#ffffff'
              e.currentTarget.style.color = '#0f172a'
            } else if (isDark) {
              e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
            } else {
              e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
            }
          }}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow = isLight
              ? '0 0 0 2px rgba(99,102,241,0.45)'
              : '0 0 0 2px rgba(167,139,250,0.55)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = 'none'
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 3 }}>
            <WrChatDiffIcon size={iconSize} />
            {dot}
          </span>
          <span>Diff</span>
        </button>
      </>
    )
  }

  const isStandard = theme === 'standard'
  const baseEnterprise = (): React.CSSProperties => ({
    borderRadius: '6px',
    padding: '0 5px',
    height: '24px',
    minWidth: '22px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    transition: 'all 0.2s ease',
    ...(isStandard
      ? {
          color: '#0f172a',
          border: '1px solid #94a3b8',
          background: '#ffffff',
          boxShadow: 'none',
        }
      : isDark
        ? {
            color: '#f1f5f9',
            border: 'none',
            background: 'rgba(255,255,255,0.15)',
            boxShadow: 'none',
          }
        : {
            color: '#ffffff',
            border: 'none',
            background: 'rgba(255,255,255,0.15)',
            boxShadow: 'none',
          }),
  })

  const baseAppBar = (): React.CSSProperties => ({
    borderRadius: '6px',
    padding: '0 5px',
    height: '24px',
    minWidth: '22px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    transition: 'all 0.2s ease',
    ...(isStandard
      ? {
          color: '#0f172a',
          background: 'rgba(15,23,42,0.08)',
          border: '1px solid #94a3b8',
        }
      : isDark
        ? {
            color: '#f1f5f9',
            background: 'rgba(255,255,255,0.15)',
          }
        : {
            color: '#ffffff',
            background: 'rgba(255,255,255,0.15)',
            border: 'none',
          }),
  })

  const styleBase = preset === 'appBar' ? baseAppBar() : baseEnterprise()

  const onMouseEnterEnterprise = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    if (isStandard) {
      el.style.background = '#eef3f6'
      el.style.color = '#0f172a'
    } else if (isDark) {
      el.style.background = 'rgba(255,255,255,0.22)'
      el.style.color = '#f1f5f9'
    } else {
      el.style.background = 'rgba(255,255,255,0.25)'
      el.style.color = '#ffffff'
    }
  }
  const onMouseLeaveEnterprise = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    if (isStandard) {
      el.style.background = '#ffffff'
      el.style.color = '#0f172a'
    } else if (isDark) {
      el.style.background = 'rgba(255,255,255,0.15)'
      el.style.color = '#f1f5f9'
    } else {
      el.style.background = 'rgba(255,255,255,0.15)'
      el.style.color = '#ffffff'
    }
  }

  const onMouseEnterAppBar = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    if (isStandard) {
      el.style.background = 'rgba(15,23,42,0.12)'
      el.style.color = '#0f172a'
    } else if (isDark) {
      el.style.background = 'rgba(255,255,255,0.22)'
      el.style.color = '#f1f5f9'
    } else {
      el.style.background = 'rgba(255,255,255,0.25)'
      el.style.color = '#ffffff'
    }
  }
  const onMouseLeaveAppBar = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    if (isStandard) {
      el.style.background = 'rgba(15,23,42,0.08)'
      el.style.color = '#0f172a'
    } else if (isDark) {
      el.style.background = 'rgba(255,255,255,0.15)'
      el.style.color = '#f1f5f9'
    } else {
      el.style.background = 'rgba(255,255,255,0.15)'
      el.style.color = '#ffffff'
    }
  }

  return (
    <>
      {statusFlash ? (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100001,
            maxWidth: '90vw',
            padding: '8px 12px',
            fontSize: 11,
            borderRadius: 8,
            background: 'rgba(15,23,42,0.92)',
            color: '#fecaca',
            border: '1px solid rgba(248,113,113,0.4)',
            pointerEvents: 'none',
          }}
        >
          {statusFlash}
        </div>
      ) : null}
      <DiffTriggerDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        watchers={watchers}
        onSave={handleSave}
        onToggle={handleToggle}
        onDelete={handleDelete}
        theme={theme}
        hostOffline={hostOffline}
        pinnedDiffIds={pinnedDiffIds}
        onToggleDiffPin={onToggleDiffPin}
      />
      <button
        type="button"
        onClick={onClick}
        title={DIFF_TITLE}
        aria-label="Diff watchers"
        style={{
          ...styleBase,
          boxShadow: diffPulse
            ? '0 0 0 2px rgba(250,204,21,0.95), 0 0 14px rgba(250,204,21,0.45)'
            : styleBase.boxShadow ?? 'none',
          transition: 'box-shadow 0.2s ease',
        }}
        onMouseEnter={preset === 'appBar' ? onMouseEnterAppBar : onMouseEnterEnterprise}
        onMouseLeave={preset === 'appBar' ? onMouseLeaveAppBar : onMouseLeaveEnterprise}
        onFocus={(e) => {
          e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.55)'
        }}
        onBlur={(e) => {
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        <WrChatDiffIcon size={iconSize} />
        {dot}
      </button>
    </>
  )
}
