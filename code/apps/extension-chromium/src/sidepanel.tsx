import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useUIStore } from './stores/useUIStore'
import { useCustomModesStore } from './stores/useCustomModesStore'
import { useChatFocusStore } from './stores/chatFocusStore'
import { fetchTriggerProjects } from './services/fetchTriggerProjects'
import { createRoot } from 'react-dom/client'
import { BackendSwitcherInline } from './components/BackendSwitcherInline'
import { PackageBuilderPolicy } from './policy/components/PackageBuilderPolicy'
import type { CanonicalPolicy } from './policy/schema'
import { 
  formatFingerprintShort, 
  formatFingerprintGrouped 
} from './handshake/fingerprint'
import { POLICY_NOTES, TOOLTIPS } from './handshake/microcopy'
import {
  getOurIdentity,
  type OurIdentity
} from './handshake/handshakeService'
import { 
  routeInput, 
  getButlerSystemPrompt, 
  wrapInputForAgent,
  enrichRouteTextWithOcr,
  loadAgentsFromSession,
  updateAgentBoxOutput,
  getAgentById,
  resolveModelForAgent,
  buildLlmRequestBody,
  type BrainResolution,
  type RoutingDecision,
  type AgentMatch,
  type AgentBox,
  type EventTagRoutingBatch
} from './services/processFlow'
import { nlpClassifier, type ClassifiedInput } from './nlp'
import { inputCoordinator } from './services/InputCoordinator'
import { formatErrorForNotification, isConnectionError } from './utils/errorMessages'
import { normaliseTriggerTag } from './utils/normaliseTriggerTag'
import { mergeTaggedTriggersFromHost } from './utils/mergeTaggedTriggersFromHost'
import { ConnectEmailLaunchSource, useConnectEmailFlow } from './shared/email/connectEmailFlow'
import { pickDefaultEmailAccountRowId } from './shared/email/pickDefaultAccountRow'
import { ThirdPartyLicensesView } from './bundled-tools'
import { WrChatCaptureButton } from './ui/components/WrChatCaptureButton'
import { WrChatDiffButton } from './ui/components/WrChatDiffButton'
import WrMultiTriggerBar from './ui/components/wrMultiTrigger/WrMultiTriggerBar'
import { AddModeWizardHost } from './ui/components/AddModeWizardHost'
import ChatFocusBanner from './ui/components/ChatFocusBanner'
import { WRCHAT_APPEND_ASSISTANT_EVENT, useChatFocusStore } from './stores/chatFocusStore'
import { getChatFocusLlmPrefix } from './utils/chatFocusLlmPrefix'
import { getCustomModeLlmPrefix, mergeLlmContextPrefixes } from './utils/customModeLlmPrefix'
import {
  getActiveCustomModeRuntime,
  getEffectiveLlmModelNameForActiveMode,
} from './stores/activeCustomModeRuntime'
import { prependHiddenContextToLastUserContent } from './utils/prependChatFocusToLastUser'
import { formatWatchdogAlert, type WatchdogThreat } from './utils/formatWatchdogAlert'
import { WRGuardWorkspace, useWRGuardStore } from './wrguard'
import { RecipientModeSwitch, RecipientHandshakeSelect, DeliveryMethodPanel, executeDeliveryAction, BeapMessageListView, BeapBulkInbox, initBeapPqAuth } from './beap-messages'
import type { BeapBulkInboxHandle } from './beap-messages'
import type { RecipientMode, SelectedHandshakeRecipient, SelectedRecipient, DeliveryMethod, BeapPackageConfig } from './beap-messages'
import { BeapInboxView } from './beap-messages/components/BeapInboxView'
import type { BeapInboxViewHandle } from './beap-messages/components/BeapInboxView'
import { createBeapReplyAiProvider } from './beap-messages/services/beapReplyAiProvider'
import { InboxErrorBoundary } from './beap-messages/components/InboxErrorBoundary'
import { useBeapInboxStore } from './beap-messages/useBeapInboxStore'
import { sendViaHandshakeRefresh } from './beap-builder/handshakeRefresh'
import { HandshakeManagementPanel } from './handshake/components/HandshakeManagementPanel'
import { HandshakeRequestForm } from './handshake/components/HandshakeRequestForm'
import { SendHandshakeDelivery } from './handshake/components/SendHandshakeDelivery'
import { useHandshakes } from './handshake/useHandshakes'
import { runDraftAttachmentParseWithFallback, draftAttachmentParseRejectedUpdate } from './beap-builder'
import { BeapDocumentReaderModal, AttachmentStatusBadge } from './beap-builder/components'
import type { CapsuleAttachment, RasterProof, RasterPageData } from './beap-builder'
import { electronRpc, type ElectronRpcResponse } from './rpc/electronRpc'
import { getVaultStatus } from './vault/api'
import type { ClientSendFailureDebug, OutboundRequestDebugSnapshot } from './handshake/handshakeRpc'
import {
  formatOversizeAttachmentRejection,
  MAX_BEAP_DRAFT_ATTACHMENT_BYTES,
} from './beap-messages/attachmentPickerLimits'
import {
  toBase64ForOllama,
  isPlausibleVisionBase64,
  resolveImageUrlForBackend,
} from './utils/image-resolve'
interface ConnectionStatus {
  isConnected: boolean
  readyState?: number
}

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

/** Shape of `llm.status` body (flat or nested under `.data`). */
type LlmStatusData = {
  installed?: boolean
  running?: boolean
  modelsInstalled?: Array<{ name: string }>
}

// ── Pinned-trigger emoji helpers ─────────────────────────────────────────────
const SP_PINNED_EMOJIS = [
  '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤',
  '⭐', '🌟', '✨', '💫', '🔥', '⚡', '🌈',
  '🎯', '🎨', '🎸', '🎵', '🚀', '🌿', '🍀',
  '💡', '🔔', '🦋', '🌙', '☀️', '⚽', '🎮',
]
function spEmojiForKey(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) >>> 0
  return SP_PINNED_EMOJIS[h % SP_PINNED_EMOJIS.length] ?? '📌'
}

function unwrapLlmStatusPayload(data: unknown): LlmStatusData | null {
  if (data == null || typeof data !== 'object') return null
  const o = data as { data?: LlmStatusData }
  if (o.data !== undefined && o.data !== null) return o.data
  return data as LlmStatusData
}

function beapUiValidationFailure(message: string): {
  message: string
  type: 'error'
  clientSendFailureDebug: ClientSendFailureDebug
} {
  return {
    message,
    type: 'error',
    clientSendFailureDebug: {
      kind: 'client_send_failure',
      phase: 'ui_validation',
      message,
    },
  }
}

/** Matches content-script session display: user alias, else internal tabName. */
function sessionListLabel(
  s: { sessionAlias?: string | null; tabName?: string; name?: string; sessionName?: string } | null | undefined,
  fallback: string,
): string {
  if (!s) return fallback
  if (s.sessionAlias != null && String(s.sessionAlias).trim() !== '') return String(s.sessionAlias).trim()
  return s.tabName || s.name || s.sessionName || fallback
}

function SidepanelOrchestrator() {
  // Original state
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ isConnected: false })
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('helper')
  const [bottomTab, setBottomTab] = useState('logs')
  const [mode, setMode] = useState('master')
  const [agents, setAgents] = useState({
    summarize: true,
    refactor: true,
    entityExtract: false
  })

  // Additional state for new features
  const [sessionName, setSessionName] = useState('')
  const [sessionKey, setSessionKey] = useState<string>('')
  const sessionKeyRef = useRef<string>('')
  const [isLocked, setIsLocked] = useState(false)
  const [agentBoxes, setAgentBoxes] = useState<Array<any>>([])
  const [agentBoxHeights, setAgentBoxHeights] = useState<Record<string, number>>({})
  const [resizingBoxId, setResizingBoxId] = useState<string | null>(null)
  const [isWRLoginCollapsed, setIsWRLoginCollapsed] = useState(false)
  const [isCommandChatPinned, setIsCommandChatPinned] = useState(false)
  const [showMinimalUI, setShowMinimalUI] = useState(false) // Show minimal UI on display grids and Edge startpage
  const [viewMode, setViewMode] = useState<'app' | 'admin'>('app') // App or Admin view
  const [isAdminDisabled, setIsAdminDisabled] = useState(false) // Disable admin on display grids and Edge startpage
  const [showThirdPartyLicenses, setShowThirdPartyLicenses] = useState(false) // Third party licenses modal
  const [showElectronDialog, setShowElectronDialog] = useState(false) // Dialog when Electron app is not running
  const [isLaunchingElectron, setIsLaunchingElectron] = useState(false) // Loading state for launching Electron
  const [platformOs, setPlatformOs] = useState<'linux' | 'mac' | 'win' | null>(null)
  
  /**
   * BASELINE LOCATION COMMENTS (Step 1/10 Refactoring)
   * 
   * Navigation/Workspaces:
   * - dockedWorkspace: First dropdown ('wr-chat', 'augmented-overlay', 'beap-messages')
   * - dockedSubmode: Second dropdown for WR Chat modes
   * - beapSubmode: Second dropdown for BEAP Messages views (Inbox/Draft/Outbox/Archived/Rejected)
   * - Workspace selects rendered at ~3095, ~4578, ~5747 (3 view modes)
   * 
   * Former WR MailGuard UI (now BEAP Messages):
   * - Connect Email section: lines ~3976-4108, ~5260-5390, ~6428-6558 (3 view modes)
   * - Email accounts state: emailAccounts, loadEmailAccounts()
   * 
   * WR Chat Handshake Request UI (reused for BEAP Message in Draft view):
   * - State: handshakeDelivery, handshakeTo, handshakeSubject, handshakeMessage
   * - Rendered at ~3407-3627, ~4890-5100, ~6058-6268 (3 view modes)
   */
  
  // Command chat state - workspace + submode like popup
  const [dockedWorkspace, setDockedWorkspace] = useState<'wr-chat' | 'augmented-overlay' | 'beap-messages' | 'wrguard'>('wr-chat')
  const [dockedSubmode, setDockedSubmode] = useState<'command' | 'p2p-chat' | 'p2p-stream' | 'group-stream' | 'handshake' | 'beap-draft'>('command')
  const [beapSubmode, setBeapSubmode] = useState<'inbox' | 'draft' | 'outbox' | 'archived' | 'rejected' | 'bulk-inbox'>('draft')
  const [selectedEmailAccountId, setSelectedEmailAccountId] = useState<string | null>(null)
  const [hsPolicy, setHsPolicy] = useState<{ ai_processing_mode: 'none' | 'local_only' | 'internal_and_cloud' }>({ ai_processing_mode: 'local_only' })
  const [canUseHsContextProfiles, setCanUseHsContextProfiles] = useState(false)

  // Per-launch HTTP auth secret received from the Electron background worker.
  // Required as X-Launch-Secret header on every direct fetch() to port 51248.
  const launchSecretRef = useRef<string | null>(null)

  /**
   * Build headers for a direct fetch() to the Electron HTTP API.
   * Injects X-Launch-Secret when available (mirrors background._electronHeaders).
   */
  const electronFetchHeaders = (extra?: Record<string, string>): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Launch-Secret': launchSecretRef.current ?? '',
    }
    if (extra) Object.assign(headers, extra)
    return headers
  }

  // Init BEAP PQ auth so qBEAP can reach Electron PQ API (port 51248)
  useEffect(() => {
    initBeapPqAuth()
  }, [])

  // Fetch the per-launch secret from the background worker on mount so all
  // direct fetch() calls to Electron can attach X-Launch-Secret.
  useEffect(() => {
    const fetchSecret = () => {
      chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (response: { secret?: string | null } | undefined) => {
        if (chrome.runtime.lastError) return
        if (response?.secret) {
          launchSecretRef.current = response.secret
        } else {
          // Secret not yet available — retry after a short delay
          setTimeout(fetchSecret, 1500)
        }
      })
    }
    fetchSecret()
    // Refresh the secret every 60s to handle Electron restarts (secret rotation)
    // and service worker sleep/wake cycles which reset the in-memory _launchSecret.
    const interval = setInterval(fetchSecret, 60_000)
    return () => clearInterval(interval)
  }, [])

  /**
   * Ensure launch secret is available before making an LLM call.
   * Re-fetches from background if missing (handles SW sleep/wake and Electron restarts).
   */
  const ensureLaunchSecret = (): Promise<void> => {
    if (launchSecretRef.current) return Promise.resolve()
    return new Promise((resolve) => {
      let attempts = 0
      const tryFetch = () => {
        chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (response: { secret?: string | null } | undefined) => {
          if (chrome.runtime.lastError) { attempts++; if (attempts < 8) setTimeout(tryFetch, 500); else resolve(); return }
          if (response?.secret) {
            launchSecretRef.current = response.secret
            resolve()
          } else {
            attempts++
            if (attempts < 8) setTimeout(tryFetch, 500)
            else { console.warn('[Sidepanel] ⚠️ Launch secret unavailable after retries'); resolve() }
          }
        })
      }
      tryFetch()
    })
  }

  // Deep linking: ?message=id, ?handshake=id, or #message=id, #handshake=id (R.8)
  useEffect(() => {
    try {
      const search = typeof window !== 'undefined' ? window.location.search : ''
      const hash = typeof window !== 'undefined' ? window.location.hash : ''
      const searchParams = new URLSearchParams(search)
      const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
      const messageId = searchParams.get('message') ?? hashParams.get('message')
      const handshakeId = searchParams.get('handshake') ?? hashParams.get('handshake')
      if (messageId) {
        setDockedWorkspace('beap-messages')
        setBeapSubmode('inbox')
        useBeapInboxStore.getState().selectMessage(messageId)
      } else if (handshakeId) {
        setDockedWorkspace('wrguard')
        useWRGuardStore.getState().setActiveSection('handshakes')
        useWRGuardStore.getState().setSelectedHandshakeId(handshakeId)
      }
    } catch {
      // Ignore deep-link parse errors
    }
  }, [])

  // Fetch vault status for HS Context gating (Publisher+ only)
  useEffect(() => {
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
  }, [])

  // Helper to get combined mode for conditional rendering
  const dockedPanelMode = dockedWorkspace === 'wr-chat' ? dockedSubmode : dockedWorkspace
  
  // Helper to get the current BEAP view for conditional rendering
  const currentBeapView = dockedWorkspace === 'beap-messages' ? beapSubmode : null

  // Search bar context label — updated by BeapInboxView / HandshakeDetailsPanel when a
  // message or handshake is selected. Used as the dynamic textarea placeholder.
  const [searchBarContext, setSearchBarContext] = React.useState<string>('')
  const inboxViewRef = React.useRef<BeapInboxViewHandle>(null)
  const bulkInboxRef = React.useRef<BeapBulkInboxHandle>(null)
  const pendingInboxAiRef = React.useRef<{
    messageId: string
    query: string
    attachmentId?: string
    isBulk?: boolean
  } | null>(null)
  const beapInboxSelectedAttachmentIdRef = React.useRef<string | null>(null)
  const [chatMessages, setChatMessages] = useState<Array<{role: 'user' | 'assistant', text: string, imageUrl?: string}>>([])
  const [chatInput, setChatInput] = useState('')
  const [chatHeight, setChatHeight] = useState(200)
  const [isResizingChat, setIsResizingChat] = useState(false)
  const [triggers, setTriggers] = useState<any[]>([])
  const [anchoredTriggerKeys, setAnchoredTriggerKeys] = useState<string[]>([])
  const [pinnedDiffIds, setPinnedDiffIds] = useState<string[]>([])
  const [diffWatchers, setDiffWatchers] = useState<any[]>([])
  const [showTagsMenu, setShowTagsMenu] = useState(false)
  /** Resets after each run so the same trigger can be selected again. */
  const [showEmbedDialog, setShowEmbedDialog] = useState(false)
  const [pendingItems, setPendingItems] = useState<any[]>([])
  const [embedTarget, setEmbedTarget] = useState<'session' | 'account'>('session')
  const [isDraggingOverChat, setIsDraggingOverChat] = useState(false)
  // Tracks document text extracted from dropped/uploaded files so it can be
  // automatically prepended to the next user message sent to the LLM.
  const [pendingDocContent, setPendingDocContent] = useState<{ name: string; text: string } | null>(null)
  const [notification, setNotification] = useState<{
    message: string
    type: 'success' | 'error' | 'info'
    p2pOutboundDebug?: OutboundRequestDebugSnapshot
    clientSendFailureDebug?: ClientSendFailureDebug
  } | null>(null)
  const [theme, setTheme] = useState<'pro' | 'dark' | 'standard'>('standard')
  
  // ==========================================================================
  // AUTH-GATED UI STATE (mirrors popup-chat.tsx)
  // ==========================================================================
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)  // null = loading
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [electronNotRunning, setElectronNotRunning] = useState(false)
  const [authUserInfo, setAuthUserInfo] = useState<{ displayName?: string; email?: string; initials?: string; picture?: string }>({})
  
  // Check auth on mount, when the panel becomes visible (~session correctness), and on a slow poll.
  // Background worker coalesces concurrent `AUTH_STATUS` → one `GET /api/auth/status` per ~45s unless `forceRefresh`.
  const AUTH_STATUS_POLL_MS = 120_000
  useEffect(() => {
    const checkAuthStatus = (forceRefresh = false) => {
      chrome.runtime.sendMessage({ type: 'AUTH_STATUS', forceRefresh }, (response: { loggedIn?: boolean; displayName?: string; email?: string; initials?: string; picture?: string } | undefined) => {
        if (chrome.runtime.lastError) {
          console.warn('[AUTH] Sidepanel status check failed:', chrome.runtime.lastError.message);
          setIsLoggedIn(false);
          return;
        }
        if (response?.loggedIn) {
          setIsLoggedIn(true);
          setAuthUserInfo({
            displayName: response.displayName,
            email: response.email,
            initials: response.initials,
            picture: response.picture,
          });
        } else {
          setIsLoggedIn(false);
          setAuthUserInfo({});
        }
      });
    };

    checkAuthStatus(true);
    const interval = setInterval(() => checkAuthStatus(false), AUTH_STATUS_POLL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') checkAuthStatus(false);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  
  // Platform detection for Linux vs Windows copy and Start Desktop App button
  useEffect(() => {
    chrome.runtime.getPlatformInfo?.().then((info) => {
      setPlatformOs(info.os as 'linux' | 'mac' | 'win')
    }).catch(() => setPlatformOs(null))
  }, [])

  // Open wrdesk.com when logged out (once per sidepanel open, no tab spam)
  const hasTriedOpeningWrdeskRef = useRef(false);
  useEffect(() => {
    // Only trigger when isLoggedIn is definitively false (not null/loading)
    // And only once per sidepanel open (tracked by ref)
    if (isLoggedIn === false && !hasTriedOpeningWrdeskRef.current) {
      hasTriedOpeningWrdeskRef.current = true;
      chrome.runtime.sendMessage({ type: 'OPEN_WRDESK_HOME_IF_NEEDED' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[AUTH] Sidepanel: Failed to open wrdesk.com:', chrome.runtime.lastError.message);
        } else {
        }
      });
    }
  }, [isLoggedIn]);
  
  // Handle Sign In click
  const handleAuthSignIn = () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setLoginError(null);
    setElectronNotRunning(false);
    chrome.runtime.sendMessage({ type: 'AUTH_LOGIN' }, (response) => {
      setIsLoggingIn(false);
      if (response?.ok) {
        setLoginError(null);
        setIsLoggedIn(true);
        // Fetch updated user info
        chrome.runtime.sendMessage({ type: 'AUTH_STATUS', forceRefresh: true }, (statusResponse: { loggedIn?: boolean; displayName?: string; email?: string; initials?: string; picture?: string } | undefined) => {
          if (statusResponse?.loggedIn) {
            setAuthUserInfo({
              displayName: statusResponse.displayName,
              email: statusResponse.email,
              initials: statusResponse.initials,
              picture: statusResponse.picture,
            });
          }
        });
      } else {
        const reason = response?.error || 'unknown';
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
  
  // Handle Create Account click
  const handleAuthCreateAccount = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_REGISTER_PAGE' });
  };
  
  // Handle Logout click (used by BackendSwitcherInline, but we track state here too)
  const handleAuthLogout = () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    chrome.runtime.sendMessage({ type: 'AUTH_LOGOUT' }, () => {
      setIsLoggingOut(false);
      setIsLoggedIn(false);
      setAuthUserInfo({});
    });
  };
  
  // WR MailGuard state
  const [mailguardTo, setMailguardTo] = useState('')
  const [mailguardCapsulePolicy, setMailguardCapsulePolicy] = useState<CanonicalPolicy | null>(null)
  const [mailguardSubject, setMailguardSubject] = useState('')
  const [mailguardBody, setMailguardBody] = useState('')
  const [mailguardAttachments, setMailguardAttachments] = useState<Array<{name: string, size: number, file: File}>>([])
  const [mailguardBodyHeight, setMailguardBodyHeight] = useState(200)
  
  // ==========================================================================
  // Identity (for fingerprint display in other panels)
  // ==========================================================================

  const [identity, setIdentity] = useState<OurIdentity | null>(null)
  const [identityLoading, setIdentityLoading] = useState(true)

  // Load identity on mount
  useEffect(() => {
    let mounted = true
    setIdentityLoading(true)
    getOurIdentity()
      .then((id) => { if (mounted) setIdentity(id) })
      .catch((err) => { console.error('[Sidepanel] Failed to load identity:', err) })
      .finally(() => { if (mounted) setIdentityLoading(false) })
    return () => { mounted = false }
  }, [])

  // Derived fingerprint values
  const ourFingerprint = identity?.fingerprint || ''
  const ourFingerprintShort = identity ? formatFingerprintShort(identity.fingerprint) : '...'

  const replyComposerConfig = useMemo(() => {
    const generate = async (prompt: string): Promise<string> => {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'BEAP_GENERATE_DRAFT', prompt },
          (response: { ok?: boolean; data?: { content?: string }; error?: string } | undefined) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError?.message ?? 'Draft generation failed'))
              return
            }
            if (response?.ok && response?.data?.content != null) {
              resolve(response.data.content)
            } else {
              reject(new Error(response?.error ?? 'Draft generation failed'))
            }
          }
        )
      })
    }
    return {
      senderFingerprint: ourFingerprint,
      senderFingerprintShort: ourFingerprintShort,
      aiProvider: createBeapReplyAiProvider(generate),
      policy: { allowSemanticProcessing: true, allowActuatingProcessing: false },
    }
  }, [ourFingerprint, ourFingerprintShort])
  
  // BEAP Handshake Request delivery state (used in draft panels)
  const [handshakeDelivery, setHandshakeDelivery] = useState<'email' | 'download' | 'p2p'>('p2p')
  const [handshakeTo, setHandshakeTo] = useState('')
  const [handshakeSubject, setHandshakeSubject] = useState('Request to Establish BEAP™ Secure Communication Handshake')
  const [handshakeMessage, setHandshakeMessage] = useState('')
  const [fingerprintCopied, setFingerprintCopied] = useState(false)

  // BEAP Draft message state (separate from handshake message)
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

  // Active handshakes for recipient selection in BEAP draft (private/qBEAP mode)
  const {
    handshakes,
    loading: handshakesLoading,
    error: handshakesError,
    refresh: refreshHandshakes,
  } = useHandshakes('active')

  // Load available sessions for Draft Email session selector
  // Sessions are stored in chrome.storage.local (same as Sessions History modal)
  const loadAvailableSessions = useCallback(() => {
    chrome.storage.local.get(null, (allData) => {
      if (chrome.runtime.lastError) {
        console.warn('[BEAP Sessions] Error:', chrome.runtime.lastError.message)
        setAvailableSessions([])
        return
      }
      
      // Filter for session keys (format: session_*)
      const sessionEntries = Object.entries(allData).filter(([key]) => key.startsWith('session_'))
      
      if (sessionEntries.length === 0) {
        setAvailableSessions([])
        return
      }
      
      const sessions: SessionOption[] = sessionEntries
        .map(([key, data]: [string, any]) => {
          const name = sessionListLabel(data, key)
          const timestamp = data?.timestamp || data?.lastOpenedAt || data?.createdAt || ''
          return { key, name, timestamp }
        })
        .filter(s => s.key)
        .sort((a, b) => {
          // Sort by timestamp descending (newest first)
          const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0
          const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0
          return timeB - timeA
        })
      
      setAvailableSessions(sessions)
    })
  }, [])
  
  // Load sessions on mount
  useEffect(() => {
    loadAvailableSessions()
  }, [loadAvailableSessions])

  useEffect(() => {
    sessionKeyRef.current = sessionKey
  }, [sessionKey])

  /** When a session display name is renamed in another surface (e.g. Sessions History), refresh labels + dropdowns. */
  useEffect(() => {
    const onDisplayName = (msg: { type?: string; sessionKey?: string; displayName?: string }) => {
      if (msg?.type !== 'SESSION_DISPLAY_NAME_UPDATED') return
      const sk = msg.sessionKey
      const dn = msg.displayName
      if (typeof sk !== 'string' || typeof dn !== 'string') return
      if (sessionKeyRef.current === sk) {
        setSessionName(dn)
      }
      loadAvailableSessions()
    }
    chrome.runtime.onMessage.addListener(onDisplayName as Parameters<typeof chrome.runtime.onMessage.addListener>[0])
    return () => chrome.runtime.onMessage.removeListener(onDisplayName as Parameters<typeof chrome.runtime.onMessage.addListener>[0])
  }, [loadAvailableSessions])
  
  // Refresh sessions when window gets focus (to catch newly created sessions)
  useEffect(() => {
    const handleFocus = () => loadAvailableSessions()
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [loadAvailableSessions])
  
  // Clear encrypted message when switching from private to public mode
  useEffect(() => {
    if (beapRecipientMode === 'public') {
      setBeapDraftEncryptedMessage('')
    }
  }, [beapRecipientMode])
  
  // BEAP Message sending state
  const [isSendingBeap, setIsSendingBeap] = useState(false)
  /** P2P queue backoff: block Send until this time (ms since epoch) */
  const [beapP2pCooldownUntilMs, setBeapP2pCooldownUntilMs] = useState<number | null>(null)
  /** P2P: relay accepted HTTP post but recipient ingest not confirmed — non-terminal pending banner */
  const [beapP2pRelayPendingMessage, setBeapP2pRelayPendingMessage] = useState<string | null>(null)
  
  // Handler for sending BEAP messages (shared across all Draft views)
  const handleSendBeapMessage = async () => {
    // Validate preconditions
    if (beapRecipientMode === 'private' && !selectedRecipient) {
      setNotification(beapUiValidationFailure('Please select a handshake recipient'))
      setTimeout(() => setNotification(null), 3000)
      return
    }
    
    if (!beapDraftMessage.trim()) {
      setNotification(
        beapUiValidationFailure('BEAP™ Message (required): enter the public capsule text before sending.'),
      )
      setTimeout(() => setNotification(null), 5000)
      return
    }

    if (beapDraftAttachments.some((a) => a.processing?.parsing)) {
      setNotification(
        beapUiValidationFailure('Wait for attachment extraction to finish before sending.'),
      )
      setTimeout(() => setNotification(null), 10000)
      return
    }

    if (beapDraftAttachments.some((a) => a.processing?.error)) {
      setNotification(
        beapUiValidationFailure(
          'One or more attachments failed extraction. Fix or remove them before sending.',
        ),
      )
      setTimeout(() => setNotification(null), 10000)
      return
    }

    const useHandshakeRefresh =
      handshakeDelivery === 'email' &&
      beapRecipientMode === 'private' &&
      selectedRecipient &&
      'handshake_id' in selectedRecipient

    if (useHandshakeRefresh && beapDraftAttachments.length > 0) {
      setNotification(
        beapUiValidationFailure(
          'Attachments cannot be sent via handshake refresh. Remove attachments or use standard BEAP delivery (P2P, download, or email with full package).',
        ),
      )
      setTimeout(() => setNotification(null), 5000)
      return
    }

    const pdfUnready = beapDraftAttachments.filter(
      (a) =>
        (a.mime?.toLowerCase() === 'application/pdf' ||
          a.name?.toLowerCase().endsWith('.pdf')) &&
        !a.capsuleAttachment?.semanticExtracted,
    )
    if (pdfUnready.length > 0) {
      setNotification(
        beapUiValidationFailure(
          'PDF attachments must finish extraction before send, or remove them.',
        ),
      )
      setTimeout(() => setNotification(null), 10000)
      return
    }

    setIsSendingBeap(true)
    let toastClearMs = 3000

    try {
      // Download/messenger: always use package builder + executeDeliveryAction (never handshake.refresh)
      // Email + private: use handshake.refresh RPC for direct delivery
      if (useHandshakeRefresh) {
        const hsRecipient = selectedRecipient as any
        const hsId = hsRecipient.handshake_id as string
        const accountId = selectedEmailAccountId || 'default'
        
        const result = await sendViaHandshakeRefresh(hsId, { text: beapDraftMessage }, accountId)
        
        if (result.success) {
          setBeapP2pRelayPendingMessage(null)
          setNotification({ message: 'BEAP™ Message sent via handshake!', type: 'info' })
          setBeapDraftTo('')
          setBeapDraftMessage('')
          setBeapDraftEncryptedMessage('')
          setBeapDraftSessionId('')
          setBeapDraftReaderModalId(null)
          setBeapDraftAttachments([])
          setSelectedRecipient(null)
        } else {
          const err = result.error || 'Failed to send message'
          setNotification({
            message: err,
            type: 'error',
            clientSendFailureDebug: {
              kind: 'client_send_failure',
              phase: 'p2p_transport',
              message: err,
            },
          })
        }
      } else {
        // Legacy path: use the package builder + delivery service
        const capsuleAttachments = beapDraftAttachments.map(a => a.capsuleAttachment)
        const originalFiles: BeapPackageConfig['originalFiles'] = beapDraftAttachments.map(att => ({
          attachmentId: att.id,
          filename: att.name,
          mime: att.mime,
          base64: att.dataBase64
        }))
        const config: BeapPackageConfig = {
          recipientMode: beapRecipientMode,
          deliveryMethod: handshakeDelivery as DeliveryMethod,
          selectedRecipient,
          senderFingerprint: ourFingerprint,
          senderFingerprintShort: ourFingerprintShort,
          emailTo: beapDraftTo,
          subject: 'BEAP™ Message',
          messageBody: beapDraftMessage,
          attachments: capsuleAttachments,
          originalFiles: originalFiles.length > 0 ? originalFiles : undefined,
          ...(beapRecipientMode === 'private' && {
            encryptedMessage: beapDraftEncryptedMessage.trim() || undefined
          })
        }
        
        if (beapRecipientMode === 'private' && !beapDraftEncryptedMessage.trim()) {
          console.warn('[BEAP Builder] qBEAP private build without encryptedMessage: using transport plaintext only')
        }
        
        const result = await executeDeliveryAction(config)

        const sendOk = result.success && result.delivered !== false

        if (sendOk) {
          setBeapP2pCooldownUntilMs(null)
          setBeapP2pRelayPendingMessage(null)
          if (handshakeDelivery === 'p2p') {
          }
          const actionLabel =
            handshakeDelivery === 'download'
              ? 'BEAP capsule downloaded'
              : handshakeDelivery === 'p2p'
                ? 'Message sent'
                : 'BEAP™ Message sent!'
          setNotification({
            message: actionLabel,
            type: 'success',
          })
          setBeapDraftTo('')
          setBeapDraftMessage('')
          setBeapDraftEncryptedMessage('')
          setBeapDraftSessionId('')
          setBeapDraftReaderModalId(null)
          setBeapDraftAttachments([])
          setSelectedRecipient(null)
        } else if (!result.success) {
          console.error(
            '[BEAP-SEND] Delivery failed — full debug:',
            JSON.stringify({
              message: result.message,
              action: result.action,
              clientSendFailureDebug: result.clientSendFailureDebug,
              outbound_debug: result.p2pOutboundDebug,
            }),
          )
          if (result.code === 'REQUEST_INVALID' || result.code === 'PAYLOAD_TOO_LARGE') {
            setBeapP2pCooldownUntilMs(null)
          } else if (handshakeDelivery === 'p2p' && typeof result.p2pCooldownUntilMs === 'number') {
            setBeapP2pCooldownUntilMs(result.p2pCooldownUntilMs)
            const delay = Math.max(0, result.p2pCooldownUntilMs - Date.now())
            window.setTimeout(() => setBeapP2pCooldownUntilMs(null), delay + 250)
          }
          const isBackoff =
            result.code === 'BACKOFF_WAIT' ||
            (result.message?.includes('waiting before retry') ?? false)
          if (isBackoff) toastClearMs = 9000
          if (result.p2pOutboundDebug) toastClearMs = Math.max(toastClearMs, 12000)
          if (result.clientSendFailureDebug) toastClearMs = Math.max(toastClearMs, 12000)
          const failMsg = result.message || 'Failed to send message'
          setNotification({
            message: failMsg,
            type: isBackoff ? 'info' : 'error',
            ...(result.p2pOutboundDebug && { p2pOutboundDebug: result.p2pOutboundDebug }),
            ...(result.clientSendFailureDebug && { clientSendFailureDebug: result.clientSendFailureDebug }),
            ...(!result.p2pOutboundDebug &&
              !result.clientSendFailureDebug && {
                clientSendFailureDebug: {
                  kind: 'client_send_failure',
                  phase: 'p2p_transport',
                  message: failMsg,
                },
              }),
          })
        }
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'An unexpected error occurred'
      console.error('[BEAP-SEND] Send exception — full debug:', raw, error)
      const isTechnical = /^(TypeError|ReferenceError|SyntaxError|undefined|null is not)/i.test(raw)
      setNotification({
        message: isTechnical ? 'Something went wrong. Please try again.' : raw,
        type: 'error',
        clientSendFailureDebug: {
          kind: 'client_send_failure',
          phase: 'send_exception',
          message: raw,
        },
      })
      toastClearMs = 12000
    } finally {
      setIsSendingBeap(false)
      if (toastClearMs > 0) {
        setTimeout(() => setNotification(null), toastClearMs)
      }
    }
  }
  
  // Get button label based on delivery method
  const getBeapSendButtonLabel = () => {
    if (isSendingBeap) return '⏳ Processing...'
    if (
      handshakeDelivery === 'p2p' &&
      beapP2pCooldownUntilMs != null &&
      Date.now() < beapP2pCooldownUntilMs
    ) {
      return '⏳ Cooldown…'
    }
    switch (handshakeDelivery) {
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
    beapDraftAttachments.some((a) => a.processing?.parsing) ||
    (handshakeDelivery === 'p2p' &&
      beapP2pCooldownUntilMs != null &&
      Date.now() < beapP2pCooldownUntilMs)
  
  const [isResizingMailguard, setIsResizingMailguard] = useState(false)
  const mailguardFileRef = useRef<HTMLInputElement>(null)
  
  // Email Gateway state
  const [emailAccounts, setEmailAccounts] = useState<Array<{
    id: string
    displayName: string
    email: string
    provider: 'gmail' | 'microsoft365' | 'zoho' | 'imap'
    status: 'active' | 'error' | 'disabled'
    lastError?: string
  }>>([])
  const [emailAccountsLoadError, setEmailAccountsLoadError] = useState<string | null>(null)
  const defaultEmailAccountRowId = useMemo(
    () => pickDefaultEmailAccountRowId(emailAccounts),
    [emailAccounts],
  )
  const [isLoadingEmailAccounts, setIsLoadingEmailAccounts] = useState(false)
  const [masterTabId, setMasterTabId] = useState<string | null>(null) // For Master Tab (01), (02), (03), etc. (01 = first tab, doesn't show title in UI)
  const [showTriggerPrompt, setShowTriggerPrompt] = useState<{
    mode: string
    rect: any
    displayId?: number
    imageUrl: string
    videoUrl?: string
    createTrigger: boolean
    addCommand: boolean
    name?: string
    command?: string
    bounds?: any
  } | null>(null)
  /** Default on: area capture should open the Save dialog ready to save a tag + optional command (WR Chat product default). */
  const [createTriggerChecked, setCreateTriggerChecked] = useState(true)
  const [addCommandChecked, setAddCommandChecked] = useState(true)
  const chatRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const diffDialogOpenRef = useRef<(() => void) | null>(null)
  
  // Pending trigger state - for auto-processing after screenshot capture
  // Using REF instead of state to avoid stale closure issues in message handlers
  const pendingTriggerRef = useRef<{
    trigger: any
    command?: string
    autoProcess: boolean
  } | null>(null)
  /** When a tag-trigger result was applied to WR Chat (HTTP path or SELECTION_RESULT) — drops duplicate WS/storage delivery within 10s. */
  const sidepanelTagResultConsumedAtRef = useRef(0)
  /** Queued folder-diff lines when LLM is busy — flushed when `isLlmLoading` becomes false. */
  const diffMessageQueueRef = useRef<string[]>([])

  const handleSendMessageWithTriggerRef = useRef<
    (displayTextForChat: string, imageUrl?: string, routingText?: string) => Promise<void>
  | null>(null)

  /** Tags flow after headless capture — used from runtime.onMessage and storage fallback (SW → sidepanel delivery). */
  const processElectronSelectionForTagsRef = useRef<
    (message: { promptContext?: string; dataUrl?: string; url?: string }) => void
  >(() => {})

  // LLM state
  const [activeLlmModel, setActiveLlmModel] = useState<string>('')
  const [availableModels, setAvailableModels] = useState<Array<{ name: string; size?: string }>>([])
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  
  // Refs to store latest values for use in message handlers (avoids stale closure)
  const activeLlmModelRef = useRef<string>('')
  const sessionNameRef = useRef<string>('')
  const connectionStatusRef = useRef<{ isConnected: boolean }>({ isConnected: false })
  
  // Keep refs in sync with state (updates on every render)
  // This ensures message handlers always have access to latest values
  useEffect(() => {
    sessionNameRef.current = sessionName
    connectionStatusRef.current = connectionStatus
  })
  
  // Load email accounts from Electron via WebSocket
  const loadEmailAccounts = async () => {
    setIsLoadingEmailAccounts(true)
    setEmailAccountsLoadError(null)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EMAIL_LIST_ACCOUNTS',
      })
      if (!response || typeof response !== 'object') {
        setEmailAccountsLoadError('No response from the extension when loading email accounts.')
        return
      }
      if ('ok' in response && response.ok === false) {
        const r = response as { error?: string; errorCode?: string }
        const parts = [r.error, r.errorCode].filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        setEmailAccountsLoadError(
          parts.length ? parts.join(' — ') : 'Could not load accounts from WR Desk™ (desktop app unreachable or request failed).',
        )
        return
      }
      if (!('ok' in response) || response.ok !== true) {
        setEmailAccountsLoadError('Unexpected response when loading email accounts.')
        return
      }
      const persistence = (response as { persistence?: {
        load: { ok: true; fileMissing?: boolean } | { ok: false; phase: string; message: string }
        credentialDecryptIssues?: { accountId: string; kind: string; message: string }[]
      } }).persistence
      const hints: string[] = []
      if (persistence?.load && !persistence.load.ok) {
        const L = persistence.load as { phase: string; message: string }
        hints.push(
          L.phase === 'read'
            ? `Could not read saved accounts file: ${L.message}`
            : `Saved accounts file is invalid: ${L.message}`,
        )
      }
      if (persistence?.credentialDecryptIssues?.length) {
        hints.push(
          `${persistence.credentialDecryptIssues.length} account(s) have credentials that could not be decrypted — reconnect in WR Desk™.`,
        )
      }
      if (persistence && 'secureStorageAvailable' in persistence && persistence.secureStorageAvailable === false) {
        hints.push(
          'OS secure storage is unavailable. Adding or updating accounts in WR Desk™ may fail until the OS profile allows DPAPI / keychain.',
        )
      }
      const rowsUnknown = (response as { data?: unknown }).data
      if (!Array.isArray(rowsUnknown)) {
        setEmailAccounts([])
        setEmailAccountsLoadError(hints.join(' ') || 'WR Desk™ returned no account list.')
        return
      }
      if (
        rowsUnknown.length === 0 &&
        persistence?.load &&
        persistence.load.ok === true &&
        persistence.load.fileMissing === true
      ) {
        hints.push('No saved accounts file in WR Desk™ yet — connect an account from the desktop app first.')
      } else if (
        rowsUnknown.length === 0 &&
        persistence?.load &&
        persistence.load.ok === true &&
        !persistence.load.fileMissing
      ) {
        hints.push('WR Desk™ saved accounts file lists no accounts.')
      }
      const rows = rowsUnknown as Array<{
        id: string
        displayName?: string
        email: string
        provider?: string
        status?: string
        lastError?: string
      }>
      setEmailAccounts(
        rows.map((a) => {
          const p = a.provider
          const provider: 'gmail' | 'microsoft365' | 'zoho' | 'imap' =
            p === 'gmail'
              ? 'gmail'
              : p === 'microsoft365'
                ? 'microsoft365'
                : p === 'zoho'
                  ? 'zoho'
                  : 'imap'
          const st = a.status
          const status: 'active' | 'error' | 'disabled' =
            st === 'active' ? 'active' : st === 'disabled' ? 'disabled' : 'error'
          return {
            id: a.id,
            displayName: a.displayName ?? a.email,
            email: a.email,
            provider,
            status,
            lastError: a.lastError,
          }
        }),
      )
      setEmailAccountsLoadError(hints.length ? hints.join(' ') : null)
    } catch (err) {
      console.error('[Sidepanel] Failed to load email accounts:', err)
      setEmailAccountsLoadError(err instanceof Error ? err.message : 'Could not load email accounts.')
    } finally {
      setIsLoadingEmailAccounts(false)
    }
  }

  const emailAccountsFetchErrorEl = useMemo(() => {
    if (!emailAccountsLoadError?.trim() || isLoadingEmailAccounts) return null
    const isStd = theme === 'standard'
    return (
      <div
        style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 8,
          fontSize: 12,
          lineHeight: 1.4,
          background: isStd ? 'rgba(220,38,38,0.08)' : 'rgba(248,113,113,0.12)',
          border: `1px solid ${isStd ? 'rgba(220,38,38,0.35)' : 'rgba(248,113,113,0.35)'}`,
          color: isStd ? '#991b1b' : '#fecaca',
        }}
      >
        <strong style={{ display: 'block', marginBottom: 4 }}>Could not refresh email accounts</strong>
        {emailAccountsLoadError}
      </div>
    )
  }, [emailAccountsLoadError, isLoadingEmailAccounts, theme])

  const { openConnectEmail, connectEmailFlowModal } = useConnectEmailFlow({
    onAfterConnected: loadEmailAccounts,
    theme: theme === 'standard' ? 'professional' : 'default',
  })
  
  // Load email accounts when BEAP Messages workspace is selected
  useEffect(() => {
    if (dockedWorkspace === 'beap-messages') {
      loadEmailAccounts()
    }
  }, [dockedWorkspace])
  
  // Disconnect email account
  const disconnectEmailAccount = async (accountId: string) => {
    try {
      const response = await chrome.runtime.sendMessage({ 
        type: 'EMAIL_DELETE_ACCOUNT',
        accountId
      })
      if (response?.ok) {
        loadEmailAccounts()
        setNotification({ message: 'Account disconnected', type: 'info' })
        setTimeout(() => setNotification(null), 3000)
      }
    } catch (err) {
      console.error('[Sidepanel] Failed to disconnect account:', err)
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
        setNotification({ message: paused ? 'Sync paused' : 'Sync resumed', type: 'info' })
        setTimeout(() => setNotification(null), 2500)
      } else {
        setNotification({ message: String(response?.error ?? 'Could not update account'), type: 'error' })
        setTimeout(() => setNotification(null), 4000)
      }
    } catch (err) {
      console.error('[Sidepanel] Failed to set processing paused:', err)
      setNotification({ message: 'Could not update account', type: 'error' })
      setTimeout(() => setNotification(null), 4000)
    }
  }
  
  const [isLlmLoading, setIsLlmLoading] = useState(false)
  const [llmError, setLlmError] = useState<string | null>(null)
  const [llmRefreshTrigger, setLlmRefreshTrigger] = useState(0)
  
  // Function to refresh available models (uses electronRpc for auth — direct fetch gets 401)
  const refreshAvailableModels = async () => {
    try {
      const result: ElectronRpcResponse = await electronRpc('llm.status')
      const inner = unwrapLlmStatusPayload(result.data)
      const outer = result.data as { ok?: boolean } | undefined
      const statusResult =
        result.success && inner != null
          ? { ok: outer?.ok ?? result.success, data: inner }
          : { ok: false, data: null as LlmStatusData | null }
      
      const modelsList = statusResult.ok ? statusResult.data?.modelsInstalled : undefined
      if (modelsList && modelsList.length > 0) {
        const models = modelsList
        setAvailableModels(models)
        
        // Only set active model if not already set OR if current selection no longer exists
        const currentModel = activeLlmModelRef.current || activeLlmModel
        const modelStillExists = models.some((m: any) => m.name === currentModel)
        
        if (!currentModel || !modelStillExists) {
          // Prefer gemma if available, otherwise use first model
          const gemmaModel = models.find((m: any) => m.name.toLowerCase().includes('gemma'))
          const selectedModel = gemmaModel ? gemmaModel.name : models[0].name
          setActiveLlmModel(selectedModel)
          activeLlmModelRef.current = selectedModel
          try { localStorage.setItem('optimando-wr-chat-active-model', selectedModel) } catch {}
        }
        setLlmError(null)
        return true
      }
      return false
    } catch (error) {
      console.error('[Command Chat] Failed to refresh models:', error)
      return false
    }
  }
  
  // Auto-detect first available LLM model on mount and when triggered
  useEffect(() => {
    const fetchFirstAvailableModel = async () => {
      try {
        const result: ElectronRpcResponse = await electronRpc('llm.status')
        const inner = unwrapLlmStatusPayload(result.data)
        const outer = result.data as { ok?: boolean } | undefined
        const statusResult =
          result.success && inner != null
            ? { ok: outer?.ok ?? result.success, data: inner }
            : { ok: false, data: null as LlmStatusData | null }
        
        if (!statusResult.ok || !statusResult.data) {
          setLlmError('LLM service not available')
          return
        }
        
        const status = statusResult.data
        
        // If Ollama is not installed or not running
        if (!status.installed || !status.running) {
          setLlmError('Ollama not running. Please start it from LLM Settings.')
          return
        }
        
        // Check if any models are installed
        if (status.modelsInstalled && status.modelsInstalled.length > 0) {
          setAvailableModels(status.modelsInstalled)
          
          // Only set model if not already set
          const currentModel = activeLlmModelRef.current || activeLlmModel
          const modelExists = status.modelsInstalled.some((m: any) => m.name === currentModel)
          
          if (!currentModel || !modelExists) {
            // Prefer gemma if available, otherwise use first model
            const gemmaModel = status.modelsInstalled.find((m: any) => m.name.toLowerCase().includes('gemma'))
            const selectedModel = gemmaModel ? gemmaModel.name : status.modelsInstalled[0].name
            setActiveLlmModel(selectedModel)
            activeLlmModelRef.current = selectedModel
            try { localStorage.setItem('optimando-wr-chat-active-model', selectedModel) } catch {}
          }
          setLlmError(null)
        } else {
          // No models installed - show message but DON'T auto-install
          setLlmError('No models installed. Please go to Backend Configuration → LLM tab to install a model.')
        }
      } catch (error: any) {
        console.error('[Command Chat] Failed to fetch available models:', error)
        setLlmError('Failed to connect to LLM service')
      }
    }
    
    fetchFirstAvailableModel()
  }, [llmRefreshTrigger])
  
  // Periodic fallback check for newly installed models.
  // Model-install events are already handled by the chrome.storage listener below;
  // this only covers out-of-band changes (e.g. terminal ollama pull). 2-minute cadence
  // keeps /api/llm/status → ollamaManager.listModels() from running every 10 s and
  // keeping Gemma/Llama hot in VRAM while the user is idle.
  useEffect(() => {
    const interval = setInterval(() => {
      refreshAvailableModels()
    }, 120000) // 2 minutes — was 10 s (caused continuous listModels spam)
    
    return () => clearInterval(interval)
  }, [])
  
  // Listen for model installation events from LLM Settings
  useEffect(() => {
    const handleStorageChange = (changes: any, namespace: string) => {
      if (namespace === 'local' && changes['llm-model-installed']) {
        setLlmRefreshTrigger(prev => prev + 1)
      }
    }
    
    chrome.storage?.onChanged?.addListener(handleStorageChange)
    
    return () => {
      chrome.storage?.onChanged?.removeListener(handleStorageChange)
    }
  }, [])
  
  // Close model dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showModelDropdown) {
        setShowModelDropdown(false)
      }
    }
    
    if (showModelDropdown) {
      // Use setTimeout to avoid closing immediately when opening
      setTimeout(() => {
        document.addEventListener('click', handleClickOutside)
      }, 0)
    }
    
    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [showModelDropdown])
  
  // NOTE: Screenshot trigger processing is now handled directly in the chrome.runtime message listener
  // This avoids stale closure issues that occurred with the useEffect + custom event pattern
  
  // Process screenshot with trigger - uses refs to avoid stale closure issues
  // This is called from the message listener when a screenshot arrives with a pending trigger
  const processScreenshotWithTrigger = async (triggerText: string, imageUrl: string) => {
    // Single user bubble for this path (Tags auto-process): text + image together — not from ELECTRON_SELECTION_RESULT.
    const userLine = (triggerText || '').trim() || '[Screenshot]'
    setChatMessages(prev => [...prev, { role: 'user' as const, text: userLine, imageUrl }])
    setTimeout(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
    }, 0)

    const resolveWrChatModelId = (): string => {
      const m = getEffectiveLlmModelNameForActiveMode(activeLlmModelRef.current, activeLlmModel)
      if (m) return m
      const first = availableModels[0]?.name
      if (first) return first
      try {
        const w = (window as unknown as { llm?: { models?: Array<{ id?: string; name?: string }> } }).llm?.models?.[0]
        return ((w?.id || w?.name) as string) || ''
      } catch {
        return ''
      }
    }
    const currentModel = resolveWrChatModelId()
    
    if (!currentModel) {
      console.warn('[Sidepanel] No LLM model available for trigger processing')
      setChatMessages(prev => [...prev, {
        role: 'assistant' as const,
        text: `⚠️ No LLM model available. Please install a model in LLM Settings.`
      }])
      return
    }
    
    setIsLlmLoading(true)
    
    try {
      const baseUrl = 'http://127.0.0.1:51248'
      
      // Get current URL for website filtering
      let currentUrl = ''
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        currentUrl = tab?.url || ''
      } catch (e) {}
      
      // Import routing functions dynamically to avoid circular deps
      const { routeInput, loadAgentsFromSession, wrapInputForAgent, updateAgentBoxOutput, getButlerSystemPrompt, resolveModelForAgent } = await import('./services/processFlow')
      
      // Use refs for values to avoid stale closures
      const currentConnectionStatus = connectionStatusRef.current
      const currentSessionName = sessionNameRef.current
      
      // OCR before routing: extract text from screenshot first
      // Resolve the image URL (already a data: URL from trigger path, but guard defensively).
      const resolvedScreenshotUrl = await resolveImageUrlForBackend(imageUrl)
      const screenshotVisionB64: string | null = (() => {
        const b64 = resolvedScreenshotUrl ? toBase64ForOllama(resolvedScreenshotUrl) : null
        return isPlausibleVisionBase64(b64) ? b64 : null
      })()
      let ocrText = ''
      if (resolvedScreenshotUrl) {
        ocrText = await runOcrForCurrentTurn(resolvedScreenshotUrl, baseUrl)
      }

      const enrichedTriggerText = enrichRouteTextWithOcr(triggerText, ocrText)
      const sessionKeyForRouteScreenshot = getActiveCustomModeRuntime()?.sessionId?.trim() || sessionKey
      const mergedContextPrefixScreenshot = mergeLlmContextPrefixes(
        getChatFocusLlmPrefix(useChatFocusStore.getState()),
        getCustomModeLlmPrefix(getActiveCustomModeRuntime()),
      )
      const enrichedRouteTextForScreenshot = mergedContextPrefixScreenshot
        ? `${mergedContextPrefixScreenshot}\n\n${enrichedTriggerText}`
        : enrichedTriggerText

      // Route the input with OCR-enriched text
      const routingDecision = await routeInput(
        enrichedRouteTextForScreenshot,
        true, // hasImage = true (screenshot always has image)
        currentConnectionStatus,
        currentSessionName,
        currentModel,
        currentUrl,
        sessionKeyForRouteScreenshot
      )
      
      
      if (routingDecision.shouldForwardToAgent && routingDecision.matchedAgents.length > 0) {
        // Show butler confirmation
        setChatMessages(prev => [...prev, {
          role: 'assistant' as const,
          text: routingDecision.butlerResponse
        }])
        
        // Process with each matched agent
        const agents = await loadAgentsFromSession(sessionKeyForRouteScreenshot)
        
        for (const match of routingDecision.matchedAgents) {
          const agent = agents.find(a => a.id === match.agentId)
          if (!agent) {
            console.warn('[Sidepanel] Agent not found:', match.agentId)
            continue
          }
          
          const wrappedInput = wrapInputForAgent(triggerText, agent, ocrText)
          
          // Resolve model - use agent box model if configured, otherwise use current model
          const modelResolution: BrainResolution = resolveModelForAgent(
            match.agentBoxProvider,
            match.agentBoxModel,
            currentModel
          )
          
          
          if (!modelResolution.ok) {
            const errorMsg = `⚠️ Brain resolution failed for ${match.agentName}:\n${modelResolution.error}`
            console.warn('[Sidepanel] Brain resolution error:', modelResolution)
            if (match.agentBoxId) {
              await updateAgentBoxOutput(match.agentBoxId, errorMsg, `Agent: ${match.agentName} | Error: ${modelResolution.errorType}`, sessionKeyForRouteScreenshot, 'sidepanel')
            }
            setChatMessages(prev => [...prev, { role: 'assistant' as const, text: errorMsg }])
            continue
          }
          
          try {
            const llmMessages = [
              { role: 'system', content: wrappedInput },
              { role: 'user', content: enrichedTriggerText },
            ]
            const { body: llmBody, error: keyError } = await buildLlmRequestBody(
              modelResolution as BrainResolution & { ok: true },
              llmMessages
            )
            if (keyError) {
              const keyMsg = `⚠️ ${match.agentName}: ${keyError}`
              if (match.agentBoxId) await updateAgentBoxOutput(match.agentBoxId, keyMsg, `Missing API key`, sessionKeyForRouteScreenshot, 'sidepanel')
              setChatMessages(prev => [...prev, { role: 'assistant' as const, text: keyMsg }])
              continue
            }

            // Ensure launch secret is fresh before the LLM call (handles SW sleep/wake)
            await ensureLaunchSecret()

            const agentResponse: Response = await fetch(`${baseUrl}/api/llm/chat`, {
              method: 'POST',
              headers: electronFetchHeaders(),
              body: JSON.stringify({
                ...llmBody,
                ...(screenshotVisionB64 ? { images: [screenshotVisionB64] } : {}),
              }),
              signal: AbortSignal.timeout(600000),
            })
            
            if (agentResponse.ok) {
              const agentResult = await agentResponse.json()
              if (agentResult.ok && agentResult.data?.content) {
                const agentOutput = agentResult.data.content
                
                const allBoxIds = match.targetBoxIds && match.targetBoxIds.length > 0
                  ? match.targetBoxIds
                  : match.agentBoxId ? [match.agentBoxId] : []

                if (allBoxIds.length > 0) {
                  const reasoningContext = `**Agent:** ${match.agentIcon} ${match.agentName}\n**Match:** ${match.matchDetails}\n**Input:** ${triggerText}`
                  
                  for (const boxId of allBoxIds) {
                    await updateAgentBoxOutput(boxId, agentOutput, reasoningContext, sessionKey, 'sidepanel')
                  }
                  
                  setChatMessages(prev => [...prev, {
                    role: 'assistant' as const,
                    text: `[Agent: ${match.agentName}] responded. See agent box.`,
                  }])
                } else {
                  setChatMessages(prev => [...prev, {
                    role: 'assistant' as const,
                    text: `${match.agentIcon} **${match.agentName}**:\n\n${agentOutput}`
                  }])
                }
              } else {
                console.error('[Sidepanel] Agent LLM response not ok:', agentResult)
              }
            } else {
              console.error('[Sidepanel] Agent LLM request failed:', agentResponse.status)
            }
          } catch (llmError) {
            console.error('[Sidepanel] Agent LLM error:', llmError)
          }
        }
      } else {
        // No agent match - use butler response
        const agents = await loadAgentsFromSession(sessionKey)
        const butlerPrompt = getButlerSystemPrompt(
          currentSessionName,
          agents.filter(a => a.enabled).length,
          currentConnectionStatus.isConnected
        )
        
        try {
          const butlerResponse: Response = await fetch(`${baseUrl}/api/llm/chat`, {
            method: 'POST',
            headers: electronFetchHeaders(),
            body: JSON.stringify({
              modelId: currentModel,
              messages: [
                { role: 'system', content: butlerPrompt },
                { role: 'user', content: enrichedTriggerText },
              ],
              ...(screenshotVisionB64 ? { images: [screenshotVisionB64] } : {}),
            }),
            signal: AbortSignal.timeout(600000),
          })
          
          if (butlerResponse.ok) {
            const result = await butlerResponse.json()
            if (result.ok && result.data?.content) {
              setChatMessages(prev => [...prev, {
                role: 'assistant' as const,
                text: result.data.content
              }])
            }
          }
        } catch (e) {
          console.error('[Sidepanel] Butler response error:', e)
        }
      }
    } catch (error) {
      console.error('[Sidepanel] Error processing screenshot with trigger:', error)
      setChatMessages(prev => [...prev, {
        role: 'assistant' as const,
        text: `⚠️ Error processing trigger: ${error instanceof Error ? error.message : 'Unknown error'}`
      }])
    } finally {
      setIsLlmLoading(false)
    }
  }
  
  // Load pinned state and viewMode from storage
  useEffect(() => {
    import('./storage/storageWrapper').then(({ storageGet }) => {
      storageGet(['commandChatPinned', 'viewMode'], (result) => {
        if (result.commandChatPinned !== undefined) {
          setIsCommandChatPinned(result.commandChatPinned)
          
          // If pinned, ensure docked chat is created on the page
          if (result.commandChatPinned) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'CREATE_DOCKED_CHAT' })
              }
            })
          }
        }
        if (result.viewMode) {
          setViewMode(result.viewMode as 'app' | 'admin')
        }
      });
    });
  }, [])

  const applyOrchestratorWrChatPresent = useCallback(async (sessionKey: string) => {
    const sk = sessionKey.trim()
    if (!sk) return
    useUIStore.getState().setWorkspace('wr-chat')
    setDockedWorkspace('wr-chat')
    setDockedSubmode('command')
    setIsCommandChatPinned(true)
    try {
      chrome.storage.local.set({ commandChatPinned: true })
    } catch {
      /* noop */
    }

    chrome.runtime.sendMessage({ type: 'GET_SESSION_FROM_SQLITE', sessionKey: sk }, (response) => {
      if (chrome.runtime.lastError || !response?.success || !response?.session) return
      const session = response.session as {
        tabName?: string
        sessionAlias?: string | null
        isLocked?: boolean
        agentBoxes?: unknown[]
      }
      setSessionName(sessionListLabel(session, 'Session'))
      setSessionKey(sk)
      setIsLocked(session.isLocked || false)
      setAgentBoxes(session.agentBoxes || [])
    })

    let custom = useCustomModesStore.getState().modes.find(
      (m) => m.sessionId && m.sessionId.trim() === sk,
    )
    if (!custom) {
      await new Promise((r) => setTimeout(r, 250))
      custom = useCustomModesStore.getState().modes.find(
        (m) => m.sessionId && m.sessionId.trim() === sk,
      )
    }
    if (custom) {
      useUIStore.getState().setMode(custom.id)
      useChatFocusStore.getState().clearChatFocusMode()
      return
    }

    try {
      const projects = await fetchTriggerProjects()
      const proj = projects.find((p) => (p.linkedSessionIds ?? []).some((id) => id === sk))
      if (proj) {
        useUIStore.getState().setMode('commands')
        const icon = proj.icon?.trim() || '📊'
        const title = proj.title?.trim() || 'Project'
        const mile = proj.activeMilestoneTitle?.trim() || 'No active milestone'
        const intro = `${icon} **Optimization Mode: ${title}**
Active milestone: ${mile}

I'm now focused on optimizing this project. Share context, blockers, or reference materials.`
        useChatFocusStore.getState().setChatFocusWithIntro(
          {
            mode: 'auto-optimizer',
            projectId: proj.projectId,
            projectTitle: title,
            startedAt: new Date().toISOString(),
            projectIcon: icon,
            milestoneTitle: mile !== 'No active milestone' ? mile : undefined,
          },
          { projectTitle: title, activeMilestoneTitle: mile, projectIcon: icon },
          intro,
        )
        return
      }
    } catch {
      /* noop */
    }

    useUIStore.getState().setMode('commands')
    useChatFocusStore.getState().clearChatFocusMode()
  }, [])

  useEffect(() => {
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: chrome.storage.AreaName) => {
      if (area !== 'local') return
      const ch = changes['orchestrator_wrchat_present_request']
      if (!ch?.newValue) return
      const v = ch.newValue as { sessionKey?: string } | null
      const sk = typeof v?.sessionKey === 'string' ? v.sessionKey.trim() : ''
      if (!sk) return
      void chrome.storage.local.remove('orchestrator_wrchat_present_request')
      void applyOrchestratorWrChatPresent(sk)
    }
    chrome.storage.onChanged.addListener(onStorage)
    return () => chrome.storage.onChanged.removeListener(onStorage)
  }, [applyOrchestratorWrChatPresent])

  useEffect(() => {
    chrome.storage.local.get('orchestrator_wrchat_present_request', (r) => {
      const v = r['orchestrator_wrchat_present_request'] as { sessionKey?: string } | undefined
      const sk = typeof v?.sessionKey === 'string' ? v.sessionKey.trim() : ''
      if (!sk) return
      void chrome.storage.local.remove('orchestrator_wrchat_present_request', () => {
        void applyOrchestratorWrChatPresent(sk)
      })
    })
  }, [applyOrchestratorWrChatPresent])

  // Mirror sessionKey to chrome.storage.local so processFlow.ts can discover it
  // (processFlow runs in the sidepanel context but reads from chrome.storage.local)
  useEffect(() => {
    if (sessionKey) {
      try {
        chrome.storage?.local?.set({ 'optimando-active-session-key': sessionKey })
      } catch {}
    }
  }, [sessionKey])

  // Load and listen for theme changes AND session changes
  useEffect(() => {
    // Map stored theme values to valid theme type
    const mapTheme = (t: string): 'pro' | 'dark' | 'standard' => {
      if (t === 'dark') return 'dark'
      if (t === 'standard' || t === 'professional') return 'standard'
      if (t === 'pro' || t === 'default') return 'pro'
      return 'standard'
    }

    // Load initial theme
    import('./storage/storageWrapper').then(({ storageGet }) => {
      storageGet(['optimando-ui-theme'], (result) => {
        const savedTheme = result['optimando-ui-theme'] || 'standard'
        setTheme(mapTheme(savedTheme))
      });
    });

    // Listen for theme changes AND active session key changes
    const handleStorageChange = (changes: any, namespace: string) => {
      if (namespace === 'local') {
        // Handle theme changes
        if (changes['optimando-ui-theme']) {
          const newTheme = changes['optimando-ui-theme'].newValue || 'standard'
          setTheme(mapTheme(newTheme))
        }
        
        // Handle active session key changes - reload session data when session changes
        if (changes['optimando-active-session-key']) {
          const newSessionKey = changes['optimando-active-session-key'].newValue
          
          if (newSessionKey) {
            // Reload session data from SQLite
            chrome.runtime.sendMessage({ type: 'GET_ALL_SESSIONS_FROM_SQLITE' }, (response) => {
              if (chrome.runtime.lastError) {
                console.error('❌ Error reloading sessions from SQLite:', chrome.runtime.lastError.message)
                return
              }
              
              if (!response || !response.success || !response.sessions) {
                return
              }
              
              // Find the session with the new key
              const session = response.sessions[newSessionKey]
              if (session) {
                setSessionName(sessionListLabel(session, 'Unnamed Session'))
                setSessionKey(newSessionKey)
                setIsLocked(session.isLocked || false)
                setAgentBoxes(session.agentBoxes || [])
              } else {
              }
            })
          }
        }
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  // Detect if this is a Master Tab and get its ID, and check if we should show minimal UI
  useEffect(() => {
    const checkTabType = () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id && tabs[0]?.url) {
          const tabId = tabs[0].id
          const storageKey = `masterTabId_${tabId}`
          
          try {
            const url = new URL(tabs[0].url)
            const hybridMasterId = url.searchParams.get('hybrid_master_id')
            const isDisplayGrid = url.pathname.includes('grid-display.html')
            const isEdgeStartpage = url.hostname === 'www.msn.com' || url.hostname === 'msn.com' || url.protocol === 'edge:'
            
            // Check if we should show minimal UI (display grid without master ID, or Edge startpage)
            const shouldShowMinimal = (isDisplayGrid && hybridMasterId === null) || isEdgeStartpage
            setShowMinimalUI(shouldShowMinimal)
            
            // Admin is disabled on display grids and Edge startpage
            setIsAdminDisabled(shouldShowMinimal)
            
            // First, check if we have a stored master tab ID for this tab (persists across page refreshes)
            chrome.storage.local.get([storageKey], (result) => {
              const storedMasterTabId = result[storageKey]
              
              if (hybridMasterId) {
                // Convert hybrid_master_id to display format (Master Tab 01, 02, 03, etc.)
                // Main tab (no hybrid_master_id) = Master Tab 01
                // hybrid_master_id 0 = Master Tab 02, 1 = Master Tab 03, etc.
                const displayId = String(parseInt(hybridMasterId) + 2).padStart(2, '0')
                setMasterTabId(displayId)
                // Store it for this tab so it persists across page refreshes
                chrome.storage.local.set({ [storageKey]: displayId })
              } else if (storedMasterTabId) {
                // No hybrid_master_id in URL, but we have a stored value (page refreshed)
                setMasterTabId(storedMasterTabId)
              } else {
                // No hybrid_master_id and no stored value - this is Master Tab (01)
                setMasterTabId("01")
                // Store it for this tab so it persists across page refreshes
                chrome.storage.local.set({ [storageKey]: "01" })
              }
              
              if (shouldShowMinimal) {
              }
            })
          } catch (e) {
            console.error('Error parsing tab URL:', e)
            setShowMinimalUI(false)
            // On error, try to use stored master tab ID
            chrome.storage.local.get([storageKey], (result) => {
              const storedMasterTabId = result[storageKey]
              if (storedMasterTabId) {
                setMasterTabId(storedMasterTabId)
              } else {
                setMasterTabId(null)
              }
            })
          }
        }
      })
    }

    // Check initially
    checkTabType()

    // Listen for tab updates (URL changes)
    const handleTabUpdate = (tabId: number, changeInfo: { url?: string; status?: string }, tab: chrome.tabs.Tab) => {
      if (changeInfo.url || changeInfo.status === 'complete') {
        checkTabType()
      }
    }

    // Listen for when user switches tabs
    const handleTabActivated = (activeInfo: { tabId: number; windowId: number }) => {
      checkTabType()
    }

    chrome.tabs.onUpdated.addListener(handleTabUpdate)
    chrome.tabs.onActivated.addListener(handleTabActivated)

    return () => {
      chrome.tabs.onUpdated.removeListener(handleTabUpdate)
      chrome.tabs.onActivated.removeListener(handleTabActivated)
    }
  }, [])
  
  // Save pinned state and toggle docked chat
  const toggleCommandChatPin = () => {
    const newState = !isCommandChatPinned
    setIsCommandChatPinned(newState)
    chrome.storage.local.set({ commandChatPinned: newState })
    
    // Actually create or remove the docked chat
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        if (newState) {
          // Pin: Create docked chat
          chrome.tabs.sendMessage(tabs[0].id, { type: 'CREATE_DOCKED_CHAT' })
        } else {
          // Unpin: Remove docked chat  
          chrome.tabs.sendMessage(tabs[0].id, { type: 'REMOVE_DOCKED_CHAT' })
        }
      }
    })
  }

  /** Pin docked WR Chat + switch to cmd WR Chat, then run focus (intro) after mount. */
  const ensureWrChatOpenThen = useCallback(
    (applyFocus: () => void) => {
      setDockedWorkspace('wr-chat')
      setDockedSubmode('command')
      if (!isCommandChatPinned) {
        setIsCommandChatPinned(true)
        chrome.storage.local.set({ commandChatPinned: true })
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'CREATE_DOCKED_CHAT' })
          }
        })
      }
      window.setTimeout(applyFocus, 0)
    },
    [isCommandChatPinned],
  )

  // Original useEffect for connection status
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' })

    const handleMessage = (message: any) => {
      
      if (message.type === 'STATUS_UPDATE') {
        setConnectionStatus(message.data)
        setIsLoading(false)
      }
      // Listen for agent box updates from content script
      else if (message.type === 'UPDATE_AGENT_BOXES') {
        setAgentBoxes(message.data || [])
      }
      // Listen for session data updates
      else if (message.type === 'UPDATE_SESSION_DATA') {
        if (message.data.sessionName !== undefined) {
          setSessionName(message.data.sessionName)
        }
        if (message.data.sessionKey !== undefined) {
          setSessionKey(message.data.sessionKey)
        }
        if (message.data.isLocked !== undefined) {
          setIsLocked(message.data.isLocked)
        }
        if (message.data.agentBoxes !== undefined) {
          setAgentBoxes(message.data.agentBoxes)
        }
      }
      // Listen for agent box OUTPUT updates (from process flow)
      else if (message.type === 'UPDATE_AGENT_BOX_OUTPUT') {
        const d = message.data as {
          allBoxes?: unknown[]
          agentBoxId?: string
          agentBoxUuid?: string
          output?: string
          sourceSurface?: string
        }
        if (d.sourceSurface !== undefined && d.sourceSurface !== 'sidepanel') {
          return
        }
        console.log('[AgentBoxFix] sidepanel:UPDATE_AGENT_BOX_OUTPUT', {
          hasAllBoxes: Array.isArray(d?.allBoxes),
          allBoxesLen: Array.isArray(d?.allBoxes) ? d.allBoxes.length : 0,
          agentBoxId: d?.agentBoxId,
          agentBoxUuid: d?.agentBoxUuid,
          outputLen: typeof d?.output === 'string' ? d.output.length : -1,
        })
        if (message.data.allBoxes) {
          // Update all boxes (includes the updated one)
          console.log('[AgentBoxFix] sidepanel:render path=allBoxes setCount=' + message.data.allBoxes.length)
          setAgentBoxes(message.data.allBoxes)
        } else if (message.data.agentBoxId && message.data.output !== undefined) {
          // Update specific box output (including cleared empty string)
          setAgentBoxes(prev => {
            const id = message.data.agentBoxId as string
            const matchedBefore = prev.filter((box) => box.id === id || (box as { identifier?: string }).identifier === id).length
            const next = prev.map(box =>
              box.id === message.data.agentBoxId
                ? { ...box, output: message.data.output }
                : box
            )
            const changed = next.some((box, i) => box.output !== prev[i]?.output)
            console.log('[AgentBoxFix] sidepanel:render path=perBox idMatchCandidates=' + matchedBefore + ' stateRowChanged=' + changed)
            return next
          })
        }
      }
      // Electron screenshot result: do not append to the thread here — user message + image is only from Save or processScreenshotWithTrigger (Tags flow).
      else if (message.type === 'ELECTRON_SELECTION_RESULT') {
        processElectronSelectionForTagsRef.current(message)
      }
      // Listen for trigger prompt from Electron
      else if (message.type === 'SHOW_TRIGGER_PROMPT') {
        const pc = message.promptContext
        // Accept if promptContext matches this surface OR is absent (backward-compat with overlay paths that don't set lmgtfyLastSelectionSource).
        if (pc !== undefined && pc !== 'sidepanel') return
        // New capture prompt supersedes any pending Tags auto-process so SELECTION_RESULT cannot pair with the wrong flow.
        pendingTriggerRef.current = null
        setShowTriggerPrompt({
          mode: message.mode,
          rect: message.rect,
          displayId: typeof message.displayId === 'number' ? message.displayId : undefined,
          bounds: message.bounds,
          imageUrl: message.imageUrl,
          videoUrl: message.videoUrl,
          createTrigger: message.createTrigger,
          addCommand: message.addCommand,
          name: '',
          command: ''
        })
      }
      // Listen for trigger updates from other contexts
      else if (message.type === 'TRIGGERS_UPDATED') {
        chrome.storage?.local?.get(['optimando-tagged-triggers'], (data: any) => {
          const list = Array.isArray(data?.['optimando-tagged-triggers']) ? data['optimando-tagged-triggers'] : []
          setTriggers(list)
        })
      }
      // Listen for command append from modal
      else if (message.type === 'COMMAND_POPUP_APPEND') {
        if (message.command || message.text) {
          const commandText = message.command || message.text
          // Add command message to chat
          const commandMessage = {
            role: 'user' as const,
            text: typeof commandText === 'string' ? commandText : `📝 Command: ${commandText}`
          }
          setChatMessages(prev => [...prev, commandMessage])
        }
      }
      // Listen for reload request after deletion
      else if (message.type === 'RELOAD_SESSION_FROM_SQLITE') {
        const targetSessionKey = message.sessionKey
        
        // Use specific session key if provided, otherwise get current
        if (targetSessionKey) {
          // Fetch the specific session from SQLite
          chrome.runtime.sendMessage({ 
            type: 'GET_SESSION_FROM_SQLITE',
            sessionKey: targetSessionKey 
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('❌ Error reloading from SQLite:', chrome.runtime.lastError.message)
              return
            }
            
            if (!response?.success || !response?.session) {
              return
            }
            
            const session = response.session
            setSessionName(sessionListLabel(session, 'Session'))
            setSessionKey(targetSessionKey)
            setIsLocked(session.isLocked || false)
            setAgentBoxes(session.agentBoxes || [])
          })
        } else {
          // Fallback: get all sessions and pick most recent
          chrome.runtime.sendMessage({ type: 'GET_ALL_SESSIONS_FROM_SQLITE' }, (response) => {
            if (chrome.runtime.lastError || !response?.success || !response?.sessions) {
              return
            }
            
            const sessionsArray = Object.entries(response.sessions)
              .map(([key, session]: [string, any]) => ({ key, ...session }))
              .filter((s: any) => s.timestamp)
              .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            
            if (sessionsArray.length > 0) {
              const mostRecent = sessionsArray[0]
              setSessionName(sessionListLabel(mostRecent, 'Session'))
              setSessionKey(mostRecent.key)
              setIsLocked(mostRecent.isLocked || false)
              setAgentBoxes(mostRecent.agentBoxes || [])
            }
          })
        }
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    const timeout = setTimeout(() => {
      if (isLoading) {
        setIsLoading(false)
      }
    }, 3000)

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
      clearTimeout(timeout)
    }
  }, [])

  // Load session data immediately on mount and when sidebar becomes visible
  useEffect(() => {
    const loadSessionDataFromStorage = () => {
      // Load session data from SQLite (single source of truth)
      chrome.runtime.sendMessage({ type: 'GET_ALL_SESSIONS_FROM_SQLITE' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('❌ Error loading sessions from SQLite:', chrome.runtime.lastError.message)
          setSessionName('No Session')
          setSessionKey('')
          return
        }
        
        if (!response || !response.success || !response.sessions || Object.keys(response.sessions).length === 0) {
          setSessionName('No Session')
          setSessionKey('')
          return
        }
        
        // Get the most recent session (by timestamp)
        let mostRecentSession: any = null
        let mostRecentKey: string = ''
        let mostRecentTime = 0
        
        Object.entries(response.sessions).forEach(([key, session]: [string, any]) => {
          if (session && session.timestamp) {
            const sessionTime = new Date(session.timestamp).getTime()
            if (sessionTime > mostRecentTime) {
              mostRecentTime = sessionTime
              mostRecentSession = session
              mostRecentKey = key
            }
          }
        })
        
        // If we found a session, use it
        if (mostRecentSession && mostRecentKey) {
          setSessionName(sessionListLabel(mostRecentSession, 'Unnamed Session'))
          setSessionKey(mostRecentKey)
          setIsLocked(mostRecentSession.isLocked || false)
          setAgentBoxes(mostRecentSession.agentBoxes || [])
        } else {
          setSessionName('No Session')
          setSessionKey('')
        }
      })
    }

    const loadSessionDataFromContentScript = () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_SESSION_DATA' }, (response) => {
            if (chrome.runtime.lastError) {
              loadSessionDataFromStorage()
              return
            }
            if (response && response.sessionKey) {
              setSessionName(response.sessionName || 'New Session')
              setSessionKey(response.sessionKey || '')
              setIsLocked(response.isLocked || false)
              setAgentBoxes(response.agentBoxes || [])
            } else {
              // Fallback to storage
              loadSessionDataFromStorage()
            }
          })
        } else {
          // No active tab, load from storage
          loadSessionDataFromStorage()
        }
      })
    }
    
    // Load immediately from storage (fastest)
    loadSessionDataFromStorage()
    
    // Also try to get from content script (more accurate for current session)
    const contentScriptTimer = setTimeout(loadSessionDataFromContentScript, 100)
    
    // Retry content script a few times
    const retryTimer1 = setTimeout(loadSessionDataFromContentScript, 500)
    const retryTimer2 = setTimeout(loadSessionDataFromContentScript, 1500)
    
    return () => {
      clearTimeout(contentScriptTimer)
      clearTimeout(retryTimer1)
      clearTimeout(retryTimer2)
    }
  }, [])

  // Chat resize handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingChat) return
      const newHeight = Math.max(150, Math.min(600, e.clientY - (chatRef.current?.getBoundingClientRect().top || 0)))
      setChatHeight(newHeight)
    }

    const handleMouseUp = () => {
      if (isResizingChat) {
        setIsResizingChat(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    if (isResizingChat) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingChat])

  // MailGuard body resize handlers
  const mailguardResizeStartY = useRef(0)
  const mailguardResizeStartH = useRef(200)
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingMailguard) return
      const dy = e.clientY - mailguardResizeStartY.current
      const newHeight = Math.max(100, Math.min(500, mailguardResizeStartH.current + dy))
      setMailguardBodyHeight(newHeight)
    }

    const handleMouseUp = () => {
      if (isResizingMailguard) {
        setIsResizingMailguard(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    if (isResizingMailguard) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingMailguard])

  const getStatusColor = () => {
    if (isLoading) return '#FFA500'
    return connectionStatus.isConnected ? '#00FF00' : '#FF0000'
  }

  // Check connection status and show dialog if Electron is not running
  useEffect(() => {
    if (!isLoading && !connectionStatus.isConnected) {
      // Delay showing dialog slightly to avoid flashing during initial load
      const timer = setTimeout(() => {
        if (!connectionStatus.isConnected) {
          setShowElectronDialog(true)
        }
      }, 1500)
      return () => clearTimeout(timer)
    } else if (connectionStatus.isConnected) {
      setShowElectronDialog(false)
    }
  }, [isLoading, connectionStatus.isConnected])

  // Function to launch Electron app
  // State for showing manual launch instructions
  const [showManualLaunchInstructions, setShowManualLaunchInstructions] = useState(false)
  const [launchTimedOut, setLaunchTimedOut] = useState(false)
  
  const checkConnection = (): Promise<boolean> => {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (r: { data?: { isConnected?: boolean } }) => {
        resolve(r?.data?.isConnected ?? false)
      })
    })
  }
  
  const launchElectronApp = async () => {
    setIsLaunchingElectron(true)
    setShowManualLaunchInstructions(false)
    setLaunchTimedOut(false)
    try {
      // First check if Electron is already running (common in dev mode on Linux
      // where protocol launch can't start the app but it's already running).
      const alreadyRunning = await checkConnection()
      if (alreadyRunning) {
        setIsLaunchingElectron(false)
        setShowElectronDialog(false)
        handleAuthSignIn()
        return
      }

      // Protocol launch (wrdesk://) disabled - caused xdg-open dialog on Linux
      const response = await chrome.runtime.sendMessage({ type: 'LAUNCH_ELECTRON_APP' })
      
      if (response?.success) {
        setShowElectronDialog(false)
        await new Promise(r => setTimeout(r, 2000))
        chrome.runtime.sendMessage({ type: 'GET_STATUS' })
        handleAuthSignIn()
      } else {
        // Poll for connection (user may start app manually)
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
            handleAuthSignIn()
            return
          }
          setTimeout(poll, pollInterval)
        }
        setTimeout(poll, pollInterval)
        return
      }
    } catch (err) {
      console.error('[Sidepanel] Failed to launch Electron:', err)
      setShowManualLaunchInstructions(true)
      setNotification({ 
        message: 'Please start the WR Desk Dashboard manually.', 
        type: 'error' 
      })
      setTimeout(() => setNotification(null), 8000)
    }
    setIsLaunchingElectron(false)
  }
  
  // Retry connection check (for after user manually starts the app)
  const retryConnection = async () => {
    setIsLaunchingElectron(true)
    try {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' })
      // Wait a moment and check again
      await new Promise(r => setTimeout(r, 2000))
      chrome.runtime.sendMessage({ type: 'GET_STATUS' })
    } finally {
      setIsLaunchingElectron(false)
    }
  }

  // Helper functions for new features
  const sendToContentScript = (action: string, data?: any) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        const message = data ? { type: action, data } : { type: action }
        chrome.tabs.sendMessage(tabs[0].id, message)
      }
    })
  }

  const openSettings = () => {
    sendToContentScript('OPEN_SETTINGS_LIGHTBOX')
  }

  const openMemory = () => {
    sendToContentScript('OPEN_MEMORY_LIGHTBOX')
  }

  const openContext = () => {
    sendToContentScript('OPEN_CONTEXT_LIGHTBOX')
  }

  const openUnifiedAdmin = () => {
    sendToContentScript('OPEN_UNIFIED_ADMIN_LIGHTBOX')
  }

  const openReasoningLightbox = () => {
    // Open Electron Analysis Dashboard
    // Note: showNotification is defined later in this component, but we use setNotification directly here
    // to avoid hoisting issues with const declarations
    setNotification({ message: 'Opening Analysis Dashboard...', type: 'info' })
    setTimeout(() => setNotification(null), 3000)
    
    chrome.runtime?.sendMessage({ type: 'ELECTRON_OPEN_ANALYSIS_DASHBOARD', theme }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('❌ Error:', chrome.runtime.lastError.message)
        setNotification({ message: 'Failed to open Dashboard. Is the extension loaded?', type: 'error' })
        setTimeout(() => setNotification(null), 3000)
        return
      }
      
      if (response?.success) {
        setNotification({ message: 'Analysis Dashboard opened', type: 'success' })
        setTimeout(() => setNotification(null), 3000)
      } else if (response?.error) {
        console.warn('⚠️ Dashboard response:', response.error)
        // Show a more helpful message
        let msg = response.error
        if (response.error.includes('not running') || response.error.includes('Start Menu')) {
          msg = 'Please start WR Code from the Start Menu'
        } else if (response.error.includes('starting')) {
          msg = 'Dashboard is starting, please wait...'
        }
        setNotification({ message: msg, type: 'error' })
        setTimeout(() => setNotification(null), 3000)
      }
    })
  }

  const openAgentsLightbox = () => {
    sendToContentScript('OPEN_AGENTS_LIGHTBOX')
  }

  const openPopupChat = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_COMMAND_CENTER_POPUP', theme: theme })
  }

  const openThirdPartyLicenses = () => {
    setShowThirdPartyLicenses(true)
  }

  const toggleViewMode = () => {
    if (isAdminDisabled) {
      showNotification('Open a website for viewing the admin panel', 'info')
      return
    }
    
    const newMode = viewMode === 'app' ? 'admin' : 'app'
    setViewMode(newMode)
    
    // Save to storage
    import('./storage/storageWrapper').then(({ storageSet }) => {
      storageSet({ viewMode: newMode }, () => {
      })
    })
  }


  const addAgentBox = () => {
    sendToContentScript('ADD_AGENT_BOX')
  }

  // Notification helper - defined before quick actions so it can be used
  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 3000)
  }

  // Runtime Controls functions - EXACTLY like the original buttons
  const openAddView = () => {
    sendToContentScript('OPEN_HELPER_GRID_LIGHTBOX')
  }

  const openSessions = () => {
    sendToContentScript('OPEN_SESSIONS_LIGHTBOX')
  }

  const syncSession = () => {
    sendToContentScript('SYNC_SESSION')
  }

  const importSession = () => {
    sendToContentScript('IMPORT_SESSION')
  }

  const openWRVault = () => {
    sendToContentScript('OPEN_WRVAULT_LIGHTBOX')
  }

  const removeAgentBox = (id: string) => {
    // Show confirmation dialog
    if (!confirm('Do you want to delete this agent box?')) {
      return
    }
    
    // Update local state for immediate UI feedback
    const updated = agentBoxes.filter(box => box.id !== id)
    setAgentBoxes(updated)
    
    // Notify content script to delete the box (which will handle SQLite deletion)
    sendToContentScript('DELETE_AGENT_BOX', { agentId: id })
  }

  const editAgentBox = (boxId: string) => {
    sendToContentScript('EDIT_AGENT_BOX', { box: { id: boxId } })
  }

  // Resize handler for agent boxes
  const startResizing = (boxId: string, e: React.MouseEvent) => {
    e.preventDefault()
    setResizingBoxId(boxId)
    
    const startY = e.clientY
    const startHeight = agentBoxHeights[boxId] || 120
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY
      const newHeight = Math.max(80, Math.min(800, startHeight + deltaY))
      setAgentBoxHeights(prev => ({ ...prev, [boxId]: newHeight }))
    }
    
    const handleMouseUp = () => {
      setResizingBoxId(null)
      // Save to storage
      const finalHeight = agentBoxHeights[boxId] || 120
      import('./storage/storageWrapper').then(({ storageSet }) => {
        storageSet({ agentBoxHeights: { ...agentBoxHeights, [boxId]: finalHeight } })
      })
      
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }


  // Pull tags from Electron host (WR Desk dashboard) into chrome.storage so they match popup/dashboard WR Chat.
  useEffect(() => {
    void mergeTaggedTriggersFromHost()
    const t = setInterval(() => void mergeTaggedTriggersFromHost(), 45_000)
    const onVis = () => {
      if (document.visibilityState === 'visible') void mergeTaggedTriggersFromHost()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Load triggers
  useEffect(() => {
    if (!isCommandChatPinned) return
    
    const KEYS = ['optimando-tagged-triggers', 'optimando-anchored-trigger-keys', 'optimando-pinned-diff-ids']
    const loadTriggers = () => {
      chrome.storage?.local?.get(KEYS, (data: any) => {
        const list = Array.isArray(data?.['optimando-tagged-triggers']) ? data['optimando-tagged-triggers'] : []
        setTriggers(list)
        const anchored = Array.isArray(data?.['optimando-anchored-trigger-keys']) ? data['optimando-anchored-trigger-keys'] : []
        setAnchoredTriggerKeys(anchored)
        const diffPinned = Array.isArray(data?.['optimando-pinned-diff-ids']) ? data['optimando-pinned-diff-ids'] : []
        setPinnedDiffIds(diffPinned)
      })
    }
    
    loadTriggers()
    window.addEventListener('optimando-triggers-updated', loadTriggers)
    const onStorage: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area !== 'local') return
      if (changes['optimando-tagged-triggers'] || changes['optimando-anchored-trigger-keys'] || changes['optimando-pinned-diff-ids']) loadTriggers()
    }
    try {
      chrome.storage?.onChanged?.addListener(onStorage)
    } catch {
      /* noop */
    }
    return () => {
      window.removeEventListener('optimando-triggers-updated', loadTriggers)
      try {
        chrome.storage?.onChanged?.removeListener(onStorage)
      } catch {
        /* noop */
      }
    }
  }, [isCommandChatPinned])

  // Chat resize handling
  useEffect(() => {
    if (!isResizingChat) return
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!chatRef.current) return
      const newHeight = e.clientY - chatRef.current.getBoundingClientRect().top
      setChatHeight(Math.max(120, Math.min(500, newHeight)))
    }
    
    const handleMouseUp = () => setIsResizingChat(false)
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingChat])

  // Command chat functions
  const parseDataTransfer = async (dt: DataTransfer): Promise<any[]> => {
    const out: any[] = []
    try {
      for (const f of Array.from(dt.files || [])) {
        const t = (f.type || '').toLowerCase()
        const kind = t.startsWith('image/') ? 'image' : t.startsWith('audio/') ? 'audio' : t.startsWith('video/') ? 'video' : 'file'
        out.push({ kind, payload: f, mime: f.type, name: f.name })
      }
      const url = dt.getData('text/uri-list') || dt.getData('text/url')
      if (url) out.push({ kind: 'url', payload: url })
      const txt = dt.getData('text/plain')
      if (txt && !url) out.push({ kind: 'text', payload: txt })
    } catch {}
    return out
  }

  // Extract plain text from a PDF File by sending it to the orchestrator's
  // /api/parser/pdf/extract endpoint — uses Node.js pdfjs with a proper worker,
  // which is more reliable than browser-side pdfjs in the extension context.
  const extractPdfText = async (file: File, baseUrl: string = 'http://127.0.0.1:51248'): Promise<string> => {
    try {
      // Convert file to base64
      const arrayBuffer = await file.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      let binary = ''
      const chunkSize = 8192
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
      }
      const base64 = btoa(binary)

      // Use a stable attachmentId derived from filename + size
      const attachmentId = `chat-drop-${file.name.replace(/[^a-zA-Z0-9]/g, '_')}-${file.size}`

      const response = await fetch(`${baseUrl}/api/parser/pdf/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...electronFetchHeaders() },
        body: JSON.stringify({ attachmentId, base64 }),
        signal: AbortSignal.timeout(60_000)
      })

      if (!response.ok) {
        console.warn('[extractPdfText] Orchestrator returned', response.status)
        return ''
      }

      const result = await response.json()
      if (result.success && result.extractedText && result.extractedText.trim().length > 0) {
        return result.extractedText.trim()
      }
      return ''
    } catch (err) {
      console.warn('[extractPdfText] Failed:', err)
      return ''
    }
  }

  const handleChatDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOverChat(false)
    const items = await parseDataTransfer(e.dataTransfer)
    if (!items.length) return

    // --- Images: add directly to chat for LLM vision ---
    const imageItems = items.filter(it => it.kind === 'image')
    for (const img of imageItems) {
      if (img.payload instanceof File) {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          setChatMessages(prev => [...prev, {
            role: 'user' as const,
            text: `📎 ${img.name || 'image'}`,
            imageUrl: dataUrl
          }])
          setTimeout(() => {
            if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
          }, 0)
        }
        reader.readAsDataURL(img.payload)
      }
    }

    // --- Documents / text files: extract text and queue for next LLM send ---
    const docItems = items.filter(it => it.kind !== 'image')
    for (const doc of docItems) {
      if (doc.kind === 'text') {
        // Plain text dragged from browser/editor
        const snippet = (doc.payload as string).slice(0, 6000)
        setPendingDocContent({ name: 'Dropped text', text: snippet })
        setChatMessages(prev => [...prev, {
          role: 'user' as const,
          text: `📄 **Dropped text** attached — send your question below.`
        }])
        runEmbed([doc], 'session')
      } else if (doc.kind === 'url') {
        setChatMessages(prev => [...prev, {
          role: 'user' as const,
          text: `🔗 ${doc.payload}`
        }])
      } else if (doc.payload instanceof File) {
        const file = doc.payload as File
        const ext = file.name.split('.').pop()?.toLowerCase() || ''
        const textExtractable = ['txt', 'md', 'csv', 'json', 'js', 'ts', 'py', 'html', 'css', 'xml', 'log', 'yaml', 'yml'].includes(ext)
        if (textExtractable) {
          const reader = new FileReader()
          reader.onload = () => {
            const text = (reader.result as string).slice(0, 6000)
            setPendingDocContent({ name: file.name, text })
            setChatMessages(prev => [...prev, {
              role: 'user' as const,
              text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — send your question below.`
            }])
            runEmbed([doc], 'session')
            setTimeout(() => {
              if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
            }, 0)
          }
          reader.readAsText(file)
        } else {
          // PDF / binary / unknown — try pdfjs text extraction first
          const file = doc.payload as File
          setChatMessages(prev => [...prev, {
            role: 'user' as const,
            text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — extracting text…`
          }])
          runEmbed([doc], 'session')
          setTimeout(() => {
            if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
          }, 0)
          extractPdfText(file, 'http://127.0.0.1:51248').then(extracted => {
            if (extracted && extracted.length > 50) {
              const snippet = extracted.slice(0, 8000)
              setPendingDocContent({ name: file.name, text: snippet })
              setChatMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last && last.text?.includes('extracting text')) {
                  updated[updated.length - 1] = { ...last, text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — ${extracted.split(/\s+/).length.toLocaleString()} words extracted. Send your question below.` }
                }
                return updated
              })
            } else {
              setChatMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last && last.text?.includes('extracting text')) {
                  updated[updated.length - 1] = { ...last, text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — no selectable text found (scanned PDF?). Send your question below.` }
                }
                return updated
              })
            }
          })
        }
      }
    }

    if (items.length > 0) {
      setTimeout(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
      }, 0)
    }
  }

  const runEmbed = (items: any[], target: 'session' | 'account') => {
    setTimeout(() => {
      try {
        const key = target === 'session' ? 'optimando-context-bucket-session' : 'optimando-context-bucket-account'
        const prev = JSON.parse(localStorage.getItem(key) || '[]')
        const serialized = items.map(it => ({
          kind: it.kind,
          name: it.name || undefined,
          mime: it.mime || undefined,
          size: it.payload?.size || undefined,
          text: typeof it.payload === 'string' ? it.payload : undefined
        }))
        prev.push({ at: Date.now(), items: serialized })
        localStorage.setItem(key, JSON.stringify(prev))
      } catch {}
    }, 100)
  }

  const handleBucketClick = () => fileInputRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const dt = new DataTransfer()
    Array.from(e.target.files || []).forEach(f => dt.items.add(f))
    const items = await parseDataTransfer(dt)
    if (items.length) {
      // Use the same drop handler logic — no embed dialog
      const syntheticEvent = { preventDefault: () => {}, dataTransfer: dt } as unknown as React.DragEvent
      // Process each item directly (mirrors handleChatDrop logic)
      for (const item of items) {
        if (item.kind === 'image' && item.payload instanceof File) {
          const reader = new FileReader()
          reader.onload = () => {
            setChatMessages(prev => [...prev, {
              role: 'user' as const,
              text: `📎 ${item.name || 'image'}`,
              imageUrl: reader.result as string
            }])
          }
          reader.readAsDataURL(item.payload)
        } else if (item.payload instanceof File) {
          const file = item.payload as File
          const ext = file.name.split('.').pop()?.toLowerCase() || ''
          const textExtractable = ['txt', 'md', 'csv', 'json', 'js', 'ts', 'py', 'html', 'css', 'xml', 'log', 'yaml', 'yml'].includes(ext)
          if (textExtractable) {
            const reader = new FileReader()
            reader.onload = () => {
              const text = (reader.result as string).slice(0, 6000)
              setPendingDocContent({ name: file.name, text })
              setChatMessages(prev => [...prev, {
                role: 'user' as const,
                text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — send your question below.`
              }])
              runEmbed([item], 'session')
            }
            reader.readAsText(file)
          } else {
            // PDF / binary — try pdfjs text extraction
            const fileCopy = item.payload as File
            setChatMessages(prev => [...prev, {
              role: 'user' as const,
              text: `📄 **${fileCopy.name}** attached (${Math.round(fileCopy.size / 1024)} KB) — extracting text…`
            }])
            runEmbed([item], 'session')
            extractPdfText(fileCopy, 'http://127.0.0.1:51248').then(extracted => {
              if (extracted && extracted.length > 50) {
                const snippet = extracted.slice(0, 8000)
                setPendingDocContent({ name: fileCopy.name, text: snippet })
                setChatMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last && last.text?.includes('extracting text')) {
                    updated[updated.length - 1] = { ...last, text: `📄 **${fileCopy.name}** attached (${Math.round(fileCopy.size / 1024)} KB) — ${extracted.split(/\s+/).length.toLocaleString()} words extracted. Send your question below.` }
                  }
                  return updated
                })
              } else {
                setChatMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last && last.text?.includes('extracting text')) {
                    updated[updated.length - 1] = { ...last, text: `📄 **${fileCopy.name}** attached (${Math.round(fileCopy.size / 1024)} KB) — no selectable text found (scanned PDF?). Send your question below.` }
                  }
                  return updated
                })
              }
            })
          }
        }
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleEmbedConfirm = () => {
    runEmbed(pendingItems, embedTarget)
    setShowEmbedDialog(false)
    setPendingItems([])
  }

  /** Clear WR Chat transcript, composer, and pending attachment (docked + shared state). */
  const clearWrChat = useCallback(() => {
    setChatMessages([])
    setChatInput('')
    setPendingDocContent(null)
    setShowTagsMenu(false)
  }, [])

  // =============================================================================
  // CHAT FLOW HELPERS
  // The chat flow follows this architecture:
  //
  // User Input (WR Chat)
  //        |
  //        v
  // +------------------+
  // | Butler LLM       |  <- Immediate response (confirm/feedback)
  // +------------------+
  //        |
  //        v
  // +------------------+
  // | Input Coordinator|
  // |  - Check #tags   |
  // |  - Pattern match |
  // |  - No listener?  |  <- If no listener, forward anyway
  // +------------------+
  //        |
  //        v (if matched or no listener)
  // +------------------+
  // | Reasoning Wrap   |  <- Reasoning Instructions, Role from agent config
  // +------------------+
  //        |
  //        v
  // +------------------+
  // | Agent LLM        |  <- Model from AgentBox config
  // +------------------+
  //        |
  //        v
  // +------------------+
  // | Agent Box Output |  <- Display in connected box
  // +------------------+
  // =============================================================================
  
  /**
   * Run OCR on a single image URL. Returns extracted text or empty string.
   * Used BEFORE routing so OCR-derived triggers can influence agent matching.
   */
  const runOcrForCurrentTurn = async (imageUrl: string, baseUrl: string): Promise<string> => {
    try {
      const ocrResponse = await fetch(`${baseUrl}/api/ocr/process`, {
        method: 'POST',
        headers: electronFetchHeaders(),
        body: JSON.stringify({ image: imageUrl }),
        signal: AbortSignal.timeout(5000),
      })
      if (ocrResponse.ok) {
        const ocrResult = await ocrResponse.json()
        if (ocrResult.ok && ocrResult.data?.text) {
          return ocrResult.data.text
        }
      }
    } catch (e) {
      console.warn('[OCR] Failed for current turn:', e)
    }
    return ''
  }

  /**
   * Build LLM-ready messages with OCR text embedded for user image bubbles.
   * IMPORTANT: Only the latest screenshot in the thread should run OCR (or use precomputed
   * text from runOcrForCurrentTurn). Re-running OCR on every historical image caused N×
   * /api/ocr/process per Send and made the sidepanel feel extremely slow.
   */
  const processMessagesWithOCR = async (
    messages: Array<{role: 'user' | 'assistant', text: string, imageUrl?: string}>,
    baseUrl: string,
    options?: { lastTurnOcrText?: string },
  ): Promise<{ processedMessages: Array<{role: string, content: string}>, ocrText: string }> => {
    let lastUserImageIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && messages[i].imageUrl) {
        lastUserImageIdx = i
        break
      }
    }

    let ocrText = ''
    if (lastUserImageIdx >= 0 && options?.lastTurnOcrText !== undefined) {
      ocrText = options.lastTurnOcrText
    }

    const processedMessages: Array<{ role: string; content: string }> = []

    for (let idx = 0; idx < messages.length; idx++) {
      const msg = messages[idx]
      if (msg.imageUrl && msg.role === 'user') {
        if (idx === lastUserImageIdx) {
          let text: string | undefined
          if (options?.lastTurnOcrText !== undefined) {
            text = options.lastTurnOcrText || undefined
          } else {
            try {
              const ocrResponse = await fetch(`${baseUrl}/api/ocr/process`, {
                method: 'POST',
                headers: electronFetchHeaders(),
                body: JSON.stringify({ image: msg.imageUrl }),
                signal: AbortSignal.timeout(5000),
              })
              if (ocrResponse.ok) {
                const ocrResult = await ocrResponse.json()
                if (ocrResult.ok && ocrResult.data?.text) {
                  text = ocrResult.data.text as string
                  ocrText = text
                }
              }
            } catch (e) {
              console.warn('[Chat] OCR processing failed:', e)
            }
          }
          if (text) {
            processedMessages.push({
              role: msg.role,
              content: `${msg.text || 'Image content:'}\n\n[📝 OCR extracted text]:\n${text}`,
            })
          } else {
            processedMessages.push({
              role: msg.role,
              content: msg.text || '[Image attached - OCR unavailable]',
            })
          }
        } else {
          const cap = (msg.text || '').trim()
          processedMessages.push({
            role: msg.role,
            content: cap
              ? `${cap}\n\n[Earlier screenshot in thread — OCR not re-run for speed]`
              : '[Earlier screenshot in thread — OCR not re-run for speed]',
          })
        }
      } else {
        processedMessages.push({
          role: msg.role,
          content: msg.text,
        })
      }
    }

    return { processedMessages, ocrText }
  }
  
  /**
   * Generate match detection feedback message for Event Tag routing
   * Displays which agents matched which triggers in the chat
   */
  const generateEventTagMatchFeedback = (batch: EventTagRoutingBatch): string => {
    if (batch.results.length === 0) {
      return ''
    }
    
    const lines: string[] = ['🟢 **Match Detected**\n']
    
    for (const result of batch.results) {
      const agentNum = result.agentNumber 
        ? `#${String(result.agentNumber).padStart(2, '0')}` 
        : ''
      const agentLabel = agentNum 
        ? `Agent ${agentNum} (${result.agentName})` 
        : result.agentName
      
      lines.push(`• **${agentLabel}** → matched \`${result.trigger.tag}\``)
      lines.push(`  • Trigger type: Event Trigger (${result.trigger.type})`)
      
      // Show condition results
      if (result.conditionResults.conditions.length > 0) {
        const conditionSummary = result.conditionResults.allPassed 
          ? '✓ All conditions passed' 
          : '⚠️ Some conditions not met'
        lines.push(`  • Conditions: ${conditionSummary}`)
      }
      
      // Show LLM and destination info
      if (result.llmConfig.isAvailable) {
        lines.push(`  • LLM: ${result.llmConfig.provider}/${result.llmConfig.model}`)
      }
      if (result.executionConfig.reportTo.length > 0) {
        const destinations = result.executionConfig.reportTo.map(r => r.label).join(', ')
        lines.push(`  • Output: ${destinations}`)
      }
      
      lines.push('') // Empty line between agents
    }
    
    // Add summary
    lines.push(`_${batch.results.length} agent(s) matched from ${batch.triggersFound.length} trigger(s) detected_`)
    
    return lines.join('\n')
  }
  
  /**
   * Process input through an agent with reasoning wrapping
   * This is the core of the agent processing path
   */
  const processWithAgent = async (
    match: AgentMatch,
    inputText: string,
    ocrText: string,
    processedMessages: Array<{role: string, content: string}>,
    fallbackModel: string,
    baseUrl: string,
    visionImageUrl?: string | null,
    opts?: { preResolvedVisionB64?: string | null },
  ): Promise<{ success: boolean, output?: string, error?: string }> => {
    try {
      // Load full agent config
      const agents = await loadAgentsFromSession(sessionKey)
      const agent = agents.find(a => a.id === match.agentId)
      
      if (!agent) {
        console.warn(`[Chat] Agent not found: ${match.agentId}`)
        return { success: false, error: `Agent ${match.agentName} not found` }
      }
      
      // Wrap input with agent's reasoning instructions (Role, Reasoning Instructions)
      const reasoningContext = wrapInputForAgent(inputText, agent, ocrText)
      
      
      // Resolve which model to use (AgentBox model > fallback)
      const modelResolution: BrainResolution = resolveModelForAgent(
        match.agentBoxProvider,
        match.agentBoxModel,
        fallbackModel
      )
      
      
      // Surface brain resolution failures visibly
      if (!modelResolution.ok) {
        const errorMsg = `⚠️ Brain resolution failed for ${match.agentName}:\n${modelResolution.error}`
        console.warn('[Chat] Brain resolution error:', modelResolution)
        
        if (match.agentBoxId) {
          await updateAgentBoxOutput(
            match.agentBoxId,
            errorMsg,
            `Agent: ${match.agentName} | Provider: ${modelResolution.provider} | Error: ${modelResolution.errorType}`,
            sessionKey,
            'sidepanel',
          )
        }
        
        return { success: false, error: modelResolution.error }
      }
      
      const llmMessages = [
        { role: 'system', content: reasoningContext },
        ...processedMessages.slice(-3)
      ]
      const { body: llmBody, error: keyError } = await buildLlmRequestBody(
        modelResolution as BrainResolution & { ok: true },
        llmMessages
      )
      if (keyError) {
        if (match.agentBoxId) {
          await updateAgentBoxOutput(
            match.agentBoxId,
            `⚠️ ${keyError}`,
            `Agent: ${match.agentName} | Missing API key`,
            sessionKey,
            'sidepanel',
          )
        }
        return { success: false, error: keyError }
      }

      // Ensure launch secret is fresh before the LLM call (handles SW sleep/wake)
      await ensureLaunchSecret()

      // Use pre-resolved vision base64 if provided to avoid a redundant resolveImageUrlForBackend call
      let safeVisionB64: string | null = null
      if (opts?.preResolvedVisionB64 !== undefined) {
        const b64 = opts.preResolvedVisionB64 ? toBase64ForOllama(opts.preResolvedVisionB64) : null
        if (isPlausibleVisionBase64(b64)) safeVisionB64 = b64
      } else if (visionImageUrl) {
        const resolvedVision = await resolveImageUrlForBackend(visionImageUrl)
        const b64 = resolvedVision ? toBase64ForOllama(resolvedVision) : null
        if (isPlausibleVisionBase64(b64)) safeVisionB64 = b64
      }

      const response: Response = await fetch(`${baseUrl}/api/llm/chat`, {
        method: 'POST',
        headers: electronFetchHeaders(),
        body: JSON.stringify({
          ...llmBody,
          ...(safeVisionB64 ? { images: [safeVisionB64] } : {}),
        }),
        signal: AbortSignal.timeout(600000),
      })
      
      if (!response.ok) {
        const result = await response.json()
        return { success: false, error: result.error || 'LLM request failed' }
      }
      
      const result = await response.json()
      if (result.ok && result.data?.content) {
        return { success: true, output: result.data.content }
      }
      
      return { success: false, error: 'No output from LLM' }
      
    } catch (error: any) {
      console.error('[Chat] Agent processing error:', error)
      return { success: false, error: error.message || 'Agent processing failed' }
    }
  }
  
  /**
   * Get butler LLM response for general queries
   */
  const getButlerResponse = async (
    messages: Array<{role: string, content: string}>,
    model: string,
    baseUrl: string,
    visionImageUrl?: string | null,
    opts?: { enabledAgentCount?: number; preResolvedVisionB64?: string | null },
  ): Promise<{ success: boolean, response?: string, error?: string }> => {
    try {
      // Use pre-resolved agent count if provided to avoid a redundant loadAgentsFromSession call
      let enabledCount = opts?.enabledAgentCount
      if (enabledCount === undefined) {
        const agents = await loadAgentsFromSession(sessionKey)
        enabledCount = agents.filter((a: any) => a.enabled).length
      }
      const butlerPrompt = getButlerSystemPrompt(
        sessionName,
        enabledCount,
        connectionStatus.isConnected
      )

      // Use pre-resolved vision if provided to avoid a redundant resolveImageUrlForBackend call
      let safeVisionB64: string | null = null
      if (opts?.preResolvedVisionB64 !== undefined) {
        const b64 = opts.preResolvedVisionB64 ? toBase64ForOllama(opts.preResolvedVisionB64) : null
        if (isPlausibleVisionBase64(b64)) safeVisionB64 = b64
      } else if (visionImageUrl) {
        const resolvedVision = await resolveImageUrlForBackend(visionImageUrl)
        const b64 = resolvedVision ? toBase64ForOllama(resolvedVision) : null
        if (isPlausibleVisionBase64(b64)) safeVisionB64 = b64
      }

      const response: Response = await fetch(`${baseUrl}/api/llm/chat`, {
        method: 'POST',
        headers: electronFetchHeaders(),
        body: JSON.stringify({
          modelId: model,
          messages: [
            { role: 'system', content: butlerPrompt },
            ...messages
          ],
          ...(safeVisionB64 ? { images: [safeVisionB64] } : {}),
        }),
        signal: AbortSignal.timeout(600000),
      })
      
      if (!response.ok) {
        const result = await response.json()
        return { success: false, error: result.error || 'Butler LLM request failed' }
      }
      
      const result = await response.json()
      if (result.ok && result.data?.content) {
        return { success: true, response: result.data.content }
      }
      
      return { success: false, error: 'No response from butler LLM' }
      
    } catch (error: any) {
      console.error('[Chat] Butler response error:', error)
      return { success: false, error: error.message || 'Butler response failed' }
    }
  }
  
  // Handle sending message with trigger (auto-process after screenshot)
  const handleSendMessageWithTrigger = async (
    displayTextForChat: string,
    imageUrl?: string,
    routingText?: string,
  ) => {
    const routeText = routingText ?? displayTextForChat
    const routeTag = normaliseTriggerTag(routeText)

    const resolveWrChatModelId = (): string => {
      const m = getEffectiveLlmModelNameForActiveMode(activeLlmModelRef.current, activeLlmModel)
      if (m) return m
      const first = availableModels[0]?.name
      if (first) return first
      try {
        const w = (window as unknown as { llm?: { models?: Array<{ id?: string; name?: string }> } }).llm?.models?.[0]
        return ((w?.id || w?.name) as string) || ''
      } catch {
        return ''
      }
    }
    const currentModel = resolveWrChatModelId()
    
    if (!currentModel) {
      setChatMessages(prev => [...prev, {
        role: 'assistant' as const,
        text: `⚠️ No LLM model available. Please install a model in LLM Settings.`
      }])
      return
    }

    let effectiveImageUrl: string | null = null
    if (imageUrl) {
      effectiveImageUrl = await resolveImageUrlForBackend(imageUrl)
      if (!effectiveImageUrl) {
        console.warn('[Sidepanel] trigger image could not be resolved — proceeding text-only')
      }
    }

    const displayLine =
      (displayTextForChat || '').trim() || routeTag || (effectiveImageUrl ? '[Screenshot]' : '')
    
    // Build messages including the image if provided
    const newMessages: Array<{role: 'user' | 'assistant', text: string, imageUrl?: string}> = []
    
    if (effectiveImageUrl) {
      newMessages.push({
        role: 'user' as const,
        text: displayLine,
        imageUrl: effectiveImageUrl,
      })
    } else {
      newMessages.push({
        role: 'user' as const,
        text: displayLine,
      })
    }
    
    setChatMessages(prev => [...prev, ...newMessages])
    setChatInput('')
    setIsLlmLoading(true)
    
    try {
      const baseUrl = 'http://127.0.0.1:51248'
      
      // Get current URL for website filtering
      let currentUrl = ''
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        currentUrl = tab?.url || ''
      } catch (e) {}
      
      // OCR before routing: extract text from image first
      let ocrText = ''
      if (effectiveImageUrl) {
        ocrText = await runOcrForCurrentTurn(effectiveImageUrl, baseUrl)
      }

      // Pre-compute validated base64 for vision calls — null means text-only degradation.
      const triggerVisionB64: string | null = (() => {
        const b64 = effectiveImageUrl ? toBase64ForOllama(effectiveImageUrl) : null
        return isPlausibleVisionBase64(b64) ? b64 : null
      })()

      // Build enriched text for routing (typed + OCR) — same as PopupChatView / dashboard embed
      // When routeText is empty (capture-only), use OCR text so agent tags in the image can match
      const effectiveRouteTextForMatch = routeText || ocrText || (effectiveImageUrl ? '[screenshot]' : '')
      const enrichedTriggerText = enrichRouteTextWithOcr(effectiveRouteTextForMatch, ocrText)
      const sessionKeyForRouteTrigger = getActiveCustomModeRuntime()?.sessionId?.trim() || sessionKey
      const mergedContextPrefixTrigger = mergeLlmContextPrefixes(
        getChatFocusLlmPrefix(useChatFocusStore.getState()),
        getCustomModeLlmPrefix(getActiveCustomModeRuntime()),
      )
      const enrichedTriggerTextForLlm = mergedContextPrefixTrigger
        ? `${mergedContextPrefixTrigger}\n\n${enrichedTriggerText}`
        : enrichedTriggerText

      // Route the input with OCR-enriched text
      const routingDecision = await routeInput(
        enrichedTriggerTextForLlm,
        !!effectiveImageUrl,
        connectionStatus,
        sessionName,
        currentModel,
        currentUrl,
        sessionKeyForRouteTrigger
      )
      
      
      if (routingDecision.shouldForwardToAgent && routingDecision.matchedAgents.length > 0) {
        // Show butler confirmation
        setChatMessages(prev => [...prev, {
          role: 'assistant' as const,
          text: routingDecision.butlerResponse
        }])
        
        // Process with each matched agent — load agents once for the whole batch
        const agents = await loadAgentsFromSession(sessionKeyForRouteTrigger)
        
        for (const match of routingDecision.matchedAgents) {
          const agent = agents.find(a => a.id === match.agentId)
          if (!agent) continue
          
          const wrappedInput = wrapInputForAgent(routeText || ocrText || '[screenshot]', agent, ocrText)
          
          // Resolve model
          const modelResolution: BrainResolution = resolveModelForAgent(
            match.agentBoxProvider,
            match.agentBoxModel,
            currentModel
          )
          
          
          if (!modelResolution.ok) {
            const errorMsg = `⚠️ Brain resolution failed for ${match.agentName}:\n${modelResolution.error}`
            console.warn('[Sidepanel] Brain resolution error:', modelResolution)
            if (match.agentBoxId) {
              await updateAgentBoxOutput(match.agentBoxId, errorMsg, `Agent: ${match.agentName} | Error: ${modelResolution.errorType}`, sessionKeyForRouteTrigger, 'sidepanel')
            }
            setChatMessages(prev => [...prev, { role: 'assistant' as const, text: errorMsg }])
            continue
          }
          
          const triggerLlmMessages = [
            { role: 'system', content: wrappedInput },
            {
              role: 'user',
              content: enrichedTriggerTextForLlm,
              ...(triggerVisionB64 ? { images: [triggerVisionB64] } : {}),
            },
          ]
          const { body: triggerLlmBody, error: triggerKeyError } = await buildLlmRequestBody(
            modelResolution as BrainResolution & { ok: true },
            triggerLlmMessages
          )
          if (triggerKeyError) {
            const keyMsg = `⚠️ ${match.agentName}: ${triggerKeyError}`
            if (match.agentBoxId) await updateAgentBoxOutput(match.agentBoxId, keyMsg, `Missing API key`, undefined, 'sidepanel')
            setChatMessages(prev => [...prev, { role: 'assistant' as const, text: keyMsg }])
            continue
          }

          // Ensure launch secret is fresh before the LLM call (handles SW sleep/wake)
          await ensureLaunchSecret()

          const agentResponse: Response = await fetch(`${baseUrl}/api/llm/chat`, {
            method: 'POST',
            headers: electronFetchHeaders(),
            body: JSON.stringify({
              ...triggerLlmBody,
            }),
            signal: AbortSignal.timeout(600000),
          })
          
          if (agentResponse.ok) {
            const agentResult = await agentResponse.json()
            if (agentResult.ok && agentResult.data?.content) {
              const agentOutput = agentResult.data.content
              
              const allBoxIds = match.targetBoxIds && match.targetBoxIds.length > 0
                ? match.targetBoxIds
                : match.agentBoxId ? [match.agentBoxId] : []

              if (allBoxIds.length > 0) {
                const reasoningContext = `**Agent:** ${match.agentIcon} ${match.agentName}\n**Match:** ${match.matchDetails}\n**Input:** ${displayTextForChat}`
                
                for (const boxId of allBoxIds) {
                  await updateAgentBoxOutput(boxId, agentOutput, reasoningContext, undefined, 'sidepanel')
                }
                
                setChatMessages(prev => [...prev, {
                  role: 'assistant' as const,
                  text: `[Agent: ${match.agentName}] responded. See agent box.`,
                }])
              } else {
                setChatMessages(prev => [...prev, {
                  role: 'assistant' as const,
                  text: `${match.agentIcon} **${match.agentName}**:\n\n${agentOutput}`
                }])
              }
            }
          }
        }
      } else {
        // No agent match — use butler response; skip loadAgentsFromSession since we already
        // know the count from the agents loaded during routing (routeInput loads them internally)
        const butlerAgents = await loadAgentsFromSession(sessionKeyForRouteTrigger)
        const butlerPrompt = getButlerSystemPrompt(
          sessionName,
          butlerAgents.filter((a: any) => a.enabled).length,
          connectionStatus.isConnected
        )
        
        const response: Response = await fetch(`${baseUrl}/api/llm/chat`, {
          method: 'POST',
          headers: electronFetchHeaders(),
          body: JSON.stringify({
            modelId: currentModel,
            messages: [
              { role: 'system', content: butlerPrompt },
              {
                role: 'user',
                content: enrichedTriggerTextForLlm,
                ...(triggerVisionB64 ? { images: [triggerVisionB64] } : {}),
              },
            ],
          }),
          signal: AbortSignal.timeout(600000),
        })
        
        if (response.ok) {
          const result = await response.json()
          if (result.ok && result.data?.content) {
            setChatMessages(prev => [...prev, {
              role: 'assistant' as const,
              text: result.data.content
            }])
          } else {
            setChatMessages(prev => [...prev, {
              role: 'assistant' as const,
              text: `⚠️ LLM returned no content (ok=${String(result?.ok)}).`,
            }])
          }
        } else {
          const errText = await response.text().catch(() => response.statusText)
          setChatMessages(prev => [...prev, {
            role: 'assistant' as const,
            text: `❌ LLM error (${response.status}): ${errText.slice(0, 500)}`,
          }])
        }
      }
      
      // Scroll to bottom
      setTimeout(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
      }, 0)
      
    } catch (error: any) {
      console.error('[Sidepanel] Error processing trigger:', error)
      setChatMessages(prev => [...prev, {
        role: 'assistant' as const,
        text: `⚠️ Error: ${error.message || 'Failed to process trigger'}`
      }])
    } finally {
      setIsLlmLoading(false)
    }
  }

  handleSendMessageWithTriggerRef.current = handleSendMessageWithTrigger

  processElectronSelectionForTagsRef.current = (message: {
    promptContext?: string
    dataUrl?: string
    url?: string
    ts?: number
  }) => {
    const pc = message.promptContext
    if (pc !== undefined && pc !== 'sidepanel') return
    const rawUrl = message.dataUrl || message.url
    if (!rawUrl) {
      console.warn('[Sidepanel] processElectronSelectionForTags: received message with no dataUrl/url — ignoring')
      return
    }

    // Validate: must be a proper data URL (blob: and raw paths are rejected here;
    // handleSendMessageWithTrigger will run resolveImageUrlForBackend for further hardening).
    if (!rawUrl.startsWith('data:')) {
      console.error('[Sidepanel] processElectronSelectionForTags: dataUrl is not a data: URL, discarding', rawUrl.slice(0, 80))
      setChatMessages(prev => [...prev, {
        role: 'assistant' as const,
        text: '⚠️ Trigger capture failed — screenshot was not a valid image. Please try again.',
      }])
      pendingTriggerRef.current = null
      // Cancel pending poll/timeout.
      try { window.dispatchEvent(new CustomEvent('optimando-sp-trigger-result-received')) } catch { /* noop */ }
      return
    }

    const pendingTrigger = pendingTriggerRef.current
    const msSinceTagConsume = Date.now() - sidepanelTagResultConsumedAtRef.current

    // Duplicate SELECTION_RESULT (WS + storage fallback, or after direct HTTP execute-trigger) — ignore.
    if (!pendingTrigger?.autoProcess && msSinceTagConsume < 10_000) {
      try { window.dispatchEvent(new CustomEvent('optimando-sp-trigger-result-received')) } catch { /* noop */ }
      console.log('[Sidepanel] processElectronSelectionForTags: duplicate capture discarded (', msSinceTagConsume, 'ms since consume)')
      return
    }

    if (!pendingTrigger?.autoProcess) {
      // Manual region capture (no tag): show image in WR Chat without auto-running the LLM (matches dashboard pending-capture intent).
      void (async () => {
        const resolved = await resolveImageUrlForBackend(rawUrl)
        if (!resolved) {
          setChatMessages(prev => [...prev, {
            role: 'assistant' as const,
            text: '⚠️ Capture could not be attached — image data was invalid.',
          }])
          return
        }
        sidepanelTagResultConsumedAtRef.current = Date.now()
        setChatMessages(prev => [...prev, { role: 'user' as const, text: '[Screenshot]', imageUrl: resolved }])
        setTimeout(() => {
          if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
        }, 0)
        try { window.dispatchEvent(new CustomEvent('optimando-sp-trigger-result-received')) } catch { /* noop */ }
      })()
      return
    }

    const tr = pendingTrigger.trigger
    const nameT = String(tr?.name ?? '').trim()
    const commandT = String(pendingTrigger.command ?? tr?.command ?? '').trim()
    const tagFromName = normaliseTriggerTag(nameT)
    const routeForLlm = commandT || tagFromName
    const displayForChat = commandT || (nameT ? nameT : '') || tagFromName
    pendingTriggerRef.current = null
    sidepanelTagResultConsumedAtRef.current = Date.now()
    const fn = handleSendMessageWithTriggerRef.current
    if (fn) {
      const displayLine = (displayForChat || tagFromName || '[Screenshot]').trim()
      const routeLine = ((routeForLlm || tagFromName).trim() || displayLine)
      // Signal that a result arrived so the poll+timeout stops.
      try { window.dispatchEvent(new CustomEvent('optimando-sp-trigger-result-received')) } catch { /* noop */ }
      void fn(displayLine, rawUrl, routeLine)
    }
  }

  // Storage-fallback delivery for trigger results (side panel):
  //   - Checks on mount in case a result was written before this panel was ready.
  //   - Fires on chrome.storage.onChanged for synchronous delivery.
  //   - Enforces a 30-second TTL so stale entries are discarded.
  //   - Polls every 500 ms while a trigger is in-flight; times out after 15 s.
  useEffect(() => {
    const KEY = 'optimando-wrchat-selection-fallback'
    const STALE_MS = 30_000
    const TRIGGER_TIMEOUT_MS = 15_000
    const POLL_MS = 500

    let pollInterval: ReturnType<typeof setInterval> | null = null
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    function clearPollAndTimeout() {
      if (pollInterval !== null) { clearInterval(pollInterval); pollInterval = null }
      if (timeoutHandle !== null) { clearTimeout(timeoutHandle); timeoutHandle = null }
    }

    function consumeFallbackEntry(entry: unknown) {
      if (!entry || typeof entry !== 'object') return false
      const rec = entry as { ts?: number; dataUrl?: string; promptContext?: string; url?: string }
      // Discard stale entries.
      if (typeof rec.ts === 'number' && Date.now() - rec.ts > STALE_MS) {
        void chrome.storage.local.remove(KEY)
        return false
      }
      void chrome.storage.local.remove(KEY)
      clearPollAndTimeout()
      processElectronSelectionForTagsRef.current(rec)
      return true
    }

    function checkStorage() {
      try {
        chrome.storage.local.get([KEY], (data: Record<string, unknown>) => {
          if (data?.[KEY]) consumeFallbackEntry(data[KEY])
        })
      } catch { /* noop */ }
    }

    // On-mount check — picks up results written before this panel was ready.
    checkStorage()

    const onStorage = (changes: chrome.storage.StorageChange, area: string) => {
      if (area !== 'local' || !changes[KEY]?.newValue) return
      consumeFallbackEntry(changes[KEY].newValue)
    }
    try { chrome.storage.onChanged.addListener(onStorage) } catch { /* noop */ }

    // Start poll + timeout when a trigger is dispatched.
    const onTriggerDispatched = () => {
      if (pollInterval !== null) clearInterval(pollInterval)
      pollInterval = setInterval(checkStorage, POLL_MS)
      if (timeoutHandle !== null) clearTimeout(timeoutHandle)
      timeoutHandle = setTimeout(() => {
        clearPollAndTimeout()
        if (pendingTriggerRef.current?.autoProcess) {
          pendingTriggerRef.current = null
          setChatMessages(prev => [...prev, {
            role: 'assistant' as const,
            text: '⚠️ Trigger timed out — no screenshot was received within 15 seconds. Is the WR Desk app running?',
          }])
        }
      }, TRIGGER_TIMEOUT_MS)
    }
    window.addEventListener('optimando-sp-trigger-dispatched', onTriggerDispatched)

    // Cancel poll+timeout when a result arrives (via sendMessage or storage path).
    const onTriggerResultReceived = () => clearPollAndTimeout()
    window.addEventListener('optimando-sp-trigger-result-received', onTriggerResultReceived)

    return () => {
      clearPollAndTimeout()
      try { chrome.storage.onChanged.removeListener(onStorage) } catch { /* noop */ }
      window.removeEventListener('optimando-sp-trigger-dispatched', onTriggerDispatched)
      window.removeEventListener('optimando-sp-trigger-result-received', onTriggerResultReceived)
    }
  }, [])

  const routeAssistantToInboxIfPending = React.useCallback((response: string) => {
    const ctx = pendingInboxAiRef.current
    if (ctx) {
      if (ctx.isBulk) {
        bulkInboxRef.current?.handleExternalAiQuery(ctx.query, ctx.messageId, response, 'text', 'search')
        bulkInboxRef.current?.stopGenerating(ctx.messageId)
      } else {
        inboxViewRef.current?.appendAiEntry({ query: ctx.query, content: response, type: 'text', source: 'search' })
        inboxViewRef.current?.stopGenerating()
      }
      pendingInboxAiRef.current = null
    }
  }, [])

  const handleSendMessage = async (options?: { textOverride?: string }) => {
    const text = (options?.textOverride ?? pendingInboxAiRef.current?.query ?? chatInput).trim()
    const displayText = text

    // If a document was attached (dropped or uploaded), consume its text and
    // prepend it to what gets sent to the LLM — the user's typed message
    // acts as the question/instruction about the document.
    const docCtx = pendingDocContent
    if (docCtx) setPendingDocContent(null)

    let beapAttachmentLlmPrefix: string | null = null
    if (
      dockedWorkspace === 'beap-messages' &&
      beapSubmode === 'inbox' &&
      beapInboxSelectedAttachmentIdRef.current
    ) {
      const inboxMsg = useBeapInboxStore.getState().getSelectedMessage()
      const aid = beapInboxSelectedAttachmentIdRef.current
      if (inboxMsg && aid) {
        const att = inboxMsg.attachments.find((a) => a.attachmentId === aid)
        const sem = att?.semanticContent?.trim()
        if (sem) {
          beapAttachmentLlmPrefix = `[Selected Attachment: ${att.filename}]\n${sem.slice(0, 4000)}`
        }
      }
    }

    const llmRouteText = beapAttachmentLlmPrefix
      ? `${beapAttachmentLlmPrefix}\n\n${displayText}`
      : docCtx
        ? `[Attached document: ${docCtx.name}]\n\n${docCtx.text}\n\n---\n${displayText}`
        : displayText

    // Current-turn image detection: only check the most recent user message, not history
    const lastUserMsg = [...chatMessages].reverse().find(m => m.role === 'user' && m.imageUrl)
    const currentTurnImageUrl = lastUserMsg?.imageUrl
    const hasImage = !!currentTurnImageUrl

    // Route AI response to inbox detail panel (or bulk grid pair) when in BEAP inbox with message selected
    if (
      !pendingInboxAiRef.current &&
      dockedWorkspace === 'beap-messages' &&
      beapSubmode === 'inbox' &&
      text
    ) {
      const selectedMessage = useBeapInboxStore.getState().getSelectedMessage()
      if (selectedMessage) {
        pendingInboxAiRef.current = {
          messageId: selectedMessage.messageId,
          query: text,
          attachmentId: beapInboxSelectedAttachmentIdRef.current ?? undefined,
        }
        inboxViewRef.current?.startGenerating()
      }
    }
    
    // If empty input, show helpful hint (unless a doc is attached — doc alone is valid)
    if (!text && !hasImage && !docCtx) {
      if (isLlmLoading) return
      setChatMessages([...chatMessages, {
        role: 'assistant' as const,
        text: `💡 **How to use WR Chat:**\n\n• Ask questions about the orchestrator or your workflow\n• Trigger automations using **#tagname** (e.g., "#summarize")\n• Use the 📸 button to capture screenshots for analysis\n• Drop or upload a file 📎 to attach it, then ask a question about it\n\nTry: "What can you help me with?" or "#help"`
      }])
      setTimeout(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
      }, 0)
      return
    }
    
    if (isLlmLoading) return
    
    // Check if model is available (custom mode can supply model name without picker selection)
    const effectiveLlmModel = getEffectiveLlmModelNameForActiveMode(activeLlmModelRef.current, activeLlmModel)
    if (!effectiveLlmModel) {
      setChatMessages([...chatMessages, {
        role: 'assistant' as const,
        text: `⚠️ No LLM model available. Please:\n\n1. Go to Admin panel (toggle at top)\n2. Open LLM Settings\n3. Install a trusted ultra-lightweight model:\n   • TinyLlama 1.1B (0.6GB) - Recommended\n   • Gemma 2B Q2_K (0.9GB) - Google\n   • StableLM 1.6B (1.0GB) - Stability AI\n4. Come back and try again!`
      }])
      setTimeout(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
      }, 0)
      return
    }
    
    // Add user message — show short text; LLM uses full document content via processedMessagesForLlm below
    const userDisplayText = text || (docCtx ? `📄 ${docCtx.name}` : '')
    const newMessages = userDisplayText
      ? [...chatMessages, { role: 'user' as const, text: userDisplayText }]
      : [...chatMessages]
    setChatMessages(newMessages)
    setChatInput('')
    setIsLlmLoading(true)
    
    // Helper to scroll chat to bottom
    const scrollToBottom = () => {
      setTimeout(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
      }, 0)
    }
    
    scrollToBottom()
    
    try {
      const baseUrl = 'http://127.0.0.1:51248'
      const sessionKeyForRoute = getActiveCustomModeRuntime()?.sessionId?.trim() || sessionKey

      // =================================================================
      // STEP 1: GET CURRENT CONTEXT
      // =================================================================
      let currentUrl = ''
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        currentUrl = tab?.url || ''
      } catch (e) {
        console.warn('[Chat] Could not get current tab URL:', e)
      }
      
      // =================================================================
      // STEP 2: OCR FOR CURRENT TURN (runs BEFORE routing)
      // Extract text from the current turn's image so OCR-derived
      // triggers can influence agent matching.
      // Resolve the image to a data URL first (hardened — never passes raw blob/path).
      // =================================================================
      let resolvedCurrentTurnImageUrl: string | null = null
      if (hasImage && currentTurnImageUrl) {
        resolvedCurrentTurnImageUrl = await resolveImageUrlForBackend(currentTurnImageUrl)
        if (!resolvedCurrentTurnImageUrl) {
          console.warn('[Sidepanel] handleSendMessage: current-turn image could not be resolved — sending text-only')
        }
      }
      let ocrText = ''
      if (resolvedCurrentTurnImageUrl) {
        ocrText = await runOcrForCurrentTurn(resolvedCurrentTurnImageUrl, baseUrl)
      }

      // When user typed nothing (screenshot-only send), use OCR text so agent tags can match
      const effectiveLlmRouteText = llmRouteText || ocrText || (resolvedCurrentTurnImageUrl ? '[screenshot]' : '')
      const enrichedRouteText = enrichRouteTextWithOcr(effectiveLlmRouteText, ocrText)
      const mergedContextPrefix = mergeLlmContextPrefixes(
        getChatFocusLlmPrefix(useChatFocusStore.getState()),
        getCustomModeLlmPrefix(getActiveCustomModeRuntime()),
      )
      const enrichedRouteTextForLlm = mergedContextPrefix
        ? `${mergedContextPrefix}\n\n${enrichedRouteText}`
        : enrichedRouteText

      // =================================================================
      // STEP 3: ROUTE INPUT + BUILD LLM MESSAGES (in parallel)
      // routeInput decides which agents receive the input.
      // processMessagesWithOCR builds the LLM conversation array.
      // Both are independent after OCR completes — run in parallel.
      // =================================================================
      const [routingDecision, { processedMessages }] = await Promise.all([
        routeInput(
          enrichedRouteTextForLlm,
          hasImage,
          connectionStatus,
          sessionName,
          effectiveLlmModel,
          currentUrl,
          sessionKeyForRoute
        ),
        processMessagesWithOCR(
          newMessages,
          baseUrl,
          hasImage ? { lastTurnOcrText: ocrText } : undefined,
        ),
      ])

      let processedMessagesForLlm = processedMessages

      // Inject document content into the last user message so the LLM receives it
      // (both for agent PATH A and butler PATH C)
      if (docCtx) {
        processedMessagesForLlm = [...processedMessages]
        for (let i = processedMessagesForLlm.length - 1; i >= 0; i--) {
          if (processedMessagesForLlm[i].role === 'user') {
            const existing = processedMessagesForLlm[i].content || ''
            processedMessagesForLlm[i] = {
              ...processedMessagesForLlm[i],
              content: `[Attached document: ${docCtx.name}]\n\n${docCtx.text}\n\n---\n${existing}`
            }
            break
          }
        }
      }

      if (beapAttachmentLlmPrefix) {
        processedMessagesForLlm = [...processedMessages]
        for (let i = processedMessagesForLlm.length - 1; i >= 0; i--) {
          if (processedMessagesForLlm[i].role === 'user') {
            processedMessagesForLlm[i] = {
              ...processedMessagesForLlm[i],
              content: `${beapAttachmentLlmPrefix}\n\n${processedMessagesForLlm[i].content}`,
            }
            break
          }
        }
      }

      if (mergedContextPrefix) {
        processedMessagesForLlm = prependHiddenContextToLastUserContent(processedMessagesForLlm, mergedContextPrefix)
      }
      
      // =================================================================
      // STEP 3.5: NLP CLASSIFICATION (diagnostics, does not override routing)
      // Classify input text (or OCR text) for structured logging.
      // Routing authority is Step 3 above (routeInput with enriched text).
      // Do not await — wink-nlp init can block the UI thread for a long time and
      // leave Send stuck on "Thinking" while the LLM path is otherwise ready.
      // =================================================================
      void nlpClassifier
        .classify(enrichedRouteTextForLlm, ocrText ? 'ocr' : 'inline_chat', {
          sourceUrl: currentUrl,
          sessionKey: sessionName,
        })
        .catch((e) => console.warn('[Chat] NLP classify failed:', e))

      // =================================================================
      // STEP 4: HANDLE ROUTING DECISION
      // =================================================================
      
      if (routingDecision.shouldForwardToAgent && routingDecision.matchedAgents.length > 0) {
        // =================================================================
        // PATH A: AGENT PROCESSING
        // 1. Butler shows immediate confirmation
        // 2. Each matched agent processes with reasoning wrapper
        // 3. Output goes to connected AgentBox (or inline if no box)
        // =================================================================
        
        // A1. Show Butler confirmation (immediate response)
        setChatMessages([...newMessages, { role: 'assistant' as const, text: routingDecision.butlerResponse }])
        routeAssistantToInboxIfPending(routingDecision.butlerResponse)
        scrollToBottom()
        
        // A2. Process with each matched agent
        for (const match of routingDecision.matchedAgents) {
          
          // Use helper function to process with agent
          // When user typed nothing (screenshot-only), use OCR text as the primary input
          const effectiveInputForAgent = llmRouteText || ocrText || (resolvedCurrentTurnImageUrl ? '[screenshot]' : '')
          const result = await processWithAgent(
            match,
            effectiveInputForAgent,
            ocrText,
            processedMessagesForLlm,
            effectiveLlmModel,
            baseUrl,
            resolvedCurrentTurnImageUrl,
            { preResolvedVisionB64: resolvedCurrentTurnImageUrl },
          )
          
          if (result.success && result.output) {
            // A3. Route output to AgentBox or inline chat
            // Use targetBoxIds to send to ALL connected boxes (e.g. sidebar + display grid)
            const allBoxIds = match.targetBoxIds && match.targetBoxIds.length > 0
              ? match.targetBoxIds
              : match.agentBoxId ? [match.agentBoxId] : []


            if (allBoxIds.length > 0) {
              const reasoningContext = `**Agent:** ${match.agentIcon} ${match.agentName}\n**Match:** ${match.matchDetails}\n**Input:** ${displayText}`
              
              for (const boxId of allBoxIds) {
                await updateAgentBoxOutput(boxId, result.output, reasoningContext, sessionKeyForRoute, 'sidepanel')
              }
              
              const agentConfirm = `[Agent: ${match.agentName}] responded. See agent box.`
              setChatMessages(prev => [...prev, { role: 'assistant' as const, text: agentConfirm }])
              routeAssistantToInboxIfPending(agentConfirm)
            } else {
              // No AgentBox - show full output in chat
              const agentOutput = `${match.agentIcon} **${match.agentName}**:\n\n${result.output}`
              setChatMessages(prev => [...prev, { role: 'assistant' as const, text: agentOutput }])
              routeAssistantToInboxIfPending(agentOutput)
            }
            scrollToBottom()
          } else if (result.error) {
            // Show error for this agent
            const agentErr = `⚠️ ${match.agentIcon} **${match.agentName}** error: ${result.error}`
            setChatMessages(prev => [...prev, { role: 'assistant' as const, text: agentErr }])
            routeAssistantToInboxIfPending(agentErr)
            scrollToBottom()
          }
        }
        
      } else if (routingDecision.butlerResponse) {
        // =================================================================
        // PATH B: SYSTEM STATUS RESPONSE
        // Butler handled this directly (e.g., "status", "what agents")
        // =================================================================
        setChatMessages([...newMessages, { role: 'assistant' as const, text: routingDecision.butlerResponse }])
        routeAssistantToInboxIfPending(routingDecision.butlerResponse)
        scrollToBottom()
        
      } else {
        // =================================================================
        // PATH C: BUTLER LLM RESPONSE
        // No agent match - use butler personality for general questions
        // =================================================================
        const butlerResult = await getButlerResponse(
          processedMessagesForLlm,
          effectiveLlmModel,
          baseUrl,
          resolvedCurrentTurnImageUrl,
          { preResolvedVisionB64: resolvedCurrentTurnImageUrl },
        )
        
        if (butlerResult.success && butlerResult.response) {
          setChatMessages([...newMessages, { role: 'assistant' as const, text: butlerResult.response }])
          routeAssistantToInboxIfPending(butlerResult.response)
          scrollToBottom()
        } else {
          throw new Error(butlerResult.error || 'No response from butler')
        }
      }
      
    } catch (error: any) {
      console.error('[Chat] Error:', error)
      
      // Provide helpful error messages
      let errorMsg = error.message || 'Failed to get response from LLM'
      
      if (errorMsg.includes('No models installed') || errorMsg.includes('Please go to LLM Settings')) {
        errorMsg = `⚠️ No LLM model installed!\n\nTo get started:\n1. Click Admin toggle at top\n2. Go to LLM Settings\n3. Install a trusted lightweight model:\n   • TinyLlama (0.6GB) - Recommended\n   • Gemma 2B Q2_K (0.9GB) - Google\n   • StableLM (1.0GB) - Stability AI\n\nThen come back and chat!`
      } else {
        errorMsg = `⚠️ Error: ${errorMsg}\n\nTip: Make sure Ollama is running and a trusted model is installed in LLM Settings.`
      }
      
      setChatMessages(prev => [...prev, { role: 'assistant' as const, text: errorMsg }])
      routeAssistantToInboxIfPending(errorMsg)
      
      // Scroll to bottom after error message
      setTimeout(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
      }, 0)
    } finally {
      const ctx = pendingInboxAiRef.current
      if (ctx) {
        if (ctx.isBulk) {
          bulkInboxRef.current?.stopGenerating(ctx.messageId)
        } else {
          inboxViewRef.current?.stopGenerating()
        }
        pendingInboxAiRef.current = null
      }
      setIsLlmLoading(false)
    }
  }

  const handleSendMessageRef = React.useRef(handleSendMessage)
  handleSendMessageRef.current = handleSendMessage

  React.useEffect(() => {
    if (isLlmLoading) return
    const next = diffMessageQueueRef.current.shift()
    if (!next) return
    void handleSendMessageRef.current({ textOverride: next }).catch((err) => {
      console.error('[Chat] diff queue flush:', err)
    })
  }, [isLlmLoading])

  /** Folder diff from Electron (fire-and-forget text — not `pendingTriggerRef` / capture flow). */
  const handleDiffMessage = React.useCallback((message: string) => {
    const t = (message ?? '').trim()
    if (!t) return
    if (isLlmLoading) {
      diffMessageQueueRef.current.push(t)
      return
    }
    void handleSendMessageRef.current({ textOverride: t }).catch((err) => {
      console.error('[Chat] handleDiffMessage:', err)
    })
  }, [isLlmLoading])

  const handleWatchdogAlert = React.useCallback((threats: WatchdogThreat[]) => {
    const alertMessage = formatWatchdogAlert(threats)
    setChatMessages((prev) => [
      ...prev,
      {
        role: 'assistant' as const,
        text: alertMessage,
      },
    ])
    setTimeout(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
    }, 0)
  }, [])

  React.useEffect(() => {
    const onAppend = (ev: Event) => {
      const d = (ev as CustomEvent<{ text?: string }>).detail
      const t = (d?.text ?? '').trim()
      if (!t) return
      setChatMessages((prev) => [...prev, { role: 'assistant' as const, text: t }])
      setTimeout(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
      }, 0)
    }
    window.addEventListener(WRCHAT_APPEND_ASSISTANT_EVENT, onAppend as EventListener)
    return () => window.removeEventListener(WRCHAT_APPEND_ASSISTANT_EVENT, onAppend as EventListener)
  }, [])

  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Handle model selection
  const handleModelSelect = (modelName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setActiveLlmModel(modelName)
    activeLlmModelRef.current = modelName
    try { localStorage.setItem('optimando-wr-chat-active-model', modelName) } catch {}
    setShowModelDropdown(false)
  }

  // Get short model name for display (e.g., "llama3.2:3b" -> "llama3.2")
  const getShortModelName = (name: string) => {
    if (!name) return 'No model'
    // Remove size suffix like :3b, :7b, :latest
    const baseName = name.split(':')[0]
    // Truncate if too long
    return baseName.length > 12 ? baseName.slice(0, 12) + '…' : baseName
  }

  // Render the Send button with integrated model dropdown
  const renderSendButton = () => {
    const hasModels = availableModels.length > 0
    const isDisabled = isLlmLoading || !chatInput.trim()
    const noInput = !chatInput.trim()
    const isReady = hasModels && activeLlmModel && !isLlmLoading
    
    // Colors based on state - always green
    const getButtonStyle = () => {
      // Loading state - purple/blue
      if (isLlmLoading) {
        return {
          bg: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          border: '1px solid #7c3aed',
          color: '#ffffff'
        }
      }
      
      // Always green - both active and inactive
      return {
        bg: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
        border: '1px solid #15803d',
        color: '#052e16'
      }
    }
    
    const style = getButtonStyle()
    
    return (
      <div 
        style={{ position: 'relative', display: 'flex', marginRight: '2px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Main Send button */}
        <button
          onClick={handleSendMessage}
          disabled={isDisabled}
          style={{
            height: '44px',
            padding: '4px 14px',
            background: style.bg,
            border: style.border,
            borderRight: 'none',
            borderTopLeftRadius: '10px',
            borderBottomLeftRadius: '10px',
            borderTopRightRadius: '0',
            borderBottomRightRadius: '0',
            color: style.color,
            cursor: isDisabled ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1px',
            boxShadow: isDisabled ? 'none' : '0 2px 4px rgba(0,0,0,0.1)'
          }}
          onMouseEnter={(e) => {
            if (!isDisabled) {
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = isDisabled ? 'none' : '0 2px 4px rgba(0,0,0,0.1)'
          }}
        >
          <span style={{ 
            fontSize: '13px', 
            fontWeight: '700',
            lineHeight: 1
          }}>
            {isLlmLoading ? '⏳ Thinking' : 'Send'}
          </span>
          <span style={{ 
            fontSize: '9px', 
            opacity: 0.8,
            lineHeight: 1,
            maxWidth: '70px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {hasModels ? getShortModelName(activeLlmModel) : 'No model'}
          </span>
        </button>
        
        {/* Model dropdown toggle — refresh models when opening, retry if empty */}
        <button
          onClick={async (e) => {
            e.stopPropagation()
            const next = !showModelDropdown
            if (next) {
              let ok = await refreshAvailableModels()
              if (!ok && availableModels.length === 0) {
                await new Promise(r => setTimeout(r, 2000))
                await refreshAvailableModels()
              }
            }
            setShowModelDropdown(next)
          }}
          disabled={isLlmLoading}
          style={{
              height: '44px',
              width: '22px',
              background: style.bg,
              border: style.border,
              borderLeft: '1px solid rgba(0,0,0,0.1)',
              borderTopRightRadius: '10px',
              borderBottomRightRadius: '10px',
              color: style.color,
              cursor: isLlmLoading ? 'not-allowed' : 'pointer',
              fontSize: '10px',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: isLlmLoading ? 'none' : '0 2px 4px rgba(0,0,0,0.1)'
            }}
            onMouseEnter={(e) => {
              if (!isLlmLoading) {
                e.currentTarget.style.opacity = '0.85'
                e.currentTarget.style.transform = 'translateY(-1px)'
              }
            }}
            onMouseLeave={(e) => {
              if (!isLlmLoading) {
                e.currentTarget.style.opacity = '1'
                e.currentTarget.style.transform = 'translateY(0)'
              }
            }}
          >
            ▾
          </button>
        
        {/* Model dropdown menu */}
        {showModelDropdown && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              bottom: '100%',
              right: 0,
              marginBottom: '6px',
              background: theme === 'standard' ? '#ffffff' : '#1e293b',
              border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.2)',
              borderRadius: '10px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              zIndex: 1000,
              minWidth: '180px',
              maxHeight: '220px',
              overflowY: 'auto'
            }}
          >
            <div style={{
              padding: '8px 12px',
              fontSize: '10px',
              fontWeight: '700',
              opacity: 0.5,
              borderBottom: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.1)',
              color: theme === 'standard' ? '#64748b' : 'inherit',
              letterSpacing: '0.5px'
            }}>
              SELECT MODEL
            </div>
            {availableModels.length === 0 && (
              <div style={{
                padding: '10px 12px',
                fontSize: '11px',
                opacity: 0.6,
                color: theme === 'standard' ? '#64748b' : 'inherit'
              }}>
                No models available. Install models in LLM Settings.
              </div>
            )}
            {availableModels.map((model) => (
              <div
                key={model.name}
                onClick={(e) => handleModelSelect(model.name, e)}
                style={{
                  padding: '10px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: model.name === activeLlmModel 
                    ? (theme === 'standard' ? 'rgba(34,197,94,0.12)' : 'rgba(34,197,94,0.25)')
                    : 'transparent',
                  color: theme === 'standard' ? '#0f172a' : 'inherit',
                  borderLeft: model.name === activeLlmModel ? '3px solid #22c55e' : '3px solid transparent',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  if (model.name !== activeLlmModel) {
                    e.currentTarget.style.background = theme === 'standard' ? '#f1f5f9' : 'rgba(255,255,255,0.08)'
                    e.currentTarget.style.borderLeftColor = '#22c55e'
                  }
                }}
                onMouseLeave={(e) => {
                  if (model.name !== activeLlmModel) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.borderLeftColor = 'transparent'
                  }
                }}
              >
                <span style={{ 
                  width: '16px',
                  color: '#22c55e',
                  fontWeight: '700'
                }}>
                  {model.name === activeLlmModel ? '✓' : ''}
                </span>
                <span style={{ 
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontWeight: model.name === activeLlmModel ? '600' : '400'
                }}>
                  {model.name}
                </span>
                {model.size && (
                  <span style={{ 
                    fontSize: '10px', 
                    opacity: 0.5, 
                    flexShrink: 0,
                    background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.1)',
                    padding: '2px 6px',
                    borderRadius: '4px'
                  }}>
                    {model.size}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const handleTriggerClick = (trigger: any) => {
    setShowTagsMenu(false)

    const capturedTrigger = trigger
    // New tag run — do not treat the next result as a duplicate of the previous capture (mirrors PopupChatView dashboard).
    sidepanelTagResultConsumedAtRef.current = 0
    pendingTriggerRef.current = {
      trigger: capturedTrigger,
      command: capturedTrigger.command || capturedTrigger.name,
      autoProcess: true,
    }

    try { window.dispatchEvent(new CustomEvent('optimando-sp-trigger-dispatched')) } catch { /* noop */ }

    const nameT = String(capturedTrigger?.name ?? '').trim()
    const commandT = String(capturedTrigger.command ?? capturedTrigger.name ?? '').trim()
    const tagFromName = normaliseTriggerTag(nameT)
    const routeForLlm = commandT || tagFromName
    const displayForChat = commandT || (nameT ? nameT : '') || tagFromName
    const displayLine = (displayForChat || tagFromName || '[Screenshot]').trim()
    const routeLine = ((routeForLlm || tagFromName).trim() || displayLine)

    void (async () => {
      const ensureSecret = async () => {
        if (launchSecretRef.current) return
        await new Promise<void>((resolve) => {
          try {
            chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (response: { secret?: string | null } | undefined) => {
              if (chrome.runtime.lastError) {
                resolve()
                return
              }
              if (response?.secret) launchSecretRef.current = response.secret
              resolve()
            })
          } catch {
            resolve()
          }
        })
      }
      await ensureSecret()

      const fn = handleSendMessageWithTriggerRef.current
      try {
        const res = await fetch('http://127.0.0.1:51248/api/lmgtfy/execute-trigger', {
          method: 'POST',
          headers: electronFetchHeaders(),
          body: JSON.stringify({ trigger: capturedTrigger, targetSurface: 'sidepanel' }),
          signal: AbortSignal.timeout(120_000),
        })
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean
          dataUrl?: string
          kind?: string
          error?: string
        } | null

        if (json?.ok && typeof json.dataUrl === 'string' && json.dataUrl.length > 0 && (!json.kind || json.kind === 'image')) {
          if (Date.now() - sidepanelTagResultConsumedAtRef.current < 10_000) {
            pendingTriggerRef.current = null
            try { window.dispatchEvent(new CustomEvent('optimando-sp-trigger-result-received')) } catch { /* noop */ }
            console.log('[Sidepanel] execute-trigger HTTP: result already applied (WS/storage won), skipping duplicate')
            return
          }
          sidepanelTagResultConsumedAtRef.current = Date.now()
          pendingTriggerRef.current = null
          try { window.dispatchEvent(new CustomEvent('optimando-sp-trigger-result-received')) } catch { /* noop */ }
          if (fn) await fn(displayLine, json.dataUrl, routeLine)
          return
        }

        const errorText = json?.error || (json?.ok === false ? 'Trigger capture failed' : 'No screenshot received from trigger')
        console.error('[Sidepanel] execute-trigger failed:', errorText)
        pendingTriggerRef.current = null
        try { window.dispatchEvent(new CustomEvent('optimando-sp-trigger-result-received')) } catch { /* noop */ }
        setChatMessages(prev => [...prev, {
          role: 'assistant' as const,
          text: `⚠️ Trigger capture failed: ${errorText}. Check that the WR Desk app is running and the trigger region is valid.`,
        }])
      } catch (err: unknown) {
        console.error('[Sidepanel] execute-trigger fetch error:', err)
        pendingTriggerRef.current = null
        try { window.dispatchEvent(new CustomEvent('optimando-sp-trigger-result-received')) } catch { /* noop */ }
        const msg = err instanceof Error ? err.message : 'Network error'
        setChatMessages(prev => [...prev, {
          role: 'assistant' as const,
          text: `⚠️ Trigger capture failed: ${msg}. Is the WR Desk app running?`,
        }])
      }
    })()
  }

  const handleDeleteTrigger = (index: number) => {
    const t = triggers[index]
    const label = String(t?.name ?? t?.command ?? `Trigger ${index + 1}`)
    if (!confirm(`Delete trigger "${label}"?`)) return
    
    const key = 'optimando-tagged-triggers'
    chrome.storage?.local?.get([key], (data: any) => {
      const list = Array.isArray(data?.[key]) ? data[key] : []
      list.splice(index, 1)
      chrome.storage?.local?.set({ [key]: list }, () => {
        setTriggers(list)
        chrome.runtime?.sendMessage({ type: 'TRIGGERS_UPDATED' })
        window.dispatchEvent(new CustomEvent('optimando-triggers-updated'))
      })
    })
  }

  const triggerAnchorKey = (t: any): string =>
    String(t?.name ?? t?.command ?? '').trim() || JSON.stringify(t).slice(0, 60)

  const handleToggleAnchor = (trigger: any) => {
    const key = triggerAnchorKey(trigger)
    setAnchoredTriggerKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      try {
        chrome.storage?.local?.set({ 'optimando-anchored-trigger-keys': next })
      } catch { /* noop */ }
      return next
    })
  }

  const handleToggleDiffPin = (id: string) => {
    setPinnedDiffIds((prev) => {
      const next = prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]
      try {
        chrome.storage?.local?.set({ 'optimando-pinned-diff-ids': next })
      } catch { /* noop */ }
      return next
    })
  }

  /** Shared trigger row used in all Tags dropdowns (identical across all 3 sidepanel layouts). */
  const renderTriggerRow = (trigger: any, i: number, totalCount: number) => {
    const isAnchored = anchoredTriggerKeys.includes(triggerAnchorKey(trigger))
    const anchorKey = triggerAnchorKey(trigger)
    return (
      <div
        key={i}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '5px 8px',
          borderBottom: i < totalCount - 1 ? '1px solid rgba(255,255,255,0.12)' : 'none',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.06)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
      >
        {/* Pin / anchor icon */}
        <button
          type="button"
          title={isAnchored ? 'Remove icon from top edge' : 'Show icon shortcut at top edge of chat'}
          onClick={(e) => { e.stopPropagation(); handleToggleAnchor(trigger) }}
          style={{
            width: 22,
            height: 20,
            flexShrink: 0,
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 13,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isAnchored ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.08)',
            color: isAnchored ? '#a5b4fc' : 'rgba(255,255,255,0.5)',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.35)' }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = isAnchored
              ? 'rgba(99,102,241,0.45)'
              : 'rgba(255,255,255,0.08)'
          }}
        >
          {isAnchored ? spEmojiForKey(anchorKey) : '◎'}
        </button>
        {/* Trigger name / run */}
        <button
          type="button"
          onClick={() => handleTriggerClick(trigger)}
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: 'left',
            padding: '2px 0',
            fontSize: 12,
            cursor: 'pointer',
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {trigger.name || trigger.command || `Trigger ${i + 1}`}
        </button>
        {/* Delete */}
        <button
          type="button"
          title="Delete trigger"
          onClick={(e) => { e.stopPropagation(); handleDeleteTrigger(i) }}
          style={{
            width: 20,
            height: 20,
            flexShrink: 0,
            border: 'none',
            background: 'rgba(239,68,68,0.22)',
            color: '#f87171',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 15,
            lineHeight: 1,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.45)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.22)' }}
        >
          ×
        </button>
      </div>
    )
  }

  const createNewSession = () => {
    // Send message to content script to create new session
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        const tabId = tabs[0].id
        chrome.tabs.sendMessage(tabId, { type: 'CREATE_NEW_SESSION' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('❌ Error creating session:', chrome.runtime.lastError)
            showNotification('Failed to create session', 'error')
            return
          }
          
          // Poll for updated session data after creation - multiple attempts
          let pollAttempts = 0
          const pollInterval = setInterval(() => {
            pollAttempts++
            
            chrome.tabs.sendMessage(tabId, { type: 'GET_SESSION_DATA' }, (sessionResponse) => {
              if (chrome.runtime.lastError) {
                console.error('❌ Error getting session data:', chrome.runtime.lastError)
                if (pollAttempts >= 3) {
                  clearInterval(pollInterval)
                  showNotification('Session created but data not synced', 'error')
                }
                return
              }
              if (sessionResponse) {
                
                // Show session name (editable), sessionKey shown below in small text
                setSessionName(sessionResponse.sessionName || 'New Session')
                setSessionKey(sessionResponse.sessionKey || '')
                setIsLocked(sessionResponse.isLocked || false)
                setAgentBoxes(sessionResponse.agentBoxes || [])
                
                // Show success notification
                showNotification(`🆕 New session "${sessionResponse.sessionName || sessionResponse.sessionKey}" started!`, 'success')
                clearInterval(pollInterval)
              } else if (pollAttempts >= 3) {
                clearInterval(pollInterval)
                showNotification('Session created but no data received', 'error')
              }
            })
          }, 200) // Poll every 200ms, up to 3 times
        })
      }
    })
  }

  // Get theme colors - Matching Dashboard App.css exactly
  const getThemeColors = () => {
    switch (theme) {
      case 'dark':
        return {
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          text: '#e7e9ea' // Matching Dashboard --text-primary-dark
        }
      case 'standard':
        return {
          // Matching Dashboard: --bg-base-prof: #f8f9fb (grey-white tone, not pure white)
          background: '#f8f9fb',
          text: '#0f1419' // Matching Dashboard --text-primary-prof
        }
      default: // 'pro'
        return {
          // Matching Dashboard: [data-ui-theme="pro"] body uses gradient
          background: 'linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #9333ea 100%)',
          text: '#ffffff' // Matching Dashboard --text-primary for pro
        }
    }
  }

  // Get icon button style based on theme
  const getIconButtonStyle = (baseColor: string) => {
    if (theme === 'standard') {
      return {
        background: '#ffffff',
        border: '1px solid #94a3b8',
        color: '#0f172a'
      }
    } else if (theme === 'dark') {
      return {
        background: 'rgba(255,255,255,0.1)',
        border: '1px solid rgba(255,255,255,0.2)',
        color: '#f1f5f9'
      }
    } else {
      return {
        background: baseColor,
        border: 'none',
        color: 'white'
      }
    }
  }

  const themeColors = getThemeColors()

  // Selectbox style based on theme
  const getSelectboxStyle = () => {
    if (theme === 'standard') {
      return {
        background: '#ffffff',
        color: '#0f172a',
        arrowColor: '%230f172a'
      }
    } else if (theme === 'dark') {
      return {
        background: 'rgba(30, 41, 59, 0.9)',
        color: '#f1f5f9',
        arrowColor: '%23f1f5f9'
      }
    } else {
      // Pro theme
      return {
        background: 'rgba(55, 65, 81, 0.85)',
        color: '#ffffff',
        arrowColor: '%23ffffff'
      }
    }
  }
  const selectboxStyle = getSelectboxStyle()

  // Admin icon button style
  const adminIconStyle = {
    width: '32px',
    height: '32px',
    flexShrink: 0,
    ...(theme === 'standard' ? {
      background: '#ffffff',
      border: '1px solid #94a3b8',
      color: '#0f172a'
    } : theme === 'dark' ? {
      background: 'rgba(255,255,255,0.1)',
      border: '1px solid rgba(255,255,255,0.2)',
      color: '#f1f5f9'
    } : {
      background: 'rgba(118, 75, 162, 0.45)',
      border: '1px solid rgba(255,255,255,0.5)',
      color: 'white'
    }),
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease'
  }

  // Action button style (for session controls)
  const actionButtonStyle = (baseColor: string) => ({
    width: '32px',
    height: '32px',
    flexShrink: 0,
    ...(theme === 'standard' ? {
      background: '#ffffff',
      border: '1px solid #94a3b8',
      color: '#0f172a'
    } : theme === 'dark' ? {
      background: 'rgba(255,255,255,0.1)',
      border: '1px solid rgba(255,255,255,0.2)',
      color: '#f1f5f9'
    } : {
      background: 'rgba(118, 75, 162, 0.45)',
      border: '1px solid rgba(255,255,255,0.5)',
      color: 'white'
    }),
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease'
  })

  // Command chat control button style
  const chatControlButtonStyle = () => ({
    ...(theme === 'standard' ? {
      background: '#ffffff',
      border: '1px solid #94a3b8',
      color: '#0f172a'
    } : theme === 'dark' ? {
      background: 'rgba(255,255,255,0.1)',
      border: '1px solid rgba(255,255,255,0.2)',
      color: '#f1f5f9'
    } : {
      background: 'rgba(118,75,162,0.35)',
      border: '1px solid rgba(255,255,255,0.45)',
      color: 'white'
    })
  })

  // WR button style (for WR Login and Vault)
  const wrButtonStyle = () => ({
    width: '100%',
    padding: '12px 18px',
    ...(theme === 'standard' ? {
      background: '#ffffff',
      border: '1px solid #94a3b8',
      color: '#0f172a'
    } : theme === 'dark' ? {
      background: 'rgba(255,255,255,0.15)',
      border: '1px solid rgba(255,255,255,0.3)',
      color: '#f1f5f9'
    } : {
      background: 'rgba(118,75,162,0.35)',
      border: '1px solid rgba(255,255,255,0.45)',
      color: 'white'
    }),
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.2s ease'
  })

  const addMiniApp = () => {
    // TODO: Implement mini-app installation dialog
    showNotification('Mini-app installation coming soon!', 'info')
  }

  // Electron App Not Running Dialog Component
  const ElectronNotRunningDialog = () => {
    if (!showElectronDialog) return null
    
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.85)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}>
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '16px',
          padding: '24px',
          maxWidth: '380px',
          width: '100%',
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
          color: 'white',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🖥️</div>
          
          <>
            <div style={{
                background: 'rgba(0,0,0,0.2)',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '16px',
                textAlign: 'left'
              }}>
                <p style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 600 }}>
                  Please start the app manually:
                </p>
                <ol style={{ margin: '0', paddingLeft: '20px', fontSize: '12px', lineHeight: 1.6 }}>
                  {platformOs === 'linux' ? (
                    <>
                      <li>Open your application menu</li>
                      <li>Search for <strong>WR Desk</strong></li>
                      <li>Click to launch the application</li>
                      <li>Wait for the tray icon (🧠) to appear</li>
                      <li>Click <strong>Retry Connection</strong> below</li>
                    </>
                  ) : (
                    <>
                      <li>Open the <strong>Start Menu</strong></li>
                      <li>Search for <strong>WR Desk</strong></li>
                      <li>Click to launch the application</li>
                      <li>Wait for the tray icon (🧠) to appear</li>
                      <li>Click <strong>Retry Connection</strong> below</li>
                    </>
                  )}
                </ol>
              </div>
              
              <button
                onClick={retryConnection}
                disabled={isLaunchingElectron}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  background: isLaunchingElectron ? 'rgba(255,255,255,0.3)' : '#22c55e',
                  border: 'none',
                  borderRadius: '8px',
                  color: isLaunchingElectron ? 'white' : '#0b1e12',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: isLaunchingElectron ? 'wait' : 'pointer',
                  marginBottom: '12px',
                  transition: 'all 0.2s'
                }}
              >
                {isLaunchingElectron ? '⏳ Checking...' : '🔄 Retry Connection'}
              </button>
          </>
          
          <button
            onClick={() => setShowElectronDialog(false)}
            style={{
              width: '100%',
              padding: '10px 20px',
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: '8px',
              color: 'white',
              fontSize: '12px',
              cursor: 'pointer',
              marginBottom: '16px'
            }}
          >
            Continue without Dashboard
          </button>
          
          <div style={{ 
            fontSize: '11px', 
            opacity: 0.7,
            lineHeight: 1.4,
            borderTop: '1px solid rgba(255,255,255,0.2)',
            paddingTop: '12px'
          }}>
            <strong>Tip:</strong> {platformOs === 'linux'
              ? 'On Linux, start WR Desk from your application menu. Check the system tray (🧠) if it\'s running.'
              : 'The dashboard normally starts automatically with Windows. Check the system tray (🧠) if it\'s running in the background.'}
          </div>
        </div>
      </div>
    )
  }

  // ==========================================================================
  // AUTH-GATED UI: Show minimal login screen when not logged in
  // ==========================================================================
  
  // Loading state - show simple loading indicator
  if (isLoggedIn === null) {
    return (
      <div style={{
        width: '100%',
        minHeight: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        background: themeColors.background,
        color: themeColors.text,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{
          fontSize: '13px',
          color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)',
          textAlign: 'center'
        }}>
          Loading WR Desk™…
        </div>
      </div>
    )
  }
  
  // Logged-out state: Show ONLY logo + Sign In + Create Account
  if (!isLoggedIn) {
    const accentColor = theme === 'standard' ? '#6366f1' : '#a78bfa'
    const mutedColor = theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)'
    
    return (
      <div style={{
        width: '100%',
        minHeight: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        background: themeColors.background,
        color: themeColors.text,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        gap: '24px',
        boxSizing: 'border-box'
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
        
        {/* Sign In Button - matches wrdesk.com Sign In button with exact key icon */}
        <button
          onClick={handleAuthSignIn}
          disabled={isLoggingIn}
          style={{
            padding: '10px 24px',
            background: '#1559ed',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            fontSize: '14px',
            fontWeight: '500',
            cursor: isLoggingIn ? 'wait' : 'pointer',
            transition: 'all 0.15s ease',
            opacity: isLoggingIn ? 0.7 : 1,
            minWidth: '180px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
          onMouseEnter={(e) => {
            if (!isLoggingIn) {
              e.currentTarget.style.background = '#0d47c2';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#1559ed';
          }}
        >
          {/* Key Icon - exact SVG from wrdesk.com */}
          <svg 
            width="15" 
            height="15" 
            viewBox="0 0 512 512" 
            fill="currentColor"
            style={{ flexShrink: 0 }}
          >
            <path d="M512 176.001C512 273.203 433.202 352 336 352c-11.22 0-22.19-1.062-32.827-3.069l-24.012 27.014A23.999 23.999 0 0 1 261.223 384H224v40c0 13.255-10.745 24-24 24h-40v40c0 13.255-10.745 24-24 24H24c-13.255 0-24-10.745-24-24v-78.059c0-6.365 2.529-12.47 7.029-16.971l161.802-161.802C163.108 213.814 160 195.271 160 176 160 78.798 238.797.001 335.999 0 433.488-.001 512 78.511 512 176.001zM336 128c0 26.51 21.49 48 48 48s48-21.49 48-48-21.49-48-48-48-48 21.49-48 48z"/>
          </svg>
          {isLoggingIn ? 'Signing in...' : 'Sign in with wrdesk.com'}
        </button>
        
        {/* Create Account Link */}
        <button
          onClick={handleAuthCreateAccount}
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
          Create free account
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
                  onClick={handleAuthSignIn}
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
  // LOGGED-IN STATE: Show full dashboard UI below
  // ==========================================================================

  // Minimal UI for display grids and Edge startpage
  if (showMinimalUI) {
    return (
      <div style={{
        width: '100%',
        minHeight: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        background: themeColors.background,
        color: themeColors.text,
        padding: '0',
        margin: '0',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'hidden'
      }}>
        {/* Electron Not Running Dialog */}
        <ElectronNotRunningDialog />
        <AddModeWizardHost theme={theme} />

        {/* Top Bar: 2 Small Icons + Toggle */}
        <div style={{ 
          padding: '8px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          background: theme === 'pro' ? 'rgba(118,75,162,0.6)' : 'rgba(0,0,0,0.15)'
        }}>
          <button
            onClick={openPopupChat}
            style={{
              ...actionButtonStyle('rgba(255,255,255,0.1)'),
              fontSize: '14px',
              padding: 0
            }}
            title="Open Popup Chat"
          >
            💬
          </button>
          <button
            onClick={toggleCommandChatPin}
            style={{
              ...actionButtonStyle(isCommandChatPinned ? 'rgba(76,175,80,0.4)' : 'rgba(255,255,255,0.1)'),
              fontSize: '14px',
              padding: 0,
              ...(isCommandChatPinned && theme === 'pro' ? {
                background: 'rgba(76,175,80,0.4)',
                border: '1px solid rgba(76,175,80,0.6)'
              } : {})
            }}
            title={isCommandChatPinned ? "Unpin Command Chat" : "Pin Command Chat"}
          >
            📌
          </button>
          <div
            onClick={toggleViewMode}
            style={{
              cursor: isAdminDisabled ? 'not-allowed' : 'pointer',
              opacity: isAdminDisabled ? 0.6 : 1,
              marginLeft: 'auto'
            }}
            title={isAdminDisabled ? 'Open a website for viewing the admin panel' : `Switch to ${viewMode === 'app' ? 'Admin' : 'App'} view`}
          >
            <div style={{
              position: 'relative',
              width: '50px',
              height: '20px',
              background: viewMode === 'app'
                ? (theme === 'pro' ? 'rgba(76,175,80,0.9)' : theme === 'dark' ? 'rgba(76,175,80,0.9)' : 'rgba(34,197,94,0.9)')
                : (theme === 'pro' ? 'rgba(255,255,255,0.2)' : theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.2)'),
              borderRadius: '10px',
              transition: 'background 0.2s',
              border: theme === 'pro' ? '1px solid rgba(255,255,255,0.3)' : theme === 'dark' ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(15,23,42,0.3)',
              overflow: 'hidden'
            }}>
              <span style={{
                position: 'absolute',
                left: viewMode === 'app' ? '8px' : 'auto',
                right: viewMode === 'app' ? 'auto' : '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '9px',
                fontWeight: '700',
                color: viewMode === 'app'
                  ? 'rgba(255,255,255,0.95)'
                  : (theme === 'pro' ? 'rgba(255,255,255,0.5)' : theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(15,23,42,0.5)'),
                transition: 'all 0.2s',
                userSelect: 'none',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                zIndex: 1,
                whiteSpace: 'nowrap',
                lineHeight: '1'
              }}>App</span>
              <div style={{
                position: 'absolute',
                top: '3px',
                left: viewMode === 'app' ? '32px' : '3px',
                width: '14px',
                height: '14px',
                background: theme === 'pro' ? 'rgba(255,255,255,0.95)' : theme === 'dark' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.95)',
                borderRadius: '50%',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                zIndex: 2
              }} />
            </div>
          </div>
        </div>
        
        {/* Docked Command Chat - Full Featured (Only when pinned) */}
        {isCommandChatPinned && (
          <>
            <div 
              style={{
                borderBottom: '1px solid rgba(255,255,255,0.2)',
                background: theme === 'pro' ? 'rgba(118,75,162,0.4)' : 'rgba(255,255,255,0.10)',
                border: '1px solid rgba(255,255,255,0.20)',
                margin: '12px 16px',
                borderRadius: '8px',
                overflow: 'hidden',
                position: 'relative',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
              }}
              onDragOver={(e) => { e.preventDefault(); setIsDraggingOverChat(true) }}
              onDragEnter={(e) => { e.preventDefault(); setIsDraggingOverChat(true) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingOverChat(false) }}
              onDrop={handleChatDrop}
            >
              {/* Drag-and-drop overlay */}
              {isDraggingOverChat && (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 50,
                  background: 'rgba(168,85,247,0.18)',
                  border: '2px dashed #a855f7',
                  borderRadius: '8px',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'none'
                }}>
                  <div style={{ fontSize: '28px', marginBottom: '6px' }}>📎</div>
                  <div style={{ color: '#a855f7', fontWeight: 700, fontSize: '13px' }}>Drop file or image here</div>
                  <div style={{ color: '#c084fc', fontSize: '11px', marginTop: '4px', opacity: 0.8 }}>Images, text files, documents</div>
                </div>
              )}
              {/* Header - Enterprise Design */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                background: theme === 'standard' ? '#ffffff' : theme === 'dark' ? 'linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.9) 100%)' : 'linear-gradient(180deg, rgba(15,10,30,0.95) 0%, rgba(30,20,50,0.9) 100%)',
                borderBottom: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(168,85,247,0.3)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                color: themeColors.text
              }}>
                {/* Selectors */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                  <select
                    key={`workspace-select-minimal-${theme}`}
                    value={dockedWorkspace}
                    onChange={(e) => setDockedWorkspace(e.target.value as typeof dockedWorkspace)}
                    style={{
                      fontSize: '11px',
                      fontWeight: '500',
                      height: '26px',
                      width: '95px',
                      background: selectboxStyle.background,
                      border: 'none',
                      color: selectboxStyle.color,
                      borderRadius: '13px',
                      padding: '0 20px 0 8px',
                      transition: 'all 0.15s ease',
                      cursor: 'pointer',
                      outline: 'none',
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6' viewBox='0 0 12 12'%3E%3Cpath fill='${selectboxStyle.arrowColor}' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 5px center'
                    }}
                  >
                    <option value="wr-chat">💬 WR Chat</option>
                    <option value="augmented-overlay">🎯 Augmented Overlay</option>
                    <option value="beap-messages">📦 BEAP Messages</option>
                    <option value="wrguard">🔒 WRGuard</option>
                  </select>
                  {dockedWorkspace === 'wr-chat' && (
                    <select
                      key={`submode-select-minimal-${theme}`}
                      value={dockedSubmode}
                      onChange={(e) => setDockedSubmode(e.target.value as typeof dockedSubmode)}
                      style={{
                        fontSize: '11px',
                        fontWeight: '500',
                        height: '26px',
                        width: '90px',
                        background: selectboxStyle.background,
                        border: 'none',
                        color: selectboxStyle.color,
                        borderRadius: '13px',
                        padding: '0 14px 0 6px',
                        cursor: 'pointer',
                        outline: 'none',
                        appearance: 'none',
                        WebkitAppearance: 'none',
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6' viewBox='0 0 12 12'%3E%3Cpath fill='${selectboxStyle.arrowColor}' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 4px center'
                      }}
                    >
                      <option value="command">cmd</option>
                      <option value="p2p-chat">Direct Chat</option>
                      <option value="p2p-stream">Live Views</option>
                      <option value="group-stream">Group Sessions</option>
                      <option value="handshake">Handshake Request</option>
                    </select>
                  )}
                  {dockedWorkspace === 'beap-messages' && (
                    <select
                      key={`beap-submode-select-minimal-${theme}`}
                      value={beapSubmode}
                      onChange={(e) => setBeapSubmode(e.target.value as typeof beapSubmode)}
                      style={{
                        fontSize: '11px',
                        fontWeight: '500',
                        height: '26px',
                        width: '90px',
                        background: selectboxStyle.background,
                        border: 'none',
                        color: selectboxStyle.color,
                        borderRadius: '13px',
                        padding: '0 14px 0 6px',
                        cursor: 'pointer',
                        outline: 'none',
                        appearance: 'none',
                        WebkitAppearance: 'none',
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6' viewBox='0 0 12 12'%3E%3Cpath fill='${selectboxStyle.arrowColor}' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 4px center'
                      }}
                    >
                      <option value="inbox">📥 Inbox</option>
                      <option value="bulk-inbox">⚡ Bulk Inbox</option>
                      <option value="draft">✏️ Draft</option>
                      <option value="outbox">📤 Outbox</option>
                      <option value="archived">📁 Archived</option>
                      <option value="rejected">🚫 Rejected</option>
                    </select>
                  )}
                </div>
                {/* Controls */}
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'nowrap', justifyContent: 'flex-end', minWidth: 0 }}>
                  {((dockedPanelMode as string) !== 'admin' && dockedWorkspace !== 'beap-messages' && dockedWorkspace !== 'wrguard') && <>
                    <WrChatCaptureButton
                      variant="compact"
                      theme={theme}
                      sidepanelPreset="enterprise"
                      source="sidepanel-docked-chat"
                      createTrigger={createTriggerChecked}
                      addCommand={addCommandChecked}
                    />
                    <WrChatDiffButton
                      variant="compact"
                      theme={theme}
                      sidepanelPreset="enterprise"
                      onDiffMessage={handleDiffMessage}
                      pinnedDiffIds={pinnedDiffIds}
                      onToggleDiffPin={handleToggleDiffPin}
                      onWatchersChange={setDiffWatchers}
                      openDialogRef={diffDialogOpenRef}
                    />
                    <button
                      type="button"
                      onClick={clearWrChat}
                      title="Clear chat"
                      style={{
                        ...chatControlButtonStyle(),
                        borderRadius: '6px',
                        padding: '0 5px',
                        height: '22px',
                        fontSize: '10px',
                        fontWeight: 500,
                        opacity: 0.55,
                        border: 'none',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s ease',
                        minWidth: 22,
                        ...(theme === 'standard' ? { color: '#0f172a' } : {}),
                      }}
                      onMouseEnter={(e) => {
                        if (theme === 'standard') {
                          e.currentTarget.style.background = '#eef3f6'
                          e.currentTarget.style.color = '#0f172a'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (theme === 'standard') {
                          e.currentTarget.style.background = '#ffffff'
                          e.currentTarget.style.color = '#0f172a'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                        }
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {/* Anchored triggers shown as icons on the top edge of the chat inner frame — not as chips here */}
                    <div style={{ position: 'relative' }}>
                      <button 
                        onClick={() => setShowTagsMenu(!showTagsMenu)}
                        title="Tags - Quick access to saved triggers"
                        style={{
                          ...chatControlButtonStyle(),
                          borderRadius: '6px',
                          padding: '0 10px',
                          height: '22px',
                          fontSize: '10px',
                          ...(theme === 'standard'
                            ? { border: 'none' }
                            : {
                                background: 'rgba(255,255,255,0.15)',
                                border: 'none',
                                color: '#ffffff',
                              }),
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          if (theme === 'standard') {
                            e.currentTarget.style.background = '#eef3f6'
                            e.currentTarget.style.color = '#0f172a'
                          } else if (theme === 'dark') {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                          } else {
                            e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (theme === 'standard') {
                            e.currentTarget.style.background = '#f8f9fb'
                            e.currentTarget.style.color = '#0f172a'
                          } else if (theme === 'dark') {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                          } else {
                            e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                          }
                        }}
                      >
                        {/* Tag / label icon */}
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <circle cx="7" cy="7" r="1.5" fill="currentColor" />
                        </svg>
                        Tags{' '}
                        <span
                          style={{
                            fontSize: '11px',
                            opacity: 0.9,
                            color: theme === 'standard' ? '#0f172a' : undefined,
                          }}
                        >
                          ▾
                        </span>
                      </button>
                      
                        {/* Tags Dropdown Menu */}
                      {showTagsMenu && (
                        <div 
                          style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            minWidth: '180px',
                            width: '240px',
                            maxHeight: '300px',
                            overflowY: 'auto',
                            zIndex: 2147483647,
                            background: '#111827',
                            color: 'white',
                            border: '1px solid rgba(255,255,255,0.20)',
                            borderRadius: '8px',
                            boxShadow: '0 10px 22px rgba(0,0,0,0.35)',
                            marginTop: '4px'
                          }}
                        >
                          {triggers.length === 0 ? (
                            <div style={{ padding: '8px 10px', fontSize: '12px', opacity: 0.8 }}>
                              No tags yet
                            </div>
                          ) : (
                            triggers.map((trigger, i) => renderTriggerRow(trigger, i, triggers.length))
                          )}
                        </div>
                      )}
                    </div>
                  </>}
                  <button 
                    onClick={toggleCommandChatPin}
                    title="Unpin from sidepanel"
                    style={{
                      background: 'rgba(255,255,255,0.15)',
                      border: 'none',
                      color: '#ffffff',
                      height: '28px',
                      minWidth: '28px',
                      borderRadius: '14px',
                      padding: '0 8px',
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    ↗
                  </button>
                </div>
              </div>

              {/* Command Chat Content - Section 1 (showMinimalUI) */}
              {/* P2P Chat Placeholder */}
              {dockedPanelMode === 'p2p-chat' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : 'rgba(255,255,255,0.06)', minHeight: '280px' }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.1)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6b7280' }} />
                      <span style={{ fontSize: '12px', opacity: 0.7, color: theme === 'standard' ? '#0f172a' : 'inherit' }}>No peer connected</span>
                    </div>
                    <button style={{ padding: '4px 10px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', cursor: 'pointer' }}>Connect</button>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* Empty messages area */}
                  </div>
                  <div style={{ padding: '10px 12px', borderTop: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <textarea placeholder="Message or capsule..." style={{ flex: 1, padding: '8px 10px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', resize: 'none', minHeight: '32px', maxHeight: '80px' }} />
                    <button title="Build Capsule" style={{ width: '32px', height: '32px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>💊</button>
                    <button title="AI Assistant" style={{ width: '32px', height: '32px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✨</button>
                    <button title="Attach" style={{ width: '32px', height: '32px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>
                    <button style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: 'none', borderRadius: '8px', color: 'white', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Send</button>
                  </div>
                </div>
              )}

              {/* P2P Stream Placeholder */}
              {dockedPanelMode === 'p2p-stream' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#000', minHeight: '280px' }}>
                  <div style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    <div style={{ textAlign: 'center', color: '#666' }}>
                      <div style={{ fontSize: '40px', marginBottom: '8px' }}>📹</div>
                      <div style={{ fontSize: '12px' }}>No active stream</div>
                    </div>
                    <div style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '6px' }}>
                      <button style={{ padding: '6px 10px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.15)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>🎥 Start</button>
                      <button style={{ padding: '6px 10px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.15)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>🎙️ Mute</button>
                      <button style={{ padding: '6px 10px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.15)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>📺 Share</button>
                    </div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '120px', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : (theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.06)') }}>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}></div>
                    <div style={{ padding: '8px', display: 'flex', gap: '6px', alignItems: 'center', borderTop: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.1)' }}>
                      <textarea placeholder="Chat..." style={{ flex: 1, padding: '6px 8px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', resize: 'none', minHeight: '28px' }} />
                      <button title="AI Assistant" style={{ width: '28px', height: '28px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', cursor: 'pointer' }}>✨</button>
                      <button style={{ padding: '6px 12px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Send</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Group Stream Placeholder */}
              {dockedPanelMode === 'group-stream' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#000', minHeight: '280px' }}>
                  <div style={{ flex: 2, display: 'flex' }}>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #333' }}>
                      <div style={{ textAlign: 'center', color: '#666' }}>
                        <div style={{ fontSize: '32px' }}>👤</div>
                        <div style={{ fontSize: '10px', marginTop: '4px' }}>Host</div>
                      </div>
                    </div>
                    <div style={{ width: '70px', display: 'flex', flexDirection: 'column', gap: '2px', padding: '4px', overflowY: 'auto' }}>
                      <div style={{ aspectRatio: '1', background: '#111', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: '14px' }}>👤</div>
                      <div style={{ aspectRatio: '1', background: '#111', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: '14px' }}>+</div>
                    </div>
                  </div>
                  <div style={{ padding: '6px 10px', borderTop: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.15)', borderBottom: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.15)', display: 'flex', gap: '6px', justifyContent: 'center', background: theme === 'standard' ? '#f8f9fb' : 'rgba(0,0,0,0.3)' }}>
                    <button style={{ padding: '4px 8px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '4px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', cursor: 'pointer' }}>🎥</button>
                    <button style={{ padding: '4px 8px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '4px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', cursor: 'pointer' }}>🎙️</button>
                    <button style={{ padding: '4px 8px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '4px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', cursor: 'pointer' }}>📺</button>
                    <button style={{ padding: '4px 8px', background: 'rgba(239,68,68,0.2)', border: 'none', borderRadius: '4px', color: '#ef4444', fontSize: '10px', cursor: 'pointer' }}>Leave</button>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100px', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : (theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.06)') }}>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}></div>
                    <div style={{ padding: '8px', display: 'flex', gap: '6px', alignItems: 'center', borderTop: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.1)' }}>
                      <textarea placeholder="Group chat..." style={{ flex: 1, padding: '6px 8px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', resize: 'none', minHeight: '28px' }} />
                      <button title="AI Assistant" style={{ width: '28px', height: '28px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', cursor: 'pointer' }}>✨</button>
                      <button style={{ padding: '6px 12px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Send</button>
                    </div>
                  </div>
                </div>
              )}

              {/* BEAP Handshake Request — Send Handshake Delivery */}
              {dockedPanelMode === 'handshake' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : (theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.06)'), minHeight: '280px', overflowY: 'auto' }}>
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
                          <input type="radio" name="hs-policy-docked" checked={active} onChange={() => setHsPolicy({ ai_processing_mode: val })} style={{ marginTop: '3px', accentColor: '#8b5cf6' }} />
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
              )}

              {(dockedPanelMode === 'command' || dockedPanelMode === 'augmented-overlay') && (
              <>
              {/* Messages Area */}
              <div 
                id="ccd-messages-sidepanel"
                ref={chatRef}
                style={{
                  height: `${chatHeight}px`,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.06)',
                  borderBottom: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.20)',
                  padding: '14px',
                  position: 'relative',
                  paddingTop: (anchoredTriggerKeys.length > 0 || pinnedDiffIds.length > 0) ? 40 : 14,
                }}
              >
                <ChatFocusBanner theme={theme} />
                {/* Top-edge pinned icon strip */}
                {(anchoredTriggerKeys.length > 0 || pinnedDiffIds.length > 0) && (
                  <div role="toolbar" aria-label="Pinned shortcuts" style={{ position: 'absolute', top: 4, left: 8, right: 8, display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', gap: 6, zIndex: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
                    {triggers.filter((t) => anchoredTriggerKeys.includes(triggerAnchorKey(t))).map((trigger) => {
                      const key = triggerAnchorKey(trigger)
                      return (
                        <span key={key} role="button" tabIndex={0} title={`Run: ${String(trigger.name || trigger.command || 'Trigger').slice(0, 80)}`}
                          onClick={() => { try { handleTriggerClick(trigger) } catch { /* noop */ } }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); try { handleTriggerClick(trigger) } catch { /* noop */ } } }}
                          style={{ fontSize: 18, lineHeight: 1, cursor: 'pointer', userSelect: 'none', flexShrink: 0, transition: 'transform 0.12s', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1.3)' }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1)' }}
                        >{spEmojiForKey(key)}</span>
                      )
                    })}
                    {diffWatchers.filter((w) => pinnedDiffIds.includes(w?.id ?? '')).map((watcher) => {
                      const runDiffNow = () => {
                        const watcherId = watcher.id as string
                        if (!watcherId) return
                        new Promise<string | null>((resolve) => {
                          try {
                            chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string | null } | undefined) => {
                              if (chrome.runtime.lastError) resolve(null); else resolve(resp?.secret?.trim() ? resp.secret : null)
                            })
                          } catch { resolve(null) }
                        }).then((secret) =>
                          fetch(`http://127.0.0.1:51248/api/wrchat/diff-watchers/${encodeURIComponent(watcherId)}/run`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' },
                            signal: AbortSignal.timeout(15000),
                          }).catch((err) => console.warn('[WRChat] diff runNow failed:', err))
                        ).catch(() => { /* noop */ })
                      }
                      return (
                      <span key={`diff:${watcher.id}`} role="button" tabIndex={0} title={`Diff: ${String(watcher.name || watcher.tag || 'Diff').slice(0, 80)} — click to run diff now`}
                        onClick={() => { runDiffNow() }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); runDiffNow() } }}
                        style={{ fontSize: 18, lineHeight: 1, cursor: 'pointer', userSelect: 'none', flexShrink: 0, transition: 'transform 0.12s', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1.3)' }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1)' }}
                      >{spEmojiForKey(`diff:${watcher.id ?? watcher.name ?? ''}`)}</span>
                      )})}
                  </div>
                )}
                {chatMessages.length === 0 ? (
                  <div style={{ fontSize: '13px', opacity: dockedPanelMode === 'augmented-overlay' ? 0.8 : 0.6, textAlign: 'center', padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    {dockedPanelMode === 'augmented-overlay' ? (
                      <>
                        <span style={{ fontSize: '24px' }}>🎯</span>
                        <span>Point with the cursor or select elements in order to ask questions or trigger automations directly in the UI.</span>
                      </>
                    ) : (
                      'Start a conversation...'
                    )}
                  </div>
                ) : (
                  chatMessages.map((msg: any, i) => (
                    <div 
                      key={i} 
                      style={{
                        display: 'flex',
                        justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
                      }}
                    >
                      <div style={{
                        maxWidth: msg.imageUrl ? '100%' : '85%',
                        width: msg.imageUrl ? '100%' : undefined,
                        padding: msg.imageUrl ? 0 : '10px 14px',
                        borderRadius: '12px',
                        fontSize: '13px',
                        lineHeight: '1.5',
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                        overflow: 'hidden',
                        background: msg.imageUrl ? 'transparent' : (msg.role === 'user' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.12)'),
                        border: msg.imageUrl ? 'none' : (msg.role === 'user' ? '1px solid rgba(34,197,94,0.5)' : '1px solid rgba(255,255,255,0.25)')
                      }}>
                        {msg.imageUrl && (
                          <img src={msg.imageUrl} alt="screenshot" style={{ width: '100%', maxWidth: '100%', borderRadius: 8, display: 'block' }} />
                        )}
                        {msg.text ? (
                          <div style={{ marginTop: msg.imageUrl ? 4 : 0, padding: msg.imageUrl ? '4px 8px' : 0, fontSize: msg.imageUrl ? '11px' : '13px', opacity: msg.imageUrl ? 0.75 : 1, whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                        ) : null}                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Resize Handle */}
              <div 
                onMouseDown={(e) => {
                  e.preventDefault()
                  setIsResizingChat(true)
                }}
                style={{
                  height: '4px',
                  background: theme === 'standard' ? '#e1e8ed' : 'rgba(255,255,255,0.15)',
                  cursor: 'ns-resize',
                  borderTop: theme === 'standard' ? '1px solid #d1d9e0' : '1px solid rgba(255,255,255,0.10)',
                  borderBottom: theme === 'standard' ? '1px solid #d1d9e0' : '1px solid rgba(255,255,255,0.10)'
                }}
              />

              {/* Pending document indicator */}
              {pendingDocContent && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '6px 14px',
                  background: 'rgba(168,85,247,0.1)',
                  borderTop: '1px solid rgba(168,85,247,0.2)',
                  fontSize: '11px', color: '#a855f7'
                }}>
                  <span>📄</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong>{pendingDocContent.name}</strong> attached — type your question and Send
                  </span>
                  <button
                    onClick={() => setPendingDocContent(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a855f7', fontSize: '14px', padding: 0, lineHeight: 1 }}
                    title="Remove attachment"
                  >✕</button>
                </div>
              )}

              {/* Compose Area */}
              <div 
                id="ccd-compose-sidepanel"
                style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '8px 10px'
              }}>
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleChatKeyDown}
                  placeholder={searchBarContext || 'Type your message...'}
                  style={{
                    flex: 1,
                    boxSizing: 'border-box',
                    height: '40px',
                    minHeight: '40px',
                    resize: 'vertical',
                    background: theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.08)',
                    border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.20)',
                    color: theme === 'standard' ? '#0f172a' : 'white',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    fontSize: '13px',
                    fontFamily: 'inherit',
                    lineHeight: '1.5'
                  }}
                />
              <input
                  ref={fileInputRef}
                  type="file" 
                  multiple 
                  style={{ display: 'none' }} 
                  onChange={handleFileChange}
                />
                <button 
                  onClick={handleBucketClick}
                  title="Attach" 
                  style={{
                    flexShrink: 0,
                    width: '28px',
                    height: '28px',
                    background: 'transparent',
                    border: 'none',
                    color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'color 0.15s ease'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = theme === 'standard' ? '#0f172a' : 'white')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </button>
                <button 
                  title="Voice" 
                  style={{
                    flexShrink: 0,
                    width: '28px',
                    height: '28px',
                    background: 'transparent',
                    border: 'none',
                    color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '15px',
                    transition: 'color 0.15s ease'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = theme === 'standard' ? '#0f172a' : 'white')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)')}
                >
                  🎙️
                </button>
                {renderSendButton()}
          </div>

            {/* Trigger Creation UI - Minimal View Section 1 */}
            {showTriggerPrompt && (
              <div style={{
                padding: '12px 14px',
                background: theme === 'standard' ? '#f8fafc' : 'rgba(0,0,0,0.35)',
                borderTop: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.20)'
              }}>
                <style>{`
                  .wr-capture-field::placeholder { color: rgba(150,150,150,0.7); }
                `}</style>
                <div style={{
                  marginBottom: '8px',
                  fontSize: '12px',
                  fontWeight: '700',
                  color: theme === 'standard' ? '#0f172a' : 'rgba(255,255,255,0.70)',
                  opacity: 1
                }}>
                  {showTriggerPrompt.mode === 'screenshot' ? '📸 Screenshot' : '🎥 Stream'}
                </div>
                {showTriggerPrompt.createTrigger && (
                  <>
                    <label
                      htmlFor="wr-capture-trigger-name-docked"
                      style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: 4, color: theme === 'standard' ? '#475569' : 'rgba(255,255,255,0.70)' }}
                    >
                      Trigger Name
                    </label>
                    <input
                      id="wr-capture-trigger-name-docked"
                      type="text"
                      className="wr-capture-field"
                      placeholder="Trigger Name"
                      value={showTriggerPrompt.name || ''}
                      onChange={(e) => setShowTriggerPrompt({ ...showTriggerPrompt, name: e.target.value })}
                      onFocus={(e) => {
                        e.currentTarget.style.border = theme === 'standard' ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.80)'
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.border = theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.45)'
                      }}
                      style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      background: theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.12)',
                      border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.45)',
                      color: theme === 'standard' ? '#0f172a' : '#f8fafc',
                      borderRadius: '6px',
                      fontSize: '12px',
                      marginBottom: '8px'
                    }}
                    />
                  </>
                )}
                {showTriggerPrompt.addCommand && (
                  <>
                    <label
                      htmlFor="wr-capture-optional-command-docked"
                      style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: 4, color: theme === 'standard' ? '#475569' : 'rgba(255,255,255,0.70)' }}
                    >
                      Optional Command
                    </label>
                    <textarea
                      id="wr-capture-optional-command-docked"
                      className="wr-capture-field"
                      placeholder="Optional Command"
                      value={showTriggerPrompt.command || ''}
                      onChange={(e) => setShowTriggerPrompt({ ...showTriggerPrompt, command: e.target.value })}
                      onFocus={(e) => {
                        e.currentTarget.style.border = theme === 'standard' ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.80)'
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.border = theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.45)'
                      }}
                      style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      background: theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.12)',
                      border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.45)',
                      color: theme === 'standard' ? '#0f172a' : '#f8fafc',
                      borderRadius: '6px',
                      fontSize: '12px',
                      minHeight: '60px',
                      marginBottom: '8px',
                      resize: 'vertical',
                      fontFamily: 'inherit'
                    }}
                    />
                  </>
                )}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShowTriggerPrompt(null)}
                    style={{
                      padding: '6px 12px',
                      background: theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.15)',
                      border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.25)',
                      color: theme === 'standard' ? '#0f172a' : 'white',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      const snap = showTriggerPrompt
                      if (!snap) return
                      const name = snap.name?.trim() || ''
                      const command = snap.command?.trim() || ''

                      if (snap.createTrigger) {
                        if (!name) {
                          alert('Please enter a trigger name')
                          return
                        }

                        const triggerData = {
                          name,
                          command,
                          at: Date.now(),
                          rect: snap.rect,
                          bounds: snap.bounds,
                          mode: snap.mode,
                          ...(typeof snap.displayId === 'number' && snap.displayId > 0 ? { displayId: snap.displayId } : {}),
                        }

                        chrome.storage.local.get(['optimando-tagged-triggers'], (result) => {
                          const triggers = result['optimando-tagged-triggers'] || []
                          triggers.push(triggerData)
                          chrome.storage.local.set({ 'optimando-tagged-triggers': triggers }, () => {
                            setTriggers(triggers)
                            try { chrome.runtime?.sendMessage({ type: 'TRIGGERS_UPDATED' }) } catch {}
                            try { window.dispatchEvent(new CustomEvent('optimando-triggers-updated')) } catch {}
                          })
                        })

                        try {
                          chrome.runtime?.sendMessage({
                            type: 'ELECTRON_SAVE_TRIGGER',
                            name,
                            mode: snap.mode,
                            rect: snap.rect,
                            displayId: typeof snap.displayId === 'number' && snap.displayId > 0 ? snap.displayId : undefined,
                            imageUrl: snap.imageUrl,
                            videoUrl: snap.videoUrl,
                            command: command || undefined,
                          })
                        } catch (err) {
                          console.error('Error sending trigger to Electron:', err)
                        }
                      }

                      const triggerNameToUse = name || command
                      const shouldAutoProcess = snap.addCommand || (snap.createTrigger && triggerNameToUse)
                      const nameT = name.trim()
                      const commandT = command.trim()
                      const tagFromName = normaliseTriggerTag(nameT)
                      const triggerTagFallback = normaliseTriggerTag(triggerNameToUse.trim())
                      const displayForChat = commandT || (nameT ? nameT : '') || triggerTagFallback
                      const routeForLlm = commandT || tagFromName || triggerTagFallback

                      if (shouldAutoProcess && triggerNameToUse && snap.imageUrl) {
                        setShowTriggerPrompt(null)
                        setCreateTriggerChecked(true)
                        setAddCommandChecked(true)
                        handleSendMessageWithTrigger(displayForChat, snap.imageUrl, routeForLlm)
                      } else {
                        if (snap.imageUrl) {
                          const caption = commandT || (nameT ? nameT : '') || tagFromName || '[Screenshot]'
                          const imageMessage = {
                            role: 'user' as const,
                            text: caption,
                            imageUrl: snap.imageUrl,
                          }
                          setChatMessages((prev) => [...prev, imageMessage])
                          setTimeout(() => {
                            if (chatRef.current) {
                              chatRef.current.scrollTop = chatRef.current.scrollHeight
                            }
                          }, 100)
                        }
                        setShowTriggerPrompt(null)
                        setCreateTriggerChecked(true)
                        setAddCommandChecked(true)
                      }
                    }}
                    style={{
                      padding: '6px 12px',
                      background: '#22c55e',
                      border: '1px solid #16a34a',
                      color: '#0b1e12',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '700'
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
              </>
              )}

              {dockedWorkspace === 'beap-messages' && (
                /* BEAP Messages Workspace - Section 1 (showMinimalUI) */
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: theme === 'pro' ? 'rgba(118,75,162,0.15)' : (theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.04)'), overflowY: 'auto' }}>
                  <style>{`
                    .beap-input::placeholder, .beap-textarea::placeholder {
                      color: ${theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.5)'};
                      opacity: 1;
                    }
                  `}</style>
                  
                  {/* ========================================== */}
                  {/* INBOX VIEW */}
                  {/* ========================================== */}
                  {beapSubmode === 'inbox' && (
                    <InboxErrorBoundary componentName="BeapInboxView" theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}>
                    <BeapInboxView
                      ref={inboxViewRef}
                      theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                      onNavigateToDraft={() => setBeapSubmode('draft')}
                      onNavigateToWRGuard={() => setDockedWorkspace('wrguard')}
                      onNavigateToHandshake={(handshakeId) => {
                        setDockedWorkspace('wrguard')
                        useWRGuardStore.getState().setActiveSection('handshakes')
                        useWRGuardStore.getState().setSelectedHandshakeId(handshakeId)
                      }}
                      onNavigateToHandshakesTab={() => {
                        setDockedWorkspace('wrguard')
                        useWRGuardStore.getState().setActiveSection('handshakes')
                      }}
                      onSetSearchContext={setSearchBarContext}
                      onAttachmentSelect={(_mid, attachmentId) => {
                        beapInboxSelectedAttachmentIdRef.current = attachmentId
                      }}
                      onAiQuery={(query, messageId, attachmentId) => {
                        if (attachmentId != null) beapInboxSelectedAttachmentIdRef.current = attachmentId
                        pendingInboxAiRef.current = {
                          messageId,
                          query,
                          ...(attachmentId != null ? { attachmentId } : {}),
                        }
                        inboxViewRef.current?.startGenerating()
                        setChatInput(query)
                        handleSendMessage()
                      }}
                      replyComposerConfig={replyComposerConfig}
                    />
                    </InboxErrorBoundary>
                  )}
                  
                  {/* ========================================== */}
                  {/* OUTBOX VIEW */}
                  {/* ========================================== */}
                  {beapSubmode === 'outbox' && (
                    <BeapMessageListView
                      folder="outbox"
                      theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                      onNavigateToDraft={() => setBeapSubmode('draft')}
                    />
                  )}
                  
                  {/* ========================================== */}
                  {/* ARCHIVED VIEW */}
                  {/* ========================================== */}
                  {beapSubmode === 'archived' && (
                    <BeapMessageListView
                      folder="archived"
                      theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                      onNavigateToDraft={() => setBeapSubmode('draft')}
                    />
                  )}
                  
                  {/* ========================================== */}
                  {/* REJECTED VIEW */}
                  {/* ========================================== */}
                  {beapSubmode === 'rejected' && (
                    <BeapMessageListView
                      folder="rejected"
                      theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                      onNavigateToDraft={() => setBeapSubmode('draft')}
                    />
                  )}
                  
                  {/* ========================================== */}
                  {/* BULK INBOX VIEW */}
                  {/* ========================================== */}
                  {beapSubmode === 'bulk-inbox' && (
                    <InboxErrorBoundary componentName="BeapBulkInbox" theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}>
                      <BeapBulkInbox
                        ref={bulkInboxRef}
                        theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                        onSetSearchContext={setSearchBarContext}
                        onAiQuery={(query, messageId) => {
                          pendingInboxAiRef.current = { messageId, query, isBulk: true }
                          bulkInboxRef.current?.startGenerating(messageId)
                          setChatInput(query)
                          handleSendMessage()
                        }}
                        onViewHandshake={(handshakeId) => {
                          setDockedWorkspace('wrguard')
                          useWRGuardStore.getState().setActiveSection('handshakes')
                          useWRGuardStore.getState().setSelectedHandshakeId(handshakeId)
                        }}
                        onViewInInbox={(messageId) => {
                          setBeapSubmode('inbox')
                          useBeapInboxStore.getState().selectMessage(messageId)
                        }}
                        replyComposerConfig={replyComposerConfig}
                        onClassificationComplete={(count) => showNotification(`Analysis complete — ${count} message${count === 1 ? '' : 's'} classified`)}
                        onArchiveComplete={(count) => showNotification(`Archived ${count} message${count === 1 ? '' : 's'}`)}
                      />
                    </InboxErrorBoundary>
                  )}
                  
                  {/* ========================================== */}
                  {/* DRAFT VIEW - Main UI */}
                  {/* ========================================== */}
                  {beapSubmode === 'draft' && (
                    <>
                  {/* DELIVERY METHOD - FIRST */}
                  <div style={{ padding: '14px 18px', borderBottom: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.1)' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Delivery Method
                    </label>
                    <select
                      value={handshakeDelivery}
                      onChange={(e) => setHandshakeDelivery(e.target.value as 'email' | 'download' | 'p2p')}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        background: theme === 'standard' ? 'white' : '#1f2937',
                        border: `1px solid ${theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.15)'}`,
                        borderRadius: '8px',
                        color: theme === 'standard' ? '#1f2937' : 'white',
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="email" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>📧 Email</option>
                      <option value="p2p" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>🔗 P2P</option>
                      <option value="download" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>💾 Download (USB/Wallet)</option>
                    </select>
                  </div>
                  
                  {/* EMAIL ACCOUNTS SECTION - Only visible when email delivery selected */}
                  {handshakeDelivery === 'email' && (
                  <div style={{ 
                    padding: '16px 18px', 
                    borderBottom: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.1)',
                    background: theme === 'standard' ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.1)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '16px' }}>🔗</span>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Connected Email Accounts</span>
                      </div>
                      <button
                        onClick={() => openConnectEmail(ConnectEmailLaunchSource.WrChatDocked)}
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

                    {emailAccountsFetchErrorEl}
                    
                    {isLoadingEmailAccounts ? (
                      <div style={{ padding: '12px', textAlign: 'center', opacity: 0.6, fontSize: '12px' }}>
                        Loading accounts...
                      </div>
                    ) : emailAccounts.length === 0 ? (
                      <div style={{ 
                        padding: '20px', 
                        background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.05)',
                        borderRadius: '8px',
                        border: theme === 'standard' ? '1px dashed #94a3b8' : '1px dashed rgba(255,255,255,0.2)',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
                        <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>
                          {emailAccountsLoadError?.trim()
                            ? 'No accounts loaded (see message above).'
                            : 'No email accounts connected'}
                        </div>
                        <div style={{ fontSize: '11px', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.5)' }}>
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
                              background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)',
                              borderRadius: '8px',
                              border: account.status === 'active' 
                                ? (theme === 'standard' ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(34,197,94,0.4)')
                                : (theme === 'standard' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(239,68,68,0.4)')
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ fontSize: '18px' }}>
                                {account.provider === 'gmail' ? '📧' : account.provider === 'microsoft365' ? '📨' : account.provider === 'zoho' ? '📬' : '✉️'}
                              </span>
                              <div>
                                <div style={{ fontSize: '13px', fontWeight: '500', color: theme === 'standard' ? '#0f172a' : 'white' }}>
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
                                  <span style={{ color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>
                                    {account.status === 'active' ? 'Connected' : account.lastError || 'Error'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => disconnectEmailAccount(account.id)}
                              title="Disconnect account"
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.5)',
                                cursor: 'pointer',
                                padding: '4px',
                                fontSize: '14px'
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Select account for sending */}
                    {emailAccounts.length > 0 && (
                      <div style={{ marginTop: '12px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Send From:
                        </label>
                        <select
                          value={selectedEmailAccountId || defaultEmailAccountRowId || ''}
                          onChange={(e) => setSelectedEmailAccountId(e.target.value)}
                          style={{
                            width: '100%',
                            background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.1)',
                            border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.2)',
                            color: theme === 'standard' ? '#0f172a' : 'white',
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
                  
                  {/* ========================================== */}
                  {/* BEAP™ MESSAGE SECTION - Adapted from Handshake Request */}
                  {/* ========================================== */}
                  
                  {/* Header */}
                  <div style={{ padding: '12px 14px', borderBottom: `1px solid ${theme === 'standard' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '18px' }}>📦</span>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#1f2937' : 'white' }}>BEAP™ Message (required)</span>
                  </div>
                  
                  <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Your Fingerprint - PROMINENT */}
                    <div style={{
                      background: theme === 'standard' ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.15)',
                      border: theme === 'standard' ? '1px solid rgba(59,130,246,0.2)' : '1px solid rgba(59,130,246,0.3)',
                      borderRadius: '8px',
                      padding: '12px',
                    }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: theme === 'standard' ? '#3b82f6' : '#93c5fd', marginBottom: '6px' }}>
                        Your Fingerprint
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <code style={{ 
                          flex: 1,
                          fontSize: '13px', 
                          fontFamily: 'monospace',
                          color: theme === 'standard' ? '#1e40af' : '#bfdbfe',
                          wordBreak: 'break-all'
                        }}>
                          {ourFingerprintShort}
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(ourFingerprint)
                            setFingerprintCopied(true)
                            setTimeout(() => setFingerprintCopied(false), 2000)
                          }}
                          style={{
                            background: fingerprintCopied ? (theme === 'standard' ? '#22c55e' : '#22c55e') : (theme === 'standard' ? '#3b82f6' : 'rgba(59,130,246,0.5)'),
                            border: 'none',
                            color: 'white',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            fontSize: '10px',
                            cursor: 'pointer',
                            fontWeight: 600
                          }}
                        >
                          {fingerprintCopied ? '✓ Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>
                    
                    {/* Recipient Mode Switch (PRIVATE/PUBLIC) */}
                    <RecipientModeSwitch
                      mode={beapRecipientMode}
                      onModeChange={setBeapRecipientMode}
                      theme={theme}
                    />
                    
                    {/* Handshake Recipient Select (only in PRIVATE mode) */}
                    {beapRecipientMode === 'private' && (
                      <RecipientHandshakeSelect
                        handshakes={handshakes}
                        selectedHandshakeId={selectedRecipient?.handshake_id || null}
                        onSelect={setSelectedRecipient}
                        theme={theme}
                        isLoading={handshakesLoading}
                        fetchError={handshakesError}
                        onRetry={refreshHandshakes}
                      />
                    )}
                    
                    {/* Delivery Method Panel - Adapts to recipient mode */}
                    <DeliveryMethodPanel
                      deliveryMethod={handshakeDelivery}
                      recipientMode={beapRecipientMode}
                      selectedRecipient={selectedRecipient}
                      emailTo={beapDraftTo}
                      onEmailToChange={setBeapDraftTo}
                      theme={theme}
                      ourFingerprintShort={ourFingerprintShort}
                    />
                    
                    {/* Message Content */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        BEAP™ Message (required)
                      </label>
                      <textarea
                        className="beap-textarea"
                        value={beapDraftMessage}
                        onChange={(e) => setBeapDraftMessage(e.target.value)}
                        placeholder="Public capsule text — required before send. This is the transport-visible message body."
                        style={{
                          flex: 1,
                          minHeight: '120px',
                          background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)',
                          border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.15)',
                          color: theme === 'standard' ? '#0f172a' : 'white',
                          borderRadius: '6px',
                          padding: '10px 12px',
                          fontSize: '12px',
                          lineHeight: '1.5',
                          resize: 'none',
                          outline: 'none',
                          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                        }}
                      />
                    </div>
                    
                    {/* Encrypted Message (qBEAP/PRIVATE only) */}
                    {beapRecipientMode === 'private' && (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#7c3aed' : '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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
                            background: theme === 'standard' ? 'rgba(139,92,246,0.05)' : 'rgba(139,92,246,0.15)',
                            border: theme === 'standard' ? '1px solid rgba(139,92,246,0.3)' : '1px solid rgba(139,92,246,0.4)',
                            color: theme === 'standard' ? '#0f172a' : 'white',
                            borderRadius: '6px',
                            padding: '10px 12px',
                            fontSize: '12px',
                            lineHeight: '1.5',
                            resize: 'none',
                            outline: 'none',
                            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                          }}
                        />
                        <div style={{ fontSize: '10px', color: theme === 'standard' ? '#7c3aed' : '#c4b5fd', marginTop: '4px' }}>
                          ⚠️ This content is authoritative when present and never leaves the encrypted capsule.
                        </div>
                      </div>
                    )}
                    
                    {/* Advanced: Session + Attachments */}
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.1)' }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '8px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Advanced (Optional)
                      </div>
                      {/* Session Selector */}
                      <div style={{ marginBottom: '10px' }}>
                        <label style={{ fontSize: '10px', fontWeight: 500, marginBottom: '4px', display: 'block', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>
                          Session (optional)
                        </label>
                        <select
                          value={beapDraftSessionId}
                          onChange={(e) => setBeapDraftSessionId(e.target.value)}
                          onClick={() => loadAvailableSessions()}
                          style={{
                            width: '100%',
                            background: theme === 'standard' ? '#ffffff' : '#1e293b',
                            border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.25)',
                            color: theme === 'standard' ? '#0f172a' : '#f1f5f9',
                            borderRadius: '6px',
                            padding: '8px 10px',
                            fontSize: '12px',
                            outline: 'none',
                            boxSizing: 'border-box',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="" style={{ background: theme === 'standard' ? '#ffffff' : '#1e293b', color: theme === 'standard' ? '#0f172a' : '#f1f5f9' }}>{availableSessions.length === 0 ? '— No sessions available —' : '— Select a session —'}</option>
                          {availableSessions.map((s) => (
                            <option key={s.key} value={s.key} style={{ background: theme === 'standard' ? '#ffffff' : '#1e293b', color: theme === 'standard' ? '#0f172a' : '#f1f5f9' }}>{s.name} ({new Date(s.timestamp).toLocaleDateString()})</option>
                          ))}
                        </select>
                      </div>
                      {/* Attachments Input */}
                      <div>
                        <label style={{ fontSize: '10px', fontWeight: 500, marginBottom: '4px', display: 'block', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>
                          Attachments (PDFs: text extracts automatically)
                        </label>
                        <input
                          type="file"
                          multiple
                          onChange={async (e) => {
                            const files = Array.from(e.target.files ?? [])
                            if (!files.length) return
                            const tooBig = files.filter((f) => f.size > MAX_BEAP_DRAFT_ATTACHMENT_BYTES)
                            if (tooBig.length) {
                              setNotification(
                                beapUiValidationFailure(
                                  formatOversizeAttachmentRejection(tooBig.map((f) => f.name)),
                                ),
                              )
                              setTimeout(() => setNotification(null), 10000)
                            }
                            const okFiles = files.filter((f) => f.size <= MAX_BEAP_DRAFT_ATTACHMENT_BYTES)
                            const newItems: DraftAttachment[] = []
                            for (const file of okFiles) {
                              if (beapDraftAttachments.length + newItems.length >= 20) { console.warn('[BEAP] Max 20 attachments reached'); break }
                              const dataBase64 = await new Promise<string>((resolve, reject) => {
                                const reader = new FileReader()
                                reader.onload = () => { const res = String(reader.result ?? ''); resolve(res.includes(',') ? res.split(',')[1] : res) }
                                reader.onerror = () => reject(reader.error)
                                reader.readAsDataURL(file)
                              })
                              const attachmentId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
                              const mimeType = file.type || 'application/octet-stream'
                              const isPdfFile = mimeType.toLowerCase() === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
                              const capsuleAttachment: CapsuleAttachment = {
                                id: attachmentId,
                                originalName: file.name,
                                originalSize: file.size,
                                originalType: mimeType,
                                semanticContent: null,
                                semanticExtracted: false,
                                encryptedRef: `encrypted_${attachmentId}`,
                                encryptedHash: '',
                                previewRef: null,
                                rasterProof: null,
                                isMedia: mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/'),
                                hasTranscript: false
                              }
                              newItems.push({
                                id: attachmentId,
                                name: file.name,
                                mime: mimeType,
                                size: file.size,
                                dataBase64,
                                capsuleAttachment,
                                processing: { parsing: isPdfFile, rasterizing: false }
                              })
                            }
                            setBeapDraftAttachments((prev) => [...prev, ...newItems])
                            for (const item of newItems) {
                              const isPdfItem = item.mime?.toLowerCase() === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf')
                              if (!isPdfItem || !item.dataBase64) continue
                              void runDraftAttachmentParseWithFallback({
                                id: item.id,
                                dataBase64: item.dataBase64,
                                capsuleAttachment: item.capsuleAttachment,
                              })
                                .then((upd) => {
                                  setBeapDraftAttachments((prev) =>
                                    prev.map((x) =>
                                      x.id === item.id
                                        ? { ...x, capsuleAttachment: upd.capsuleAttachment, processing: upd.processing }
                                        : x,
                                    ),
                                  )
                                })
                                .catch((err) => {
                                  const u = draftAttachmentParseRejectedUpdate(
                                    {
                                      id: item.id,
                                      dataBase64: item.dataBase64,
                                      capsuleAttachment: item.capsuleAttachment,
                                    },
                                    err,
                                  )
                                  setBeapDraftAttachments((prev) =>
                                    prev.map((x) =>
                                      x.id === item.id
                                        ? { ...x, capsuleAttachment: u.capsuleAttachment, processing: u.processing }
                                        : x,
                                    ),
                                  )
                                })
                            }
                            e.currentTarget.value = ''
                          }}
                          style={{ fontSize: '11px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)' }}
                        />
                        {beapDraftAttachments.length > 0 && (
                          <div style={{ marginTop: '8px' }}>
                            {beapDraftAttachments.map((a) => {
                              const isPdf = a.mime?.toLowerCase() === 'application/pdf' || a.name.toLowerCase().endsWith('.pdf')
                              const isParsing = !!a.processing?.parsing
                              const isSuccess = !!a.capsuleAttachment?.semanticExtracted
                              const showPdfBadge = isPdf && (isParsing || isSuccess || !!a.processing?.error)
                              const parseStatus: 'pending' | 'success' | 'failed' = isParsing
                                ? 'pending'
                                : isSuccess
                                  ? 'success'
                                  : 'failed'
                              return (
                              <div key={a.id} style={{ background: theme === 'standard' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)', borderRadius: '4px', marginBottom: '4px', overflow: 'hidden' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                                    <span style={{ fontSize: '14px' }}>📄</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: '11px', color: theme === 'standard' ? '#0f172a' : 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {a.name}
                                      </div>
                                      <div style={{ fontSize: '9px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.5)' }}>
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
                                          border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.2)',
                                          color: theme === 'standard' ? '#475569' : 'rgba(255,255,255,0.75)',
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
                                          })
                                            .then((upd) => {
                                              setBeapDraftAttachments((prev) =>
                                                prev.map((x) =>
                                                  x.id === a.id
                                                    ? { ...x, capsuleAttachment: upd.capsuleAttachment, processing: upd.processing }
                                                    : x,
                                                ),
                                              )
                                            })
                                            .catch((err) => {
                                              const u = draftAttachmentParseRejectedUpdate(
                                                {
                                                  id: a.id,
                                                  dataBase64: a.dataBase64!,
                                                  capsuleAttachment: a.capsuleAttachment,
                                                },
                                                err,
                                              )
                                              setBeapDraftAttachments((prev) =>
                                                prev.map((x) =>
                                                  x.id === a.id
                                                    ? { ...x, capsuleAttachment: u.capsuleAttachment, processing: u.processing }
                                                    : x,
                                                ),
                                              )
                                            })
                                        }}
                                        style={{
                                          background: theme === 'standard' ? 'rgba(139,92,246,0.12)' : 'rgba(139,92,246,0.25)',
                                          border: `1px solid ${theme === 'standard' ? 'rgba(139,92,246,0.35)' : 'rgba(192,132,252,0.4)'}`,
                                          color: theme === 'standard' ? '#6d28d9' : '#e9d5ff',
                                          borderRadius: '4px',
                                          padding: '2px 8px',
                                          fontSize: '10px',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        Retry
                                      </button>
                                    )}
                                    <button onClick={() => { setBeapDraftReaderModalId((id) => (id === a.id ? null : id)); setBeapDraftAttachments((prev) => prev.filter((x) => x.id !== a.id)) }} style={{ background: 'transparent', border: 'none', color: theme === 'standard' ? '#ef4444' : '#f87171', fontSize: '10px', cursor: 'pointer' }}>Remove</button>
                                    {showPdfBadge && <AttachmentStatusBadge status={parseStatus} theme={theme === 'standard' ? 'standard' : 'dark'} />}
                                  </div>
                                </div>
                                {a.processing?.error && !isParsing && (
                                  <div style={{ padding: '6px 8px', borderTop: `1px solid ${theme === 'standard' ? 'rgba(251,191,36,0.2)' : 'rgba(251,191,36,0.25)'}`, background: theme === 'standard' ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.12)', fontSize: '10px', color: theme === 'standard' ? '#b45309' : '#fbbf24' }}>
                                    {a.processing.error.includes('connect') || a.processing.error.includes('Failed to connect')
                                      ? 'Desktop parser (port 51248) can improve extraction. Add an API key in settings for AI extraction.'
                                      : a.processing.error}
                                  </div>
                                )}
                              </div>
                            )})}
                            <button onClick={() => { setBeapDraftReaderModalId(null); setBeapDraftAttachments([]) }} style={{ background: 'transparent', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer', marginTop: '4px' }}>Clear all</button>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Info */}
                    <div style={{
                      fontSize: '11px',
                      padding: '10px',
                      background: theme === 'standard' ? 'rgba(168,85,247,0.08)' : 'rgba(168,85,247,0.15)',
                      borderRadius: '6px',
                      color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.8)',
                      marginTop: '12px'
                    }}>
                      💡 This creates a secure BEAP™ package with your fingerprint. Your identity will be verifiable by the recipient.
                    </div>
                  </div>
                  
                  {/* Action Buttons */}
                  <div style={{
                    padding: '12px 14px',
                    borderTop: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.1)',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '8px',
                    background: theme === 'standard' ? '#ffffff' : 'rgba(0,0,0,0.2)'
                  }}>
                    <button 
                      onClick={() => {
                        setHandshakeTo('')
                        setHandshakeMessage('')
                      }}
                      style={{
                        background: 'transparent',
                        border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.2)',
                        color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)',
                        borderRadius: '6px',
                        padding: '8px 16px',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      Clear
                    </button>
                    <button 
                      onClick={() => {
                        if (handshakeDelivery === 'email' && !handshakeTo) {
                          setNotification({ message: 'Please enter a recipient email address', type: 'error' })
                          setTimeout(() => setNotification(null), 3000)
                          return
                        }
                        // Handle send based on delivery method
                        const selectedAccount =
                          emailAccounts.find(a => a.id === selectedEmailAccountId) ||
                          (defaultEmailAccountRowId
                            ? emailAccounts.find(a => a.id === defaultEmailAccountRowId)
                            : undefined) ||
                          emailAccounts[0]
                        setNotification({
                          message:
                            handshakeDelivery === 'download'
                              ? 'BEAP capsule downloaded'
                              : handshakeDelivery === 'p2p'
                                ? 'Use BEAP Drafts for P2P — relay acceptance is not recipient delivery.'
                                : 'BEAP™ Message sent!',
                          type: handshakeDelivery === 'download' || handshakeDelivery === 'email' ? 'success' : 'info',
                        })
                        setTimeout(() => setNotification(null), 3000)
                        setHandshakeTo('')
                        setHandshakeMessage('')
                      }}
                      style={{
                        background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
                        border: 'none',
                        color: 'white',
                        borderRadius: '6px',
                        padding: '8px 20px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      {handshakeDelivery === 'email' ? '📧 Send' : handshakeDelivery === 'p2p' ? '🔗 Send' : '💾 Download'}
                    </button>
                  </div>
                    </>
                  )}
                </div>
              )}
      </div>

          {/* Embed Dialog */}
          {showEmbedDialog && (
            <div style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              zIndex: 2147483651,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(4px)'
            }}>
              <div style={{
                width: '420px',
                background: 'linear-gradient(135deg,#c084fc 0%,#a855f7 50%,#9333ea 100%)',
                color: 'white',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.25)',
                boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
                overflow: 'hidden'
              }}>
                <div style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid rgba(255,255,255,0.25)',
                  fontWeight: 700
                }}>
                  Where to embed?
                </div>
                <div style={{ padding: '14px 16px', fontSize: '12px' }}>
                  <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
            <input
                      type="radio" 
                      checked={embedTarget === 'session'}
                      onChange={() => setEmbedTarget('session')}
                    />
                    <span>Session Memory (this session only)</span>
          </label>
                  <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
            <input
                      type="radio" 
                      checked={embedTarget === 'account'}
                      onChange={() => setEmbedTarget('account')}
                    />
                    <span>Account Memory (account-wide, long term)</span>
          </label>
                  <div style={{ marginTop: '10px', opacity: 0.9 }}>
                    Content will be processed (OCR/ASR/Parsing), chunked, and embedded locally.
                  </div>
                </div>
                <div style={{
                  padding: '12px 16px',
                  background: 'rgba(255,255,255,0.08)',
                  display: 'flex',
                  gap: '8px',
                  justifyContent: 'flex-end'
                }}>
                  <button 
                    onClick={() => setShowEmbedDialog(false)}
                    style={{
                      padding: '6px 10px',
                      border: 0,
                      borderRadius: '6px',
                      background: 'rgba(255,255,255,0.18)',
                      color: 'white',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleEmbedConfirm}
                    style={{
                      padding: '6px 10px',
                      border: 0,
                      borderRadius: '6px',
                      background: '#22c55e',
                      color: '#0b1e12',
                      cursor: 'pointer'
                    }}
                  >
                    Embed
                  </button>
                </div>
        </div>
      </div>
          )}
        </>
        )}

            {dockedWorkspace === 'wrguard' && (
              /* WRGuard Workspace - Section 1 (showMinimalUI) */
              <WRGuardWorkspace 
                theme={theme}
                emailAccounts={emailAccounts}
                isLoadingEmailAccounts={isLoadingEmailAccounts}
                selectedEmailAccountId={selectedEmailAccountId}
                onConnectEmail={() => openConnectEmail(ConnectEmailLaunchSource.WrChatDocked)}
                onDisconnectEmail={disconnectEmailAccount}
                onSetProcessingPaused={setAccountProcessingPaused}
                onSelectEmailAccount={setSelectedEmailAccountId}
                onViewInInbox={(messageId) => {
                  setDockedWorkspace('beap-messages')
                  setBeapSubmode('inbox')
                  useBeapInboxStore.getState().selectMessage(messageId)
                }}
                replyComposerConfig={replyComposerConfig}
              />
            )}
        
        {/* Add Mini App Button */}
        <div style={{
          flex: 1,
          padding: '40px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <button
            onClick={addMiniApp}
            style={{
              width: '100%',
              maxWidth: '300px',
              padding: '20px 24px',
              ...(theme === 'standard' ? {
                background: 'rgba(15,23,42,0.08)',
                border: '2px dashed rgba(15,23,42,0.3)',
                color: '#0f172a'
              } : theme === 'dark' ? {
                background: 'rgba(255,255,255,0.1)',
                border: '2px dashed rgba(255,255,255,0.3)',
                color: '#f1f5f9'
              } : {
                background: 'rgba(118,75,162,0.3)',
                border: '2px dashed rgba(255,255,255,0.5)',
                color: 'white'
              }),
              borderRadius: '12px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '700',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              transition: 'all 0.2s ease',
              boxShadow: 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              if (theme === 'standard') {
                e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                e.currentTarget.style.borderColor = 'rgba(15,23,42,0.4)'
              } else if (theme === 'dark') {
                e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)'
              } else {
                e.currentTarget.style.background = 'rgba(118,75,162,0.55)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.7)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              if (theme === 'standard') {
                e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                e.currentTarget.style.borderColor = 'rgba(15,23,42,0.3)'
              } else if (theme === 'dark') {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'
              } else {
                e.currentTarget.style.background = 'rgba(118,75,162,0.3)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)'
              }
            }}
          >
            ➕ Add Mini App
          </button>
        </div>
        
        {/* Notification Toast */}
        {notification && (
          <div style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            left: '20px',
            background: notification.type === 'success' ? 'rgba(76, 175, 80, 0.95)' : 
                        notification.type === 'error' ? 'rgba(244, 67, 54, 0.95)' : 
                        'rgba(33, 150, 243, 0.95)',
            color: 'white',
            padding: '12px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: '600',
            zIndex: 10000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            animation: 'slideInDown 0.3s ease',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px'
          }}>
            <span style={{ flexShrink: 0, lineHeight: 1.4 }}>
              {notification.type === 'success' ? '✓' : notification.type === 'info' ? 'ℹ' : '✕'}
            </span>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-line', lineHeight: 1.45 }}>{notification.message}</span>
          </div>
        )}
      </div>
    )
  }

  const currentViewMode: 'app' | 'admin' = viewMode

  // Mini App View (simplified)
  if (viewMode === 'app') {
    return (
      <div style={{
        width: '100%',
        minHeight: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        background: themeColors.background,
        color: themeColors.text,
        padding: '0',
        margin: '0',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'hidden'
      }}>
        {/* Electron Not Running Dialog */}
        <ElectronNotRunningDialog />
        <AddModeWizardHost theme={theme} />

        {/* Top Bar: Icons + Toggle */}
        <div style={{ 
          padding: '8px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          background: theme === 'pro' ? 'rgba(118,75,162,0.6)' : 'rgba(0,0,0,0.15)'
        }}>
          <button
            onClick={openPopupChat}
            style={{
              ...actionButtonStyle('rgba(255,255,255,0.1)'),
              fontSize: '14px',
              padding: 0
            }}
            title="Open Popup Chat"
          >
            💬
          </button>
          <button
            onClick={toggleCommandChatPin}
            style={{
              ...actionButtonStyle(isCommandChatPinned ? 'rgba(76,175,80,0.4)' : 'rgba(255,255,255,0.1)'),
              fontSize: '14px',
              padding: 0,
              ...(isCommandChatPinned && theme === 'pro' ? {
                background: 'rgba(76,175,80,0.4)',
                border: '1px solid rgba(76,175,80,0.6)'
              } : {})
            }}
            title={isCommandChatPinned ? "Unpin Command Chat" : "Pin Command Chat"}
          >
            📌
          </button>
          <div
            onClick={toggleViewMode}
            style={{
              cursor: 'pointer',
              marginLeft: 'auto'
            }}
            title={`Switch to Admin view`}
          >
            <div style={{
              position: 'relative',
              width: '50px',
              height: '20px',
              background: viewMode === 'app'
                ? (theme === 'pro' ? 'rgba(76,175,80,0.9)' : theme === 'dark' ? 'rgba(76,175,80,0.9)' : 'rgba(34,197,94,0.9)')
                : (theme === 'pro' ? 'rgba(255,255,255,0.2)' : theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.2)'),
              borderRadius: '10px',
              transition: 'background 0.2s',
              border: theme === 'pro' ? '1px solid rgba(255,255,255,0.3)' : theme === 'dark' ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(15,23,42,0.3)',
              overflow: 'hidden'
            }}>
              <span style={{
                position: 'absolute',
                left: viewMode === 'app' ? '8px' : 'auto',
                right: viewMode === 'app' ? 'auto' : '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '9px',
                fontWeight: '700',
                color: viewMode === 'app'
                  ? 'rgba(255,255,255,0.95)'
                  : (theme === 'pro' ? 'rgba(255,255,255,0.5)' : theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(15,23,42,0.5)'),
                transition: 'all 0.2s',
                userSelect: 'none',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                zIndex: 1,
                whiteSpace: 'nowrap',
                lineHeight: '1'
              }}>App</span>
              <div style={{
                position: 'absolute',
                top: '3px',
                left: viewMode === 'app' ? '32px' : '3px',
                width: '14px',
                height: '14px',
                background: theme === 'pro' ? 'rgba(255,255,255,0.95)' : theme === 'dark' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.95)',
                borderRadius: '50%',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                zIndex: 2
              }} />
            </div>
          </div>
        </div>
        
      {/* Docked Command Chat - App View */}
      {isCommandChatPinned && (
        <>
          <div 
            style={{
              borderBottom: '1px solid rgba(255,255,255,0.2)',
              background: theme === 'pro' ? 'rgba(118,75,162,0.4)' : 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.20)',
              margin: '12px 16px',
              borderRadius: '8px',
              overflow: 'hidden',
              position: 'relative',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
            onDragOver={(e) => { e.preventDefault(); setIsDraggingOverChat(true) }}
            onDragEnter={(e) => { e.preventDefault(); setIsDraggingOverChat(true) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingOverChat(false) }}
            onDrop={handleChatDrop}
          >
            {/* Drag-and-drop overlay */}
            {isDraggingOverChat && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 50,
                background: 'rgba(168,85,247,0.18)',
                border: '2px dashed #a855f7',
                borderRadius: '8px',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none'
              }}>
                <div style={{ fontSize: '28px', marginBottom: '6px' }}>📎</div>
                <div style={{ color: '#a855f7', fontWeight: 700, fontSize: '13px' }}>Drop file or image here</div>
                <div style={{ color: '#c084fc', fontSize: '11px', marginTop: '4px', opacity: 0.8 }}>Images, text files, documents</div>
              </div>
            )}
            {/* Header - App View - Enterprise Design */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px',
              background: theme === 'standard' ? 'linear-gradient(180deg, rgba(248,250,252,0.95) 0%, rgba(241,245,249,0.9) 100%)' : theme === 'dark' ? 'linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.9) 100%)' : 'linear-gradient(180deg, rgba(15,10,30,0.95) 0%, rgba(30,20,50,0.9) 100%)',
              borderBottom: theme === 'standard' ? '1px solid rgba(15,23,42,0.1)' : '1px solid rgba(168,85,247,0.3)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              color: themeColors.text
            }}>
              {/* Selectors */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                <select
                  key={`workspace-select-app-${theme}`}
                  value={dockedWorkspace}
                  onChange={(e) => setDockedWorkspace(e.target.value as typeof dockedWorkspace)}
                  style={{
                    fontSize: '10px',
                    fontWeight: '600',
                    height: '22px',
                    width: '90px',
                    background: selectboxStyle.background,
                    border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(168,85,247,0.4)',
                    color: selectboxStyle.color,
                    borderRadius: '4px',
                    padding: '0 18px 0 6px',
                    cursor: 'pointer',
                    outline: 'none',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6' viewBox='0 0 12 12'%3E%3Cpath fill='${selectboxStyle.arrowColor}' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 4px center'
                  }}
                >
                  <option value="wr-chat">💬 WR Chat</option>
                  <option value="augmented-overlay">🎯 Augmented Overlay</option>
                  <option value="beap-messages">📦 BEAP Messages</option>
                  <option value="wrguard">🔒 WRGuard</option>
                </select>
                {dockedWorkspace === 'wr-chat' && (
                  <select
                    key={`submode-select-app-${theme}`}
                    value={dockedSubmode}
                    onChange={(e) => setDockedSubmode(e.target.value as typeof dockedSubmode)}
                    style={{
                      fontSize: '11px',
                      fontWeight: '500',
                      height: '26px',
                      width: '75px',
                      background: selectboxStyle.background,
                      border: 'none',
                      color: selectboxStyle.color,
                      borderRadius: '13px',
                      padding: '0 18px 0 6px',
                      transition: 'all 0.15s ease',
                      cursor: 'pointer',
                      outline: 'none',
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6' viewBox='0 0 12 12'%3E%3Cpath fill='${selectboxStyle.arrowColor}' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 4px center'
                    }}
                  >
                    <option value="command">cmd</option>
                    <option value="p2p-chat">Direct Chat</option>
                    <option value="p2p-stream">Live Views</option>
                    <option value="group-stream">Group Sessions</option>
                    <option value="handshake">Handshake Request</option>
                  </select>
                )}
                {dockedWorkspace === 'beap-messages' && (
                  <select
                    key={`beap-submode-select-app-${theme}`}
                    value={beapSubmode}
                    onChange={(e) => setBeapSubmode(e.target.value as typeof beapSubmode)}
                    style={{
                      fontSize: '11px',
                      fontWeight: '500',
                      height: '26px',
                      width: '90px',
                      background: selectboxStyle.background,
                      border: 'none',
                      color: selectboxStyle.color,
                      borderRadius: '13px',
                      padding: '0 18px 0 6px',
                      transition: 'all 0.15s ease',
                      cursor: 'pointer',
                      outline: 'none',
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6' viewBox='0 0 12 12'%3E%3Cpath fill='${selectboxStyle.arrowColor}' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 4px center'
                    }}
                  >
                    <option value="inbox">📥 Inbox</option>
                    <option value="bulk-inbox">⚡ Bulk Inbox</option>
                    <option value="draft">✏️ Draft</option>
                    <option value="outbox">📤 Outbox</option>
                    <option value="archived">📁 Archived</option>
                    <option value="rejected">🚫 Rejected</option>
                  </select>
                )}
              </div>
              {/* Divider */}
              <div style={{ width: '1px', height: '16px', background: theme === 'standard' ? 'rgba(15,23,42,0.15)' : 'rgba(168,85,247,0.3)', margin: '0 4px' }} />
              {/* Controls */}
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'nowrap', justifyContent: 'flex-end', minWidth: 0 }}>
                {(dockedPanelMode as string) !== 'admin' && dockedPanelMode !== 'beap-messages' && dockedPanelMode !== 'augmented-overlay' && dockedWorkspace !== 'wrguard' && <>
                  <WrChatCaptureButton
                    variant="compact"
                    theme={theme}
                    sidepanelPreset="appBar"
                    source="sidepanel-docked-chat"
                    createTrigger={createTriggerChecked}
                    addCommand={addCommandChecked}
                  />
                  <WrChatDiffButton
                    variant="compact"
                    theme={theme}
                    sidepanelPreset="appBar"
                    onDiffMessage={handleDiffMessage}
                    pinnedDiffIds={pinnedDiffIds}
                    onToggleDiffPin={handleToggleDiffPin}
                    onWatchersChange={setDiffWatchers}
                    openDialogRef={diffDialogOpenRef}
                  />
                  <button
                    type="button"
                    onClick={clearWrChat}
                    title="Clear chat"
                    style={{
                      ...chatControlButtonStyle(),
                      borderRadius: '6px',
                      padding: '0 5px',
                      height: '22px',
                      fontSize: '10px',
                      fontWeight: 500,
                      opacity: 0.55,
                      border: 'none',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      minWidth: 22,
                      ...(theme === 'standard' ? { color: '#0f172a' } : {}),
                    }}
                    onMouseEnter={(e) => {
                      if (theme === 'standard') {
                        e.currentTarget.style.background = '#eef3f6'
                        e.currentTarget.style.color = '#0f172a'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (theme === 'standard') {
                        e.currentTarget.style.background = '#ffffff'
                        e.currentTarget.style.color = '#0f172a'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                      }
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {/* Anchored triggers shown as icons on the top edge of the chat inner frame — not as chips here */}
                  <div style={{ position: 'relative' }}>
                    <button 
                      onClick={() => setShowTagsMenu(!showTagsMenu)}
                      title="Tags - Quick access to saved triggers"
                      style={{
                        ...chatControlButtonStyle(),
                        borderRadius: '6px',
                        padding: '0 10px',
                        height: '22px',
                        fontSize: '10px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        if (theme === 'standard') {
                          e.currentTarget.style.background = '#eef3f6'
                          e.currentTarget.style.color = '#0f172a'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (theme === 'standard') {
                          e.currentTarget.style.background = '#f8f9fb'
                          e.currentTarget.style.color = '#0f172a'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                        }
                      }}
                    >
                      {/* Tag / label icon */}
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="7" cy="7" r="1.5" fill="currentColor" />
                      </svg>
                      Tags{' '}
                      <span
                        style={{
                          fontSize: '11px',
                          opacity: 0.9,
                          color: theme === 'standard' ? '#0f172a' : undefined,
                        }}
                      >
                        ▾
                      </span>
                    </button>
                    
                    {/* Tags Dropdown Menu - App View */}
                    {showTagsMenu && (
                      <div 
                        style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          minWidth: '180px',
                          width: '240px',
                          maxHeight: '300px',
                          overflowY: 'auto',
                          zIndex: 2147483647,
                          background: '#111827',
                          color: 'white',
                          border: '1px solid rgba(255,255,255,0.20)',
                          borderRadius: '8px',
                          boxShadow: '0 10px 22px rgba(0,0,0,0.35)',
                          marginTop: '4px'
                        }}
                      >
                        {triggers.length === 0 ? (
                          <div style={{ padding: '8px 10px', fontSize: '12px', opacity: 0.8 }}>
                            No tags yet
                          </div>
                        ) : (
                          triggers.map((trigger, i) => renderTriggerRow(trigger, i, triggers.length))
                        )}
                      </div>
                    )}
                  </div>
                </>}
                <button 
                  onClick={toggleCommandChatPin}
                  title="Unpin from sidepanel"
                  style={{
                    ...chatControlButtonStyle(),
                    height: '22px',
                    minWidth: '22px',
                    borderRadius: '4px',
                    padding: '0 8px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  ↗
                </button>
              </div>
            </div>

            {/* SECTION 2 - Conditional Content based on mode */}
            {/* P2P Chat */}
            {dockedPanelMode === 'p2p-chat' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : 'rgba(255,255,255,0.06)', minHeight: '280px' }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.1)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6b7280' }} />
                    <span style={{ fontSize: '12px', opacity: 0.7 }}>No peer connected</span>
                  </div>
                  <button style={{ padding: '4px 10px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', cursor: 'pointer' }}>Connect</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}></div>
                <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <textarea placeholder="Message or capsule..." style={{ flex: 1, padding: '8px 10px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', resize: 'none', minHeight: '32px', maxHeight: '80px' }} />
                  <button title="Build Capsule" style={{ width: '32px', height: '32px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>💊</button>
                  <button title="AI Assistant" style={{ width: '32px', height: '32px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✨</button>
                  <button title="Attach" style={{ width: '32px', height: '32px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>
                  <button style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: 'none', borderRadius: '8px', color: 'white', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Send</button>
                </div>
              </div>
            )}

            {/* P2P Live */}
            {/* P2P Live */}
            {dockedPanelMode === 'p2p-stream' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#000', minHeight: '280px' }}>
                <div style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  <div style={{ textAlign: 'center', color: '#666' }}>
                    <div style={{ fontSize: '40px', marginBottom: '8px' }}>📹</div>
                    <div style={{ fontSize: '12px' }}>No active stream</div>
                  </div>
                  <div style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '6px' }}>
                    <button style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>🎥 Start</button>
                    <button style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>🎙️ Mute</button>
                    <button style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>📺 Share</button>
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '120px', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : 'rgba(255,255,255,0.06)' }}>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}></div>
                  <div style={{ padding: '8px', display: 'flex', gap: '6px', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <textarea placeholder="Chat..." style={{ flex: 1, padding: '6px 8px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', resize: 'none', minHeight: '28px' }} />
                    <button title="AI Assistant" style={{ width: '28px', height: '28px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', cursor: 'pointer' }}>✨</button>
                    <button style={{ padding: '6px 12px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Send</button>
                  </div>
                </div>
              </div>
            )}

            {/* Group */}
            {dockedPanelMode === 'group-stream' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#000', minHeight: '280px' }}>
                <div style={{ flex: 2, display: 'flex' }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #333' }}>
                    <div style={{ textAlign: 'center', color: '#666' }}>
                      <div style={{ fontSize: '32px' }}>👤</div>
                      <div style={{ fontSize: '10px', marginTop: '4px' }}>Host</div>
                    </div>
                  </div>
                  <div style={{ width: '70px', display: 'flex', flexDirection: 'column', gap: '2px', padding: '4px', overflowY: 'auto' }}>
                    <div style={{ aspectRatio: '1', background: '#111', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: '14px' }}>👤</div>
                    <div style={{ aspectRatio: '1', background: '#111', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: '14px' }}>+</div>
                  </div>
                </div>
                <div style={{ padding: '6px 10px', borderTop: '1px solid rgba(255,255,255,0.15)', borderBottom: '1px solid rgba(255,255,255,0.15)', display: 'flex', gap: '6px', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
                  <button style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '4px', color: 'white', fontSize: '12px', cursor: 'pointer' }}>🎥</button>
                  <button style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '4px', color: 'white', fontSize: '12px', cursor: 'pointer' }}>🎙️</button>
                  <button style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '4px', color: 'white', fontSize: '12px', cursor: 'pointer' }}>📺</button>
                  <button style={{ padding: '4px 8px', background: 'rgba(239,68,68,0.2)', border: 'none', borderRadius: '4px', color: '#ef4444', fontSize: '10px', cursor: 'pointer' }}>Leave</button>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100px', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : 'rgba(255,255,255,0.06)' }}>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}></div>
                  <div style={{ padding: '8px', display: 'flex', gap: '6px', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <textarea placeholder="Group chat..." style={{ flex: 1, padding: '6px 8px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', resize: 'none', minHeight: '28px' }} />
                    <button title="AI Assistant" style={{ width: '28px', height: '28px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', cursor: 'pointer' }}>✨</button>
                    <button style={{ padding: '6px 12px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Send</button>
                  </div>
                </div>
              </div>
            )}

            {/* BEAP Handshake Request — Send Handshake Delivery */}
            {dockedPanelMode === 'handshake' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : (theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.06)'), minHeight: '280px', overflowY: 'auto' }}>
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
                        <input type="radio" name="hs-policy-docked" checked={active} onChange={() => setHsPolicy({ ai_processing_mode: val })} style={{ marginTop: '3px', accentColor: '#8b5cf6' }} />
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
            )}

            {(dockedPanelMode === 'command' || dockedPanelMode === 'augmented-overlay') && (
              <>
                {/* Messages Area */}
                <div 
                  id="ccd-messages-sidepanel"
                  ref={chatRef}
                  style={{
                    height: `${chatHeight}px`,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : 'rgba(255,255,255,0.06)',
                    borderBottom: '1px solid rgba(255,255,255,0.20)',
                    padding: '14px',
                    position: 'relative',
                    paddingTop: (anchoredTriggerKeys.length > 0 || pinnedDiffIds.length > 0) ? 40 : 14,
                  }}
                >
                  {/* Top-edge pinned icon strip */}
                  {(anchoredTriggerKeys.length > 0 || pinnedDiffIds.length > 0) && (
                    <div role="toolbar" aria-label="Pinned shortcuts" style={{ position: 'absolute', top: 4, left: 8, right: 8, display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', gap: 6, zIndex: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
                      {triggers.filter((t) => anchoredTriggerKeys.includes(triggerAnchorKey(t))).map((trigger) => {
                        const key = triggerAnchorKey(trigger)
                        return (
                          <span key={key} role="button" tabIndex={0} title={`Run: ${String(trigger.name || trigger.command || 'Trigger').slice(0, 80)}`}
                            onClick={() => { try { handleTriggerClick(trigger) } catch { /* noop */ } }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); try { handleTriggerClick(trigger) } catch { /* noop */ } } }}
                            style={{ fontSize: 18, lineHeight: 1, cursor: 'pointer', userSelect: 'none', flexShrink: 0, transition: 'transform 0.12s', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1.3)' }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1)' }}
                          >{spEmojiForKey(key)}</span>
                        )
                      })}
                      {diffWatchers.filter((w) => pinnedDiffIds.includes(w?.id ?? '')).map((watcher) => {
                        const runDiffNow = () => {
                          const watcherId = watcher.id as string
                          if (!watcherId) return
                          new Promise<string | null>((resolve) => {
                            try {
                              chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string | null } | undefined) => {
                                if (chrome.runtime.lastError) resolve(null); else resolve(resp?.secret?.trim() ? resp.secret : null)
                              })
                            } catch { resolve(null) }
                          }).then((secret) =>
                            fetch(`http://127.0.0.1:51248/api/wrchat/diff-watchers/${encodeURIComponent(watcherId)}/run`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' },
                              signal: AbortSignal.timeout(15000),
                            }).catch((err) => console.warn('[WRChat] diff runNow failed:', err))
                          ).catch(() => { /* noop */ })
                        }
                        return (
                        <span key={`diff:${watcher.id}`} role="button" tabIndex={0} title={`Diff: ${String(watcher.name || watcher.tag || 'Diff').slice(0, 80)} — click to run diff now`}
                          onClick={() => { runDiffNow() }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); runDiffNow() } }}
                          style={{ fontSize: 18, lineHeight: 1, cursor: 'pointer', userSelect: 'none', flexShrink: 0, transition: 'transform 0.12s', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1.3)' }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1)' }}
                        >{spEmojiForKey(`diff:${watcher.id ?? watcher.name ?? ''}`)}</span>
                        )})}
                    </div>
                  )}
                  {chatMessages.length === 0 ? (
                    <div style={{ fontSize: '13px', opacity: dockedPanelMode === 'augmented-overlay' ? 0.8 : 0.6, textAlign: 'center', padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                      {dockedPanelMode === 'augmented-overlay' ? (
                        <>
                          <span style={{ fontSize: '24px' }}>🎯</span>
                          <span>Point with the cursor or select elements in order to ask questions or trigger automations directly in the UI.</span>
                        </>
                      ) : (
                        'Start a conversation...'
                      )}
                    </div>
                  ) : (
                    chatMessages.map((msg: any, i) => (
                      <div 
                        key={i} 
                        style={{
                          display: 'flex',
                          justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
                        }}
                      >
                        <div style={{
                          maxWidth: msg.imageUrl ? '100%' : '85%',
                          width: msg.imageUrl ? '100%' : undefined,
                          padding: msg.imageUrl ? 0 : '10px 14px',
                          borderRadius: '12px',
                          fontSize: '13px',
                          lineHeight: '1.5',
                          wordBreak: 'break-word',
                          overflowWrap: 'anywhere',
                          overflow: 'hidden',
                          background: msg.imageUrl ? 'transparent' : (msg.role === 'user' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.12)'),
                          border: msg.imageUrl ? 'none' : (msg.role === 'user' ? '1px solid rgba(34,197,94,0.5)' : '1px solid rgba(255,255,255,0.25)')
                        }}>
                          {msg.imageUrl && (
                            <img src={msg.imageUrl} alt="screenshot" style={{ width: '100%', maxWidth: '100%', borderRadius: 8, display: 'block' }} />
                          )}
                          {msg.text ? (
                            <div style={{ marginTop: msg.imageUrl ? 4 : 0, padding: msg.imageUrl ? '4px 8px' : 0, fontSize: msg.imageUrl ? '11px' : '13px', opacity: msg.imageUrl ? 0.75 : 1, whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Resize Handle */}
                <div 
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setIsResizingChat(true)
                  }}
                  style={{
                    height: '4px',
                    background: 'rgba(255,255,255,0.15)',
                    cursor: 'ns-resize',
                    borderTop: '1px solid rgba(255,255,255,0.10)',
                    borderBottom: '1px solid rgba(255,255,255,0.10)'
                  }}
                />

                {/* Pending document indicator */}
                {pendingDocContent && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '6px 14px',
                    background: 'rgba(168,85,247,0.1)',
                    borderTop: '1px solid rgba(168,85,247,0.2)',
                    fontSize: '11px', color: '#a855f7'
                  }}>
                    <span>📄</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <strong>{pendingDocContent.name}</strong> attached — type your question and Send
                    </span>
                    <button
                      onClick={() => setPendingDocContent(null)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a855f7', fontSize: '14px', padding: 0, lineHeight: 1 }}
                      title="Remove attachment"
                    >✕</button>
                  </div>
                )}

                {/* Compose Area */}
                <div 
                  id="ccd-compose-sidepanel"
                  style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '8px 10px'
                }}>
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={handleChatKeyDown}
                    placeholder={searchBarContext || 'Type your message...'}
                    style={{
                      flex: 1,
                      boxSizing: 'border-box',
                      height: '40px',
                      minHeight: '40px',
                      resize: 'vertical',
                      background: theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.08)',
                      border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.20)',
                      color: theme === 'standard' ? '#0f172a' : 'white',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      fontSize: '13px',
                      fontFamily: 'inherit',
                      lineHeight: '1.5'
                    }}
                  />
                <input
                    ref={fileInputRef}
                    type="file" 
                    multiple 
                    style={{ display: 'none' }} 
                    onChange={handleFileChange}
                  />
                  <button 
                    onClick={handleBucketClick}
                    title="Attach" 
                    style={{
                      flexShrink: 0,
                      width: '28px',
                      height: '28px',
                      background: 'transparent',
                      border: 'none',
                      color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'color 0.15s ease'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = theme === 'standard' ? '#0f172a' : 'white')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  </button>
                  {renderSendButton()}
                </div>
              </>
            )}

            {dockedWorkspace === 'beap-messages' && (
              /* BEAP Messages Workspace - Section 2 (App View) */
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: theme === 'pro' ? 'rgba(118,75,162,0.15)' : (theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.04)'), overflowY: 'auto' }}>
                <style>{`
                  .beap-input::placeholder, .beap-textarea::placeholder {
                    color: ${theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.5)'};
                    opacity: 1;
                  }
                `}</style>
                
                {/* Placeholder views for non-draft submodes */}
                {beapSubmode === 'inbox' && (
                  <InboxErrorBoundary componentName="BeapInboxView" theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}>
                  <BeapInboxView
                    ref={inboxViewRef}
                    theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                    onNavigateToDraft={() => setBeapSubmode('draft')}
                    onNavigateToWRGuard={() => setDockedWorkspace('wrguard')}
                    onNavigateToHandshake={(handshakeId) => {
                      setDockedWorkspace('wrguard')
                      useWRGuardStore.getState().setActiveSection('handshakes')
                      useWRGuardStore.getState().setSelectedHandshakeId(handshakeId)
                    }}
                    onNavigateToHandshakesTab={() => {
                      setDockedWorkspace('wrguard')
                      useWRGuardStore.getState().setActiveSection('handshakes')
                    }}
                    onSetSearchContext={setSearchBarContext}
                    onAttachmentSelect={(_mid, attachmentId) => {
                      beapInboxSelectedAttachmentIdRef.current = attachmentId
                    }}
                    onAiQuery={(query, messageId, attachmentId) => {
                      if (attachmentId != null) beapInboxSelectedAttachmentIdRef.current = attachmentId
                      pendingInboxAiRef.current = {
                        messageId,
                        query,
                        ...(attachmentId != null ? { attachmentId } : {}),
                      }
                      inboxViewRef.current?.startGenerating()
                      setChatInput(query)
                      handleSendMessage()
                    }}
                    replyComposerConfig={replyComposerConfig}
                  />
                  </InboxErrorBoundary>
                )}
                {beapSubmode === 'outbox' && (
                  <BeapMessageListView
                    folder="outbox"
                    theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                    onNavigateToDraft={() => setBeapSubmode('draft')}
                  />
                )}
                {beapSubmode === 'archived' && (
                  <BeapMessageListView
                    folder="archived"
                    theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                    onNavigateToDraft={() => setBeapSubmode('draft')}
                  />
                )}
                {beapSubmode === 'rejected' && (
                  <BeapMessageListView
                    folder="rejected"
                    theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                    onNavigateToDraft={() => setBeapSubmode('draft')}
                  />
                )}
                {beapSubmode === 'bulk-inbox' && (
                  <InboxErrorBoundary componentName="BeapBulkInbox" theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}>
                    <BeapBulkInbox
                      ref={bulkInboxRef}
                      theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                      onSetSearchContext={setSearchBarContext}
                      onAiQuery={(query, messageId) => {
                        pendingInboxAiRef.current = { messageId, query, isBulk: true }
                        bulkInboxRef.current?.startGenerating(messageId)
                        setChatInput(query)
                        handleSendMessage()
                      }}
                      onViewHandshake={(handshakeId) => {
                        setDockedWorkspace('wrguard')
                        useWRGuardStore.getState().setActiveSection('handshakes')
                        useWRGuardStore.getState().setSelectedHandshakeId(handshakeId)
                      }}
                      onViewInInbox={(messageId) => {
                        setBeapSubmode('inbox')
                        useBeapInboxStore.getState().selectMessage(messageId)
                      }}
                      replyComposerConfig={replyComposerConfig}
                      onClassificationComplete={(count) => showNotification(`Analysis complete — ${count} message${count === 1 ? '' : 's'} classified`)}
                      onArchiveComplete={(count) => showNotification(`Archived ${count} message${count === 1 ? '' : 's'}`)}
                    />
                  </InboxErrorBoundary>
                )}
                
                {/* Draft view - EMAIL ACCOUNTS + BEAP Message */}
                {beapSubmode === 'draft' && (
                  <InboxErrorBoundary componentName="BeapBuilder" theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}>
                  <>
                {/* DELIVERY METHOD - FIRST */}
                <div style={{ padding: '14px 18px', borderBottom: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Delivery Method</label>
                  <select value={handshakeDelivery} onChange={(e) => setHandshakeDelivery(e.target.value as 'email' | 'download' | 'p2p')} style={{ width: '100%', padding: '10px 12px', background: theme === 'standard' ? 'white' : '#1f2937', border: `1px solid ${theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.15)'}`, borderRadius: '8px', color: theme === 'standard' ? '#1f2937' : 'white', fontSize: '13px', cursor: 'pointer' }}>
                    <option value="email" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>📧 Email</option>
                    <option value="p2p" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>🔗 P2P</option>
                    <option value="download" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>💾 Download (USB/Wallet)</option>
                  </select>
                </div>
                
                {/* EMAIL ACCOUNTS SECTION - Only visible when email delivery selected */}
                {handshakeDelivery === 'email' && (
                <div style={{ 
                  padding: '16px 18px', 
                  borderBottom: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)',
                  background: theme === 'standard' ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px' }}>🔗</span>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Connected Email Accounts</span>
                    </div>
                    <button
                      onClick={() => openConnectEmail(ConnectEmailLaunchSource.WrChatDocked)}
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

                  {emailAccountsFetchErrorEl}
                  
                  {isLoadingEmailAccounts ? (
                    <div style={{ padding: '12px', textAlign: 'center', opacity: 0.6, fontSize: '12px' }}>
                      Loading accounts...
                    </div>
                  ) : emailAccounts.length === 0 ? (
                    <div style={{ 
                      padding: '20px', 
                      background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.05)',
                      borderRadius: '8px',
                      border: theme === 'standard' ? '1px dashed #94a3b8' : '1px dashed rgba(255,255,255,0.2)',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
                      <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>
                        {emailAccountsLoadError?.trim()
                          ? 'No accounts loaded (see message above).'
                          : 'No email accounts connected'}
                      </div>
                      <div style={{ fontSize: '11px', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.5)' }}>
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
                            background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)',
                            borderRadius: '8px',
                            border: account.status === 'active' 
                              ? (theme === 'standard' ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(34,197,94,0.4)')
                              : (theme === 'standard' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(239,68,68,0.4)')
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '18px' }}>
                              {account.provider === 'gmail' ? '📧' : account.provider === 'microsoft365' ? '📨' : account.provider === 'zoho' ? '📬' : '✉️'}
                            </span>
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: '500', color: theme === 'standard' ? '#0f172a' : 'white' }}>
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
                                <span style={{ color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>
                                  {account.status === 'active' ? 'Connected' : account.lastError || 'Error'}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => disconnectEmailAccount(account.id)}
                            title="Disconnect account"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.5)',
                              cursor: 'pointer',
                              padding: '4px',
                              fontSize: '14px'
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Select account for sending */}
                  {emailAccounts.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Send From:</label>
                      <select value={selectedEmailAccountId || defaultEmailAccountRowId || ''} onChange={(e) => setSelectedEmailAccountId(e.target.value)} style={{ width: '100%', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.1)', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#0f172a' : 'white', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer', outline: 'none' }}>
                        {emailAccounts.map(account => (<option key={account.id} value={account.id}>{account.email || account.displayName} ({account.provider})</option>))}
                      </select>
                    </div>
                  )}
                </div>
                )}
                {/* BEAP™ Message UI - App View */}
                <div style={{ padding: '12px 14px', borderBottom: `1px solid ${theme === 'standard' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>📦</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#1f2937' : 'white' }}>BEAP™ Message (required)</span>
                </div>
                <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Fingerprint */}
                  <div style={{ background: theme === 'standard' ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.15)', border: theme === 'standard' ? '1px solid rgba(59,130,246,0.2)' : '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', padding: '12px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: theme === 'standard' ? '#3b82f6' : '#93c5fd', marginBottom: '6px' }}>Your Fingerprint</div>
                    <code style={{ fontSize: '13px', fontFamily: 'monospace', color: theme === 'standard' ? '#1e40af' : '#bfdbfe' }}>{ourFingerprintShort}</code>
                  </div>
                  {/* Recipient Mode Switch */}
                  <RecipientModeSwitch mode={beapRecipientMode} onModeChange={setBeapRecipientMode} theme={theme} />
                  {/* Handshake Select (PRIVATE mode only) */}
                  {beapRecipientMode === 'private' && (
                    <RecipientHandshakeSelect
                      handshakes={handshakes}
                      selectedHandshakeId={selectedRecipient?.handshake_id || null}
                      onSelect={setSelectedRecipient}
                      theme={theme}
                      isLoading={handshakesLoading}
                      fetchError={handshakesError}
                      onRetry={refreshHandshakes}
                    />
                  )}
                  {/* Delivery Method Panel - Adapts to recipient mode */}
                  <DeliveryMethodPanel deliveryMethod={handshakeDelivery} recipientMode={beapRecipientMode} selectedRecipient={selectedRecipient} emailTo={beapDraftTo} onEmailToChange={setBeapDraftTo} theme={theme} ourFingerprintShort={ourFingerprintShort} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>BEAP™ Message (required)</label>
                    <textarea className="beap-textarea" value={beapDraftMessage} onChange={(e) => setBeapDraftMessage(e.target.value)} placeholder="Public capsule text — required before send. This is the transport-visible message body." style={{ flex: 1, minHeight: '120px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.15)', color: theme === 'standard' ? '#0f172a' : 'white', borderRadius: '6px', padding: '10px 12px', fontSize: '12px', lineHeight: '1.5', resize: 'none', outline: 'none', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }} />
                  </div>
                  {/* Encrypted Message (qBEAP/PRIVATE only) */}
                  {beapRecipientMode === 'private' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#7c3aed' : '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.5px' }}>🔐 Encrypted Message (Private · qBEAP)</label>
                      <textarea className="beap-textarea" value={beapDraftEncryptedMessage} onChange={(e) => setBeapDraftEncryptedMessage(e.target.value)} placeholder="This message is encrypted, capsule-bound, and never transported outside the BEAP package." style={{ flex: 1, minHeight: '100px', background: theme === 'standard' ? 'rgba(139,92,246,0.05)' : 'rgba(139,92,246,0.15)', border: theme === 'standard' ? '1px solid rgba(139,92,246,0.3)' : '1px solid rgba(139,92,246,0.4)', color: theme === 'standard' ? '#0f172a' : 'white', borderRadius: '6px', padding: '10px 12px', fontSize: '12px', lineHeight: '1.5', resize: 'none', outline: 'none', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }} />
                      <div style={{ fontSize: '10px', color: theme === 'standard' ? '#7c3aed' : '#c4b5fd', marginTop: '4px' }}>⚠️ This content is authoritative when present and never leaves the encrypted capsule.</div>
                    </div>
                  )}
                  {/* Advanced: Session + Attachments (Expanded) */}
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '8px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Advanced (Optional)</div>
                    <div style={{ marginBottom: '10px' }}>
                      <label style={{ fontSize: '10px', fontWeight: 500, marginBottom: '4px', display: 'block', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>Session (optional)</label>
                      <select value={beapDraftSessionId} onChange={(e) => setBeapDraftSessionId(e.target.value)} onClick={() => loadAvailableSessions()} style={{ width: '100%', background: theme === 'standard' ? '#ffffff' : '#1e293b', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.25)', color: theme === 'standard' ? '#0f172a' : '#f1f5f9', borderRadius: '6px', padding: '8px 10px', fontSize: '12px', outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}>
                        <option value="" style={{ background: theme === 'standard' ? '#ffffff' : '#1e293b', color: theme === 'standard' ? '#0f172a' : '#f1f5f9' }}>{availableSessions.length === 0 ? '— No sessions available —' : '— Select a session —'}</option>
                        {availableSessions.map((s) => (<option key={s.key} value={s.key} style={{ background: theme === 'standard' ? '#ffffff' : '#1e293b', color: theme === 'standard' ? '#0f172a' : '#f1f5f9' }}>{s.name} ({new Date(s.timestamp).toLocaleDateString()})</option>))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', fontWeight: 500, marginBottom: '4px', display: 'block', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>Attachments (PDFs: text extracts automatically)</label>
                      <input type="file" multiple onChange={async (e) => { const files = Array.from(e.target.files ?? []); if (!files.length) return; const tooBig = files.filter((f) => f.size > MAX_BEAP_DRAFT_ATTACHMENT_BYTES); if (tooBig.length) { setNotification(beapUiValidationFailure(formatOversizeAttachmentRejection(tooBig.map((f) => f.name)))); setTimeout(() => setNotification(null), 10000); } const okFiles = files.filter((f) => f.size <= MAX_BEAP_DRAFT_ATTACHMENT_BYTES); const newItems: DraftAttachment[] = []; for (const file of okFiles) { if (beapDraftAttachments.length + newItems.length >= 20) { console.warn('[BEAP] Max 20 attachments reached'); break } const dataBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const res = String(reader.result ?? ''); resolve(res.includes(',') ? res.split(',')[1] : res) }; reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) }); const attachmentId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; const mimeType = file.type || 'application/octet-stream'; const isPdfFile = mimeType.toLowerCase() === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'); const capsuleAttachment: CapsuleAttachment = { id: attachmentId, originalName: file.name, originalSize: file.size, originalType: mimeType, semanticContent: null, semanticExtracted: false, encryptedRef: `encrypted_${attachmentId}`, encryptedHash: '', previewRef: null, rasterProof: null, isMedia: mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/'), hasTranscript: false }; newItems.push({ id: attachmentId, name: file.name, mime: mimeType, size: file.size, dataBase64, capsuleAttachment, processing: { parsing: isPdfFile, rasterizing: false } }) } setBeapDraftAttachments((prev) => [...prev, ...newItems]); for (const item of newItems) { const isPdfItem = item.mime?.toLowerCase() === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf'); if (!isPdfItem || !item.dataBase64) continue; void runDraftAttachmentParseWithFallback({ id: item.id, dataBase64: item.dataBase64, capsuleAttachment: item.capsuleAttachment }).then((upd) => { setBeapDraftAttachments((prev) => prev.map((x) => (x.id === item.id ? { ...x, capsuleAttachment: upd.capsuleAttachment, processing: upd.processing } : x))) }).catch((err) => { const u = draftAttachmentParseRejectedUpdate({ id: item.id, dataBase64: item.dataBase64, capsuleAttachment: item.capsuleAttachment }, err); setBeapDraftAttachments((prev) => prev.map((x) => (x.id === item.id ? { ...x, capsuleAttachment: u.capsuleAttachment, processing: u.processing } : x))) }) } e.currentTarget.value = '' }} style={{ fontSize: '11px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)' }} />
                      {beapDraftAttachments.length > 0 && (
                        <div style={{ marginTop: '8px' }}>
                          {beapDraftAttachments.map((a) => {
                              const isPdf = a.mime?.toLowerCase() === 'application/pdf' || a.name.toLowerCase().endsWith('.pdf')
                              const isParsing = !!a.processing?.parsing
                              const isSuccess = !!a.capsuleAttachment?.semanticExtracted
                              const showPdfBadge = isPdf && (isParsing || isSuccess || !!a.processing?.error)
                              const parseStatus: 'pending' | 'success' | 'failed' = isParsing ? 'pending' : isSuccess ? 'success' : 'failed'
                              return (
                              <div key={a.id} style={{ background: theme === 'standard' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)', borderRadius: '4px', marginBottom: '4px', overflow: 'hidden' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                                    <span style={{ fontSize: '14px' }}>📄</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: '11px', color: theme === 'standard' ? '#0f172a' : 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                                      <div style={{ fontSize: '9px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.5)' }}>
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
                                          border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.2)',
                                          color: theme === 'standard' ? '#475569' : 'rgba(255,255,255,0.75)',
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
                                          })
                                            .then((upd) => {
                                              setBeapDraftAttachments((prev) =>
                                                prev.map((x) =>
                                                  x.id === a.id
                                                    ? { ...x, capsuleAttachment: upd.capsuleAttachment, processing: upd.processing }
                                                    : x,
                                                ),
                                              )
                                            })
                                            .catch((err) => {
                                              const u = draftAttachmentParseRejectedUpdate(
                                                {
                                                  id: a.id,
                                                  dataBase64: a.dataBase64!,
                                                  capsuleAttachment: a.capsuleAttachment,
                                                },
                                                err,
                                              )
                                              setBeapDraftAttachments((prev) =>
                                                prev.map((x) =>
                                                  x.id === a.id
                                                    ? { ...x, capsuleAttachment: u.capsuleAttachment, processing: u.processing }
                                                    : x,
                                                ),
                                              )
                                            })
                                        }}
                                        style={{
                                          background: theme === 'standard' ? 'rgba(139,92,246,0.12)' : 'rgba(139,92,246,0.25)',
                                          border: `1px solid ${theme === 'standard' ? 'rgba(139,92,246,0.35)' : 'rgba(192,132,252,0.4)'}`,
                                          color: theme === 'standard' ? '#6d28d9' : '#e9d5ff',
                                          borderRadius: '4px',
                                          padding: '2px 8px',
                                          fontSize: '10px',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        Retry
                                      </button>
                                    )}
                                    <button onClick={() => { setBeapDraftReaderModalId((id) => (id === a.id ? null : id)); setBeapDraftAttachments((prev) => prev.filter((x) => x.id !== a.id)) }} style={{ background: 'transparent', border: 'none', color: theme === 'standard' ? '#ef4444' : '#f87171', fontSize: '10px', cursor: 'pointer' }}>Remove</button>
                                    {showPdfBadge && <AttachmentStatusBadge status={parseStatus} theme={theme === 'standard' ? 'standard' : 'dark'} />}
                                  </div>
                                </div>
                                {a.processing?.error && !isParsing && (
                                  <div style={{ padding: '6px 8px', borderTop: `1px solid ${theme === 'standard' ? 'rgba(251,191,36,0.2)' : 'rgba(251,191,36,0.25)'}`, background: theme === 'standard' ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.12)', fontSize: '10px', color: theme === 'standard' ? '#b45309' : '#fbbf24' }}>
                                    {a.processing.error.includes('connect') || a.processing.error.includes('Failed to connect')
                                      ? 'Desktop parser (port 51248) can improve extraction. Add an API key in settings for AI extraction.'
                                      : a.processing.error}
                                  </div>
                                )}
                              </div>
                            )})}
                          <button onClick={() => { setBeapDraftReaderModalId(null); setBeapDraftAttachments([]) }} style={{ background: 'transparent', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer', marginTop: '4px' }}>Clear all</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {beapP2pRelayPendingMessage && (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderTop: theme === 'standard' ? '1px solid rgba(234, 179, 8, 0.35)' : '1px solid rgba(250, 204, 21, 0.3)',
                      background: theme === 'standard' ? 'rgba(234, 179, 8, 0.1)' : 'rgba(234, 179, 8, 0.12)',
                      fontSize: '12px',
                      color: theme === 'standard' ? '#a16207' : '#fde68a',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '10px',
                    }}
                  >
                    <span>{beapP2pRelayPendingMessage}</span>
                    <button
                      type="button"
                      onClick={() => setBeapP2pRelayPendingMessage(null)}
                      style={{
                        background: 'transparent',
                        border: theme === 'standard' ? '1px solid rgba(161, 98, 7, 0.35)' : '1px solid rgba(253, 230, 138, 0.4)',
                        color: 'inherit',
                        borderRadius: '4px',
                        padding: '2px 8px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                <div style={{ padding: '12px 14px', borderTop: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'flex-end', gap: '8px', background: theme === 'standard' ? '#ffffff' : 'rgba(0,0,0,0.2)' }}>
                  <button onClick={() => { setBeapP2pRelayPendingMessage(null); setBeapDraftTo(''); setBeapDraftMessage(''); setBeapDraftEncryptedMessage(''); setBeapDraftSessionId(''); setBeapDraftReaderModalId(null); setBeapDraftAttachments([]); setSelectedRecipient(null) }} style={{ background: 'transparent', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#536471' : 'rgba(255,255,255,0.7)', borderRadius: '6px', padding: '8px 16px', fontSize: '12px', cursor: 'pointer' }}>Clear</button>
                  <button onClick={handleSendBeapMessage} disabled={isBeapSendDisabled} style={{ background: isBeapSendDisabled ? 'rgba(168,85,247,0.5)' : 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)', border: 'none', color: 'white', borderRadius: '6px', padding: '8px 20px', fontSize: '12px', fontWeight: 600, cursor: isBeapSendDisabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: isBeapSendDisabled ? 0.7 : 1 }}>{getBeapSendButtonLabel()}</button>
                </div>
                  </>
                  </InboxErrorBoundary>
                )}
              </div>
            )}

            {dockedWorkspace === 'wrguard' && (
              /* WRGuard Workspace - Section 2 (App View) */
              <WRGuardWorkspace 
                theme={theme}
                emailAccounts={emailAccounts}
                isLoadingEmailAccounts={isLoadingEmailAccounts}
                selectedEmailAccountId={selectedEmailAccountId}
                onConnectEmail={() => openConnectEmail(ConnectEmailLaunchSource.WrChatDocked)}
                onDisconnectEmail={disconnectEmailAccount}
                onSetProcessingPaused={setAccountProcessingPaused}
                onSelectEmailAccount={setSelectedEmailAccountId}
                onViewInInbox={(messageId) => {
                  setDockedWorkspace('beap-messages')
                  setBeapSubmode('inbox')
                  useBeapInboxStore.getState().selectMessage(messageId)
                }}
                replyComposerConfig={replyComposerConfig}
              />
            )}
          </div>
        </>
      )}
      
      {/* Add Mini App Button - Always visible */}
      <div style={{
        flex: 1,
        padding: '40px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <button
            onClick={addMiniApp}
            style={{
              width: '100%',
              maxWidth: '300px',
              padding: '20px 24px',
              ...(theme === 'standard' ? {
                background: 'rgba(15,23,42,0.08)',
                border: '2px dashed rgba(15,23,42,0.3)',
                color: '#0f172a'
              } : theme === 'dark' ? {
                background: 'rgba(255,255,255,0.1)',
                border: '2px dashed rgba(255,255,255,0.3)',
                color: '#f1f5f9'
              } : {
                background: 'rgba(118,75,162,0.3)',
                border: '2px dashed rgba(255,255,255,0.5)',
                color: 'white'
              }),
              borderRadius: '12px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '700',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              transition: 'all 0.2s ease',
              boxShadow: 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              if (theme === 'standard') {
                e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                e.currentTarget.style.borderColor = 'rgba(15,23,42,0.4)'
              } else if (theme === 'dark') {
                e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)'
              } else {
                e.currentTarget.style.background = 'rgba(118,75,162,0.55)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.7)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              if (theme === 'standard') {
                e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                e.currentTarget.style.borderColor = 'rgba(15,23,42,0.3)'
              } else if (theme === 'dark') {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'
              } else {
                e.currentTarget.style.background = 'rgba(118,75,162,0.3)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)'
              }
            }}
          >
            ➕ Add Mini App
          </button>
        </div>
      </div>
    )
  }

  // Full Admin/Control Panel UI for master tabs
  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      background: themeColors.background,
      color: themeColors.text,
      padding: '0',
      margin: '0',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      overflowX: 'hidden'
    }}>
      {/* Electron Not Running Dialog */}
      <ElectronNotRunningDialog />
      <AddModeWizardHost theme={theme} />

      {/* Session Controls at the very top - Two Rows */}
      <div style={{ 
        padding: '12px 16px',
        borderBottom: theme === 'standard' ? '1px solid #94a3b8' : theme === 'dark' ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.2)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        background: theme === 'pro' ? 'rgba(118,75,162,0.6)' : theme === 'standard' ? '#ffffff' : 'rgba(0,0,0,0.15)'
      }}>
        {/* Row 1: Session Name + 4 Action Icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={openReasoningLightbox}
          style={{
              ...actionButtonStyle('rgba(156, 39, 176, 0.8)'),
            fontSize: '14px',
            padding: 0
          }}
          title="Open Analysis Dashboard"
        >
          🧠
        </button>
        <div style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '3px'
        }}>
          <input
            type="text"
            value={sessionName}
            readOnly
            placeholder="Session Name"
            style={{
              width: '100%',
              padding: '8px 12px',
              background: theme === 'standard' ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.08)',
              border: theme === 'standard' ? '1px solid rgba(15,23,42,0.12)' : '1px solid rgba(255,255,255,0.15)',
              color: themeColors.text,
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '500',
              cursor: 'default',
              outline: 'none'
            }}
          />
          {sessionKey && (
            <div style={{
              padding: '2px 12px',
              fontSize: '10px',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              color: theme === 'standard' ? 'rgba(15,23,42,0.5)' : 'rgba(255,255,255,0.5)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              letterSpacing: '0.3px'
            }}>
              <span style={{ 
                color: theme === 'standard' ? 'rgba(15,23,42,0.4)' : 'rgba(255,255,255,0.4)',
                marginRight: '4px'
              }}>ID:</span>
              <span style={{ 
                color: theme === 'standard' ? 'rgba(79,70,229,0.8)' : 'rgba(255,215,0,0.7)',
                fontWeight: '400'
              }}>{sessionKey}</span>
            </div>
          )}
        </div>
        <button
          onClick={createNewSession}
          style={{
              ...actionButtonStyle('#4CAF50'),
            fontSize: '18px',
              fontWeight: 'bold'
            }}
          title="New Session"
        >
          +
        </button>
        <button
          onClick={() => {
            sendToContentScript('EXPORT_SESSION')
          }}
          style={{
              ...actionButtonStyle('rgba(76, 175, 80, 0.8)'),
              fontSize: '14px'
            }}
          title="Export Session (JSON/YAML/MD)"
        >
          💾
        </button>
          <button
            onClick={openPopupChat}
            style={{
              ...actionButtonStyle('rgba(255,255,255,0.1)'),
              fontSize: '14px'
            }}
            title="Open Popup Chat"
          >
            💬
          </button>
          <button
            onClick={toggleCommandChatPin}
            style={{
              ...actionButtonStyle(isCommandChatPinned ? 'rgba(76,175,80,0.4)' : 'rgba(255,255,255,0.1)'),
              fontSize: '14px',
              ...(isCommandChatPinned && theme === 'pro' ? {
                background: 'rgba(76,175,80,0.4)',
                border: '1px solid rgba(76,175,80,0.6)'
              } : {})
            }}
            title={isCommandChatPinned ? "Unpin Command Chat" : "Pin Command Chat"}
          >
            📌
        </button>
      </div>

        {/* Row 2: Watchdog (replaces ADMIN) or Master Tab label + 4 Admin Icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {masterTabId && masterTabId !== '01' ? (
            <div
              style={{
                fontSize: masterTabId ? '9px' : '11px',
                fontWeight: '700',
                opacity: 0.85,
                textTransform: 'uppercase',
                letterSpacing: masterTabId ? '0.4px' : '0.5px',
                width: '65px',
                textAlign: 'center',
                lineHeight: masterTabId ? '1.1' : 'normal',
                whiteSpace: masterTabId ? 'normal' : 'nowrap',
              }}
            >
              {`Master Tab (${masterTabId})`}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <WrMultiTriggerBar
                theme={theme}
                onWatchdogAlert={handleWatchdogAlert}
                onChatFocusRequest={(mode) => {
                  useChatFocusStore.getState().setChatFocusMode(mode)
                }}
                onEnsureWrChatOpen={ensureWrChatOpenThen}
              />
            </div>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={openUnifiedAdmin} title="Admin Configuration (Agents, Context, Memory)" style={adminIconStyle}>⚙️</button>
          <button onClick={openAddView} title="Add View" style={adminIconStyle}>⊞</button>
          <button onClick={openSessions} title="Sessions" style={adminIconStyle}>📚</button>
          <button onClick={openSettings} title="Settings" style={adminIconStyle}>🔧</button>
        </div>
      </div>

      {/* WR Login / Backend Switcher Section */}
      <BackendSwitcherInline 
        theme={theme} 
        onLogout={() => {
          // INSTANT: Update sidepanel auth state immediately when user clicks logout
          setIsLoggedIn(false);
          setAuthUserInfo({});
        }}
      />

      {/* Docked Command Chat - Admin View */}
      {isCommandChatPinned && (
        <>
          <div 
            data-section="admin-view"
            style={{
              borderBottom: '1px solid rgba(255,255,255,0.2)',
              background: theme === 'pro' ? 'rgba(118,75,162,0.4)' : 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.20)',
              margin: '12px 16px',
              borderRadius: '8px',
              overflow: 'hidden',
              position: 'relative',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
            onDragOver={(e) => { e.preventDefault(); setIsDraggingOverChat(true) }}
            onDragEnter={(e) => { e.preventDefault(); setIsDraggingOverChat(true) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingOverChat(false) }}
            onDrop={handleChatDrop}
          >
            {/* Drag-and-drop overlay */}
            {isDraggingOverChat && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 50,
                background: 'rgba(168,85,247,0.18)',
                border: '2px dashed #a855f7',
                borderRadius: '8px',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none'
              }}>
                <div style={{ fontSize: '28px', marginBottom: '6px' }}>📎</div>
                <div style={{ color: '#a855f7', fontWeight: 700, fontSize: '13px' }}>Drop file or image here</div>
                <div style={{ color: '#c084fc', fontSize: '11px', marginTop: '4px', opacity: 0.8 }}>Images, text files, documents</div>
              </div>
            )}
            {/* Header - Admin View - Enterprise Design */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px',
              background: theme === 'standard' ? 'linear-gradient(180deg, rgba(248,250,252,0.95) 0%, rgba(241,245,249,0.9) 100%)' : theme === 'dark' ? 'linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.9) 100%)' : 'linear-gradient(180deg, rgba(15,10,30,0.95) 0%, rgba(30,20,50,0.9) 100%)',
              borderBottom: theme === 'standard' ? '1px solid rgba(15,23,42,0.1)' : '1px solid rgba(168,85,247,0.3)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              color: themeColors.text
            }}>
              {/* Selectors */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                <select
                  key={`workspace-select-admin-${theme}`}
                  value={dockedWorkspace}
                  onChange={(e) => setDockedWorkspace(e.target.value as typeof dockedWorkspace)}
                  style={{
                    fontSize: '10px',
                    fontWeight: '600',
                    height: '22px',
                    width: '90px',
                    background: selectboxStyle.background,
                    border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(168,85,247,0.4)',
                    color: selectboxStyle.color,
                    borderRadius: '4px',
                    padding: '0 18px 0 6px',
                    cursor: 'pointer',
                    outline: 'none',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6' viewBox='0 0 12 12'%3E%3Cpath fill='${selectboxStyle.arrowColor}' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 4px center'
                  }}
                >
                  <option value="wr-chat">💬 WR Chat</option>
                  <option value="augmented-overlay">🎯 Augmented Overlay</option>
                  <option value="beap-messages">📦 BEAP Messages</option>
                  <option value="wrguard">🔒 WRGuard</option>
                </select>
                {dockedWorkspace === 'wr-chat' && (
                  <select
                    key={`submode-select-admin-${theme}`}
                    value={dockedSubmode}
                    onChange={(e) => setDockedSubmode(e.target.value as typeof dockedSubmode)}
                    style={{
                      fontSize: '11px',
                      fontWeight: '500',
                      height: '26px',
                      width: '75px',
                      background: selectboxStyle.background,
                      border: 'none',
                      color: selectboxStyle.color,
                      borderRadius: '13px',
                      padding: '0 18px 0 6px',
                      transition: 'all 0.15s ease',
                      cursor: 'pointer',
                      outline: 'none',
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6' viewBox='0 0 12 12'%3E%3Cpath fill='${selectboxStyle.arrowColor}' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 4px center'
                    }}
                  >
                    <option value="command">cmd</option>
                    <option value="p2p-chat">Direct Chat</option>
                    <option value="p2p-stream">Live Views</option>
                    <option value="group-stream">Group Sessions</option>
                    <option value="handshake">Handshake Request</option>
                  </select>
                )}
                {dockedWorkspace === 'beap-messages' && (
                  <select
                    key={`beap-submode-select-admin-${theme}`}
                    value={beapSubmode}
                    onChange={(e) => setBeapSubmode(e.target.value as typeof beapSubmode)}
                    style={{
                      fontSize: '11px',
                      fontWeight: '500',
                      height: '26px',
                      width: '90px',
                      background: selectboxStyle.background,
                      border: 'none',
                      color: selectboxStyle.color,
                      borderRadius: '13px',
                      padding: '0 18px 0 6px',
                      transition: 'all 0.15s ease',
                      cursor: 'pointer',
                      outline: 'none',
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6' viewBox='0 0 12 12'%3E%3Cpath fill='${selectboxStyle.arrowColor}' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 4px center'
                    }}
                  >
                    <option value="inbox">📥 Inbox</option>
                    <option value="bulk-inbox">⚡ Bulk Inbox</option>
                    <option value="draft">✏️ Draft</option>
                    <option value="outbox">📤 Outbox</option>
                    <option value="archived">📁 Archived</option>
                    <option value="rejected">🚫 Rejected</option>
                  </select>
                )}
              </div>
              {/* Divider */}
              <div style={{ width: '1px', height: '16px', background: theme === 'standard' ? 'rgba(15,23,42,0.15)' : 'rgba(168,85,247,0.3)', margin: '0 4px' }} />
              {/* Controls */}
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'nowrap', justifyContent: 'flex-end', minWidth: 0 }}>
                {(dockedPanelMode as string) !== 'admin' && dockedPanelMode !== 'beap-messages' && dockedPanelMode !== 'augmented-overlay' && dockedWorkspace !== 'wrguard' && <>
                  <WrChatCaptureButton
                    variant="compact"
                    theme={theme}
                    sidepanelPreset="appBar"
                    source="sidepanel-docked-chat"
                    createTrigger={createTriggerChecked}
                    addCommand={addCommandChecked}
                  />
                  <WrChatDiffButton
                    variant="compact"
                    theme={theme}
                    sidepanelPreset="appBar"
                    onDiffMessage={handleDiffMessage}
                    pinnedDiffIds={pinnedDiffIds}
                    onToggleDiffPin={handleToggleDiffPin}
                    onWatchersChange={setDiffWatchers}
                    openDialogRef={diffDialogOpenRef}
                  />
                  <button
                    type="button"
                    onClick={clearWrChat}
                    title="Clear chat"
                    style={{
                      ...chatControlButtonStyle(),
                      borderRadius: '6px',
                      padding: '0 5px',
                      height: '22px',
                      fontSize: '10px',
                      fontWeight: 500,
                      opacity: 0.55,
                      border: 'none',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      minWidth: 22,
                      ...(theme === 'standard' ? { color: '#0f172a' } : {}),
                    }}
                    onMouseEnter={(e) => {
                      if (theme === 'standard') {
                        e.currentTarget.style.background = '#eef3f6'
                        e.currentTarget.style.color = '#0f172a'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (theme === 'standard') {
                        e.currentTarget.style.background = '#ffffff'
                        e.currentTarget.style.color = '#0f172a'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                      }
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {/* Anchored triggers shown as icons on the top edge of the chat inner frame — not as chips here */}
                  <div style={{ position: 'relative' }}>
                    <button 
                      onClick={() => setShowTagsMenu(!showTagsMenu)}
                      title="Tags - Quick access to saved triggers"
                      style={{
                        ...chatControlButtonStyle(),
                        borderRadius: '6px',
                        padding: '0 10px',
                        height: '22px',
                        fontSize: '10px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        if (theme === 'standard') {
                          e.currentTarget.style.background = '#eef3f6'
                          e.currentTarget.style.color = '#0f172a'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (theme === 'standard') {
                          e.currentTarget.style.background = '#f8f9fb'
                          e.currentTarget.style.color = '#0f172a'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                        }
                      }}
                    >
                      {/* Tag / label icon */}
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="7" cy="7" r="1.5" fill="currentColor" />
                      </svg>
                      Tags{' '}
                      <span
                        style={{
                          fontSize: '11px',
                          opacity: 0.9,
                          color: theme === 'standard' ? '#0f172a' : undefined,
                        }}
                      >
                        ▾
                      </span>
                    </button>
                    
                    {/* Tags Dropdown Menu - Admin View */}
                    {showTagsMenu && (
                      <div 
                        style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          minWidth: '180px',
                          width: '240px',
                          maxHeight: '300px',
                          overflowY: 'auto',
                          zIndex: 2147483647,
                          background: '#111827',
                          color: 'white',
                          border: '1px solid rgba(255,255,255,0.20)',
                          borderRadius: '8px',
                          boxShadow: '0 10px 22px rgba(0,0,0,0.35)',
                          marginTop: '4px'
                        }}
                      >
                        {triggers.length === 0 ? (
                          <div style={{ padding: '8px 10px', fontSize: '12px', opacity: 0.8 }}>
                            No tags yet
                          </div>
                        ) : (
                          triggers.map((trigger, i) => renderTriggerRow(trigger, i, triggers.length))
                        )}
                      </div>
                    )}
                  </div>
                </>}
                <button 
                  onClick={toggleCommandChatPin}
                  title="Unpin from sidepanel"
                  style={{
                    ...chatControlButtonStyle(),
                    height: '22px',
                    minWidth: '22px',
                    borderRadius: '4px',
                    padding: '0 8px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  ↗
                </button>
              </div>
            </div>

            {/* SECTION 3 - Conditional Content based on mode */}
            {/* P2P Chat */}
            {dockedPanelMode === 'p2p-chat' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : 'rgba(255,255,255,0.06)', minHeight: '280px' }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.1)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6b7280' }} />
                    <span style={{ fontSize: '12px', opacity: 0.7 }}>No peer connected</span>
                  </div>
                  <button style={{ padding: '4px 10px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', cursor: 'pointer' }}>Connect</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}></div>
                <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <textarea placeholder="Message or capsule..." style={{ flex: 1, padding: '8px 10px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', resize: 'none', minHeight: '32px', maxHeight: '80px' }} />
                  <button title="Build Capsule" style={{ width: '32px', height: '32px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>💊</button>
                  <button title="AI Assistant" style={{ width: '32px', height: '32px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✨</button>
                  <button title="Attach" style={{ width: '32px', height: '32px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>
                  <button style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: 'none', borderRadius: '8px', color: 'white', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Send</button>
                </div>
              </div>
            )}

            {/* P2P Live */}
            {dockedPanelMode === 'p2p-stream' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#000', minHeight: '280px' }}>
                <div style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  <div style={{ textAlign: 'center', color: '#666' }}>
                    <div style={{ fontSize: '40px', marginBottom: '8px' }}>📹</div>
                    <div style={{ fontSize: '12px' }}>No active stream</div>
                  </div>
                  <div style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '6px' }}>
                    <button style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>🎥 Start</button>
                    <button style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>🎙️ Mute</button>
                    <button style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>📺 Share</button>
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '120px', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : 'rgba(255,255,255,0.06)' }}>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}></div>
                  <div style={{ padding: '8px', display: 'flex', gap: '6px', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <textarea placeholder="Chat..." style={{ flex: 1, padding: '6px 8px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', resize: 'none', minHeight: '28px' }} />
                    <button title="AI Assistant" style={{ width: '28px', height: '28px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', cursor: 'pointer' }}>✨</button>
                    <button style={{ padding: '6px 12px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Send</button>
                  </div>
                </div>
              </div>
            )}

            {/* Group */}
            {dockedPanelMode === 'group-stream' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#000', minHeight: '280px' }}>
                <div style={{ flex: 2, display: 'flex' }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #333' }}>
                    <div style={{ textAlign: 'center', color: '#666' }}>
                      <div style={{ fontSize: '32px' }}>👤</div>
                      <div style={{ fontSize: '10px', marginTop: '4px' }}>Host</div>
                    </div>
                  </div>
                  <div style={{ width: '70px', display: 'flex', flexDirection: 'column', gap: '2px', padding: '4px', overflowY: 'auto' }}>
                    <div style={{ aspectRatio: '1', background: '#111', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: '14px' }}>👤</div>
                    <div style={{ aspectRatio: '1', background: '#111', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: '14px' }}>+</div>
                  </div>
                </div>
                <div style={{ padding: '6px 10px', borderTop: '1px solid rgba(255,255,255,0.15)', borderBottom: '1px solid rgba(255,255,255,0.15)', display: 'flex', gap: '6px', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
                  <button style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '4px', color: 'white', fontSize: '12px', cursor: 'pointer' }}>🎥</button>
                  <button style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '4px', color: 'white', fontSize: '12px', cursor: 'pointer' }}>🎙️</button>
                  <button style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '4px', color: 'white', fontSize: '12px', cursor: 'pointer' }}>📺</button>
                  <button style={{ padding: '4px 8px', background: 'rgba(239,68,68,0.2)', border: 'none', borderRadius: '4px', color: '#ef4444', fontSize: '10px', cursor: 'pointer' }}>Leave</button>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100px', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : 'rgba(255,255,255,0.06)' }}>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}></div>
                  <div style={{ padding: '8px', display: 'flex', gap: '6px', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <textarea placeholder="Group chat..." style={{ flex: 1, padding: '6px 8px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', resize: 'none', minHeight: '28px' }} />
                    <button title="AI Assistant" style={{ width: '28px', height: '28px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #94a3b8' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', cursor: 'pointer' }}>✨</button>
                    <button style={{ padding: '6px 12px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Send</button>
                  </div>
                </div>
              </div>
            )}

            {/* BEAP Handshake Request — Send Handshake Delivery */}
            {dockedPanelMode === 'handshake' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : (theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.06)'), minHeight: '280px', overflowY: 'auto' }}>
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
                        <input type="radio" name="hs-policy-docked" checked={active} onChange={() => setHsPolicy({ ai_processing_mode: val })} style={{ marginTop: '3px', accentColor: '#8b5cf6' }} />
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
            )}

            {(dockedPanelMode === 'command' || dockedPanelMode === 'augmented-overlay') && (
              <>
                {/* Messages Area */}
                <div 
                  id="ccd-messages-sidepanel"
                  ref={chatRef}
                  style={{
                    height: `${chatHeight}px`,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : 'rgba(255,255,255,0.06)',
                    borderBottom: '1px solid rgba(255,255,255,0.20)',
                    padding: '14px',
                    position: 'relative',
                    paddingTop: (anchoredTriggerKeys.length > 0 || pinnedDiffIds.length > 0) ? 40 : 14,
                  }}
                >
                  {/* Top-edge pinned icon strip */}
                  {(anchoredTriggerKeys.length > 0 || pinnedDiffIds.length > 0) && (
                    <div role="toolbar" aria-label="Pinned shortcuts" style={{ position: 'absolute', top: 4, left: 8, right: 8, display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', gap: 6, zIndex: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
                      {triggers.filter((t) => anchoredTriggerKeys.includes(triggerAnchorKey(t))).map((trigger) => {
                        const key = triggerAnchorKey(trigger)
                        return (
                          <span key={key} role="button" tabIndex={0} title={`Run: ${String(trigger.name || trigger.command || 'Trigger').slice(0, 80)}`}
                            onClick={() => { try { handleTriggerClick(trigger) } catch { /* noop */ } }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); try { handleTriggerClick(trigger) } catch { /* noop */ } } }}
                            style={{ fontSize: 18, lineHeight: 1, cursor: 'pointer', userSelect: 'none', flexShrink: 0, transition: 'transform 0.12s', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1.3)' }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1)' }}
                          >{spEmojiForKey(key)}</span>
                        )
                      })}
                      {diffWatchers.filter((w) => pinnedDiffIds.includes(w?.id ?? '')).map((watcher) => {
                        const runDiffNow = () => {
                          const watcherId = watcher.id as string
                          if (!watcherId) return
                          new Promise<string | null>((resolve) => {
                            try {
                              chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string | null } | undefined) => {
                                if (chrome.runtime.lastError) resolve(null); else resolve(resp?.secret?.trim() ? resp.secret : null)
                              })
                            } catch { resolve(null) }
                          }).then((secret) =>
                            fetch(`http://127.0.0.1:51248/api/wrchat/diff-watchers/${encodeURIComponent(watcherId)}/run`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' },
                              signal: AbortSignal.timeout(15000),
                            }).catch((err) => console.warn('[WRChat] diff runNow failed:', err))
                          ).catch(() => { /* noop */ })
                        }
                        return (
                        <span key={`diff:${watcher.id}`} role="button" tabIndex={0} title={`Diff: ${String(watcher.name || watcher.tag || 'Diff').slice(0, 80)} — click to run diff now`}
                          onClick={() => { runDiffNow() }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); runDiffNow() } }}
                          style={{ fontSize: 18, lineHeight: 1, cursor: 'pointer', userSelect: 'none', flexShrink: 0, transition: 'transform 0.12s', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1.3)' }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1)' }}
                        >{spEmojiForKey(`diff:${watcher.id ?? watcher.name ?? ''}`)}</span>
                        )})}
                    </div>
                  )}
                  {chatMessages.length === 0 ? (
                    <div style={{ fontSize: '13px', opacity: dockedPanelMode === 'augmented-overlay' ? 0.8 : 0.6, textAlign: 'center', padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                      {dockedPanelMode === 'augmented-overlay' ? (
                        <>
                          <span style={{ fontSize: '24px' }}>🎯</span>
                          <span>Point with the cursor or select elements in order to ask questions or trigger automations directly in the UI.</span>
                        </>
                      ) : (
                        'Start a conversation...'
                      )}
                    </div>
                  ) : (
                    chatMessages.map((msg: any, i) => (
                      <div 
                        key={i} 
                        style={{
                          display: 'flex',
                          justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
                        }}
                      >
                        <div style={{
                          maxWidth: msg.imageUrl ? '100%' : '85%',
                          width: msg.imageUrl ? '100%' : undefined,
                          padding: msg.imageUrl ? 0 : '10px 14px',
                          borderRadius: '12px',
                          fontSize: '13px',
                          lineHeight: '1.5',
                          wordBreak: 'break-word',
                          overflowWrap: 'anywhere',
                          overflow: 'hidden',
                          background: msg.imageUrl ? 'transparent' : (msg.role === 'user' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.12)'),
                          border: msg.imageUrl ? 'none' : (msg.role === 'user' ? '1px solid rgba(34,197,94,0.5)' : '1px solid rgba(255,255,255,0.25)')
                        }}>
                          {msg.imageUrl && (
                            <img src={msg.imageUrl} alt="screenshot" style={{ width: '100%', maxWidth: '100%', borderRadius: 8, display: 'block' }} />
                          )}
                          {msg.text ? (
                            <div style={{ marginTop: msg.imageUrl ? 4 : 0, padding: msg.imageUrl ? '4px 8px' : 0, fontSize: msg.imageUrl ? '11px' : '13px', opacity: msg.imageUrl ? 0.75 : 1, whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Resize Handle */}
                <div 
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setIsResizingChat(true)
                  }}
                  style={{
                    height: '4px',
                    background: 'rgba(255,255,255,0.15)',
                    cursor: 'ns-resize',
                    borderTop: '1px solid rgba(255,255,255,0.10)',
                    borderBottom: '1px solid rgba(255,255,255,0.10)'
                  }}
                />

                {/* Pending document indicator */}
                {pendingDocContent && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '6px 14px',
                    background: 'rgba(168,85,247,0.1)',
                    borderTop: '1px solid rgba(168,85,247,0.2)',
                    fontSize: '11px', color: '#a855f7'
                  }}>
                    <span>📄</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <strong>{pendingDocContent.name}</strong> attached — type your question and Send
                    </span>
                    <button
                      onClick={() => setPendingDocContent(null)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a855f7', fontSize: '14px', padding: 0, lineHeight: 1 }}
                      title="Remove attachment"
                    >✕</button>
                  </div>
                )}

                {/* Compose Area */}
                <div 
                  id="ccd-compose-sidepanel"
                  style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '8px 10px'
                }}>
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={handleChatKeyDown}
                    placeholder={searchBarContext || 'Type your message...'}
                    style={{
                      flex: 1,
                      boxSizing: 'border-box',
                      height: '40px',
                      minHeight: '40px',
                      resize: 'vertical',
                      background: theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.08)',
                      border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.20)',
                      color: theme === 'standard' ? '#0f172a' : 'white',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      fontSize: '13px',
                      fontFamily: 'inherit',
                      lineHeight: '1.5'
                    }}
                  />
                <input
                    ref={fileInputRef}
                    type="file" 
                    multiple 
                    style={{ display: 'none' }} 
                    onChange={handleFileChange}
                  />
                  <button 
                    onClick={handleBucketClick}
                    title="Attach" 
                    style={{
                      flexShrink: 0,
                      width: '28px',
                      height: '28px',
                      background: 'transparent',
                      border: 'none',
                      color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'color 0.15s ease'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = theme === 'standard' ? '#0f172a' : 'white')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  </button>
                  {renderSendButton()}
                </div>
              </>
            )}

            {dockedWorkspace === 'beap-messages' && (
              /* BEAP Messages Workspace - Section 3 (Admin View) */
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: theme === 'pro' ? 'rgba(118,75,162,0.15)' : (theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.04)'), overflowY: 'auto' }}>
                <style>{`
                  .beap-input::placeholder, .beap-textarea::placeholder {
                    color: ${theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.5)'};
                    opacity: 1;
                  }
                `}</style>
                
                {/* Placeholder views for non-draft submodes */}
                {beapSubmode === 'inbox' && (
                  <InboxErrorBoundary componentName="BeapInboxView" theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}>
                  <BeapInboxView
                    ref={inboxViewRef}
                    theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                    onNavigateToDraft={() => setBeapSubmode('draft')}
                    onNavigateToWRGuard={() => setDockedWorkspace('wrguard')}
                    onNavigateToHandshake={(handshakeId) => {
                      setDockedWorkspace('wrguard')
                      useWRGuardStore.getState().setActiveSection('handshakes')
                      useWRGuardStore.getState().setSelectedHandshakeId(handshakeId)
                    }}
                    onNavigateToHandshakesTab={() => {
                      setDockedWorkspace('wrguard')
                      useWRGuardStore.getState().setActiveSection('handshakes')
                    }}
                    onSetSearchContext={setSearchBarContext}
                    onAttachmentSelect={(_mid, attachmentId) => {
                      beapInboxSelectedAttachmentIdRef.current = attachmentId
                    }}
                    onAiQuery={(query, messageId, attachmentId) => {
                      if (attachmentId != null) beapInboxSelectedAttachmentIdRef.current = attachmentId
                      pendingInboxAiRef.current = {
                        messageId,
                        query,
                        ...(attachmentId != null ? { attachmentId } : {}),
                      }
                      inboxViewRef.current?.startGenerating()
                      setChatInput(query)
                      handleSendMessage()
                    }}
                    replyComposerConfig={replyComposerConfig}
                  />
                  </InboxErrorBoundary>
                )}
                {beapSubmode === 'outbox' && (
                  <BeapMessageListView
                    folder="outbox"
                    theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                    onNavigateToDraft={() => setBeapSubmode('draft')}
                  />
                )}
                {beapSubmode === 'archived' && (
                  <BeapMessageListView
                    folder="archived"
                    theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                    onNavigateToDraft={() => setBeapSubmode('draft')}
                  />
                )}
                {beapSubmode === 'rejected' && (
                  <BeapMessageListView
                    folder="rejected"
                    theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                    onNavigateToDraft={() => setBeapSubmode('draft')}
                  />
                )}
                {beapSubmode === 'bulk-inbox' && (
                  <InboxErrorBoundary componentName="BeapBulkInbox" theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}>
                    <BeapBulkInbox
                      ref={bulkInboxRef}
                      theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}
                      onSetSearchContext={setSearchBarContext}
                      onAiQuery={(query, messageId) => {
                        pendingInboxAiRef.current = { messageId, query, isBulk: true }
                        bulkInboxRef.current?.startGenerating(messageId)
                        setChatInput(query)
                        handleSendMessage()
                      }}
                      onViewHandshake={(handshakeId) => {
                        setDockedWorkspace('wrguard')
                        useWRGuardStore.getState().setActiveSection('handshakes')
                        useWRGuardStore.getState().setSelectedHandshakeId(handshakeId)
                      }}
                      onViewInInbox={(messageId) => {
                        setBeapSubmode('inbox')
                        useBeapInboxStore.getState().selectMessage(messageId)
                      }}
                      replyComposerConfig={replyComposerConfig}
                      onClassificationComplete={(count) => showNotification(`Analysis complete — ${count} message${count === 1 ? '' : 's'} classified`)}
                      onArchiveComplete={(count) => showNotification(`Archived ${count} message${count === 1 ? '' : 's'}`)}
                    />
                  </InboxErrorBoundary>
                )}
                
                {/* Draft view */}
                {beapSubmode === 'draft' && (
                  <InboxErrorBoundary componentName="BeapBuilder" theme={theme === 'pro' ? 'default' : theme === 'standard' ? 'professional' : 'dark'}>
                  <>
                {/* DELIVERY METHOD - FIRST */}
                <div style={{ padding: '14px 18px', borderBottom: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Delivery Method</label>
                  <select value={handshakeDelivery} onChange={(e) => setHandshakeDelivery(e.target.value as 'email' | 'download' | 'p2p')} style={{ width: '100%', padding: '10px 12px', background: theme === 'standard' ? 'white' : '#1f2937', border: `1px solid ${theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.15)'}`, borderRadius: '8px', color: theme === 'standard' ? '#1f2937' : 'white', fontSize: '13px', cursor: 'pointer' }}>
                    <option value="email" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>📧 Email</option>
                    <option value="p2p" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>🔗 P2P</option>
                    <option value="download" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>💾 Download (USB/Wallet)</option>
                  </select>
                </div>
                
                {/* EMAIL ACCOUNTS SECTION - Only visible when email delivery selected */}
                {handshakeDelivery === 'email' && (
                <div style={{ 
                  padding: '16px 18px', 
                  borderBottom: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)',
                  background: theme === 'standard' ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px' }}>🔗</span>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Connected Email Accounts</span>
                    </div>
                    <button
                      onClick={() => openConnectEmail(ConnectEmailLaunchSource.WrChatDocked)}
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

                  {emailAccountsFetchErrorEl}
                  
                  {isLoadingEmailAccounts ? (
                    <div style={{ padding: '12px', textAlign: 'center', opacity: 0.6, fontSize: '12px' }}>
                      Loading accounts...
                    </div>
                  ) : emailAccounts.length === 0 ? (
                    <div style={{ 
                      padding: '20px', 
                      background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.05)',
                      borderRadius: '8px',
                      border: theme === 'standard' ? '1px dashed #94a3b8' : '1px dashed rgba(255,255,255,0.2)',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
                      <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>
                        {emailAccountsLoadError?.trim()
                          ? 'No accounts loaded (see message above).'
                          : 'No email accounts connected'}
                      </div>
                      <div style={{ fontSize: '11px', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.5)' }}>
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
                            background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)',
                            borderRadius: '8px',
                            border: account.status === 'active' 
                              ? (theme === 'standard' ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(34,197,94,0.4)')
                              : (theme === 'standard' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(239,68,68,0.4)')
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '18px' }}>
                              {account.provider === 'gmail' ? '📧' : account.provider === 'microsoft365' ? '📨' : account.provider === 'zoho' ? '📬' : '✉️'}
                            </span>
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: '500', color: theme === 'standard' ? '#0f172a' : 'white' }}>
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
                                <span style={{ color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>
                                  {account.status === 'active' ? 'Connected' : account.lastError || 'Error'}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => disconnectEmailAccount(account.id)}
                            title="Disconnect account"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.5)',
                              cursor: 'pointer',
                              padding: '4px',
                              fontSize: '14px'
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Select account for sending */}
                  {emailAccounts.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Send From:</label>
                      <select value={selectedEmailAccountId || defaultEmailAccountRowId || ''} onChange={(e) => setSelectedEmailAccountId(e.target.value)} style={{ width: '100%', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.1)', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#0f172a' : 'white', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer', outline: 'none' }}>
                        {emailAccounts.map(account => (<option key={account.id} value={account.id}>{account.email || account.displayName} ({account.provider})</option>))}
                      </select>
                    </div>
                  )}
                </div>
                )}
                
                {/* BEAP™ Message UI - Admin View */}
                <div style={{ padding: '12px 14px', borderBottom: `1px solid ${theme === 'standard' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>📦</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#1f2937' : 'white' }}>BEAP™ Message (required)</span>
                </div>
                <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Fingerprint */}
                  <div style={{ background: theme === 'standard' ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.15)', border: theme === 'standard' ? '1px solid rgba(59,130,246,0.2)' : '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', padding: '12px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: theme === 'standard' ? '#3b82f6' : '#93c5fd', marginBottom: '6px' }}>Your Fingerprint</div>
                    <code style={{ fontSize: '13px', fontFamily: 'monospace', color: theme === 'standard' ? '#1e40af' : '#bfdbfe' }}>{ourFingerprintShort}</code>
                  </div>
                  {/* Recipient Mode Switch */}
                  <RecipientModeSwitch mode={beapRecipientMode} onModeChange={setBeapRecipientMode} theme={theme} />
                  {/* Handshake Select (PRIVATE mode only) */}
                  {beapRecipientMode === 'private' && (
                    <RecipientHandshakeSelect
                      handshakes={handshakes}
                      selectedHandshakeId={selectedRecipient?.handshake_id || null}
                      onSelect={setSelectedRecipient}
                      theme={theme}
                      isLoading={handshakesLoading}
                      fetchError={handshakesError}
                      onRetry={refreshHandshakes}
                    />
                  )}
                  {/* Delivery Method Panel - Adapts to recipient mode */}
                  <DeliveryMethodPanel deliveryMethod={handshakeDelivery} recipientMode={beapRecipientMode} selectedRecipient={selectedRecipient} emailTo={beapDraftTo} onEmailToChange={setBeapDraftTo} theme={theme} ourFingerprintShort={ourFingerprintShort} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>BEAP™ Message (required)</label>
                    <textarea className="beap-textarea" value={beapDraftMessage} onChange={(e) => setBeapDraftMessage(e.target.value)} placeholder="Public capsule text — required before send. This is the transport-visible message body." style={{ flex: 1, minHeight: '120px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.15)', color: theme === 'standard' ? '#0f172a' : 'white', borderRadius: '6px', padding: '10px 12px', fontSize: '12px', lineHeight: '1.5', resize: 'none', outline: 'none', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }} />
                  </div>
                  {/* Encrypted Message (qBEAP/PRIVATE only) */}
                  {beapRecipientMode === 'private' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#7c3aed' : '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.5px' }}>🔐 Encrypted Message (Private · qBEAP)</label>
                      <textarea className="beap-textarea" value={beapDraftEncryptedMessage} onChange={(e) => setBeapDraftEncryptedMessage(e.target.value)} placeholder="This message is encrypted, capsule-bound, and never transported outside the BEAP package." style={{ flex: 1, minHeight: '100px', background: theme === 'standard' ? 'rgba(139,92,246,0.05)' : 'rgba(139,92,246,0.15)', border: theme === 'standard' ? '1px solid rgba(139,92,246,0.3)' : '1px solid rgba(139,92,246,0.4)', color: theme === 'standard' ? '#0f172a' : 'white', borderRadius: '6px', padding: '10px 12px', fontSize: '12px', lineHeight: '1.5', resize: 'none', outline: 'none', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }} />
                      <div style={{ fontSize: '10px', color: theme === 'standard' ? '#7c3aed' : '#c4b5fd', marginTop: '4px' }}>⚠️ This content is authoritative when present and never leaves the encrypted capsule.</div>
                    </div>
                  )}
                  {/* Advanced: Session + Attachments (Fullscreen) */}
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '8px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Advanced (Optional)</div>
                    <div style={{ marginBottom: '10px' }}>
                      <label style={{ fontSize: '10px', fontWeight: 500, marginBottom: '4px', display: 'block', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>Session (optional)</label>
                      <select value={beapDraftSessionId} onChange={(e) => setBeapDraftSessionId(e.target.value)} onClick={() => loadAvailableSessions()} style={{ width: '100%', background: theme === 'standard' ? '#ffffff' : '#1e293b', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.25)', color: theme === 'standard' ? '#0f172a' : '#f1f5f9', borderRadius: '6px', padding: '8px 10px', fontSize: '12px', outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}>
                        <option value="" style={{ background: theme === 'standard' ? '#ffffff' : '#1e293b', color: theme === 'standard' ? '#0f172a' : '#f1f5f9' }}>{availableSessions.length === 0 ? '— No sessions available —' : '— Select a session —'}</option>
                        {availableSessions.map((s) => (<option key={s.key} value={s.key} style={{ background: theme === 'standard' ? '#ffffff' : '#1e293b', color: theme === 'standard' ? '#0f172a' : '#f1f5f9' }}>{s.name} ({new Date(s.timestamp).toLocaleDateString()})</option>))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', fontWeight: 500, marginBottom: '4px', display: 'block', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>Attachments (PDFs: text extracts automatically)</label>
                      <input type="file" multiple onChange={async (e) => { const files = Array.from(e.target.files ?? []); if (!files.length) return; const tooBig = files.filter((f) => f.size > MAX_BEAP_DRAFT_ATTACHMENT_BYTES); if (tooBig.length) { setNotification(beapUiValidationFailure(formatOversizeAttachmentRejection(tooBig.map((f) => f.name)))); setTimeout(() => setNotification(null), 10000); } const okFiles = files.filter((f) => f.size <= MAX_BEAP_DRAFT_ATTACHMENT_BYTES); const newItems: DraftAttachment[] = []; for (const file of okFiles) { if (beapDraftAttachments.length + newItems.length >= 20) { console.warn('[BEAP] Max 20 attachments reached'); break } const dataBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const res = String(reader.result ?? ''); resolve(res.includes(',') ? res.split(',')[1] : res) }; reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) }); const attachmentId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; const mimeType = file.type || 'application/octet-stream'; const isPdfFile = mimeType.toLowerCase() === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'); const capsuleAttachment: CapsuleAttachment = { id: attachmentId, originalName: file.name, originalSize: file.size, originalType: mimeType, semanticContent: null, semanticExtracted: false, encryptedRef: `encrypted_${attachmentId}`, encryptedHash: '', previewRef: null, rasterProof: null, isMedia: mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/'), hasTranscript: false }; newItems.push({ id: attachmentId, name: file.name, mime: mimeType, size: file.size, dataBase64, capsuleAttachment, processing: { parsing: isPdfFile, rasterizing: false } }) } setBeapDraftAttachments((prev) => [...prev, ...newItems]); for (const item of newItems) { const isPdfItem = item.mime?.toLowerCase() === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf'); if (!isPdfItem || !item.dataBase64) continue; void runDraftAttachmentParseWithFallback({ id: item.id, dataBase64: item.dataBase64, capsuleAttachment: item.capsuleAttachment }).then((upd) => { setBeapDraftAttachments((prev) => prev.map((x) => (x.id === item.id ? { ...x, capsuleAttachment: upd.capsuleAttachment, processing: upd.processing } : x))) }).catch((err) => { const u = draftAttachmentParseRejectedUpdate({ id: item.id, dataBase64: item.dataBase64, capsuleAttachment: item.capsuleAttachment }, err); setBeapDraftAttachments((prev) => prev.map((x) => (x.id === item.id ? { ...x, capsuleAttachment: u.capsuleAttachment, processing: u.processing } : x))) }) } e.currentTarget.value = '' }} style={{ fontSize: '11px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)' }} />
                      {beapDraftAttachments.length > 0 && (
                        <div style={{ marginTop: '8px' }}>
                          {beapDraftAttachments.map((a) => {
                              const isPdf = a.mime?.toLowerCase() === 'application/pdf' || a.name.toLowerCase().endsWith('.pdf')
                              const isParsing = !!a.processing?.parsing
                              const isSuccess = !!a.capsuleAttachment?.semanticExtracted
                              const showPdfBadge = isPdf && (isParsing || isSuccess || !!a.processing?.error)
                              const parseStatus: 'pending' | 'success' | 'failed' = isParsing ? 'pending' : isSuccess ? 'success' : 'failed'
                              return (
                              <div key={a.id} style={{ background: theme === 'standard' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)', borderRadius: '4px', marginBottom: '4px', overflow: 'hidden' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                                    <span style={{ fontSize: '14px' }}>📄</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: '11px', color: theme === 'standard' ? '#0f172a' : 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                                      <div style={{ fontSize: '9px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.5)' }}>
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
                                          border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.2)',
                                          color: theme === 'standard' ? '#475569' : 'rgba(255,255,255,0.75)',
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
                                          })
                                            .then((upd) => {
                                              setBeapDraftAttachments((prev) =>
                                                prev.map((x) =>
                                                  x.id === a.id
                                                    ? { ...x, capsuleAttachment: upd.capsuleAttachment, processing: upd.processing }
                                                    : x,
                                                ),
                                              )
                                            })
                                            .catch((err) => {
                                              const u = draftAttachmentParseRejectedUpdate(
                                                {
                                                  id: a.id,
                                                  dataBase64: a.dataBase64!,
                                                  capsuleAttachment: a.capsuleAttachment,
                                                },
                                                err,
                                              )
                                              setBeapDraftAttachments((prev) =>
                                                prev.map((x) =>
                                                  x.id === a.id
                                                    ? { ...x, capsuleAttachment: u.capsuleAttachment, processing: u.processing }
                                                    : x,
                                                ),
                                              )
                                            })
                                        }}
                                        style={{
                                          background: theme === 'standard' ? 'rgba(139,92,246,0.12)' : 'rgba(139,92,246,0.25)',
                                          border: `1px solid ${theme === 'standard' ? 'rgba(139,92,246,0.35)' : 'rgba(192,132,252,0.4)'}`,
                                          color: theme === 'standard' ? '#6d28d9' : '#e9d5ff',
                                          borderRadius: '4px',
                                          padding: '2px 8px',
                                          fontSize: '10px',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        Retry
                                      </button>
                                    )}
                                    <button onClick={() => { setBeapDraftReaderModalId((id) => (id === a.id ? null : id)); setBeapDraftAttachments((prev) => prev.filter((x) => x.id !== a.id)) }} style={{ background: 'transparent', border: 'none', color: theme === 'standard' ? '#ef4444' : '#f87171', fontSize: '10px', cursor: 'pointer' }}>Remove</button>
                                    {showPdfBadge && <AttachmentStatusBadge status={parseStatus} theme={theme === 'standard' ? 'standard' : 'dark'} />}
                                  </div>
                                </div>
                                {a.processing?.error && !isParsing && (
                                  <div style={{ padding: '6px 8px', borderTop: `1px solid ${theme === 'standard' ? 'rgba(251,191,36,0.2)' : 'rgba(251,191,36,0.25)'}`, background: theme === 'standard' ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.12)', fontSize: '10px', color: theme === 'standard' ? '#b45309' : '#fbbf24' }}>
                                    {a.processing.error.includes('connect') || a.processing.error.includes('Failed to connect')
                                      ? 'Desktop parser (port 51248) can improve extraction. Add an API key in settings for AI extraction.'
                                      : a.processing.error}
                                  </div>
                                )}
                              </div>
                            )})}
                          <button onClick={() => { setBeapDraftReaderModalId(null); setBeapDraftAttachments([]) }} style={{ background: 'transparent', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer', marginTop: '4px' }}>Clear all</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {beapP2pRelayPendingMessage && (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderTop: theme === 'standard' ? '1px solid rgba(234, 179, 8, 0.35)' : '1px solid rgba(250, 204, 21, 0.3)',
                      background: theme === 'standard' ? 'rgba(234, 179, 8, 0.1)' : 'rgba(234, 179, 8, 0.12)',
                      fontSize: '12px',
                      color: theme === 'standard' ? '#a16207' : '#fde68a',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '10px',
                    }}
                  >
                    <span>{beapP2pRelayPendingMessage}</span>
                    <button
                      type="button"
                      onClick={() => setBeapP2pRelayPendingMessage(null)}
                      style={{
                        background: 'transparent',
                        border: theme === 'standard' ? '1px solid rgba(161, 98, 7, 0.35)' : '1px solid rgba(253, 230, 138, 0.4)',
                        color: 'inherit',
                        borderRadius: '4px',
                        padding: '2px 8px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                <div style={{ padding: '12px 14px', borderTop: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'flex-end', gap: '8px', background: theme === 'standard' ? '#ffffff' : 'rgba(0,0,0,0.2)' }}>
                  <button onClick={() => { setBeapP2pRelayPendingMessage(null); setBeapDraftTo(''); setBeapDraftMessage(''); setBeapDraftEncryptedMessage(''); setBeapDraftSessionId(''); setBeapDraftReaderModalId(null); setBeapDraftAttachments([]); setSelectedRecipient(null) }} style={{ background: 'transparent', border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#536471' : 'rgba(255,255,255,0.7)', borderRadius: '6px', padding: '8px 16px', fontSize: '12px', cursor: 'pointer' }}>Clear</button>
                  <button onClick={handleSendBeapMessage} disabled={isBeapSendDisabled} style={{ background: isBeapSendDisabled ? 'rgba(168,85,247,0.5)' : 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)', border: 'none', color: 'white', borderRadius: '6px', padding: '8px 20px', fontSize: '12px', fontWeight: 600, cursor: isBeapSendDisabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: isBeapSendDisabled ? 0.7 : 1 }}>{getBeapSendButtonLabel()}</button>
                </div>
                  </>
                  </InboxErrorBoundary>
                )}
              </div>
            )}

            {dockedWorkspace === 'wrguard' && (
              /* WRGuard Workspace - Section 3 (Admin View) */
              <WRGuardWorkspace 
                theme={theme}
                emailAccounts={emailAccounts}
                isLoadingEmailAccounts={isLoadingEmailAccounts}
                selectedEmailAccountId={selectedEmailAccountId}
                onConnectEmail={() => openConnectEmail(ConnectEmailLaunchSource.WrChatDocked)}
                onDisconnectEmail={disconnectEmailAccount}
                onSetProcessingPaused={setAccountProcessingPaused}
                onSelectEmailAccount={setSelectedEmailAccountId}
                onViewInInbox={(messageId) => {
                  setDockedWorkspace('beap-messages')
                  setBeapSubmode('inbox')
                  useBeapInboxStore.getState().selectMessage(messageId)
                }}
                replyComposerConfig={replyComposerConfig}
              />
            )}

            {/* Trigger Creation UI */}
            {showTriggerPrompt && (
              <div style={{
                padding: '12px 14px',
                background: theme === 'standard' ? '#f8fafc' : 'rgba(0,0,0,0.35)',
                borderTop: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.20)'
              }}>
                <style>{`
                  .wr-capture-field::placeholder { color: rgba(150,150,150,0.7); }
                `}</style>
                <div style={{
                  marginBottom: '8px',
                  fontSize: '12px',
                  fontWeight: '700',
                  color: theme === 'standard' ? '#0f172a' : 'rgba(255,255,255,0.70)',
                  opacity: 1
                }}>
                  {showTriggerPrompt.mode === 'screenshot' ? '📸 Screenshot' : '🎥 Stream'}
                </div>
                {showTriggerPrompt.createTrigger && (
                  <>
                    <label
                      htmlFor="wr-capture-trigger-name-docked2"
                      style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: 4, color: theme === 'standard' ? '#475569' : 'rgba(255,255,255,0.70)' }}
                    >
                      Trigger Name
                    </label>
                    <input
                      id="wr-capture-trigger-name-docked2"
                      type="text"
                      className="wr-capture-field"
                      placeholder="Trigger Name"
                      value={showTriggerPrompt.name || ''}
                      onChange={(e) => setShowTriggerPrompt({ ...showTriggerPrompt, name: e.target.value })}
                      onFocus={(e) => {
                        e.currentTarget.style.border = theme === 'standard' ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.80)'
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.border = theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.45)'
                      }}
                      style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      background: theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.12)',
                      border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.45)',
                      color: theme === 'standard' ? '#0f172a' : '#f8fafc',
                      borderRadius: '6px',
                      fontSize: '12px',
                      marginBottom: '8px'
                    }}
                    />
                  </>
                )}
                {showTriggerPrompt.addCommand && (
                  <>
                    <label
                      htmlFor="wr-capture-optional-command-docked2"
                      style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: 4, color: theme === 'standard' ? '#475569' : 'rgba(255,255,255,0.70)' }}
                    >
                      Optional Command
                    </label>
                    <textarea
                      id="wr-capture-optional-command-docked2"
                      className="wr-capture-field"
                      placeholder="Optional Command"
                      value={showTriggerPrompt.command || ''}
                      onChange={(e) => setShowTriggerPrompt({ ...showTriggerPrompt, command: e.target.value })}
                      onFocus={(e) => {
                        e.currentTarget.style.border = theme === 'standard' ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.80)'
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.border = theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.45)'
                      }}
                      style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      background: theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.12)',
                      border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.45)',
                      color: theme === 'standard' ? '#0f172a' : '#f8fafc',
                      borderRadius: '6px',
                      fontSize: '12px',
                      minHeight: '60px',
                      marginBottom: '8px',
                      resize: 'vertical',
                      fontFamily: 'inherit'
                    }}
                    />
                  </>
                )}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShowTriggerPrompt(null)}
                    style={{
                      padding: '6px 12px',
                      background: theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.15)',
                      border: theme === 'standard' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.25)',
                      color: theme === 'standard' ? '#0f172a' : 'white',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      const snap = showTriggerPrompt
                      if (!snap) return
                      const name = snap.name?.trim() || ''
                      const command = snap.command?.trim() || ''

                      if (snap.createTrigger) {
                        if (!name) {
                          alert('Please enter a trigger name')
                          return
                        }

                        const triggerData = {
                          name,
                          command,
                          at: Date.now(),
                          rect: snap.rect,
                          bounds: snap.bounds,
                          mode: snap.mode,
                          ...(typeof snap.displayId === 'number' && snap.displayId > 0 ? { displayId: snap.displayId } : {}),
                        }

                        chrome.storage.local.get(['optimando-tagged-triggers'], (result) => {
                          const triggers = result['optimando-tagged-triggers'] || []
                          triggers.push(triggerData)
                          chrome.storage.local.set({ 'optimando-tagged-triggers': triggers }, () => {
                            setTriggers(triggers)
                            try { chrome.runtime?.sendMessage({ type: 'TRIGGERS_UPDATED' }) } catch {}
                            try { window.dispatchEvent(new CustomEvent('optimando-triggers-updated')) } catch {}
                          })
                        })

                        try {
                          chrome.runtime?.sendMessage({
                            type: 'ELECTRON_SAVE_TRIGGER',
                            name,
                            mode: snap.mode,
                            rect: snap.rect,
                            displayId: typeof snap.displayId === 'number' && snap.displayId > 0 ? snap.displayId : undefined,
                            imageUrl: snap.imageUrl,
                            videoUrl: snap.videoUrl,
                            command: command || undefined,
                          })
                        } catch (err) {
                          console.error('Error sending trigger to Electron:', err)
                        }
                      }

                      const triggerNameToUse = name || command
                      const shouldAutoProcess = snap.addCommand || (snap.createTrigger && triggerNameToUse)
                      const nameT = name.trim()
                      const commandT = command.trim()
                      const tagFromName = normaliseTriggerTag(nameT)
                      const triggerTagFallback = normaliseTriggerTag(triggerNameToUse.trim())
                      const displayForChat = commandT || (nameT ? nameT : '') || triggerTagFallback
                      const routeForLlm = commandT || tagFromName || triggerTagFallback

                      if (shouldAutoProcess && triggerNameToUse && snap.imageUrl) {
                        setShowTriggerPrompt(null)
                        setCreateTriggerChecked(true)
                        setAddCommandChecked(true)
                        handleSendMessageWithTrigger(displayForChat, snap.imageUrl, routeForLlm)
                      } else {
                        if (snap.imageUrl) {
                          const caption = commandT || (nameT ? nameT : '') || tagFromName || '[Screenshot]'
                          const imageMessage = {
                            role: 'user' as const,
                            text: caption,
                            imageUrl: snap.imageUrl,
                          }
                          setChatMessages((prev) => [...prev, imageMessage])
                          setTimeout(() => {
                            if (chatRef.current) {
                              chatRef.current.scrollTop = chatRef.current.scrollHeight
                            }
                          }, 100)
                        }
                        setShowTriggerPrompt(null)
                        setCreateTriggerChecked(true)
                        setAddCommandChecked(true)
                      }
                    }}
                    style={{
                      padding: '6px 12px',
                      background: '#22c55e',
                      border: '1px solid #16a34a',
                      color: '#0b1e12',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '700'
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
      </div>

          {/* Embed Dialog */}
          {showEmbedDialog && (
            <div style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              zIndex: 2147483651,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(4px)'
            }}>
              <div style={{
                width: '420px',
                background: 'linear-gradient(135deg,#c084fc 0%,#a855f7 50%,#9333ea 100%)',
                color: 'white',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.25)',
                boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
                overflow: 'hidden'
              }}>
                <div style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid rgba(255,255,255,0.25)',
                  fontWeight: 700
                }}>
                  Where to embed?
                </div>
                <div style={{ padding: '14px 16px', fontSize: '12px' }}>
                  <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
            <input
                      type="radio" 
                      checked={embedTarget === 'session'}
                      onChange={() => setEmbedTarget('session')}
                    />
                    <span>Session Memory (this session only)</span>
          </label>
                  <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
            <input
                      type="radio" 
                      checked={embedTarget === 'account'}
                      onChange={() => setEmbedTarget('account')}
                    />
                    <span>Account Memory (account-wide, long term)</span>
          </label>
                  <div style={{ marginTop: '10px', opacity: 0.9 }}>
                    Content will be processed (OCR/ASR/Parsing), chunked, and embedded locally.
                  </div>
                </div>
                <div style={{
                  padding: '12px 16px',
                  background: 'rgba(255,255,255,0.08)',
                  display: 'flex',
                  gap: '8px',
                  justifyContent: 'flex-end'
                }}>
                  <button 
                    onClick={() => setShowEmbedDialog(false)}
                    style={{
                      padding: '6px 10px',
                      border: 0,
                      borderRadius: '6px',
                      background: 'rgba(255,255,255,0.18)',
                      color: 'white',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleEmbedConfirm}
                    style={{
                      padding: '6px 10px',
                      border: 0,
                      borderRadius: '6px',
                      background: '#22c55e',
                      color: '#0b1e12',
                      cursor: 'pointer'
                    }}
                  >
                    Embed
                  </button>
                </div>
        </div>
      </div>
          )}
        </>
      )}

      <div style={{ 
        flex: 1, 
        overflowY: 'auto', 
        overflowX: 'hidden', 
        padding: '16px', 
        width: '100%', 
        boxSizing: 'border-box',
        WebkitOverflowScrolling: 'touch'
      } as React.CSSProperties}>
      
      {/* Master Tab Title */}
      {masterTabId && masterTabId !== "01" && (
        <div style={{
          background: 'rgba(118,75,162,0.25)',
          borderRadius: '10px',
          padding: '16px 20px',
          marginBottom: '20px',
          border: '1px solid rgba(255,255,255,0.2)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <div style={{
            fontSize: '16px',
            fontWeight: '700',
            letterSpacing: '0.5px',
            opacity: 0.95
          }}>
            🖥️ Master Tab ({masterTabId})
          </div>
        </div>
      )}
      
      {/* Agent Boxes Display */}
      {agentBoxes.filter(box => {
        // Filter out display grid boxes (same logic as content script)
        const isDisplayGrid = box.source === 'display_grid' || box.gridSessionId
        if (isDisplayGrid) return false
        
        // Filter by master tab ID - only show boxes created on this tab
        const boxMasterTabId = box.masterTabId || "01"  // Default to "01" for legacy boxes
        const currentMasterTabId = masterTabId || "01"  // Current tab's ID
        return boxMasterTabId === currentMasterTabId
      }).length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          {agentBoxes.filter(box => {
            // Filter out display grid boxes (same logic as content script)
            const isDisplayGrid = box.source === 'display_grid' || box.gridSessionId
            if (isDisplayGrid) return false
            
            // Filter by master tab ID - only show boxes created on this tab
            const boxMasterTabId = box.masterTabId || "01"  // Default to "01" for legacy boxes
            const currentMasterTabId = masterTabId || "01"  // Current tab's ID
            return boxMasterTabId === currentMasterTabId
          }).map(box => {
            const currentHeight = agentBoxHeights[box.id] || 120
            const isEnabled = box.enabled !== false // Default to true
            return (
              <div key={box.id} style={{
                background: 'rgba(255,255,255,0.12)',
                borderRadius: '10px',
                overflow: 'hidden',
                marginBottom: '16px',
                border: '1px solid rgba(255,255,255,0.15)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                opacity: isEnabled ? 1 : 0.6
              }}>
      <div style={{ 
                  background: box.color || '#4CAF50',
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <span style={{ fontSize: '12px', fontWeight: '700', opacity: isEnabled ? 1 : 0.5 }}>{box.title || 'Agent Box'}</span>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <label
                      style={{
                        position: 'relative',
                        display: 'inline-block',
                        width: '36px',
                        height: '20px',
                        cursor: 'pointer'
                      }}
                      title={isEnabled ? 'Click to disable this agent' : 'Click to enable this agent'}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        // Simply toggle the visual state
                        const updatedBoxes = agentBoxes.map(b => 
                          b.id === box.id ? { ...b, enabled: !isEnabled } : b
                        )
                        setAgentBoxes(updatedBoxes)
                      }}
                    >
                      <input type="checkbox" checked={isEnabled} readOnly style={{ opacity: 0, width: 0, height: 0 }} />
                      <span style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: isEnabled ? '#4CAF50' : '#ccc',
                        borderRadius: '20px',
                        transition: '0.3s'
                      }}></span>
                      <span style={{
                        position: 'absolute',
                        height: '14px',
                        width: '14px',
                        left: isEnabled ? '19px' : '3px',
                        bottom: '3px',
                        backgroundColor: 'white',
                        borderRadius: '50%',
                        transition: '0.3s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                      }}></span>
                    </label>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void (async () => {
                          await updateAgentBoxOutput(box.id, '', undefined, sessionKey, 'sidepanel')
                          setAgentBoxes((prev) =>
                            prev.map((b) => (b.id === box.id ? { ...b, output: '' } : b)),
                          )
                        })()
                      }}
                      style={{
                        padding: '0 4px',
                        border: 'none',
                        background: 'transparent',
                        color: 'rgba(255,255,255,0.9)',
                        opacity: 0.5,
                        fontSize: '10px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        letterSpacing: '0.02em',
                        lineHeight: 1.2,
                      }}
                      title="Clear output"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => editAgentBox(box.id)}
                      style={{
                        background: 'rgba(255,255,255,0.2)',
                        border: 'none',
                        color: 'white',
                        minWidth: '20px',
                        height: '20px',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s ease',
                        opacity: 0.85
                      }}
                      title="Edit agent box"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '1'
                        e.currentTarget.style.background = 'rgba(33, 150, 243, 0.8)'
                        e.currentTarget.style.transform = 'scale(1.05)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '0.85'
                        e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                        e.currentTarget.style.transform = 'scale(1)'
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => removeAgentBox(box.id)}
                      style={{
                        background: 'rgba(244,67,54,0.9)',
                        border: 'none',
                        color: 'white',
                        minWidth: '20px',
                        height: '20px',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        transition: 'all 0.2s ease',
                        opacity: 0.85
                      }}
                      title="Delete agent box"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '1'
                        e.currentTarget.style.background = 'rgba(211, 47, 47, 1)'
                        e.currentTarget.style.transform = 'scale(1.05)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '0.85'
                        e.currentTarget.style.background = 'rgba(244,67,54,0.9)'
                        e.currentTarget.style.transform = 'scale(1)'
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div 
                  style={{
                    background: theme === 'dark' ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.96)',
                    color: theme === 'dark' ? '#f1f5f9' : '#1e293b',
                    borderRadius: '0 0 10px 10px',
                    padding: '16px',
                    minHeight: `${currentHeight}px`,
                    height: `${currentHeight}px`,
                    border: theme === 'dark' ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                    position: 'relative',
                    overflow: 'auto',
                    opacity: isEnabled ? 1 : 0.5,
                    pointerEvents: isEnabled ? 'auto' : 'none'
                  }}
                >
                  <div style={{ fontSize: '13px', color: theme === 'dark' ? '#f1f5f9' : '#1e293b', lineHeight: '1.6' }}>
                    {isEnabled ? (
                      box.output || <span style={{ opacity: 0.5, color: theme === 'dark' ? '#94a3b8' : '#64748b' }}>Ready for {box.title?.replace(/[📝🔍🎯🧮]/g, '').trim()}...</span>
                    ) : (
                      <span style={{ opacity: 0.7, color: theme === 'dark' ? '#94a3b8' : '#64748b', fontStyle: 'italic' }}>Agent disabled - toggle On to activate</span>
                    )}
                  </div>
                  <div 
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: '8px',
                      cursor: 'ns-resize',
                      background: 'rgba(0,0,0,0.1)',
                      borderRadius: '0 0 8px 8px',
                      opacity: resizingBoxId === box.id ? 1 : 0,
                      transition: 'opacity 0.2s'
                    }}
                    onMouseDown={(e) => startResizing(box.id, e)}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = '0.6'}
                    onMouseLeave={(e) => {
                      if (resizingBoxId !== box.id) {
                        e.currentTarget.style.opacity = '0'
                      }
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
      
      {/* Add Agent Box Button */}
      <button
        onClick={addAgentBox}
        style={{
          width: '100%',
          padding: '16px 20px',
          ...(theme === 'standard' ? {
            background: 'rgba(15,23,42,0.08)',
            border: '2px dashed rgba(15,23,42,0.3)',
            color: '#0f172a'
          } : theme === 'dark' ? {
            background: 'rgba(255,255,255,0.1)',
            border: '2px dashed rgba(255,255,255,0.3)',
            color: '#f1f5f9'
          } : {
            background: 'rgba(118,75,162,0.3)',
            border: '2px dashed rgba(255,255,255,0.5)',
            color: 'white'
          }),
          borderRadius: '10px',
          cursor: 'pointer',
          fontSize: '15px',
          fontWeight: '700',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          transition: 'all 0.2s ease',
          marginBottom: '28px',
          boxShadow: 'none'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)'
          if (theme === 'standard') {
            e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
            e.currentTarget.style.borderColor = 'rgba(15,23,42,0.4)'
          } else if (theme === 'dark') {
            e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)'
          } else {
            e.currentTarget.style.background = 'rgba(118,75,162,0.55)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.7)'
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)'
          if (theme === 'standard') {
            e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
            e.currentTarget.style.borderColor = 'rgba(15,23,42,0.3)'
          } else if (theme === 'dark') {
            e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'
          } else {
            e.currentTarget.style.background = 'rgba(118,75,162,0.3)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)'
          }
        }}
      >
        ➕ Add New Agent Box
      </button>

      {/* Runtime Controls Section */}
      <div style={{
        background: theme === 'pro' ? 'rgba(118,75,162,0.5)' : 'rgba(255,255,255,0.12)',
        padding: '16px',
          borderRadius: '10px',
        marginBottom: '28px',
        border: '1px solid rgba(255,255,255,0.15)'
      }}>
        <h3 style={{
          margin: '0 0 14px 0',
          fontSize: '13px',
          fontWeight: '700',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          opacity: 0.95,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '10px',
          alignItems: 'center'
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
            ⚡ Runtime Controls
          </span>
          <div
            onClick={toggleViewMode}
            style={{
              cursor: isAdminDisabled ? 'not-allowed' : 'pointer',
              opacity: isAdminDisabled ? 0.6 : 1,
              display: 'flex',
              justifyContent: 'flex-end',
              paddingRight: '5px'
            }}
            title={isAdminDisabled ? 'Open a website for viewing the admin panel' : `Switch to ${currentViewMode === 'app' ? 'Admin' : 'App'} view`}
          >
            <div style={{
              position: 'relative',
              width: '50px',
              height: '20px',
              background: currentViewMode === 'app'
                ? (theme === 'pro' ? 'rgba(76,175,80,0.9)' : theme === 'dark' ? 'rgba(76,175,80,0.9)' : 'rgba(34,197,94,0.9)')
                : (theme === 'pro' ? 'rgba(255,255,255,0.2)' : theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.2)'),
              borderRadius: '10px',
              transition: 'background 0.2s',
              border: theme === 'pro' ? '1px solid rgba(255,255,255,0.3)' : theme === 'dark' ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(15,23,42,0.3)',
              overflow: 'hidden'
            }}>
              <span style={{
                position: 'absolute',
                left: currentViewMode === 'app' ? '8px' : 'auto',
                right: currentViewMode === 'app' ? 'auto' : '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '9px',
                fontWeight: '700',
                color: currentViewMode === 'app'
                  ? 'rgba(255,255,255,0.95)'
                  : (theme === 'pro' ? 'rgba(255,255,255,0.5)' : theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(15,23,42,0.5)'),
                transition: 'all 0.2s',
                userSelect: 'none',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                zIndex: 1,
                whiteSpace: 'nowrap',
                lineHeight: '1'
              }}>App</span>
              <div style={{
                position: 'absolute',
                top: '3px',
                left: currentViewMode === 'app' ? '32px' : '3px',
                width: '14px',
                height: '14px',
                background: theme === 'pro' ? 'rgba(255,255,255,0.95)' : theme === 'dark' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.95)',
                borderRadius: '50%',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                zIndex: 2
              }} />
            </div>
          </div>
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <button
            onClick={syncSession}
            style={{
              padding: '12px',
              background: '#2196F3',
              border: 'none',
              color: 'white',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(33,150,243,0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'
            }}
          >
            🔄 Sync
          </button>
          <button
            onClick={importSession}
            style={{
              padding: '12px',
              background: '#9C27B0',
              border: 'none',
              color: 'white',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(156,39,176,0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'
            }}
          >
            📥 Import
          </button>
          <button
            onClick={() => sendToContentScript('OPEN_BACKEND_CONFIG_LIGHTBOX')}
            style={{
              padding: '12px',
              background: '#8b5cf6',
              border: 'none',
              color: 'white',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(139,92,246,0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'
            }}
          >
            ⚙️ Backend
          </button>
          <button
            onClick={() => sendToContentScript('OPEN_POLICY_LIGHTBOX')}
            title="Policy Configuration"
            style={{
              padding: '12px',
              background: '#10b981',
              border: 'none',
              color: 'white',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(16,185,129,0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'
            }}
          >
            📋 Policies
          </button>
          <button
            onClick={openWRVault}
            style={{
              padding: '12px',
              ...(theme === 'standard' ? {
                background: 'rgba(15,23,42,0.08)',
                border: '1px solid #94a3b8',
                color: '#0f172a'
              } : theme === 'dark' ? {
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.25)',
                color: '#f1f5f9'
              } : {
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.25)',
                color: 'white'
              }),
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '700',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'all 0.2s ease',
              gridColumn: '1 / span 2',
              boxShadow: '0 2px 6px rgba(0,0,0,0.15)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              if (theme === 'standard') {
                e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(15,23,42,0.15)'
              } else {
                e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(255,255,255,0.15)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              if (theme === 'standard') {
                e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
              } else {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
              }
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)'
            }}
          >
            🔒 WRVault
          </button>
        </div>
      </div>

      {connectEmailFlowModal}

      

      {beapDraftReaderModalId && (() => {
        const att = beapDraftAttachments.find((x) => x.id === beapDraftReaderModalId)
        const text = att?.capsuleAttachment?.semanticContent?.trim()
        if (!att || !text) return null
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

      {/* Third Party Licenses Modal */}
      {showThirdPartyLicenses && (
        <ThirdPartyLicensesView
          theme={theme}
          onClose={() => setShowThirdPartyLicenses(false)}
        />
      )}

      {/* Notification Toast */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          left: '20px',
          background: notification.type === 'success' ? 'rgba(76, 175, 80, 0.95)' : 
                      notification.type === 'error' ? 'rgba(244, 67, 54, 0.95)' : 
                      'rgba(33, 150, 243, 0.95)',
          color: 'white',
          padding: '12px 16px',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: '600',
          zIndex: 10000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          animation: 'slideInDown 0.3s ease',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px'
        }}>
          <span style={{ flexShrink: 0, lineHeight: 1.4 }}>
            {notification.type === 'success' ? '✓' : notification.type === 'info' ? 'ℹ' : '✕'}
          </span>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-line', lineHeight: 1.45 }}>{notification.message}</span>
        </div>
      )}
      </div>
    </div>
  )
}

// Render the sidepanel
const container = document.getElementById('sidepanel-root')
if (container) {
  const root = createRoot(container)
  root.render(<SidepanelOrchestrator />)
}
