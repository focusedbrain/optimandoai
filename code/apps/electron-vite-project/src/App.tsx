import { useEffect, useMemo, useState } from 'react'
import React from 'react'
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="card rounded-lg border border-[var(--divider)] shadow-sm p-3">
                  <div className="section-title mb-2">🔑 API Keys</div>
                  <ThemeSwitcher />
                </div>
                <div className="card rounded-lg border border-[var(--divider)] shadow-sm p-3">
                  <LocalLLMsCard />
                </div>
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
    </div>
  )
}

// Types
type LocalModelRole = 'chat' | 'summarize' | 'code'
interface LocalModel {
  name: string
  version: string
  status: 'installed' | 'update' | 'not_installed'
  isDefault?: Partial<Record<LocalModelRole, boolean>>
}

interface LocalLLMsState {
  installed: LocalModel[]
  availableOpenWeight: LocalModel[]
  availableOptimized: LocalModel[]
  subscriptionActive: boolean
}

function LocalLLMsCard() {
  const [state, setState] = React.useState<LocalLLMsState>(() => ({
    installed: [
      { name: 'Mistral-7B', version: '0.3', status: 'installed', isDefault: { chat: true } },
      { name: 'Phi-3', version: '3.1', status: 'update', isDefault: { summarize: true } },
    ],
    availableOpenWeight: [
      { name: 'Qwen2.5-7B', version: '2.5', status: 'not_installed' },
      { name: 'Llama3.1-8B', version: '3.1', status: 'not_installed' },
    ],
    availableOptimized: [
      { name: 'Opti-Mixtral-8x7B', version: '1.0', status: 'not_installed' },
    ],
    subscriptionActive: false,
  }))

  function setDefault(role: LocalModelRole, name: string) {
    setState((prev) => ({
      ...prev,
      installed: prev.installed.map((m) => ({
        ...m,
        isDefault: {
          chat: role === 'chat' && m.name === name || !!m.isDefault?.chat,
          summarize: role === 'summarize' && m.name === name || !!m.isDefault?.summarize,
          code: role === 'code' && m.name === name || !!m.isDefault?.code,
        },
      })),
    }))
  }

  function installOpenWeight(name: string) {
    const model = state.availableOpenWeight.find((m) => m.name === name)
    if (!model) return
    setState((s) => ({
      ...s,
      installed: [...s.installed, { ...model, status: 'installed' }],
      availableOpenWeight: s.availableOpenWeight.filter((m) => m.name !== name),
    }))
  }

  function unlockOptimized(name: string) {
    if (!state.subscriptionActive) return
    const model = state.availableOptimized.find((m) => m.name === name)
    if (!model) return
    setState((s) => ({
      ...s,
      installed: [...s.installed, { ...model, status: 'installed' }],
      availableOptimized: s.availableOptimized.filter((m) => m.name !== name),
    }))
  }

  function testModel(name: string) {
    console.log('Test model:', name)
  }

  function updateModel(name: string) {
    setState((s) => ({
      ...s,
      installed: s.installed.map((m) => (m.name === name ? { ...m, status: 'installed', version: m.version + '.1' } : m)),
    }))
  }

  function removeModel(name: string) {
    setState((s) => ({
      ...s,
      installed: s.installed.filter((m) => m.name !== name),
    }))
  }

  const [toInstall, setToInstall] = React.useState<string>('')

  return (
    <div>
      <div className="section-title mb-2">🖥️ Local LLMs</div>
      <div className="text-sm space-y-2">
        {state.installed.map((m) => (
          <div key={m.name} className="flex items-center justify-between rounded-lg border border-[var(--divider)] px-3 py-2">
            <div className="flex items-center gap-3">
              <div className="font-medium">{m.name}</div>
              <div className="text-xs opacity-70">v{m.version}</div>
              <div className="text-xs">
                {m.status === 'installed' && <span className="px-2 py-0.5 rounded bg-green-100 text-green-800">✅ Installed</span>}
                {m.status === 'update' && <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800">⚠️ Update</span>}
                {m.status === 'not_installed' && <span className="px-2 py-0.5 rounded bg-red-100 text-red-800">❌ Not installed</span>}
              </div>
              <div className="text-xs flex gap-1">
                {m.isDefault?.chat && <span className="px-1.5 py-0.5 rounded border border-[var(--divider)]">Default Chat</span>}
                {m.isDefault?.summarize && <span className="px-1.5 py-0.5 rounded border border-[var(--divider)]">Default Summarize</span>}
                {m.isDefault?.code && <span className="px-1.5 py-0.5 rounded border border-[var(--divider)]">Default Code</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  className="text-xs border border-[var(--divider)] rounded px-2 py-1 bg-transparent"
                  onChange={(e) => setDefault(e.target.value as LocalModelRole, m.name)}
                >
                  <option value="">Set as Default ▾</option>
                  <option value="chat">Default Chat</option>
                  <option value="summarize">Default Summarize</option>
                  <option value="code">Default Code</option>
                </select>
              </div>
              <button className="text-xs border border-[var(--divider)] rounded px-2 py-1" onClick={() => testModel(m.name)}>Test</button>
              {m.status === 'update' && (
                <button className="text-xs border border-[var(--divider)] rounded px-2 py-1" onClick={() => updateModel(m.name)}>Update?</button>
              )}
              <button className="text-xs border border-[var(--divider)] rounded px-2 py-1" onClick={() => removeModel(m.name)}>Remove</button>
            </div>
          </div>
        ))}

        <div className="pt-2">
          <label className="text-xs block mb-1">+ Add Model…</label>
          <div className="flex items-center gap-2">
            <select
              className="text-xs border border-[var(--divider)] rounded px-2 py-1 bg-transparent flex-1"
              value={toInstall}
              onChange={(e) => setToInstall(e.target.value)}
            >
              <option value="">Select an open-weight model</option>
              {state.availableOpenWeight.map((m) => (
                <option key={m.name} value={m.name}>{m.name} v{m.version}</option>
              ))}
            </select>
            <button
              disabled={!toInstall}
              className="text-xs border border-[var(--divider)] rounded px-2 py-1 disabled:opacity-50"
              onClick={() => { if (toInstall) installOpenWeight(toInstall); setToInstall('') }}
            >Install</button>
          </div>
        </div>

        <div className="pt-3">
          <div className="font-medium text-xs mb-1">Optimized models</div>
          {state.availableOptimized.map((m) => (
            <div key={m.name} className="flex items-center justify-between rounded-lg border border-[var(--divider)] px-3 py-2 mb-2">
              <div className="flex items-center gap-3">
                <div className="font-medium">{m.name}</div>
                <div className="text-xs opacity-70">v{m.version}</div>
                {!state.subscriptionActive && (
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">🔒 Pro</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!state.subscriptionActive ? (
                  <button className="text-xs border border-[var(--divider)] rounded px-2 py-1">Unlock with Pro</button>
                ) : (
                  <>
                    <button className="text-xs border border-[var(--divider)] rounded px-2 py-1" onClick={() => unlockOptimized(m.name)}>Install</button>
                    <button className="text-xs border border-[var(--divider)] rounded px-2 py-1">Revert to Free</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default App
