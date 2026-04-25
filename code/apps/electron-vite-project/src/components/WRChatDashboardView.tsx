import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { mapHostTargetsToGavModelEntries, orderModelsLocalHostCloud } from '../lib/modelSelectorMerge'
import {
  fetchSelectorModelListFromHostDiscovery,
  type FetchSelectorModelListResult,
  wrChatModelOptionsFromSelectorModels,
} from '../lib/selectorModelListFromHostDiscovery'
import type { SelectorAvailableModel } from '../lib/selectorModelListFromHostDiscovery'
import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'
import {
  type InferenceTargetRefreshReason,
  countWrChatMerged,
  logInferenceTargetRefreshFromLoad,
  logInferenceTargetRefreshStart,
} from '../lib/inferenceTargetRefreshLog'
import { buildHostAiSelectorTooltip, hostModelSelectorRowUi } from '../lib/hostModelSelectorRowUi'
import { HOST_INFERENCE_UNAVAILABLE } from '../lib/hostAiSelectorCopy'
import { useOrchestratorMode } from '../hooks/useOrchestratorMode'
import {
  computeShowHostInferenceRefresh,
  discoveryHasHostInternalRows,
  handshakeLocalRoleForModelSelectorLog,
  logModelSelectorShowRefresh,
} from '../lib/modelSelectorHostRefreshVisibility'
import {
  type HostRefreshFeedback,
  getHostRefreshFeedbackFromTargets,
} from '../lib/hostRefreshFeedback'
import './WRChatDashboardView.css'

