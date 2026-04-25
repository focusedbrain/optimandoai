import { useEffect, useState } from 'react'

/**
 * Best-effort Host vs Sandbox detection via main-process persisted orchestrator mode
 * (`orchestrator:getMode`). When the bridge is missing (e.g. web dev), `mode` stays null and
 * `isHost` is false. Refetches when the document becomes visible again (e.g. after changing mode in Settings).
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
