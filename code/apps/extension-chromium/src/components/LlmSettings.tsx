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

interface LocalLlmStatus {
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

/** B0: llama-server binary provisioning status (`GET /api/llm/binary/status`). */
interface LlamaServerBinaryStatus {
  binaryInstalled: boolean
  recommendedVariant: 'cpu' | 'cuda' | 'vulkan'
  reason: string
}

/** B0: llama-server binary install progress (`GET /api/llm/binary/install-progress`). */
interface LlamaServerBinaryInstallProgress {
  status: 'starting' | 'resolving_release' | 'downloading' | 'extracting' | 'verifying' | 'complete' | 'error'
  progress: number
  variant?: 'cpu' | 'cuda' | 'vulkan'
  version?: string
  completed?: number
  total?: number
  sha256?: string
  error?: string
}

/** Matches Electron `orchestratorModeStore` payload (subset used by UI). */
interface OrchestratorModeConfig {
  mode: 'host' | 'sandbox'
}

/** build038: persisted llama-server inference settings (user-language, no raw flags). */
interface LlmServerConfig {
  ctxMode: 'standard' | 'long' | 'max'
  parallel: 1 | 2 | 4
  reasoningEnabled: boolean
}

/** build039: `GET /api/llm/server-config` payload. */
interface LlmServerConfigView {
  config: LlmServerConfig
  ctxPresets: { standard: number; long: number }
  maxCtxPerSlot: number | null
  kvSource: 'gguf' | 'fallback' | null
  vramUsedBytes: number | null
  vramTotalBytes: number | null
  applied: {
    args: string[]
    ctxTokens: number
    ctxPerSlot: number
    parallel: number
    parallelRequested: number
    reasoningEnabled: boolean
  } | null
  clampNotice: string | null
  restart: { pending: boolean; waitingForTasks: boolean }
  serverRunning: boolean
  activeModel: string | null
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

function isLocalLlmStatusEntity(x: unknown): x is LocalLlmStatus {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as LocalLlmStatus).installed === 'boolean' &&
    typeof (x as LocalLlmStatus).running === 'boolean' &&
    Array.isArray((x as LocalLlmStatus).modelsInstalled)
  )
}

function isCatalogEntity(x: unknown): x is LlmModelConfig[] {
  return Array.isArray(x) && x.length > 0
}

function isBinaryStatusEntity(x: unknown): x is LlamaServerBinaryStatus {
  return typeof x === 'object' && x !== null && typeof (x as LlamaServerBinaryStatus).binaryInstalled === 'boolean'
}

function isServerConfigViewEntity(x: unknown): x is LlmServerConfigView {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as LlmServerConfigView).config === 'object' &&
    (x as LlmServerConfigView).config !== null &&
    typeof (x as LlmServerConfigView).config.reasoningEnabled === 'boolean'
  )
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
  { id: 'gemma4:e2b', displayName: 'Gemma 4 E2B Edge (Q4_K_M)', provider: 'Google', tier: 'balanced', minRamGb: 8, recommendedRamGb: 10, diskSizeGb: 7.2, contextWindow: 131072, description: 'Gemma 4 edge; ~2.3B eff. params; 128K ctx; text+image (~7.2GB).' },
  { id: 'gemma4:e4b', displayName: 'Gemma 4 E4B Edge (Q4_K_M)', provider: 'Google', tier: 'balanced', minRamGb: 10, recommendedRamGb: 12, diskSizeGb: 9.6, contextWindow: 131072, description: 'Gemma 4 edge; ~4.5B eff. params; 128K ctx; text+image (~9.6GB).' },
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
  { id: 'gemma4:26b', displayName: 'Gemma 4 26B MoE A4B (Q4_K_M)', provider: 'Google', tier: 'performance', minRamGb: 20, recommendedRamGb: 24, diskSizeGb: 18, contextWindow: 262144, description: 'Gemma 4 MoE; ~25.2B total / ~3.8B active; 256K ctx; text+image (~18GB).' },
  { id: 'gemma4:31b', displayName: 'Gemma 4 31B Dense (Q4_K_M)', provider: 'Google', tier: 'high-end', minRamGb: 24, recommendedRamGb: 32, diskSizeGb: 20, contextWindow: 262144, description: 'Gemma 4 dense ~30.7B; 256K ctx; text+image (~20GB).' },
  { id: 'mixtral:8x7b', displayName: 'Mixtral 8x7B MoE (Q4)', provider: 'Mistral', tier: 'high-end', minRamGb: 24, recommendedRamGb: 32, diskSizeGb: 26, contextWindow: 32768, description: 'Mixture of Experts.' },
  { id: 'llama3.1:70b', displayName: 'Llama 3.1 70B (Q4)', provider: 'Meta', tier: 'high-end', minRamGb: 48, recommendedRamGb: 64, diskSizeGb: 40, contextWindow: 131072, description: 'Enterprise-grade.' },
  { id: 'llama3.1:405b-q2_K', displayName: 'Llama 3.1 405B (Q2_K)', provider: 'Meta', tier: 'high-end', minRamGb: 128, recommendedRamGb: 192, diskSizeGb: 136, contextWindow: 131072, description: 'Largest Llama.' }
]

