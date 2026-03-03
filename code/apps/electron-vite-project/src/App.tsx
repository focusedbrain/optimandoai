import { useEffect, useState, useCallback } from 'react'
import './App.css'
import AnalysisCanvas from './components/AnalysisCanvas'
import HandshakeView from './components/HandshakeView'
import HybridSearch from './components/HybridSearch'
import { type AnalysisOpenPayload, sanitizeAnalysisOpenPayload } from './components/analysis'

// Type declaration for the Analysis Dashboard preload API
declare global {
  interface Window {
    analysisDashboard?: {
      onOpen: (callback: (rawPayload: unknown) => void) => () => void
      onThemeChange: (callback: (theme: string) => void) => () => void
      requestTheme: () => void
      setTheme: (theme: string) => void
      openBeapInbox: () => void
      openHandshakeRequest: () => void
    }
  }
}

// Extension theme types: 'pro' (purple), 'dark', 'standard' (light/white - default)
type ExtensionTheme = 'pro' | 'dark' | 'standard'

// Map extension theme to CSS data-ui-theme attribute
function mapThemeToCss(theme: ExtensionTheme): string {
  // 'pro' is purple theme, 'dark' stays dark, 'standard' is light (default)
  return theme
}

// WR Desk Logo Component - using original PNG logo
// Use relative path for Electron file:// protocol compatibility
function WRCodeLogo({ size = 220 }: { size?: number }) {
  return (
    <img 
      src="./wrdesk-logo.png" 
      alt="WR Desk Logo"
      style={{
        width: size,
        height: 'auto',
        objectFit: 'contain'
      }}
    />
  )
}

// Helper to normalize theme string to ExtensionTheme
function normalizeTheme(theme: string): ExtensionTheme {
  let mapped = theme.toLowerCase()
  if (mapped === 'default') return 'pro'
  if (mapped === 'professional') return 'standard'
  return (['pro', 'dark', 'standard'].includes(mapped) ? mapped : 'standard') as ExtensionTheme
}

// Theme selector component - kept for future use / re-enable when needed
// function ThemeSelector({ value, onChange }: { value: ExtensionTheme, onChange: (v: ExtensionTheme) => void }) {
//   const safeValue = (['standard', 'pro', 'dark'].includes(value) ? value : 'standard') as ExtensionTheme
//   return (
//     <div className="theme-switcher">
//       <select key={safeValue} value={safeValue} onChange={(e) => onChange(e.target.value as ExtensionTheme)}
//         className="theme-switcher__select" aria-label="Theme selection">
//         <option value="standard">Standard</option>
//         <option value="pro">Pro</option>
//         <option value="dark">Dark</option>
//       </select>
//     </div>
//   )
// }

type DashboardView = 'analysis' | 'handshakes' | 'beap'

function App() {
  // Extension theme state - synced from extension via main process (default: standard)
  const [extensionTheme, setExtensionTheme] = useState<ExtensionTheme>('standard')
  const [deepLinkPayload, setDeepLinkPayload] = useState<AnalysisOpenPayload | null>(null)
  const [activeView, setActiveView] = useState<DashboardView>('analysis')

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement
    const cssTheme = mapThemeToCss(extensionTheme)
    root.setAttribute('data-ui-theme', cssTheme)
    console.log('[APP] Theme applied:', extensionTheme, '-> CSS:', cssTheme)
  }, [extensionTheme])

  // Listen for theme changes from extension via main process
  useEffect(() => {
    const cleanup = window.analysisDashboard?.onThemeChange((theme: string) => {
      console.log('[APP] Theme changed from extension:', theme)
      // Map old theme names for backward compatibility
      let mappedTheme = theme
      if (mappedTheme === 'default') mappedTheme = 'pro'
      if (mappedTheme === 'professional') mappedTheme = 'standard'
      if (['pro', 'dark', 'standard'].includes(mappedTheme)) {
        setExtensionTheme(mappedTheme as ExtensionTheme)
      }
    })
    // Request current theme on mount
    window.analysisDashboard?.requestTheme()
    return () => { cleanup?.() }
  }, [])

  // Handle Analysis Dashboard open request from main process
  const handleOpenAnalysisDashboard = useCallback((rawPayload: unknown) => {
    const payload = sanitizeAnalysisOpenPayload(rawPayload)
    console.log('[APP] OPEN_ANALYSIS_DASHBOARD received, sanitized:', payload)
    // Extract theme from payload if provided
    if (payload && typeof payload === 'object' && 'theme' in payload) {
      const theme = (payload as any).theme
      if (typeof theme === 'string') {
        const normalized = normalizeTheme(theme)
        setExtensionTheme(normalized)
      }
    }
    setDeepLinkPayload(payload)
  }, [])

  // Listen for OPEN_ANALYSIS_DASHBOARD from main process
  useEffect(() => {
    const cleanup = window.analysisDashboard?.onOpen(handleOpenAnalysisDashboard)
    return () => { cleanup?.() }
  }, [handleOpenAnalysisDashboard])

  // Handle theme change from selector - kept for future re-enable
  // const handleThemeChange = useCallback((newTheme: ExtensionTheme) => {
  //   setExtensionTheme(newTheme)
  //   window.analysisDashboard?.setTheme(newTheme)
  // }, [])

  const handleBeapTabClick = useCallback(() => {
    setActiveView('beap')
    window.analysisDashboard?.openBeapInbox()
  }, [])

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header__brand">
          <WRCodeLogo size={110} />
        </div>
        <nav className="app-header__nav">
          <button
            className={`nav-tab${activeView === 'analysis' ? ' nav-tab--active' : ''}`}
            onClick={() => setActiveView('analysis')}
            title="Analysis Dashboard"
          >
            Analysis
          </button>
          <button
            className={`nav-tab${activeView === 'handshakes' ? ' nav-tab--active' : ''}`}
            onClick={() => setActiveView('handshakes')}
            title="Handshake Relationships"
          >
            Handshakes
          </button>
          <button
            className={`nav-tab${activeView === 'beap' ? ' nav-tab--active' : ''}`}
            onClick={handleBeapTabClick}
            title="Open BEAP Inbox"
          >
            BEAP™ Inbox
          </button>
        </nav>
        <HybridSearch activeView={activeView} />
        {/* <ThemeSelector value={extensionTheme} onChange={handleThemeChange} /> */}
      </header>

      <main className="app-main">
        {activeView === 'handshakes' ? (
          <HandshakeView />
        ) : (
          <AnalysisCanvas 
            deepLinkPayload={deepLinkPayload ?? undefined}
            onDeepLinkConsumed={() => setDeepLinkPayload(null)}
          />
        )}
      </main>
    </div>
  )
}

export default App
