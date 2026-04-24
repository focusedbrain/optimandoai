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
import {
  WrMultiTriggerBar,
  AddModeWizardHost,
  WRDESK_OPEN_PROJECT_ASSISTANT_CREATION,
  WRDESK_TRIGGER_SYNC_AUTO_OPTIMIZER_PROJECT,
} from '@ext/ui/components'
import type { TriggerFunctionId } from '@ext/types/triggerTypes'
import { useEmailInboxStore, type InboxFilter } from './stores/useEmailInboxStore'
import { subscribeInboxNewMessagesBackgroundRefresh } from './utils/inboxNewMessagesBackgroundRefresh'
import { registerWrDeskOptimizerHttpBridge } from './lib/wrDeskOptimizerHttpBridge'
import { ensureWrdeskChromeShim } from './shims/wrChatDashboardChrome'
import {
  WRDESK_AUTO_OPTIM_ACTIVATE_SESSIONS,
  WRDESK_OPTIMIZATION_GUARD_TOAST,
} from './lib/wrdeskUiEvents'
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

function WRCodeLogo({ size = 220, decorative = false }: { size?: number; decorative?: boolean }) {
  // Respect Vite base ('./') so packaged Electron (file://) resolves like dev server
  const logoSrc = `${import.meta.env.BASE_URL}wrdesk-logo.png`
  return (
    <img
      src={logoSrc}
      alt={decorative ? '' : 'WR Desk'}
      aria-hidden={decorative ? true : undefined}
      style={{
        width: size,
        height: 'auto',
        objectFit: 'contain',
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
  const [optimizationGuardToast, setOptimizationGuardToast] = useState<{
    message: string
    variant: 'info' | 'warning'
  } | null>(null)
  const [deepLinkPayload, setDeepLinkPayload] = useState<AnalysisOpenPayload | null>(null)
  const [activeView, setActiveView] = useState<DashboardView>('analysis')
  /** Bumps when + Add Project WIKI should open Analysis create (modal in ProjectOptimizationPanel). */
  const [projectAssistantCreateToken, setProjectAssistantCreateToken] = useState(0)
  /** Mirrors WrMultiTriggerBar selection — Analysis closes Project WIKI hero when Watchdog is selected. */
  const [activeTriggerFunctionId, setActiveTriggerFunctionId] = useState<TriggerFunctionId>({ type: 'watchdog' })
  /** Inline Email/BEAP composer on Analysis dashboard — set from hero cards or trigger bar shortcut. */
  const [dashboardComposeMode, setDashboardComposeMode] = useState<'email' | 'beap' | 'letter' | null>(
    null,
  )
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
  /** Install before any embedded @ext UI (e.g. Add Automation wizard) calls `chrome.runtime.sendMessage`. */
  useEffect(() => {
    ensureWrdeskChromeShim()
  }, [])

  useEffect(() => {
    const onProjectAssistantCreate = () => {
      setActiveView('analysis')
      setProjectAssistantCreateToken((n) => n + 1)
    }
    window.addEventListener(WRDESK_OPEN_PROJECT_ASSISTANT_CREATION, onProjectAssistantCreate)
    return () => window.removeEventListener(WRDESK_OPEN_PROJECT_ASSISTANT_CREATION, onProjectAssistantCreate)
  }, [])

  /** Keep App trigger state in sync when Analysis opens a project from the home list (same tick as dashboard). */
  useEffect(() => {
    const onSync = (ev: Event) => {
      const pid = (ev as CustomEvent<{ projectId?: string }>).detail?.projectId
      if (typeof pid !== 'string' || !pid.trim()) return
      setActiveTriggerFunctionId({ type: 'auto-optimizer', projectId: pid.trim() })
    }
    window.addEventListener(WRDESK_TRIGGER_SYNC_AUTO_OPTIMIZER_PROJECT, onSync)
    return () => window.removeEventListener(WRDESK_TRIGGER_SYNC_AUTO_OPTIMIZER_PROJECT, onSync)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const cssTheme = mapThemeToCss(extensionTheme)
    root.setAttribute('data-ui-theme', cssTheme)
    console.log('[APP] Theme applied:', extensionTheme, '-> CSS:', cssTheme)
  }, [extensionTheme])

  useEffect(() => {
    if (activeView !== 'analysis') setDashboardComposeMode(null)
  }, [activeView])

  /** HTTP bridge for extension → POST /api/projects/:id/optimize/* (main process → renderer). */
  useEffect(() => {
    registerWrDeskOptimizerHttpBridge()
  }, [])

  /**
   * PQ KEM HTTP (`POST /api/crypto/pq/mlkem768/*`) requires `X-Launch-Secret`. The real extension
   * sets headers via `initBeapPqAuth` → `BEAP_GET_PQ_HEADERS`. The dashboard installs a chrome shim
   * with `sendMessage` but no MV3 `runtime.id`; the old guard `if (sendMessage) return` skipped this
   * registration, so `_getPqHeaders()` was always {} and encapsulate returned 401.
   * Only skip when `chrome.runtime.id` is set (actual extension context).
   */
  useEffect(() => {
    const rt = typeof globalThis !== 'undefined'
      ? (globalThis as unknown as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime
      : undefined
    if (rt?.id) return
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

  useEffect(() => {
    const onToast = (ev: Event) => {
      const d = (ev as CustomEvent<{ message?: string; variant?: 'info' | 'warning' }>).detail
      const msg = typeof d?.message === 'string' ? d.message : ''
      if (!msg.trim()) return
      setOptimizationGuardToast({
        message: msg,
        variant: d?.variant === 'warning' ? 'warning' : 'info',
      })
      window.setTimeout(() => setOptimizationGuardToast(null), 4500)
    }
    window.addEventListener(WRDESK_OPTIMIZATION_GUARD_TOAST, onToast)
    return () => window.removeEventListener(WRDESK_OPTIMIZATION_GUARD_TOAST, onToast)
  }, [])

  /** Auto-optimization: sync orchestrator session keys only. Does not switch views — Analysis stays primary; WR Chat opens only via the speech-bubble control. */
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ sessionIds?: string[]; runId?: string }>
      const ids = (ce.detail?.sessionIds ?? []).filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      )
      if (ids.length === 0) return
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

  const handleOpenHandshakesViewFromInbox = useCallback(() => {
    setActiveView('handshakes')
    setSelectedHandshakeId(null)
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

  /** Open the main dashboard view (logo home, deep links, composer shortcuts). */
  const goToDashboard = useCallback(() => {
    setActiveView('analysis')
  }, [])

  return (
    <div className="app-root">
      {optimizationGuardToast && (
        <div
          role="status"
          style={{
            position: 'fixed',
            top: 12,
            right: 16,
            zIndex: 99999,
            maxWidth: 360,
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            background: optimizationGuardToast.variant === 'warning' ? 'rgba(254, 243, 199, 0.98)' : 'rgba(224, 231, 255, 0.98)',
            color: optimizationGuardToast.variant === 'warning' ? '#92400e' : '#1e3a8a',
          }}
        >
          {optimizationGuardToast.message}
        </div>
      )}
      <header className="app-header">
        <div className="app-header__brand">
          <button
            type="button"
            className={`app-header__logo-home${activeView === 'analysis' ? ' app-header__logo-home--active' : ''}`}
            onClick={goToDashboard}
            aria-label="Dashboard"
            title="Dashboard"
          >
            <WRCodeLogo size={110} decorative />
          </button>
        </div>
        <nav className="app-header__nav">
          {/* Dashboard via logo only. WR Chat: WrMultiTriggerBar speech bubble switches to wr-chat — no nav tab. */}
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
            title="Automation launcher: Scam Watchdog or a Project WIKI row — 💬 opens WR Chat focus for the selected row"
          >
            <WrMultiTriggerBar
              theme={extensionTheme}
              onActiveFunctionChange={setActiveTriggerFunctionId}
              onComposerOpen={(composerId) => {
                if (composerId === 'documentActions') {
                  setActiveView('beap-inbox')
                  setInboxBulkMode(true)
                  return
                }
                if (composerId === 'smartSummary') {
                  setActiveView('wr-chat')
                  return
                }
                goToDashboard()
                if (composerId === 'emailComposer') setDashboardComposeMode('email')
                else if (composerId === 'beapComposer') setDashboardComposeMode('beap')
                else if (composerId === 'letterComposer') setDashboardComposeMode('letter')
              }}
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
        {/* HybridSearch stays in the header for every main view; inline composers render only inside AnalysisCanvas. */}
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
              onOpenHandshakesView={handleOpenHandshakesViewFromInbox}
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
              onOpenHandshakesView={handleOpenHandshakesViewFromInbox}
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
            activeTriggerFunctionId={activeTriggerFunctionId}
            projectAssistantCreateToken={projectAssistantCreateToken}
            dashboardComposeMode={dashboardComposeMode}
            onDashboardComposeModeChange={setDashboardComposeMode}
            onNavigateToWrChat={() => setActiveView('wr-chat')}
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
