/**
 * Popup Chat Entry Point
 * 
 * React entry for the Command Chat popup window.
 * Uses shared components from the UI library.
 * 
 * AUTH-GATED UI:
 * - When NOT logged in: shows ONLY WRDesk logo + Sign In + Create Account
 * - When logged in: shows full dashboard UI
 * 
 * MIRRORS the docked sidepanel structure exactly:
 * - dockedWorkspace: 'wr-chat' | 'augmented-overlay' | 'beap-messages' | 'wrguard'
 * - dockedSubmode: WR Chat submodes
 * - beapSubmode: BEAP Messages views
 */

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { useUIStore } from './stores/useUIStore'
import { 
  CommandChatView,
  P2PChatPlaceholder,
  P2PStreamPlaceholder,
  GroupChatPlaceholder
} from './ui/components'
import { WRGuardWorkspace, useWRGuardStore } from './wrguard'
import { formatFingerprintShort } from './handshake/fingerprint'
import { HandshakeManagementPanel } from './handshake/components/HandshakeManagementPanel'
import { HandshakeRequestForm } from './handshake/components/HandshakeRequestForm'
import { SendHandshakeDelivery } from './handshake/components/SendHandshakeDelivery'
import { useHandshakes } from './handshake/useHandshakes'
import { sendViaHandshakeRefresh } from './beap-builder/handshakeRefresh'
import { RecipientModeSwitch, RecipientHandshakeSelect, DeliveryMethodPanel, executeDeliveryAction, initBeapPqAuth } from './beap-messages'
import { useBeapInboxStore } from './beap-messages/useBeapInboxStore'
import type { RecipientMode, SelectedHandshakeRecipient, SelectedRecipient, DeliveryMethod, BeapPackageConfig } from './beap-messages'
import {
  getOurIdentity,
  type OurIdentity
} from './handshake/handshakeService'
import { runDraftAttachmentParseWithFallback } from './beap-builder'
import { BeapDocumentReaderModal, AttachmentStatusBadge } from './beap-builder/components'
import type { CapsuleAttachment, RasterProof, RasterPageData } from './beap-builder'
import { electronRpc } from './rpc/electronRpc'
import { getVaultStatus } from './vault/api'
import { P2pOutboundDebugModal } from './components/P2pOutboundDebugModal'
import type { OutboundRequestDebugSnapshot } from './handshake/handshakeRpc'
import { ConnectEmailLaunchSource, useConnectEmailFlow } from './shared/email/connectEmailFlow'
import { pickDefaultEmailAccountRowId } from './shared/email/pickDefaultAccountRow'

// =============================================================================
// Theme Type - Matches docked version
// =============================================================================

type Theme = 'pro' | 'dark' | 'standard'

function toBeapTheme(t: Theme): 'pro' | 'standard' | 'hacker' {
  return t === 'dark' ? 'hacker' : t
}

function toPlaceholderTheme(t: Theme): 'default' | 'dark' | 'professional' {
  if (t === 'pro') return 'professional'
  if (t === 'standard') return 'default'
  return 'dark'
}

// Workspace types - MIRRORS docked sidepanel exactly
type DockedWorkspace = 'wr-chat' | 'augmented-overlay' | 'beap-messages' | 'wrguard' | 'email-compose'
type DockedSubmode = 'command' | 'p2p-chat' | 'p2p-stream' | 'group-stream' | 'handshake'
type BeapSubmode = 'inbox' | 'bulk-inbox' | 'draft' | 'outbox' | 'archived' | 'rejected'

// Enhanced type for draft attachments with parsing/rasterization state
type DraftAttachment = {
  id: string
  name: string
  mime: string
  size: number
  dataBase64: string
  // CapsuleAttachment for builder integration
  capsuleAttachment: CapsuleAttachment
  // Processing state
  processing: {
    parsing: boolean
    rasterizing: boolean
    error?: string
  }
  // Raster page data (base64 images) - kept separate from CapsuleAttachment
  rasterPageData?: RasterPageData[]
}

// UI-only type for session options in Draft Email
type SessionOption = {
  key: string
  name: string
  timestamp: string
}

// Get initial theme from window (set by inline script in HTML)
const getInitialTheme = (): Theme => {
  const t = (window as any).__INITIAL_THEME__
  if (t === 'pro' || t === 'default') return 'pro'
  if (t === 'dark') return 'dark'
  // 'standard' and 'professional' both map to light theme
  return 'standard'
}

// =============================================================================
// Main App Component
// =============================================================================

// =============================================================================
// Auth Status Response Type
// =============================================================================
interface AuthStatusResponse {
  loggedIn: boolean;
  displayName?: string;
  email?: string;
  initials?: string;
  picture?: string;
  tier?: string;
}

