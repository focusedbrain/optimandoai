/**
 * First Run Wizard for LLM Setup
 * Multi-step wizard: Hardware Check → Ollama Detection → Model Download
 */

import { useState, useEffect } from 'react'

type WizardStep = 'hardware' | 'ollama' | 'download' | 'complete' | 'skip'

interface HardwareInfo {
  totalRamGb: number
  cpuCores: number
  osType: 'windows' | 'macos' | 'linux'
  recommendedTier: string
  canRunMistral7B: boolean
  warnings?: string[]
}

interface LlmStatus {
  ollamaInstalled: boolean
  ollamaVersion?: string
  modelAvailable: boolean
  modelName?: string
  endpointUrl: string
  isReady: boolean
  error?: string
}

interface FirstRunWizardProps {
  onComplete: () => void
  onSkip?: () => void
}

export function FirstRunWizard({ onComplete, onSkip }: FirstRunWizardProps) {
  const [step, setStep] = useState<WizardStep>('hardware')
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [status, setStatus] = useState<LlmStatus | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [downloadStatus, setDownloadStatus] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Check hardware on mount
    const checkHardware = async () => {
      try {
        const hw = await (window as any).llm?.checkHardware()
        setHardware(hw)
      } catch (err: any) {
        setError(`Failed to check hardware: ${err.message}`)
      }
    }
    checkHardware()

    // Listen for download progress
    const ipc = (window as any).llm
    ipc?.onDownloadProgress((data: any) => {
      setProgress(data.progress || 0)
      setDownloadStatus(data.status || 'downloading')
    })
  }, [])

  const checkOllamaStatus = async () => {
    try {
      const st = await (window as any).llm?.getStatus()
      setStatus(st)
      return st
    } catch (err: any) {
      setError(`Failed to check Ollama status: ${err.message}`)
      return null
    }
  }

  const handleContinueFromHardware = async () => {
    setError(null)
    const st = await checkOllamaStatus()
    if (st?.ollamaInstalled) {
      if (st.modelAvailable) {
        setStep('complete')
      } else {
        setStep('download')
      }
    } else {
      setStep('ollama')
    }
  }

  const handleStartOllama = async () => {
    setError(null)
    try {
      await (window as any).llm?.startOllama()
      const st = await checkOllamaStatus()
      if (st?.modelAvailable) {
        setStep('complete')
      } else {
        setStep('download')
      }
    } catch (err: any) {
      setError(`Failed to start Ollama: ${err.message}`)
    }
  }

  const handleDownloadModel = async () => {
    setError(null)
    setDownloading(true)
    setProgress(0)
    setDownloadStatus('Starting download...')
    
    try {
      await (window as any).llm?.startOllama()
      await (window as any).llm?.downloadModel('mistral:7b')
      setStep('complete')
    } catch (err: any) {
      setError(`Download failed: ${err.message}`)
    } finally {
      setDownloading(false)
    }
  }

  const handleSkipDownload = () => {
    setStep('skip')
  }

  const handleFinish = () => {
    onComplete()
  }

  // Hardware Check Step
  if (step === 'hardware') {
    return (
      <div className="modal-overlay" role="dialog" aria-modal="true">
        <div className="modal" style={{ maxWidth: 600 }}>
          <div className="modal-header">
            <div className="modal-title">🤖 Local LLM Setup</div>
          </div>
          <div className="modal-body">
            <h3 style={{ marginTop: 0 }}>Step 1: Hardware Check</h3>
            
            {!hardware && <p>Checking your system...</p>}
            
            {hardware && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ 
                  padding: 16, 
                  borderRadius: 8, 
                  background: 'rgba(255,255,255,0.05)',
                  marginBottom: 12 
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, fontSize: 14 }}>
                    <strong>RAM:</strong> 
                    <span>{hardware.totalRamGb} GB ({hardware.recommendedTier})</span>
                    
                    <strong>CPU Cores:</strong> 
                    <span>{hardware.cpuCores}</span>
                    
                    <strong>Operating System:</strong> 
                    <span>{hardware.osType}</span>
                  </div>
                </div>

                {hardware.canRunMistral7B ? (
                  <div style={{ 
                    padding: 12, 
                    borderRadius: 6, 
                    background: 'rgba(34,197,94,0.12)', 
                    border: '1px solid rgba(34,197,94,0.45)',
                    marginBottom: 12
                  }}>
                    <div style={{ fontSize: 14, color: '#22c55e' }}>
                      ✓ Your system can run Mistral 7B locally
                    </div>
                  </div>
                ) : (
                  <div style={{ 
                    padding: 12, 
                    borderRadius: 6, 
                    background: 'rgba(245,158,11,0.12)', 
                    border: '1px solid rgba(245,158,11,0.45)',
                    marginBottom: 12
                  }}>
                    <div style={{ fontSize: 14, color: '#f59e0b' }}>
                      ⚠ Limited RAM detected - local model may run slowly
                    </div>
                  </div>
                )}

                {hardware.warnings && hardware.warnings.length > 0 && (
                  <div style={{ fontSize: 13, color: '#f59e0b', marginTop: 8 }}>
                    {hardware.warnings.map((w, i) => (
                      <div key={i} style={{ marginBottom: 4 }}>• {w}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && (
              <div style={{ 
                padding: 12, 
                borderRadius: 6, 
                background: 'rgba(239,68,68,0.12)', 
                border: '1px solid rgba(239,68,68,0.45)',
                marginBottom: 12,
                color: '#ef4444',
                fontSize: 13
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              {onSkip && (
                <button 
                  className="btn" 
                  onClick={onSkip}
                  style={{ background: 'rgba(255,255,255,0.12)' }}
                >
                  Skip Setup
                </button>
              )}
              <button 
                className="btn" 
                onClick={handleContinueFromHardware}
                disabled={!hardware}
                style={{ background: '#2563eb', opacity: hardware ? 1 : 0.5 }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Ollama Detection Step
  if (step === 'ollama') {
    return (
      <div className="modal-overlay" role="dialog" aria-modal="true">
        <div className="modal" style={{ maxWidth: 600 }}>
          <div className="modal-header">
            <div className="modal-title">🤖 Local LLM Setup</div>
          </div>
          <div className="modal-body">
            <h3 style={{ marginTop: 0 }}>Step 2: Ollama Status</h3>
            
            {status && !status.ollamaInstalled && (
              <div style={{ marginBottom: 20 }}>
                <p>Ollama is not installed or not found in your system PATH.</p>
                <p style={{ fontSize: 13, color: '#9ca3af' }}>
                  To use local LLMs, you need to install Ollama first.
                </p>
                <div style={{ 
                  marginTop: 12,
                  padding: 12,
                  background: 'rgba(59,130,246,0.12)',
                  border: '1px solid rgba(59,130,246,0.45)',
                  borderRadius: 6,
                  fontSize: 13
                }}>
                  <strong>Installation Instructions:</strong>
                  <ol style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
                    <li>Download Ollama from: <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }}>ollama.ai</a></li>
                    <li>Install and restart this application</li>
                  </ol>
                </div>
              </div>
            )}

            {error && (
              <div style={{ 
                padding: 12, 
                borderRadius: 6, 
                background: 'rgba(239,68,68,0.12)', 
                border: '1px solid rgba(239,68,68,0.45)',
                marginBottom: 12,
                color: '#ef4444',
                fontSize: 13
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button 
                className="btn" 
                onClick={handleSkipDownload}
                style={{ background: 'rgba(255,255,255,0.12)' }}
              >
                Use Remote API Instead
              </button>
              <button 
                className="btn" 
                onClick={handleStartOllama}
                style={{ background: '#2563eb' }}
              >
                Try to Start Ollama
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Model Download Step
  if (step === 'download') {
    return (
      <div className="modal-overlay" role="dialog" aria-modal="true">
        <div className="modal" style={{ maxWidth: 600 }}>
          <div className="modal-header">
            <div className="modal-title">🤖 Local LLM Setup</div>
          </div>
          <div className="modal-body">
            <h3 style={{ marginTop: 0 }}>Step 3: Download Model</h3>
            
            <div style={{ marginBottom: 20 }}>
              <p>Would you like to download Mistral 7B for local use?</p>
              <div style={{ 
                padding: 12,
                background: 'rgba(255,255,255,0.05)',
                borderRadius: 6,
                fontSize: 13,
                marginTop: 12
              }}>
                <div><strong>Model:</strong> Mistral 7B</div>
                <div style={{ marginTop: 4 }}><strong>Size:</strong> ~4 GB</div>
                <div style={{ marginTop: 4 }}><strong>Requirements:</strong> 8 GB RAM minimum</div>
                <div style={{ marginTop: 4, color: '#9ca3af' }}>
                  This will download the model files to your local machine for offline use.
                </div>
              </div>
            </div>

            {downloading && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ marginBottom: 8, fontSize: 13, color: '#9ca3af' }}>
                  {downloadStatus || 'Downloading...'}
                </div>
                <div style={{ 
                  width: '100%', 
                  height: 8, 
                  background: 'rgba(255,255,255,0.1)', 
                  borderRadius: 4,
                  overflow: 'hidden'
                }}>
                  <div style={{ 
                    width: `${progress}%`, 
                    height: '100%', 
                    background: '#2563eb',
                    transition: 'width 0.3s ease'
                  }} />
                </div>
                <div style={{ marginTop: 6, fontSize: 13, textAlign: 'right', color: '#9ca3af' }}>
                  {Math.round(progress)}%
                </div>
              </div>
            )}

            {error && (
              <div style={{ 
                padding: 12, 
                borderRadius: 6, 
                background: 'rgba(239,68,68,0.12)', 
                border: '1px solid rgba(239,68,68,0.45)',
                marginBottom: 12,
                color: '#ef4444',
                fontSize: 13
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              {!downloading && (
                <>
                  <button 
                    className="btn" 
                    onClick={handleSkipDownload}
                    style={{ background: 'rgba(255,255,255,0.12)' }}
                  >
                    Skip (Use Remote API)
                  </button>
                  <button 
                    className="btn" 
                    onClick={handleDownloadModel}
                    style={{ background: '#2563eb' }}
                  >
                    Download Now
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Complete Step
  if (step === 'complete') {
    return (
      <div className="modal-overlay" role="dialog" aria-modal="true">
        <div className="modal" style={{ maxWidth: 600 }}>
          <div className="modal-header">
            <div className="modal-title">🤖 Local LLM Setup</div>
          </div>
          <div className="modal-body">
            <h3 style={{ marginTop: 0 }}>✓ Setup Complete!</h3>
            
            <div style={{ 
              padding: 16,
              background: 'rgba(34,197,94,0.12)',
              border: '1px solid rgba(34,197,94,0.45)',
              borderRadius: 8,
              marginBottom: 20
            }}>
              <div style={{ fontSize: 14, color: '#22c55e' }}>
                Your local LLM is ready to use. You can now start using Mistral 7B for AI-powered features.
              </div>
            </div>

            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20 }}>
              You can change these settings later from the Settings menu.
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button 
                className="btn" 
                onClick={handleFinish}
                style={{ background: '#2563eb' }}
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Skip Step
  if (step === 'skip') {
    return (
      <div className="modal-overlay" role="dialog" aria-modal="true">
        <div className="modal" style={{ maxWidth: 600 }}>
          <div className="modal-header">
            <div className="modal-title">🤖 Local LLM Setup</div>
          </div>
          <div className="modal-body">
            <h3 style={{ marginTop: 0 }}>Local Model Skipped</h3>
            
            <div style={{ 
              padding: 16,
              background: 'rgba(59,130,246,0.12)',
              border: '1px solid rgba(59,130,246,0.45)',
              borderRadius: 8,
              marginBottom: 20
            }}>
              <div style={{ fontSize: 14 }}>
                You can use remote API providers (OpenAI, Anthropic, Gemini) by configuring your API keys in Settings.
              </div>
            </div>

            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20 }}>
              You can set up the local LLM later from Settings → LLM Configuration.
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button 
                className="btn" 
                onClick={handleFinish}
                style={{ background: '#2563eb' }}
              >
                Continue to App
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}

