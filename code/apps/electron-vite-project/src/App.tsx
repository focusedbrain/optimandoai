import { useEffect, useState, useCallback } from 'react'
import './App.css'
import AnalysisCanvas from './components/AnalysisCanvas'
import HandshakeView from './components/HandshakeView'
import HybridSearch from './components/HybridSearch'
import HandshakeInitiateModal from './components/HandshakeInitiateModal'
import SettingsView from './components/SettingsView'
import EmailInboxView from './components/EmailInboxView'
import EmailInboxBulkView from './components/EmailInboxBulkView'
import { type AnalysisOpenPayload, sanitizeAnalysisOpenPayload } from './components/analysis'
import './components/handshakeViewTypes'

type DashboardView = 'analysis' | 'handshakes' | 'beap-inbox' | 'settings'
type ExtensionTheme = 'pro' | 'dark' | 'standard'

function mapThemeToCss(theme: ExtensionTheme): string {
  return theme
}

function WRCodeLogo({ size = 220 }: { size?: number }) {
  // Respect Vite base ('./') so packaged Electron (file://) resolves like dev server
  const logoSrc = `${import.meta.env.BASE_URL}wrdesk-logo.svg`
  return (
    <img 
      src={logoSrc}
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
  const [inboxBulkMode, setInboxBulkMode] = useState(false)
  const [emailAccounts, setEmailAccounts] = useState<Array<{ id: string; email: string; status?: string }>>([])

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

  const handleDeepLinkConsumed = useCallback(() => setDeepLinkPayload(null), [])

  // Clear selected message and attachment when switching to views that don't support message focus
  useEffect(() => {
    if (activeView === 'analysis' || activeView === 'settings') {
      setSelectedMessageId(null)
      setSelectedAttachmentId(null)
    }
  }, [activeView])

  // Load email accounts and listen for onAccountConnected
  useEffect(() => {
    async function loadEmailAccounts() {
      if (typeof window.emailAccounts?.listAccounts !== 'function') return
      try {
        const res = await window.emailAccounts.listAccounts()
        if (res?.ok && res?.data) {
          setEmailAccounts(
            res.data.map((a: { id: string; email: string }) => ({ id: a.id, email: a.email }))
          )
        }
      } catch {
        /* ignore */
      }
    }
    loadEmailAccounts()
    const unsub = window.emailAccounts?.onAccountConnected?.(async () => {
      // Refresh account list only — do not enable auto-sync or Pull; user opts in via Inbox UI.
      await loadEmailAccounts()
    })
    return () => unsub?.()
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
          <div
            role="button"
            tabIndex={0}
            className={`nav-tab${activeView === 'beap-inbox' ? ' nav-tab--active' : ''}`}
            onClick={() => setActiveView('beap-inbox')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveView('beap-inbox') } }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            Inbox
            <label
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '12px', flexShrink: 0 }}
              title={inboxBulkMode ? 'Switch to normal inbox' : 'Switch to bulk inbox'}
            >
              ⚡
              <input
                type="checkbox"
                checked={inboxBulkMode}
                onChange={(e) => setInboxBulkMode(e.target.checked)}
              />
            </label>
          </div>
        </nav>
        <HybridSearch
          activeView={activeView}
          selectedHandshakeId={selectedHandshakeId}
          selectedHandshakeEmail={selectedHandshakeEmail}
          selectedDocumentId={selectedDocumentId}
          selectedMessageId={selectedMessageId}
          selectedAttachmentId={selectedAttachmentId}
          onClearMessageSelection={() => {
            setSelectedMessageId(null)
            setSelectedAttachmentId(null)
          }}
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
              setSelectedMessageId(null)
              setSelectedAttachmentId(null)
            }}
            onDocumentSelect={setSelectedDocumentId}
            selectedMessageId={selectedMessageId}
            onSelectMessage={setSelectedMessageId}
            selectedAttachmentId={selectedAttachmentId}
            onSelectAttachment={setSelectedAttachmentId}
          />
        ) : activeView === 'beap-inbox' ? (
          inboxBulkMode ? (
            <EmailInboxBulkView
              accounts={emailAccounts}
              selectedMessageId={selectedMessageId}
              onSelectMessage={(id) => {
                setSelectedMessageId(id)
                if (!id) setSelectedAttachmentId(null)
              }}
              selectedAttachmentId={selectedAttachmentId}
              onSelectAttachment={setSelectedAttachmentId}
            />
          ) : (
            <EmailInboxView
              accounts={emailAccounts}
              selectedMessageId={selectedMessageId}
              onSelectMessage={(id) => {
                setSelectedMessageId(id)
                if (!id) setSelectedAttachmentId(null)
              }}
              selectedAttachmentId={selectedAttachmentId}
              onSelectAttachment={setSelectedAttachmentId}
            />
          )
        ) : activeView === 'settings' ? (
          <SettingsView />
        ) : (
          <AnalysisCanvas 
            deepLinkPayload={deepLinkPayload ?? undefined}
            onDeepLinkConsumed={handleDeepLinkConsumed}
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
