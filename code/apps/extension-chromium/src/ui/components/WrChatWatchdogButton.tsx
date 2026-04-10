/**
 * **Scam Watchdog** scan + **continuous** checkbox — HTTP `/api/wrchat/watchdog/*` only.
 *
 * **Not** the same as project **auto-optimization** (`/api/projects/.../optimize/...` / `__wrdeskOptimizerHttp`).
 * Shared UI is `TriggerButtonShell`; behavior and endpoints must stay separate. See `WrMultiTriggerBar` file doc.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { WatchdogThreat } from '../../utils/formatWatchdogAlert'
import WatchdogIcon from './WatchdogIcon'
import { TriggerButtonShell } from './wrMultiTrigger'

const BASE_URL = 'http://127.0.0.1:51248'

export type { WatchdogThreat }

export interface WrChatWatchdogButtonProps {
  theme?: string
  onWatchdogAlert: (threats: WatchdogThreat[]) => void
  /** Function selector inside the bar — after scan icon. */
  selectorSlot?: React.ReactNode
  /** Speech bubble — last in the bar, after the continuous checkbox (WrMultiTriggerBar). */
  middleSlot?: React.ReactNode
}

const TOOLTIP_MAIN = 'Scam Watchdog — click to run a scan; use the checkbox for continuous checks'
const TOOLTIP_CLEAN = 'Nothing suspicious found on the screens'
const CLEAN_FLASH_MS = 3200

function getLaunchSecret(): Promise<string | null> {
  return new Promise((resolve) => {
    // Extension context: use chrome.runtime message to background.
    try {
      chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string } | null) => {
        if (chrome.runtime.lastError) {
          // Fall through to Electron fallback below.
          resolveElectronFallback(resolve)
        } else {
          const s = resp?.secret?.trim() ? resp.secret : null
          if (s) resolve(s)
          else resolveElectronFallback(resolve)
        }
      })
    } catch {
      // chrome.runtime not available (Electron dashboard renderer) — use pqHeaders fallback.
      resolveElectronFallback(resolve)
    }
  })
}

/** Electron-only: pull X-Launch-Secret from window.handshakeView.pqHeaders(). */
function resolveElectronFallback(resolve: (v: string | null) => void): void {
  try {
    const pqHeaders = (window as any).handshakeView?.pqHeaders
    if (typeof pqHeaders === 'function') {
      ;(pqHeaders() as Promise<Record<string, string>>)
        .then((h) => resolve(h?.['X-Launch-Secret']?.trim() || null))
        .catch(() => resolve(null))
    } else {
      resolve(null)
    }
  } catch {
    resolve(null)
  }
}

function buildHeaders(secret: string | null): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' }
}

/** @deprecated Use WrMultiTriggerBar for WR Chat header controls (Watchdog, optimizer, chat focus). */
export default function WrChatWatchdogButton({
  theme = 'pro',
  onWatchdogAlert,
  selectorSlot,
  middleSlot,
}: WrChatWatchdogButtonProps) {
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

  const runManualScan = useCallback(async () => {
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
  }, [onWatchdogAlertDeduped, scheduleCleanFlash])

  const handleCheckboxToggle = useCallback(
    async (enabled: boolean) => {
      if (!hostOnline) return
      const prev = continuousEnabled
      setContinuousEnabled(enabled)
      try {
        const secret = await getLaunchSecret()
        const res = await fetch(`${BASE_URL}/api/wrchat/watchdog/continuous`, {
          method: 'POST',
          headers: buildHeaders(secret),
          body: JSON.stringify({ enabled }),
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
  const showBusyTitle = busyFlash ? 'Scan already running' : TOOLTIP_MAIN
  const scanButtonTitle = cleanFlash
    ? TOOLTIP_CLEAN
    : continuousPulse
      ? `${TOOLTIP_MAIN} — Continuous monitoring is on`
      : showBusyTitle

  const scanButtonAriaLabel =
    cleanFlash
      ? TOOLTIP_CLEAN
      : continuousPulse
        ? 'Scam Watchdog scan — continuous monitoring on'
        : 'Scam Watchdog — run scan'

  return (
    <TriggerButtonShell
      mode="continuous-monitor"
      theme={theme}
      selectorSlot={selectorSlot}
      icon={<WatchdogIcon size={16} />}
      scanning={scanning}
      intervalOn={continuousEnabled}
      cleanFlash={cleanFlash}
      onIconClick={() => void runManualScan()}
      onCheckboxToggle={(enabled) => void handleCheckboxToggle(enabled)}
      checkboxChecked={continuousEnabled}
      disabled={!hostOnline}
      middleSlot={middleSlot}
      scanButtonTitle={scanButtonTitle}
      scanButtonAriaLabel={scanButtonAriaLabel}
      cleanFlashAnnouncement={TOOLTIP_CLEAN}
    />
  )
}
