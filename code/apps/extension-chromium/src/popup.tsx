/// <reference types="chrome-types"/>
import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'

interface ConnectionStatus {
  isConnected: boolean
  readyState?: number
}

interface TabActivationStatus {
  isActive: boolean
  currentTab?: chrome.tabs.Tab
}

// Context Bucket minimal contract
type IngestItem = { kind: 'file'|'image'|'audio'|'video'|'text'|'url'; payload: File|Blob|string; mime?: string; name?: string }
type IngestTarget = 'session' | 'account'

function Popup() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ isConnected: false })
  const [isLoading, setIsLoading] = useState(true)
  const [logs, setLogs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState('activation') // Start with activation tab
  const [bottomTab, setBottomTab] = useState('logs')
  const [mode, setMode] = useState('master')
  const [agents, setAgents] = useState({
    summarize: true,
    refactor: true,
    entityExtract: false
  })
  const [tabActivation, setTabActivation] = useState<TabActivationStatus>({ isActive: false })
  // Context Bucket UI state
  const filePickerRef = useRef<HTMLInputElement|null>(null)
  const pendingItemsRef = useRef<IngestItem[]|null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  
  // Email Gateway state for WR MailGuard
  const [emailAccounts, setEmailAccounts] = useState<Array<{
    id: string
    displayName: string
    email: string
    provider: 'gmail' | 'microsoft365' | 'imap'
    status: 'active' | 'error' | 'disabled'
    lastError?: string
  }>>([])
  const [isLoadingEmailAccounts, setIsLoadingEmailAccounts] = useState(false)
  const [showEmailSetupWizard, setShowEmailSetupWizard] = useState(false)
  
  // Load email accounts when mailguard tab is selected
  const loadEmailAccounts = async () => {
    setIsLoadingEmailAccounts(true)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EMAIL_LIST_ACCOUNTS' })
      if (response?.ok && response?.data) {
        setEmailAccounts(response.data)
      }
    } catch (err) {
      console.error('[Popup] Failed to load email accounts:', err)
    } finally {
      setIsLoadingEmailAccounts(false)
    }
  }
  
  // IMAP form state
  const [emailSetupStep, setEmailSetupStep] = useState<'provider' | 'credentials' | 'connecting'>('provider')
  const [imapForm, setImapForm] = useState({
    displayName: '',
    email: '',
    host: '',
    port: 993,
    username: '',
    password: '',
    security: 'ssl' as 'ssl' | 'starttls' | 'none'
  })
  const [imapPresets, setImapPresets] = useState<Record<string, { name: string; host: string; port: number; security: string }>>({})
  
  // Load IMAP presets
  const loadImapPresets = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EMAIL_GET_PRESETS' })
      if (response?.ok && response?.data) {
        setImapPresets(response.data)
      }
    } catch (err) {
      console.error('[Popup] Failed to load IMAP presets:', err)
    }
  }
  
  // Connect Gmail account
  const connectGmailAccount = async () => {
    setEmailSetupStep('connecting')
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EMAIL_CONNECT_GMAIL' })
      if (response?.ok) {
        setShowEmailSetupWizard(false)
        setEmailSetupStep('provider')
        loadEmailAccounts()
      } else {
        setEmailSetupStep('provider')
      }
    } catch (err) {
      console.error('[Popup] Failed to connect Gmail:', err)
      setEmailSetupStep('provider')
    }
  }
  
  // Connect Outlook account
  const connectOutlookAccount = async () => {
    setEmailSetupStep('connecting')
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EMAIL_CONNECT_OUTLOOK' })
      if (response?.ok) {
        setShowEmailSetupWizard(false)
        setEmailSetupStep('provider')
        loadEmailAccounts()
      } else {
        alert(response?.error || 'Failed to connect Outlook')
        setEmailSetupStep('provider')
      }
    } catch (err) {
      console.error('[Popup] Failed to connect Outlook:', err)
      setEmailSetupStep('provider')
    }
  }
  
  // Connect IMAP account
  const connectImapAccount = async () => {
    if (!imapForm.email || !imapForm.host || !imapForm.username || !imapForm.password) {
      alert('Please fill in all required fields')
      return
    }
    
    setEmailSetupStep('connecting')
    try {
      const response = await chrome.runtime.sendMessage({ 
        type: 'EMAIL_CONNECT_IMAP',
        ...imapForm
      })
      if (response?.ok) {
        setShowEmailSetupWizard(false)
        setEmailSetupStep('provider')
        setImapForm({ displayName: '', email: '', host: '', port: 993, username: '', password: '', security: 'ssl' })
        loadEmailAccounts()
      } else {
        alert(response?.error || 'Failed to connect email')
        setEmailSetupStep('credentials')
      }
    } catch (err: any) {
      console.error('[Popup] Failed to connect IMAP:', err)
      alert(err.message || 'Failed to connect email')
      setEmailSetupStep('credentials')
    }
  }
  
  // Apply IMAP preset
  const applyImapPreset = (presetKey: string) => {
    const preset = imapPresets[presetKey]
    if (preset) {
      setImapForm(prev => ({
        ...prev,
        host: preset.host,
        port: preset.port,
        security: preset.security as 'ssl' | 'starttls' | 'none'
      }))
    }
  }
  
  // Disconnect email account
  const disconnectEmailAccount = async (accountId: string) => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EMAIL_DELETE_ACCOUNT', accountId })
      if (response?.ok) {
        loadEmailAccounts()
      }
    } catch (err) {
      console.error('[Popup] Failed to disconnect account:', err)
    }
  }
  
  // Load email accounts when mailguard tab is selected
  useEffect(() => {
    if (activeTab === 'mailguard') {
      loadEmailAccounts()
    }
  }, [activeTab])

  useEffect(() => {
    // Get current tab and check activation status
    chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      const currentTab = tabs[0]
      if (currentTab && currentTab.id) {
        setTabActivation(prev => ({ ...prev, currentTab }))
        
        // Check if extension is active for this tab
        chrome.tabs.sendMessage(currentTab.id, { action: 'getStatus' }).then(response => {
          setTabActivation(prev => ({ ...prev, isActive: response?.active || false }))
        }).catch(() => {
          setTabActivation(prev => ({ ...prev, isActive: false }))
        })
      }
    }).catch(() => {})

    chrome.runtime.sendMessage({ type: 'GET_STATUS' })

    const handleMessage = (message: any) => {
      if (message.type === 'STATUS_UPDATE') {
        setConnectionStatus(message.data)
        setIsLoading(false)
        setLogs(prev => [...prev, `📊 Status: ${message.data.isConnected ? 'Verbunden' : 'Nicht verbunden'}`])
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    const timeout = setTimeout(() => {
      if (isLoading) {
        setIsLoading(false)
        setLogs(prev => [...prev, '⏳ Warte auf Status-Update...'])
      }
    }, 3000)

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
      clearTimeout(timeout)
    }
  }, [])

  const testConnection = () => {
    setLogs(prev => [...prev, '🧪 Teste Verbindung...'])
    chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' })
  }

  const disconnect = () => {
    setLogs(prev => [...prev, '🔌 Trenne Verbindung...'])
    chrome.runtime.sendMessage({ type: 'DISCONNECT' })
  }

  const clearLogs = () => {
    setLogs([])
  }

  const toggleExtensionForTab = async () => {
    if (!tabActivation.currentTab || !tabActivation.currentTab.id) return

    try {
      const response = await chrome.tabs.sendMessage(tabActivation.currentTab.id, { action: 'toggleExtension' })
      
      if (response?.status === 'activated') {
        setTabActivation(prev => ({ ...prev, isActive: true }))
        setLogs(prev => [...prev, `✅ Extension aktiviert für Tab: ${tabActivation.currentTab?.title}`])
      } else if (response?.status === 'deactivated') {
        setTabActivation(prev => ({ ...prev, isActive: false }))
        setLogs(prev => [...prev, `🔴 Extension deaktiviert für Tab: ${tabActivation.currentTab?.title}`])
      }
    } catch (error) {
      console.error('Error toggling extension:', error)
      setLogs(prev => [...prev, `❌ Fehler beim Aktivieren der Extension`])
    }
  }

  const getStatusText = () => {
    if (isLoading) return 'Lädt...'
    return connectionStatus.isConnected ? 'Verbunden' : 'Nicht verbunden'
  }

  const getStatusColor = () => {
    if (isLoading) return '#FFA500'
    return connectionStatus.isConnected ? '#00FF00' : '#FF0000'
  }

  // ------- Context Bucket helpers (local only; no backend) -------
  function showToast(message: string) {
    const d = document.createElement('div')
    d.textContent = message
    d.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:2147483650;background:#0b1220;color:#e5e7eb;padding:8px 12px;border:1px solid rgba(255,255,255,0.2);border-radius:8px;font-size:12px;box-shadow:0 6px 18px rgba(0,0,0,0.35)'
    document.body.appendChild(d)
    setTimeout(()=> d.remove(), 1800)
  }
  async function parseDataTransfer(dt: DataTransfer): Promise<IngestItem[]> {
    const out: IngestItem[] = []
    try {
      for (const f of Array.from(dt.files||[])) {
        const t = (f.type||'').toLowerCase()
        const kind: IngestItem['kind'] = t.startsWith('image/') ? 'image' : t.startsWith('audio/') ? 'audio' : t.startsWith('video/') ? 'video' : 'file'
        out.push({ kind, payload: f, mime: f.type, name: f.name })
      }
      const url = dt.getData('text/uri-list') || dt.getData('text/url')
      if (url) out.push({ kind:'url', payload: url })
      const txt = dt.getData('text/plain')
      if (txt && !url) out.push({ kind:'text', payload: txt })
    } catch {}
    return out
  }
  function runEmbed(items: IngestItem[], target: IngestTarget) {
    showToast('Vorverarbeitung…')
    setTimeout(()=>{
      try {
        const key = target==='session' ? 'optimando-context-bucket-session' : 'optimando-context-bucket-account'
        const prev = JSON.parse(localStorage.getItem(key) || '[]')
        const serialized = items.map(it => ({ kind: it.kind, name: (it as any).name || undefined, mime: it.mime || undefined, size: (it.payload as any)?.size || undefined, text: typeof it.payload==='string'? it.payload : undefined }))
        prev.push({ at: Date.now(), items: serialized })
        localStorage.setItem(key, JSON.stringify(prev))
      } catch {}
      showToast('Einbettung abgeschlossen')
    }, 900)
  }
  async function handleDrop(ev: React.DragEvent) {
    ev.preventDefault()
    const dt = ev.dataTransfer
    if (!dt) return
    const items = await parseDataTransfer(dt)
    if (!items.length) { showToast('Keine Inhalte erkannt'); return }
    pendingItemsRef.current = items
    setConfirmOpen(true)
  }
  function handleEmbed(target: IngestTarget) {
    const items = pendingItemsRef.current || []
    setConfirmOpen(false)
    runEmbed(items, target)
    pendingItemsRef.current = null
  }
  function handlePickFiles() {
    filePickerRef.current?.click()
  }
  function onPickedFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const dt = new DataTransfer()
    Array.from(e.target.files || []).forEach(f => dt.items.add(f))
    const fake = new DragEvent('drop', { dataTransfer: dt })
    // @ts-ignore - synth drop
    handleDrop(fake as any)
    if (filePickerRef.current) filePickerRef.current.value = ''
  }

  return (
    <div style={{ 
      width: '800px', 
      height: '600px',
      fontFamily: 'Arial, sans-serif',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      borderRadius: '8px',
      display: 'flex',
      flexDirection: 'column'
    }} onDragOver={(e)=> e.preventDefault()} onDrop={handleDrop}>
      {/* Top Header - Browser Frame */}
      <div style={{
        height: '40px',
        backgroundColor: 'rgba(0,0,0,0.1)',
        borderBottom: '1px solid rgba(255,255,255,0.2)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 15px',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#FF5F56' }}></div>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#FFBD2E' }}></div>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#27CA3F' }}></div>
        </div>
        <div style={{
          flex: 1,
          margin: '0 20px',
          height: '24px',
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 15px',
          color: 'rgba(255,255,255,0.7)',
          fontSize: '12px'
        }}>
          ---/---/---
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ width: '20px', height: '20px', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: '4px' }}>←</div>
          <div style={{ width: '20px', height: '20px', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: '4px' }}>→</div>
        </div>
      </div>

      {/* Quick Bar below header with Context Bucket */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.2)' }}>
        <button title="Context Bucket: Embed context directly into the session" onClick={handlePickFiles} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}>🪣</button>
        <input ref={filePickerRef} type="file" multiple style={{ display: 'none' }} onChange={onPickedFiles} />
        <div style={{ fontSize: 11, opacity: 0.85 }}>Drag & Drop files, text, or links here</div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', padding: '15px', gap: '15px' }}>
        
        {/* Left Sidebar */}
        <div style={{
          width: '180px',
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '15px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}>
          {/* Tab Status */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Tab Status</h4>
            <div style={{
              height: '4px',
              backgroundColor: 'rgba(255,255,255,0.3)',
              borderRadius: '2px',
              marginBottom: '10px'
            }}></div>
            <div style={{
              height: '20px',
              backgroundColor: 'rgba(255,255,255,0.2)',
              borderRadius: '4px',
              border: '1px solid rgba(255,255,255,0.1)'
            }}></div>
          </div>

          {/* Input Stream */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Input Stream</h4>
            <div style={{ fontSize: '12px', lineHeight: '1.6' }}>
              <div>• selection.changed</div>
              <div>• dom.changed</div>
              <div>• form.submit</div>
            </div>
          </div>

          {/* Cost */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Cost</h4>
            <div style={{ fontSize: '16px', fontWeight: 'bold' }}>$0.02/0.05</div>
          </div>

          {/* Audit Log */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Audit Log</h4>
            <div style={{ fontSize: '12px' }}>
              <div style={{ height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', marginBottom: '8px' }}></div>
              <div style={{ height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', marginBottom: '8px' }}></div>
              <div style={{ height: '2px', backgroundColor: 'rgba(255,255,255,0.3)' }}></div>
            </div>
          </div>
        </div>

        {/* Center Content Area */}
        <div style={{
          flex: 1,
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '15px',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Top Tabs */}
          <div style={{ display: 'flex', marginBottom: '20px' }}>
            <button
              onClick={() => setActiveTab('activation')}
              style={{
                padding: '10px 15px',
                backgroundColor: activeTab === 'activation' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                color: 'white',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                marginRight: '5px',
                fontSize: '12px'
              }}
            >
              🚀 Activation
            </button>
            <button
              onClick={() => setActiveTab('helper')}
              style={{
                padding: '10px 15px',
                backgroundColor: activeTab === 'helper' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                color: 'white',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                marginRight: '5px',
                fontSize: '12px'
              }}
            >
              Helper Tab
            </button>
            <button
              onClick={() => setActiveTab('master')}
              style={{
                padding: '10px 15px',
                backgroundColor: activeTab === 'master' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                color: 'white',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                marginRight: '5px',
                fontSize: '12px'
              }}
            >
              Master
            </button>
            <button
              onClick={() => setActiveTab('mailguard')}
              style={{
                padding: '10px 15px',
                backgroundColor: activeTab === 'mailguard' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                color: 'white',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              🛡️ MailGuard
            </button>
          </div>

          {/* Content Display Area */}
          <div style={{
            flex: 1,
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '8px',
            marginBottom: '20px',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center'
          }}>
            {activeTab === 'activation' && (
              <div style={{ textAlign: 'center', width: '100%' }}>
                <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '16px' }}>
                  Tab Activation
                </h3>
                
                {tabActivation.currentTab && (
                  <div style={{ marginBottom: '20px', fontSize: '12px' }}>
                    <div style={{ marginBottom: '10px', opacity: 0.8 }}>
                      Current Tab:
                    </div>
                    <div style={{ 
                      background: 'rgba(255,255,255,0.1)', 
                      padding: '8px', 
                      borderRadius: '4px',
                      wordBreak: 'break-all' 
                    }}>
                      {tabActivation.currentTab.title}
                    </div>
                    <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '5px' }}>
                      {new URL(tabActivation.currentTab.url || '').hostname}
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: '20px' }}>
                  <div style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    backgroundColor: tabActivation.isActive ? '#4CAF50' : '#f44336',
                    margin: '0 auto 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px'
                  }}>
                    {tabActivation.isActive ? '✓' : '✗'}
                  </div>
                  <div style={{ fontSize: '14px', marginBottom: '5px' }}>
                    Status: {tabActivation.isActive ? 'Aktiv' : 'Inaktiv'}
                  </div>
                  <div style={{ fontSize: '11px', opacity: 0.7 }}>
                    {tabActivation.isActive 
                      ? 'Extension läuft auf diesem Tab' 
                      : 'Extension ist für diesen Tab deaktiviert'
                    }
                  </div>
                </div>

                <button
                  onClick={toggleExtensionForTab}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: tabActivation.isActive ? '#f44336' : '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    transition: 'all 0.3s ease'
                  }}
                >
                  {tabActivation.isActive ? '🔴 Deaktivieren' : '🚀 Aktivieren'}
                </button>
              </div>
            )}
            
            {activeTab === 'helper' && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                height: '100%',
                opacity: 0.5,
                fontSize: '14px'
              }}>
                Helper Tab Content
              </div>
            )}
            
            {activeTab === 'master' && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                height: '100%',
                opacity: 0.5,
                fontSize: '14px'
              }}>
                Master Tab Content
              </div>
            )}
            
            {activeTab === 'mailguard' && (
              <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
                {/* Email Accounts Section */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px' }}>🔗</span>
                      <span style={{ fontSize: '13px', fontWeight: '600' }}>Connected Email Accounts</span>
                    </div>
                    <button
                      onClick={() => setShowEmailSetupWizard(true)}
                      style={{
                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                        border: 'none',
                        color: 'white',
                        borderRadius: '6px',
                        padding: '6px 12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      + Connect Email
                    </button>
                  </div>
                  
                  {isLoadingEmailAccounts ? (
                    <div style={{ padding: '12px', textAlign: 'center', opacity: 0.6, fontSize: '12px' }}>
                      Loading accounts...
                    </div>
                  ) : emailAccounts.length === 0 ? (
                    <div style={{ 
                      padding: '20px', 
                      background: 'rgba(255,255,255,0.05)',
                      borderRadius: '8px',
                      border: '1px dashed rgba(255,255,255,0.2)',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
                      <div style={{ fontSize: '13px', opacity: 0.7, marginBottom: '4px' }}>No email accounts connected</div>
                      <div style={{ fontSize: '11px', opacity: 0.5 }}>
                        Connect your Gmail to view emails securely in MailGuard
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {emailAccounts.map(account => (
                        <div 
                          key={account.id} 
                          style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'space-between',
                            padding: '10px 12px',
                            background: 'rgba(255,255,255,0.08)',
                            borderRadius: '8px',
                            border: account.status === 'active' 
                              ? '1px solid rgba(34,197,94,0.4)'
                              : '1px solid rgba(239,68,68,0.4)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '18px' }}>
                              {account.provider === 'gmail' ? '📧' : '✉️'}
                            </span>
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: '500' }}>
                                {account.email || account.displayName}
                              </div>
                              <div style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                <span style={{ 
                                  width: '6px', height: '6px', borderRadius: '50%', 
                                  background: account.status === 'active' ? '#22c55e' : '#ef4444' 
                                }} />
                                <span style={{ opacity: 0.6 }}>
                                  {account.status === 'active' ? 'Connected' : account.lastError || 'Error'}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => disconnectEmailAccount(account.id)}
                            style={{ background: 'transparent', border: 'none', opacity: 0.5, cursor: 'pointer', fontSize: '14px' }}
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {emailAccounts.length > 0 && (
                    <div style={{ 
                      marginTop: '12px', padding: '10px 12px', 
                      background: 'rgba(34,197,94,0.15)', borderRadius: '6px',
                      border: '1px solid rgba(34,197,94,0.2)',
                      display: 'flex', alignItems: 'flex-start', gap: '8px'
                    }}>
                      <span style={{ fontSize: '14px' }}>🛡️</span>
                      <div style={{ fontSize: '11px', opacity: 0.8, lineHeight: '1.5' }}>
                        <strong>MailGuard Active:</strong> When you visit Gmail, full email content will be fetched securely via the API.
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Email Setup Wizard Modal */}
                {showEmailSetupWizard && (
                  <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <div style={{
                      width: '360px', maxHeight: '90vh', overflow: 'auto',
                      background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                      borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)'
                    }}>
                      <div style={{
                        padding: '16px', background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        position: 'sticky', top: 0
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '20px' }}>📧</span>
                          <span style={{ fontWeight: '600' }}>Connect Your Email</span>
                        </div>
                        <button onClick={() => { setShowEmailSetupWizard(false); setEmailSetupStep('provider'); }} style={{
                          background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white',
                          width: '24px', height: '24px', borderRadius: '4px', cursor: 'pointer'
                        }}>×</button>
                      </div>
                      
                      <div style={{ padding: '16px' }}>
                        {emailSetupStep === 'provider' && (
                          <>
                            {/* Gmail */}
                            <button onClick={connectGmailAccount} style={{
                              width: '100%', padding: '12px', background: 'rgba(255,255,255,0.08)',
                              border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px',
                              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
                              marginBottom: '8px', color: 'white'
                            }}>
                              <span style={{ fontSize: '20px' }}>📧</span>
                              <div style={{ textAlign: 'left', flex: 1 }}>
                                <div style={{ fontWeight: '600' }}>Gmail</div>
                                <div style={{ fontSize: '11px', opacity: 0.6 }}>Connect via Google OAuth</div>
                              </div>
                              <span style={{ opacity: 0.4 }}>→</span>
                            </button>
                            
                            {/* Outlook */}
                            <button onClick={connectOutlookAccount} style={{
                              width: '100%', padding: '12px', background: 'rgba(255,255,255,0.08)',
                              border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px',
                              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
                              marginBottom: '8px', color: 'white'
                            }}>
                              <span style={{ fontSize: '20px' }}>📨</span>
                              <div style={{ textAlign: 'left', flex: 1 }}>
                                <div style={{ fontWeight: '600' }}>Microsoft 365 / Outlook</div>
                                <div style={{ fontSize: '11px', opacity: 0.6 }}>Connect via Microsoft OAuth</div>
                              </div>
                              <span style={{ opacity: 0.4 }}>→</span>
                            </button>
                            
                            {/* IMAP */}
                            <button onClick={() => { setEmailSetupStep('credentials'); loadImapPresets(); }} style={{
                              width: '100%', padding: '12px', background: 'rgba(255,255,255,0.08)',
                              border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px',
                              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
                              marginBottom: '12px', color: 'white'
                            }}>
                              <span style={{ fontSize: '20px' }}>✉️</span>
                              <div style={{ textAlign: 'left', flex: 1 }}>
                                <div style={{ fontWeight: '600' }}>Other (IMAP)</div>
                                <div style={{ fontSize: '11px', opacity: 0.6 }}>Web.de, GMX, Yahoo, T-Online, etc.</div>
                              </div>
                              <span style={{ opacity: 0.4 }}>→</span>
                            </button>
                            
                            <div style={{ 
                              padding: '10px', background: 'rgba(59,130,246,0.15)',
                              borderRadius: '6px', border: '1px solid rgba(59,130,246,0.2)'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                                <span>🔒</span>
                                <div style={{ fontSize: '11px', opacity: 0.8, lineHeight: '1.4' }}>
                                  Your emails are never rendered with scripts or tracking. All content is sanitized locally.
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                        
                        {emailSetupStep === 'credentials' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <button onClick={() => setEmailSetupStep('provider')} style={{
                              background: 'none', border: 'none', color: '#60a5fa', fontSize: '12px',
                              cursor: 'pointer', padding: 0, marginBottom: '4px', textAlign: 'left'
                            }}>← Back</button>
                            
                            <select onChange={(e) => applyImapPreset(e.target.value)} style={{
                              width: '100%', padding: '10px', background: 'rgba(255,255,255,0.08)',
                              border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: 'white', fontSize: '13px'
                            }}>
                              <option value="">Select a preset...</option>
                              {Object.entries(imapPresets).filter(([k]) => k !== 'custom').map(([key, preset]) => (
                                <option key={key} value={key}>{preset.name}</option>
                              ))}
                              <option value="custom">Custom IMAP Server</option>
                            </select>
                            
                            <input type="email" placeholder="Email Address *" value={imapForm.email}
                              onChange={(e) => setImapForm(prev => ({ ...prev, email: e.target.value, username: prev.username || e.target.value }))}
                              style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.08)',
                                border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: 'white', fontSize: '13px' }}
                            />
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px' }}>
                              <input type="text" placeholder="IMAP Server *" value={imapForm.host}
                                onChange={(e) => setImapForm(prev => ({ ...prev, host: e.target.value }))}
                                style={{ padding: '10px', background: 'rgba(255,255,255,0.08)',
                                  border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: 'white', fontSize: '13px' }}
                              />
                              <input type="number" placeholder="Port" value={imapForm.port}
                                onChange={(e) => setImapForm(prev => ({ ...prev, port: parseInt(e.target.value) || 993 }))}
                                style={{ padding: '10px', background: 'rgba(255,255,255,0.08)',
                                  border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: 'white', fontSize: '13px' }}
                              />
                            </div>
                            
                            <input type="text" placeholder="Username *" value={imapForm.username}
                              onChange={(e) => setImapForm(prev => ({ ...prev, username: e.target.value }))}
                              style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.08)',
                                border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: 'white', fontSize: '13px' }}
                            />
                            
                            <input type="password" placeholder="Password / App Password *" value={imapForm.password}
                              onChange={(e) => setImapForm(prev => ({ ...prev, password: e.target.value }))}
                              style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.08)',
                                border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: 'white', fontSize: '13px' }}
                            />
                            
                            <button onClick={connectImapAccount} style={{
                              width: '100%', padding: '12px', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                              border: 'none', borderRadius: '6px', color: 'white', fontWeight: '600', cursor: 'pointer', marginTop: '4px'
                            }}>Connect Email Account</button>
                            
                            <div style={{ fontSize: '11px', opacity: 0.6, lineHeight: '1.4', padding: '8px', background: 'rgba(59,130,246,0.1)', borderRadius: '4px' }}>
                              🔒 <strong>Tip:</strong> For accounts with 2FA, use an App Password.
                            </div>
                          </div>
                        )}
                        
                        {emailSetupStep === 'connecting' && (
                          <div style={{ textAlign: 'center', padding: '30px' }}>
                            <div style={{ width: '40px', height: '40px', border: '3px solid rgba(59,130,246,0.3)',
                              borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
                            <div style={{ fontWeight: '600', marginBottom: '6px' }}>Connecting...</div>
                            <div style={{ fontSize: '12px', opacity: 0.6 }}>Please wait...</div>
                            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom Tabs */}
          <div style={{ display: 'flex' }}>
            <button
              onClick={() => setBottomTab('logs')}
              style={{
                padding: '8px 16px',
                backgroundColor: bottomTab === 'logs' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                color: 'white',
                border: 'none',
                borderRadius: '6px 6px 0 0',
                cursor: 'pointer',
                marginRight: '5px',
                fontSize: '12px'
              }}
            >
              Logs
            </button>
            <button
              onClick={() => setBottomTab('liveStream')}
              style={{
                padding: '8px 16px',
                backgroundColor: bottomTab === 'liveStream' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                color: 'white',
                border: 'none',
                borderRadius: '6px 6px 0 0',
                cursor: 'pointer',
                marginRight: '5px',
                fontSize: '12px'
              }}
            >
              Live Stream
            </button>
            <button
              onClick={() => setBottomTab('metrics')}
              style={{
                padding: '8px 16px',
                backgroundColor: bottomTab === 'metrics' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                color: 'white',
                border: 'none',
                borderRadius: '6px 6px 0 0',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              Metrics
            </button>
          </div>

          {/* Log/Stream/Metrics Display */}
          <div style={{
            height: '80px',
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '0 0 8px 8px',
            padding: '10px',
            border: '1px solid rgba(255,255,255,0.1)',
            borderTop: 'none'
          }}>
            <div style={{ fontSize: '12px' }}>
              <div style={{ height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', marginBottom: '8px' }}></div>
              <div style={{ height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', marginBottom: '8px' }}></div>
              <div style={{ height: '2px', backgroundColor: 'rgba(255,255,255,0.3)' }}></div>
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div style={{
          width: '180px',
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '15px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}>
          {/* WRScan */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <button style={{
                padding: '6px 12px',
                backgroundColor: 'rgba(255,255,255,0.2)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px'
              }}>
                WRScan
              </button>
              <div style={{
                width: '40px',
                height: '20px',
                backgroundColor: 'rgba(255,255,255,0.1)',
                borderRadius: '4px'
              }}></div>
            </div>
          </div>

          {/* QR Code */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '80px',
              height: '80px',
              backgroundColor: 'rgba(255,255,255,0.2)',
              margin: '0 auto 10px auto',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '8px',
              color: 'rgba(255,255,255,0.6)'
            }}>
              QR Code
            </div>
            <div style={{ fontSize: '12px', fontWeight: 'bold' }}>Master</div>
          </div>

          {/* Mode Selection */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Mode</h4>
            <div style={{ fontSize: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
                <input
                  type="radio"
                  name="mode"
                  value="perTab"
                  checked={mode === 'perTab'}
                  onChange={(e) => setMode(e.target.value)}
                  style={{ marginRight: '8px' }}
                />
                Per-Tab
              </label>
              <label style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="radio"
                  name="mode"
                  value="master"
                  checked={mode === 'master'}
                  onChange={(e) => setMode(e.target.value)}
                  style={{ marginRight: '8px' }}
                />
                Master
              </label>
            </div>
          </div>

          {/* Agents */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Agents</h4>
            <div style={{ fontSize: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
                <input
                  type="checkbox"
                  checked={agents.summarize}
                  onChange={(e) => setAgents({...agents, summarize: e.target.checked})}
                  style={{ marginRight: '8px' }}
                />
                Summarize
              </label>
              <label style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
                <input
                  type="checkbox"
                  checked={agents.refactor}
                  onChange={(e) => setAgents({...agents, refactor: e.target.checked})}
                  style={{ marginRight: '8px' }}
                />
                Refactor
              </label>
              <label style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={agents.entityExtract}
                  onChange={(e) => setAgents({...agents, entityExtract: e.target.checked})}
                  style={{ marginRight: '8px' }}
                />
                Entity Extract
              </label>
            </div>
          </div>

          {/* Settings */}
          <div style={{ marginTop: 'auto' }}>
            <button style={{
              width: '100%',
              padding: '8px',
              backgroundColor: 'rgba(255,255,255,0.1)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px'
            }}>
              Settings
            </button>
          </div>
        </div>
      </div>

      {/* Connection Status Bar */}
      <div style={{
        height: '30px',
        backgroundColor: 'rgba(0,0,0,0.2)',
        borderTop: '1px solid rgba(255,255,255,0.2)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 15px',
        fontSize: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: getStatusColor()
          }}></div>
          <span>WebSocket: {getStatusText()}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
          <button
            onClick={testConnection}
            style={{
              padding: '4px 8px',
              backgroundColor: 'rgba(255,255,255,0.2)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '10px'
            }}
          >
            Connect
          </button>
          <button
            onClick={disconnect}
            style={{
              padding: '4px 8px',
              backgroundColor: 'rgba(255,0,0,0.2)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '10px'
            }}
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Confirm Modal */}
      {confirmOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2147483651 }}>
          <div style={{ width: 420, background: 'linear-gradient(135deg,#667eea,#764ba2)', borderRadius: 12, color: 'white', border: '1px solid rgba(255,255,255,0.25)', boxShadow: '0 12px 30px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.25)', fontWeight: 700 }}>Where to embed?</div>
            <div style={{ padding: '12px 14px', fontSize: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><input type="radio" name="kb-target" onChange={()=>{}} /> <span>Session Memory (this session only)</span></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><input type="radio" name="kb-target" onChange={()=>{}} data-account /> <span>Account Memory (account-wide, long term)</span></label>
              <div style={{ marginTop: 8, opacity: 0.9 }}>Content will be processed (OCR/ASR/Parsing), chunked, and embedded locally.</div>
            </div>
            <div style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.08)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={()=> setConfirmOpen(false)} style={{ padding: '6px 10px', border: 0, borderRadius: 6, background: 'rgba(255,255,255,0.18)', color: 'white', cursor: 'pointer' }}>Cancel</button>
              <button onClick={()=>{
                const selected = document.querySelector<HTMLInputElement>('input[name="kb-target"]:checked')
                if (!selected) { showToast('Please select a target'); return }
                handleEmbed(selected.hasAttribute('data-account') ? 'account' : 'session')
              }} style={{ padding: '6px 10px', border: 0, borderRadius: 6, background: '#22c55e', color: '#0b1e12', cursor: 'pointer' }}>Embed</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const container = document.getElementById('app')
if (container) {
  const root = createRoot(container)
  root.render(<Popup />)
}
