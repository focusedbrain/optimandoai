import { useEffect, useState, useCallback } from 'react'
import './App.css'
import AnalysisCanvas from './components/AnalysisCanvas'
import HandshakeView from './components/HandshakeView'
import HybridSearch from './components/HybridSearch'
import HandshakeInitiateModal from './components/HandshakeInitiateModal'
import SettingsView from './components/SettingsView'
import EmailInboxView from './components/EmailInboxView'
import EmailInboxBulkView from './components/EmailInboxBulkView'
import WrChatDashboardPanel from './components/WrChatDashboardPanel'
import { WrMultiTriggerBar, AddModeWizardHost } from '@ext/ui/components'
import { useEmailInboxStore, type InboxFilter } from './stores/useEmailInboxStore'
import { subscribeInboxNewMessagesBackgroundRefresh } from './utils/inboxNewMessagesBackgroundRefresh'
import { registerWrDeskOptimizerHttpBridge } from './lib/wrDeskOptimizerHttpBridge'
import { WRDESK_AUTO_OPTIM_ACTIVATE_SESSIONS } from './lib/wrdeskUiEvents'
import { type AnalysisOpenPayload, sanitizeAnalysisOpenPayload } from './components/analysis'
import './components/handshakeViewTypes'
// === TEMPORARY DEBUG LOG VIEWER (remove before production) ===
import { DebugLogViewer } from './components/DebugLogViewer'
// === END TEMPORARY DEBUG LOG VIEWER ===

type DashboardView = 'analysis' | 'wr-chat' | 'handshakes' | 'beap-inbox' | 'settings'
type ExtensionTheme = 'pro' | 'dark' | 'standard'

function mapThemeToCss(theme: ExtensionTheme): string {
  return theme
}

