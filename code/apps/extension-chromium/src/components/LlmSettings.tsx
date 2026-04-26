/**
 * LLM Settings Shared Component
 * Can be used in both Extension (HTTP bridge) and Electron app (IPC bridge)
 */

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { electronRpc, type LlmLocalRuntimeInfo, type RpcMethod } from '../rpc/electronRpc'
import { getThemeTokens } from '../shared/ui/lightboxTheme'

// Types
interface HardwareInfo {
  totalRamGb: number
  freeRamGb: number
  cpuCores: number
  cpuThreads: number
  cpuName?: string
  cpuHasAVX2?: boolean
  cpuHasFMA?: boolean
  gpuAvailable: boolean
  gpuVramGb?: number
  diskFreeGb: number
  osType: string
  warnings: string[]
  recommendedModels: string[]
}

interface InstalledModel {
  name: string
  size: number
  modified: string
  digest: string
  isActive: boolean
}

interface OllamaStatus {
  installed: boolean
  running: boolean
  version?: string
  port: number
  modelsInstalled: InstalledModel[]
  activeModel?: string
  localRuntime?: LlmLocalRuntimeInfo
}

interface LlmModelConfig {
  id: string
  displayName: string
  provider: string
  tier: string
  minRamGb: number
  recommendedRamGb: number
  diskSizeGb: number
  contextWindow: number
  description: string
}

interface PerformanceEstimate {
  modelId: string
  estimate: 'fast' | 'usable' | 'slow' | 'unusable'
  reason: string
  ramUsageGb: number
  speedEstimate?: string
}

interface LlmSettingsProps {
  theme?: 'default' | 'dark' | 'professional'
  bridge: 'ipc' | 'http'  // IPC for Electron, HTTP for Extension
}

/** Matches Electron `orchestratorModeStore` payload (subset used by UI). */
interface OrchestratorModeConfig {
  mode: 'host' | 'sandbox'
}

// ─── Typed RPC adapter ───────────────────────────────────────────────────
// Maps electronRpc's { success, data, error } → { ok, data, error }
// to keep the existing result handling unchanged.
// ─────────────────────────────────────────────────────────────────────────
async function rpc(method: RpcMethod, params?: unknown): Promise<{ ok: boolean; data?: any; error?: string }> {
  const res = await electronRpc(method, params)
  return { ok: res.success, data: res.data, error: res.error }
}

/**
 * IPC `llm:*` handlers return `{ ok, data: <entity> }`.
 * HTTP bodies are the same shape, but `rpc()` nests them in `res.data`, so we often see `{ ok, data: { ok, data: <entity> } }`.
 * Unwrap so `bridge="http"` and `bridge="ipc"` both populate state (including `localRuntime`).
 */
function unwrapLlmEnvelope<T>(res: { ok?: boolean; data?: unknown }, isEntity: (x: unknown) => x is T): T | null {
  if (!res?.ok || res.data == null || typeof res.data !== 'object') return null
  const inner = res.data as { ok?: unknown; data?: unknown }
  if (inner.ok === true && inner.data !== undefined && isEntity(inner.data)) return inner.data
  if (isEntity(res.data)) return res.data
  return null
}

function isHardwareEntity(x: unknown): x is HardwareInfo {
  return typeof x === 'object' && x !== null && 'totalRamGb' in x && 'cpuCores' in x
}

function isOllamaStatusEntity(x: unknown): x is OllamaStatus {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as OllamaStatus).installed === 'boolean' &&
    typeof (x as OllamaStatus).running === 'boolean' &&
    Array.isArray((x as OllamaStatus).modelsInstalled)
  )
}

function isCatalogEntity(x: unknown): x is LlmModelConfig[] {
  return Array.isArray(x) && x.length > 0
}