export function LlmSettings({ theme = 'default', bridge }: LlmSettingsProps) {
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [status, setStatus] = useState<LocalLlmStatus | null>(null)
  const [modelCatalog, setModelCatalog] = useState<LlmModelConfig[]>(FALLBACK_CATALOG)
  const [downloadUrl, setDownloadUrl] = useState('')
  const [lastInstallSha256, setLastInstallSha256] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState(0)
  const [installStatus, setInstallStatus] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [performanceEstimates, setPerformanceEstimates] = useState<Map<string, PerformanceEstimate>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orchestratorConfig, setOrchestratorConfig] = useState<OrchestratorModeConfig | null>(null)
  const [binaryStatus, setBinaryStatus] = useState<LlamaServerBinaryStatus | null>(null)
  const [binaryInstalling, setBinaryInstalling] = useState(false)
  const [binaryInstallProgress, setBinaryInstallProgress] = useState<LlamaServerBinaryInstallProgress | null>(null)
  // build038: Inference Settings (host-only)
  const [serverConfigView, setServerConfigView] = useState<LlmServerConfigView | null>(null)
  const [draftServerConfig, setDraftServerConfig] = useState<LlmServerConfig | null>(null)
  const [applyingSettings, setApplyingSettings] = useState<null | 'saving' | 'waiting' | 'restarting'>(null)
  
  // Bridge-agnostic API
  const api = useMemo(() => {
    if (bridge === 'ipc') {
      // IPC bridge for Electron renderer
      return {
        getHardware: () => (window as any).electron.ipcRenderer.invoke('llm:getHardware'),
        getStatus: () => (window as any).electron.ipcRenderer.invoke('llm:getStatus'),
        getCatalog: () => (window as any).electron.ipcRenderer.invoke('llm:getModelCatalog'),
        startLocalLlm: () => (window as any).electron.ipcRenderer.invoke('llm:startOllama'),
        importModelFromPicker: () => (window as any).electron.ipcRenderer.invoke('llm:importModelFromPicker'),
        downloadModelFromUrl: (url: string) =>
          (window as any).electron.ipcRenderer.invoke('llm:downloadModelFromUrl', url),
        cancelModelDownload: () => (window as any).electron.ipcRenderer.invoke('llm:cancelModelDownload'),
        deleteModel: (modelId: string) => (window as any).electron.ipcRenderer.invoke('llm:deleteModel', modelId),
        setActiveModel: (modelId: string) => (window as any).electron.ipcRenderer.invoke('llm:setActiveModel', modelId),
        getPerformanceEstimate: (modelId: string) => (window as any).electron.ipcRenderer.invoke('llm:getPerformanceEstimate', modelId),
        getBinaryStatus: () => (window as any).electron.ipcRenderer.invoke('llm:binaryStatus'),
        installLlamaServerBinary: (variant: 'cpu' | 'cuda' | 'vulkan') =>
          (window as any).electron.ipcRenderer.invoke('llm:installLlamaServerBinary', variant),
        getBinaryInstallProgress: () => (window as any).electron.ipcRenderer.invoke('llm:binaryInstallProgress'),
        getServerConfig: () => (window as any).electron.ipcRenderer.invoke('llm:serverConfigGet'),
        setServerConfig: (patch: Partial<LlmServerConfig>) =>
          (window as any).electron.ipcRenderer.invoke('llm:serverConfigSet', patch),
        restartServer: () => (window as any).electron.ipcRenderer.invoke('llm:serverRestart'),
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
        startLocalLlm: () => rpc('llm.start'),
        importModelFromPicker: () => rpc('llm.importModelFromPicker'),
        downloadModelFromUrl: (url: string) => rpc('llm.downloadModelFromUrl', { url }),
        cancelModelDownload: () => rpc('llm.cancelModelDownload'),
        deleteModel: (modelId: string) => rpc('llm.deleteModel', { modelId }),
        setActiveModel: (modelId: string) => rpc('llm.activateModel', { modelId }),
        getPerformanceEstimate: (modelId: string) => rpc('llm.performance', { modelId }),
        getBinaryStatus: () => rpc('llm.binaryStatus'),
        installLlamaServerBinary: (variant: 'cpu' | 'cuda' | 'vulkan') =>
          rpc('llm.installLlamaServerBinary', { variant }),
        getBinaryInstallProgress: () => rpc('llm.binaryInstallProgress'),
        getServerConfig: () => rpc('llm.serverConfigGet'),
        setServerConfig: (patch: Partial<LlmServerConfig>) => rpc('llm.serverConfigSet', patch),
        restartServer: () => rpc('llm.serverRestart'),
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
          if (progress.digest) setLastInstallSha256(progress.digest)
          showNotification('Model installed and verified successfully!', 'success')
          notifyModelInstalled(progress.modelId || 'gguf')
          setTimeout(() => {
            setInstalling(null)
            loadData()
          }, 500)
        } else if (progress.status === 'verification_failed') {
          // Install stream ended but model not found in the local llama.cpp registry.
          showNotification(progress.error || 'Install verification failed — model not found.', 'error')
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
      const [hwRes, statusRes, catalogRes, binaryStatusRes, serverConfigRes] = await Promise.all([
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
        api.getBinaryStatus().catch((e: Error) => {
          console.warn('[LlmSettings] Binary status API failed:', e.message)
          return { ok: false, error: e.message }
        }),
        api.getServerConfig().catch((e: Error) => {
          console.warn('[LlmSettings] Server config API failed:', e.message)
          return { ok: false, error: e.message }
        }),
        orchPromise,
      ])

      setOrchestratorConfig(orchCfg)
      
      const hwEntity = unwrapLlmEnvelope(hwRes, isHardwareEntity)
      if (hwEntity) setHardware(hwEntity)
      const statusEntity = unwrapLlmEnvelope(statusRes, isLocalLlmStatusEntity)
      if (statusEntity) setStatus(statusEntity)
      const catalogEntity = unwrapLlmEnvelope(catalogRes, isCatalogEntity)
      if (catalogEntity) setModelCatalog(catalogEntity)
      // else keep FALLBACK_CATALOG
      const binaryStatusEntity = unwrapLlmEnvelope(binaryStatusRes, isBinaryStatusEntity)
      if (binaryStatusEntity) setBinaryStatus(binaryStatusEntity)
      const serverConfigEntity = unwrapLlmEnvelope(serverConfigRes, isServerConfigViewEntity)
      if (serverConfigEntity) {
        setServerConfigView(serverConfigEntity)
        // Preserve unsaved edits across background refreshes; adopt server state otherwise.
        setDraftServerConfig((prev) => prev ?? { ...serverConfigEntity.config })
      }
      
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
  
  const handleStartLocalLlm = async () => {
    try {
      const res = await api.startLocalLlm()
      // res.ok = HTTP success, res.data.ok = API success
      if (res.ok && res.data?.ok) {
        showNotification('Local LLM server started successfully', 'success')
        setTimeout(() => loadData(), 2000)
      } else {
        showNotification(res.data?.error || res.error || 'Failed to start local LLM server', 'error')
      }
    } catch (error: any) {
      showNotification(error.message || 'Failed to start local LLM server', 'error')
    }
  }

  const handleInstallBinary = async (variant: 'cpu' | 'cuda' | 'vulkan') => {
    if (binaryInstalling) return
    setBinaryInstalling(true)
    setBinaryInstallProgress({ status: 'starting', progress: 0, variant })
    try {
      await api.installLlamaServerBinary(variant)
    } catch (error: any) {
      setBinaryInstalling(false)
      showNotification(error.message || 'Failed to start llama-server download', 'error')
      return
    }

    const poll = async () => {
      try {
        const res: any = await api.getBinaryInstallProgress()
        // HTTP bridge nests the JSON body in `res.data`; IPC bridge resolves it directly.
        const progress: LlamaServerBinaryInstallProgress | undefined = res?.data?.progress ?? res?.progress
        if (!progress || typeof progress.status !== 'string') {
          setTimeout(poll, 700)
          return
        }
        setBinaryInstallProgress(progress)
        if (progress.status === 'complete') {
          setBinaryInstalling(false)
          showNotification('llama-server installed successfully', 'success')
          await loadData()
          return
        }
        if (progress.status === 'error') {
          setBinaryInstalling(false)
          showNotification(progress.error || 'llama-server installation failed', 'error')
          return
        }
        setTimeout(poll, 700)
      } catch {
        setTimeout(poll, 1500)
      }
    }
    setTimeout(poll, 500)
  }
  
  /** Fetch the freshest server-config view (used by the apply/restart poll loop). */
  const fetchServerConfigView = async (): Promise<LlmServerConfigView | null> => {
    try {
      const res = await api.getServerConfig()
      return unwrapLlmEnvelope(res, isServerConfigViewEntity)
    } catch {
      return null
    }
  }

  /** build038 "Apply & restart AI server": persist settings, restart gracefully, poll until back up. */
  const handleApplyServerSettings = async () => {
    if (!draftServerConfig || applyingSettings) return
    setApplyingSettings('saving')
    try {
      const saveRes = await api.setServerConfig(draftServerConfig)
      const saveOk = saveRes.ok && (saveRes.data?.ok ?? true) !== false
      if (!saveOk) {
        showNotification(saveRes.data?.error || saveRes.error || 'Failed to save settings', 'error')
        setApplyingSettings(null)
        return
      }
      const restartRes = await api.restartServer()
      const restartOk = restartRes.ok && (restartRes.data?.ok ?? true) !== false
      if (!restartOk) {
        showNotification(restartRes.data?.error || restartRes.error || 'Failed to restart AI server', 'error')
        setApplyingSettings(null)
        return
      }
      setApplyingSettings('restarting')

      const deadline = Date.now() + 15 * 60_000
      const poll = async () => {
        if (Date.now() > deadline) {
          setApplyingSettings(null)
          showNotification('AI server restart timed out — check the status above.', 'error')
          return
        }
        const view = await fetchServerConfigView()
        if (view) {
          setServerConfigView(view)
          if (view.restart.pending) {
            setApplyingSettings(view.restart.waitingForTasks ? 'waiting' : 'restarting')
            setTimeout(poll, 1500)
            return
          }
          if (view.serverRunning) {
            setApplyingSettings(null)
            setDraftServerConfig({ ...view.config })
            showNotification('AI server restarted with the new settings', 'success')
            await loadData()
            return
          }
        }
        setTimeout(poll, 1500)
      }
      setTimeout(poll, 1500)
    } catch (error: any) {
      setApplyingSettings(null)
      showNotification(error.message || 'Failed to apply settings', 'error')
    }
  }

  const notifyModelInstalled = (modelId: string) => {
    try {
      chrome.storage?.local?.set({
        'llm-model-installed': { modelId, timestamp: Date.now() },
      })
    } catch (e) {
      console.warn('[LlmSettings] Failed to notify model installation:', e)
    }
  }

  const pollInstallProgressHttp = (modelLabel: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const progressRes = await rpc('llm.installProgress')
        if (!progressRes.ok || !progressRes.data) return
        const progress = progressRes.data.progress
        if (!progress) return
        setInstallProgress(progress.progress || 0)
        const bytes =
          progress.completed != null && progress.total
            ? `${(progress.completed / (1024 ** 2)).toFixed(1)} / ${(progress.total / (1024 ** 2)).toFixed(1)} MB`
            : null
        setInstallStatus(
          bytes ? `${progress.status || 'working'} (${bytes})` : progress.status || 'Working…',
        )
        if (progress.digest) setLastInstallSha256(progress.digest)
        if (progress.status === 'verified') {
          clearInterval(pollInterval)
          showNotification('Model installed and verified successfully!', 'success')
          notifyModelInstalled(progress.modelId || modelLabel)
          setTimeout(() => {
            setInstalling(null)
            loadData()
          }, 500)
        } else if (progress.status === 'error' || progress.status === 'verification_failed') {
          clearInterval(pollInterval)
          showNotification(progress.error || 'Installation failed.', 'error')
          setInstalling(null)
        }
      } catch (pollError) {
        console.warn('[LlmSettings] Poll error:', pollError)
      }
    }, 1000)
    setTimeout(() => clearInterval(pollInterval), 1_800_000)
  }

  const handleImportFromPicker = async () => {
    setInstalling('import')
    setInstallProgress(0)
    setInstallStatus('Opening file picker…')
    try {
      const res = await api.importModelFromPicker()
      if (res.data?.cancelled || res.cancelled) {
        setInstalling(null)
        return
      }
      const inner = res.data?.data ?? res.data
      if (res.ok && inner?.sha256) {
        setLastInstallSha256(inner.sha256)
        showNotification(`Imported ${inner.modelId}`, 'success')
        notifyModelInstalled(inner.modelId)
        setInstalling(null)
        await loadData()
        return
      }
      if (bridge === 'http' && res.ok) {
        pollInstallProgressHttp('import')
        return
      }
      showNotification(res.data?.error || res.error || 'Import failed', 'error')
      setInstalling(null)
    } catch (error: any) {
      showNotification(error.message || 'Import failed', 'error')
      setInstalling(null)
    }
  }

  const handleDownloadFromUrl = async () => {
    const url = downloadUrl.trim()
    if (!url) return
    setInstalling('download')
    setInstallProgress(0)
    setInstallStatus('Starting HTTPS download…')
    try {
      const res = await api.downloadModelFromUrl(url)
      if (res.ok && (res.data?.ok ?? res.ok)) {
        if (bridge === 'http') pollInstallProgressHttp(url)
        return
      }
      showNotification(res.data?.error || res.error || 'Download failed to start', 'error')
      setInstalling(null)
    } catch (error: any) {
      showNotification(error.message || 'Download failed', 'error')
      setInstalling(null)
    }
  }

  const handleCancelDownload = async () => {
    try {
      await api.cancelModelDownload()
    } finally {
      setInstalling(null)
      setInstallStatus('Cancelled')
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
  const sandboxLocalLlmDisabled = isSandbox

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
        Local LLM (llama.cpp)
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
            '🔗 Sandbox Mode — Inference will use the BEAP channel after you create an internal handshake in the Handshakes panel. Local LLM management is disabled.'
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
              disabled={sandboxLocalLlmDisabled}
              onClick={async () => {
                if (sandboxLocalLlmDisabled) return
                try {
                  await api.startLocalLlm()
                  showNotification('Attempting to start local LLM server...', 'success')
                  setTimeout(() => loadData(), 3000)
                } catch (e: any) {
                  showNotification('Failed to start local LLM server', 'error')
                }
              }}
              style={{
                flex: 1,
                padding: '6px 10px',
                background: sandboxLocalLlmDisabled ? '#94a3b8' : '#22c55e',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '10px',
                fontWeight: '600',
                cursor: sandboxLocalLlmDisabled ? 'not-allowed' : 'pointer',
                opacity: sandboxLocalLlmDisabled ? 0.55 : 1,
              }}
            >
              Start Server
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
      {!isSandbox && status && (() => {
        // B5: four mutually-exclusive states, derived from the unified provider status
        // (binaryStatus from GET /api/llm/binary/status, status from GET /api/llm/status).
        const binaryInstalled = binaryStatus?.binaryInstalled ?? status.installed
        const hasModels = status.modelsInstalled.length > 0
        const uiState: 'binary_missing' | 'no_model' | 'server_stopped' | 'running' = !binaryInstalled
          ? 'binary_missing'
          : !hasModels
            ? 'no_model'
            : status.running
              ? 'running'
              : 'server_stopped'

        const stateColors = {
          binary_missing: { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.4)' },
          no_model: { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)' },
          server_stopped: { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)' },
          running: { bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.4)' },
        }[uiState]

        const stateLabel = {
          binary_missing: '⚠️ LLAMA-SERVER NOT INSTALLED',
          no_model: '⚠️ NO MODEL INSTALLED',
          server_stopped: '⏸ SERVER STOPPED',
          running: '✅ SERVER RUNNING',
        }[uiState]

        return (
          <div style={{
            padding: '10px',
            background: stateColors.bg,
            border: `1px solid ${stateColors.border}`,
            borderRadius: '6px',
            marginBottom: '12px',
            fontSize: '11px'
          }}>
            <div style={{ fontWeight: '600', marginBottom: '6px', fontSize: '10px' }}>
              {stateLabel}
            </div>

            {uiState === 'running' && (
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '4px', fontSize: '10px' }}>
                {status.activeModel && (
                  <>
                    <span style={{ opacity: 0.7 }}>Model:</span>
                    <span style={{ fontWeight: '600' }}>{status.activeModel}</span>
                  </>
                )}
                <span style={{ opacity: 0.7 }}>Port:</span>
                <span>{status.port}</span>
                {status.localRuntime && (
                  <>
                    <span style={{ opacity: 0.7 }}>GPU Offload:</span>
                    <span title={status.localRuntime.evidence ?? status.localRuntime.summary}>
                      {status.localRuntime.summary}
                    </span>
                  </>
                )}
              </div>
            )}

            {uiState === 'binary_missing' && (
              <div style={{ fontSize: '10px', lineHeight: 1.5 }}>
                <div style={{ marginBottom: '8px', color: 'var(--text-primary, var(--text-primary-prof))' }}>
                  The llama.cpp inference server (llama-server) is not installed yet. Install it now — the
                  download comes directly from the official ggml-org/llama.cpp GitHub releases over HTTPS, with
                  a SHA256 checksum shown before use.
                </div>
                {binaryInstalling && binaryInstallProgress ? (
                  <div style={{ marginBottom: '4px' }}>
                    <div style={{ marginBottom: '4px' }}>
                      {binaryInstallProgress.status === 'resolving_release' && 'Resolving latest release…'}
                      {binaryInstallProgress.status === 'downloading' && `Downloading… ${binaryInstallProgress.progress}%`}
                      {binaryInstallProgress.status === 'extracting' && 'Extracting…'}
                      {binaryInstallProgress.status === 'verifying' && 'Verifying SHA256…'}
                      {binaryInstallProgress.status === 'starting' && 'Starting install…'}
                    </div>
                    {binaryInstallProgress.sha256 && (
                      <div style={{ fontSize: '9px', opacity: 0.75, wordBreak: 'break-all', marginBottom: '4px' }}>
                        SHA256: {binaryInstallProgress.sha256}
                      </div>
                    )}
                    <div style={{
                      height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.15)', overflow: 'hidden'
                    }}>
                      <div style={{
                        height: '100%', width: `${binaryInstallProgress.progress}%`,
                        background: '#2563eb', transition: 'width 0.3s'
                      }} />
                    </div>
                  </div>
                ) : (
                  <button
                    disabled={sandboxLocalLlmDisabled}
                    onClick={() => handleInstallBinary(binaryStatus?.recommendedVariant ?? 'cpu')}
                    style={{
                      padding: '6px 10px',
                      background: sandboxLocalLlmDisabled ? '#94a3b8' : '#2563eb',
                      border: 'none',
                      borderRadius: '4px',
                      color: '#fff',
                      fontSize: '10px',
                      fontWeight: '600',
                      cursor: sandboxLocalLlmDisabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Install llama-server ({(binaryStatus?.recommendedVariant ?? 'cpu').toUpperCase()} build)
                  </button>
                )}
              </div>
            )}

            {uiState === 'no_model' && (
              <div style={{ fontSize: '10px', color: 'var(--text-primary, var(--text-primary-prof))' }}>
                llama-server is installed but no GGUF model is installed yet. Install one below to activate
                local inference.
              </div>
            )}

            {uiState === 'server_stopped' && (
              <>
                <div style={{ fontSize: '10px', marginBottom: '8px', color: 'var(--text-primary, var(--text-primary-prof))' }}>
                  A model is installed but the server is not running.
                </div>
                <button
                  onClick={handleStartLocalLlm}
                  style={{
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
                  Start Server
                </button>
              </>
            )}
          </div>
        )
      })()}
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
                  {model.digest ? (
                    <>
                      <br />
                      <span style={{ fontFamily: 'monospace', fontSize: '8px', wordBreak: 'break-all' }}>
                        SHA256: {model.digest}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {!model.isActive && (
                  <button
                    type="button"
                    disabled={sandboxLocalLlmDisabled}
                    onClick={() => handleActivateModel(model.name)}
                    style={{
                      padding: '4px 8px',
                      background: 'rgba(59,130,246,0.2)',
                      border: '1px solid rgba(59,130,246,0.4)',
                      borderRadius: '3px',
                      color: '#60a5fa',
                      fontSize: '9px',
                      cursor: sandboxLocalLlmDisabled ? 'not-allowed' : 'pointer',
                      opacity: sandboxLocalLlmDisabled ? 0.45 : 1,
                    }}
                  >
                    ⚡ Use
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDeleteModel(model.name)}
                  disabled={deleting === model.name || sandboxLocalLlmDisabled}
                  style={{
                    padding: '4px 8px',
                    background: 'rgba(239,68,68,0.2)',
                    border: '1px solid rgba(239,68,68,0.4)',
                    borderRadius: '3px',
                    color: '#ef4444',
                    fontSize: '9px',
                    cursor: deleting === model.name || sandboxLocalLlmDisabled ? 'not-allowed' : 'pointer',
                    opacity: deleting === model.name ? 0.5 : sandboxLocalLlmDisabled ? 0.45 : 1,
                  }}
                >
                  {deleting === model.name ? '...' : '🗑'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* build038: Inference Settings — host-only (sandbox has no local server) */}
      {!isSandbox && !loading && serverConfigView && draftServerConfig && (() => {
        const view = serverConfigView
        const draft = draftServerConfig
        const dirty =
          draft.ctxMode !== view.config.ctxMode ||
          draft.parallel !== view.config.parallel ||
          draft.reasoningEnabled !== view.config.reasoningEnabled
        const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1)
        const maxLabel =
          view.maxCtxPerSlot != null
            ? `Maximum (~${view.maxCtxPerSlot.toLocaleString()} tokens per conversation on your GPU)`
            : 'Maximum (computed from your GPU memory)'
        const applied = view.applied
        const busyLabel =
          applyingSettings === 'waiting'
            ? 'Waiting for current task to finish…'
            : applyingSettings === 'restarting'
              ? 'Restarting AI server…'
              : applyingSettings === 'saving'
                ? 'Saving…'
                : null
        const selectStyle: React.CSSProperties = {
          width: '100%',
          padding: '5px 8px',
          borderRadius: '4px',
          border: '1px solid rgba(148,163,184,0.4)',
          background: tt.isLight ? '#ffffff' : 'rgba(15,23,42,0.6)',
          color: textColor,
          fontSize: '10px',
        }
        return (
          <div style={{
            padding: '10px',
            background: bgPrimary,
            borderRadius: '6px',
            marginBottom: '12px',
            color: textColor,
            fontSize: '11px',
          }}>
            <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '10px', opacity: 0.8 }}>
              INFERENCE SETTINGS
            </div>

            {/* a. Response style */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontWeight: '600', fontSize: '10px', marginBottom: '4px' }}>Response style</div>
              {([
                { value: false, label: 'Fast & direct (recommended)' },
                { value: true, label: 'Deep reasoning (slower, more thorough)' },
              ] as const).map((opt) => (
                <label
                  key={String(opt.value)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', marginBottom: '3px', cursor: 'pointer' }}
                >
                  <input
                    type="radio"
                    name="llm-response-style"
                    checked={draft.reasoningEnabled === opt.value}
                    disabled={!!applyingSettings}
                    onChange={() => setDraftServerConfig({ ...draft, reasoningEnabled: opt.value })}
                  />
                  {opt.label}
                </label>
              ))}
              <div style={{ fontSize: '9px', opacity: 0.75, lineHeight: 1.4, marginTop: '2px' }}>
                Deep reasoning makes the model think step-by-step before answering. Automated tasks like inbox
                analysis work best with Fast &amp; direct.
              </div>
            </div>

            {/* b. Memory per conversation */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontWeight: '600', fontSize: '10px', marginBottom: '4px' }}>Memory per conversation</div>
              <select
                value={draft.ctxMode}
                disabled={!!applyingSettings}
                onChange={(e) =>
                  setDraftServerConfig({ ...draft, ctxMode: e.target.value as LlmServerConfig['ctxMode'] })
                }
                style={selectStyle}
              >
                <option value="standard">Standard (recommended) — {view.ctxPresets.standard.toLocaleString()} tokens</option>
                <option value="long">Long documents — {view.ctxPresets.long.toLocaleString()} tokens</option>
                <option value="max">{maxLabel}</option>
              </select>
              <div style={{ fontSize: '9px', opacity: 0.75, lineHeight: 1.4, marginTop: '2px' }}>
                More memory lets the AI read longer inputs but uses more GPU memory.
              </div>
            </div>

            {/* c. Parallel tasks */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontWeight: '600', fontSize: '10px', marginBottom: '4px' }}>Parallel tasks</div>
              <select
                value={draft.parallel}
                disabled={!!applyingSettings}
                onChange={(e) =>
                  setDraftServerConfig({ ...draft, parallel: Number(e.target.value) as LlmServerConfig['parallel'] })
                }
                style={selectStyle}
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={4}>4 (recommended)</option>
              </select>
              <div style={{ fontSize: '9px', opacity: 0.75, lineHeight: 1.4, marginTop: '2px' }}>
                How many AI tasks can run at the same time. Lower this if you see out-of-memory errors.
              </div>
            </div>

            {/* Non-blocking clamp notice */}
            {view.clampNotice && (
              <div style={{
                padding: '6px 8px',
                marginBottom: '8px',
                borderRadius: '4px',
                fontSize: '9px',
                lineHeight: 1.4,
                background: 'rgba(245,158,11,0.12)',
                border: '1px solid rgba(245,158,11,0.35)',
                color: 'var(--text-primary, inherit)',
              }}>
                {view.clampNotice}
              </div>
            )}

            {/* e. Apply & restart */}
            {busyLabel ? (
              <div style={{
                padding: '6px 8px',
                borderRadius: '4px',
                fontSize: '10px',
                background: 'rgba(59,130,246,0.12)',
                border: '1px solid rgba(59,130,246,0.35)',
                color: 'var(--text-primary, inherit)',
                marginBottom: '8px',
              }}>
                {busyLabel}
              </div>
            ) : dirty ? (
              <button
                type="button"
                onClick={handleApplyServerSettings}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  marginBottom: '8px',
                  background: '#2563eb',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '10px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Apply &amp; restart AI server
              </button>
            ) : null}

            {/* d. Read-only status line */}
            <div style={{
              fontSize: '9px',
              opacity: 0.85,
              lineHeight: 1.5,
              borderTop: '1px solid rgba(148,163,184,0.25)',
              paddingTop: '6px',
              color: 'var(--text-primary, inherit)',
            }}>
              Server: <strong>{view.serverRunning ? 'running' : 'stopped'}</strong>
              {view.activeModel ? <> · Model: <strong>{view.activeModel}</strong></> : null}
              {view.vramUsedBytes != null && view.vramTotalBytes != null ? (
                <> · VRAM: <strong>{gb(view.vramUsedBytes)} / {gb(view.vramTotalBytes)} GB</strong></>
              ) : null}
              {applied ? (
                <>
                  {' '}· Applied: <strong>{applied.ctxPerSlot.toLocaleString()} tokens/conversation</strong>
                  {' '}(<strong>{applied.ctxTokens.toLocaleString()}</strong> total ctx ·{' '}
                  <strong>
                    {applied.parallel}
                    {applied.parallel !== applied.parallelRequested
                      ? ` parallel (requested ${applied.parallelRequested})`
                      : ' parallel'}
                  </strong>
                  ) ·{' '}
                  <strong>{applied.reasoningEnabled ? 'Deep reasoning' : 'Fast & direct'}</strong>
                </>
              ) : (
                <> · Applied: <strong>defaults on next start</strong></>
              )}
            </div>
          </div>
        )
      })()}

      {/* Install GGUF model — file picker (recommended) or verified HTTPS download */}
      {!loading && (
        <div style={{
          padding: '10px',
          background: bgPrimary,
          borderRadius: '6px',
          marginTop: '12px',
          color: textColor,
        }}>
          <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '10px', opacity: 0.8 }}>
            INSTALL GGUF MODEL
          </div>
          <p style={{ fontSize: '10px', margin: '0 0 10px', color: 'var(--text-primary, inherit)', lineHeight: 1.45 }}>
            Recommended: import a <strong>.gguf</strong> you obtained and verified out-of-band (no network egress).
            Optional: download from an allowlisted <strong>Hugging Face HTTPS</strong> link — SHA256 is shown so you can
            cross-check the publisher checksum.
          </p>

          {installing && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '10px', marginBottom: '4px', color: 'var(--text-primary, inherit)' }}>
                {installStatus}
              </div>
              <div style={{
                width: '100%',
                height: '6px',
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '3px',
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${installProgress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #2563eb, #60a5fa)',
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{ fontSize: '9px', marginTop: '2px', textAlign: 'right', opacity: 0.8 }}>
                {installProgress.toFixed(0)}%
              </div>
              {installing === 'download' && (
                <button
                  type="button"
                  onClick={handleCancelDownload}
                  style={{
                    marginTop: '6px',
                    padding: '4px 8px',
                    fontSize: '9px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel download
                </button>
              )}
            </div>
          )}

          {lastInstallSha256 && (
            <div style={{
              fontSize: '9px',
              marginBottom: '8px',
              padding: '6px',
              background: 'rgba(34,197,94,0.08)',
              border: '1px solid rgba(34,197,94,0.25)',
              borderRadius: '4px',
              color: 'var(--text-primary, inherit)',
            }}>
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>Last install SHA256</div>
              <code style={{ wordBreak: 'break-all', fontSize: '8px' }}>{lastInstallSha256}</code>
            </div>
          )}

          <button
            type="button"
            onClick={handleImportFromPicker}
            disabled={sandboxLocalLlmDisabled || !!installing}
            style={{
              width: '100%',
              padding: '10px 12px',
              marginBottom: '8px',
              background: '#059669',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '12px',
              fontWeight: '600',
              cursor: sandboxLocalLlmDisabled || installing ? 'not-allowed' : 'pointer',
              opacity: sandboxLocalLlmDisabled || installing ? 0.5 : 1,
            }}
          >
            {installing === 'import' ? 'Importing…' : '📁 Import from file (recommended)'}
          </button>

          <input
            type="url"
            value={downloadUrl}
            onChange={(e) => setDownloadUrl(e.target.value)}
            placeholder="https://huggingface.co/…/resolve/main/model.gguf"
            disabled={sandboxLocalLlmDisabled || !!installing}
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '8px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '4px',
              color: textColor,
              fontSize: '10px',
            }}
          />
          <button
            type="button"
            onClick={handleDownloadFromUrl}
            disabled={sandboxLocalLlmDisabled || !!installing || !downloadUrl.trim()}
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
                sandboxLocalLlmDisabled || installing || !downloadUrl.trim() ? 'not-allowed' : 'pointer',
              opacity: sandboxLocalLlmDisabled || installing || !downloadUrl.trim() ? 0.5 : 1,
            }}
          >
            {installing === 'download' ? 'Downloading…' : '⬇ Download from Hugging Face URL'}
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

