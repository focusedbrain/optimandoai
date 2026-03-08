import { useEffect, useState, useCallback } from 'react'
import './App.css'
import AnalysisCanvas from './components/AnalysisCanvas'
import HandshakeView from './components/HandshakeView'
import HybridSearch from './components/HybridSearch'
import HandshakeInitiateModal from './components/HandshakeInitiateModal'
import SettingsView from './components/SettingsView'
import { type AnalysisOpenPayload, sanitizeAnalysisOpenPayload } from './components/analysis'

type DashboardView = 'analysis' | 'handshakes' | 'settings'
type ExtensionTheme = 'pro' | 'dark' | 'standard'

function mapThemeToCss(theme: ExtensionTheme): string {
  return theme
}

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

function normalizeTheme(theme: string): ExtensionTheme {
  let mapped = theme.toLowerCase()
  if (mapped === 'default') return 'pro'
  if (mapped === 'professional') return 'standard'
  return (['pro', 'dark', 'standard'].includes(mapped) ? mapped : 'standard') as ExtensionTheme
}

function App() {
  const [extensionTheme, setExtensionTheme] = useState<ExtensionTheme>('dark')
  const [deepLinkPayload, setDeepLinkPayload] = useState<AnalysisOpenPayload | null>(null)
  const [activeView, setActiveView] = useState<DashboardView>('analysis')
  const [showInitiateModal, setShowInitiateModal] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const cssTheme = mapThemeToCss(extensionTheme)
    root.setAttribute('data-ui-theme', cssTheme)
    console.log('[APP] Theme applied:', extensionTheme, '-> CSS:', cssTheme)
  }, [extensionTheme])

  useEffect(() => {
    const cleanup = window.analysisDashboard?.onThemeChange((theme: string) => {
      console.log('[APP] Theme changed from extension:', theme)
      let mappedTheme = theme
      if (mappedTheme === 'default') mappedTheme = 'pro'
      if (mappedTheme === 'professional') mappedTheme = 'standard'
      if (['pro', 'dark', 'standard'].includes(mappedTheme)) {
        setExtensionTheme(mappedTheme as ExtensionTheme)
      }
    })
    window.analysisDashboard?.requestTheme()
    return () => { cleanup?.() }
  }, [])

  const handleOpenAnalysisDashboard = useCallback((rawPayload: unknown) => {
    const payload = sanitizeAnalysisOpenPayload(rawPayload)
    console.log('[APP] OPEN_ANALYSIS_DASHBOARD received, sanitized:', payload)
    if (payload && typeof payload === 'object' && 'theme' in payload) {
      const theme = (payload as any).theme
      if (typeof theme === 'string') {
        const normalized = normalizeTheme(theme)
        setExtensionTheme(normalized)
      }
    }
    setActiveView('analysis')
    setDeepLinkPayload(payload)
  }, [])

  useEffect(() => {
    const cleanup = window.analysisDashboard?.onOpen(handleOpenAnalysisDashboard)
    return () => { cleanup?.() }
  }, [handleOpenAnalysisDashboard])

  const handleBeapTabClick = useCallback(() => {
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
          >
            Analysis
          </button>
          <button
            className={`nav-tab${activeView === 'handshakes' ? ' nav-tab--active' : ''}`}
            onClick={() => setActiveView('handshakes')}
          >
            Handshakes
          </button>
          <button
            className="nav-tab"
            onClick={handleBeapTabClick}
          >
            BEAP™ Inbox
          </button>
        </nav>
        <HybridSearch activeView={activeView} />
      </header>

      <main className="app-main">
        {activeView === 'handshakes' ? (
          <HandshakeView onNewHandshake={() => setShowInitiateModal(true)} />
        ) : activeView === 'settings' ? (
          <SettingsView />
        ) : (
          <AnalysisCanvas 
            deepLinkPayload={deepLinkPayload ?? undefined}
            onDeepLinkConsumed={() => setDeepLinkPayload(null)}
          />
        )}
        {showInitiateModal && (
          <HandshakeInitiateModal
            onClose={() => setShowInitiateModal(false)}
            onSuccess={() => {
              setShowInitiateModal(false)
              window.dispatchEvent(new CustomEvent('handshake-list-refresh'))
            }}
          />
        )}
      </main>
    </div>
  )
}

export default App