type WrChatModelOption = {
  name: string
  size?: string
  displayTitle?: string
  subtitle?: string
  /** Full tooltip (native `title`); menu row stays one line. */
  hostTooltipDetail?: string
  hostAi?: boolean
  hostAvailable?: boolean
  /** True when main reports `host_selector_state === 'checking'`. */
  hostTargetChecking?: boolean
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
  const [gavHostTargets, setGavHostTargets] = useState<HostInferenceTargetRow[]>([])
  const [activeLlmModel, setActiveLlmModel] = useState<string | undefined>(undefined)
  const [hostAiStale, setHostAiStale] = useState(false)
  const [inferenceSelectionPersistError, setInferenceSelectionPersistError] = useState<string | null>(null)
  const [hostModelRefreshFeedback, setHostModelRefreshFeedback] = useState<HostRefreshFeedback | null>(null)
  const hostModelRefreshFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeLlmModelRef = useRef<string | undefined>(undefined)
  activeLlmModelRef.current = activeLlmModel
  const lastAccountKeyForWrRef = useRef(accountKeyFromSession())
  const {
    ready: orchModeReady,
    mode: orchMode,
    isSandbox: orchIsSandbox,
    isHost: orchIsHost,
    ledgerProvesInternalSandboxToHost,
    ledgerProvesLocalHostPeerSandbox,
  } = useOrchestratorMode()
  const discoveryHostInternalRows = useMemo(
    () => discoveryHasHostInternalRows(gavHostTargets, availableModels),
    [gavHostTargets, availableModels],
  )
  const showModelListRefreshState = useMemo(
    () =>
      computeShowHostInferenceRefresh({
        orchModeReady,
        orchIsSandbox,
        orchIsHost,
        ledgerProvesInternalSandboxToHost,
        ledgerProvesLocalHostPeerSandbox,
        discoveryHasHostInternalRows: discoveryHostInternalRows,
      }),
    [
      orchModeReady,
      orchIsSandbox,
      orchIsHost,
      ledgerProvesInternalSandboxToHost,
      ledgerProvesLocalHostPeerSandbox,
      discoveryHostInternalRows,
    ],
  )
  const includeHostInternalDiscovery = showModelListRefreshState.show
  const showModelListRefreshButton = showModelListRefreshState.show
  useEffect(() => {
    if (!orchModeReady) {
      return
    }
    logModelSelectorShowRefresh({
      selector: 'wrchat',
      configuredMode: orchMode,
      handshakeLocalRole: handshakeLocalRoleForModelSelectorLog({
        ledgerProvesInternalSandboxToHost,
        ledgerProvesLocalHostPeerSandbox,
      }),
      show: showModelListRefreshState.show,
      reason: showModelListRefreshState.reason,
    })
  }, [
    orchModeReady,
    orchMode,
    ledgerProvesInternalSandboxToHost,
    ledgerProvesLocalHostPeerSandbox,
    showModelListRefreshState.show,
    showModelListRefreshState.reason,
  ])

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

  const refreshModels = useCallback(async (reason?: InferenceTargetRefreshReason, options?: { force?: boolean }) => {
    if (reason === 'manual_refresh' && includeHostInternalDiscovery) {
      logInferenceTargetRefreshStart('manual_refresh')
      setGavHostTargets((prev) =>
        prev.length
          ? prev.map((t) => ({
              ...t,
              host_selector_state: 'checking' as const,
              availability: 'checking_host',
              unavailable_reason: 'CHECKING_CAPABILITIES',
              available: false,
            }))
          : prev,
      )
    }

    let discovered: FetchSelectorModelListResult
    try {
      /**
       * Same pipeline as top chat: GAV + `listTargets` first. If this throws, we do not have Host targets.
       * (Never fold local `llm.getStatus` into this `try` — Ollama failure must not block Host discovery.)
       */
      discovered = await fetchSelectorModelListFromHostDiscovery({
        reason,
        force: options?.force ?? (reason === 'manual_refresh' ? true : undefined),
        includeHostInternalDiscovery,
        orchestratorLedgerProvesInternalSandboxToHost: ledgerProvesInternalSandboxToHost,
      })
    } catch (e) {
      wrChatDashboardWarn('Host discovery (fetchSelectorModelListFromHostDiscovery) failed:', e instanceof Error ? e.message : e)
      setGavHostTargets([])
      if (reason === 'manual_refresh' && includeHostInternalDiscovery) {
        setHostModelRefreshFeedback(getHostRefreshFeedbackFromTargets([], { path: 'empty', error: e }))
      }
      return
    }
    setGavHostTargets(discovered.gavForHook)

    const api = typeof window !== 'undefined' ? window.llm : undefined
    let installed: WrChatModelOption[] = []
    let d: { activeModel?: string; modelsInstalled?: Array<{ name: string; size?: unknown }> } = {}
    if (api?.getStatus) {
      try {
        const res = await api.getStatus()
        if (res.ok && res.data) {
          d = res.data
          installed = (d.modelsInstalled || []).map((m) => ({
            name: m.name,
            size: m.size != null ? String(m.size) : undefined,
            section: 'local' as const,
          }))
        } else {
          const err = 'error' in res ? (res as { error?: string }).error : undefined
          wrChatDashboardWarn(`llm.getStatus ok:false${err ? `: ${err}` : ''}`)
        }
      } catch (e) {
        wrChatDashboardWarn('llm.getStatus failed (non-blocking, Host/merge still applied):', e instanceof Error ? e.message : e)
      }
    } else {
      wrChatDashboardWarn(
        'window.llm.getStatus unavailable — local list may be empty; Host AI from handshake is unchanged',
      )
    }

    const applyDiscoveryToOptions = (): WrChatModelOption[] => {
      const hostIdToTarget = new Map<string, HostInferenceTargetRow>()
      for (const r of discovered.gavForHook) {
        if (r && typeof r === 'object' && typeof r.id === 'string') {
          hostIdToTarget.set(r.id, r)
        }
      }
      const modelSource: SelectorAvailableModel[] =
        !discovered.models.some((m) => m.type === 'host_internal') && discovered.gavForHook.length > 0
          ? orderModelsLocalHostCloud([
              ...discovered.models,
              ...mapHostTargetsToGavModelEntries(discovered.gavForHook),
            ])
          : discovered.models
      const baseRows = wrChatModelOptionsFromSelectorModels(modelSource) as WrChatModelOption[]
      const withSizes = baseRows.map((row) => {
        if (row.section !== 'local') {
          return row
        }
        const inst = installed.find((i) => i.name === row.name)
        if (inst?.size) {
          return { ...row, size: inst.size }
        }
        return row
      })
      return withSizes.map((row) => {
        if (!row.hostAi) {
          return row
        }
        const t = hostIdToTarget.get(row.name)
        const ui = hostModelSelectorRowUi(
          {
            hostSelectorState: row.hostTargetChecking ? 'checking' : row.hostAvailable ? 'available' : 'unavailable',
            hostTargetAvailable: row.hostAvailable === true,
            displayTitle: row.displayTitle || row.name,
            displaySubtitle: (row.subtitle || '').trim(),
            name: row.name,
            hostLocalModelName: t?.model ?? t?.model_id,
          },
          t,
        )
        return {
          ...row,
          displayTitle: ui.titleLine,
          subtitle: ui.subtitleLine,
          hostTooltipDetail: buildHostAiSelectorTooltip(t, {
            hostTargetAvailable: row.hostAvailable === true,
            hostSelectorState: row.hostTargetChecking ? 'checking' : row.hostAvailable ? 'available' : 'unavailable',
          }),
          hostComputerName: t?.host_computer_name?.trim() || row.hostComputerName,
        }
      })
    }

    let mergedWithHostUi: WrChatModelOption[]
    try {
      mergedWithHostUi = applyDiscoveryToOptions()
    } catch (e) {
      wrChatDashboardWarn('WRChat model merge failed; using discovery rows only:', e instanceof Error ? e.message : e)
      mergedWithHostUi = wrChatModelOptionsFromSelectorModels(discovered.models) as WrChatModelOption[]
    }
    setAvailableModels(mergedWithHostUi)
    const localOpts = mergedWithHostUi.filter((m) => m.section === 'local')
    const hostRows = mergedWithHostUi.filter((m) => m.hostAi || m.section === 'host')
    const cloudRows = mergedWithHostUi.filter((m) => m.section === 'cloud')
    const { local, host, cloud, final } = countWrChatMerged(localOpts, hostRows, cloudRows)
    const hadCapabilities = Boolean(
      discovered.withHost.inferenceRefreshMeta?.hadCapabilitiesProbed,
    )
    const hadCapForLog = discovered.path === 'list_fallback' ? true : hadCapabilities
    logInferenceTargetRefreshFromLoad(reason, hadCapForLog, local, host, final)
    const localCount = mergedWithHostUi.filter((m) => m.section === 'local').length
    const hostInternalCount = mergedWithHostUi.filter((m) => m.hostAi || m.section === 'host').length
    const hostTargetsPayload = mergedWithHostUi
      .filter((m) => m.hostAi || m.section === 'host')
      .map((h) => ({
        name: h.name,
        displayTitle: h.displayTitle,
        subtitle: h.subtitle,
        hostAvailable: h.hostAvailable,
        hostTargetChecking: h.hostTargetChecking,
        section: h.section,
      }))
    logModelSelectorTargets({
      selector: 'wrchat',
      localCount,
      hostCount: hostInternalCount,
      finalCount: mergedWithHostUi.length,
      hostTargets: {
        composition:
          'llm.getStatus (best effort, Ollama may be offline) + fetchSelectorModelListFromHostDiscovery (same as top chat)',
        hostRows: hostTargetsPayload,
      },
      selected: { activeLlmModel: activeLlmModelRef.current ?? null, ollamaActiveFromLlm: d.activeModel },
    })

    let preferred: string | undefined = d.activeModel as string | undefined
    const names = mergedWithHostUi.map((m) => m.name)
    const stored = readWrChatInferenceSelection()
    if (stored) {
      const v = validateStoredSelectionForWrChat(
        stored,
        names,
        mergedWithHostUi.filter((m) => m.hostAi),
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
    if (reason === 'manual_refresh' && includeHostInternalDiscovery) {
      setHostModelRefreshFeedback(
        getHostRefreshFeedbackFromTargets(discovered.gavForHook, { path: discovered.path }),
      )
    }
  }, [includeHostInternalDiscovery, ledgerProvesInternalSandboxToHost])

  useEffect(() => {
    if (hostModelRefreshFeedback == null) return
    if (hostModelRefreshFeedbackTimerRef.current) {
      clearTimeout(hostModelRefreshFeedbackTimerRef.current)
    }
    hostModelRefreshFeedbackTimerRef.current = setTimeout(() => {
      hostModelRefreshFeedbackTimerRef.current = null
      setHostModelRefreshFeedback(null)
    }, 8_000)
    return () => {
      if (hostModelRefreshFeedbackTimerRef.current) {
        clearTimeout(hostModelRefreshFeedbackTimerRef.current)
        hostModelRefreshFeedbackTimerRef.current = null
      }
    }
  }, [hostModelRefreshFeedback])

  /** Wait for `orchestrator:getMode` (same as top chat) so `includeHostInternalDiscovery` / `listTargets` are not skipped on first paint. */
  useLayoutEffect(() => {
    if (!ready) return
    if (!orchModeReady) return
    void refreshModels('startup')
  }, [ready, orchModeReady, refreshModels])

  /** Handshake ledger, orchestrator mode, resume, account — keep Host rows in sync with Sandbox (same triggers as top chat). */
  useLayoutEffect(() => {
    if (!ready) return
    const onResume = () => {
      if (document.visibilityState !== 'visible') return
      const ak = accountKeyFromSession()
      if (ak !== lastAccountKeyForWrRef.current) {
        lastAccountKeyForWrRef.current = ak
        setAvailableModels([])
        setGavHostTargets([])
        void refreshModels('account_change')
        return
      }
      void refreshModels('visibility_resume')
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
          onRefreshModels={(r) => {
            const reason = (r as InferenceTargetRefreshReason | undefined) ?? 'manual_refresh'
            void refreshModels(
              reason,
              reason === 'manual_refresh' && includeHostInternalDiscovery ? { force: true } : undefined,
            )
          }}
          showModelListRefreshButton={showModelListRefreshButton}
          sessionName="Dashboard"
          wrChatEmbedContext="dashboard"
          onPersistAcceptedOptimizationSuggestion={onPersistAcceptedOptimizationSuggestion}
          hostAiStale={hostAiStale}
          onConfirmSwitchFromStaleHost={switchWrChatFromStaleHost}
          inferenceSelectionPersistError={inferenceSelectionPersistError}
          hostModelRefreshFeedback={hostModelRefreshFeedback}
        />
      </div>
    </div>
  )
}

/** Re-export shared optimization UI from the extension barrel (dashboard uses the same components as WR Chat). */
export { AgentOptimizationResult, OptimizationRunHeader, OptimizationInfobox } from '@ext/ui/components'
