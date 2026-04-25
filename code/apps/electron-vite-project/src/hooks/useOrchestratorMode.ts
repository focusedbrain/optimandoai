import { useEffect, useRef, useState } from 'react'
import {
  getOrchestratorModeVsHandshakeInfo,
  logOrchestratorModeVsHandshakeMismatch,
  handshakeRoleForModeMismatch,
} from '../lib/orchestratorModeVsHandshake'
/**
 * Host vs Sandbox from the **main-process** persist file (same as `isSandboxMode()` / `handshake:getAvailableModels`):
 * `orchestrator:getMode` → `orchestrator-mode.json` in Electron `userData`. Do not use `localStorage` for
 * authoritative mode. Refetches on `orchestrator-mode-changed` (sent after `orchestrator:setMode` and HTTP
 * `POST /api/orchestrator/mode`).
 */
export function useOrchestratorMode() {
  const [mode, setMode] = useState<'host' | 'sandbox' | null>(null)
  const [ready, setReady] = useState(false)
  const [ledgerProvesInternalSandboxToHost, setLedgerProvesInternalSandboxToHost] = useState(false)
  const [ledgerProvesLocalHostPeerSandbox, setLedgerProvesLocalHostPeerSandbox] = useState(false)

  useEffect(() => {
    let cancelled = false
    const fetchMode = async () => {
      const getMode = window.orchestratorMode?.getMode
      if (typeof getMode !== 'function') {
        if (!cancelled) {
          setMode(null)
          setLedgerProvesInternalSandboxToHost(false)
          setLedgerProvesLocalHostPeerSandbox(false)
          setReady(true)
        }
        return
      }
      try {
        const cfg = (await getMode()) as {
          mode?: string
          ledgerProvesInternalSandboxToHost?: boolean
          ledgerProvesLocalHostPeerSandbox?: boolean
        } | null
        if (cancelled) return
        const m = cfg?.mode
        if (m === 'host' || m === 'sandbox') {
          setMode(m)
        } else {
          setMode(null)
        }
        setLedgerProvesInternalSandboxToHost(cfg?.ledgerProvesInternalSandboxToHost === true)
        setLedgerProvesLocalHostPeerSandbox(cfg?.ledgerProvesLocalHostPeerSandbox === true)
      } catch {
        if (!cancelled) {
          setMode(null)
          setLedgerProvesInternalSandboxToHost(false)
          setLedgerProvesLocalHostPeerSandbox(false)
        }
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    void fetchMode()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetchMode()
    }
    const onModeEvent = () => {
      void fetchMode()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('orchestrator-mode-changed', onModeEvent)
    window.addEventListener('handshake-list-refresh', onModeEvent)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('orchestrator-mode-changed', onModeEvent)
      window.removeEventListener('handshake-list-refresh', onModeEvent)
    }
  }, [])

  const lastMismatchLogKey = useRef<string>('')

  useEffect(() => {
    if (!ready || mode == null) {
      return
    }
    const info = getOrchestratorModeVsHandshakeInfo({
      orchModeReady: ready,
      mode,
      ledgerProvesInternalSandboxToHost,
      ledgerProvesLocalHostPeerSandbox,
    })
    if (!info.mismatch) {
      lastMismatchLogKey.current = ''
      return
    }
    const role = handshakeRoleForModeMismatch(
      ledgerProvesInternalSandboxToHost,
      ledgerProvesLocalHostPeerSandbox,
    )
    const key = `${mode}|${role}`
    if (lastMismatchLogKey.current === key) {
      return
    }
    lastMismatchLogKey.current = key
    logOrchestratorModeVsHandshakeMismatch({ configuredMode: mode, handshakeLocalRole: role })
  }, [ready, mode, ledgerProvesInternalSandboxToHost, ledgerProvesLocalHostPeerSandbox])

  return {
    mode,
    isHost: mode === 'host',
    isSandbox: mode === 'sandbox',
    /** ACTIVE internal ledger: local Sandbox ↔ peer Host (see main `orchestrator:getMode`). */
    ledgerProvesInternalSandboxToHost,
    /** This device is Host on an ACTIVE internal row — hide Host AI ↻. */
    ledgerProvesLocalHostPeerSandbox,
    ready,
  }
}
