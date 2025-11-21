/**
 * LLM Setup Wizard - First Run Installation
 * Multi-step wizard for setting up local LLM with hardware checks and model selection
 */

import { useState, useEffect } from 'react'

type WizardStep = 'welcome' | 'hardware' | 'ollama' | 'model-select' | 'download' | 'complete'

interface HardwareInfo {
  totalRamGb: number
  freeRamGb?: number
  cpuCores: number
  osType: string
  canRunMistral7B: boolean
  canRunMistral14B: boolean
  canRunQuantized?: boolean
  recommendedModel?: string
  recommendedTier: string
  warnings?: string[]
}

interface ModelOption {
  id: string
  name: string
  size: string
  ramRequired: number
  recommended: boolean
  description: string
}

const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'tinyllama',
    name: 'TinyLlama',
    size: '~0.6 GB',
    ramRequired: 1,
    recommended: false,
    description: 'Ultra-fast, minimal model for very limited hardware'
  },
  {
    id: 'phi3:mini',
    name: 'Phi-3 Mini',
    size: '~2.3 GB',
    ramRequired: 2,
    recommended: false,
    description: 'Lightweight and fast, good for low-end systems'
  },
  {
    id: 'mistral:7b-instruct-q4_0',
    name: 'Mistral 7B Q4 (Quantized)',
    size: '~2.6 GB',
    ramRequired: 4,
    recommended: true,
    description: 'Recommended: Fast and efficient, works on most systems'
  },
  {
    id: 'mistral:7b-instruct-q5_K_M',
    name: 'Mistral 7B Q5 (Quantized)',
    size: '~3.2 GB',
    ramRequired: 5,
    recommended: false,
    description: 'Better quality than Q4, still efficient'
  },
  {
    id: 'mistral:7b',
    name: 'Mistral 7B (Full)',
    size: '~4.1 GB',
    ramRequired: 8,
    recommended: false,
    description: 'Full precision model for high-end systems'
  },
  {
    id: 'llama3:8b',
    name: 'Llama 3 8B',
    size: '~4.7 GB',
    ramRequired: 8,
    recommended: false,
    description: 'Alternative high-quality model'
  },
  {
    id: 'llama3.1:8b',
    name: 'Llama 3.1 8B',
    size: '~4.7 GB',
    ramRequired: 8,
    recommended: false,
    description: 'Latest Llama 3.1 version with improvements'
  },
  {
    id: 'mixtral:8x7b',
    name: 'Mixtral 8x7B (MoE)',
    size: '~26 GB',
    ramRequired: 32,
    recommended: false,
    description: 'High-end: Mixture of Experts for advanced tasks'
  },
  {
    id: 'llama3.1:70b',
    name: 'Llama 3.1 70B',
    size: '~40 GB',
    ramRequired: 64,
    recommended: false,
    description: 'High-end: Enterprise-grade performance'
  },
  {
    id: 'qwen2:72b',
    name: 'Qwen 2 72B',
    size: '~41 GB',
    ramRequired: 64,
    recommended: false,
    description: 'High-end: Advanced reasoning capabilities'
  }
]

interface LlmSetupWizardProps {
  onComplete: () => void
  onSkip?: () => void
}

