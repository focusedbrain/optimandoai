/**
 * LLM Settings Shared Component
 * Can be used in both Extension (HTTP bridge) and Electron app (IPC bridge)
 */

import React, { useState, useEffect, useMemo } from 'react'

// Types
interface HardwareInfo {
  totalRamGb: number
  freeRamGb: number
  cpuCores: number
  cpuThreads: number
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
  { id: 'mistral:7b', displayName: 'Mistral 7B Full', provider: 'Mistral', tier: 'performance', minRamGb: 7, recommendedRamGb: 8, diskSizeGb: 4.1, contextWindow: 8192, description: 'Full precision.' },
  { id: 'llama3.1:8b', displayName: 'Llama 3.1 8B (Q4)', provider: 'Meta', tier: 'performance', minRamGb: 6, recommendedRamGb: 8, diskSizeGb: 4.7, contextWindow: 131072, description: '128K context.' },
  { id: 'gemma2:9b', displayName: 'Gemma 2 9B (Q4)', provider: 'Google', tier: 'performance', minRamGb: 7, recommendedRamGb: 9, diskSizeGb: 5.4, contextWindow: 8192, description: 'Latest Google.' },
  { id: 'mistral-nemo:12b', displayName: 'Mistral Nemo 12B (Q4)', provider: 'Mistral', tier: 'performance', minRamGb: 8, recommendedRamGb: 10, diskSizeGb: 7.1, contextWindow: 128000, description: '128K context.' },
  { id: 'codellama:13b', displayName: 'Code Llama 13B (Q4)', provider: 'Meta', tier: 'performance', minRamGb: 10, recommendedRamGb: 13, diskSizeGb: 7.4, contextWindow: 16384, description: 'Coding specialist.' },
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
        getPerformanceEstimate: (modelId: string) => (window as any).electron.ipcRenderer.invoke('llm:getPerformanceEstimate', modelId)
      }
    } else {
      // HTTP bridge for Extension
      const baseUrl = 'http://127.0.0.1:51248'
      
      const safeFetch = async (url: string, options?: RequestInit) => {
        try {
          const response = await fetch(url, options)
          const contentType = response.headers.get('content-type')
          
          // Check if response is JSON
          if (!contentType || !contentType.includes('application/json')) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`)
          }
          
          return response.json()
        } catch (err: any) {
          console.error('[LlmSettings] Fetch error:', err)
          throw err
        }
      }
      
      return {
        getHardware: () => safeFetch(`${baseUrl}/api/llm/hardware`),
        getStatus: () => safeFetch(`${baseUrl}/api/llm/status`),
        getCatalog: () => safeFetch(`${baseUrl}/api/llm/catalog`),
        startOllama: () => safeFetch(`${baseUrl}/api/llm/start`, { method: 'POST' }),
        installModel: (modelId: string) => safeFetch(`${baseUrl}/api/llm/models/install`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId })
        }),
        deleteModel: (modelId: string) => safeFetch(`${baseUrl}/api/llm/models/${encodeURIComponent(modelId)}`, {
          method: 'DELETE'
        }),
        setActiveModel: (modelId: string) => safeFetch(`${baseUrl}/api/llm/models/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId })
        }),
        getPerformanceEstimate: (modelId: string) => safeFetch(`${baseUrl}/api/llm/performance/${encodeURIComponent(modelId)}`)
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
        if (progress.progress >= 100 || progress.status === 'complete') {
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
      
      // Try to fetch data, but don't block on errors
      const [hwRes, statusRes, catalogRes] = await Promise.all([
        api.getHardware().catch(e => {
          console.warn('[LlmSettings] Hardware API failed:', e.message)
          return { ok: false, error: e.message }
        }),
        api.getStatus().catch(e => {
          console.warn('[LlmSettings] Status API failed:', e.message)
          return { ok: false, error: e.message }
        }),
        api.getCatalog().catch(e => {
          console.warn('[LlmSettings] Catalog API failed:', e.message)
          return { ok: false, error: e.message }
        })
      ])
      
      if (hwRes.ok) setHardware(hwRes.data)
      if (statusRes.ok) setStatus(statusRes.data)
      if (catalogRes.ok && catalogRes.data) setModelCatalog(catalogRes.data)
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
  
  const handleStartOllama = async () => {
    try {
      const res = await api.startOllama()
      if (res.ok) {
        showNotification('Ollama started successfully', 'success')
        setTimeout(() => loadData(), 2000)
      } else {
        showNotification(res.error || 'Failed to start Ollama', 'error')
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
      if (res.ok) {
        // Poll for progress if using HTTP (no real-time updates)
        if (bridge === 'http') {
          const pollInterval = setInterval(async () => {
            try {
              // Poll the new progress endpoint
              const progressRes = await fetch('http://127.0.0.1:51248/api/llm/install-progress')
              if (progressRes.ok) {
                const { progress } = await progressRes.json()
                if (progress) {
                  setInstallProgress(progress.progress || 0)
                  setInstallStatus(progress.status || 'Downloading...')
                  
                  // Stop polling when complete
                  if (progress.status === 'success' || progress.progress >= 100) {
                    clearInterval(pollInterval)
                    showNotification('Model installed successfully!', 'success')
                    setTimeout(() => {
                      setInstalling(null)
                      loadData()
                    }, 1000)
                  }
                }
              }
            } catch (pollError) {
              // Silently continue polling on error
              console.warn('[LlmSettings] Poll error:', pollError)
            }
          }, 1000) // Poll every second
          
          // Safety timeout
          setTimeout(() => clearInterval(pollInterval), 1800000) // 30 min
        }
      } else {
        showNotification(res.error || 'Installation failed', 'error')
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
      if (res.ok) {
        showNotification('Model deleted successfully', 'success')
        await loadData()
      } else {
        showNotification(res.error || 'Deletion failed', 'error')
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
      if (res.ok) {
        showNotification(`Switched to ${modelId}`, 'success')
        await loadData()
      } else {
        showNotification(res.error || 'Failed to switch model', 'error')
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
    if (!hardware || modelCatalog.length === 0) return
    
    const loadEstimates = async () => {
      const estimates = new Map<string, PerformanceEstimate>()
      for (const model of modelCatalog) {
        try {
          const res = await api.getPerformanceEstimate(model.id)
          if (res.ok) {
            estimates.set(model.id, res.data)
          }
        } catch (error) {
          // Ignore errors
        }
      }
      setPerformanceEstimates(estimates)
    }
    
    loadEstimates()
  }, [hardware, modelCatalog])
  
  // Theme colors
  const textColor = theme === 'dark' || theme === 'professional' ? '#e5e5e5' : '#1f2937'
  const bgPrimary = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.08)'
  
  return (
    <div style={{ padding: '10px', color: textColor }}>
      <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: '600' }}>
        Local LLM (Ollama)
      </h4>
      
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
              onClick={async () => {
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
                background: '#22c55e',
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
            <span>{hardware.cpuCores} cores</span>
            
            {hardware.gpuAvailable && (
              <>
                <span style={{ opacity: 0.7 }}>GPU:</span>
                <span>Available{hardware.gpuVramGb ? ` (${hardware.gpuVramGb} GB VRAM)` : ''}</span>
              </>
            )}
            
            <span style={{ opacity: 0.7 }}>Disk Free:</span>
            <span>{hardware.diskFreeGb} GB</span>
          </div>
          
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
      
      {/* Ollama Status */}
      {status && (
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
                    onClick={() => handleActivateModel(model.name)}
                    style={{
                      padding: '4px 8px',
                      background: 'rgba(59,130,246,0.2)',
                      border: '1px solid rgba(59,130,246,0.4)',
                      borderRadius: '3px',
                      color: '#60a5fa',
                      fontSize: '9px',
                      cursor: 'pointer'
                    }}
                  >
                    ⚡ Use
                  </button>
                )}
                <button
                  onClick={() => handleDeleteModel(model.name)}
                  disabled={deleting === model.name}
                  style={{
                    padding: '4px 8px',
                    background: 'rgba(239,68,68,0.2)',
                    border: '1px solid rgba(239,68,68,0.4)',
                    borderRadius: '3px',
                    color: '#ef4444',
                    fontSize: '9px',
                    cursor: deleting === model.name ? 'not-allowed' : 'pointer',
                    opacity: deleting === model.name ? 0.5 : 1
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
          
          {status && !status.installed && (
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
          
          {status && status.installed && !status.running && (
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
            disabled={!!installing || (status && (!status.installed || !status.running))}
            style={{
              width: '100%',
              padding: '8px',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '4px',
              color: textColor,
              fontSize: '10px',
              marginBottom: '8px',
              cursor: (installing || (status && (!status.installed || !status.running))) ? 'not-allowed' : 'pointer',
              opacity: (status && status.installed && status.running) ? 1 : 0.6
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
            onClick={handleInstallModel}
            disabled={!selectedModel || !!installing || (status && (!status.installed || !status.running))}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: '#2563eb',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '12px',
              fontWeight: '600',
              cursor: (!selectedModel || installing || (status && (!status.installed || !status.running))) ? 'not-allowed' : 'pointer',
              opacity: (!selectedModel || installing || (status && (!status.installed || !status.running))) ? 0.5 : 1
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

