import { useEffect, useState } from 'react'

/**
 * Best-effort Host vs Sandbox detection via main-process persisted orchestrator mode.
 * When the bridge is missing (e.g. web dev), `mode` stays null and `isHost` is false.
 */
export function useOrchestratorMode() {
  const [mode, setMode] = useState<'host' | 'sandbox' | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
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
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  return {
    mode,
    isHost: mode === 'host',
    isSandbox: mode === 'sandbox',
    ready,
  }
}
