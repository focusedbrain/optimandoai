import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { WatchdogThreat } from '../../utils/formatWatchdogAlert'
import WatchdogIcon from './WatchdogIcon'

const BASE_URL = 'http://127.0.0.1:51248'

export type { WatchdogThreat }

export interface WrChatWatchdogButtonProps {
  theme?: string
  onWatchdogAlert: (threats: WatchdogThreat[]) => void
}

const TOOLTIP_MAIN = 'Watchdog: Click to scan, check for continuous monitoring'
const TOOLTIP_CLEAN = 'Nothing suspicious found on the screens'
const CLEAN_FLASH_MS = 3200

function getLaunchSecret(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string } | null) => {
        if (chrome.runtime.lastError) resolve(null)
        else resolve(resp?.secret?.trim() ? resp.secret : null)
      })
    } catch {
      resolve(null)
    }
  })
}

function buildHeaders(secret: string | null): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' }
}

export default function WrChatWatchdogButton({ theme = 'pro', onWatchdogAlert }: WrChatWatchdogButtonProps) {
  const [continuousEnabled, setContinuousEnabled] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [hostOnline, setHostOnline] = useState(true)
  const [busyFlash, setBusyFlash] = useState(false)
  const [cleanFlash, setCleanFlash] = useState(false)
  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cleanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Dedupe: same scan triggers WATCHDOG_ALERT via runtime and threats in POST /scan JSON. */
  const lastAlertScanIdRef = useRef<string | null>(null)

  const onWatchdogAlertDeduped = useCallback(
    (scanId: string | undefined, threats: WatchdogThreat[]) => {
      if (!Array.isArray(threats) || threats.length === 0) return
      const sid = (scanId ?? '').trim()
      if (sid && lastAlertScanIdRef.current === sid) return
      if (sid) lastAlertScanIdRef.current = sid
      onWatchdogAlert(threats)
    },
    [onWatchdogAlert],
  )

  const scheduleCleanFlash = useCallback(() => {
    setCleanFlash(true)
    if (cleanTimerRef.current) clearTimeout(cleanTimerRef.current)
    cleanTimerRef.current = setTimeout(() => {
      setCleanFlash(false)
      cleanTimerRef.current = null
    }, CLEAN_FLASH_MS)
  }, [])

  const isLight = theme === 'standard'
  const isDark = theme === 'dark'

  const syncStatus = useCallback(async () => {
    try {
      const secret = await getLaunchSecret()
      const res = await fetch(`${BASE_URL}/api/wrchat/watchdog/status`, {
        method: 'GET',
        headers: buildHeaders(secret),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        setHostOnline(false)
        return
      }
      setHostOnline(true)
      const j = (await res.json().catch(() => null)) as {
        continuous?: boolean
        scanning?: boolean
        config?: { enabled?: boolean }
      } | null
      if (!j || typeof j !== 'object') return
      if (typeof j.continuous === 'boolean') setContinuousEnabled(j.continuous)
      if (typeof j.scanning === 'boolean') setScanning(j.scanning)
    } catch {
      setHostOnline(false)
    }
  }, [])

  useEffect(() => {
    void syncStatus()
  }, [syncStatus])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void syncStatus()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [syncStatus])

  useEffect(() => {
    const onMsg = (message: unknown) => {
      if (!message || typeof message !== 'object') return
      const msg = message as {
        type?: string
        threats?: unknown
        scanId?: string
      }
      if (msg.type === 'WATCHDOG_ALERT' && Array.isArray(msg.threats) && msg.threats.length > 0) {
        try {
          onWatchdogAlertDeduped(msg.scanId, msg.threats as WatchdogThreat[])
        } catch {
          /* noop */
        }
        return
      }
      if (msg.type === 'WATCHDOG_SCAN_CLEAN') {
        scheduleCleanFlash()
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
        if (busyTimerRef.current) clearTimeout(busyTimerRef.current)
        if (cleanTimerRef.current) clearTimeout(cleanTimerRef.current)
      }
    } catch {
      return undefined
    }
  }, [onWatchdogAlertDeduped, scheduleCleanFlash])

  const handleScanClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      try {
        const secret = await getLaunchSecret()
        setScanning(true)
        const res = await fetch(`${BASE_URL}/api/wrchat/watchdog/scan`, {
          method: 'POST',
          headers: buildHeaders(secret),
          signal: AbortSignal.timeout(600_000),
        })
        if (res.status === 429) {
          setBusyFlash(true)
          if (busyTimerRef.current) clearTimeout(busyTimerRef.current)
          busyTimerRef.current = setTimeout(() => {
            setBusyFlash(false)
            busyTimerRef.current = null
          }, 2500)
          return
        }
        if (!res.ok) {
          setHostOnline(false)
          return
        }
        setHostOnline(true)
        const j = (await res.json().catch(() => null)) as {
          result?: { threats?: WatchdogThreat[]; scanId?: string }
        } | null
        const threats = j?.result?.threats
        const scanId = typeof j?.result?.scanId === 'string' ? j.result.scanId : undefined
        if (Array.isArray(threats) && threats.length > 0) {
          try {
            onWatchdogAlertDeduped(scanId, threats)
          } catch {
            /* noop */
          }
        } else if (Array.isArray(threats) && threats.length === 0) {
          /** Manual scan finished clean — green icon feedback (same as WATCHDOG_SCAN_CLEAN). */
          scheduleCleanFlash()
        }
      } catch {
        setHostOnline(false)
      } finally {
        try {
          const secret = await getLaunchSecret()
          const r = await fetch(`${BASE_URL}/api/wrchat/watchdog/status`, {
            method: 'GET',
            headers: buildHeaders(secret),
            signal: AbortSignal.timeout(10000),
          })
          if (r.ok) {
            const st = (await r.json().catch(() => null)) as { scanning?: boolean } | null
            if (st && typeof st.scanning === 'boolean') setScanning(st.scanning)
            else setScanning(false)
          } else {
            setScanning(false)
          }
        } catch {
          setScanning(false)
        }
      }
    },
    [onWatchdogAlertDeduped, scheduleCleanFlash],
  )


  const stopCheckboxBubble = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  const handleToggleContinuous = useCallback(
    async (e: React.MouseEvent | React.KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!hostOnline) return
      const next = !continuousEnabled
      const prev = continuousEnabled
      setContinuousEnabled(next)
      try {
        const secret = await getLaunchSecret()
        const res = await fetch(`${BASE_URL}/api/wrchat/watchdog/continuous`, {
          method: 'POST',
          headers: buildHeaders(secret),
          body: JSON.stringify({ enabled: next }),
          signal: AbortSignal.timeout(30000),
        })
        if (!res.ok) {
          setContinuousEnabled(prev)
          return
        }
        setHostOnline(true)
      } catch {
        setContinuousEnabled(prev)
        setHostOnline(false)
      }
    },
    [continuousEnabled, hostOnline],
  )

  const continuousPulse = continuousEnabled
  const showIntervalOnIcon = continuousPulse && !cleanFlash
  const showBusyTitle = busyFlash ? 'Scan already running' : TOOLTIP_MAIN
  const scanButtonTitle = cleanFlash
    ? TOOLTIP_CLEAN
    : continuousPulse
      ? `${TOOLTIP_MAIN} — Interval monitoring is on`
      : showBusyTitle

  const buttonStyleComfortable: React.CSSProperties = {
    padding: '0 8px',
    height: '22px',
    fontSize: '10px',
    fontWeight: 500,
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    minWidth: 28,
    boxSizing: 'border-box',
    border: isLight
      ? '1px solid #94a3b8'
      : isDark
        ? '1px solid rgba(255,255,255,0.2)'
        : '1px solid rgba(255,255,255,0.45)',
    background: isLight ? '#ffffff' : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(118,75,162,0.35)',
    color: isLight ? '#0f172a' : isDark ? '#f1f5f9' : '#ffffff',
    transition: 'background 0.2s ease, box-shadow 0.2s ease',
    ...(continuousPulse && !cleanFlash
      ? { animation: 'wr-watchdog-border-pulse 2s ease-in-out infinite' }
      : {}),
    ...(cleanFlash
      ? {
          boxShadow: '0 0 0 2px rgba(34,197,94,0.9), 0 0 12px rgba(34,197,94,0.35)',
          background: isLight
            ? 'rgba(220,252,231,0.98)'
            : isDark
              ? 'rgba(34,197,94,0.22)'
              : 'rgba(34,197,94,0.42)',
          borderColor: 'rgba(34,197,94,0.75)',
        }
      : {}),
    ...(!hostOnline ? { opacity: 0.55 } : {}),
  }

  return (
    <>
      <style>{`
        @keyframes wr-watchdog-border-pulse {
          0%, 100% { box-shadow: 0 0 0 1px rgba(34,197,94,0.45); }
          50% { box-shadow: 0 0 0 3px rgba(34,197,94,0.35); }
        }
        @keyframes wr-watchdog-icon-interval-pulse {
          0%, 100% { box-shadow: 0 0 0 1px rgba(34,197,94,0.55); }
          50% { box-shadow: 0 0 0 5px rgba(34,197,94,0.3); }
        }
        @keyframes wr-watchdog-scan-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
        .wr-watchdog-icon-wrap.scanning {
          display: inline-flex;
          animation: wr-watchdog-scan-pulse 0.85s ease-in-out infinite;
        }
        .wr-watchdog-icon-wrap.interval-on:not(.scanning) {
          display: inline-flex;
          animation: wr-watchdog-icon-interval-pulse 2s ease-in-out infinite;
        }
        .wr-watchdog-icon-wrap.interval-on.scanning {
          display: inline-flex;
          animation: wr-watchdog-scan-pulse 0.85s ease-in-out infinite,
            wr-watchdog-icon-interval-pulse 2s ease-in-out infinite;
        }
      `}</style>
      <button
        type="button"
        onClick={handleScanClick}
        title={scanButtonTitle}
        aria-label={
          cleanFlash ? TOOLTIP_CLEAN : continuousPulse ? 'Watchdog scan — interval monitoring on' : 'Watchdog scan'
        }
        disabled={!hostOnline}
        style={buttonStyleComfortable}
        onMouseEnter={(e) => {
          if (!hostOnline || cleanFlash) return
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
          if (cleanFlash) return
          if (isLight) {
            e.currentTarget.style.background = '#ffffff'
            e.currentTarget.style.color = '#0f172a'
          } else if (isDark) {
            e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
          } else {
            e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
          }
        }}
      >
        <span
          className={`wr-watchdog-icon-wrap ${scanning ? 'scanning' : ''} ${showIntervalOnIcon ? 'interval-on' : ''}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            padding: cleanFlash ? '1px 3px' : showIntervalOnIcon ? '2px 4px' : 0,
            background: cleanFlash
              ? 'rgba(34,197,94,0.28)'
              : showIntervalOnIcon
                ? 'rgba(34,197,94,0.12)'
                : 'transparent',
            transition: 'background 0.2s ease',
          }}
        >
          <WatchdogIcon size={16} />
        </span>
        {cleanFlash ? (
          <span
            style={{
              fontSize: 12,
              lineHeight: 1,
              color: isLight ? '#16a34a' : '#4ade80',
              marginLeft: 2,
              fontWeight: 700,
            }}
            aria-hidden
          >
            ✓
          </span>
        ) : null}
        {cleanFlash ? (
          <span
            aria-live="polite"
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: 'hidden',
              clip: 'rect(0, 0, 0, 0)',
              whiteSpace: 'nowrap',
              border: 0,
            }}
          >
            {TOOLTIP_CLEAN}
          </span>
        ) : null}
        {/* Custom checkbox span — <input> inside <button> is invalid HTML and breaks the DOM */}
        <span
          role="checkbox"
          aria-checked={continuousEnabled}
          aria-disabled={!hostOnline}
          title="Continuous monitoring (every interval)"
          onClick={handleToggleContinuous}
          onMouseDown={stopCheckboxBubble}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') void handleToggleContinuous(e)
          }}
          tabIndex={hostOnline ? 0 : -1}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 11,
            height: 11,
            marginLeft: 3,
            flexShrink: 0,
            borderRadius: 2,
            border: continuousEnabled
              ? '1.5px solid #22c55e'
              : isLight
                ? '1.5px solid #94a3b8'
                : '1.5px solid rgba(255,255,255,0.55)',
            background: continuousEnabled ? '#22c55e' : 'transparent',
            cursor: hostOnline ? 'pointer' : 'not-allowed',
            opacity: hostOnline ? 1 : 0.5,
            transition: 'background 0.15s ease, border-color 0.15s ease',
            boxSizing: 'border-box',
          }}
        >
          {continuousEnabled && (
            <svg width="7" height="7" viewBox="0 0 8 8" fill="none" aria-hidden>
              <polyline points="1.5,4 3.5,6 6.5,2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </button>
    </>
  )
}
