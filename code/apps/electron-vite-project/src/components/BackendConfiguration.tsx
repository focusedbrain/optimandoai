/**
 * Backend Configuration Component
 * Manages local backends: LocalDB, VectorDB, LLM, Automation
 */

import { useState, useEffect } from 'react'

type ConfigTab = 'localdb' | 'vectordb' | 'llm' | 'automation'

interface LlmStatus {
  ollamaInstalled: boolean
  ollamaVersion?: string
  modelAvailable: boolean
  modelName?: string
  isReady: boolean
  error?: string
}

interface HardwareInfo {
  totalRamGb: number
  cpuCores: number
  osType: string
  canRunMistral7B: boolean
  recommendedTier: string
  warnings?: string[]
}

export function BackendConfiguration() {
  const [activeTab, setActiveTab] = useState<ConfigTab>('llm')
  const [isExpanded, setIsExpanded] = useState(true)
  
  // LLM state
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null)
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState(0)
  const [installStatus, setInstallStatus] = useState('')
  const [installError, setInstallError] = useState<string | null>(null)

  useEffect(() => {
    loadHardware()
    loadLlmStatus()
    
    // Listen for download progress
    const llm = (window as any).llm
    llm?.onDownloadProgress((data: any) => {
      setInstallProgress(data.progress || 0)
      setInstallStatus(data.status || 'downloading')
    })
  }, [])

  const loadHardware = async () => {
    try {
      const hw = await (window as any).llm?.checkHardware()
      setHardware(hw)
    } catch (error: any) {
      console.error('Failed to check hardware:', error)
    }
  }

  const loadLlmStatus = async () => {
    try {
      const status = await (window as any).llm?.getStatus()
      setLlmStatus(status)
    } catch (error: any) {
      console.error('Failed to get LLM status:', error)
    }
  }

  const handleAutoInstall = async () => {
    setInstalling(true)
    setInstallError(null)
    setInstallProgress(0)
    setInstallStatus('Starting installation...')

    try {
      // Step 1: Start Ollama
      setInstallStatus('Starting Ollama server...')
      await (window as any).llm?.startOllama()
      
      // Step 2: Download Mistral 7B
      setInstallStatus('Downloading Mistral 7B model...')
      await (window as any).llm?.downloadModel('mistral:7b')
      
      // Step 3: Verify installation
      setInstallStatus('Verifying installation...')
      await new Promise(resolve => setTimeout(resolve, 1000))
      await loadLlmStatus()
      
      setInstallStatus('✓ Installation complete!')
      setInstallProgress(100)
      
      // Mark as complete
      localStorage.setItem('llm-setup-complete', 'true')
    } catch (error: any) {
      console.error('Installation failed:', error)
      setInstallError(error.message || 'Installation failed')
      setInstallStatus('Installation failed')
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div style={{
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: 8,
      background: 'rgba(0,0,0,0.2)',
      padding: 16,
      marginTop: 16
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: isExpanded ? 16 : 0,
        cursor: 'pointer'
      }} onClick={() => setIsExpanded(!isExpanded)}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          Backend Configuration
        </div>
        <span style={{ fontSize: 12 }}>
          {isExpanded ? '▼' : '▶'}
        </span>
      </div>

      {isExpanded && (
        <>
          {/* Tabs */}
          <div style={{
            display: 'flex',
            gap: 6,
            marginBottom: 16,
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            paddingBottom: 8
          }}>
            {(['localdb', 'vectordb', 'llm', 'automation'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                disabled={tab !== 'llm'}
                className="btn"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: activeTab === tab ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                  border: activeTab === tab ? '1px solid rgba(59,130,246,0.4)' : '1px solid rgba(255,255,255,0.1)',
                  fontSize: '11px',
                  fontWeight: activeTab === tab ? '600' : '400',
                  cursor: tab === 'llm' ? 'pointer' : 'not-allowed',
                  opacity: tab === 'llm' ? 1 : 0.4
                }}
              >
                {tab === 'localdb' && 'Local DB'}
                {tab === 'vectordb' && 'Vector DB'}
                {tab === 'llm' && 'LLM'}
                {tab === 'automation' && 'Automation'}
              </button>
            ))}
          </div>

          {/* LLM Tab Content */}
          {activeTab === 'llm' && (
            <div>
              <h4 style={{ marginTop: 0, marginBottom: 12, fontSize: 14 }}>
                Local LLM (Ollama + Mistral 7B)
              </h4>

              {/* Hardware Info */}
              {hardware && (
                <div style={{
                  padding: 12,
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 6,
                  marginBottom: 12,
                  fontSize: 13
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>System Information</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 6 }}>
                    <span style={{ opacity: 0.7 }}>RAM:</span>
                    <span>{hardware.totalRamGb} GB ({hardware.recommendedTier})</span>
                    
                    <span style={{ opacity: 0.7 }}>CPU Cores:</span>
                    <span>{hardware.cpuCores}</span>
                    
                    <span style={{ opacity: 0.7 }}>OS:</span>
                    <span>{hardware.osType}</span>
                    
                    <span style={{ opacity: 0.7 }}>Status:</span>
                    <span style={{ color: hardware.canRunMistral7B ? '#22c55e' : '#f59e0b' }}>
                      {hardware.canRunMistral7B ? '✓ Can run Mistral 7B' : '⚠ Limited resources'}
                    </span>
                  </div>
                  
                  {hardware.warnings && hardware.warnings.length > 0 && (
                    <div style={{ marginTop: 8, padding: 8, background: 'rgba(245,158,11,0.1)', borderRadius: 4, fontSize: 12, color: '#f59e0b' }}>
                      {hardware.warnings.map((w, i) => (
                        <div key={i}>• {w}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Status */}
              {llmStatus && (
                <div style={{
                  padding: 12,
                  background: llmStatus.isReady ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)',
                  border: `1px solid ${llmStatus.isReady ? 'rgba(34,197,94,0.3)' : 'rgba(59,130,246,0.3)'}`,
                  borderRadius: 6,
                  marginBottom: 12,
                  fontSize: 13
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    {llmStatus.isReady ? '✓ Ready' : 'Not Installed'}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 6 }}>
                    <span style={{ opacity: 0.7 }}>Ollama:</span>
                    <span>{llmStatus.ollamaInstalled ? `✓ ${llmStatus.ollamaVersion || 'Installed'}` : '✗ Not found'}</span>
                    
                    <span style={{ opacity: 0.7 }}>Model:</span>
                    <span>{llmStatus.modelAvailable ? `✓ ${llmStatus.modelName}` : '✗ Not downloaded'}</span>
                  </div>
                  
                  {llmStatus.error && (
                    <div style={{ marginTop: 8, color: '#ef4444', fontSize: 12 }}>
                      {llmStatus.error}
                    </div>
                  )}
                </div>
              )}

              {/* Installation Section */}
              {!llmStatus?.isReady && (
                <div style={{
                  padding: 12,
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 6,
                  marginBottom: 12
                }}>
                  <div style={{ fontSize: 13, marginBottom: 8 }}>
                    <strong>Automatic Installation</strong>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 12 }}>
                    This will:
                    <ul style={{ marginTop: 4, marginBottom: 0, paddingLeft: 20 }}>
                      <li>Start Ollama server</li>
                      <li>Download Mistral 7B model (~4 GB)</li>
                      <li>Configure for immediate use</li>
                    </ul>
                  </div>

                  {!installing && !llmStatus?.ollamaInstalled && (
                    <div style={{
                      padding: 8,
                      background: 'rgba(239,68,68,0.1)',
                      border: '1px solid rgba(239,68,68,0.3)',
                      borderRadius: 4,
                      fontSize: 12,
                      marginBottom: 12
                    }}>
                      <strong>⚠ Ollama not found</strong>
                      <div style={{ marginTop: 4 }}>
                        Please install Ollama first:
                        <a 
                          href="https://ollama.ai" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ color: '#60a5fa', marginLeft: 4 }}
                        >
                          ollama.ai
                        </a>
                      </div>
                    </div>
                  )}

                  {installing && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, marginBottom: 6, opacity: 0.8 }}>
                        {installStatus}
                      </div>
                      <div style={{
                        width: '100%',
                        height: 6,
                        background: 'rgba(255,255,255,0.1)',
                        borderRadius: 3,
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          width: `${installProgress}%`,
                          height: '100%',
                          background: '#2563eb',
                          transition: 'width 0.3s ease'
                        }} />
                      </div>
                      <div style={{ fontSize: 11, marginTop: 4, textAlign: 'right', opacity: 0.7 }}>
                        {Math.round(installProgress)}%
                      </div>
                    </div>
                  )}

                  {installError && (
                    <div style={{
                      padding: 8,
                      background: 'rgba(239,68,68,0.1)',
                      border: '1px solid rgba(239,68,68,0.3)',
                      borderRadius: 4,
                      fontSize: 12,
                      marginBottom: 12,
                      color: '#ef4444'
                    }}>
                      {installError}
                    </div>
                  )}

                  <button
                    className="btn"
                    onClick={handleAutoInstall}
                    disabled={installing || !llmStatus?.ollamaInstalled}
                    style={{
                      width: '100%',
                      padding: '10px 16px',
                      background: '#2563eb',
                      fontSize: 13,
                      fontWeight: 600,
                      opacity: (installing || !llmStatus?.ollamaInstalled) ? 0.5 : 1,
                      cursor: (installing || !llmStatus?.ollamaInstalled) ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {installing ? 'Installing...' : '⚡ Auto-Install Mistral 7B'}
                  </button>
                </div>
              )}

              {/* Ready State */}
              {llmStatus?.isReady && (
                <div style={{
                  padding: 12,
                  background: 'rgba(34,197,94,0.1)',
                  border: '1px solid rgba(34,197,94,0.3)',
                  borderRadius: 6,
                  fontSize: 13
                }}>
                  <div style={{ marginBottom: 8 }}>
                    <strong>✓ Local LLM Ready</strong>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.9 }}>
                    You can now use Mistral 7B for AI-powered features.
                  </div>
                  <button
                    className="btn"
                    onClick={loadLlmStatus}
                    style={{
                      marginTop: 12,
                      padding: '6px 12px',
                      fontSize: 12
                    }}
                  >
                    Refresh Status
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Placeholder for other tabs */}
          {activeTab !== 'llm' && (
            <div style={{ padding: 20, textAlign: 'center', opacity: 0.5, fontSize: 13 }}>
              {activeTab} configuration coming soon...
            </div>
          )}
        </>
      )}
    </div>
  )
}

