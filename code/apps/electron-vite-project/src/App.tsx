import { useEffect, useMemo, useState } from 'react'
import './App.css'
import LETmeGIRAFFETHATFORYOUIcons from './components/LETmeGIRAFFETHATFORYOUIcons'
import { FirstRunWizard } from './components/llm/FirstRunWizard'

type ThemePreference = 'dark' | 'professional' | 'auto'

function resolveTheme(pref: ThemePreference): 'dark' | 'professional' {
  if (pref !== 'auto') return pref
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'professional'
}

function ThemeSwitcher() {
  const [pref, setPref] = useState<ThemePreference>(() => (localStorage.getItem('ui-theme') as ThemePreference) || 'auto')
  const actual = useMemo(() => resolveTheme(pref), [pref])

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-ui-theme', actual)
    localStorage.setItem('ui-theme', pref)
  }, [pref, actual])

  useEffect(() => {
    if (pref !== 'auto') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setPref('auto')
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [pref])

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12 }}>Theme</span>
      <select
        value={pref}
        onChange={(e) => setPref(e.target.value as ThemePreference)}
        style={{ fontSize: 12, padding: '4px 8px' }}
        aria-label="Theme selection"
      >
        <option value="dark">Dark</option>
        <option value="professional">Professional</option>
        <option value="auto">Auto</option>
      </select>
    </label>
  )
}

