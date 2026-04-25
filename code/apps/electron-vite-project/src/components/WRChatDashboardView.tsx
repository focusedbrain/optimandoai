import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { PopupChatView } from '@ext/ui/components'
import { useProjectStore } from '../stores/useProjectStore'
import { ensureOrchestratorSessionForDashboard } from '../lib/wrChatDashboardBootstrap'
import { wrChatDashboardWarn } from '../lib/wrChatDashboardLog'
import { setWrChatRuntimeSurface } from '../lib/wrChatRuntimeMode'
import { ensureWrdeskChromeShim } from '../shims/wrChatDashboardChrome'
import { isHostInferenceModelId } from '../lib/hostInferenceModelIds'
import {
  accountKeyFromSession,
  readWrChatInferenceSelection,
  validateStoredSelectionForWrChat,
  persistWrChatModelId,
  clearWrChatInferenceSelection,
} from '../lib/inferenceSelectionPersistence'
import { logModelSelectorTargets } from '../lib/modelSelectorTargetsLog'
import {
  type InferenceTargetRefreshReason,
  countWrChatMerged,
  logInferenceTargetRefreshReason,
  logInferenceTargetRefreshResult,
} from '../lib/inferenceTargetRefreshLog'
import { HOST_INFERENCE_UNAVAILABLE, HOST_AI_SELECTOR_ICON_CLASS } from '../lib/hostAiSelectorCopy'
import './WRChatDashboardView.css'

type WrChatModelOption = {
  name: string
  size?: string
  displayTitle?: string
  subtitle?: string
  hostAi?: boolean
  hostAvailable?: boolean
  hostComputerName?: string
  /** CSS class for a non-text Host row marker (e.g. `host-ai-model-icon`). */
  hostIconClass?: string
  /** Grouping for dropdown: same order as orchestrator (local → host → cloud). */
  section?: 'local' | 'host' | 'cloud'
}

function wrChatModelsForPersist(models: WrChatModelOption[]) {
  return models.map((m) => ({
    id: m.name,
    type: (m.section === 'cloud'
      ? 'cloud'
      : m.hostAi || m.section === 'host'
        ? 'host_internal'
        : 'local') as 'local' | 'cloud' | 'host_internal',
  }))
}

type DashboardTheme = 'pro' | 'dark' | 'standard'

interface WRChatDashboardViewProps {
  theme: DashboardTheme
}

/**
 * Dashboard embed for WR Chat: installs a minimal `chrome.*` shim, bootstraps orchestrator
 * session keys when needed, sets runtime surface flag, then mounts `PopupChatView`.
 *
 * **Watchdog alerts:** Main sends `watchdog-alert` IPC → `onDashboardWatchdogAlert`; `PopupChatView`
 * (dashboard) appends assistant bubbles. **Scan / continuous UI** is in `App.tsx` (right of Inbox).
 * It dispatches `wrchat-watchdog-alert` when threats are found; **`WrMultiTriggerBar`** also updates
 * **`useChatFocusStore`**, dispatches `wrchat-append-assistant` (intro), and `wrchat-chat-focus-request` on speech-bubble focus — same module as the docked extension sidepanel.
 */
