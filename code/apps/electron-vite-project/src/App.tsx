import { useEffect, useState, useCallback } from 'react'
import './App.css'
import AnalysisCanvas from './components/AnalysisCanvas'
import HandshakeView from './components/HandshakeView'
import HybridSearch from './components/HybridSearch'
import HandshakeInitiateModal from './components/HandshakeInitiateModal'
import SettingsView from './components/SettingsView'
import BeapInboxDashboard from './components/BeapInboxDashboard'
import BeapBulkInboxDashboard from './components/BeapBulkInboxDashboard'
import { type AnalysisOpenPayload, sanitizeAnalysisOpenPayload } from './components/analysis'

type DashboardView = 'analysis' | 'handshakes' | 'beap-inbox' | 'settings'
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
  const [extensionTheme, setExtensionTheme] = useState<ExtensionTheme>('standard')
  const [deepLinkPayload, setDeepLinkPayload] = useState<AnalysisOpenPayload | null>(null)
  const [activeView, setActiveView] = useState<DashboardView>('analysis')
  const [showInitiateModal, setShowInitiateModal] = useState(false)
  const [selectedHandshakeId, setSelectedHandshakeId] = useState<string | null>(null)
  const [selectedHandshakeEmail, setSelectedHandshakeEmail] = useState<string | null>(null)
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null)
  const [bulkMode, setBulkMode] = useState(false)

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

  // Clear selected message and attachment when switching away from inbox
  useEffect(() => {
    if (activeView !== 'beap-inbox') {
      setSelectedMessageId(null)
      setSelectedAttachmentId(null)
    }
  }, [activeView])

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
            className={`nav-tab${activeView === 'beap-inbox' ? ' nav-tab--active' : ''}`}
            onClick={() => setActiveView('beap-inbox')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            BEAP™ Inbox
            <label
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer', fontSize: '12px' }}
              title={bulkMode ? 'Switch to normal inbox' : 'Switch to bulk inbox'}
            >
              ⚡
              <input
                type="checkbox"
                checked={bulkMode}
                onChange={(e) => setBulkMode(e.target.checked)}
                style={{ width: '14px', height: '14px', cursor: 'pointer', margin: 0 }}
              />
            </label>
          </button>
        </nav>
        <HybridSearch
          activeView={activeView}
          selectedHandshakeId={selectedHandshakeId}
          selectedHandshakeEmail={selectedHandshakeEmail}
          selectedDocumentId={selectedDocumentId}
          selectedMessageId={selectedMessageId}
          selectedAttachmentId={selectedAttachmentId}
        />
      </header>

      <main className="app-main">
        {activeView === 'handshakes' ? (
          <HandshakeView
            onNewHandshake={() => setShowInitiateModal(true)}
            selectedHandshakeId={selectedHandshakeId}
            selectedDocumentId={selectedDocumentId}
            onHandshakeScopeChange={(id, email) => {
              setSelectedHandshakeId(id)
              setSelectedHandshakeEmail(email ?? null)
              setSelectedDocumentId(null)
            }}
            onDocumentSelect={setSelectedDocumentId}
          />
        ) : activeView === 'beap-inbox' ? (
          bulkMode ? (
            <BeapBulkInboxDashboard
              onSetSearchContext={() => {}}
              onNavigateToHandshake={(id) => {
                setActiveView('handshakes')
                setSelectedHandshakeId(id)
                setSelectedHandshakeEmail(null)
              }}
              onViewInInbox={(messageId) => {
                setBulkMode(false)
                setSelectedMessageId(messageId)
              }}
            />
          ) : (
            <BeapInboxDashboard
              onMessageSelect={(id) => {
                setSelectedMessageId(id)
                if (!id) setSelectedAttachmentId(null)
              }}
              onAttachmentSelect={(_, attachmentId) => setSelectedAttachmentId(attachmentId)}
              onSetSearchContext={() => {}}
              selectedMessageId={selectedMessageId}
              onNavigateToHandshake={(id) => {
                setActiveView('handshakes')
                setSelectedHandshakeId(id)
                setSelectedHandshakeEmail(null)
              }}
            />
          )
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
