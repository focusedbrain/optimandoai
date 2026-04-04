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
      const installed = (d.modelsInstalled || []).map((m) => ({
        name: m.name,
        size: m.size != null ? String(m.size) : undefined,
      }))
      setAvailableModels(installed)
      let preferred = d.activeModel as string | undefined
      try {
        const saved = localStorage.getItem('optimando-wr-chat-active-model')
        if (saved && installed.some((m) => m.name === saved)) {
          preferred = saved
          if (typeof window.llm?.setActiveModel === 'function') {
            void window.llm.setActiveModel(saved)
          }
        }
      } catch {
        /* ignore */
      }
      if (!preferred && installed.length > 0) {
        const visionFirst = installed.find((m) =>
          /gemma3|llava|moondream|vision|qwen2-vl|minicpm-v/i.test(m.name),
        )
        preferred = visionFirst?.name ?? installed[0].name
      }
      setActiveLlmModel(preferred)
    } catch (e) {
      wrChatDashboardWarn('refreshModels failed:', e instanceof Error ? e.message : e)
    }
  }, [])

  useLayoutEffect(() => {
    if (!ready) return
    void refreshModels()
  }, [ready, refreshModels])

  /** Merge host-stored tags (extension mirror) into dashboard localStorage so Tags menus stay aligned. */
  useLayoutEffect(() => {
    if (!ready) return
    void (async () => {
      try {
        const fn = window.handshakeView?.pqHeaders
        if (typeof fn !== 'function') return
        const h = await fn()
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (h && typeof h === 'object') {
          for (const [key, val] of Object.entries(h)) {
            if (typeof val === 'string') headers[key] = val
          }
        }
        const r = await fetch('http://127.0.0.1:51248/api/wrchat/tagged-triggers', { headers })
        if (!r.ok) return
        const j = (await r.json()) as { triggers?: unknown[] }
        if (!Array.isArray(j.triggers) || j.triggers.length === 0) return
        try {
          const raw = localStorage.getItem('optimando-tagged-triggers')
          const local = raw ? (JSON.parse(raw) as unknown[]) : []
          const merged = Array.isArray(local) ? [...local] : []
          const keys = new Set(
            merged.map((t: { name?: string; at?: number }) => `${String(t?.name ?? '')}|${t?.at ?? 0}`),
          )
          for (const t of j.triggers as { name?: string; at?: number }[]) {
            const key = `${String(t?.name ?? '')}|${t?.at ?? 0}`
            if (!keys.has(key)) {
              merged.push(t)
              keys.add(key)
            }
          }
          localStorage.setItem('optimando-tagged-triggers', JSON.stringify(merged))
          window.dispatchEvent(new CustomEvent('optimando-triggers-updated'))
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      }
    })()
  }, [ready])

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
    try {
      localStorage.setItem('optimando-wr-chat-active-model', name)
    } catch {
      /* ignore */
    }
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