function PopupChatApp() {
  const [theme] = useState<Theme>(getInitialTheme)
  const { role, setRole } = useUIStore()
  
  // ==========================================================================
  // AUTH-GATED UI STATE
  // ==========================================================================
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)  // null = loading
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [electronNotRunning, setElectronNotRunning] = useState(false)
  const [platformOs, setPlatformOs] = useState<'linux' | 'mac' | 'win' | null>(null)
  const [isLaunchingElectron, setIsLaunchingElectron] = useState(false)
  const [userInfo, setUserInfo] = useState<{ displayName?: string; email?: string; initials?: string; picture?: string }>({})
  const [userTier, setUserTier] = useState<string>('free')
  const [pictureError, setPictureError] = useState(false)
  const [canUseHsContextProfiles, setCanUseHsContextProfiles] = useState(false)

  // Init BEAP PQ auth so qBEAP can reach Electron PQ API (port 51248)
  useEffect(() => {
    initBeapPqAuth()
  }, [])

  // Fetch vault status for HS Context gating (Publisher+ only)
  useEffect(() => {
    if (!isLoggedIn) return
    const fetchVault = async () => {
      try {
        const status = await getVaultStatus()
        setCanUseHsContextProfiles(status?.canUseHsContextProfiles ?? false)
      } catch {
        setCanUseHsContextProfiles(false)
      }
    }
    fetchVault()
    const h = () => fetchVault()
    window.addEventListener('vault-status-changed', h)
    return () => window.removeEventListener('vault-status-changed', h)
  }, [isLoggedIn])

  // Check auth status on mount
  useEffect(() => {
    const checkAuthStatus = () => {
      chrome.runtime.sendMessage({ type: 'AUTH_STATUS' }, (response: AuthStatusResponse | undefined) => {
        if (chrome.runtime.lastError) {
          console.warn('[AUTH] Status check failed:', chrome.runtime.lastError.message);
          setIsLoggedIn(false);
          return;
        }
        if (response?.loggedIn) {
          setIsLoggedIn(true);
          setPictureError(false);
          setUserInfo({
            displayName: response.displayName,
            email: response.email,
            initials: response.initials,
            picture: response.picture,
          });
          setUserTier(response.tier || 'free');
        } else {
          setIsLoggedIn(false);
          setUserInfo({});
          setUserTier('free');
        }
      });
    };

    checkAuthStatus();
    // Refresh auth status every 30 seconds
    const interval = setInterval(checkAuthStatus, 30000);
    return () => clearInterval(interval);
  }, []);
  
  // Platform detection for Linux vs Windows copy and Start Desktop App button
  useEffect(() => {
    chrome.runtime.getPlatformInfo?.().then((info) => {
      setPlatformOs(info.os as 'linux' | 'mac' | 'win')
    }).catch(() => setPlatformOs(null))
  }, [])

  const [launchTimedOut, setLaunchTimedOut] = useState(false)
  
  const checkConnection = (): Promise<boolean> => {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (r: { data?: { isConnected?: boolean } }) => {
        resolve(r?.data?.isConnected ?? false)
      })
    })
  }
  
  // Launch Electron app (protocol launch disabled - caused xdg-open dialog on Linux)
  const launchElectronApp = async () => {
    setIsLaunchingElectron(true)
    setLaunchTimedOut(false)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'LAUNCH_ELECTRON_APP' })
      if (response?.success) {
        setElectronNotRunning(false)
        await new Promise(r => setTimeout(r, 2000))
        chrome.runtime.sendMessage({ type: 'GET_STATUS' })
        handleSignIn()
      } else {
        const pollInterval = 2000
        const maxWait = 30000
        const start = Date.now()
        const poll = async () => {
          if (Date.now() - start >= maxWait) {
            setLaunchTimedOut(true)
            setIsLaunchingElectron(false)
            return
          }
          const connected = await checkConnection()
          if (connected) {
            setIsLaunchingElectron(false)
            setElectronNotRunning(false)
            handleSignIn()
            return
          }
          setTimeout(poll, pollInterval)
        }
        setTimeout(poll, pollInterval)
        return
      }
    } catch (err) {
      console.error('[PopupChat] Failed to launch Electron:', err)
    }
    setIsLaunchingElectron(false)
  }

  // Open wrdesk.com when logged out (once per popup open, no tab spam)
  const hasTriedOpeningWrdeskRef = React.useRef(false);
  useEffect(() => {
    // Only trigger when isLoggedIn is definitively false (not null/loading)
    // And only once per popup open (tracked by ref)
    if (isLoggedIn === false && !hasTriedOpeningWrdeskRef.current) {
      hasTriedOpeningWrdeskRef.current = true;
      chrome.runtime.sendMessage({ type: 'OPEN_WRDESK_HOME_IF_NEEDED' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[AUTH] Failed to open wrdesk.com:', chrome.runtime.lastError.message);
        } else {
          console.log('[AUTH] Open wrdesk.com result:', response?.action);
        }
      });
    }
  }, [isLoggedIn]);
  
  // Handle Sign In click
  const handleSignIn = () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setLoginError(null);
    setElectronNotRunning(false);
    chrome.runtime.sendMessage({ type: 'AUTH_LOGIN' }, (response) => {
      setIsLoggingIn(false);
      if (response?.ok) {
        setLoginError(null);
        setIsLoggedIn(true);
        setPictureError(false);
        // Fetch updated user info
        chrome.runtime.sendMessage({ type: 'AUTH_STATUS' }, (statusResponse: AuthStatusResponse | undefined) => {
          if (statusResponse?.loggedIn) {
            setUserInfo({
              displayName: statusResponse.displayName,
              email: statusResponse.email,
              initials: statusResponse.initials,
              picture: statusResponse.picture,
            });
            setUserTier(statusResponse.tier || 'free');
          }
        });
      } else {
        const reason = response?.error || 'unknown';
        console.log('[AUTH] SSO failed. Reason:', reason);
        if (response?.electronNotRunning) {
          setElectronNotRunning(true);
          setLoginError('WR Desk Orchestrator is not running.');
          chrome.runtime.sendMessage({ type: 'OPEN_WRDESK_HOME_IF_NEEDED' });
        } else {
          setElectronNotRunning(false);
          setLoginError(reason);
        }
      }
    });
  };
  
  // Handle Create Account click - opens wrdesk.com/register and highlights form
  const handleCreateAccount = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_REGISTER_PAGE' });
  };
  
  // MIRRORS docked sidepanel state exactly
  const [dockedWorkspace, setDockedWorkspace] = useState<DockedWorkspace>('wr-chat')
  const [dockedSubmode, setDockedSubmode] = useState<DockedSubmode>('command')

  // Sync useUIStore so CommandChatView gets correct mode (commands = show model selector)
  useEffect(() => {
    if (dockedWorkspace === 'wr-chat' && dockedSubmode === 'command') {
      useUIStore.getState().setWorkspace('wr-chat')
      useUIStore.getState().setMode('commands')
    }
  }, [dockedWorkspace, dockedSubmode])
  const [hsPolicy, setHsPolicy] = useState<{ ai_processing_mode: 'none' | 'local_only' | 'internal_and_cloud' }>({ ai_processing_mode: 'local_only' })
  const [beapSubmode, setBeapSubmode] = useState<BeapSubmode>('inbox')

  // Command Chat model state (popup — same as sidepanel)
  const [availableModels, setAvailableModels] = useState<Array<{ name: string; size?: string }>>([])
  const [activeLlmModel, setActiveLlmModel] = useState<string>('')
  const activeLlmModelRef = useRef<string>('')
  
  // Handle launchMode and deep-link query parameters (R.8)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const launchMode = params.get('launchMode')
    const messageId = params.get('message')
    const handshakeId = params.get('handshake')
    if (messageId) {
      setDockedWorkspace('beap-messages')
      setBeapSubmode('inbox')
      useBeapInboxStore.getState().selectMessage(messageId)
    } else if (handshakeId) {
      setDockedWorkspace('wrguard')
      useWRGuardStore.getState().setActiveSection('handshakes')
    } else if (launchMode === 'dashboard-beap') {
      setDockedWorkspace('beap-messages')
      setBeapSubmode('inbox')
    } else if (launchMode === 'dashboard-beap-draft') {
      setDockedWorkspace('beap-messages')
      setBeapSubmode('draft')
    } else if (launchMode === 'dashboard-email-compose') {
      setDockedWorkspace('email-compose')
    } else if (launchMode === 'dashboard-handshake-request') {
      setDockedWorkspace('wr-chat')
      setDockedSubmode('handshake')
    }
  }, []) // Only run on mount
  
  // Helper to get combined mode for conditional rendering - SAME as docked
  const dockedPanelMode = dockedWorkspace === 'wr-chat' ? dockedSubmode : dockedWorkspace
  
  // ==========================================================================
  // Identity (for fingerprint display)
  // ==========================================================================

  const [identity, setIdentity] = useState<OurIdentity | null>(null)
  const [identityLoading, setIdentityLoading] = useState(true)

  // Load identity on mount
  useEffect(() => {
    let mounted = true
    setIdentityLoading(true)
    getOurIdentity()
      .then((id) => { if (mounted) setIdentity(id) })
      .catch((err) => { console.error('[PopupChat] Failed to load identity:', err) })
      .finally(() => { if (mounted) setIdentityLoading(false) })
    return () => { mounted = false }
  }, [])

  // Derived fingerprint values
  const ourFingerprint = identity?.fingerprint || ''
  const ourFingerprintShort = identity ? formatFingerprintShort(identity.fingerprint) : '...'

  // BEAP Draft separate state (like docked version)
  const [beapDraftMessage, setBeapDraftMessage] = useState('')
  const [beapDraftEncryptedMessage, setBeapDraftEncryptedMessage] = useState('')
  const [beapDraftTo, setBeapDraftTo] = useState('')
  const [beapDraftSessionId, setBeapDraftSessionId] = useState('')
  const [beapDraftAttachments, setBeapDraftAttachments] = useState<DraftAttachment[]>([])
  const [beapDraftReaderModalId, setBeapDraftReaderModalId] = useState<string | null>(null)
  const [availableSessions, setAvailableSessions] = useState<SessionOption[]>([])
  
  // BEAP Recipient Mode state (PRIVATE=qBEAP / PUBLIC=pBEAP)
  const [beapRecipientMode, setBeapRecipientMode] = useState<RecipientMode>('private')
  const [selectedRecipient, setSelectedRecipient] = useState<SelectedRecipient | null>(null)
  const [beapDeliveryMethod, setBeapDeliveryMethod] = useState<'email' | 'download' | 'p2p'>('p2p')

  // Active handshakes for recipient selection in BEAP draft (private/qBEAP mode)
  const {
    handshakes,
    loading: handshakesLoading,
    error: handshakesError,
    refresh: refreshHandshakes,
  } = useHandshakes('active')

  // Command Chat: refresh models from backend (uses electronRpc)
  const refreshPopupModels = async () => {
    try {
      const result = await electronRpc('llm.status')
      const statusResult = result.success && result.data ? { ok: result.data?.ok ?? result.success, data: result.data?.data ?? result.data } : { ok: false, data: null }
      if (statusResult.ok && statusResult.data?.modelsInstalled?.length > 0) {
        const models = statusResult.data.modelsInstalled
        setAvailableModels(models)
        const currentModel = activeLlmModelRef.current || activeLlmModel
        const modelStillExists = models.some((m: { name: string }) => m.name === currentModel)
        if (!currentModel || !modelStillExists) {
          const gemmaModel = models.find((m: { name: string }) => m.name.toLowerCase().includes('gemma'))
          const selectedModel = gemmaModel ? gemmaModel.name : models[0].name
          setActiveLlmModel(selectedModel)
          activeLlmModelRef.current = selectedModel
        }
        return true
      }
    } catch (e) { console.error('[Popup] Failed to refresh models:', e) }
    return false
  }

  // Fetch models on mount, retry after delay if connection may not be ready
  useEffect(() => {
    const load = async () => {
      let ok = await refreshPopupModels()
      if (!ok) {
        await new Promise(r => setTimeout(r, 3000))
        await refreshPopupModels()
      }
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount

  // Load available sessions for Draft Email session selector
  // Sessions are stored in chrome.storage.local (same as Sessions History modal)
  const loadAvailableSessions = () => {
    console.log('[BEAP Sessions] Loading sessions from chrome.storage.local...')
    chrome.storage.local.get(null, (allData) => {
      if (chrome.runtime.lastError) {
        console.warn('[BEAP Sessions] Error:', chrome.runtime.lastError.message)
        setAvailableSessions([])
        return
      }
      
      // Filter for session keys (format: session_*)
      const sessionEntries = Object.entries(allData).filter(([key]) => key.startsWith('session_'))
      console.log('[BEAP Sessions] Found sessions:', sessionEntries.length)
      
      if (sessionEntries.length === 0) {
        setAvailableSessions([])
        return
      }
      
      const sessions: SessionOption[] = sessionEntries
        .map(([key, data]: [string, any]) => {
          const name = data?.tabName || data?.name || data?.sessionName || key
          const timestamp = data?.timestamp || data?.lastOpenedAt || data?.createdAt || ''
          return { key, name, timestamp }
        })
        .filter(s => s.key)
        .sort((a, b) => {
          const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0
          const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0
          return timeB - timeA
        })
      
      console.log('[BEAP Sessions] Parsed sessions:', sessions)
      setAvailableSessions(sessions)
    })
  }
  
  // Load sessions on mount
  useEffect(() => {
    loadAvailableSessions()
  }, [])
  
  // Refresh sessions when window gets focus
  useEffect(() => {
    const handleFocus = () => loadAvailableSessions()
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [])
  
  // Clear encrypted message when switching from private to public mode
  useEffect(() => {
    if (beapRecipientMode === 'public') {
      setBeapDraftEncryptedMessage('')
    }
  }, [beapRecipientMode])
  
  // =========================================================================
  // Email Account State (mirrors sidepanel exactly)
  // =========================================================================
  interface EmailAccountPopup {
    id: string
    displayName: string
    email: string
    provider: 'gmail' | 'microsoft365' | 'imap'
    status: 'active' | 'error' | 'disabled'
    processingPaused?: boolean
    lastError?: string
  }
  
  const [emailAccounts, setEmailAccounts] = useState<EmailAccountPopup[]>([])
  const defaultEmailAccountRowId = useMemo(
    () => pickDefaultEmailAccountRowId(emailAccounts),
    [emailAccounts],
  )
  const [isLoadingEmailAccounts, setIsLoadingEmailAccounts] = useState(false)
  const [selectedEmailAccountId, setSelectedEmailAccountId] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<{
    message: string
    type: 'success' | 'error' | 'info'
    p2pOutboundDebug?: OutboundRequestDebugSnapshot
  } | null>(null)
  const [p2pOutboundDebugModal, setP2pOutboundDebugModal] = useState<OutboundRequestDebugSnapshot | null>(null)
  const [isSendingBeap, setIsSendingBeap] = useState(false)
  /** P2P queue backoff: block Send until this time */
  const [beapP2pCooldownUntilMs, setBeapP2pCooldownUntilMs] = useState<number | null>(null)
  
  // Load email accounts from Electron via background script
  const loadEmailAccounts = async () => {
    setIsLoadingEmailAccounts(true)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EMAIL_LIST_ACCOUNTS' })
      if (response?.ok && response?.data) {
        setEmailAccounts(response.data)
        if (response.data.length > 0 && !selectedEmailAccountId) {
          setSelectedEmailAccountId(
            pickDefaultEmailAccountRowId(response.data) ?? response.data[0].id,
          )
        }
      }
    } catch (error) {
      console.error('[PopupChat] Failed to load email accounts:', error)
    } finally {
      setIsLoadingEmailAccounts(false)
    }
  }

  const { openConnectEmail, connectEmailFlowModal } = useConnectEmailFlow({
    onAfterConnected: loadEmailAccounts,
    theme: theme === 'standard' ? 'professional' : 'default',
  })
  
  // Load email accounts on mount
  useEffect(() => {
    loadEmailAccounts()
  }, [])
  
  // Reload email accounts when switching to relevant workspaces
  useEffect(() => {
    if (dockedWorkspace === 'beap-messages' || dockedWorkspace === 'wrguard' || dockedWorkspace === 'email-compose') {
      loadEmailAccounts()
    }
  }, [dockedWorkspace])
  
  // Disconnect email account handler
  const disconnectEmailAccount = async (accountId: string) => {
    try {
      const response = await chrome.runtime.sendMessage({ 
        type: 'EMAIL_DELETE_ACCOUNT',
        accountId
      })
      if (response?.ok) {
        loadEmailAccounts() // Reload to ensure sync with backend
        setToastMessage({ message: 'Email account disconnected', type: 'success' })
        setTimeout(() => setToastMessage(null), 3000)
      }
    } catch (error) {
      console.error('[PopupChat] Failed to disconnect email account:', error)
    }
  }

  const setAccountProcessingPaused = async (accountId: string, paused: boolean) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EMAIL_SET_PROCESSING_PAUSED',
        accountId,
        paused,
      })
      if (response?.ok) {
        await loadEmailAccounts()
        setToastMessage({ message: paused ? 'Sync paused' : 'Sync resumed', type: 'success' })
        setTimeout(() => setToastMessage(null), 2500)
      } else {
        setToastMessage({ message: String(response?.error ?? 'Could not update account'), type: 'error' })
        setTimeout(() => setToastMessage(null), 4000)
      }
    } catch (error) {
      console.error('[PopupChat] Failed to set processing paused:', error)
      setToastMessage({ message: 'Could not update account', type: 'error' })
      setTimeout(() => setToastMessage(null), 4000)
    }
  }
  
  // Connect email handler - opens the shared connect-email flow
  const handleConnectEmail = () => {
    openConnectEmail(ConnectEmailLaunchSource.WrChatPopup)
  }
  
  // Handler for sending BEAP messages (matches docked sidepanel exactly)
  const handleSendBeapMessage = async () => {
    // Validate preconditions
    if (beapRecipientMode === 'private' && !selectedRecipient) {
      setToastMessage({ message: 'Please select a handshake recipient', type: 'error' })
      setTimeout(() => setToastMessage(null), 3000)
      return
    }
    
    if (!beapDraftMessage.trim()) {
      setToastMessage({
        message: 'BEAP™ Message (required): enter the public capsule text before sending.',
        type: 'error',
      })
      setTimeout(() => setToastMessage(null), 5000)
      return
    }

    const useHandshakeRefresh =
      beapDeliveryMethod === 'email' &&
      beapRecipientMode === 'private' &&
      selectedRecipient &&
      'handshake_id' in selectedRecipient

    if (useHandshakeRefresh && beapDraftAttachments.length > 0) {
      setToastMessage({
        message:
          'Attachments cannot be sent via handshake refresh. Remove attachments or use standard BEAP delivery (P2P, download, or email with full package).',
        type: 'error',
      })
      setTimeout(() => setToastMessage(null), 5000)
      return
    }

    const unparsedPdfs = beapDraftAttachments.filter(
      (a) =>
        (a.mime?.toLowerCase() === 'application/pdf' ||
          a.name?.toLowerCase().endsWith('.pdf')) &&
        !a.capsuleAttachment?.semanticExtracted,
    )
    if (unparsedPdfs.length > 0) {
      const proceed = window.confirm(
        `${unparsedPdfs.length} PDF attachment(s) have not been parsed. ` +
          'The recipient will not see extracted text in the capsule.\n\n' +
          'Click OK to send anyway, or Cancel to go back and parse first.',
      )
      if (!proceed) return
    }

    setIsSendingBeap(true)
    let toastClearMs = 3000

    try {
      // Download/messenger: always use package builder + executeDeliveryAction (never handshake.refresh)
      // Email + private: use handshake.refresh RPC for direct delivery
      if (useHandshakeRefresh) {
        const hsId = (selectedRecipient as any).handshake_id as string
        const accountId = selectedEmailAccountId || 'default'
        
        const result = await sendViaHandshakeRefresh(hsId, { text: beapDraftMessage }, accountId)
        
        if (result.success) {
          setToastMessage({ message: 'BEAP™ Message sent via handshake!', type: 'success' })
          setBeapDraftTo('')
          setBeapDraftMessage('')
          setBeapDraftEncryptedMessage('')
          setBeapDraftSessionId('')
          setBeapDraftReaderModalId(null)
          setBeapDraftAttachments([])
          setSelectedRecipient(null)
        } else {
          setToastMessage({ message: result.error || 'Failed to send message', type: 'error' })
        }
        return
      }

      // Legacy path: use the package builder + delivery service
      // Extract CapsuleAttachment objects from draft attachments
      const capsuleAttachments = beapDraftAttachments.map(a => a.capsuleAttachment)
      // Collect original file bytes for archival (per canon A.3.043)
      // These will be encrypted as "original" class artefacts
      const originalFiles: BeapPackageConfig['originalFiles'] = beapDraftAttachments.map(att => ({
        attachmentId: att.id,
        filename: att.name,
        mime: att.mime,
        base64: att.dataBase64
      }))
      const config: BeapPackageConfig = {
        recipientMode: beapRecipientMode,
        deliveryMethod: beapDeliveryMethod as DeliveryMethod,
        selectedRecipient,
        senderFingerprint: ourFingerprint,
        senderFingerprintShort: ourFingerprintShort,
        emailTo: beapDraftTo,
        subject: 'BEAP™ Message',
        messageBody: beapDraftMessage,
        attachments: capsuleAttachments,
        // Original file bytes for archival (encrypted as "original" artefacts per canon A.3.043)
        originalFiles: originalFiles.length > 0 ? originalFiles : undefined,
        // Only pass encrypted message for qBEAP/private mode
        ...(beapRecipientMode === 'private' && {
          encryptedMessage: beapDraftEncryptedMessage.trim() || undefined
        })
      }
      
      // Log warning if qBEAP private build without encrypted message
      if (beapRecipientMode === 'private' && !beapDraftEncryptedMessage.trim()) {
        console.warn('[BEAP Builder] qBEAP private build without encryptedMessage: using transport plaintext only')
      }
      
      // Execute the delivery action
      const result = await executeDeliveryAction(config)
      
      if (result.success) {
        setBeapP2pCooldownUntilMs(null)
        // Show success notification based on delivery method
        const actionLabel = beapDeliveryMethod === 'download' ? 'BEAP capsule downloaded' 
          : beapDeliveryMethod === 'p2p' ? 'BEAP™ Message sent via P2P!' 
          : 'BEAP™ Message sent!'
        setToastMessage({ message: actionLabel, type: 'success' })
        
        // Clear form
        setBeapDraftTo('')
        setBeapDraftMessage('')
        setBeapDraftEncryptedMessage('')
        setBeapDraftSessionId('')
        setBeapDraftReaderModalId(null)
        setBeapDraftAttachments([])
        setSelectedRecipient(null)
      } else {
        if (result.code === 'REQUEST_INVALID') {
          setBeapP2pCooldownUntilMs(null)
        } else if (beapDeliveryMethod === 'p2p' && typeof result.p2pCooldownUntilMs === 'number') {
          setBeapP2pCooldownUntilMs(result.p2pCooldownUntilMs)
          const delay = Math.max(0, result.p2pCooldownUntilMs - Date.now())
          window.setTimeout(() => setBeapP2pCooldownUntilMs(null), delay + 250)
        }
        const isBackoff =
          result.code === 'BACKOFF_WAIT' ||
          (result.message?.includes('waiting before retry') ?? false)
        if (isBackoff) toastClearMs = 9000
        if (result.p2pOutboundDebug) toastClearMs = Math.max(toastClearMs, 12000)
        setToastMessage({
          message: result.message || 'Failed to send message',
          type: isBackoff ? 'info' : 'error',
          ...(result.p2pOutboundDebug && { p2pOutboundDebug: result.p2pOutboundDebug }),
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred'
      setToastMessage({ message, type: 'error' })
    } finally {
      setIsSendingBeap(false)
      setTimeout(() => setToastMessage(null), toastClearMs)
    }
  }
  
  // Get button label based on delivery method
  const getBeapSendButtonLabel = () => {
    if (isSendingBeap) return '⏳ Processing...'
    if (
      beapDeliveryMethod === 'p2p' &&
      beapP2pCooldownUntilMs != null &&
      Date.now() < beapP2pCooldownUntilMs
    ) {
      return '⏳ Cooldown…'
    }
    switch (beapDeliveryMethod) {
      case 'email': return '📧 Send'
      case 'p2p': return '🔗 Send'
      case 'download': return '💾 Download'
      default: return '📤 Send'
    }
  }
  
  // Check if send button should be disabled
  const isBeapSendDisabled =
    isSendingBeap ||
    !beapDraftMessage.trim() ||
    (beapRecipientMode === 'private' && !selectedRecipient) ||
    (beapDeliveryMethod === 'p2p' &&
      beapP2pCooldownUntilMs != null &&
      Date.now() < beapP2pCooldownUntilMs)
  
  
  // For debugging: toggle admin role with keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+A to toggle admin
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        setRole(role === 'admin' ? 'user' : 'admin')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [role, setRole])

  // =========================================================================
  // BEAP Messages State (mirrors docked sidepanel)
  // =========================================================================
  // NOTE: Using beapDraftMessage and beapDraftTo from above for consistency with sidepanel
  const [beapFingerprintCopied, setBeapFingerprintCopied] = useState(false)
  
  // Email compose form state (for email-compose workspace)
  const [emailComposeTo, setEmailComposeTo] = useState('')
  const [emailComposeSubject, setEmailComposeSubject] = useState('')
  const [emailComposeBody, setEmailComposeBody] = useState('')
  const [emailComposeAttachments, setEmailComposeAttachments] = useState<{ name: string; size: number; mimeType: string; contentBase64: string }[]>([])
  const [emailComposeSending, setEmailComposeSending] = useState(false)
  const [emailComposeError, setEmailComposeError] = useState<string | null>(null)
  const emailComposeFileInputRef = useRef<HTMLInputElement>(null)
  
  // =========================================================================
  // BEAP Messages Content - Mirrors docked sidepanel exactly
  // =========================================================================
  const renderBeapMessagesContent = () => {
    const isStandard = theme === 'standard'
    const isPro = theme === 'pro'
    const textColor = isStandard ? '#0f172a' : 'white'
    const mutedColor = isStandard ? '#64748b' : 'rgba(255,255,255,0.7)'
    const borderColor = isStandard ? '#e1e8ed' : (isPro ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)')
    // Match Dashboard App.css: pro uses rgba(118, 75, 162, 0.45) for bg-surface
    const bgColor = isPro ? 'rgba(118, 75, 162, 0.45)' : (isStandard ? '#f8f9fb' : 'rgba(255,255,255,0.04)')
    const inputBg = isStandard ? 'white' : (isPro ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)')
    
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: bgColor, overflowY: 'auto' }}>
        <style>{`
          .beap-input::placeholder, .beap-textarea::placeholder {
            color: ${isStandard ? '#64748b' : 'rgba(255,255,255,0.5)'};
            opacity: 1;
          }
        `}</style>
        
        {/* ========================================== */}
        {/* INBOX VIEW - Placeholder (same as docked) */}
        {/* ========================================== */}
        {beapSubmode === 'inbox' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
              <span style={{ fontSize: '48px', marginBottom: '16px' }}>📥</span>
              <div style={{ fontSize: '18px', fontWeight: '600', color: textColor, marginBottom: '8px' }}>BEAP Inbox</div>
              <div style={{ fontSize: '13px', color: mutedColor, maxWidth: '280px' }}>
                Received BEAP™ packages will appear here. All packages are verified before display.
              </div>
            </div>
            {/* FAB - New Draft Button */}
            <button
              onClick={() => setBeapSubmode('draft')}
              title="New Draft"
              style={{
                position: 'absolute',
                bottom: '20px',
                right: '20px',
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                border: 'none',
                background: theme === 'pro' ? 'rgba(255,255,255,0.9)' : theme === 'dark' ? '#3b82f6' : '#9333ea',
                color: theme === 'pro' ? '#9333ea' : 'white',
                fontSize: '24px',
                fontWeight: '300',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform 0.15s, box-shadow 0.15s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.08)'
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.25)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'
              }}
            >
              +
            </button>
          </div>
        )}
        
        {/* ========================================== */}
        {/* BULK INBOX VIEW - Placeholder (same as docked) */}
        {/* ========================================== */}
        {beapSubmode === 'bulk-inbox' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
            <span style={{ fontSize: '48px', marginBottom: '16px' }}>⚡</span>
            <div style={{ fontSize: '18px', fontWeight: '600', color: textColor, marginBottom: '8px' }}>Bulk Inbox</div>
            <div style={{ fontSize: '13px', color: mutedColor, maxWidth: '280px' }}>
              Open the side panel for full bulk inbox experience.
            </div>
          </div>
        )}
        
        {/* ========================================== */}
        {/* OUTBOX VIEW - Placeholder (same as docked) */}
        {/* ========================================== */}
        {beapSubmode === 'outbox' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
            <span style={{ fontSize: '48px', marginBottom: '16px' }}>📤</span>
            <div style={{ fontSize: '18px', fontWeight: '600', color: textColor, marginBottom: '8px' }}>BEAP Outbox</div>
            <div style={{ fontSize: '13px', color: mutedColor, maxWidth: '280px' }}>
              Packages pending delivery. Monitor send status and delivery confirmations.
            </div>
          </div>
        )}
        
        {/* ========================================== */}
        {/* ARCHIVED VIEW - Placeholder (same as docked) */}
        {/* ========================================== */}
        {beapSubmode === 'archived' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
            <span style={{ fontSize: '48px', marginBottom: '16px' }}>📁</span>
            <div style={{ fontSize: '18px', fontWeight: '600', color: textColor, marginBottom: '8px' }}>Archived Packages</div>
            <div style={{ fontSize: '13px', color: mutedColor, maxWidth: '280px' }}>
              Successfully executed packages are archived here for reference.
            </div>
          </div>
        )}
        
        {/* ========================================== */}
        {/* REJECTED VIEW - Placeholder (same as docked) */}
        {/* ========================================== */}
        {beapSubmode === 'rejected' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
            <span style={{ fontSize: '48px', marginBottom: '16px' }}>🚫</span>
            <div style={{ fontSize: '18px', fontWeight: '600', color: textColor, marginBottom: '8px' }}>Rejected Packages</div>
            <div style={{ fontSize: '13px', color: mutedColor, maxWidth: '280px' }}>
              Rejected packages that failed verification or were declined by the user.
            </div>
          </div>
        )}
        
        {/* ========================================== */}
        {/* DRAFT VIEW - Full Compose UI (same as docked) */}
        {/* ========================================== */}
        {beapSubmode === 'draft' && (
          <>
            {/* DELIVERY METHOD - FIRST */}
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${borderColor}` }}>
              <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: mutedColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Delivery Method
              </label>
              <select
                value={beapDeliveryMethod}
                onChange={(e) => setBeapDeliveryMethod(e.target.value as 'email' | 'download' | 'p2p')}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: isStandard ? 'white' : '#1f2937',
                  border: `1px solid ${isStandard ? '#e1e8ed' : 'rgba(255,255,255,0.15)'}`,
                  borderRadius: '8px',
                  color: textColor,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                <option value="email" style={{ background: isStandard ? 'white' : '#1f2937', color: isStandard ? '#1f2937' : 'white' }}>📧 Email</option>
                <option value="p2p" style={{ background: isStandard ? 'white' : '#1f2937', color: isStandard ? '#1f2937' : 'white' }}>🔗 P2P</option>
                <option value="download" style={{ background: isStandard ? 'white' : '#1f2937', color: isStandard ? '#1f2937' : 'white' }}>💾 Download (USB/Wallet)</option>
              </select>
            </div>
            
            {/* Email Accounts Section - Only visible when email delivery selected */}
            {beapDeliveryMethod === 'email' && (
            <div style={{ 
              padding: '16px 18px', 
              borderBottom: `1px solid ${borderColor}`,
              background: isStandard ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.1)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px' }}>🔗</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: textColor }}>Connected Email Accounts</span>
                </div>
                <button
                  type="button"
                  onClick={handleConnectEmail}
                  style={{
                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                    border: 'none',
                    color: 'white',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '11px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <span>+</span> Connect Email
                </button>
              </div>
              
              {isLoadingEmailAccounts ? (
                <div style={{ padding: '12px', textAlign: 'center', opacity: 0.6, fontSize: '12px' }}>
                  Loading accounts...
                </div>
              ) : emailAccounts.length === 0 ? (
                <div style={{ 
                  padding: '20px', 
                  background: isStandard ? 'white' : 'rgba(255,255,255,0.05)',
                  borderRadius: '8px',
                  border: isStandard ? '1px dashed rgba(15,23,42,0.2)' : '1px dashed rgba(255,255,255,0.2)',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
                  <div style={{ fontSize: '13px', color: mutedColor, marginBottom: '4px' }}>No email accounts connected</div>
                  <div style={{ fontSize: '11px', color: isStandard ? '#94a3b8' : 'rgba(255,255,255,0.5)' }}>
                    Connect your email account to send BEAP™ messages
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {emailAccounts.map(account => (
                    <div 
                      key={account.id} 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        background: isStandard ? 'white' : 'rgba(255,255,255,0.08)',
                        borderRadius: '8px',
                        border: account.status === 'active' 
                          ? (isStandard ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(34,197,94,0.4)')
                          : (isStandard ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(239,68,68,0.4)')
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '18px' }}>
                          {account.provider === 'gmail' ? '📧' : account.provider === 'microsoft365' ? '📨' : '✉️'}
                        </span>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: '500', color: textColor }}>
                            {account.email || account.displayName}
                          </div>
                          <div style={{ 
                            fontSize: '10px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '6px',
                            marginTop: '2px'
                          }}>
                            <span style={{ 
                              width: '6px', 
                              height: '6px', 
                              borderRadius: '50%', 
                              background: account.status === 'active' ? '#22c55e' : '#ef4444' 
                            }} />
                            <span style={{ color: mutedColor }}>
                              {account.status === 'active' ? 'Connected' : account.lastError || 'Error'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => disconnectEmailAccount(account.id)}
                        style={{
                          background: 'transparent',
                          border: isStandard ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(239,68,68,0.4)',
                          color: '#ef4444',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          fontSize: '10px',
                          cursor: 'pointer'
                        }}
                      >
                        Disconnect
                      </button>
                    </div>
                  ))}
                  
                  {/* Account selector dropdown when multiple accounts */}
                  {/* Send From selectbox - shows when accounts exist */}
                  {emailAccounts.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <label style={{ 
                        fontSize: '11px', 
                        fontWeight: 600, 
                        marginBottom: '6px', 
                        display: 'block', 
                        color: isStandard ? '#6b7280' : 'rgba(255,255,255,0.7)', 
                        textTransform: 'uppercase', 
                        letterSpacing: '0.5px' 
                      }}>
                        Send From:
                      </label>
                      <select
                        value={selectedEmailAccountId || defaultEmailAccountRowId || ''}
                        onChange={(e) => setSelectedEmailAccountId(e.target.value)}
                        style={{
                          width: '100%',
                          background: isStandard ? 'white' : 'rgba(255,255,255,0.1)',
                          border: isStandard ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.2)',
                          color: textColor,
                          borderRadius: '6px',
                          padding: '8px 12px',
                          fontSize: '13px',
                          cursor: 'pointer',
                          outline: 'none'
                        }}
                      >
                        {emailAccounts.map(account => (
                          <option key={account.id} value={account.id}>
                            {account.email || account.displayName} ({account.provider})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
            
            {/* BEAP™ Message Header */}
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${borderColor}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '18px' }}>📦</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: textColor }}>BEAP™ Message (required)</span>
            </div>
            
            {/* Compose Fields */}
            <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Your Fingerprint - PROMINENT */}
              <div style={{
                background: isStandard ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.15)',
                border: isStandard ? '1px solid rgba(59,130,246,0.2)' : '1px solid rgba(59,130,246,0.3)',
                borderRadius: '8px',
                padding: '12px',
              }}>
                <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: isStandard ? '#3b82f6' : '#93c5fd', marginBottom: '6px' }}>
                  Your Fingerprint
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <code style={{ 
                    flex: 1,
                    fontSize: '13px', 
                    fontFamily: 'monospace',
                    color: isStandard ? '#1e40af' : '#bfdbfe',
                    wordBreak: 'break-all'
                  }}>
                    {ourFingerprintShort}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(ourFingerprint)
                      setBeapFingerprintCopied(true)
                      setTimeout(() => setBeapFingerprintCopied(false), 2000)
                    }}
                    style={{
                      background: beapFingerprintCopied ? '#22c55e' : (isStandard ? '#3b82f6' : 'rgba(59,130,246,0.5)'),
                      border: 'none',
                      color: 'white',
                      borderRadius: '4px',
                      padding: '4px 8px',
                      fontSize: '10px',
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                  >
                    {beapFingerprintCopied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              
              {/* Recipient Mode Switch (PRIVATE/PUBLIC) */}
              <RecipientModeSwitch
                mode={beapRecipientMode}
                onModeChange={setBeapRecipientMode}
                theme={toBeapTheme(theme)}
              />
              
              {/* Handshake Recipient Select (only in PRIVATE mode) */}
              {beapRecipientMode === 'private' && (
                <RecipientHandshakeSelect
                  handshakes={handshakes}
                  selectedHandshakeId={selectedRecipient?.handshake_id || null}
                  onSelect={setSelectedRecipient}
                  theme={toBeapTheme(theme)}
                  isLoading={handshakesLoading}
                  fetchError={handshakesError}
                  onRetry={refreshHandshakes}
                />
              )}
              
              {/* Delivery Method Panel - Adapts to recipient mode */}
              <DeliveryMethodPanel
                deliveryMethod={beapDeliveryMethod}
                recipientMode={beapRecipientMode}
                selectedRecipient={selectedRecipient}
                emailTo={beapDraftTo}
                onEmailToChange={setBeapDraftTo}
                theme={toBeapTheme(theme)}
                ourFingerprintShort={ourFingerprintShort}
              />
              
              {/* Message Content */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: mutedColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  BEAP™ Message (required)
                </label>
                <textarea
                  value={beapDraftMessage}
                  onChange={(e) => setBeapDraftMessage(e.target.value)}
                  placeholder="Public capsule text — required before send. This is the transport-visible message body."
                  className="beap-textarea"
                  style={{
                    flex: 1,
                    minHeight: '120px',
                    background: isStandard ? 'white' : 'rgba(255,255,255,0.08)',
                    border: isStandard ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.15)',
                    color: textColor,
                    borderRadius: '6px',
                    padding: '10px 12px',
                    fontSize: '12px',
                    lineHeight: '1.5',
                    resize: 'none',
                    outline: 'none',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              
              {/* Encrypted Message (qBEAP/PRIVATE only) */}
              {beapRecipientMode === 'private' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: isStandard ? '#7c3aed' : '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    🔐 Encrypted Message (Private · qBEAP)
                  </label>
                  <textarea
                    className="beap-textarea"
                    value={beapDraftEncryptedMessage}
                    onChange={(e) => setBeapDraftEncryptedMessage(e.target.value)}
                    placeholder="This message is encrypted, capsule-bound, and never transported outside the BEAP package."
                    style={{
                      flex: 1,
                      minHeight: '100px',
                      background: isStandard ? 'rgba(139,92,246,0.05)' : 'rgba(139,92,246,0.15)',
                      border: isStandard ? '1px solid rgba(139,92,246,0.3)' : '1px solid rgba(139,92,246,0.4)',
                      color: textColor,
                      borderRadius: '6px',
                      padding: '10px 12px',
                      fontSize: '12px',
                      lineHeight: '1.5',
                      resize: 'none',
                      outline: 'none',
                      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                      boxSizing: 'border-box'
                    }}
                  />
                  <div style={{ fontSize: '10px', color: isStandard ? '#7c3aed' : '#c4b5fd', marginTop: '4px' }}>
                    ⚠️ This content is authoritative when present and never leaves the encrypted capsule.
                  </div>
                </div>
              )}
              
              {/* Advanced: Session + Attachments (Popup) */}
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: isStandard ? '1px solid rgba(15,23,42,0.1)' : '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '8px', color: mutedColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Advanced (Optional)</div>
                <div style={{ marginBottom: '10px' }}>
                  <label style={{ fontSize: '10px', fontWeight: 500, marginBottom: '4px', display: 'block', color: mutedColor }}>Session (optional)</label>
                  <select value={beapDraftSessionId} onChange={(e) => setBeapDraftSessionId(e.target.value)} onClick={() => loadAvailableSessions()} style={{ width: '100%', background: isStandard ? '#f8f9fb' : '#1e293b', border: isStandard ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.25)', color: isStandard ? '#0f172a' : '#f1f5f9', borderRadius: '6px', padding: '8px 10px', fontSize: '12px', outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}>
                    <option value="" style={{ background: isStandard ? '#f8f9fb' : '#1e293b', color: isStandard ? '#0f172a' : '#f1f5f9' }}>{availableSessions.length === 0 ? '— No sessions available —' : '— Select a session —'}</option>
                    {availableSessions.map((s) => (<option key={s.key} value={s.key} style={{ background: isStandard ? '#f8f9fb' : '#1e293b', color: isStandard ? '#0f172a' : '#f1f5f9' }}>{s.name} ({new Date(s.timestamp).toLocaleDateString()})</option>))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '10px', fontWeight: 500, marginBottom: '4px', display: 'block', color: mutedColor }}>Attachments (PDFs: text extracts automatically)</label>
                  <input type="file" multiple onChange={async (e) => { const files = Array.from(e.target.files ?? []); if (!files.length) return; const newItems: DraftAttachment[] = []; for (const file of files) { if (file.size > 10 * 1024 * 1024) { console.warn(`[BEAP] Skipping ${file.name}: exceeds 10MB limit`); continue } if (beapDraftAttachments.length + newItems.length >= 20) { console.warn('[BEAP] Max 20 attachments reached'); break } const dataBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const res = String(reader.result ?? ''); resolve(res.includes(',') ? res.split(',')[1] : res) }; reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) }); const attachmentId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; const mimeType = file.type || 'application/octet-stream'; const isPdfFile = mimeType.toLowerCase() === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'); const capsuleAttachment: CapsuleAttachment = { id: attachmentId, originalName: file.name, originalSize: file.size, originalType: mimeType, semanticContent: null, semanticExtracted: false, encryptedRef: `encrypted_${attachmentId}`, encryptedHash: '', previewRef: null, rasterProof: null, isMedia: mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/'), hasTranscript: false }; newItems.push({ id: attachmentId, name: file.name, mime: mimeType, size: file.size, dataBase64, capsuleAttachment, processing: { parsing: isPdfFile, rasterizing: false } }) } setBeapDraftAttachments((prev) => [...prev, ...newItems]); for (const item of newItems) { const isPdfItem = item.mime?.toLowerCase() === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf'); if (!isPdfItem || !item.dataBase64) continue; void runDraftAttachmentParseWithFallback({ id: item.id, dataBase64: item.dataBase64, capsuleAttachment: item.capsuleAttachment }).then((upd) => { setBeapDraftAttachments((prev) => prev.map((x) => (x.id === item.id ? { ...x, capsuleAttachment: upd.capsuleAttachment, processing: upd.processing } : x))) }) } e.currentTarget.value = '' }} style={{ fontSize: '11px', color: mutedColor }} />
                  {beapDraftAttachments.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      {beapDraftAttachments.map((a) => {
                      const isPdf = a.mime?.toLowerCase() === 'application/pdf' || a.name.toLowerCase().endsWith('.pdf')
                      const isParsing = !!a.processing?.parsing
                      const isSuccess = !!a.capsuleAttachment?.semanticExtracted
                      const showPdfBadge = isPdf && (isParsing || isSuccess || !!a.processing?.error)
                      const parseStatus: 'pending' | 'success' | 'failed' = isParsing ? 'pending' : isSuccess ? 'success' : 'failed'
                      return (
                      <div key={a.id} style={{ background: isStandard ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)', borderRadius: '4px', marginBottom: '4px', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: '14px' }}>📄</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '11px', color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                              <div style={{ fontSize: '9px', color: mutedColor }}>
                                {a.mime} · {(a.size / 1024).toFixed(0)} KB
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, flexWrap: 'wrap' as const }}>
                            {isSuccess && a.capsuleAttachment.semanticContent && (
                              <button
                                type="button"
                                onClick={() => setBeapDraftReaderModalId(a.id)}
                                style={{
                                  background: 'transparent',
                                  border: isStandard ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.2)',
                                  color: mutedColor,
                                  borderRadius: '4px',
                                  padding: '2px 8px',
                                  fontSize: '10px',
                                  cursor: 'pointer',
                                }}
                              >
                                Open reader
                              </button>
                            )}
                            {isPdf && !isSuccess && !isParsing && a.dataBase64 && a.processing?.error && (
                              <button
                                type="button"
                                onClick={() => {
                                  setBeapDraftAttachments((prev) => prev.map((x) => x.id === a.id ? { ...x, processing: { ...x.processing, parsing: true, error: undefined } } : x))
                                  void runDraftAttachmentParseWithFallback({
                                    id: a.id,
                                    dataBase64: a.dataBase64,
                                    capsuleAttachment: a.capsuleAttachment,
                                  }).then((upd) => {
                                    setBeapDraftAttachments((prev) =>
                                      prev.map((x) => (x.id === a.id ? { ...x, capsuleAttachment: upd.capsuleAttachment, processing: upd.processing } : x)),
                                    )
                                  })
                                }}
                                style={{
                                  background: isStandard ? 'rgba(139,92,246,0.12)' : 'rgba(139,92,246,0.25)',
                                  border: `1px solid ${isStandard ? 'rgba(139,92,246,0.35)' : 'rgba(192,132,252,0.4)'}`,
                                  color: isStandard ? '#6d28d9' : '#e9d5ff',
                                  borderRadius: '4px',
                                  padding: '2px 8px',
                                  fontSize: '10px',
                                  cursor: 'pointer',
                                }}
                              >
                                Retry
                              </button>
                            )}
                            <button onClick={() => { setBeapDraftReaderModalId((id) => (id === a.id ? null : id)); setBeapDraftAttachments((prev) => prev.filter((x) => x.id !== a.id)) }} style={{ background: 'transparent', border: 'none', color: isStandard ? '#ef4444' : '#f87171', fontSize: '10px', cursor: 'pointer' }}>Remove</button>
                            {showPdfBadge && <AttachmentStatusBadge status={parseStatus} theme={isStandard ? 'standard' : 'dark'} />}
                          </div>
                        </div>
                        {a.processing?.error && !isParsing && (
                          <div style={{ padding: '6px 8px', borderTop: `1px solid ${isStandard ? 'rgba(251,191,36,0.2)' : 'rgba(251,191,36,0.25)'}`, background: isStandard ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.12)', fontSize: '10px', color: isStandard ? '#b45309' : '#fbbf24' }}>
                            {a.processing.error.includes('connect') || a.processing.error.includes('Failed to connect')
                              ? 'Desktop parser (port 51248) can improve extraction. Add an API key in settings for AI extraction.'
                              : a.processing.error}
                          </div>
                        )}
                      </div>
                    )})}
                      <button onClick={() => { setBeapDraftReaderModalId(null); setBeapDraftAttachments([]) }} style={{ background: 'transparent', border: isStandard ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.2)', color: mutedColor, borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer', marginTop: '4px' }}>Clear all</button>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Info */}
              <div style={{
                fontSize: '11px',
                padding: '10px',
                background: isStandard ? 'rgba(168,85,247,0.08)' : 'rgba(168,85,247,0.15)',
                borderRadius: '6px',
                color: mutedColor,
                marginTop: '12px'
              }}>
                💡 This creates a secure BEAP™ package with your fingerprint. Your identity will be verifiable by the recipient.
              </div>
            </div>
            
            {/* Action Buttons */}
            <div style={{
              padding: '12px 14px',
              borderTop: isStandard ? '1px solid rgba(15,23,42,0.1)' : '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              background: isStandard ? '#f8f9fb' : 'rgba(0,0,0,0.2)'
            }}>
              <button 
                onClick={() => {
                  setBeapDraftTo('')
                  setBeapDraftMessage('')
                  setBeapDraftEncryptedMessage('')
                  setBeapDraftSessionId('')
                  setBeapDraftReaderModalId(null)
                  setBeapDraftAttachments([])
                  setSelectedRecipient(null)
                }}
                style={{
                  background: 'transparent',
                  border: isStandard ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.2)',
                  color: isStandard ? '#64748b' : 'rgba(255,255,255,0.7)',
                  borderRadius: '6px',
                  padding: '8px 16px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Clear
              </button>
              <button 
                onClick={handleSendBeapMessage}
                disabled={isBeapSendDisabled}
                style={{
                  background: isBeapSendDisabled ? 'rgba(139,92,246,0.5)' : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                  border: 'none',
                  color: 'white',
                  borderRadius: '6px',
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: isBeapSendDisabled ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  opacity: isBeapSendDisabled ? 0.7 : 1
                }}
              >
                {getBeapSendButtonLabel()}
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // Email Compose Content - plain email form with Connected Accounts, To, Subject, Body, Attachments, Signature
  const EMAIL_SIGNATURE = '\n\n—\nAutomate your inbox. Try wrdesk.com\nhttps://wrdesk.com'
  const renderEmailComposeContent = () => {
    const isStandard = theme === 'standard'
    const isProTheme = theme === 'pro'
    const textColor = isStandard ? '#0f172a' : 'white'
    const mutedColor = isStandard ? '#64748b' : 'rgba(255,255,255,0.7)'
    const borderColor = isStandard ? '#e1e8ed' : (isProTheme ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)')
    const bgColor = isProTheme ? 'rgba(118, 75, 162, 0.45)' : (isStandard ? '#f8f9fb' : 'rgba(255,255,255,0.04)')
    const inputBg = isStandard ? 'white' : (isProTheme ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)')
    
    // Pro/paid users: no signature. Free/basic: show signature + upgrade CTA
    const isProAccount = userTier !== 'free' && userTier !== 'basic'
    
    const formatFileSize = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }
    
    const handleEmailComposeFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files?.length) return
      const newAttachments: { name: string; size: number; mimeType: string; contentBase64: string }[] = []
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) continue // 10MB limit
        if (emailComposeAttachments.length + newAttachments.length >= 10) break
        const contentBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const res = String(reader.result ?? '')
            resolve(res.includes(',') ? res.split(',')[1]! : res)
          }
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })
        newAttachments.push({
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          contentBase64
        })
      }
      setEmailComposeAttachments(prev => [...prev, ...newAttachments])
      e.target.value = ''
    }
    
    const removeEmailComposeAttachment = (index: number) => {
      setEmailComposeAttachments(prev => prev.filter((_, i) => i !== index))
    }
    
    const handleEmailSend = async () => {
      setEmailComposeError(null)
      const toTrimmed = emailComposeTo.trim()
      if (!toTrimmed) {
        setEmailComposeError('To is required')
        return
      }
      const accountId = selectedEmailAccountId || defaultEmailAccountRowId
      if (!accountId || emailAccounts.length === 0) {
        setEmailComposeError('No email account connected')
        return
      }
      setEmailComposeSending(true)
      try {
        const bodyText = emailComposeBody.trim() + (isProAccount ? '' : EMAIL_SIGNATURE)
        const response = await chrome.runtime.sendMessage({
          type: 'EMAIL_SEND',
          accountId,
          to: toTrimmed.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
          subject: emailComposeSubject.trim() || '(No subject)',
          bodyText,
          attachments: emailComposeAttachments.map(a => ({
            filename: a.name,
            mimeType: a.mimeType,
            contentBase64: a.contentBase64
          }))
        })
        if (response?.ok && response?.data?.success) {
          setEmailComposeTo('')
          setEmailComposeSubject('')
          setEmailComposeBody('')
          setEmailComposeAttachments([])
          setToastMessage({ message: 'Email sent', type: 'success' })
          setTimeout(() => setToastMessage(null), 3000)
        } else {
          setEmailComposeError(response?.error || 'Failed to send')
        }
      } catch (err: unknown) {
        setEmailComposeError(err instanceof Error ? err.message : 'Failed to send')
      } finally {
        setEmailComposeSending(false)
      }
    }
    
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: bgColor, overflowY: 'auto' }}>
        {/* Connected Email Accounts */}
        <div style={{ padding: '16px 18px', borderBottom: `1px solid ${borderColor}`, background: isStandard ? 'white' : 'rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>🔗</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: textColor }}>Connected Email Accounts</span>
            </div>
            <button type="button" onClick={handleConnectEmail} style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', border: 'none', color: 'white', borderRadius: '6px', padding: '6px 12px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>+</span> Connect Email
            </button>
          </div>
          {isLoadingEmailAccounts ? (
            <div style={{ padding: '12px', textAlign: 'center', opacity: 0.6, fontSize: '12px' }}>Loading accounts...</div>
          ) : emailAccounts.length === 0 ? (
            <div style={{ padding: '20px', background: isStandard ? 'white' : 'rgba(255,255,255,0.05)', borderRadius: '8px', border: isStandard ? '1px dashed rgba(15,23,42,0.2)' : '1px dashed rgba(255,255,255,0.2)', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
              <div style={{ fontSize: '13px', color: mutedColor }}>No email accounts connected. Connect your account to send emails.</div>
            </div>
          ) : (
            <select value={selectedEmailAccountId || defaultEmailAccountRowId || ''} onChange={(e) => setSelectedEmailAccountId(e.target.value)} style={{ width: '100%', padding: '8px 12px', fontSize: '13px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '6px', color: textColor, outline: 'none', cursor: 'pointer' }}>
              {emailAccounts.map((a) => <option key={a.id} value={a.id}>{a.email || a.displayName} ({a.provider})</option>)}
            </select>
          )}
        </div>
        {/* Compose fields */}
        <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, display: 'block', marginBottom: 4 }}>To</label>
            <input type="email" value={emailComposeTo} onChange={(e) => setEmailComposeTo(e.target.value)} placeholder="recipient@example.com" style={{ width: '100%', padding: '8px 10px', fontSize: 13, background: inputBg, border: `1px solid ${borderColor}`, borderRadius: 6, color: textColor, outline: 'none' }} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, display: 'block', marginBottom: 4 }}>Subject</label>
            <input type="text" value={emailComposeSubject} onChange={(e) => setEmailComposeSubject(e.target.value)} placeholder="Subject" style={{ width: '100%', padding: '8px 10px', fontSize: 13, background: inputBg, border: `1px solid ${borderColor}`, borderRadius: 6, color: textColor, outline: 'none' }} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, display: 'block', marginBottom: 4 }}>Body</label>
            <textarea value={emailComposeBody} onChange={(e) => setEmailComposeBody(e.target.value)} placeholder="Write your message..." rows={8} style={{ width: '100%', padding: '8px 10px', fontSize: 13, background: inputBg, border: `1px solid ${borderColor}`, borderRadius: 6, color: textColor, outline: 'none', resize: 'vertical' }} />
          </div>
          {/* Attachments — same style as BEAP capsule builder (BeapDraftComposer) */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Attachments ({emailComposeAttachments.length})</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '11px', color: mutedColor }}>
                  {emailComposeAttachments.length === 0 ? 'No file selected' : `${emailComposeAttachments.length} file(s) selected`}
                </span>
                <button
                  onClick={() => emailComposeFileInputRef.current?.click()}
                  style={{
                    padding: '6px 12px',
                    background: isStandard ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.25)',
                    border: isStandard ? '1px solid rgba(139,92,246,0.3)' : '1px solid rgba(139,92,246,0.4)',
                    borderRadius: '6px',
                    color: isStandard ? '#7c3aed' : '#c4b5fd',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Choose Files
                </button>
              </div>
            </div>
            <input ref={emailComposeFileInputRef} type="file" multiple onChange={handleEmailComposeFileSelect} style={{ display: 'none' }} />
            {emailComposeAttachments.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px', background: isStandard ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                {emailComposeAttachments.map((att, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: inputBg, borderRadius: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px' }}>📄</span>
                      <span style={{ fontSize: '12px', color: textColor }}>{att.name}</span>
                      <span style={{ fontSize: '10px', color: mutedColor }}>({formatFileSize(att.size)})</span>
                    </div>
                    <button
                      onClick={() => removeEmailComposeAttachment(i)}
                      style={{ background: 'none', border: 'none', color: mutedColor, cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Signature — free tier only; Pro tier shows "no signature" note */}
          {isProAccount ? (
            <div style={{ fontSize: 11, color: mutedColor }}>✓ Pro — no signature added</div>
          ) : (
            <>
              <div style={{ fontSize: '11px', fontWeight: 600, color: mutedColor }}>Signature (appended automatically)</div>
              <pre style={{ fontSize: 11, color: mutedColor, background: 'rgba(0,0,0,0.05)', padding: 8, borderRadius: 6, margin: 0, whiteSpace: 'pre-wrap', opacity: 0.6 }}>{EMAIL_SIGNATURE.trim()}</pre>
              <a href="https://wrdesk.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#7c3aed', textDecoration: 'none', marginTop: 4, display: 'inline-block' }}>
                ✨ Upgrade to Pro to send without branding
              </a>
            </>
          )}
          {emailComposeError && <div style={{ fontSize: 12, color: '#ef4444' }}>{emailComposeError}</div>}
          <button onClick={handleEmailSend} disabled={emailComposeSending || isLoadingEmailAccounts || emailAccounts.length === 0} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, background: '#2563eb', border: 'none', borderRadius: 8, color: 'white', cursor: emailComposeSending ? 'not-allowed' : 'pointer', opacity: emailComposeSending || emailAccounts.length === 0 ? 0.6 : 1 }}>
            {emailComposeSending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    )
  }

  // Render the appropriate view based on workspace - MIRRORS docked exactly
  const renderContent = () => {
    const isStandard = theme === 'standard'
    const isPro = theme === 'pro'
    const textColor = isStandard ? '#0f172a' : 'white'
    const mutedColor = isStandard ? '#64748b' : 'rgba(255,255,255,0.7)'
    // Match Dashboard App.css: pro uses rgba(118, 75, 162, 0.45) for bg-surface
    const bgColor = isPro ? 'rgba(118, 75, 162, 0.45)' : (isStandard ? '#f8f9fb' : 'rgba(255,255,255,0.04)')
    
    // WRGuard workspace - full functionality using WRGuardWorkspace
    if (dockedWorkspace === 'wrguard') {
      return (
        <WRGuardWorkspace 
          theme={theme}
          emailAccounts={emailAccounts}
          isLoadingEmailAccounts={isLoadingEmailAccounts}
          selectedEmailAccountId={selectedEmailAccountId}
          onConnectEmail={handleConnectEmail}
          onDisconnectEmail={disconnectEmailAccount}
          onSetProcessingPaused={setAccountProcessingPaused}
          onSelectEmailAccount={setSelectedEmailAccountId}
        />
      )
    }
    
    // BEAP Messages workspace - simple inline views
    if (dockedWorkspace === 'beap-messages') {
      return renderBeapMessagesContent()
    }
    
    // Email Compose workspace - plain email compose form
    if (dockedWorkspace === 'email-compose') {
      return renderEmailComposeContent()
    }
    
    // Augmented Overlay workspace
    if (dockedWorkspace === 'augmented-overlay') {
      return (
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          padding: '40px 20px', 
          textAlign: 'center',
          background: isPro ? 'rgba(118, 75, 162, 0.45)' : (isStandard ? '#f8f9fb' : 'rgba(255,255,255,0.06)')
        }}>
          <span style={{ fontSize: '24px', marginBottom: '12px' }}>🎯</span>
          <span style={{ 
            fontSize: '13px', 
            color: mutedColor,
            maxWidth: '280px'
          }}>
            Point with the cursor or select elements in order to ask questions or trigger automations directly in the UI.
          </span>
        </div>
      )
    }

    // WR Chat modes - respect submode
    switch (dockedSubmode) {
      case 'command':
        return (
          <CommandChatView
            theme={theme}
            availableModels={availableModels}
            activeLlmModel={activeLlmModel}
            onModelSelect={(name) => { setActiveLlmModel(name); activeLlmModelRef.current = name }}
            onRefreshModels={refreshPopupModels}
          />
        )
      case 'p2p-chat':
        return <P2PChatPlaceholder theme={toPlaceholderTheme(theme)} />
      case 'p2p-stream':
        return <P2PStreamPlaceholder theme={toPlaceholderTheme(theme)} />
      case 'group-stream':
        return <GroupChatPlaceholder theme={toPlaceholderTheme(theme)} />
      case 'handshake':
        return (
          <div style={{ overflowY: 'auto', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : (theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.06)') }}>
            {/* Policy section — mirrors HandshakeInitiateModal in the Electron dashboard */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(147,51,234,0.14)' }}>
              <h5 style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: 600, color: theme === 'standard' ? '#6b7280' : '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Default policy for newly attached context
              </h5>
              <p style={{ margin: '0 0 8px', fontSize: '11px', color: theme === 'standard' ? '#6b7280' : '#777' }}>
                Starting template for new context items. Individual items can override.
              </p>
              {(['none', 'local_only', 'internal_and_cloud'] as const).map((val) => {
                const labels: Record<string, string> = { none: 'No AI processing', local_only: 'Internal AI only', internal_and_cloud: 'Allow Internal + Cloud AI' }
                const descs: Record<string, string> = { none: 'Handshake data must not be processed by any AI system', local_only: 'Restrict AI processing to on-premise or organization-controlled systems', internal_and_cloud: 'Allow handshake data to be processed by internal AI systems and external cloud AI services' }
                const active = hsPolicy.ai_processing_mode === val
                return (
                  <label key={val} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '7px 10px', borderRadius: '6px', background: active ? 'rgba(139,92,246,0.08)' : 'transparent', border: `1px solid ${active ? 'rgba(139,92,246,0.3)' : 'transparent'}`, cursor: 'pointer', marginBottom: '4px' }}>
                    <input type="radio" name="hs-policy-popup" checked={active} onChange={() => setHsPolicy({ ai_processing_mode: val })} style={{ marginTop: '3px', accentColor: '#8b5cf6' }} />
                    <div>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: theme === 'standard' ? '#374151' : '#d0d0d0' }}>{labels[val]}</span>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: theme === 'standard' ? '#6b7280' : '#777' }}>{descs[val]}</p>
                    </div>
                  </label>
                )
              })}
            </div>
            <SendHandshakeDelivery
              theme={theme === 'standard' ? 'standard' : theme === 'pro' ? 'pro' : 'dark'}
              onBack={() => setDockedSubmode('command')}
              fromAccountId={selectedEmailAccountId || defaultEmailAccountRowId || ''}
              emailAccounts={emailAccounts.map(a => ({ id: a.id, email: a.email, provider: a.provider }))}
              onSelectEmailAccount={setSelectedEmailAccountId}
              onSuccess={() => setDockedSubmode('command')}
              canUseHsContextProfiles={canUseHsContextProfiles}
              policySelections={hsPolicy}
            />
          </div>
        )
      default:
        return (
          <CommandChatView
            theme={theme}
            availableModels={availableModels}
            activeLlmModel={activeLlmModel}
            onModelSelect={(name) => { setActiveLlmModel(name); activeLlmModelRef.current = name }}
            onRefreshModels={refreshPopupModels}
          />
        )
    }
  }
  
  // Theme-based container styles - Matching Dashboard App.css
  const containerStyles: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    // Match Dashboard: pro theme uses purple gradient background
    background: theme === 'pro' 
      ? 'linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #9333ea 100%)'
      : theme === 'standard'
      ? '#f8f9fb'
      : undefined
  }

  const headerStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    gap: '10px',
    borderBottom: theme === 'standard' 
      ? '1px solid #e1e8ed'
      : theme === 'dark'
      ? '1px solid rgba(255,255,255,0.15)'
      : '1px solid rgba(255,255,255,0.2)',
    background: theme === 'standard'
      ? '#ffffff'
      : theme === 'dark'
      ? 'rgba(0,0,0,0.15)'
      : 'linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #9333ea 100%)'
  }

  // Selectbox styles for visibility - Matching Dashboard theme
  const selectboxStyle = theme === 'standard' 
    ? { background: '#ffffff', color: '#0f1419', arrowColor: '%230f1419' }
    : theme === 'dark'
    ? { background: 'rgba(30, 41, 59, 0.9)', color: '#f1f5f9', arrowColor: '%23f1f5f9' }
    : { background: 'rgba(55, 65, 81, 0.85)', color: '#ffffff', arrowColor: '%23ffffff' }

  // ==========================================================================
  // AUTH-GATED UI: Show minimal login screen when not logged in
  // ==========================================================================
  
  // Loading state
  if (isLoggedIn === null) {
    return (
      <div style={{
        ...containerStyles,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '300px'
      }}>
        <div style={{
          fontSize: '13px',
          color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)',
          textAlign: 'center'
        }}>
          Loading...
        </div>
      </div>
    )
  }
  
  // Logged-out state: Show ONLY logo + Sign In + Create Account
  if (!isLoggedIn) {
    const accentColor = theme === 'standard' ? '#6366f1' : '#a78bfa'
    const textColor = theme === 'standard' ? '#0f172a' : '#ffffff'
    const mutedColor = theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)'
    
    return (
      <div style={{
        ...containerStyles,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '400px',
        padding: '40px 24px',
        gap: '24px'
      }}>
        {/* WRDesk Logo */}
        <div style={{ textAlign: 'center' }}>
          <img 
            src={chrome.runtime.getURL('wrdesk-logo.png')}
            alt="WR Desk"
            style={{
              width: '180px',
              height: 'auto',
              marginBottom: '16px'
            }}
          />
          <p style={{
            fontSize: '13px',
            color: mutedColor,
            margin: '0 0 8px 0',
            lineHeight: '1.5'
          }}>
            Workflow-Ready Desk
          </p>
          <p style={{
            fontSize: '11px',
            color: mutedColor,
            margin: 0,
            opacity: 0.8
          }}>
            Sign in to access your dashboard
          </p>
        </div>
        
        {/* Sign In Button */}
        <button
          onClick={handleSignIn}
          disabled={isLoggingIn}
          style={{
            padding: '12px 32px',
            background: theme === 'standard' 
              ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' 
              : 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%)',
            border: 'none',
            borderRadius: '8px',
            color: '#fff',
            fontSize: '14px',
            fontWeight: '600',
            cursor: isLoggingIn ? 'wait' : 'pointer',
            transition: 'all 0.2s ease',
            opacity: isLoggingIn ? 0.7 : 1,
            boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
            minWidth: '160px'
          }}
          onMouseEnter={(e) => {
            if (!isLoggingIn) {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(99,102,241,0.4)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(99,102,241,0.3)';
          }}
        >
          {isLoggingIn ? 'Signing in...' : 'Sign In'}
        </button>
        
        {/* Create Account Link */}
        <button
          onClick={handleCreateAccount}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            border: 'none',
            color: accentColor,
            fontSize: '13px',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.textDecoration = 'underline';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.textDecoration = 'none';
          }}
        >
          Create Account
        </button>
        
        {/* Signing in status message */}
        {isLoggingIn && (
          <p style={{
            fontSize: '11px',
            color: mutedColor,
            margin: 0,
            textAlign: 'center'
          }}>
            A browser window will open for secure sign-in...
          </p>
        )}
        
        {/* Login error message */}
        {loginError && !isLoggingIn && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', maxWidth: '280px' }}>
            {electronNotRunning ? (
              <>
                <p style={{
                  fontSize: '12px',
                  color: theme === 'standard' ? '#dc2626' : '#f87171',
                  margin: 0,
                  textAlign: 'center',
                  lineHeight: '1.5',
                }}>
                  WR Desk Orchestrator is not running.
                </p>
                <p style={{
                  fontSize: '11px',
                  color: theme === 'standard' ? '#6b7280' : '#9ca3af',
                  margin: 0,
                  textAlign: 'center',
                  lineHeight: '1.5',
                }}>
                  {platformOs === 'linux'
                    ? 'Please start WR Desk from your application menu.'
                    : <>Please start WR Desk from the Start menu.</>}
                </p>
                {launchTimedOut ? (
                  <p style={{ fontSize: '11px', color: theme === 'standard' ? '#dc2626' : '#f87171', margin: '4px 0 0', textAlign: 'center' }}>
                    Could not connect. Please make sure WR Desk is running and try again.
                  </p>
                ) : null}
                <button
                  onClick={handleSignIn}
                  style={{
                    marginTop: '4px',
                    padding: '6px 16px',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    background: theme === 'standard' ? '#6366f1' : '#818cf8',
                    color: '#fff',
                  }}
                >
                  Retry Sign In
                </button>
              </>
            ) : (
              <p style={{
                fontSize: '12px',
                color: theme === 'standard' ? '#dc2626' : '#f87171',
                margin: 0,
                textAlign: 'center',
                lineHeight: '1.5',
              }}>
                {loginError}
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  // ==========================================================================
  // LOGGED-IN STATE: Show full dashboard UI
  // ==========================================================================
  
  return (
    <div style={containerStyles}>
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          padding: '10px 20px',
          borderRadius: '8px',
          background:
            toastMessage.type === 'success'
              ? 'rgba(34,197,94,0.95)'
              : toastMessage.type === 'info'
                ? 'rgba(33, 150, 243, 0.95)'
                : 'rgba(239,68,68,0.95)',
          color: 'white',
          fontSize: '12px',
          fontWeight: 500,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
          maxWidth: 'min(92vw, 420px)',
        }}>
          <span style={{ flexShrink: 0, lineHeight: 1.4 }}>
            {toastMessage.type === 'success' ? '✓' : toastMessage.type === 'info' ? 'ℹ' : '✕'}
          </span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ whiteSpace: 'pre-line', lineHeight: 1.45 }}>{toastMessage.message}</span>
            {toastMessage.p2pOutboundDebug && (
              <button
                type="button"
                onClick={() => setP2pOutboundDebugModal(toastMessage.p2pOutboundDebug ?? null)}
                style={{
                  alignSelf: 'flex-start',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(255,255,255,0.35)',
                  color: 'white',
                  borderRadius: 4,
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                DEBUG
              </button>
            )}
          </div>
        </div>
      )}
      <P2pOutboundDebugModal debug={p2pOutboundDebugModal} onClose={() => setP2pOutboundDebugModal(null)} />
      
      {/* Header with Workspace Select and Submode - MIRRORS docked exactly */}
      <header style={headerStyles}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Workspace Selector - Same options as docked */}
          <select
            value={dockedWorkspace}
            onChange={(e) => setDockedWorkspace(e.target.value as DockedWorkspace)}
            style={{
              fontSize: '11px',
              fontWeight: 600,
              height: '26px',
              minWidth: '120px',
              background: selectboxStyle.background,
              border: 'none',
              color: selectboxStyle.color,
              borderRadius: '13px',
              padding: '0 18px 0 8px',
              cursor: 'pointer',
              outline: 'none',
              appearance: 'none',
              WebkitAppearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6' viewBox='0 0 12 12'%3E%3Cpath fill='${selectboxStyle.arrowColor}' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 6px center'
            }}
          >
            <option value="wr-chat" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>💬 WR Chat</option>
            <option value="augmented-overlay" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>🎯 Augmented Overlay</option>
            <option value="beap-messages" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>📦 BEAP Messages</option>
            <option value="email-compose" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>✉️ Email Compose</option>
            <option value="wrguard" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>🔒 WRGuard</option>
          </select>
          
          {/* Submode Selector - Only for WR Chat */}
          {dockedWorkspace === 'wr-chat' && (
            <select
              value={dockedSubmode}
              onChange={(e) => setDockedSubmode(e.target.value as DockedSubmode)}
              style={{
                fontSize: '11px',
                fontWeight: 500,
                height: '26px',
                minWidth: '95px',
                background: selectboxStyle.background,
                border: 'none',
                color: selectboxStyle.color,
                borderRadius: '13px',
                padding: '0 16px 0 8px',
                cursor: 'pointer',
                outline: 'none',
                appearance: 'none',
                WebkitAppearance: 'none',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6' viewBox='0 0 12 12'%3E%3Cpath fill='${selectboxStyle.arrowColor}' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 6px center'
              }}
            >
              <option value="command" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>cmd</option>
              <option value="p2p-chat" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>Direct Chat</option>
              <option value="p2p-stream" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>Live Views</option>
              <option value="group-stream" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>Group Sessions</option>
              <option value="handshake" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>Handshake Request</option>
            </select>
          )}
          
          {/* BEAP Submode Selector - Only for BEAP Messages */}
          {dockedWorkspace === 'beap-messages' && (
            <select
              value={beapSubmode}
              onChange={(e) => setBeapSubmode(e.target.value as BeapSubmode)}
              style={{
                fontSize: '11px',
                fontWeight: 500,
                height: '26px',
                minWidth: '80px',
                background: selectboxStyle.background,
                border: 'none',
                color: selectboxStyle.color,
                borderRadius: '13px',
                padding: '0 16px 0 8px',
                cursor: 'pointer',
                outline: 'none',
                appearance: 'none',
                WebkitAppearance: 'none',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6' viewBox='0 0 12 12'%3E%3Cpath fill='${selectboxStyle.arrowColor}' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 6px center'
              }}
            >
              <option value="inbox" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>Inbox</option>
              <option value="bulk-inbox" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>⚡ Bulk Inbox</option>
              <option value="draft" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>Draft</option>
              <option value="outbox" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>Outbox</option>
              <option value="archived" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>Archived</option>
              <option value="rejected" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>Rejected</option>
            </select>
          )}
        </div>
        
        {/* User Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Avatar: Show picture if available, otherwise show initials */}
          {userInfo.picture && !pictureError ? (
            <img
              src={userInfo.picture}
              alt=""
              onError={() => setPictureError(true)}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                objectFit: 'cover',
                border: theme === 'standard' 
                  ? '1px solid rgba(15,23,42,0.1)'
                  : '1px solid rgba(255,255,255,0.2)'
              }}
              title={userInfo.displayName || userInfo.email || 'User'}
            />
          ) : (
            <div 
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: theme === 'standard' 
                  ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
                  : 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%)',
                color: '#fff',
                fontSize: '10px',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textTransform: 'uppercase'
              }}
              title={userInfo.displayName || userInfo.email || 'User'}
            >
              {userInfo.initials || '?'}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {renderContent()}
      </main>

      {/* Footer: Role indicator (debug) */}
      {process.env.NODE_ENV === 'development' && (
        <footer style={{
          padding: '4px 12px',
          fontSize: '10px',
          opacity: 0.5,
          borderTop: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <span>Role: {role}</span>
          <span>Ctrl+Shift+A to toggle admin</span>
        </footer>
      )}
      
      {connectEmailFlowModal}

      {beapDraftReaderModalId && (() => {
        const att = beapDraftAttachments.find((x) => x.id === beapDraftReaderModalId)
        const t = att?.capsuleAttachment?.semanticContent?.trim()
        if (!att || !t) return null
        return (
          <BeapDocumentReaderModal
            open
            onClose={() => setBeapDraftReaderModalId(null)}
            filename={att.name}
            semanticContent={att.capsuleAttachment.semanticContent ?? ''}
            theme={theme === 'standard' ? 'standard' : 'dark'}
          />
        )
      })()}

    </div>
  )
}

// =============================================================================
// Mount React App
// =============================================================================

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<PopupChatApp />)
}







