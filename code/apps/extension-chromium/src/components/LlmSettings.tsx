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

export function LlmSettings({ theme = 'default', bridge }: LlmSettingsProps) {
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [modelCatalog, setModelCatalog] = useState<LlmModelConfig[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState(0)
  const [installStatus, setInstallStatus] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [performanceEstimates, setPerformanceEstimates] = useState<Map<string, PerformanceEstimate>>(new Map())
  
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
      return {
        getHardware: () => fetch(`${baseUrl}/api/llm/hardware`).then(r => r.json()),
        getStatus: () => fetch(`${baseUrl}/api/llm/status`).then(r => r.json()),
        getCatalog: () => fetch(`${baseUrl}/api/llm/catalog`).then(r => r.json()),
        startOllama: () => fetch(`${baseUrl}/api/llm/start`, { method: 'POST' }).then(r => r.json()),
        installModel: (modelId: string) => fetch(`${baseUrl}/api/llm/models/install`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId })
        }).then(r => r.json()),
        deleteModel: (modelId: string) => fetch(`${baseUrl}/api/llm/models/${encodeURIComponent(modelId)}`, {
          method: 'DELETE'
        }).then(r => r.json()),
        setActiveModel: (modelId: string) => fetch(`${baseUrl}/api/llm/models/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId })
        }).then(r => r.json()),
        getPerformanceEstimate: (modelId: string) => fetch(`${baseUrl}/api/llm/performance/${encodeURIComponent(modelId)}`).then(r => r.json())
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
      const [hwRes, statusRes, catalogRes] = await Promise.all([
        api.getHardware(),
        api.getStatus(),
        api.getCatalog()
      ])
      
      if (hwRes.ok) setHardware(hwRes.data)
      if (statusRes.ok) setStatus(statusRes.data)
      if (catalogRes.ok) setModelCatalog(catalogRes.data)
    } catch (error) {
      console.error('[LlmSettings] Failed to load data:', error)
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
            const statusRes = await api.getStatus()
            if (statusRes.ok) {
              // Installation complete when model appears in list
              const installed = statusRes.data.modelsInstalled.find((m: InstalledModel) => 
                m.name === selectedModel
              )
              if (installed) {
                clearInterval(pollInterval)
                setInstallProgress(100)
                setInstallStatus('Installation complete!')
                showNotification('Model installed successfully!', 'success')
                setTimeout(() => {
                  setInstalling(null)
                  loadData()
                }, 2000)
              }
            }
          }, 2000)
          
          // Timeout after 5 minutes
          setTimeout(() => clearInterval(pollInterval), 300000)
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
      
      {/* Hardware Info */}
      {hardware && (
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
      
      {/* Install New Model */}
      {status?.running && (
        <div style={{
          padding: '10px',
          background: bgPrimary,
          borderRadius: '6px'
        }}>
          <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '10px', opacity: 0.8 }}>
            INSTALL NEW MODEL
          </div>
          
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={!!installing}
            style={{
              width: '100%',
              padding: '8px',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '4px',
              color: textColor,
              fontSize: '10px',
              marginBottom: '8px',
              cursor: installing ? 'not-allowed' : 'pointer'
            }}
          >
            <option value="">-- Select a model --</option>
            {modelCatalog.map((model) => {
              const isInstalled = status.modelsInstalled.some(m => m.name === model.id)
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
            disabled={!selectedModel || !!installing}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: '#2563eb',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '12px',
              fontWeight: '600',
              cursor: (!selectedModel || installing) ? 'not-allowed' : 'pointer',
              opacity: (!selectedModel || installing) ? 0.5 : 1
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

