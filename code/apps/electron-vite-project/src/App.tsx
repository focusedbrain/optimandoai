import { useEffect, useMemo, useState } from 'react'
import './App.css'

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

  useEffect(() => {
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
  }, [])
  return (
    <div className="app-root">
      <div className="topbar">
        <div className="brand">Optimando</div>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => setShowPlans(true)}>Plans</button>
        <button className="btn" onClick={() => setShowSettings(true)}>Settings</button>
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
    </div>
  )
}

export default App
