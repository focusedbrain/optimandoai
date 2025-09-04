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
  return (
    <div className="app-root">
      <div className="topbar">
        <div className="brand">Optimando</div>
        <div style={{ flex: 1 }} />
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
              <ThemeSwitcher />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
