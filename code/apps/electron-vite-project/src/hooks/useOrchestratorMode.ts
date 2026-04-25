import { useEffect, useState } from 'react'

/**
 * Host vs Sandbox from the **main-process** persist file (same as `isSandboxMode()` / `handshake:getAvailableModels`):
 * `orchestrator:getMode` → `orchestrator-mode.json` in Electron `userData`. Do not use `localStorage` for
 * authoritative mode. Refetches on `orchestrator-mode-changed` (sent after `orchestrator:setMode` and HTTP
 * `POST /api/orchestrator/mode`).
 */
export function useOrchestratorMode() {
  const [mode, setMode] = useState<'host' | 'sandbox' | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const fetchMode = async () => {
      const getMode = window.orchestratorMode?.getMode
      if (typeof getMode !== 'function') {
        if (!cancelled) {
          setMode(null)
          setReady(true)
        }
        return
      }
      try {
        const cfg = await getMode()
        if (cancelled) return
        const m = cfg?.mode
        if (m === 'host' || m === 'sandbox') {
          setMode(m)
        } else {
          setMode(null)
        }
      } catch {
        if (!cancelled) setMode(null)
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
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('orchestrator-mode-changed', onModeEvent)
    }
  }, [])

  return {
    mode,
    isHost: mode === 'host',
    isSandbox: mode === 'sandbox',
    ready,
  }
}
