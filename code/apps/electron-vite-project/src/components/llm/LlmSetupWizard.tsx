/**
 * LLM Setup Wizard - First Run Installation
 * Multi-step wizard for setting up local LLM with hardware checks and model selection
 */

import { useState, useEffect } from 'react'

type WizardStep = 'welcome' | 'hardware' | 'ollama' | 'model-select' | 'download' | 'complete'

interface HardwareInfo {
  totalRamGb: number
  cpuCores: number
  osType: string
  canRunMistral7B: boolean
  canRunMistral14B: boolean
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
    id: 'phi3:mini',
    name: 'Phi-3 Mini',
    size: '~2.3 GB',
    ramRequired: 4,
    recommended: false,
    description: 'Lightweight model for systems with limited resources'
  },
  {
    id: 'mistral:7b',
    name: 'Mistral 7B',
    size: '~4 GB',
    ramRequired: 8,
    recommended: true,
    description: 'Balanced performance and resource usage (Recommended)'
  },
  {
    id: 'llama3:8b',
    name: 'Llama 3 8B',
    size: '~4.7 GB',
    ramRequired: 8,
    recommended: false,
    description: 'High-quality responses with good performance'
  },
  {
    id: 'mistral:14b',
    name: 'Mistral 14B',
    size: '~8 GB',
    ramRequired: 16,
    recommended: false,
    description: 'Advanced model for powerful systems'
  }
]

interface LlmSetupWizardProps {
  onComplete: () => void
  onSkip?: () => void
}

export function LlmSetupWizard({ onComplete, onSkip }: LlmSetupWizardProps) {
  const [step, setStep] = useState<WizardStep>('welcome')
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [selectedModel, setSelectedModel] = useState('mistral:7b')
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Listen for download progress
    const llm = (window as any).llm
    llm?.onDownloadProgress((data: any) => {
      setProgress(data.progress || 0)
      setStatus(data.status || 'downloading')
    })
  }, [])

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
    setStep('download')

    try {
      // Start Ollama server
      setStatus('Starting Ollama server...')
      await (window as any).llm?.startOllama()
      setProgress(10)

      // Download selected model
      setStatus(`Downloading ${selectedModel}...`)
      await (window as any).llm?.downloadModel(selectedModel)

      setProgress(100)
      setStatus('✓ Installation complete!')
      
      // Save config
      await (window as any).llm?.updateConfig({
        modelId: selectedModel,
        autoStartOllama: true
      })

      localStorage.setItem('llm-setup-complete', 'true')
      
      setTimeout(() => {
        setStep('complete')
      }, 1000)
    } catch (err: any) {
      setError(`Installation failed: ${err.message}`)
    }
  }

  const getRecommendedModels = () => {
    if (!hardware) return MODEL_OPTIONS
    
    return MODEL_OPTIONS.map(model => ({
      ...model,
      recommended: model.id === 'mistral:7b' && hardware.canRunMistral7B,
      disabled: hardware.totalRamGb < model.ramRequired
    }))
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
                  onClick={() => !model.disabled && handleModelSelect(model.id)}
                  style={{
                    padding: 16,
                    background: selectedModel === model.id ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                    border: `2px solid ${selectedModel === model.id ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: 8,
                    cursor: model.disabled ? 'not-allowed' : 'pointer',
                    opacity: model.disabled ? 0.5 : 1,
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                    <div>
                      <strong style={{ fontSize: 15 }}>{model.name}</strong>
                      {model.recommended && !model.disabled && (
                        <span style={{
                          marginLeft: 8,
                          padding: '2px 8px',
                          background: '#059669',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600
                        }}>
                          RECOMMENDED
                        </span>
                      )}
                      {model.disabled && (
                        <span style={{
                          marginLeft: 8,
                          padding: '2px 8px',
                          background: '#ef4444',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600
                        }}>
                          INSUFFICIENT RAM
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.8 }}>
                      {model.size}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.9 }}>
                    {model.description}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
                    Requires: {model.ramRequired} GB RAM
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
    return (
      <div className="modal-overlay" style={{ zIndex: 10000 }}>
        <div className="modal" style={{ maxWidth: 600 }}>
          <div className="modal-header">
            <div className="modal-title">⚡ Installing</div>
          </div>
          <div className="modal-body">
            <h3 style={{ marginTop: 0 }}>
              {progress < 100 ? 'Downloading Model...' : 'Installation Complete!'}
            </h3>
            
            <div style={{
              padding: 16,
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 8,
              marginBottom: 16,
              textAlign: 'center'
            }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>
                {progress < 100 ? '⏳' : '✅'}
              </div>
              <div style={{ fontSize: 14, marginBottom: 16, opacity: 0.9 }}>
                {status}
              </div>
              
              <div style={{
                width: '100%',
                height: 8,
                background: 'rgba(255,255,255,0.1)',
                borderRadius: 4,
                overflow: 'hidden',
                marginBottom: 8
              }}>
                <div style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #2563eb, #3b82f6)',
                  transition: 'width 0.3s ease'
                }} />
              </div>
              
              <div style={{ fontSize: 13, opacity: 0.7 }}>
                {Math.round(progress)}%
              </div>
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
                {error}
                <button 
                  className="btn" 
                  onClick={handleStartDownload}
                  style={{ marginTop: 12, width: '100%', background: '#ef4444' }}
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>
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