// Hardcoded fallback catalog in case API is unavailable
const FALLBACK_CATALOG: LlmModelConfig[] = [
  { id: 'tinyllama', displayName: 'TinyLlama 1.1B (Q4)', provider: 'TinyLlama', tier: 'lightweight', minRamGb: 1, recommendedRamGb: 2, diskSizeGb: 0.6, contextWindow: 2048, description: 'Ultra-fast, 4-bit quantized.' },
  { id: 'tinydolphin', displayName: 'TinyDolphin 1.1B (Q4)', provider: 'Cognitive Computations', tier: 'lightweight', minRamGb: 1, recommendedRamGb: 2, diskSizeGb: 0.6, contextWindow: 2048, description: 'TinyLlama fine-tuned.' },
  { id: 'all-minilm', displayName: 'All-MiniLM-L6 (Embedding)', provider: 'Microsoft', tier: 'lightweight', minRamGb: 0.3, recommendedRamGb: 0.5, diskSizeGb: 0.09, contextWindow: 512, description: 'Ultra-tiny embeddings.' },
  { id: 'stablelm2:1.6b', displayName: 'StableLM 2 1.6B (Q4)', provider: 'Stability AI', tier: 'lightweight', minRamGb: 1, recommendedRamGb: 1.5, diskSizeGb: 1.0, contextWindow: 4096, description: 'Very fast.' },
  { id: 'stablelm-zephyr:3b', displayName: 'StableLM Zephyr 3B (Q4)', provider: 'Stability AI', tier: 'lightweight', minRamGb: 1.5, recommendedRamGb: 2.5, diskSizeGb: 1.6, contextWindow: 4096, description: 'Chat-optimized.' },
  { id: 'phi3-low', displayName: 'Phi-3 Low-Spec 3.8B (Custom Q4)', provider: 'Microsoft', tier: 'lightweight', minRamGb: 1.5, recommendedRamGb: 2, diskSizeGb: 2.3, contextWindow: 1024, description: 'Custom optimized.' },
  { id: 'gemma:2b', displayName: 'Gemma 2B (Q4_0)', provider: 'Google', tier: 'lightweight', minRamGb: 1.5, recommendedRamGb: 2, diskSizeGb: 1.4, contextWindow: 8192, description: 'Google quality.' },
  { id: 'gemma:2b-q2_K', displayName: 'Gemma 2B (Q2_K)', provider: 'Google', tier: 'lightweight', minRamGb: 1, recommendedRamGb: 1.5, diskSizeGb: 0.9, contextWindow: 8192, description: 'Ultra compressed.' },
  { id: 'phi:2.7b', displayName: 'Phi-2 2.7B (Q4)', provider: 'Microsoft', tier: 'lightweight', minRamGb: 1.5, recommendedRamGb: 2, diskSizeGb: 1.6, contextWindow: 2048, description: 'Excellent for coding.' },
  { id: 'orca-mini', displayName: 'Orca Mini 3B (Q4)', provider: 'Microsoft', tier: 'lightweight', minRamGb: 1.5, recommendedRamGb: 2.5, diskSizeGb: 1.9, contextWindow: 2048, description: 'Good reasoning.' },
  { id: 'openhermes:2.5-mistral-7b-q2_K', displayName: 'OpenHermes 2.5 Mistral (Q2_K)', provider: 'Teknium', tier: 'lightweight', minRamGb: 1.5, recommendedRamGb: 2.5, diskSizeGb: 1.8, contextWindow: 8192, description: 'Ultra-compressed.' },
  { id: 'phi3:mini', displayName: 'Phi-3 Mini 3.8B (Q4)', provider: 'Microsoft', tier: 'lightweight', minRamGb: 2, recommendedRamGb: 3, diskSizeGb: 2.3, contextWindow: 4096, description: 'Very fast.' },
  { id: 'phi3:3.8b-q2_K', displayName: 'Phi-3 Mini 3.8B (Q2_K)', provider: 'Microsoft', tier: 'lightweight', minRamGb: 1.5, recommendedRamGb: 2, diskSizeGb: 1.5, contextWindow: 4096, description: 'Extreme compression.' },
  { id: 'mistral:7b-instruct-q4_0', displayName: 'Mistral 7B Q4', provider: 'Mistral', tier: 'balanced', minRamGb: 3, recommendedRamGb: 4, diskSizeGb: 2.6, contextWindow: 8192, description: 'Balanced.' },
  { id: 'mistral:7b-instruct-q5_K_M', displayName: 'Mistral 7B Q5', provider: 'Mistral', tier: 'balanced', minRamGb: 4, recommendedRamGb: 5, diskSizeGb: 3.2, contextWindow: 8192, description: 'Better quality.' },
  { id: 'llama3:8b', displayName: 'Llama 3 8B (Q4)', provider: 'Meta', tier: 'balanced', minRamGb: 5, recommendedRamGb: 6, diskSizeGb: 4.7, contextWindow: 8192, description: 'High quality.' },
  { id: 'gemma4:e2b', displayName: 'Gemma 4 E2B Edge (Q4_K_M)', provider: 'Google', tier: 'balanced', minRamGb: 8, recommendedRamGb: 10, diskSizeGb: 7.2, contextWindow: 131072, description: 'Gemma 4 edge; ~2.3B eff. params; 128K ctx; text+image (Ollama ~7.2GB).' },
  { id: 'gemma4:e4b', displayName: 'Gemma 4 E4B Edge (Q4_K_M)', provider: 'Google', tier: 'balanced', minRamGb: 10, recommendedRamGb: 12, diskSizeGb: 9.6, contextWindow: 131072, description: 'Gemma 4 edge; ~4.5B eff. params; 128K ctx; text+image (Ollama ~9.6GB).' },
  { id: 'mistral:7b', displayName: 'Mistral 7B Full', provider: 'Mistral', tier: 'performance', minRamGb: 7, recommendedRamGb: 8, diskSizeGb: 4.1, contextWindow: 8192, description: 'Full precision.' },
  { id: 'llama3.1:8b', displayName: 'Llama 3.1 8B (Q4)', provider: 'Meta', tier: 'performance', minRamGb: 6, recommendedRamGb: 8, diskSizeGb: 4.7, contextWindow: 131072, description: '128K context.' },
  { id: 'gemma2:9b', displayName: 'Gemma 2 9B (Q4)', provider: 'Google', tier: 'performance', minRamGb: 7, recommendedRamGb: 9, diskSizeGb: 5.4, contextWindow: 8192, description: 'Latest Google.' },
  { id: 'mistral-nemo:12b', displayName: 'Mistral Nemo 12B (Q4)', provider: 'Mistral', tier: 'performance', minRamGb: 8, recommendedRamGb: 10, diskSizeGb: 7.1, contextWindow: 128000, description: '128K context.' },
  { id: 'codellama:13b', displayName: 'Code Llama 13B (Q4)', provider: 'Meta', tier: 'performance', minRamGb: 10, recommendedRamGb: 13, diskSizeGb: 7.4, contextWindow: 16384, description: 'Coding specialist.' },
  { id: 'qwen3:14b', displayName: 'Qwen 3 14B (Q4)', provider: 'Alibaba', tier: 'performance', minRamGb: 10, recommendedRamGb: 14, diskSizeGb: 9.0, contextWindow: 131072, description: 'Strong reasoning and general chat.' },
  { id: 'phi4:14b', displayName: 'Phi-4 14B (Q4)', provider: 'Microsoft', tier: 'performance', minRamGb: 10, recommendedRamGb: 14, diskSizeGb: 9.0, contextWindow: 16384, description: 'Instruction following and reasoning.' },
  { id: 'qwen2.5:14b', displayName: 'Qwen 2.5 14B (Q4)', provider: 'Alibaba', tier: 'performance', minRamGb: 10, recommendedRamGb: 14, diskSizeGb: 9.0, contextWindow: 131072, description: 'Multilingual conversational model.' },
  { id: 'qwen2.5-coder:14b', displayName: 'Qwen 2.5 Coder 14B (Q4)', provider: 'Alibaba', tier: 'performance', minRamGb: 10, recommendedRamGb: 14, diskSizeGb: 9.0, contextWindow: 131072, description: 'Code-focused Qwen 2.5.' },
  { id: 'gemma3:12b', displayName: 'Gemma 3 12B (Q4)', provider: 'Google', tier: 'performance', minRamGb: 9, recommendedRamGb: 12, diskSizeGb: 8.0, contextWindow: 131072, description: 'Long-context Gemma 3.' },
  { id: 'gemma4:26b', displayName: 'Gemma 4 26B MoE A4B (Q4_K_M)', provider: 'Google', tier: 'performance', minRamGb: 20, recommendedRamGb: 24, diskSizeGb: 18, contextWindow: 262144, description: 'Gemma 4 MoE; ~25.2B total / ~3.8B active; 256K ctx; text+image (Ollama ~18GB).' },
  { id: 'gemma4:31b', displayName: 'Gemma 4 31B Dense (Q4_K_M)', provider: 'Google', tier: 'high-end', minRamGb: 24, recommendedRamGb: 32, diskSizeGb: 20, contextWindow: 262144, description: 'Gemma 4 dense ~30.7B; 256K ctx; text+image (Ollama ~20GB).' },
  { id: 'mixtral:8x7b', displayName: 'Mixtral 8x7B MoE (Q4)', provider: 'Mistral', tier: 'high-end', minRamGb: 24, recommendedRamGb: 32, diskSizeGb: 26, contextWindow: 32768, description: 'Mixture of Experts.' },
  { id: 'llama3.1:70b', displayName: 'Llama 3.1 70B (Q4)', provider: 'Meta', tier: 'high-end', minRamGb: 48, recommendedRamGb: 64, diskSizeGb: 40, contextWindow: 131072, description: 'Enterprise-grade.' },
  { id: 'llama3.1:405b-q2_K', displayName: 'Llama 3.1 405B (Q2_K)', provider: 'Meta', tier: 'high-end', minRamGb: 128, recommendedRamGb: 192, diskSizeGb: 136, contextWindow: 131072, description: 'Largest Llama.' }
]