function WRCodeLogo({ size = 220 }: { size?: number }) {
  // Respect Vite base ('./') so packaged Electron (file://) resolves like dev server
  const logoSrc = `${import.meta.env.BASE_URL}wrdesk-logo.png`
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
  const [emailAccounts, setEmailAccounts] = useState<
    Array<{ id: string; email: string; status?: string; processingPaused?: boolean }>
  >([])
  const [emailAccountsLoadError, setEmailAccountsLoadError] = useState<string | null>(null)
  useEffect(() => {
    const root = document.documentElement
    const cssTheme = mapThemeToCss(extensionTheme)
    root.setAttribute('data-ui-theme', cssTheme)
    console.log('[APP] Theme applied:', extensionTheme, '-> CSS:', cssTheme)
  }, [extensionTheme])

  /** HTTP bridge for extension → POST /api/projects/:id/optimize/* (main process → renderer). */
  useEffect(() => {
    registerWrDeskOptimizerHttpBridge()
  }, [])

  /** Electron dashboard: PQ KEM HTTP to localhost requires X-Launch-Secret (extension gets it via WebSocket). */
  useEffect(() => {
    const chromeRuntime = typeof globalThis !== 'undefined' ? (globalThis as unknown as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime : undefined
    if (chromeRuntime?.sendMessage) return
    void import('@ext/beap-messages/services/beapCrypto').then(({ setPqAuthHeadersProvider }) => {
      setPqAuthHeadersProvider(async () => {
        const fn = window.handshakeView?.pqHeaders
        if (typeof fn !== 'function') return {}
        const headers = await fn()
        return headers && typeof headers === 'object' ? headers : {}
      })
    })
  }, [])

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

  /** Auto-optimization: switch to WR Chat, bring window forward, activate each linked session key. */
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ sessionIds?: string[] }>
      const ids = (ce.detail?.sessionIds ?? []).filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      )
      if (ids.length === 0) return
      setActiveView('wr-chat')
      window.setTimeout(() => {
        try {
          window.analysisDashboard?.openWrChat?.()
        } catch {
          /* noop */
        }
        ids.forEach((id, i) => {
          window.setTimeout(() => {
            try {
              localStorage.setItem('optimando-active-session-key', id)
              localStorage.setItem('optimando-global-active-session', id)
            } catch {
              /* noop */
            }
          }, i * 200)
        })
      }, 0)
    }
    window.addEventListener(WRDESK_AUTO_OPTIM_ACTIVATE_SESSIONS, handler)
    return () => window.removeEventListener(WRDESK_AUTO_OPTIM_ACTIVATE_SESSIONS, handler)
  }, [])

  const handleDeepLinkConsumed = useCallback(() => setDeepLinkPayload(null), [])

  // Clear selected message and attachment when switching to views that don't support message focus
  useEffect(() => {
    if (activeView === 'analysis' || activeView === 'wr-chat' || activeView === 'settings') {
      setSelectedMessageId(null)
      setSelectedAttachmentId(null)
    }
  }, [activeView])

  const loadEmailAccounts = useCallback(async () => {
    if (typeof window.emailAccounts?.listAccounts !== 'function') return
    try {
      const res = await window.emailAccounts.listAccounts()
      if (!res?.ok) {
        // Preserve existing list — do NOT wipe accounts on a transient IPC failure.
        const errMsg = String(res?.error ?? '').trim() || 'Could not load email accounts (IPC error).'
        console.error('[App] loadEmailAccounts: IPC returned ok:false —', errMsg)
        setEmailAccountsLoadError(errMsg)
        return
      }
      if (!Array.isArray(res.data)) {
        console.error('[App] loadEmailAccounts: response missing data array')
        setEmailAccountsLoadError('Account list response was missing or invalid.')
        return
      }
      setEmailAccountsLoadError(null)
      setEmailAccounts(
        res.data.map((a: { id: string; email: string; status?: string; processingPaused?: boolean }) => ({
          id: a.id,
          email: a.email,
          status: a.status,
          processingPaused: a.processingPaused === true ? true : undefined,
        })),
      )
    } catch (err) {
      // Preserve existing list — do NOT wipe accounts on a thrown IPC error.
      const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error')
      console.error('[App] loadEmailAccounts threw:', msg)
      setEmailAccountsLoadError(`Failed to load email accounts: ${msg}`)
    }
  }, [])

  useEffect(() => {
    loadEmailAccounts()
    const unsub = window.emailAccounts?.onAccountConnected?.(async () => {
      await loadEmailAccounts()
    })
    return () => unsub?.()
  }, [loadEmailAccounts])

  /**
   * Background sync (auto-sync, IMAP interval, etc.) emits `inbox:newMessages` from the main process.
   * Subscribing only inside Inbox/Bulk would miss events while the user is on Analysis, Handshakes, or Settings.
   * Single app-level listener keeps the Zustand snapshot fresh so opening Inbox shows new mail without manual refresh.
   */
  useEffect(() => {
    return subscribeInboxNewMessagesBackgroundRefresh({
      onNewMessages: window.emailInbox?.onNewMessages,
      refreshMessages: () => useEmailInboxStore.getState().refreshMessages(),
    })
  }, [])

  useEffect(() => {
    const unsub = window.emailInbox?.onBeapInboxUpdated?.(() => {
      void useEmailInboxStore.getState().refreshMessages()
    })
    return () => unsub?.()
  }, [])

  /** Inbox → Handshakes: reuse app-level handshake selection (same as picking a row in HandshakeView). */
  const handleNavigateToHandshakeFromInbox = useCallback((handshakeId: string) => {
    setActiveView('handshakes')
    setSelectedHandshakeId(handshakeId)
    setSelectedHandshakeEmail(null)
    setSelectedDocumentId(null)
    setSelectedMessageId(null)
    setSelectedAttachmentId(null)
  }, [])

  /** Analysis dashboard → Inbox: select workflow tab then message (read-only navigation). */
  const handleOpenInboxMessageFromDashboard = useCallback((payload: { messageId: string; workflowTab: InboxFilter['filter'] }) => {
    setActiveView('beap-inbox')
    setInboxBulkMode(false)
    useEmailInboxStore.getState().setFilter({ filter: payload.workflowTab })
    setSelectedMessageId(payload.messageId)
    setSelectedAttachmentId(null)
  }, [])

  /** Analysis PoAE archive entry → Inbox (no message selection). */
  const handleOpenInboxFromAnalysis = useCallback(() => {
    setActiveView('beap-inbox')
    setInboxBulkMode(false)
  }, [])

  /** WR Chat tab + deferred focus so intro runs after the chat view mounts. */
  const ensureWrChatOpenThen = useCallback((applyFocus: () => void) => {
    setActiveView('wr-chat')
    window.setTimeout(applyFocus, 0)
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
          {/* WR Chat: primary entry = in-dashboard view (WrChatDashboardPanel). Rollback: replace onClick with
              `() => window.analysisDashboard?.openWrChat()` and remove activeView wr-chat branch in main if desired. */}
          <button
            className={`nav-tab${activeView === 'wr-chat' ? ' nav-tab--active' : ''}`}
            onClick={() => setActiveView('wr-chat')}
            title="WR Chat (in dashboard)"
          >
            WR Chat
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
          <div
            className="app-header__wr-watchdog"
            style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginLeft: 6 }}
            title="WR Chat: Scam Watchdog & optimizer triggers"
          >
            <WrMultiTriggerBar
              theme={extensionTheme}
              onWatchdogAlert={(threats) => {
                try {
                  window.dispatchEvent(new CustomEvent('wrchat-watchdog-alert', { detail: threats }))
                } catch {
                  /* noop */
                }
              }}
              onEnsureWrChatOpen={ensureWrChatOpenThen}
            />
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
              onEmailAccountsChanged={loadEmailAccounts}
              selectedMessageId={selectedMessageId}
              onSelectMessage={(id) => {
                setSelectedMessageId(id)
                if (!id) setSelectedAttachmentId(null)
              }}
              selectedAttachmentId={selectedAttachmentId}
              onSelectAttachment={setSelectedAttachmentId}
              onNavigateToHandshake={handleNavigateToHandshakeFromInbox}
            />
          ) : (
            <EmailInboxView
              accounts={emailAccounts}
              onEmailAccountsChanged={loadEmailAccounts}
              selectedMessageId={selectedMessageId}
              onSelectMessage={(id) => {
                setSelectedMessageId(id)
                if (!id) setSelectedAttachmentId(null)
              }}
              selectedAttachmentId={selectedAttachmentId}
              onSelectAttachment={setSelectedAttachmentId}
              onNavigateToHandshake={handleNavigateToHandshakeFromInbox}
            />
          )
        ) : activeView === 'settings' ? (
          <SettingsView />
        ) : activeView === 'wr-chat' ? (
          <WrChatDashboardPanel extensionTheme={extensionTheme} />
        ) : (
          <AnalysisCanvas 
            deepLinkPayload={deepLinkPayload ?? undefined}
            onDeepLinkConsumed={handleDeepLinkConsumed}
            onOpenInboxMessage={handleOpenInboxMessageFromDashboard}
            onOpenInbox={handleOpenInboxFromAnalysis}
            emailAccounts={emailAccounts}
            onOpenBulkInboxForAnalysis={() => {
              setActiveView('beap-inbox')
              setInboxBulkMode(true)
            }}
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
        {/* === TEMPORARY DEBUG LOG VIEWER (remove before production) === */}
        <DebugLogViewer />
        {/* === END TEMPORARY DEBUG LOG VIEWER === */}
      </main>
      <AddModeWizardHost theme={extensionTheme} />
    </div>
  )
}

export default App