function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [showPlans, setShowPlans] = useState(false)
  const [captures, setCaptures] = useState<any[]>([])
  const [triggerPrompt, setTriggerPrompt] = useState<{ mode: 'screenshot'|'stream', rect: any, displayId: number } | null>(null)
  const [triggerName, setTriggerName] = useState('')
  const [showLlmWizard, setShowLlmWizard] = useState(false)

  useEffect(() => {
    // Check if LLM setup has been completed before
    const checkLlmSetup = async () => {
      try {
        const config = await (window as any).llm?.getConfig()
        // If no config exists or user hasn't completed setup, show wizard
        if (!config || !localStorage.getItem('llm-setup-complete')) {
          setShowLlmWizard(true)
        }
      } catch (error) {
        console.error('Failed to check LLM setup:', error)
      }
    }
    checkLlmSetup()

    // @ts-ignore
    window.lmgtfy?.onCapture((payload: any) => setCaptures((c) => [...c, payload]))
    // @ts-ignore
    window.lmgtfy?.onHotkey((k: string) => {
      if (k === 'screenshot') {
        // @ts-ignore
        window.lmgtfy?.selectScreenshot()
      } else if (k === 'stream') {
        // @ts-ignore
        window.lmgtfy?.selectStream()
      } else if (k === 'stop') {
        // @ts-ignore
        window.lmgtfy?.stopStream()
      }
    })

    const ipc: any = (window as any).ipcRenderer
    if (ipc?.on) {
      console.log('[APP] Setting up SHOW_TRIGGER_PROMPT listener')
      const handleTriggerSaveRequest = (_e: any, data: any) => {
        console.log('[APP] SHOW_TRIGGER_PROMPT received:', data)
        setTriggerPrompt(data)
        setTriggerName('')
      }
      ipc.on('SHOW_TRIGGER_PROMPT', handleTriggerSaveRequest)
      return () => {
        ipc.off?.('SHOW_TRIGGER_PROMPT', handleTriggerSaveRequest)
      }
    } else {
      console.log('[APP] ipcRenderer not available')
    }
  }, [])

  const handleSaveTrigger = async () => {
    if (!triggerPrompt || !triggerName.trim()) return
    try {
      // @ts-ignore
      await window.LETmeGIRAFFETHATFORYOU?.savePreset({
        id: undefined,
        name: triggerName.trim(),
        displayId: triggerPrompt.displayId,
        x: triggerPrompt.rect.x,
        y: triggerPrompt.rect.y,
        w: triggerPrompt.rect.w,
        h: triggerPrompt.rect.h,
        mode: triggerPrompt.mode,
        headless: triggerPrompt.mode === 'screenshot'
      })
      const ipc: any = (window as any).ipcRenderer
      ipc?.send?.('TRIGGER_SAVED')
    } catch (err) {
      console.log('Error saving trigger:', err)
    }
    setTriggerPrompt(null)
    setTriggerName('')
  }

  const handleCancelTrigger = () => {
    setTriggerPrompt(null)
    setTriggerName('')
  }

  const handleLlmWizardComplete = () => {
    localStorage.setItem('llm-setup-complete', 'true')
    setShowLlmWizard(false)
  }

  const handleLlmWizardSkip = () => {
    localStorage.setItem('llm-setup-complete', 'skipped')
    setShowLlmWizard(false)
  }

  const handleReopenLlmSetup = () => {
    setShowLlmWizard(true)
  }

  return (
    <div className="app-root">
      {showLlmWizard && (
        <FirstRunWizard 
          onComplete={handleLlmWizardComplete}
          onSkip={handleLlmWizardSkip}
        />
      )}
      <div className="topbar">
        <div className="brand">OpenGiraffe</div>
        <div style={{ flex: 1 }} />
        <LETmeGIRAFFETHATFORYOUIcons onCapture={(p) => console.log('capture', p)} />
        <button className="btn" onClick={() => setShowPlans(true)} style={{ marginLeft: 8 }}>Plans</button>
        <button className="btn" onClick={() => setShowSettings(true)} style={{ marginLeft: 8 }}>Settings</button>
      </div>
      <div className="layout">
        <aside className="sidebar">
          <div className="section-title">Navigation</div>
          <button className="btn">Action</button>
        </aside>
        <main className="content">
          <h1>Main Content</h1>
          <p>This area remains unaffected by the theme background.</p>
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => {
              // @ts-ignore
              window.lmgtfy?.selectScreenshot()
            }}>📸 Screenshot</button>
            <button className="btn" onClick={() => {
              // @ts-ignore
              window.lmgtfy?.selectStream()
            }} style={{ marginLeft: 8 }}>🎥 Stream</button>
            <button className="btn" onClick={() => {
              // @ts-ignore
              window.lmgtfy?.stopStream()
            }} style={{ marginLeft: 8 }}>■ Stop</button>
          </div>
          <pre style={{ marginTop: 12, background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 6 }}>
            {JSON.stringify(captures, null, 2)}
          </pre>
        </main>
      </div>
      {showSettings && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Settings">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Settings</div>
              <button className="btn" onClick={() => setShowSettings(false)} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <ThemeSwitcher />
              <div style={{ marginTop: 16 }}>
                <button 
                  className="btn" 
                  onClick={handleReopenLlmSetup}
                  style={{ fontSize: 13 }}
                >
                  Configure Local LLM
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showPlans && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Subscription Plans">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Subscription Plans</div>
              <button className="btn" onClick={() => setShowPlans(false)} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                <div className="card">
                  <div className="section-title">Free (Local)</div>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>$0</div>
                  <ul style={{ marginTop: 8 }}>
                    <li>Unlimited WR Codes</li>
                    <li>Unlimited local context (offline, private)</li>
                    <li>WR Code account required</li>
                    <li>Runs with local LLMs</li>
                    <li style={{ color: '#22c55e' }}>✓ Pay-as-you-go (Cloud)</li>
                  </ul>
                </div>
                <div className="card">
                  <div className="section-title">Pro (Private)</div>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>$19.95<span style={{ fontSize: 12 }}>/year</span></div>
                  <ul style={{ marginTop: 8 }}>
                    <li>Unlimited WR Codes</li>
                    <li>WR Code generation (non-commercial use)</li>
                    <li>1 GB hosted context</li>
                    <li>Hosted verification</li>
                    <li>Basic analytics</li>
                    <li style={{ color: '#22c55e' }}>✓ BYOK or Pay-as-you-go</li>
                  </ul>
                </div>
                <div className="card">
                  <div className="section-title">Publisher</div>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>$19<span style={{ fontSize: 12 }}>/month</span></div>
                  <ul style={{ marginTop: 8 }}>
                    <li>Unlimited WR Codes</li>
                    <li>WR Code generation (commercial use)</li>
                    <li>5 GB hosted context</li>
                    <li>Publisher branding</li>
                    <li>Custom domain</li>
                    <li>Advanced analytics</li>
                    <li>Priority queue</li>
                    <li style={{ color: '#22c55e' }}>✓ BYOK or Pay-as-you-go</li>
                  </ul>
                </div>
                <div className="card">
                  <div className="section-title">Business/Enterprise</div>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>$99<span style={{ fontSize: 12 }}>/month</span></div>
                  <ul style={{ marginTop: 8 }}>
                    <li>Unlimited WR Codes</li>
                    <li>WR Code generation (enterprise use)</li>
                    <li>25 GB hosted context</li>
                    <li>Multiple domains</li>
                    <li>Team features & roles</li>
                    <li>SSO/SAML, DPA</li>
                    <li>SLA + dedicated support</li>
                    <li style={{ color: '#22c55e' }}>✓ BYOK or Pay-as-you-go</li>
                  </ul>
                </div>
              </div>
              <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.45)' }}>
                <div style={{ fontSize: 12 }}>
                  🔑 BYOK Feature: Available for all subscription plans. Use your own API keys from OpenAI, Claude, Gemini, Grok, and more!
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {triggerPrompt && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Save Tagged Trigger">
          <div className="modal" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <div className="modal-title">Save Tagged Trigger</div>
              <button className="btn" onClick={handleCancelTrigger} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 8, color: '#e5e7eb', fontSize: 14 }}>
                  {triggerPrompt.mode === 'screenshot' ? '📸 Screenshot' : '🎥 Stream'} trigger will be saved for quick access.
                </div>
                <label style={{ display: 'block', marginBottom: 6, color: '#e5e7eb', fontSize: 13 }}>
                  Tagged Trigger name:
                </label>
                <input
                  type="text"
                  placeholder="Trigger name"
                  value={triggerName}
                  onChange={(e) => setTriggerName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && triggerName.trim()) {
                      handleSaveTrigger()
                    } else if (e.key === 'Escape') {
                      handleCancelTrigger()
                    }
                  }}
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: 14,
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 6,
                    background: 'rgba(11,18,32,0.8)',
                    color: '#e5e7eb'
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  className="btn"
                  onClick={handleCancelTrigger}
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    color: '#e5e7eb'
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn"
                  onClick={handleSaveTrigger}
                  disabled={!triggerName.trim()}
                  style={{
                    background: '#2563eb',
                    color: 'white',
                    opacity: triggerName.trim() ? 1 : 0.5,
                    cursor: triggerName.trim() ? 'pointer' : 'not-allowed'
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