export function LlmSettings({ theme = 'default', bridge }: LlmSettingsProps) {
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [modelCatalog, setModelCatalog] = useState<LlmModelConfig[]>(FALLBACK_CATALOG)
  const [selectedModel, setSelectedModel] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState(0)
  const [installStatus, setInstallStatus] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [performanceEstimates, setPerformanceEstimates] = useState<Map<string, PerformanceEstimate>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orchestratorConfig, setOrchestratorConfig] = useState<OrchestratorModeConfig | null>(null)
  
  // Bridge-agnostic API
  const api = useMemo(() => {
    if (bridge === 'ipc') {
      // IPC bridge for Electron renderer
      return {
        getHardware: () => (window as any).electron.ipcRenderer.invoke('llm:getHardware'),
        getStatus: () => (window as any).electron.ipcRenderer.invoke('llm:getStatus'),
        getCatalog: () => (window as any).electron.ipcRenderer.invoke('llm:getModelCatalog'),
        startOllama: () => (window as any).electron.ipcRenderer.invoke('llm:startOllama'),
        installModel: (modelId: string) => (window as any).electron.ipcRenderer.invoke('llm:installModel', modelId),
        deleteModel: (modelId: string) => (window as any).electron.ipcRenderer.invoke('llm:deleteModel', modelId),
        setActiveModel: (modelId: string) => (window as any).electron.ipcRenderer.invoke('llm:setActiveModel', modelId),
        getPerformanceEstimate: (modelId: string) => (window as any).electron.ipcRenderer.invoke('llm:getPerformanceEstimate', modelId),
        getOrchestratorMode: async (): Promise<{ ok: boolean; config?: OrchestratorModeConfig }> => {
          try {
            const config = await (window as any).electron.ipcRenderer.invoke('orchestrator:getMode')
            if (
              config &&
              typeof config === 'object' &&
              (config.mode === 'host' || config.mode === 'sandbox')
            ) {
              return { ok: true, config: config as OrchestratorModeConfig }
            }
          } catch (e) {
            console.warn('[LlmSettings] orchestrator:getMode failed:', e)
          }
          return { ok: false }
        },
      }
    } else {
      // HTTP bridge for Extension — typed RPC, no dynamic endpoints
      return {
        getHardware: () => rpc('llm.hardware'),
        getStatus: () => rpc('llm.status'),
        getCatalog: () => rpc('llm.catalog'),
        startOllama: () => rpc('llm.start'),
        installModel: (modelId: string) => rpc('llm.installModel', { modelId }),
        deleteModel: (modelId: string) => rpc('llm.deleteModel', { modelId }),
        setActiveModel: (modelId: string) => rpc('llm.activateModel', { modelId }),
        getPerformanceEstimate: (modelId: string) => rpc('llm.performance', { modelId }),
        getOrchestratorMode: async (): Promise<{ ok: boolean; config?: OrchestratorModeConfig }> => {
          const res = await rpc('orchestrator.getMode')
          const data = res.data as { ok?: boolean; config?: unknown } | undefined
          if (!res.ok || !data || data.ok !== true || data.config == null || typeof data.config !== 'object') {
            return { ok: false }
          }
          const c = data.config as OrchestratorModeConfig
          if (c.mode !== 'host' && c.mode !== 'sandbox') return { ok: false }
          return { ok: true, config: c }
        },
      }
    }
  }, [bridge])
  
  // Load data on mount
  useEffect(() => {
    loadData()

    // Listen for install progress if using IPC
    if (bridge === 'ipc') {
      const handleProgress = (_event: any, progress: any) => {
        setInstallProgress(progress.progress || 0)
        setInstallStatus(progress.status || '')

        if (progress.status === 'verified') {
          // Verified: model confirmed present in Ollama after install.
          showNotification('Model installed and verified successfully!', 'success')
          setTimeout(() => {
            setInstalling(null)
            loadData()
          }, 500)
        } else if (progress.status === 'verification_failed') {
          // Install stream ended but model not found in Ollama.
          showNotification(progress.error || 'Install verification failed — model not found in Ollama.', 'error')
          setInstalling(null)
        } else if (progress.status === 'error') {
          showNotification(progress.error || 'Installation failed.', 'error')
          setInstalling(null)
        } else if (progress.progress >= 100 || progress.status === 'complete') {
          // Legacy fallback for older backends that don't send 'verified'.
          setTimeout(() => {
            setInstalling(null)
            loadData()
          }, 1000)
        }
      }

      ;(window as any).electron?.ipcRenderer?.on('llm:installProgress', handleProgress)

      return () => {
        ;(window as any).electron?.ipcRenderer?.removeListener('llm:installProgress', handleProgress)
      }
    }
  }, [bridge])
  
  const loadData = async () => {
    try {
      setLoading(true)
      setError(null)

      let orchCfg: OrchestratorModeConfig | null = null
      const orchPromise = (async () => {
        try {
          const om = await api.getOrchestratorMode()
          if (om.ok && om.config) {
            orchCfg = om.config
          }
        } catch (e) {
          console.warn('[LlmSettings] Orchestrator mode load failed:', e)
        }
      })()
      
      // Try to fetch data, but don't block on errors
      const [hwRes, statusRes, catalogRes] = await Promise.all([
        api.getHardware().catch((e: Error) => {
          console.warn('[LlmSettings] Hardware API failed:', e.message)
          return { ok: false, error: e.message }
        }),
        api.getStatus().catch((e: Error) => {
          console.warn('[LlmSettings] Status API failed:', e.message)
          return { ok: false, error: e.message }
        }),
        api.getCatalog().catch((e: Error) => {
          console.warn('[LlmSettings] Catalog API failed:', e.message)
          return { ok: false, error: e.message }
        }),
        orchPromise,
      ])

      setOrchestratorConfig(orchCfg)
      
      const hwEntity = unwrapLlmEnvelope(hwRes, isHardwareEntity)
      if (hwEntity) setHardware(hwEntity)
      const statusEntity = unwrapLlmEnvelope(statusRes, isOllamaStatusEntity)
      if (statusEntity) setStatus(statusEntity)
      const catalogEntity = unwrapLlmEnvelope(catalogRes, isCatalogEntity)
      if (catalogEntity) setModelCatalog(catalogEntity)
      // else keep FALLBACK_CATALOG
      
      // If all APIs failed, show connection error but still allow UI to work
      if (!hwRes.ok && !statusRes.ok && !catalogRes.ok) {
        setError('Cannot connect to Electron app. Using offline mode.')
      }
      
      setLoading(false)
    } catch (err: any) {
      console.error('[LlmSettings] Failed to load data:', err)
      setError('Electron app not reachable. Using offline mode.')
      setLoading(false)
    }
  }

  const loadDataRef = useRef(loadData)
  loadDataRef.current = loadData

  // When the Electron app changes the active model elsewhere (e.g. inbox bulk toolbar), refresh this
  // panel on focus/visibility so it matches the same persisted preference as HTTP `llm.status`.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void loadDataRef.current()
    }
    const onFocus = () => {
      void loadDataRef.current()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [bridge])
  
  const handleStartOllama = async () => {
    try {
      const res = await api.startOllama()
      // res.ok = HTTP success, res.data.ok = API success
      if (res.ok && res.data?.ok) {
        showNotification('Ollama started successfully', 'success')
        setTimeout(() => loadData(), 2000)
      } else {
        showNotification(res.data?.error || res.error || 'Failed to start Ollama', 'error')
      }
    } catch (error: any) {
      showNotification(error.message || 'Failed to start Ollama', 'error')
    }
  }
  
  const handleInstallModel = async () => {
    if (!selectedModel) return

    setInstalling(selectedModel)
    setInstallProgress(0)
    setInstallStatus('Starting installation...')

    try {
      const res = await api.installModel(selectedModel)
      if (res.ok && res.data?.ok) {
        // Poll for progress if using HTTP (no real-time updates via IPC events)
        if (bridge === 'http') {
          const pollInterval = setInterval(async () => {
            try {
              const progressRes = await rpc('llm.installProgress')
              if (progressRes.ok && progressRes.data) {
                const progress = progressRes.data.progress
                if (progress) {
                  setInstallProgress(progress.progress || 0)
                  setInstallStatus(progress.status || 'Downloading...')

                  if (progress.status === 'verified') {
                    // Verified success: model confirmed present in Ollama after install.
                    clearInterval(pollInterval)
                    showNotification('Model installed and verified successfully!', 'success')
                    try {
                      chrome.storage?.local?.set({
                        'llm-model-installed': { modelId: selectedModel, timestamp: Date.now() },
                      })
                    } catch (e) {
                      console.warn('[LlmSettings] Failed to notify model installation:', e)
                    }
                    setTimeout(() => { setInstalling(null); loadData() }, 500)

                  } else if (progress.status === 'verification_failed') {
                    // Stream ended but model not found in Ollama — show failure, not success.
                    clearInterval(pollInterval)
                    showNotification(
                      progress.error || 'Install verification failed — model not found in Ollama.',
                      'error',
                    )
                    setInstalling(null)

                  } else if (progress.status === 'error') {
                    clearInterval(pollInterval)
                    showNotification(progress.error || 'Installation failed.', 'error')
                    setInstalling(null)

                  } else if (progress.status === 'success' || progress.progress >= 100) {
                    // Legacy fallback: older backend without verification support.
                    clearInterval(pollInterval)
                    showNotification('Model installed successfully!', 'success')
                    try {
                      chrome.storage?.local?.set({
                        'llm-model-installed': { modelId: selectedModel, timestamp: Date.now() },
                      })
                    } catch (e) {
                      console.warn('[LlmSettings] Failed to notify model installation:', e)
                    }
                    setTimeout(() => { setInstalling(null); loadData() }, 1000)
                  }
                } else {
                  console.log('[LlmSettings] No progress data yet')
                }
              }
            } catch (pollError) {
              console.warn('[LlmSettings] Poll error:', pollError)
            }
          }, 1000)

          // Safety timeout — 30 minutes for very large models
          setTimeout(() => clearInterval(pollInterval), 1_800_000)
        }
      } else {
        showNotification(res.data?.error || res.error || 'Installation failed', 'error')
        setInstalling(null)
      }
    } catch (error: any) {
      showNotification(error.message || 'Installation failed', 'error')
      setInstalling(null)
    }
  }
  
  const handleDeleteModel = async (modelId: string) => {
    if (!confirm(`Delete model "${modelId}"? This will free up disk space.`)) return
    
    setDeleting(modelId)
    try {
      const res = await api.deleteModel(modelId)
      if (res.ok && res.data?.ok) {
        showNotification('Model deleted successfully', 'success')
        await loadData()
      } else {
        showNotification(res.data?.error || res.error || 'Deletion failed', 'error')
      }
    } catch (error: any) {
      showNotification(error.message || 'Deletion failed', 'error')
    } finally {
      setDeleting(null)
    }
  }
  
  const handleActivateModel = async (modelId: string) => {
    try {
      const res = await api.setActiveModel(modelId)
      // IPC returns { ok, error? }; HTTP RPC wraps body in data: { ok, error? }
      const innerOk = res.data && typeof res.data === 'object' && 'ok' in res.data
        ? (res.data as { ok: boolean }).ok
        : undefined
      const success = !!res.ok && innerOk !== false
      if (success) {
        showNotification(`Switched to ${modelId}`, 'success')
        await loadData()
      } else {
        const msg =
          (res.data && typeof res.data === 'object' && 'error' in res.data
            ? (res.data as { error?: string }).error
            : undefined) ||
          res.error ||
          'Failed to switch model'
        showNotification(msg, 'error')
      }
    } catch (error: any) {
      showNotification(error.message || 'Failed to switch model', 'error')
    }
  }
  
  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 3000)
  }
  
  // Get performance estimate for catalog model
  const getEstimateForModel = (modelId: string): PerformanceEstimate | null => {
    return performanceEstimates.get(modelId) || null
  }
  
  // Load performance estimates for visible models
  useEffect(() => {
    if (!hardware || !modelCatalog || modelCatalog.length === 0) return
    if (orchestratorConfig?.mode === 'sandbox') return
    
    const loadEstimates = async () => {
      const estimates = new Map<string, PerformanceEstimate>()
      for (const model of modelCatalog) {
        try {
          const res = await api.getPerformanceEstimate(model.id)
          if (res.ok && res.data?.ok && res.data.data) {
            estimates.set(model.id, res.data.data)
          }
        } catch (error) {
          // Ignore errors
        }
      }
      setPerformanceEstimates(estimates)
    }
    
    loadEstimates()
  }, [hardware, modelCatalog, orchestratorConfig?.mode])
  
  // Theme colors from unified token system
  const tt = getThemeTokens(theme ?? 'default')
  const textColor = tt.text
  const bgPrimary = tt.cardBg

  const isSandbox = orchestratorConfig?.mode === 'sandbox'
  const sandboxOllamaDisabled = isSandbox

  /** Extension Settings persists host/sandbox to localStorage only when the user clicks Save. */
  const showHostServingLabel = useMemo(() => {
    if (orchestratorConfig?.mode !== 'host') return false
    try {
      const raw = localStorage.getItem('optimando-orchestrator-mode')
      if (!raw) return false
      const j = JSON.parse(raw) as { mode?: string }
      return j.mode === 'host'
    } catch {
      return false
    }
  }, [orchestratorConfig?.mode])

  return (
    <div style={{ padding: '10px', color: textColor }}>
      <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: '600' }}>
        Local LLM (Ollama)
      </h4>
      {showHostServingLabel && (
        <div
          style={{
            margin: '-6px 0 10px 0',
            fontSize: '10px',
            opacity: 0.75,
            color: tt.textMuted,
          }}
        >
          Host Mode — Serving inference to connected sandboxes
        </div>
      )}
      {isSandbox && (
        <div
          style={{
            marginBottom: '12px',
            padding: '10px',
            borderRadius: '6px',
            fontSize: '11px',
            lineHeight: 1.45,
            background: tt.isLight ? 'rgba(79, 70, 229, 0.1)' : 'rgba(129, 140, 248, 0.14)',
            border: `1px solid ${tt.info}`,
            color: tt.infoText,
          }}
        >
          {
            '🔗 Sandbox Mode — Inference will use the BEAP channel after you create an internal handshake in the Handshakes panel. Local Ollama management is disabled.'
          }
        </div>
      )}
      
      {/* Loading State */}
      {loading && (
        <div style={{
          padding: '20px',
          textAlign: 'center',
          fontSize: '12px',
          opacity: 0.7
        }}>
          Loading LLM configuration...
        </div>
      )}
      
      {/* Error State - Non-blocking */}
      {error && !loading && (
        <div style={{
          padding: '10px',
          background: 'rgba(255, 193, 7, 0.1)',
          border: '1px solid rgba(255, 193, 7, 0.3)',
          borderRadius: '6px',
          marginBottom: '12px',
          fontSize: '10px'
        }}>
          <div style={{ fontWeight: '600', marginBottom: '4px', color: '#f59e0b' }}>
            ⚠️ Offline Mode
          </div>
          <div style={{ opacity: 0.9, marginBottom: '6px' }}>{error}</div>
          <div style={{ fontSize: '9px', opacity: 0.7, marginBottom: '8px' }}>
            You can still browse models. Start the Electron app to install them.
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              disabled={sandboxOllamaDisabled}
              onClick={async () => {
                if (sandboxOllamaDisabled) return
                try {
                  await api.startOllama()
                  showNotification('Attempting to start Ollama...', 'success')
                  setTimeout(() => loadData(), 3000)
                } catch (e: any) {
                  showNotification('Failed to start Ollama', 'error')
                }
              }}
              style={{
                flex: 1,
                padding: '6px 10px',
                background: sandboxOllamaDisabled ? '#94a3b8' : '#22c55e',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '10px',
                fontWeight: '600',
                cursor: sandboxOllamaDisabled ? 'not-allowed' : 'pointer',
                opacity: sandboxOllamaDisabled ? 0.55 : 1,
              }}
            >
              Start Ollama
            </button>
            <button
              onClick={loadData}
              style={{
                flex: 1,
                padding: '6px 10px',
                background: '#2563eb',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '10px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Retry Connection
            </button>
          </div>
        </div>
      )}
      
      {/* Hardware Info */}
      {!loading && hardware && (
        <div style={{
          padding: '10px',
          background: bgPrimary,
          borderRadius: '6px',
          marginBottom: '12px',
          fontSize: '11px'
        }}>
          <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '10px', opacity: 0.8 }}>
            SYSTEM INFO
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '6px', fontSize: '10px' }}>
            <span style={{ opacity: 0.7 }}>Total RAM:</span>
            <span style={{ fontWeight: '600' }}>{hardware.totalRamGb} GB</span>
            
            <span style={{ opacity: 0.7 }}>FREE RAM:</span>
            <span style={{ 
              fontWeight: '600',
              color: hardware.freeRamGb >= 8 ? '#22c55e' : hardware.freeRamGb >= 4 ? '#f59e0b' : '#ef4444'
            }}>
              {hardware.freeRamGb} GB {hardware.freeRamGb >= 8 ? '🟢' : hardware.freeRamGb >= 4 ? '🟡' : '🔴'}
            </span>
            
            <span style={{ opacity: 0.7 }}>CPU:</span>
            <span>
              {hardware.cpuCores} cores
              {hardware.cpuName && (
                <div style={{ fontSize: '9px', opacity: 0.6, marginTop: '2px' }}>
                  {hardware.cpuName.length > 40 ? hardware.cpuName.substring(0, 40) + '...' : hardware.cpuName}
                </div>
              )}
            </span>
            
            {/* CPU Capabilities - Critical Info */}
            {(hardware.cpuHasAVX2 !== undefined || hardware.cpuHasFMA !== undefined) && (
              <>
                <span style={{ opacity: 0.7 }}>CPU Support:</span>
                <span style={{ 
                  fontWeight: '600',
                  color: hardware.cpuHasAVX2 ? '#22c55e' : '#ef4444'
                }}>
                  AVX2: {hardware.cpuHasAVX2 ? '✅ Yes' : '❌ No'} 
                  {hardware.cpuHasFMA !== undefined && ` | FMA: ${hardware.cpuHasFMA ? '✅' : '❌'}`}
                  {!hardware.cpuHasAVX2 && ' 🔴'}
                </span>
              </>
            )}
            
            {hardware.gpuAvailable && (
              <>
                <span style={{ opacity: 0.7 }}>GPU:</span>
                <span>Available{hardware.gpuVramGb ? ` (${hardware.gpuVramGb} GB VRAM)` : ''}</span>
              </>
            )}
            
            <span style={{ opacity: 0.7 }}>Disk Free:</span>
            <span>{hardware.diskFreeGb} GB</span>
          </div>
          
          {/* CRITICAL WARNING for old CPUs lacking AVX2 */}
          {hardware.cpuHasAVX2 === false && (
            <div style={{
              marginTop: '10px',
              padding: '10px',
              background: 'rgba(220,38,38,0.15)',
              border: '2px solid rgba(220,38,38,0.5)',
              borderRadius: '6px',
              fontSize: '10px',
              lineHeight: '1.5'
            }}>
              <div style={{ 
                fontWeight: '700', 
                color: '#dc2626',
                marginBottom: '6px',
                fontSize: '11px'
              }}>
                🔴 OLD CPU DETECTED - Local AI Won't Work Well
              </div>
              <div style={{ marginBottom: '4px' }}>
                Your CPU lacks modern instruction sets (AVX2/FMA) that are critical for fast local LLM inference. 
                Local models will run in a <strong>slow fallback mode (~2 tokens/sec)</strong> which makes them nearly unusable.
              </div>
              <div style={{ 
                marginTop: '6px',
                padding: '6px',
                background: 'rgba(34,197,94,0.15)',
                border: '1px solid rgba(34,197,94,0.4)',
                borderRadius: '4px'
              }}>
                ✅ <strong>Cloud AI is NOT affected</strong> and will run at full speed on any hardware.
              </div>
            </div>
          )}
          
          {hardware.warnings.length > 0 && (
            <div style={{
              marginTop: '8px',
              padding: '6px',
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '4px',
              fontSize: '9px',
              lineHeight: '1.4'
            }}>
              {hardware.warnings.map((w, i) => (
                <div key={i} style={{ marginBottom: i < hardware.warnings.length - 1 ? '4px' : 0 }}>
                  {w}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {isSandbox && !loading && (
        <div
          style={{
            padding: '10px',
            background: 'rgba(245,158,11,0.12)',
            border: '1px solid rgba(245,158,11,0.35)',
            borderRadius: '6px',
            marginBottom: '12px',
            fontSize: '11px',
            lineHeight: 1.45,
          }}
        >
          <div style={{ fontWeight: '600', marginBottom: '6px', fontSize: '10px' }}>CONNECT VIA HANDSHAKE</div>
          <div style={{ fontSize: '10px', opacity: 0.95 }}>
            Complete an internal handshake with your host device in the <strong>Handshakes</strong> panel. No manual host
            URL is required.
          </div>
        </div>
      )}
      {!isSandbox && status && (
        <div style={{
          padding: '10px',
          background: status.running ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          border: `1px solid ${status.running ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
          borderRadius: '6px',
          marginBottom: '12px',
          fontSize: '11px'
        }}>
          <div style={{ fontWeight: '600', marginBottom: '6px', fontSize: '10px' }}>
            {status.running ? '✅ OLLAMA RUNNING' : '❌ OLLAMA NOT RUNNING'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '4px', fontSize: '10px' }}>
            <span style={{ opacity: 0.7 }}>Installed:</span>
            <span>{status.installed ? '✅ Yes' : '❌ No'}</span>
            {status.version && (
              <>
                <span style={{ opacity: 0.7 }}>Version:</span>
                <span>{status.version}</span>
              </>
            )}
            <span style={{ opacity: 0.7 }}>Port:</span>
            <span>{status.port}</span>
            {status.localRuntime && (
              <>
                <span style={{ opacity: 0.7 }}>Runtime:</span>
                <span title={status.localRuntime.evidence ?? status.localRuntime.summary}>
                  {status.localRuntime.summary}
                </span>
              </>
            )}
          </div>
          
          {!status.installed && (
            <div style={{
              marginTop: '8px',
              padding: '8px',
              background: 'rgba(239,68,68,0.2)',
              border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: '4px',
              fontSize: '10px'
            }}>
              ⚠️ Ollama not found. Please install Ollama from{' '}
              <a 
                href="https://ollama.ai" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: '#60a5fa', textDecoration: 'underline' }}
              >
                ollama.ai
              </a>
              {' '}or check if it's installed correctly.
            </div>
          )}
          
          {status.installed && !status.running && (
            <button
              onClick={handleStartOllama}
              style={{
                marginTop: '8px',
                padding: '6px 10px',
                background: '#2563eb',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '10px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Start Ollama
            </button>
          )}
        </div>
      )}
      {/* Installed Models */}
      {status?.modelsInstalled && status.modelsInstalled.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontWeight: '600', marginBottom: '6px', fontSize: '10px', opacity: 0.8 }}>
            INSTALLED MODELS ({status.modelsInstalled.length})
          </div>
          {status.modelsInstalled.map((model) => (
            <div key={model.name} style={{
              padding: '8px',
              background: model.isActive ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)',
              border: model.isActive ? '1px solid rgba(34,197,94,0.3)' : '1px solid transparent',
              borderRadius: '4px',
              marginBottom: '4px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '10px'
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: '600', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {model.name}
                  {model.isActive && (
                    <span style={{
                      padding: '2px 6px',
                      background: '#059669',
                      borderRadius: '3px',
                      fontSize: '8px',
                      fontWeight: '600'
                    }}>
                      ✓ ACTIVE
                    </span>
                  )}
                </div>
                <div style={{ opacity: 0.7 }}>
                  {(model.size / (1024**3)).toFixed(2)} GB
                </div>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {!model.isActive && (
                  <button
                    type="button"
                    disabled={sandboxOllamaDisabled}
                    onClick={() => handleActivateModel(model.name)}
                    style={{
                      padding: '4px 8px',
                      background: 'rgba(59,130,246,0.2)',
                      border: '1px solid rgba(59,130,246,0.4)',
                      borderRadius: '3px',
                      color: '#60a5fa',
                      fontSize: '9px',
                      cursor: sandboxOllamaDisabled ? 'not-allowed' : 'pointer',
                      opacity: sandboxOllamaDisabled ? 0.45 : 1,
                    }}
                  >
                    ⚡ Use
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDeleteModel(model.name)}
                  disabled={deleting === model.name || sandboxOllamaDisabled}
                  style={{
                    padding: '4px 8px',
                    background: 'rgba(239,68,68,0.2)',
                    border: '1px solid rgba(239,68,68,0.4)',
                    borderRadius: '3px',
                    color: '#ef4444',
                    fontSize: '9px',
                    cursor: deleting === model.name || sandboxOllamaDisabled ? 'not-allowed' : 'pointer',
                    opacity: deleting === model.name ? 0.5 : sandboxOllamaDisabled ? 0.45 : 1,
                  }}
                >
                  {deleting === model.name ? '...' : '🗑'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Install New Model - Always show */}
      {!loading && (
        <div style={{
          padding: '10px',
          background: bgPrimary,
          borderRadius: '6px',
          marginTop: '12px'
        }}>
          <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '10px', opacity: 0.8 }}>
            INSTALL NEW MODEL
          </div>
          
          {status && !status.installed && !isSandbox && (
            <div style={{
              padding: '10px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '4px',
              fontSize: '10px',
              marginBottom: '8px'
            }}>
              <div style={{ fontWeight: '600', marginBottom: '6px' }}>
                ⚠️ Ollama Not Installed
              </div>
              <div style={{ marginBottom: '8px', opacity: 0.9 }}>
                Ollama is required to run local LLMs. Please install it to continue.
              </div>
              <a 
                href="https://ollama.ai/download" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  padding: '6px 12px',
                  background: '#2563eb',
                  color: '#fff',
                  textDecoration: 'none',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: '600'
                }}
              >
                Download Ollama
              </a>
            </div>
          )}
          
          {status && status.installed && !status.running && !isSandbox && (
            <div style={{
              padding: '8px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '4px',
              fontSize: '10px',
              marginBottom: '8px'
            }}>
              ⚠️ Ollama is not running. Start Ollama to install models.
              <button
                type="button"
                onClick={handleStartOllama}
                style={{
                  marginTop: '6px',
                  padding: '4px 8px',
                  background: '#2563eb',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '10px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'block'
                }}
              >
                Start Ollama
              </button>
            </div>
          )}
          
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={
              sandboxOllamaDisabled ||
              !!installing ||
              !!(status && (!status.installed || !status.running))
            }
            style={{
              width: '100%',
              padding: '8px',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '4px',
              color: textColor,
              fontSize: '10px',
              marginBottom: '8px',
              cursor:
                sandboxOllamaDisabled || installing || (status && (!status.installed || !status.running))
                  ? 'not-allowed'
                  : 'pointer',
              opacity:
                sandboxOllamaDisabled || (status && (!status.installed || !status.running)) ? 0.45 : 1,
            }}
          >
            <option value="">-- Select a model --</option>
            {modelCatalog.map((model) => {
              const isInstalled = status?.modelsInstalled.some(m => m.name === model.id)
              const estimate = getEstimateForModel(model.id)
              const indicator = estimate ? 
                (estimate.estimate === 'fast' ? '🟢' :
                 estimate.estimate === 'usable' ? '🟡' :
                 estimate.estimate === 'slow' ? '🟠' : '🔴') : ''
              
              return (
                <option key={model.id} value={model.id}>
                  {indicator} {model.displayName} - {model.diskSizeGb}GB ({model.provider}) {isInstalled ? '[INSTALLED]' : ''}
                </option>
              )
            })}
          </select>
          
          {selectedModel && modelCatalog.find(m => m.id === selectedModel) && (
            <div style={{
              fontSize: '9px',
              marginBottom: '8px',
              padding: '6px',
              background: 'rgba(59,130,246,0.1)',
              border: '1px solid rgba(59,130,246,0.3)',
              borderRadius: '4px'
            }}>
              <strong>{modelCatalog.find(m => m.id === selectedModel)!.displayName}</strong>
              <br/>
              {modelCatalog.find(m => m.id === selectedModel)!.description}
              <br/>
              <span style={{ opacity: 0.8 }}>
                RAM: {modelCatalog.find(m => m.id === selectedModel)!.recommendedRamGb}GB • 
                Size: {modelCatalog.find(m => m.id === selectedModel)!.diskSizeGb}GB
              </span>
            </div>
          )}
          
          {installing && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '10px', marginBottom: '4px', opacity: 0.8 }}>
                {installStatus}
              </div>
              <div style={{
                width: '100%',
                height: '6px',
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '3px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${installProgress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #2563eb, #60a5fa)',
                  transition: 'width 0.3s ease'
                }} />
              </div>
              <div style={{ fontSize: '9px', marginTop: '2px', textAlign: 'right', opacity: 0.8 }}>
                {installProgress.toFixed(0)}%
              </div>
            </div>
          )}
          
          <button
            type="button"
            onClick={handleInstallModel}
            disabled={
              sandboxOllamaDisabled ||
              !selectedModel ||
              !!installing ||
              !!(status && (!status.installed || !status.running))
            }
            style={{
              width: '100%',
              padding: '10px 12px',
              background: '#2563eb',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '12px',
              fontWeight: '600',
              cursor:
                sandboxOllamaDisabled ||
                !selectedModel ||
                installing ||
                (status && (!status.installed || !status.running))
                  ? 'not-allowed'
                  : 'pointer',
              opacity:
                sandboxOllamaDisabled ||
                !selectedModel ||
                installing ||
                (status && (!status.installed || !status.running))
                  ? 0.5
                  : 1,
            }}
          >
            {installing ? 'Installing...' : '⚡ Install Selected Model'}
          </button>
        </div>
      )}
      
      {/* Notification */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          padding: '12px 16px',
          background: notification.type === 'success' ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)',
          border: `1px solid ${notification.type === 'success' ? '#22c55e' : '#ef4444'}`,
          borderRadius: '6px',
          color: '#fff',
          fontSize: '12px',
          fontWeight: '500',
          zIndex: 10000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>
          {notification.message}
        </div>
      )}
    </div>
  )
}

