import { useCallback, useLayoutEffect, useState } from 'react'
import { PopupChatView } from '@ext/ui/components'
import { ensureOrchestratorSessionForDashboard } from '../lib/wrChatDashboardBootstrap'
import { WR_CHAT_DASHBOARD_TRANSCRIPT_KEY } from '../lib/wrChatDashboardConstants'
import { wrChatDashboardWarn } from '../lib/wrChatDashboardLog'
import { setWrChatRuntimeSurface } from '../lib/wrChatRuntimeMode'
import { ensureWrdeskChromeShim } from '../shims/wrChatDashboardChrome'
import './WRChatDashboardView.css'

type DashboardTheme = 'pro' | 'dark' | 'standard'

interface WRChatDashboardViewProps {
  theme: DashboardTheme
}

/**
 * Dashboard embed for WR Chat: installs a minimal `chrome.*` shim, bootstraps orchestrator
 * session keys when needed, sets runtime surface flag, then mounts `PopupChatView`.
 */
export default function WRChatDashboardView({ theme }: WRChatDashboardViewProps) {
  const [ready, setReady] = useState(false)
  const [availableModels, setAvailableModels] = useState<Array<{ name: string; size?: string }>>([])
  const [activeLlmModel, setActiveLlmModel] = useState<string | undefined>(undefined)

  useLayoutEffect(() => {
    ensureWrdeskChromeShim()
    setWrChatRuntimeSurface('dashboard')
    let cancelled = false
    void (async () => {
      try {
        await ensureOrchestratorSessionForDashboard()
      } catch (e) {
        wrChatDashboardWarn('ensureOrchestratorSessionForDashboard threw:', e instanceof Error ? e.message : e)
      }
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
      setWrChatRuntimeSurface(null)
    }
  }, [])

  const refreshModels = useCallback(async () => {
    const api = typeof window !== 'undefined' ? window.llm : undefined
    if (!api?.getStatus) {
      wrChatDashboardWarn('window.llm.getStatus unavailable — model list may be empty until preload exposes llm bridge')
      return
    }
    try {
      const res = await api.getStatus()
      if (!res.ok) {
        const err = 'error' in res ? (res as { error?: string }).error : undefined
        wrChatDashboardWarn(`llm.getStatus ok:false${err ? `: ${err}` : ''}`)
        return
      }
      const d = res.data
      setAvailableModels(
        (d.modelsInstalled || []).map((m) => ({
          name: m.name,
          size: m.size != null ? String(m.size) : undefined,
        })),
      )
      setActiveLlmModel(d.activeModel)
    } catch (e) {
      wrChatDashboardWarn('refreshModels failed:', e instanceof Error ? e.message : e)
    }
  }, [])

  useLayoutEffect(() => {
    if (!ready) return
    void refreshModels()
  }, [ready, refreshModels])

  useLayoutEffect(() => {
    if (!ready) return
    const api = window.llm
    if (!api?.onActiveModelChanged) return
    return api.onActiveModelChanged(() => {
      void refreshModels()
    })
  }, [ready, refreshModels])

  const onModelSelect = useCallback((name: string) => {
    setActiveLlmModel(name)
    if (typeof window.llm?.setActiveModel !== 'function') {
      wrChatDashboardWarn('window.llm.setActiveModel unavailable — model selection may not persist')
      return
    }
    void window.llm.setActiveModel(name)
  }, [])

  if (!ready) {
    return (
      <div className="wr-chat-dashboard-view wr-chat-dashboard-view--boot" role="status">
        Preparing WR Chat…
      </div>
    )
  }

  return (
    <div className="wr-chat-dashboard-view">
      <div className="wr-chat-dashboard-view__chat">
        <PopupChatView
          theme={theme}
          availableModels={availableModels}
          activeLlmModel={activeLlmModel}
          onModelSelect={onModelSelect}
          onRefreshModels={refreshModels}
          sessionName="Dashboard"
          persistTranscriptStorageKey={WR_CHAT_DASHBOARD_TRANSCRIPT_KEY}
          wrChatEmbedContext="dashboard"
        />
      </div>
    </div>
  )
}