export default function WRChatDashboardView({ theme }: WRChatDashboardViewProps) {
  const acceptOptimizationSuggestion = useProjectStore((s) => s.acceptOptimizationSuggestion)
  const onPersistAcceptedOptimizationSuggestion = useCallback(
    (payload: {
      projectId: string
      runId: string
      agentBoxId: string
      text: string
    }) => {
      acceptOptimizationSuggestion(payload.projectId, {
        runId: payload.runId,
        agentBoxId: payload.agentBoxId,
        text: payload.text,
      })
    },
    [acceptOptimizationSuggestion],
  )

  const [ready, setReady] = useState(false)
  const [availableModels, setAvailableModels] = useState<WrChatModelOption[]>([])
  const [activeLlmModel, setActiveLlmModel] = useState<string | undefined>(undefined)
  const [hostAiStale, setHostAiStale] = useState(false)
  const [inferenceSelectionPersistError, setInferenceSelectionPersistError] = useState<string | null>(null)
  const activeLlmModelRef = useRef<string | undefined>(undefined)
  activeLlmModelRef.current = activeLlmModel
  const lastAccountKeyForWrRef = useRef(accountKeyFromSession())

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

  const refreshModels = useCallback(async (reason?: InferenceTargetRefreshReason) => {
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
      const installed: WrChatModelOption[] = (d.modelsInstalled || []).map((m) => ({
        name: m.name,
        size: m.size != null ? String(m.size) : undefined,
        section: 'local' as const,
      }))

      let hostRows: WrChatModelOption[] = []
      let hadCapabilities = false
      /** Sandbox: same source as HybridSearch (`handshake:getAvailableModels` merges Host policy + active Ollama). */
      try {
        const mode = (await window.orchestratorMode?.getMode?.())?.mode
        if (mode === 'sandbox' && typeof window.handshakeView?.getAvailableModels === 'function') {
          const g = await window.handshakeView.getAvailableModels()
          hadCapabilities = Boolean(
            (g as { inferenceRefreshMeta?: { hadCapabilitiesProbed?: boolean } })?.inferenceRefreshMeta
              ?.hadCapabilitiesProbed,
          )
          const ok = g && typeof g === 'object' && (g as { success?: boolean }).success === true
          const models = ok && Array.isArray((g as { models?: unknown }).models) ? (g as { models: unknown[] }).models : []
          const hostFromGav = models.filter(
            (m): m is {
              id: string
              type: string
              name: string
              displayTitle?: string
              displaySubtitle?: string
              hostTargetAvailable?: boolean
            } =>
              Boolean(m) &&
              typeof m === 'object' &&
              (m as { type?: string }).type === 'host_internal' &&
              typeof (m as { id?: string }).id === 'string',
          )
          if (hostFromGav.length > 0) {
            hostRows = hostFromGav.map((m) => ({
              name: m.id,
              displayTitle: (m.displayTitle || m.name || 'Host AI').replace(
                /host-internal:[^:]+:[^\s]+/i,
                'Host AI',
              ),
              subtitle: (m.displaySubtitle || '').trim().replace(/^[A-Z0-9_]+$/g, '') || undefined,
              hostAi: true,
              hostAvailable: m.hostTargetAvailable === true,
              hostComputerName: undefined,
              hostIconClass: HOST_AI_SELECTOR_ICON_CLASS,
              section: 'host' as const,
            }))
          }
        }
      } catch {
        /* fall through to internalInference */
      }
      if (hostRows.length === 0) {
        try {
          const inf = window.internalInference
          const listHostTargets = typeof inf?.listTargets === 'function' ? inf.listTargets : inf?.listInferenceTargets
          if (typeof listHostTargets === 'function') {
            const ht = (await listHostTargets()) as {
              ok?: boolean
              targets?: Array<{
                id: string
                label: string
                display_label?: string
                available: boolean
                unavailable_reason?: string
                host_computer_name?: string
              }>
            }
            if (ht?.ok && Array.isArray(ht.targets)) {
              hostRows = ht.targets.map((t) => {
                const secondary = (t as { secondary_label?: string }).secondary_label?.trim() || ''
                return {
                  name: t.id,
                  displayTitle: t.display_label || t.label,
                  subtitle: secondary,
                  hostAi: true,
                  hostAvailable: t.available,
                  hostComputerName: t.host_computer_name,
                  hostIconClass: HOST_AI_SELECTOR_ICON_CLASS,
                  section: 'host' as const,
                }
              })
            }
          }
        } catch {
          /* ignore */
        }
      }

      const merged = [...installed, ...hostRows]
      setAvailableModels(merged)
      if (reason) {
        const { local, host, final } = countWrChatMerged(installed, hostRows)
        logInferenceTargetRefreshReason(reason)
        logInferenceTargetRefreshResult(local, host, final)
        if (hadCapabilities) {
          logInferenceTargetRefreshReason('capabilities_result')
          logInferenceTargetRefreshResult(local, host, final)
        }
      }
      const localCount = merged.filter((m) => m.section === 'local').length
      const hostInternalCount = merged.filter((m) => m.hostAi || m.section === 'host').length
      const hostTargetsPayload = hostRows.map((h) => ({
        name: h.name,
        displayTitle: h.displayTitle,
        subtitle: h.subtitle,
        hostAvailable: h.hostAvailable,
        section: h.section,
      }))
      logModelSelectorTargets({
        selector: 'wrchat',
        localCount,
        hostCount: hostInternalCount,
        finalCount: merged.length,
        hostTargets: {
          composition: 'llm:getStatus + (sandbox: handshake:getAvailableModels | internal-inference:listTargets)',
          hostRows: hostTargetsPayload,
        },
        selected: { activeLlmModel: activeLlmModelRef.current ?? null, ollamaActiveFromLlm: d.activeModel },
      })

      let preferred: string | undefined = d.activeModel as string | undefined
      const names = merged.map((m) => m.name)
      const stored = readWrChatInferenceSelection()
      if (stored) {
        const v = validateStoredSelectionForWrChat(
          stored,
          names,
          merged.filter((m) => m.hostAi),
        )
        if (v.error) {
          setInferenceSelectionPersistError(
            v.error === 'host_unavailable'
              ? HOST_INFERENCE_UNAVAILABLE
              : 'The saved model is no longer available. Choose another model.',
          )
          clearWrChatInferenceSelection()
          preferred = undefined
        } else {
          setInferenceSelectionPersistError(null)
          preferred = v.modelId
        }
      } else {
        setInferenceSelectionPersistError(null)
      }
      if (preferred && !isHostInferenceModelId(preferred) && typeof window.llm?.setActiveModel === 'function') {
        void window.llm.setActiveModel(preferred)
      }
      if (!preferred && hostRows.length === 1 && hostRows[0]?.hostAvailable) {
        preferred = hostRows[0].name
      }
      if (!preferred && installed.length > 0) {
        const visionFirst = installed.find((m) =>
          /gemma3|llava|moondream|vision|qwen2-vl|minicpm-v/i.test(m.name),
        )
        preferred = visionFirst?.name ?? installed[0].name
      }
      if (!preferred && hostRows.length > 0) {
        preferred = hostRows[0].name
      }
      setActiveLlmModel(preferred)
    } catch (e) {
      wrChatDashboardWarn('refreshModels failed:', e instanceof Error ? e.message : e)
    }
  }, [])

  useLayoutEffect(() => {
    if (!ready) return
    void refreshModels('startup')
  }, [ready, refreshModels])

  /** Handshake ledger, orchestrator mode, resume, account — keep Host rows in sync with Sandbox (same triggers as top chat). */
  useLayoutEffect(() => {
    if (!ready) return
    const onResume = () => {
      if (document.visibilityState !== 'visible') return
      const ak = accountKeyFromSession()
      if (ak !== lastAccountKeyForWrRef.current) {
        lastAccountKeyForWrRef.current = ak
        setAvailableModels([])
        void refreshModels('account_change')
        return
      }
      void refreshModels()
    }
    const onList = () => {
      void refreshModels('handshake_active')
    }
    const onMode = () => {
      void refreshModels('mode_change')
    }
    const onP2p = (e: Event) => {
      const d = (e as CustomEvent<{ reason?: string }>).detail
      if (d?.reason === 'p2p_change') {
        void refreshModels('p2p_change')
      }
    }
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('handshake-list-refresh', onList)
    window.addEventListener('orchestrator-mode-changed', onMode)
    window.addEventListener('inference-target-refresh', onP2p)
    return () => {
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('handshake-list-refresh', onList)
      window.removeEventListener('orchestrator-mode-changed', onMode)
      window.removeEventListener('inference-target-refresh', onP2p)
    }
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
          type T = { name?: string; updatedAt?: number; at?: number; [k: string]: unknown }
          const normKey = (t: T) => String(t?.name ?? '').replace(/^#/, '').toLowerCase().trim()
          const ts = (t: T) => t?.updatedAt ?? t?.at ?? 0

          const raw = localStorage.getItem('optimando-tagged-triggers')
          const local: T[] = raw ? (JSON.parse(raw) as T[]) : []
          const safLocal: T[] = Array.isArray(local) ? local : []

          // Build map keyed by normalised tag name — freshest entry wins.
          const map = new Map<string, T>()
          for (const t of safLocal) {
            const k = normKey(t)
            if (k) map.set(k, t)
          }

          let changed = false
          for (const t of j.triggers as T[]) {
            const k = normKey(t)
            if (!k) continue
            const existing = map.get(k)
            if (!existing) {
              map.set(k, t)
              changed = true
            } else if (ts(t) > ts(existing)) {
              map.set(k, t)
              changed = true
            }
          }

          if (!changed) return
          const keyless = safLocal.filter(t => !normKey(t))
          const merged = [...map.values(), ...keyless]
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

  useLayoutEffect(() => {
    if (!activeLlmModel) {
      setHostAiStale(false)
      return
    }
    if (!isHostInferenceModelId(activeLlmModel)) {
      setHostAiStale(false)
      return
    }
    const row = availableModels.find((m) => m.name === activeLlmModel)
    if (!row?.hostAi) {
      setHostAiStale(true)
      return
    }
    setHostAiStale(!row.hostAvailable)
  }, [activeLlmModel, availableModels])

  const switchWrChatFromStaleHost = useCallback(() => {
    const local = availableModels.find((m) => m.section === 'local')
    const cloud = availableModels.find((m) => m.section === 'cloud')
    const host = availableModels.find((m) => m.hostAi && m.hostAvailable)
    const next = local?.name ?? cloud?.name ?? host?.name
    if (next) {
      setActiveLlmModel(next)
      setInferenceSelectionPersistError(null)
      persistWrChatModelId(next, wrChatModelsForPersist(availableModels))
      if (!isHostInferenceModelId(next) && typeof window.llm?.setActiveModel === 'function') {
        void window.llm.setActiveModel(next)
      }
    } else {
      setActiveLlmModel(undefined)
      clearWrChatInferenceSelection()
    }
    setHostAiStale(false)
  }, [availableModels])

  const onModelSelect = useCallback(
    (name: string) => {
      setActiveLlmModel(name)
      setInferenceSelectionPersistError(null)
      persistWrChatModelId(name, wrChatModelsForPersist(availableModels))
      if (isHostInferenceModelId(name)) {
        return
      }
      if (typeof window.llm?.setActiveModel !== 'function') {
        wrChatDashboardWarn('window.llm.setActiveModel unavailable — model selection may not persist')
        return
      }
      void window.llm.setActiveModel(name)
    },
    [availableModels],
  )

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
          wrChatEmbedContext="dashboard"
          onPersistAcceptedOptimizationSuggestion={onPersistAcceptedOptimizationSuggestion}
          hostAiStale={hostAiStale}
          onConfirmSwitchFromStaleHost={switchWrChatFromStaleHost}
          inferenceSelectionPersistError={inferenceSelectionPersistError}
        />
      </div>
    </div>
  )
}

/** Re-export shared optimization UI from the extension barrel (dashboard uses the same components as WR Chat). */
export { AgentOptimizationResult, OptimizationRunHeader, OptimizationInfobox } from '@ext/ui/components'