export function LlmSetupWizard({ onComplete, onSkip }: LlmSetupWizardProps) {
  const [step, setStep] = useState<WizardStep>('welcome')
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [selectedModel, setSelectedModel] = useState('mistral:7b-instruct-q4_0')
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [downloadDetails, setDownloadDetails] = useState<{
    completed?: number
    total?: number
    speed?: number
    lastUpdate?: number
  }>({})
  const [isDownloading, setIsDownloading] = useState(false)

  useEffect(() => {
    // Listen for download progress
    const llm = (window as any).llm
    llm?.onDownloadProgress((data: any) => {
      console.log('[WIZARD] Download progress:', data)
      setIsDownloading(true)
      setProgress(data.progress || 0)
      setStatus(data.status || 'downloading')
      
      // Calculate download speed
      if (data.completed && data.total) {
        const now = Date.now()
        if (downloadDetails.lastUpdate && downloadDetails.completed) {
          const timeDiff = (now - downloadDetails.lastUpdate) / 1000 // seconds
          const bytesDiff = data.completed - downloadDetails.completed
          const speed = bytesDiff / timeDiff // bytes per second
          setDownloadDetails({
            completed: data.completed,
            total: data.total,
            speed,
            lastUpdate: now
          })
        } else {
          setDownloadDetails({
            completed: data.completed,
            total: data.total,
            lastUpdate: now
          })
        }
      }
    })
  }, [downloadDetails])

  const checkHardware = async () => {
    try {
      const hw = await (window as any).llm?.checkHardware()
      setHardware({
        ...hw,
        canRunMistral14B: hw.totalRamGb >= 16
      })
      return hw
    } catch (err: any) {
      setError(`Hardware check failed: ${err.message}`)
      return null
    }
  }

  const checkOllama = async () => {
    try {
      const status = await (window as any).llm?.getStatus()
      return status
    } catch (err: any) {
      setError(`Failed to check Ollama: ${err.message}`)
      return null
    }
  }

  const handleWelcomeContinue = async () => {
    setError(null)
    const hw = await checkHardware()
    if (hw) {
      setStep('hardware')
    }
  }

  const handleHardwareContinue = async () => {
    setError(null)
    const status = await checkOllama()
    if (status?.ollamaInstalled) {
      setStep('model-select')
    } else {
      setStep('ollama')
    }
  }

  const handleOllamaInstall = () => {
    // Open Ollama download page
    window.open('https://ollama.ai', '_blank')
  }

  const handleOllamaRetry = async () => {
    setError(null)
    const status = await checkOllama()
    if (status?.ollamaInstalled) {
      setStep('model-select')
    } else {
      setError('Ollama still not detected. Please install it and restart the app.')
    }
  }

  const handleModelSelect = (modelId: string) => {
    const model = MODEL_OPTIONS.find(m => m.id === modelId)
    if (model && hardware) {
      if (hardware.totalRamGb < model.ramRequired) {
        setError(`Insufficient RAM. ${model.name} requires at least ${model.ramRequired} GB RAM.`)
        return
      }
    }
    setSelectedModel(modelId)
    setError(null)
  }

  const handleStartDownload = async () => {
    setError(null)
    setProgress(0)
    setStatus('Initializing...')
    setDownloadDetails({})
    setIsDownloading(false)
    setStep('download')

    try {
      // Start Ollama server
      setStatus('Starting Ollama server...')
      setProgress(5)
      await (window as any).llm?.startOllama()
      setProgress(10)

      // Download selected model
      setStatus(`Downloading ${selectedModel}...`)
      setIsDownloading(true)
      await (window as any).llm?.downloadModel(selectedModel)

      setProgress(100)
      setStatus('✓ Installation complete!')
      setIsDownloading(false)
      
      // Save config
      await (window as any).llm?.updateConfig({
        modelId: selectedModel,
        autoStartOllama: true
      })

      localStorage.setItem('llm-setup-complete', 'true')
      
      setTimeout(() => {
        setStep('complete')
      }, 1500)
    } catch (err: any) {
      setError(`Installation failed: ${err.message}`)
      setIsDownloading(false)
    }
  }

  const getRecommendedModels = () => {
    if (!hardware) return MODEL_OPTIONS.map(m => ({ ...m, status: 'unknown' as const }))
    
    const freeRam = hardware.freeRamGb || hardware.totalRamGb * 0.5 // estimate if not available
    
    return MODEL_OPTIONS.map(model => {
      let status: 'good' | 'okay' | 'poor' = 'good'
      let statusText = ''
      let advisoryMessage = ''
      
      // Determine compatibility status
      if (freeRam >= model.ramRequired * 1.5) {
        status = 'good'
        statusText = '🟢 Works Well'
        advisoryMessage = 'This model should run smoothly on your system.'
      } else if (freeRam >= model.ramRequired) {
        status = 'okay'
        statusText = '🟡 May Be Slow'
        advisoryMessage = 'This model will work but might be slower. Close other applications for better performance.'
      } else {
        status = 'poor'
        statusText = '🔴 Not Recommended'
        advisoryMessage = 'Your system may struggle with this model. Consider a lighter option.'
      }
      
      // Override recommendation based on hardware
      let isRecommended = false
      if (freeRam < 3) {
        isRecommended = model.id === 'tinyllama' || model.id === 'phi3:mini'
      } else if (freeRam < 5) {
        isRecommended = model.id === 'phi3:mini' || model.id === 'mistral:7b-instruct-q4_0'
      } else if (freeRam < 7) {
        isRecommended = model.id === 'mistral:7b-instruct-q4_0' || model.id === 'mistral:7b-instruct-q5_K_M'
      } else {
        isRecommended = model.id === 'mistral:7b-instruct-q5_K_M' || model.id === 'mistral:7b'
      }
      
      return {
        ...model,
        status,
        statusText,
        advisoryMessage,
        recommended: isRecommended,
        disabled: false  // Never disable, just advise
      }
    })
  }

  // Welcome Step
  if (step === 'welcome') {
    return (
      <div className="modal-overlay" style={{ zIndex: 10000 }}>
        <div className="modal" style={{ maxWidth: 600 }}>
          <div className="modal-header">
            <div className="modal-title">🤖 Welcome to OpenGiraffe</div>
          </div>
          <div className="modal-body">
            <h3 style={{ marginTop: 0 }}>Set Up Local AI</h3>
            <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
              OpenGiraffe uses local Large Language Models (LLMs) to power intelligent features
              while keeping your data private and secure.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
              This wizard will help you:
            </p>
            <ul style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 20 }}>
              <li>Check your system compatibility</li>
              <li>Install Ollama (local LLM runtime)</li>
              <li>Choose and download an AI model</li>
              <li>Configure everything automatically</li>
            </ul>
            <div style={{ 
              padding: 12,
              background: 'rgba(59,130,246,0.1)',
              border: '1px solid rgba(59,130,246,0.3)',
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 20
            }}>
              <strong>⏱ Estimated time:</strong> 5-15 minutes (depending on download speed)
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {onSkip && (
                <button className="btn" onClick={onSkip} style={{ background: 'rgba(255,255,255,0.12)' }}>
                  Skip for Now
                </button>
              )}
              <button className="btn" onClick={handleWelcomeContinue} style={{ background: '#2563eb' }}>
                Start Setup
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Hardware Check Step
  if (step === 'hardware') {
    return (
      <div className="modal-overlay" style={{ zIndex: 10000 }}>
        <div className="modal" style={{ maxWidth: 600 }}>
          <div className="modal-header">
            <div className="modal-title">🔍 System Check</div>
          </div>
          <div className="modal-body">
            <h3 style={{ marginTop: 0 }}>Hardware Compatibility</h3>
            
            {!hardware && <p>Checking your system...</p>}
            
            {hardware && (
              <>
                <div style={{
                  padding: 16,
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 8,
                  marginBottom: 16
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12, fontSize: 14 }}>
                    <strong>RAM:</strong>
                    <span>{hardware.totalRamGb} GB</span>
                    
                    <strong>CPU Cores:</strong>
                    <span>{hardware.cpuCores}</span>
                    
                    <strong>Operating System:</strong>
                    <span style={{ textTransform: 'capitalize' }}>{hardware.osType}</span>
                    
                    <strong>Recommended Tier:</strong>
                    <span style={{ textTransform: 'capitalize' }}>{hardware.recommendedTier}</span>
                  </div>
                </div>

                {/* Compatibility Status */}
                <div style={{
                  padding: 12,
                  background: hardware.canRunMistral7B ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                  border: `1px solid ${hardware.canRunMistral7B ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
                  borderRadius: 6,
                  marginBottom: 16
                }}>
                  <div style={{ 
                    fontSize: 14, 
                    fontWeight: 600,
                    color: hardware.canRunMistral7B ? '#22c55e' : '#f59e0b',
                    marginBottom: 8
                  }}>
                    {hardware.canRunMistral7B ? '✓ System Compatible' : '⚠ Limited Resources'}
                  </div>
                  <div style={{ fontSize: 13 }}>
                    {hardware.canRunMistral7B ? (
                      <>Your system can run Mistral 7B and similar models.</>
                    ) : (
                      <>Your system has limited resources. We recommend lightweight models.</>
                    )}
                  </div>
                </div>

                {/* Model Recommendations */}
                <div style={{
                  padding: 12,
                  background: 'rgba(59,130,246,0.1)',
                  border: '1px solid rgba(59,130,246,0.3)',
                  borderRadius: 6,
                  marginBottom: 16,
                  fontSize: 13
                }}>
                  <strong>Recommended Models:</strong>
                  <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
                    {hardware.totalRamGb < 8 && <li>Phi-3 Mini (2.3 GB)</li>}
                    {hardware.totalRamGb >= 8 && hardware.totalRamGb < 16 && <li>Mistral 7B (4 GB) - Best choice</li>}
                    {hardware.totalRamGb >= 16 && (
                      <>
                        <li>Mistral 7B (4 GB) - Balanced</li>
                        <li>Mistral 14B (8 GB) - High performance</li>
                      </>
                    )}
                  </ul>
                </div>

                {/* Warnings */}
                {hardware.warnings && hardware.warnings.length > 0 && (
                  <div style={{
                    padding: 12,
                    background: 'rgba(245,158,11,0.1)',
                    border: '1px solid rgba(245,158,11,0.3)',
                    borderRadius: 6,
                    marginBottom: 16,
                    fontSize: 13,
                    color: '#f59e0b'
                  }}>
                    {hardware.warnings.map((w, i) => (
                      <div key={i} style={{ marginBottom: i < hardware.warnings!.length - 1 ? 6 : 0 }}>
                        • {w}
                      </div>
                    ))}
                  </div>
                )}

                {error && (
                  <div style={{
                    padding: 12,
                    background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 6,
                    marginBottom: 16,
                    color: '#ef4444',
                    fontSize: 13
                  }}>
                    {error}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn" onClick={handleHardwareContinue} style={{ background: '#2563eb' }}>
                    Continue
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Ollama Installation Step
  if (step === 'ollama') {
    return (
      <div className="modal-overlay" style={{ zIndex: 10000 }}>
        <div className="modal" style={{ maxWidth: 600 }}>
          <div className="modal-header">
            <div className="modal-title">📦 Install Ollama</div>
          </div>
          <div className="modal-body">
            <h3 style={{ marginTop: 0 }}>Ollama Runtime Required</h3>
            <p style={{ fontSize: 14, marginBottom: 16 }}>
              Ollama is not installed on your system. It's required to run local AI models.
            </p>
            
            <div style={{
              padding: 16,
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 8,
              marginBottom: 16
            }}>
              <h4 style={{ marginTop: 0, fontSize: 14 }}>Installation Steps:</h4>
              <ol style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 0, paddingLeft: 20 }}>
                <li>Click "Download Ollama" below to open the official website</li>
                <li>Download and install Ollama for {hardware?.osType}</li>
                <li>Follow the installation wizard</li>
                <li>Return here and click "I've Installed Ollama"</li>
              </ol>
            </div>

            {error && (
              <div style={{
                padding: 12,
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 6,
                marginBottom: 16,
                color: '#ef4444',
                fontSize: 13
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={handleOllamaInstall} style={{ background: '#2563eb' }}>
                Download Ollama
              </button>
              <button className="btn" onClick={handleOllamaRetry} style={{ background: '#059669' }}>
                I've Installed Ollama
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Model Selection Step
  if (step === 'model-select') {
    const models = getRecommendedModels()
    
    return (
      <div className="modal-overlay" style={{ zIndex: 10000 }}>
        <div className="modal" style={{ maxWidth: 700 }}>
          <div className="modal-header">
            <div className="modal-title">🎯 Choose AI Model</div>
          </div>
          <div className="modal-body">
            <h3 style={{ marginTop: 0 }}>Select a Language Model</h3>
            <p style={{ fontSize: 14, marginBottom: 20 }}>
              Choose the AI model that best fits your system and needs.
            </p>

            <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
              {models.map((model: any) => (
                <div
                  key={model.id}
                  onClick={() => handleModelSelect(model.id)}
                  style={{
                    padding: 16,
                    background: selectedModel === model.id ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                    border: `2px solid ${
                      selectedModel === model.id 
                        ? 'rgba(59,130,246,0.5)' 
                        : model.status === 'good' 
                          ? 'rgba(34,197,94,0.3)' 
                          : model.status === 'okay' 
                            ? 'rgba(251,191,36,0.3)' 
                            : 'rgba(239,68,68,0.3)'
                    }`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    opacity: 1,
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                    <div>
                      <strong style={{ fontSize: 15 }}>{model.name}</strong>
                      {model.recommended && (
                        <span style={{
                          marginLeft: 8,
                          padding: '2px 8px',
                          background: '#059669',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600
                        }}>
                          ⭐ RECOMMENDED
                        </span>
                      )}
                      {model.statusText && (
                        <span style={{
                          marginLeft: 8,
                          fontSize: 12,
                          opacity: 0.9
                        }}>
                          {model.statusText}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.8 }}>
                      {model.size}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 6 }}>
                    {model.description}
                  </div>
                  {model.advisoryMessage && (
                    <div style={{ 
                      fontSize: 11, 
                      opacity: 0.8, 
                      fontStyle: 'italic',
                      color: model.status === 'good' ? '#22c55e' : model.status === 'okay' ? '#fbbf24' : '#ef4444'
                    }}>
                      💡 {model.advisoryMessage}
                    </div>
                  )}
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
                    Requires: {model.ramRequired} GB RAM minimum
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <div style={{
                padding: 12,
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 6,
                marginBottom: 16,
                color: '#ef4444',
                fontSize: 13
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={handleStartDownload} style={{ background: '#2563eb' }}>
                Download {MODEL_OPTIONS.find(m => m.id === selectedModel)?.name}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Download & Installation Step
  if (step === 'download') {
    const formatBytes = (bytes: number) => {
      if (bytes === 0) return '0 B'
      const k = 1024
      const sizes = ['B', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
    }

    const formatSpeed = (bytesPerSecond: number) => {
      return formatBytes(bytesPerSecond) + '/s'
    }

    return (
      <div className="modal-overlay" style={{ zIndex: 10000 }}>
        <div className="modal" style={{ maxWidth: 600 }}>
          <div className="modal-header">
            <div className="modal-title">
              {progress < 100 ? '⚡ Downloading...' : '✅ Installation Complete!'}
            </div>
          </div>
          <div className="modal-body">
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>
              {MODEL_OPTIONS.find(m => m.id === selectedModel)?.name}
            </h3>
            <p style={{ fontSize: 13, opacity: 0.8, marginBottom: 20 }}>
              {progress < 100 ? 'Please wait while we download the model...' : 'Model downloaded successfully!'}
            </p>
            
            <div style={{
              padding: 20,
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 8,
              marginBottom: 16
            }}>
              {/* Animated Icon */}
              <div style={{ 
                fontSize: 64, 
                marginBottom: 16, 
                textAlign: 'center',
                animation: progress < 100 && isDownloading ? 'pulse 2s ease-in-out infinite' : 'none'
              }}>
                {progress === 0 ? '🔄' : progress < 100 ? '📥' : '✅'}
              </div>
              
              {/* Status Message */}
              <div style={{ 
                fontSize: 14, 
                marginBottom: 12, 
                textAlign: 'center',
                fontWeight: 600,
                color: isDownloading ? '#3b82f6' : '#94a3b8'
              }}>
                {status || 'Initializing...'}
                {isDownloading && progress < 100 && (
                  <span style={{ marginLeft: 8, animation: 'blink 1s linear infinite' }}>●</span>
                )}
              </div>
              
              {/* Progress Bar */}
              <div style={{
                width: '100%',
                height: 12,
                background: 'rgba(255,255,255,0.1)',
                borderRadius: 6,
                overflow: 'hidden',
                marginBottom: 12,
                position: 'relative'
              }}>
                <div style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: progress < 100 ? 'linear-gradient(90deg, #2563eb, #3b82f6, #2563eb)' : '#059669',
                  backgroundSize: progress < 100 ? '200% 100%' : '100% 100%',
                  animation: progress < 100 ? 'gradient 2s ease infinite' : 'none',
                  transition: 'width 0.5s ease',
                  boxShadow: progress > 0 ? '0 0 10px rgba(59, 130, 246, 0.5)' : 'none'
                }} />
              </div>
              
              {/* Progress Percentage */}
              <div style={{ 
                fontSize: 24, 
                fontWeight: 'bold',
                textAlign: 'center',
                marginBottom: 16,
                color: progress < 100 ? '#3b82f6' : '#059669'
              }}>
                {Math.round(progress)}%
              </div>

              {/* Download Details */}
              {downloadDetails.completed && downloadDetails.total && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  padding: 12,
                  background: 'rgba(0,0,0,0.2)',
                  borderRadius: 6,
                  fontSize: 12
                }}>
                  <div>
                    <div style={{ opacity: 0.7, marginBottom: 4 }}>Downloaded:</div>
                    <div style={{ fontWeight: 600 }}>
                      {formatBytes(downloadDetails.completed)} / {formatBytes(downloadDetails.total)}
                    </div>
                  </div>
                  {downloadDetails.speed && downloadDetails.speed > 0 && (
                    <div>
                      <div style={{ opacity: 0.7, marginBottom: 4 }}>Speed:</div>
                      <div style={{ fontWeight: 600, color: '#3b82f6' }}>
                        {formatSpeed(downloadDetails.speed)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Activity Indicator */}
              {progress < 100 && progress > 0 && (
                <div style={{
                  marginTop: 12,
                  fontSize: 11,
                  textAlign: 'center',
                  opacity: 0.6,
                  fontStyle: 'italic'
                }}>
                  {isDownloading ? '⚡ Download in progress...' : '⏸ Waiting for data...'}
                </div>
              )}
            </div>

            {error && (
              <div style={{
                padding: 12,
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 6,
                color: '#ef4444',
                fontSize: 13
              }}>
                <strong>❌ Error:</strong> {error}
                <button 
                  className="btn" 
                  onClick={handleStartDownload}
                  style={{ marginTop: 12, width: '100%', background: '#ef4444' }}
                >
                  🔄 Retry Download
                </button>
              </div>
            )}

            {/* Info Box */}
            {progress < 100 && !error && (
              <div style={{
                padding: 12,
                background: 'rgba(59,130,246,0.1)',
                border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: 6,
                fontSize: 12,
                opacity: 0.8
              }}>
                <strong>💡 Tip:</strong> This may take several minutes depending on your internet connection. 
                The window will update automatically when complete.
              </div>
            )}
          </div>
        </div>
        
        {/* Add CSS Animations */}
        <style>{`
          @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.1); opacity: 0.8; }
          }
          @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
          @keyframes gradient {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
        `}</style>
      </div>
    )
  }

  // Completion Step
  if (step === 'complete') {
    return (
      <div className="modal-overlay" style={{ zIndex: 10000 }}>
        <div className="modal" style={{ maxWidth: 600 }}>
          <div className="modal-header">
            <div className="modal-title">🎉 Setup Complete!</div>
          </div>
          <div className="modal-body">
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 64, marginBottom: 20 }}>✅</div>
              <h3 style={{ marginTop: 0, marginBottom: 12 }}>
                Your Local AI is Ready!
              </h3>
              <p style={{ fontSize: 14, opacity: 0.9, marginBottom: 20 }}>
                {MODEL_OPTIONS.find(m => m.id === selectedModel)?.name} has been installed and configured.
                You can now use AI-powered features in OpenGiraffe.
              </p>
              
              <div style={{
                padding: 16,
                background: 'rgba(59,130,246,0.1)',
                border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: 8,
                fontSize: 13,
                textAlign: 'left',
                marginBottom: 20
              }}>
                <strong>What's next:</strong>
                <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
                  <li>Your AI runs completely offline and private</li>
                  <li>You can change models anytime in Settings</li>
                  <li>Check Backend Configuration for status</li>
                </ul>
              </div>

              <button 
                className="btn" 
                onClick={onComplete}
                style={{ background: '#2563eb', fontSize: 16, padding: '12px 32px' }}
              >
                Start Using OpenGiraffe
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}

