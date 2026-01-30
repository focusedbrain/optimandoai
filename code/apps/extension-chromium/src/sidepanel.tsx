/// <reference types="chrome-types"/>
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { BackendSwitcherInline } from './components/BackendSwitcherInline'
import { PackageBuilderPolicy } from './policy/components/PackageBuilderPolicy'
import type { CanonicalPolicy } from './policy/schema'
import { 
  formatFingerprintShort, 
  formatFingerprintGrouped 
} from './handshake/fingerprint'
import { HANDSHAKE_REQUEST_TEMPLATE, POLICY_NOTES, TOOLTIPS } from './handshake/microcopy'
import {
  getOurIdentity,
  createHandshakeRequestPayload,
  type OurIdentity
} from './handshake/handshakeService'
import { serializeHandshakeRequestPayload } from './handshake/handshakePayload'
import { 
  routeInput, 
  routeEventTagInput,
  getButlerSystemPrompt, 
  wrapInputForAgent,
  loadAgentsFromSession,
  updateAgentBoxOutput,
  getAgentById,
  resolveModelForAgent,
  type RoutingDecision,
  type AgentMatch,
  type AgentBox,
  type EventTagRoutingBatch
} from './services/processFlow'
import { nlpClassifier, type ClassifiedInput } from './nlp'
import { inputCoordinator } from './services/InputCoordinator'
import { formatErrorForNotification, isConnectionError } from './utils/errorMessages'
import { ThirdPartyLicensesView } from './bundled-tools'
import { WRGuardWorkspace } from './wrguard'
import { RecipientModeSwitch, RecipientHandshakeSelect, DeliveryMethodPanel, executeDeliveryAction } from './beap-messages'
import type { RecipientMode, SelectedRecipient, DeliveryMethod, BeapPackageConfig } from './beap-messages'
import { useHandshakeStore } from './handshake/useHandshakeStore'
import { processAttachmentForParsing, processAttachmentForRasterization } from './beap-builder'
import type { CapsuleAttachment, RasterProof, RasterPageData } from './beap-builder'

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
  const [dockedSubmode, setDockedSubmode] = useState<'command' | 'p2p-chat' | 'p2p-stream' | 'group-stream' | 'handshake'>('command')
  const [beapSubmode, setBeapSubmode] = useState<'inbox' | 'draft' | 'outbox' | 'archived' | 'rejected'>('draft')
  const [selectedEmailAccountId, setSelectedEmailAccountId] = useState<string | null>(null)
  
  // Helper to get combined mode for conditional rendering
  const dockedPanelMode = dockedWorkspace === 'wr-chat' ? dockedSubmode : dockedWorkspace
  
  // Helper to get the current BEAP view for conditional rendering
  const currentBeapView = dockedWorkspace === 'beap-messages' ? beapSubmode : null
  const [chatMessages, setChatMessages] = useState<Array<{role: 'user' | 'assistant', text: string, imageUrl?: string}>>([])
  const [chatInput, setChatInput] = useState('')
  const [chatHeight, setChatHeight] = useState(200)
  const [isResizingChat, setIsResizingChat] = useState(false)
  const [triggers, setTriggers] = useState<any[]>([])
  const [showTagsMenu, setShowTagsMenu] = useState(false)
  const [showEmbedDialog, setShowEmbedDialog] = useState(false)
  const [pendingItems, setPendingItems] = useState<any[]>([])
  const [embedTarget, setEmbedTarget] = useState<'session' | 'account'>('session')
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error' | 'info'} | null>(null)
  const [theme, setTheme] = useState<'pro' | 'dark' | 'standard'>('standard')
  
  // ==========================================================================
  // AUTH-GATED UI STATE (mirrors popup-chat.tsx)
  // ==========================================================================
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)  // null = loading
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [authUserInfo, setAuthUserInfo] = useState<{ displayName?: string; email?: string; initials?: string; picture?: string }>({})
  
  // Check auth status on mount and periodically
  useEffect(() => {
    const checkAuthStatus = () => {
      chrome.runtime.sendMessage({ type: 'AUTH_STATUS' }, (response: { loggedIn?: boolean; displayName?: string; email?: string; initials?: string; picture?: string } | undefined) => {
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

    checkAuthStatus();
    // Refresh auth status every 30 seconds (same as popup-chat)
    const interval = setInterval(checkAuthStatus, 30000);
    return () => clearInterval(interval);
  }, []);
  
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
          console.log('[AUTH] Sidepanel: Open wrdesk.com result:', response?.action);
        }
      });
    }
  }, [isLoggedIn]);
  
  // Handle Sign In click
  const handleAuthSignIn = () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    chrome.runtime.sendMessage({ type: 'AUTH_LOGIN' }, (response) => {
      setIsLoggingIn(false);
      if (response?.ok) {
        setIsLoggedIn(true);
        // Fetch updated user info
        chrome.runtime.sendMessage({ type: 'AUTH_STATUS' }, (statusResponse: { loggedIn?: boolean; displayName?: string; email?: string; initials?: string; picture?: string } | undefined) => {
          if (statusResponse?.loggedIn) {
            setAuthUserInfo({
              displayName: statusResponse.displayName,
              email: statusResponse.email,
              initials: statusResponse.initials,
              picture: statusResponse.picture,
            });
          }
        });
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
  
  // BEAP Handshake Request state
  const [handshakeDelivery, setHandshakeDelivery] = useState<'email' | 'messenger' | 'download'>('email')
  const [handshakeTo, setHandshakeTo] = useState('')
  const [handshakeSubject, setHandshakeSubject] = useState('Request to Establish BEAP™ Secure Communication Handshake')
  const [fingerprintCopied, setFingerprintCopied] = useState(false)
  
  // ==========================================================================
  // Real X25519 Identity (replaces mock fingerprint)
  // ==========================================================================
  
  const [identity, setIdentity] = useState<OurIdentity | null>(null)
  const [identityLoading, setIdentityLoading] = useState(true)
  const [handshakeSending, setHandshakeSending] = useState(false)
  
  // Load real identity on mount
  useEffect(() => {
    let mounted = true
    setIdentityLoading(true)
    
    getOurIdentity()
      .then((id) => {
        if (mounted) {
          setIdentity(id)
          // Update handshake message with real fingerprint
          setHandshakeMessage(HANDSHAKE_REQUEST_TEMPLATE.replace('[FINGERPRINT]', id.fingerprint))
        }
      })
      .catch((err) => {
        console.error('[Sidepanel] Failed to load identity:', err)
      })
      .finally(() => {
        if (mounted) setIdentityLoading(false)
      })
    
    return () => { mounted = false }
  }, [])
  
  // Derived fingerprint values (safe to use after loading)
  const ourFingerprint = identity?.fingerprint || ''
  const ourFingerprintShort = identity ? formatFingerprintShort(identity.fingerprint) : '...'
  
  // Initialize handshake message (will be updated when identity loads)
  const [handshakeMessage, setHandshakeMessage] = useState('')
  
  // BEAP Draft message state (separate from handshake message)
  const [beapDraftMessage, setBeapDraftMessage] = useState('')
  const [beapDraftEncryptedMessage, setBeapDraftEncryptedMessage] = useState('')
  const [beapDraftTo, setBeapDraftTo] = useState('')
  const [beapDraftSessionId, setBeapDraftSessionId] = useState('')
  const [beapDraftAttachments, setBeapDraftAttachments] = useState<DraftAttachment[]>([])
  const [availableSessions, setAvailableSessions] = useState<SessionOption[]>([])
  
  // BEAP Recipient Mode state (PRIVATE=qBEAP / PUBLIC=pBEAP)
  const [beapRecipientMode, setBeapRecipientMode] = useState<RecipientMode>('private')
  const [selectedRecipient, setSelectedRecipient] = useState<SelectedRecipient | null>(null)
  
  // Get handshakes from store
  const handshakes = useHandshakeStore(state => state.handshakes)
  const initializeHandshakes = useHandshakeStore(state => state.initializeWithDemo)
  const createPendingOutgoing = useHandshakeStore(state => state.createPendingOutgoingFromRequest)
  
  // Initialize handshakes on mount
  useEffect(() => {
    initializeHandshakes()
  }, [initializeHandshakes])
  
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
          // Sort by timestamp descending (newest first)
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
  
  // Refresh sessions when window gets focus (to catch newly created sessions)
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
  
  // BEAP Message sending state
  const [isSendingBeap, setIsSendingBeap] = useState(false)
  
  // Handler for sending BEAP messages (shared across all Draft views)
  const handleSendBeapMessage = async () => {
    // Validate preconditions
    if (beapRecipientMode === 'private' && !selectedRecipient) {
      setNotification({ message: 'Please select a handshake recipient', type: 'error' })
      setTimeout(() => setNotification(null), 3000)
      return
    }
    
    if (!beapDraftMessage.trim()) {
      setNotification({ message: 'Please enter a message', type: 'error' })
      setTimeout(() => setNotification(null), 3000)
      return
    }
    
    setIsSendingBeap(true)
    
    try {
      // Build config for the package builder
      // Extract CapsuleAttachment objects from draft attachments
      const capsuleAttachments = beapDraftAttachments.map(a => a.capsuleAttachment)
      // Collect all raster page data as artefacts for the package
      const rasterArtefacts: BeapPackageConfig['rasterArtefacts'] = []
      for (const att of beapDraftAttachments) {
        if (att.rasterPageData && att.rasterPageData.length > 0) {
          for (const pageData of att.rasterPageData) {
            rasterArtefacts.push({
              artefactRef: pageData.artefactRef,
              attachmentId: att.id,
              page: pageData.page,
              mime: pageData.mime,
              base64: pageData.base64,
              sha256: pageData.sha256,
              width: pageData.width,
              height: pageData.height,
              bytes: pageData.bytes
            })
          }
        }
      }
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
        deliveryMethod: handshakeDelivery as DeliveryMethod,
        selectedRecipient,
        senderFingerprint: ourFingerprint,
        senderFingerprintShort: ourFingerprintShort,
        emailTo: beapDraftTo,
        subject: 'BEAP™ Message',
        messageBody: beapDraftMessage,
        attachments: capsuleAttachments,
        rasterArtefacts: rasterArtefacts.length > 0 ? rasterArtefacts : undefined,
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
        // Show success notification based on delivery method
        const actionLabel = handshakeDelivery === 'download' ? 'Package downloaded!' 
          : handshakeDelivery === 'messenger' ? 'Payload copied to clipboard!' 
          : 'BEAP™ Message sent!'
        setNotification({ message: actionLabel, type: 'success' })
        
        // Clear form
        setBeapDraftTo('')
        setBeapDraftMessage('')
        setBeapDraftEncryptedMessage('')
        setBeapDraftSessionId('')
        setBeapDraftAttachments([])
        setSelectedRecipient(null)
      } else {
        setNotification({ message: result.message || 'Failed to send message', type: 'error' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred'
      setNotification({ message, type: 'error' })
    } finally {
      setIsSendingBeap(false)
      setTimeout(() => setNotification(null), 3000)
    }
  }
  
  // Get button label based on delivery method
  const getBeapSendButtonLabel = () => {
    if (isSendingBeap) return '⏳ Processing...'
    switch (handshakeDelivery) {
      case 'email': return '📧 Send'
      case 'messenger': return '📋 Copy'
      case 'download': return '💾 Download'
      default: return '📤 Send'
    }
  }
  
  // Check if send button should be disabled
  const isBeapSendDisabled = isSendingBeap || !beapDraftMessage.trim() || 
    (beapRecipientMode === 'private' && !selectedRecipient)
  
  const [isResizingMailguard, setIsResizingMailguard] = useState(false)
  const mailguardFileRef = useRef<HTMLInputElement>(null)
  
  // Email Gateway state
  const [emailAccounts, setEmailAccounts] = useState<Array<{
    id: string
    displayName: string
    email: string
    provider: 'gmail' | 'microsoft365' | 'imap'
    status: 'active' | 'error' | 'disabled'
    lastError?: string
  }>>([])
  const [isLoadingEmailAccounts, setIsLoadingEmailAccounts] = useState(false)
  const [showEmailSetupWizard, setShowEmailSetupWizard] = useState(false)
  const [emailSetupStep, setEmailSetupStep] = useState<'provider' | 'credentials' | 'connecting' | 'gmail-credentials' | 'outlook-credentials'>('provider')
  const [gmailCredentials, setGmailCredentials] = useState({ clientId: '', clientSecret: '' })
  const [outlookCredentials, setOutlookCredentials] = useState({ clientId: '', clientSecret: '' })
  const [masterTabId, setMasterTabId] = useState<string | null>(null) // For Master Tab (01), (02), (03), etc. (01 = first tab, doesn't show title in UI)
  const [showTriggerPrompt, setShowTriggerPrompt] = useState<{mode: string, rect: any, imageUrl: string, videoUrl?: string, createTrigger: boolean, addCommand: boolean, name?: string, command?: string, bounds?: any} | null>(null)
  const [createTriggerChecked, setCreateTriggerChecked] = useState(false)
  const [addCommandChecked, setAddCommandChecked] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Pending trigger state - for auto-processing after screenshot capture
  // Using REF instead of state to avoid stale closure issues in message handlers
  const pendingTriggerRef = useRef<{
    trigger: any
    command?: string
    autoProcess: boolean
  } | null>(null)
  
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
    try {
      // Send request to Electron via background script
      const response = await chrome.runtime.sendMessage({ 
        type: 'EMAIL_LIST_ACCOUNTS' 
      })
      if (response?.ok && response?.data) {
        setEmailAccounts(response.data)
      }
    } catch (err) {
      console.error('[Sidepanel] Failed to load email accounts:', err)
    } finally {
      setIsLoadingEmailAccounts(false)
    }
  }
  
  // Load email accounts when BEAP Messages workspace is selected
  useEffect(() => {
    if (dockedWorkspace === 'beap-messages') {
      loadEmailAccounts()
    }
  }, [dockedWorkspace])
  
  // IMAP form state
  const [imapForm, setImapForm] = useState({
    displayName: '',
    email: '',
    host: '',
    port: 993,
    username: '',
    password: '',
    security: 'ssl' as 'ssl' | 'starttls' | 'none'
  })
  const [imapPresets, setImapPresets] = useState<Record<string, { name: string; host: string; port: number; security: string }>>({})
  
  // Load IMAP presets
  const loadImapPresets = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EMAIL_GET_PRESETS' })
      if (response?.ok && response?.data) {
        setImapPresets(response.data)
      }
    } catch (err) {
      console.error('[Sidepanel] Failed to load IMAP presets:', err)
    }
  }
  
  // Check if Gmail credentials are configured, show inline form if not
  const startGmailConnect = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EMAIL_CHECK_GMAIL_CREDENTIALS' })
      if (response?.ok && response?.data?.configured) {
        // Credentials exist, proceed with OAuth
        connectGmailAccount()
      } else {
        // Show inline credentials form
        setEmailSetupStep('gmail-credentials')
      }
    } catch (err) {
      console.error('[Sidepanel] Failed to check Gmail credentials:', err)
      // Show form anyway
      setEmailSetupStep('gmail-credentials')
    }
  }
  
  // Save Gmail credentials and connect
  const saveGmailCredentialsAndConnect = async () => {
    if (!gmailCredentials.clientId || !gmailCredentials.clientSecret) {
      setNotification({ message: 'Please enter both Client ID and Client Secret', type: 'error' })
      setTimeout(() => setNotification(null), 3000)
      return
    }
    
    setEmailSetupStep('connecting')
    try {
      // Save credentials
      const saveResponse = await chrome.runtime.sendMessage({
        type: 'EMAIL_SAVE_GMAIL_CREDENTIALS',
        clientId: gmailCredentials.clientId,
        clientSecret: gmailCredentials.clientSecret
      })
      
      if (!saveResponse?.ok) {
        throw new Error(saveResponse?.error || 'Failed to save credentials')
      }
      
      // Now connect
      await connectGmailAccount()
    } catch (err: any) {
      console.error('[Sidepanel] Failed to save Gmail credentials:', err)
      setNotification({ message: err.message || 'Failed to save credentials', type: 'error' })
      setTimeout(() => setNotification(null), 5000)
      setEmailSetupStep('gmail-credentials')
    }
  }
  
  // Connect Gmail account via Electron
  const connectGmailAccount = async () => {
    setEmailSetupStep('connecting')
    try {
      const response = await chrome.runtime.sendMessage({ 
        type: 'EMAIL_CONNECT_GMAIL' 
      })
      if (response?.ok) {
        setShowEmailSetupWizard(false)
        setEmailSetupStep('provider')
        setGmailCredentials({ clientId: '', clientSecret: '' })
        loadEmailAccounts()
        setNotification({ message: 'Gmail connected successfully!', type: 'success' })
        setTimeout(() => setNotification(null), 3000)
      } else {
        // Use user-friendly error message
        const errorMessage = formatErrorForNotification(response?.error, response?.errorCode)
        const timeout = isConnectionError(response?.errorCode) ? 8000 : 5000
        setNotification({ message: errorMessage, type: 'error' })
        setTimeout(() => setNotification(null), timeout)
        setEmailSetupStep('provider')
      }
    } catch (err: any) {
      console.error('[Sidepanel] Failed to connect Gmail:', err)
      const errorMessage = formatErrorForNotification(err.message)
      setNotification({ message: errorMessage, type: 'error' })
      setTimeout(() => setNotification(null), 5000)
      setEmailSetupStep('provider')
    }
  }
  
  // Check if Outlook credentials are configured, show inline form if not
  const startOutlookConnect = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EMAIL_CHECK_OUTLOOK_CREDENTIALS' })
      if (response?.ok && response?.data?.configured) {
        // Credentials exist, proceed with OAuth
        connectOutlookAccount()
      } else {
        // Show inline credentials form
        setEmailSetupStep('outlook-credentials')
      }
    } catch (err) {
      console.error('[Sidepanel] Failed to check Outlook credentials:', err)
      // Show form anyway
      setEmailSetupStep('outlook-credentials')
    }
  }
  
  // Save Outlook credentials and connect
  const saveOutlookCredentialsAndConnect = async () => {
    if (!outlookCredentials.clientId) {
      setNotification({ message: 'Please enter the Client ID', type: 'error' })
      setTimeout(() => setNotification(null), 3000)
      return
    }
    
    setEmailSetupStep('connecting')
    try {
      // Save credentials
      const saveResponse = await chrome.runtime.sendMessage({
        type: 'EMAIL_SAVE_OUTLOOK_CREDENTIALS',
        clientId: outlookCredentials.clientId,
        clientSecret: outlookCredentials.clientSecret
      })
      
      if (!saveResponse?.ok) {
        throw new Error(saveResponse?.error || 'Failed to save credentials')
      }
      
      // Now connect
      await connectOutlookAccount()
    } catch (err: any) {
      console.error('[Sidepanel] Failed to save Outlook credentials:', err)
      setNotification({ message: err.message || 'Failed to save credentials', type: 'error' })
      setTimeout(() => setNotification(null), 5000)
      setEmailSetupStep('outlook-credentials')
    }
  }
  
  // Connect Outlook account via Electron
  const connectOutlookAccount = async () => {
    setEmailSetupStep('connecting')
    try {
      const response = await chrome.runtime.sendMessage({ 
        type: 'EMAIL_CONNECT_OUTLOOK' 
      })
      if (response?.ok) {
        setShowEmailSetupWizard(false)
        setEmailSetupStep('provider')
        setOutlookCredentials({ clientId: '', clientSecret: '' })
        loadEmailAccounts()
        setNotification({ message: 'Outlook connected successfully!', type: 'success' })
        setTimeout(() => setNotification(null), 3000)
      } else {
        // Use user-friendly error message
        const errorMessage = formatErrorForNotification(response?.error, response?.errorCode)
        const timeout = isConnectionError(response?.errorCode) ? 8000 : 5000
        setNotification({ message: errorMessage, type: 'error' })
        setTimeout(() => setNotification(null), timeout)
        setEmailSetupStep('provider')
      }
    } catch (err: any) {
      console.error('[Sidepanel] Failed to connect Outlook:', err)
      const errorMessage = formatErrorForNotification(err.message)
      setNotification({ message: errorMessage, type: 'error' })
      setTimeout(() => setNotification(null), 5000)
      setEmailSetupStep('provider')
    }
  }
  
  // Connect IMAP account
  const connectImapAccount = async () => {
    if (!imapForm.email || !imapForm.host || !imapForm.username || !imapForm.password) {
      setNotification({ message: 'Please fill in all required fields', type: 'error' })
      setTimeout(() => setNotification(null), 3000)
      return
    }
    
    setEmailSetupStep('connecting')
    try {
      const response = await chrome.runtime.sendMessage({ 
        type: 'EMAIL_CONNECT_IMAP',
        ...imapForm
      })
      if (response?.ok) {
        setShowEmailSetupWizard(false)
        setEmailSetupStep('provider')
        setImapForm({ displayName: '', email: '', host: '', port: 993, username: '', password: '', security: 'ssl' })
        loadEmailAccounts()
        setNotification({ message: 'Email account connected successfully!', type: 'success' })
        setTimeout(() => setNotification(null), 3000)
      } else {
        // Use user-friendly error message
        const errorMessage = formatErrorForNotification(response?.error, response?.errorCode)
        const timeout = isConnectionError(response?.errorCode) ? 8000 : 5000
        setNotification({ message: errorMessage, type: 'error' })
        setTimeout(() => setNotification(null), timeout)
        setEmailSetupStep('credentials')
      }
    } catch (err: any) {
      console.error('[Sidepanel] Failed to connect IMAP:', err)
      const errorMessage = formatErrorForNotification(err.message)
      setNotification({ message: errorMessage, type: 'error' })
      setTimeout(() => setNotification(null), 5000)
      setEmailSetupStep('credentials')
    }
  }
  
  // Apply IMAP preset
  const applyImapPreset = (presetKey: string) => {
    const preset = imapPresets[presetKey]
    if (preset) {
      setImapForm(prev => ({
        ...prev,
        host: preset.host,
        port: preset.port,
        security: preset.security as 'ssl' | 'starttls' | 'none'
      }))
    }
  }
  
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
  
  const [isLlmLoading, setIsLlmLoading] = useState(false)
  const [llmError, setLlmError] = useState<string | null>(null)
  const [llmRefreshTrigger, setLlmRefreshTrigger] = useState(0)
  
  // Function to refresh available models
  const refreshAvailableModels = async () => {
    try {
      const baseUrl = 'http://127.0.0.1:51248'
      const statusResponse = await fetch(`${baseUrl}/api/llm/status`)
      const statusResult = await statusResponse.json()
      
      if (statusResult.ok && statusResult.data?.modelsInstalled?.length > 0) {
        const models = statusResult.data.modelsInstalled
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
          console.log('[Command Chat] Auto-selected model:', selectedModel)
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
        const baseUrl = 'http://127.0.0.1:51248'
        
        // Check status first
        const statusResponse = await fetch(`${baseUrl}/api/llm/status`)
        const statusResult = await statusResponse.json()
        
        if (!statusResult.ok || !statusResult.data) {
          setLlmError('LLM service not available')
          return
        }
        
        const status = statusResult.data
        console.log('[Command Chat] LLM Status:', status)
        
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
            console.log('[Command Chat] Auto-selected model:', selectedModel)
          }
          console.log('[Command Chat] Available models:', status.modelsInstalled.map((m: any) => m.name))
          setLlmError(null)
        } else {
          // No models installed - show message but DON'T auto-install
          console.log('[Command Chat] No models installed. User should install from LLM Settings.')
          setLlmError('No models installed. Please go to Backend Configuration → LLM tab to install a model.')
        }
      } catch (error: any) {
        console.error('[Command Chat] Failed to fetch available models:', error)
        setLlmError('Failed to connect to LLM service')
      }
    }
    
    fetchFirstAvailableModel()
  }, [llmRefreshTrigger])
  
  // Periodic check for newly installed models (every 10 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      refreshAvailableModels()
    }, 10000) // Check every 10 seconds
    
    return () => clearInterval(interval)
  }, [])
  
  // Listen for model installation events from LLM Settings
  useEffect(() => {
    const handleStorageChange = (changes: any, namespace: string) => {
      if (namespace === 'local' && changes['llm-model-installed']) {
        console.log('[Command Chat] Model installation detected, refreshing...')
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
    console.log('[Sidepanel] processScreenshotWithTrigger called:', { triggerText, hasImage: !!imageUrl })
    
    // Use ref value for model to avoid stale closure
    const currentModel = activeLlmModelRef.current
    
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
      
      // Route the input
      const routingDecision = await routeInput(
        triggerText,
        true, // hasImage = true
        currentConnectionStatus,
        currentSessionName,
        currentModel,
        currentUrl
      )
      
      console.log('[Sidepanel] Trigger routing decision:', routingDecision)
      
      // Process OCR if image provided
      let ocrText = ''
      if (imageUrl) {
        try {
          const ocrResponse = await fetch(`${baseUrl}/api/ocr/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: imageUrl })
          })
          if (ocrResponse.ok) {
            const ocrResult = await ocrResponse.json()
            if (ocrResult.ok && ocrResult.data?.text) {
              ocrText = ocrResult.data.text
              console.log('[Sidepanel] OCR extracted text:', ocrText.substring(0, 100) + '...')
            }
          }
        } catch (e) {
          console.warn('[Sidepanel] OCR failed:', e)
        }
      }
      
      if (routingDecision.shouldForwardToAgent && routingDecision.matchedAgents.length > 0) {
        // Show butler confirmation
        setChatMessages(prev => [...prev, {
          role: 'assistant' as const,
          text: routingDecision.butlerResponse
        }])
        
        // Process with each matched agent
        const agents = await loadAgentsFromSession()
        
        for (const match of routingDecision.matchedAgents) {
          const agent = agents.find(a => a.id === match.agentId)
          if (!agent) {
            console.warn('[Sidepanel] Agent not found:', match.agentId)
            continue
          }
          
          const wrappedInput = wrapInputForAgent(triggerText, agent, ocrText)
          
          // Resolve model - use agent box model if configured, otherwise use current model
          const modelResolution = resolveModelForAgent(
            match.agentBoxProvider,
            match.agentBoxModel,
            currentModel
          )
          
          console.log('[Sidepanel] Processing with agent:', match.agentName, 'model:', modelResolution.model)
          
          const processedContent = ocrText 
            ? `${triggerText}\n\n[Extracted Text]:\n${ocrText}`
            : triggerText
          
          try {
            const agentResponse = await fetch(`${baseUrl}/api/llm/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                modelId: modelResolution.model || currentModel,
                messages: [
                  { role: 'system', content: wrappedInput },
                  { role: 'user', content: processedContent }
                ]
              })
            })
            
            if (agentResponse.ok) {
              const agentResult = await agentResponse.json()
              if (agentResult.ok && agentResult.data?.content) {
                const agentOutput = agentResult.data.content
                
                if (match.agentBoxId) {
                  const reasoningContext = `**Agent:** ${match.agentIcon} ${match.agentName}\n**Match:** ${match.matchDetails}\n**Input:** ${triggerText}`
                  
                  await updateAgentBoxOutput(match.agentBoxId, agentOutput, reasoningContext)
                  
                  setChatMessages(prev => [...prev, {
                    role: 'assistant' as const,
                    text: `✓ ${match.agentIcon} **${match.agentName}** processed your request.\n→ Output displayed in Agent Box ${String(match.agentBoxNumber).padStart(2, '0')}`
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
        console.log('[Sidepanel] No agent match, using butler response')
        const agents = await loadAgentsFromSession()
        const butlerPrompt = getButlerSystemPrompt(
          currentSessionName,
          agents.filter(a => a.enabled).length,
          currentConnectionStatus.isConnected
        )
        
        const processedContent = ocrText 
          ? `${triggerText}\n\n[Extracted Text from Image]:\n${ocrText}`
          : triggerText
        
        try {
          const butlerResponse = await fetch(`${baseUrl}/api/llm/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              modelId: currentModel,
              messages: [
                { role: 'system', content: butlerPrompt },
                { role: 'user', content: processedContent }
              ]
            })
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

  // Load and listen for theme changes AND session changes
  useEffect(() => {
    // Load initial theme
    import('./storage/storageWrapper').then(({ storageGet }) => {
      storageGet(['optimando-ui-theme'], (result) => {
        const savedTheme = result['optimando-ui-theme'] || 'standard'
        setTheme(savedTheme as 'pro' | 'dark' | 'standard')
      });
    });

    // Listen for theme changes AND active session key changes
    const handleStorageChange = (changes: any, namespace: string) => {
      if (namespace === 'local') {
        // Handle theme changes
        if (changes['optimando-ui-theme']) {
          const newTheme = changes['optimando-ui-theme'].newValue || 'standard'
          console.log('🎨 Sidepanel: Theme changed to:', newTheme)
          setTheme(newTheme as 'pro' | 'dark' | 'standard')
        }
        
        // Handle active session key changes - reload session data when session changes
        if (changes['optimando-active-session-key']) {
          const newSessionKey = changes['optimando-active-session-key'].newValue
          console.log('🔄 Sidepanel: Active session key changed to:', newSessionKey)
          
          if (newSessionKey) {
            // Reload session data from SQLite
            chrome.runtime.sendMessage({ type: 'GET_ALL_SESSIONS_FROM_SQLITE' }, (response) => {
              if (chrome.runtime.lastError) {
                console.error('❌ Error reloading sessions from SQLite:', chrome.runtime.lastError.message)
                return
              }
              
              if (!response || !response.success || !response.sessions) {
                console.log('⚠️ No sessions found in SQLite after session change')
                return
              }
              
              // Find the session with the new key
              const session = response.sessions[newSessionKey]
              if (session) {
                console.log('✅ Reloaded session after key change:', newSessionKey, session.tabName)
                setSessionName(session.tabName || 'Unnamed Session')
                setSessionKey(newSessionKey)
                setIsLocked(session.isLocked || false)
                setAgentBoxes(session.agentBoxes || [])
              } else {
                console.log('⚠️ Session not found for key:', newSessionKey)
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
                console.log('🖥️ Detected Master Tab ID:', displayId, '(stored for tab', tabId, ')')
              } else if (storedMasterTabId) {
                // No hybrid_master_id in URL, but we have a stored value (page refreshed)
                setMasterTabId(storedMasterTabId)
                console.log('🖥️ Using stored Master Tab ID:', storedMasterTabId, '(tab', tabId, ')')
              } else {
                // No hybrid_master_id and no stored value - this is Master Tab (01)
                setMasterTabId("01")
                // Store it for this tab so it persists across page refreshes
                chrome.storage.local.set({ [storageKey]: "01" })
                console.log('🖥️ Main master tab - Master Tab (01)')
              }
              
              if (shouldShowMinimal) {
                console.log('📱 Showing minimal UI - Display grid or Edge startpage')
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
                console.log('🖥️ Using stored Master Tab ID after error:', storedMasterTabId)
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
    const handleTabUpdate = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (changeInfo.url || changeInfo.status === 'complete') {
        console.log('🔄 Tab URL changed, rechecking tab type')
        checkTabType()
      }
    }

    // Listen for when user switches tabs
    const handleTabActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      console.log('🔄 Tab activated, rechecking tab type')
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

  // Original useEffect for connection status
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' })

    const handleMessage = (message: any) => {
      console.log('📨 Sidepanel received message:', message.type, message.data)
      
      if (message.type === 'STATUS_UPDATE') {
        setConnectionStatus(message.data)
        setIsLoading(false)
      }
      // Listen for agent box updates from content script
      else if (message.type === 'UPDATE_AGENT_BOXES') {
        console.log('📦 Updating agent boxes:', message.data)
        setAgentBoxes(message.data || [])
      }
      // Listen for session data updates
      else if (message.type === 'UPDATE_SESSION_DATA') {
        console.log('📥 Session data updated from broadcast:', message.data)
        if (message.data.sessionName !== undefined) {
          console.log('  → Setting session name:', message.data.sessionName)
          setSessionName(message.data.sessionName)
        }
        if (message.data.sessionKey !== undefined) {
          console.log('  → Setting session key:', message.data.sessionKey)
          setSessionKey(message.data.sessionKey)
        }
        if (message.data.isLocked !== undefined) {
          console.log('  → Setting locked state:', message.data.isLocked)
          setIsLocked(message.data.isLocked)
        }
        if (message.data.agentBoxes !== undefined) {
          console.log('  → Setting agent boxes:', message.data.agentBoxes.length)
          setAgentBoxes(message.data.agentBoxes)
        }
      }
      // Listen for agent box OUTPUT updates (from process flow)
      else if (message.type === 'UPDATE_AGENT_BOX_OUTPUT') {
        console.log('📤 Agent box output updated:', message.data)
        if (message.data.allBoxes) {
          // Update all boxes (includes the updated one)
          setAgentBoxes(message.data.allBoxes)
        } else if (message.data.agentBoxId && message.data.output) {
          // Update specific box output
          setAgentBoxes(prev => prev.map(box => 
            box.id === message.data.agentBoxId 
              ? { ...box, output: message.data.output }
              : box
          ))
        }
      }
      // Listen for Electron screenshot results
      else if (message.type === 'ELECTRON_SELECTION_RESULT') {
        console.log('📷 Sidepanel received screenshot from Electron:', message.kind)
        const url = message.dataUrl || message.url
        if (url) {
          // Add screenshot to chat messages as a user message with image
          const imageMessage = {
            role: 'user' as const,
            text: `![Screenshot](${url})`,
            imageUrl: url
          }
          setChatMessages(prev => [...prev, imageMessage])
          // Scroll to bottom
          setTimeout(() => {
            if (chatRef.current) {
              chatRef.current.scrollTop = chatRef.current.scrollHeight
            }
          }, 100)
          
          // Check if there's a pending trigger to auto-process
          // Using REF directly to avoid stale closure issues
          const pendingTrigger = pendingTriggerRef.current
          if (pendingTrigger?.autoProcess) {
            console.log('[Sidepanel] Found pending trigger to auto-process:', pendingTrigger)
            
            const command = pendingTrigger.command || pendingTrigger.trigger?.name || ''
            
            // Clear pending trigger FIRST
            pendingTriggerRef.current = null
            
            if (command) {
              const triggerText = command.startsWith('@') ? command : `@${command}`
              console.log('[Sidepanel] Processing trigger:', triggerText, 'with image:', url.substring(0, 50) + '...')
              
              // Process directly using refs to avoid stale closures
              // This inline processing replaces the problematic useEffect + custom event pattern
              processScreenshotWithTrigger(triggerText, url)
            }
          }
        }
      }
      // Listen for trigger prompt from Electron
      else if (message.type === 'SHOW_TRIGGER_PROMPT') {
        console.log('📝 Sidepanel received trigger prompt from Electron:', message)
        
        // Check if we're on a restricted page (display grid or MSN)
        const tabUrl = message.tabUrl || ''
        const isRestrictedPage = tabUrl.includes('/grid-display') || 
                                  tabUrl.includes('msn.com/') ||
                                  tabUrl.startsWith('edge://') ||
                                  tabUrl.includes('/grid-display')
        
        console.log('[SIDEPANEL] Is restricted page:', isRestrictedPage, 'URL:', tabUrl)
        
        // Only show inline form on restricted pages
        // On regular pages, the content script will show a modal instead
        if (!isRestrictedPage) {
          console.log('[SIDEPANEL] Skipping inline form on regular page - modal will be shown')
          return
        }
        
        setShowTriggerPrompt({
          mode: message.mode,
          rect: message.rect,
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
        console.log('🔄 Sidepanel: Reloading triggers after update')
        chrome.storage?.local?.get(['optimando-tagged-triggers'], (data: any) => {
          const list = Array.isArray(data?.['optimando-tagged-triggers']) ? data['optimando-tagged-triggers'] : []
          setTriggers(list)
        })
      }
      // Listen for command append from modal
      else if (message.type === 'COMMAND_POPUP_APPEND') {
        console.log('📝 Sidepanel received command append:', message)
        if (message.command || message.text) {
          const commandText = message.command || message.text
          // Add command message to chat
          const commandMessage = {
            role: 'user' as const,
            text: typeof commandText === 'string' ? commandText : `📝 Command: ${commandText}`
          }
          setChatMessages(prev => [...prev, commandMessage])
          console.log('📝 Command appended to chat:', commandText)
        }
      }
      // Listen for reload request after deletion
      else if (message.type === 'RELOAD_SESSION_FROM_SQLITE') {
        const targetSessionKey = message.sessionKey
        console.log('🔄 Sidepanel: Reloading session from SQLite after deletion, key:', targetSessionKey)
        
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
              console.log('⚠️ Session not found in SQLite:', targetSessionKey)
              return
            }
            
            const session = response.session
            console.log('✅ Reloaded session from SQLite:', session.tabName, 'with', session.agentBoxes?.length || 0, 'boxes')
            setSessionName(session.tabName || 'Session')
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
              setSessionName(mostRecent.tabName || 'Session')
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
        
        if (!response || !response.success || !response.sessions || response.sessions.length === 0) {
          console.log('⚠️ No sessions found in SQLite')
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
          console.log('✅ Loaded session from SQLite:', mostRecentKey, mostRecentSession.tabName)
          setSessionName(mostRecentSession.tabName || 'Unnamed Session')
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
              console.log('⚠️ Content script not ready, loading from storage:', chrome.runtime.lastError.message)
              loadSessionDataFromStorage()
              return
            }
            if (response && response.sessionKey) {
              console.log('✅ Received session data from content script:', response)
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
  
  const launchElectronApp = async () => {
    setIsLaunchingElectron(true)
    setShowManualLaunchInstructions(false)
    try {
      // Send message to background to launch Electron
      const response = await chrome.runtime.sendMessage({ type: 'LAUNCH_ELECTRON_APP' })
      
      if (response?.success) {
        // Wait a bit and recheck status
        setShowElectronDialog(false)
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: 'GET_STATUS' })
        }, 2000)
      } else {
        // Always show manual instructions when automatic launch fails
        setShowManualLaunchInstructions(true)
        setNotification({ 
          message: response?.error || 'Please start WR Desk manually from the Start Menu.', 
          type: 'error' 
        })
        setTimeout(() => setNotification(null), 8000)
      }
    } catch (err) {
      console.error('[Sidepanel] Failed to launch Electron:', err)
      setShowManualLaunchInstructions(true)
      setNotification({ 
        message: 'Please start the WR Desk Dashboard manually.', 
        type: 'error' 
      })
      setTimeout(() => setNotification(null), 8000)
    } finally {
      setIsLaunchingElectron(false)
    }
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
    console.log('🎯 Opening Settings lightbox...')
    sendToContentScript('OPEN_SETTINGS_LIGHTBOX')
  }

  const openMemory = () => {
    console.log('🎯 Opening Memory lightbox...')
    sendToContentScript('OPEN_MEMORY_LIGHTBOX')
  }

  const openContext = () => {
    console.log('🎯 Opening Context lightbox...')
    sendToContentScript('OPEN_CONTEXT_LIGHTBOX')
  }

  const openUnifiedAdmin = () => {
    console.log('🎯 Opening Unified Admin lightbox...')
    sendToContentScript('OPEN_UNIFIED_ADMIN_LIGHTBOX')
  }

  const openReasoningLightbox = () => {
    // Open Electron Analysis Dashboard
    console.log('📊 Opening Electron Analysis Dashboard...')
    // Note: showNotification is defined later in this component, but we use setNotification directly here
    // to avoid hoisting issues with const declarations
    setNotification({ message: 'Opening Analysis Dashboard...', type: 'info' })
    setTimeout(() => setNotification(null), 3000)
    
    chrome.runtime?.sendMessage({ type: 'ELECTRON_OPEN_ANALYSIS_DASHBOARD' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('❌ Error:', chrome.runtime.lastError.message)
        setNotification({ message: 'Failed to open Dashboard. Is the extension loaded?', type: 'error' })
        setTimeout(() => setNotification(null), 3000)
        return
      }
      
      if (response?.success) {
        console.log('✅ Analysis Dashboard opened successfully')
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
    console.log('🎯 Opening Agents lightbox...')
    sendToContentScript('OPEN_AGENTS_LIGHTBOX')
  }

  const openPopupChat = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_COMMAND_CENTER_POPUP', theme: theme })
  }

  const openThirdPartyLicenses = () => {
    console.log('📜 Opening Third Party Licenses...')
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
        console.log('✅ View mode saved:', newMode)
      })
    })
  }


  const addAgentBox = () => {
    console.log('🎯 Opening Add Agent Box dialog...')
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
    console.log('✏️ Editing agent box:', boxId)
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


  // Load triggers
  useEffect(() => {
    if (!isCommandChatPinned) return
    
    const loadTriggers = () => {
      chrome.storage?.local?.get(['optimando-tagged-triggers'], (data: any) => {
        const list = Array.isArray(data?.['optimando-tagged-triggers']) ? data['optimando-tagged-triggers'] : []
        setTriggers(list)
      })
    }
    
    loadTriggers()
    window.addEventListener('optimando-triggers-updated', loadTriggers)
    return () => window.removeEventListener('optimando-triggers-updated', loadTriggers)
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

  const handleChatDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const items = await parseDataTransfer(e.dataTransfer)
    if (!items.length) return
    
    // Check if any item is an image - add directly to chat for LLM vision
    const imageItems = items.filter(it => it.kind === 'image')
    if (imageItems.length > 0) {
      // Convert images to data URLs and add to chat
      for (const img of imageItems) {
        if (img.payload instanceof File) {
          const reader = new FileReader()
          reader.onload = () => {
            const dataUrl = reader.result as string
            const imageMessage = {
              role: 'user' as const,
              text: `![Image](${img.name || 'dropped-image'})`,
              imageUrl: dataUrl
            }
            setChatMessages(prev => [...prev, imageMessage])
            // Scroll to bottom
            setTimeout(() => {
              if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
            }, 0)
          }
          reader.readAsDataURL(img.payload)
        }
      }
      // If there are also non-image items, show embed dialog for those
      const nonImageItems = items.filter(it => it.kind !== 'image')
      if (nonImageItems.length > 0) {
        setPendingItems(nonImageItems)
        setShowEmbedDialog(true)
      }
    } else {
      // No images - show embed dialog for other content types
      setPendingItems(items)
      setShowEmbedDialog(true)
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
      setPendingItems(items)
      setShowEmbedDialog(true)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleEmbedConfirm = () => {
    runEmbed(pendingItems, embedTarget)
    setShowEmbedDialog(false)
    setPendingItems([])
  }

  const handleScreenSelect = () => {
    console.log('📷 Sidepanel: Starting Electron screen selection', { createTrigger: createTriggerChecked, addCommand: addCommandChecked })
    chrome.runtime?.sendMessage({ 
      type: 'ELECTRON_START_SELECTION', 
      source: 'sidepanel-docked-chat',
      createTrigger: createTriggerChecked,
      addCommand: addCommandChecked
    })
  }
  
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
  // | Reasoning Wrap   |  <- Goals, Role, Rules from agent config
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
   * Process input with OCR if images are present
   */
  const processMessagesWithOCR = async (
    messages: Array<{role: 'user' | 'assistant', text: string, imageUrl?: string}>,
    baseUrl: string
  ): Promise<{ processedMessages: Array<{role: string, content: string}>, ocrText: string }> => {
    let ocrText = ''
    
    const processedMessages = await Promise.all(messages.map(async (msg) => {
      if (msg.imageUrl && msg.role === 'user') {
        try {
          const ocrResponse = await fetch(`${baseUrl}/api/ocr/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: msg.imageUrl })
          })
          
          if (ocrResponse.ok) {
            const ocrResult = await ocrResponse.json()
            if (ocrResult.ok && ocrResult.data?.text) {
              ocrText = ocrResult.data.text
              const ocrMethod = ocrResult.data.method === 'cloud_vision' ? '🌐 Cloud Vision' : '📝 Local OCR'
              return {
                role: msg.role,
                content: `${msg.text || 'Image content:'}\n\n[${ocrMethod} extracted text]:\n${ocrResult.data.text}`
              }
            }
          }
        } catch (e) {
          console.warn('[Chat] OCR processing failed:', e)
        }
        return {
          role: msg.role,
          content: msg.text || '[Image attached - OCR unavailable]'
        }
      }
      return {
        role: msg.role,
        content: msg.text
      }
    }))
    
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
    baseUrl: string
  ): Promise<{ success: boolean, output?: string, error?: string }> => {
    try {
      // Load full agent config
      const agents = await loadAgentsFromSession()
      const agent = agents.find(a => a.id === match.agentId)
      
      if (!agent) {
        console.warn(`[Chat] Agent not found: ${match.agentId}`)
        return { success: false, error: `Agent ${match.agentName} not found` }
      }
      
      // Wrap input with agent's reasoning instructions (Goals, Role, Rules)
      const reasoningContext = wrapInputForAgent(inputText, agent, ocrText)
      
      console.log('[Chat] Processing with agent:', {
        name: match.agentName,
        reasoningContext: reasoningContext.substring(0, 200) + '...',
        targetBox: match.agentBoxId
      })
      
      // Resolve which model to use (AgentBox model > fallback)
      const modelResolution = resolveModelForAgent(
        match.agentBoxProvider,
        match.agentBoxModel,
        fallbackModel
      )
      
      console.log('[Chat] Model resolution:', modelResolution)
      
      // Call LLM with reasoning-wrapped input
      const response = await fetch(`${baseUrl}/api/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: modelResolution.model || fallbackModel,
          messages: [
            { role: 'system', content: reasoningContext },
            ...processedMessages.slice(-3) // Include recent context
          ]
        })
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
    baseUrl: string
  ): Promise<{ success: boolean, response?: string, error?: string }> => {
    try {
      const agents = await loadAgentsFromSession()
      const butlerPrompt = getButlerSystemPrompt(
        sessionName,
        agents.filter(a => a.enabled).length,
        connectionStatus.isConnected
      )
      
      const response = await fetch(`${baseUrl}/api/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: model,
          messages: [
            { role: 'system', content: butlerPrompt },
            ...messages
          ]
        })
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
  const handleSendMessageWithTrigger = async (triggerText: string, imageUrl?: string) => {
    console.log('[Sidepanel] handleSendMessageWithTrigger:', { triggerText, hasImage: !!imageUrl })
    
    // Use ref for more reliable model access (avoids potential stale closure)
    const currentModel = activeLlmModelRef.current || activeLlmModel
    
    if (!currentModel) {
      setChatMessages(prev => [...prev, {
        role: 'assistant' as const,
        text: `⚠️ No LLM model available. Please install a model in LLM Settings.`
      }])
      return
    }
    
    // Build messages including the image if provided
    const newMessages: Array<{role: 'user' | 'assistant', text: string, imageUrl?: string}> = []
    
    // Add the trigger text as user message
    if (imageUrl) {
      newMessages.push({
        role: 'user' as const,
        text: triggerText,
        imageUrl
      })
    } else {
      newMessages.push({
        role: 'user' as const,
        text: triggerText
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
      
      // Route the input
      const routingDecision = await routeInput(
        triggerText,
        !!imageUrl,
        connectionStatus,
        sessionName,
        currentModel,
        currentUrl
      )
      
      console.log('[Sidepanel] Trigger routing decision:', routingDecision)
      
      // Process OCR if image provided
      let ocrText = ''
      if (imageUrl) {
        try {
          const ocrResponse = await fetch(`${baseUrl}/api/ocr/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: imageUrl })
          })
          if (ocrResponse.ok) {
            const ocrResult = await ocrResponse.json()
            if (ocrResult.ok && ocrResult.data?.text) {
              ocrText = ocrResult.data.text
            }
          }
        } catch (e) {
          console.warn('[Sidepanel] OCR failed:', e)
        }
      }
      
      // NLP Classification step
      const inputTextForNlp = ocrText || triggerText
      const nlpResult = await nlpClassifier.classify(
        inputTextForNlp,
        ocrText ? 'ocr' : 'inline_chat',
        { sourceUrl: currentUrl, sessionKey: sessionName }
      )
      
      console.log('[Sidepanel] Trigger NLP Classification:', {
        triggers: nlpResult.input.triggers,
        entities: nlpResult.input.entities.length
      })
      
      // Route classified input for agent allocations
      const agentsForNlp = await loadAgentsFromSession()
      const agentBoxesList = agentBoxes as AgentBox[]
      const classifiedWithAllocations = inputCoordinator.routeClassifiedInput(
        nlpResult.input,
        agentsForNlp,
        agentBoxesList,
        currentModel,
        'ollama'
      )
      
      console.log('[Sidepanel] Trigger Agent Allocations:', {
        count: classifiedWithAllocations.agentAllocations?.length || 0
      })
      
      if (routingDecision.shouldForwardToAgent && routingDecision.matchedAgents.length > 0) {
        // Show butler confirmation
        setChatMessages(prev => [...prev, {
          role: 'assistant' as const,
          text: routingDecision.butlerResponse
        }])
        
        // Process with each matched agent
        const agents = await loadAgentsFromSession()
        
        for (const match of routingDecision.matchedAgents) {
          const agent = agents.find(a => a.id === match.agentId)
          if (!agent) continue
          
          const wrappedInput = wrapInputForAgent(triggerText, agent, ocrText)
          
          // Resolve model
          const modelResolution = resolveModelForAgent(
            match.agentBoxProvider,
            match.agentBoxModel,
            currentModel
          )
          
          console.log('[Sidepanel] Processing with agent:', match.agentName, 'model:', modelResolution.model)
          
          const processedContent = ocrText 
            ? `${triggerText}\n\n[Extracted Text]:\n${ocrText}`
            : triggerText
          
          const agentResponse = await fetch(`${baseUrl}/api/llm/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              modelId: modelResolution.model || currentModel,
              messages: [
                { role: 'system', content: wrappedInput },
                { role: 'user', content: processedContent }
              ]
            })
          })
          
          if (agentResponse.ok) {
            const agentResult = await agentResponse.json()
            if (agentResult.ok && agentResult.data?.content) {
              const agentOutput = agentResult.data.content
              
              if (match.agentBoxId) {
                const reasoningContext = `**Agent:** ${match.agentIcon} ${match.agentName}\n**Match:** ${match.matchDetails}\n**Input:** ${triggerText}`
                
                await updateAgentBoxOutput(match.agentBoxId, agentOutput, reasoningContext)
                
                setChatMessages(prev => [...prev, {
                  role: 'assistant' as const,
                  text: `✓ ${match.agentIcon} **${match.agentName}** processed your request.\n→ Output displayed in Agent Box ${String(match.agentBoxNumber).padStart(2, '0')}`
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
        // No agent match - use butler response
        const agents = await loadAgentsFromSession()
        const butlerPrompt = getButlerSystemPrompt(
          sessionName,
          agents.filter(a => a.enabled).length,
          connectionStatus.isConnected
        )
        
        const response = await fetch(`${baseUrl}/api/llm/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modelId: currentModel,
            messages: [
              { role: 'system', content: butlerPrompt },
              { role: 'user', content: ocrText ? `${triggerText}\n\n[Image Text]:\n${ocrText}` : triggerText }
            ]
          })
        })
        
        if (response.ok) {
          const result = await response.json()
          if (result.ok && result.data?.content) {
            setChatMessages(prev => [...prev, {
              role: 'assistant' as const,
              text: result.data.content
            }])
          }
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

  const handleSendMessage = async () => {
    const text = chatInput.trim()
    // Allow sending with just an image (no text required)
    const hasImage = chatMessages.some(msg => msg.imageUrl)
    
    // If empty input, show helpful hint
    if (!text && !hasImage) {
      if (isLlmLoading) return
      setChatMessages([...chatMessages, {
        role: 'assistant' as const,
        text: `💡 **How to use WR Chat:**\n\n• Ask questions about the orchestrator or your workflow\n• Trigger automations using **#tagname** (e.g., "#summarize")\n• Use the 📸 button to capture screenshots for analysis\n• Attach files with 📎 for context\n\nTry: "What can you help me with?" or "#help"`
      }])
      setTimeout(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
      }, 0)
      return
    }
    
    if (isLlmLoading) return
    
    // Check if model is available
    if (!activeLlmModel) {
      setChatMessages([...chatMessages, {
        role: 'assistant' as const,
        text: `⚠️ No LLM model available. Please:\n\n1. Go to Admin panel (toggle at top)\n2. Open LLM Settings\n3. Install a trusted ultra-lightweight model:\n   • TinyLlama 1.1B (0.6GB) - Recommended\n   • Gemma 2B Q2_K (0.9GB) - Google\n   • StableLM 1.6B (1.0GB) - Stability AI\n4. Come back and try again!`
      }])
      setTimeout(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
      }, 0)
      return
    }
    
    // Add user message (only if there's text)
    const newMessages = text 
      ? [...chatMessages, { role: 'user' as const, text }]
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
      // STEP 2: ROUTE INPUT THROUGH INPUT COORDINATOR
      // The InputCoordinator decides which agents should receive the input:
      // - Active trigger (#tag17) -> Forward to matched agent
      // - Passive trigger pattern matched -> Forward to matched agent
      // - No listener active on agent -> Always forward to reasoning section
      // - No match at all -> Butler response only
      // =================================================================
      const routingDecision = await routeInput(
        text,
        hasImage,
        connectionStatus,
        sessionName,
        activeLlmModel,
        currentUrl
      )
      
      console.log('[Chat] Input Coordinator routing decision:', {
        shouldForward: routingDecision.shouldForwardToAgent,
        matchedAgents: routingDecision.matchedAgents.length,
        agents: routingDecision.matchedAgents.map(m => `${m.agentName} (${m.matchDetails})`)
      })
      
      // =================================================================
      // STEP 3: PROCESS OCR IF IMAGES PRESENT
      // =================================================================
      const { processedMessages, ocrText } = await processMessagesWithOCR(newMessages, baseUrl)
      
      // =================================================================
      // STEP 3.5: NLP CLASSIFICATION
      // Classify input text (or OCR text) into structured JSON
      // This extracts triggers, entities, and prepares for routing
      // =================================================================
      const inputTextForNlp = ocrText || text
      const nlpResult = await nlpClassifier.classify(
        inputTextForNlp,
        ocrText ? 'ocr' : 'inline_chat',
        { sourceUrl: currentUrl, sessionKey: sessionName }
      )
      
      console.log('[Chat] NLP Classification:', {
        success: nlpResult.success,
        triggers: nlpResult.input.triggers,
        entities: nlpResult.input.entities.length,
        processingTimeMs: nlpResult.processingTimeMs
      })
      
      // Route classified input through InputCoordinator for agent allocations
      const agents = await loadAgentsFromSession()
      const agentBoxesList = agentBoxes as AgentBox[]
      const classifiedWithAllocations = inputCoordinator.routeClassifiedInput(
        nlpResult.input,
        agents,
        agentBoxesList,
        activeLlmModel,
        'ollama'
      )
      
      console.log('[Chat] Agent Allocations:', {
        count: classifiedWithAllocations.agentAllocations?.length || 0,
        agents: classifiedWithAllocations.agentAllocations?.map(a => 
          `${a.agentName} → ${a.outputSlot.destination} (${a.llmModel})`
        )
      })
      
      // =================================================================
      // STEP 3.6: EVENT TAG ROUTING (Input Coordinator)
      // Route through event tag flow to detect matches with agent listeners
      // This checks all agents' triggers (#tags) and displays match feedback
      // =================================================================
      
      // Debug: Log all agents and their listener configurations
      console.log('[Chat] DEBUG - Agents in session:', agents.map(a => ({
        name: a.name,
        number: a.number,
        enabled: a.enabled,
        hasListening: !!a.listening,
        capabilities: a.capabilities,
        passiveEnabled: a.listening?.passiveEnabled,
        activeEnabled: a.listening?.activeEnabled,
        passiveTriggers: a.listening?.passive?.triggers?.map((t: any) => t.tag?.name),
        activeTriggers: a.listening?.active?.triggers?.map((t: any) => t.tag?.name),
        unifiedTriggers: a.listening?.triggers?.map((t: any) => t.tag || t.tagName)
      })))
      
      if (nlpResult.input.triggers.length > 0) {
        console.log('[Chat] Detected triggers, running Event Tag routing:', nlpResult.input.triggers)
        
        try {
          const eventTagResult = await routeEventTagInput(
            inputTextForNlp,
            ocrText ? 'ocr' : 'inline_chat',
            currentUrl,
            sessionName
          )
          
          console.log('[Chat] Event Tag Routing Result:', {
            matchedAgents: eventTagResult.batch.results.length,
            triggersFound: eventTagResult.batch.triggersFound,
            summary: eventTagResult.batch.summary,
            allResults: eventTagResult.batch.results
          })
          
          // Display match detection feedback if any agents matched
          if (eventTagResult.batch.results.length > 0) {
            const matchFeedback = generateEventTagMatchFeedback(eventTagResult.batch)
            setChatMessages(prev => [...prev, {
              role: 'assistant' as const,
              text: matchFeedback
            }])
            scrollToBottom()
          } else {
            // Debug: Show why no matches were found
            console.log('[Chat] No matches found. Summary:', eventTagResult.batch.summary)
          }
        } catch (eventTagError) {
          console.error('[Chat] Event Tag routing error:', eventTagError)
        }
      } else {
        console.log('[Chat] No triggers detected in input:', inputTextForNlp)
      }
      
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
        setChatMessages([...newMessages, {
          role: 'assistant' as const,
          text: routingDecision.butlerResponse
        }])
        scrollToBottom()
        
        // A2. Process with each matched agent
        for (const match of routingDecision.matchedAgents) {
          console.log(`[Chat] Processing with agent: ${match.agentName}`)
          
          // Use helper function to process with agent
          const result = await processWithAgent(
            match,
            text,
            ocrText,
            processedMessages,
            activeLlmModel,
            baseUrl
          )
          
          if (result.success && result.output) {
            // A3. Route output to AgentBox or inline chat
            if (match.agentBoxId) {
              // Update AgentBox with output
              const reasoningContext = `**Agent:** ${match.agentIcon} ${match.agentName}\n**Match:** ${match.matchDetails}\n**Input:** ${text}`
              
              await updateAgentBoxOutput(
                match.agentBoxId,
                result.output,
                reasoningContext
              )
              
              // Show brief confirmation in chat
              setChatMessages(prev => [...prev, {
                role: 'assistant' as const,
                text: `✓ ${match.agentIcon} **${match.agentName}** processed your request.\n→ Output displayed in Agent Box ${String(match.agentBoxNumber).padStart(2, '0')}`
              }])
            } else {
              // No AgentBox - show full output in chat
              setChatMessages(prev => [...prev, {
                role: 'assistant' as const,
                text: `${match.agentIcon} **${match.agentName}**:\n\n${result.output}`
              }])
            }
            scrollToBottom()
          } else if (result.error) {
            // Show error for this agent
            setChatMessages(prev => [...prev, {
              role: 'assistant' as const,
              text: `⚠️ ${match.agentIcon} **${match.agentName}** error: ${result.error}`
            }])
            scrollToBottom()
          }
        }
        
      } else if (routingDecision.butlerResponse) {
        // =================================================================
        // PATH B: SYSTEM STATUS RESPONSE
        // Butler handled this directly (e.g., "status", "what agents")
        // =================================================================
        setChatMessages([...newMessages, {
          role: 'assistant' as const,
          text: routingDecision.butlerResponse
        }])
        scrollToBottom()
        
      } else {
        // =================================================================
        // PATH C: BUTLER LLM RESPONSE
        // No agent match - use butler personality for general questions
        // =================================================================
        const butlerResult = await getButlerResponse(processedMessages, activeLlmModel, baseUrl)
        
        if (butlerResult.success && butlerResult.response) {
          setChatMessages([...newMessages, {
            role: 'assistant' as const,
            text: butlerResult.response
          }])
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
      
      setChatMessages(prev => [...prev, {
        role: 'assistant' as const,
        text: errorMsg
      }])
      
      // Scroll to bottom after error message
      setTimeout(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
      }, 0)
    } finally {
      setIsLlmLoading(false)
    }
  }

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
    setShowModelDropdown(false)
    console.log('[Command Chat] Model selected:', modelName)
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
        
        {/* Model dropdown toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowModelDropdown(!showModelDropdown)
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
    
    // Set pending trigger for auto-processing when screenshot returns
    // Using REF to avoid stale closure issues in the message handler
    pendingTriggerRef.current = {
      trigger,
      command: trigger.command || trigger.name, // Use command or trigger name
      autoProcess: true
    }
    
    console.log('[Sidepanel] Trigger clicked, setting pending process (ref):', pendingTriggerRef.current)
    
    // Send to Electron for screenshot capture
    chrome.runtime?.sendMessage({ type: 'ELECTRON_EXECUTE_TRIGGER', trigger })
  }

  const handleDeleteTrigger = (index: number) => {
    if (!confirm(`Delete trigger "${triggers[index].name || `Trigger ${index + 1}`}"?`)) return
    
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


  const createNewSession = () => {
    console.log('🆕 Creating new session...')
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
          console.log('✅ Session created:', response)
          
          // Poll for updated session data after creation - multiple attempts
          let pollAttempts = 0
          const pollInterval = setInterval(() => {
            pollAttempts++
            console.log(`🔄 Polling for new session data (attempt ${pollAttempts})...`)
            
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
                console.log('📥 Received new session data:', sessionResponse)
                console.log('  → sessionName:', sessionResponse.sessionName)
                console.log('  → sessionKey:', sessionResponse.sessionKey)
                console.log('  → isLocked:', sessionResponse.isLocked)
                console.log('  → agentBoxes:', sessionResponse.agentBoxes?.length || 0)
                
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
        border: '1px solid #e1e8ed',
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
      border: '1px solid #e1e8ed',
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
      border: '1px solid #e1e8ed',
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
      border: '1px solid #e1e8ed',
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
      border: '1px solid #e1e8ed',
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
    console.log('🎯 Opening Add Mini App dialog...')
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
          <h2 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: 700 }}>
            WR Desk Analysis Dashboard
          </h2>
          
          {!showManualLaunchInstructions ? (
            <>
              <p style={{ 
                margin: '0 0 20px 0', 
                fontSize: '13px', 
                opacity: 0.9,
                lineHeight: 1.5 
              }}>
                The desktop application is not running. Start it to enable full functionality including LLM processing, secure storage, and advanced features.
              </p>
              
              <button
                onClick={launchElectronApp}
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
                {isLaunchingElectron ? '⏳ Starting...' : '🚀 Start Dashboard'}
              </button>
            </>
          ) : (
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
                  <li>Open the <strong>Start Menu</strong></li>
                  <li>Search for <strong>"WR Desk"</strong></li>
                  <li>Click to launch the application</li>
                  <li>Wait for the tray icon (🧠) to appear</li>
                  <li>Click <strong>Retry Connection</strong> below</li>
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
              
              <button
                onClick={() => {
                  setShowManualLaunchInstructions(false)
                }}
                style={{
                  width: '100%',
                  padding: '8px 16px',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '6px',
                  color: 'rgba(255,255,255,0.8)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  marginBottom: '12px'
                }}
              >
                ← Try Auto-Start Again
              </button>
            </>
          )}
          
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
            <strong>Tip:</strong> The dashboard normally starts automatically with Windows. 
            Check the system tray (🧠) if it's running in the background.
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
          Loading...
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
              width: '32px',
              height: '32px',
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
              width: '32px',
              height: '32px',
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
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleChatDrop}
            >
              {/* Header - Enterprise Design */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                background: theme === 'standard' ? '#ffffff' : theme === 'dark' ? 'linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.9) 100%)' : 'linear-gradient(180deg, rgba(15,10,30,0.95) 0%, rgba(30,20,50,0.9) 100%)',
                borderBottom: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(168,85,247,0.3)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                color: themeColors.text
              }}>
                {/* Selectors */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                      <option value="draft">✏️ Draft</option>
                      <option value="outbox">📤 Outbox</option>
                      <option value="archived">📁 Archived</option>
                      <option value="rejected">🚫 Rejected</option>
                    </select>
                  )}
                </div>
                {/* Controls */}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {(dockedPanelMode !== 'admin' && dockedWorkspace !== 'beap-messages' && dockedWorkspace !== 'wrguard') && <>
                    <button 
                      onClick={handleScreenSelect}
                      title="LmGTFY - Capture a screen area as screenshot or stream"
                      style={{
                        ...chatControlButtonStyle(),
                        borderRadius: '6px',
                        padding: '0 8px',
                        height: '22px',
                        minWidth: '22px',
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        if (theme === 'standard') {
                          e.currentTarget.style.background = '#eef3f6'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (theme === 'standard') {
                          e.currentTarget.style.background = '#f8f9fb'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                        }
                      }}
                    >
                      ✎
                    </button>
                    <div style={{ position: 'relative' }}>
                      <button 
                        onClick={() => setShowTagsMenu(!showTagsMenu)}
                        title="Tags - Quick access to saved triggers"
                        style={{
                          ...chatControlButtonStyle(),
                          borderRadius: '14px',
                          padding: '0 12px',
                          height: '28px',
                          fontSize: '12px',
                          background: 'rgba(255,255,255,0.15)',
                          border: 'none',
                          color: '#ffffff',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          if (theme === 'standard') {
                            e.currentTarget.style.background = '#eef3f6'
                          } else if (theme === 'dark') {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                          } else {
                            e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (theme === 'standard') {
                            e.currentTarget.style.background = '#f8f9fb'
                          } else if (theme === 'dark') {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                          } else {
                            e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                          }
                        }}
                      >
                        Tags <span style={{ fontSize: '11px', opacity: 0.9 }}>▾</span>
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
                            triggers.map((trigger, i) => (
                              <div 
                                key={i}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '6px 8px',
                                  borderBottom: '1px solid rgba(255,255,255,0.20)',
                                  cursor: 'pointer'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                              >
                                <button
                                  onClick={() => handleTriggerClick(trigger)}
                                  style={{
                                    flex: 1,
                                    textAlign: 'left',
                                    padding: 0,
                                    fontSize: '12px',
                                    background: 'transparent',
                                    border: 0,
                                    color: 'inherit',
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    minWidth: 0
                                  }}
                                >
                                  {trigger.name || `Trigger ${i + 1}`}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteTrigger(i)
                                  }}
                                  style={{
                                    width: '20px',
                                    height: '20px',
                                    border: 'none',
                                    background: 'rgba(239,68,68,0.2)',
                                    color: '#ef4444',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '16px',
                                    lineHeight: 1,
                                    padding: 0,
                                    marginLeft: '8px',
                                    flexShrink: 0
                                  }}
                                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.4)'}
                                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.2)'}
                                >
                                  ×
                                </button>
                              </div>
                            ))
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
                    <button style={{ padding: '4px 10px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #e1e8ed' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', cursor: 'pointer' }}>Connect</button>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* Empty messages area */}
                  </div>
                  <div style={{ padding: '10px 12px', borderTop: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <textarea placeholder="Message or capsule..." style={{ flex: 1, padding: '8px 10px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', resize: 'none', minHeight: '32px', maxHeight: '80px' }} />
                    <button title="Build Capsule" style={{ width: '32px', height: '32px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #e1e8ed' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>💊</button>
                    <button title="AI Assistant" style={{ width: '32px', height: '32px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #e1e8ed' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✨</button>
                    <button title="Attach" style={{ width: '32px', height: '32px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #e1e8ed' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📎</button>
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
                      <button style={{ padding: '6px 10px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.15)', border: theme === 'standard' ? '1px solid #e1e8ed' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>🎥 Start</button>
                      <button style={{ padding: '6px 10px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.15)', border: theme === 'standard' ? '1px solid #e1e8ed' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>🎙️ Mute</button>
                      <button style={{ padding: '6px 10px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.15)', border: theme === 'standard' ? '1px solid #e1e8ed' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>📺 Share</button>
                    </div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '120px', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : (theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.06)') }}>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}></div>
                    <div style={{ padding: '8px', display: 'flex', gap: '6px', alignItems: 'center', borderTop: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.1)' }}>
                      <textarea placeholder="Chat..." style={{ flex: 1, padding: '6px 8px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', resize: 'none', minHeight: '28px' }} />
                      <button title="AI Assistant" style={{ width: '28px', height: '28px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #e1e8ed' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', cursor: 'pointer' }}>✨</button>
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
                  <div style={{ padding: '6px 10px', borderTop: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.15)', borderBottom: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.15)', display: 'flex', gap: '6px', justifyContent: 'center', background: theme === 'standard' ? '#f8f9fb' : 'rgba(0,0,0,0.3)' }}>
                    <button style={{ padding: '4px 8px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #e1e8ed' : 'none', borderRadius: '4px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', cursor: 'pointer' }}>🎥</button>
                    <button style={{ padding: '4px 8px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #e1e8ed' : 'none', borderRadius: '4px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', cursor: 'pointer' }}>🎙️</button>
                    <button style={{ padding: '4px 8px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #e1e8ed' : 'none', borderRadius: '4px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', cursor: 'pointer' }}>📺</button>
                    <button style={{ padding: '4px 8px', background: 'rgba(239,68,68,0.2)', border: 'none', borderRadius: '4px', color: '#ef4444', fontSize: '10px', cursor: 'pointer' }}>Leave</button>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100px', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : (theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.06)') }}>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}></div>
                    <div style={{ padding: '8px', display: 'flex', gap: '6px', alignItems: 'center', borderTop: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.1)' }}>
                      <textarea placeholder="Group chat..." style={{ flex: 1, padding: '6px 8px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', resize: 'none', minHeight: '28px' }} />
                      <button title="AI Assistant" style={{ width: '28px', height: '28px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #e1e8ed' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '12px', cursor: 'pointer' }}>✨</button>
                      <button style={{ padding: '6px 12px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Send</button>
                    </div>
                  </div>
                </div>
              )}

              {/* BEAP Handshake Request */}
              {dockedPanelMode === 'handshake' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : (theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.06)'), minHeight: '280px', overflow: 'hidden' }}>
                  {/* Header */}
                  <div style={{ padding: '12px 14px', borderBottom: `1px solid ${theme === 'standard' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '18px' }}>🤝</span>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#1f2937' : 'white' }}>BEAP™ Handshake Request</span>
                  </div>
                  
                  {/* DELIVERY METHOD - FIRST */}
                  <div style={{ padding: '14px 18px', borderBottom: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.1)' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Delivery Method
                    </label>
                    <select
                      value={handshakeDelivery}
                      onChange={(e) => setHandshakeDelivery(e.target.value as 'email' | 'messenger' | 'download')}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        background: theme === 'standard' ? 'white' : '#1f2937',
                        border: `1px solid ${theme === 'standard' ? '#e1e8ed' : 'rgba(255,255,255,0.15)'}`,
                        borderRadius: '8px',
                        color: theme === 'standard' ? '#1f2937' : 'white',
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="email" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>📧 Email</option>
                      <option value="messenger" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>💬 Messenger (Web)</option>
                      <option value="download" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>💾 Download (USB/Wallet)</option>
                    </select>
                  </div>
                  
                  {/* EMAIL ACCOUNTS SECTION - Only visible when email delivery selected */}
                  {handshakeDelivery === 'email' && (
                  <div style={{ 
                    padding: '16px 18px', 
                    borderBottom: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.1)',
                    background: theme === 'standard' ? 'rgba(139,92,246,0.05)' : 'rgba(139,92,246,0.1)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '16px' }}>🔗</span>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Connected Email Accounts</span>
                      </div>
                      <button onClick={() => setShowEmailSetupWizard(true)} style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', border: 'none', color: 'white', borderRadius: '6px', padding: '6px 12px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}><span>+</span> Connect Email</button>
                    </div>
                    {isLoadingEmailAccounts ? (
                      <div style={{ padding: '12px', textAlign: 'center', opacity: 0.6, fontSize: '12px' }}>Loading accounts...</div>
                    ) : emailAccounts.length === 0 ? (
                      <div style={{ padding: '20px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.05)', borderRadius: '8px', border: theme === 'standard' ? '1px dashed #e1e8ed' : '1px dashed rgba(255,255,255,0.2)', textAlign: 'center' }}>
                        <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
                        <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>No email accounts connected</div>
                        <div style={{ fontSize: '11px', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.5)' }}>Connect your email to send handshake requests</div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {emailAccounts.map(account => (
                          <div key={account.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', borderRadius: '8px', border: account.status === 'active' ? (theme === 'standard' ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(34,197,94,0.4)') : (theme === 'standard' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(239,68,68,0.4)') }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ fontSize: '18px' }}>{account.provider === 'gmail' ? '📧' : account.provider === 'microsoft365' ? '📨' : '✉️'}</span>
                              <div>
                                <div style={{ fontSize: '13px', fontWeight: '500', color: theme === 'standard' ? '#0f172a' : 'white' }}>{account.email || account.displayName}</div>
                                <div style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: account.status === 'active' ? '#22c55e' : '#ef4444' }} />
                                  <span style={{ color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>{account.status === 'active' ? 'Connected' : account.lastError || 'Error'}</span>
                                </div>
                              </div>
                            </div>
                            <button onClick={() => disconnectEmailAccount(account.id)} title="Disconnect" style={{ background: 'transparent', border: 'none', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '4px', fontSize: '14px' }}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {emailAccounts.length > 0 && (
                      <div style={{ marginTop: '12px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Send From:</label>
                        <select value={selectedEmailAccountId || emailAccounts[0]?.id || ''} onChange={(e) => setSelectedEmailAccountId(e.target.value)} style={{ width: '100%', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.1)', border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#0f172a' : 'white', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer', outline: 'none' }}>
                          {emailAccounts.map(account => (<option key={account.id} value={account.id}>{account.email || account.displayName} ({account.provider})</option>))}
                        </select>
                      </div>
                    )}
                  </div>
                  )}
                  
                  <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Your Fingerprint - PROMINENT */}
                    <div style={{
                      padding: '12px 14px',
                      background: theme === 'standard' ? '#f8f9fb' : 'rgba(139, 92, 246, 0.15)',
                      border: `2px solid ${theme === 'standard' ? '#e1e8ed' : 'rgba(139, 92, 246, 0.3)'}`,
                      borderRadius: '10px',
                    }}>
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        marginBottom: '8px',
                      }}>
                        <div style={{ 
                          fontSize: '11px', 
                          fontWeight: 600, 
                          color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', 
                          textTransform: 'uppercase', 
                          letterSpacing: '0.5px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}>
                          🔐 {TOOLTIPS.FINGERPRINT_TITLE}
                          <span 
                            style={{ cursor: 'help', fontSize: '11px', fontWeight: 400 }}
                            title={TOOLTIPS.FINGERPRINT}
                          >
                            ⓘ
                          </span>
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(ourFingerprint)
                              setFingerprintCopied(true)
                              setTimeout(() => setFingerprintCopied(false), 2000)
                            } catch (err) {
                              console.error('Failed to copy:', err)
                            }
                          }}
                          style={{
                            padding: '4px 10px',
                            fontSize: '10px',
                            background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.1)',
                            border: 'none',
                            borderRadius: '4px',
                            color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)',
                            cursor: 'pointer',
                          }}
                        >
                          {fingerprintCopied ? '✓ Copied' : '📋 Copy'}
                        </button>
                      </div>
                      <div style={{
                        fontFamily: 'monospace',
                        fontSize: '11px',
                        color: theme === 'standard' ? '#1f2937' : 'white',
                        wordBreak: 'break-all',
                        lineHeight: 1.5,
                      }}>
                        {formatFingerprintGrouped(ourFingerprint)}
                      </div>
                      <div style={{
                        marginTop: '8px',
                        fontSize: '10px',
                        color: theme === 'standard' ? '#9ca3af' : 'rgba(255,255,255,0.5)',
                      }}>
                        Short: <span style={{ fontFamily: 'monospace' }}>{ourFingerprintShort}</span>
                      </div>
                    </div>
                    
                    {/* To & Subject Fields - Only for Email */}
                    {handshakeDelivery === 'email' && (
                      <>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            To:
                          </label>
                          <input
                            type="email"
                            value={handshakeTo}
                            onChange={(e) => setHandshakeTo(e.target.value)}
                            placeholder="recipient@example.com"
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)',
                              border: `1px solid ${theme === 'standard' ? '#e1e8ed' : 'rgba(255,255,255,0.15)'}`,
                              borderRadius: '8px',
                              color: theme === 'standard' ? '#1f2937' : 'white',
                              fontSize: '13px',
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Subject:
                          </label>
                          <input
                            type="text"
                            value={handshakeSubject}
                            onChange={(e) => setHandshakeSubject(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)',
                              border: `1px solid ${theme === 'standard' ? '#e1e8ed' : 'rgba(255,255,255,0.15)'}`,
                              borderRadius: '8px',
                              color: theme === 'standard' ? '#1f2937' : 'white',
                              fontSize: '13px',
                            }}
                          />
                        </div>
                      </>
                    )}
                    
                    {/* Message */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Message
                      </label>
                      <textarea
                        value={handshakeMessage}
                        onChange={(e) => setHandshakeMessage(e.target.value)}
                        style={{
                          flex: 1,
                          minHeight: '120px',
                          padding: '10px 12px',
                          background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)',
                          border: `1px solid ${theme === 'standard' ? '#e1e8ed' : 'rgba(255,255,255,0.15)'}`,
                          borderRadius: '8px',
                          color: theme === 'standard' ? '#1f2937' : 'white',
                          fontSize: '13px',
                          lineHeight: '1.5',
                          resize: 'none',
                        }}
                      />
                    </div>
                    
                    {/* Info */}
                    <div style={{
                      padding: '10px 12px',
                      background: theme === 'standard' ? '#f8f9fb' : 'rgba(139, 92, 246, 0.15)',
                      borderRadius: '8px',
                      fontSize: '11px',
                      color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.8)',
                    }}>
                      💡 This creates a secure BEAP™ package. Recipient will appear in your Handshakes once accepted.
                    </div>
                  </div>
                  
                  {/* Footer */}
                  <div style={{ padding: '12px 14px', borderTop: `1px solid ${theme === 'standard' ? '#e1e8ed' : 'rgba(255,255,255,0.1)'}`, display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button 
                      onClick={() => setDockedSubmode('command')}
                      style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${theme === 'standard' ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)'}`, borderRadius: '8px', color: theme === 'standard' ? '#536471' : 'white', fontSize: '12px', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                    <button 
                      disabled={identityLoading || handshakeSending}
                      onClick={async () => {
                        if (handshakeDelivery === 'email' && !handshakeTo) {
                          alert('Please enter a recipient email address')
                          return
                        }
                        
                        if (!identity) {
                          alert('Identity not loaded yet. Please wait.')
                          return
                        }
                        
                        setHandshakeSending(true)
                        
                        try {
                          // Create real handshake request payload
                          const payload = await createHandshakeRequestPayload({
                            senderDisplayName: 'WR Chat User', // TODO: Get from user profile
                            senderEmail: handshakeDelivery === 'email' ? undefined : undefined,
                            message: handshakeMessage
                          })
                          
                          // Serialize to JSON
                          const payloadJson = serializeHandshakeRequestPayload(payload)
                          
                          // Store as pending outgoing
                          const recipient = handshakeDelivery === 'email' ? handshakeTo : 'Recipient'
                          createPendingOutgoing(payload, recipient, identity.localX25519KeyId)
                          
                          // Deliver based on method
                          if (handshakeDelivery === 'download') {
                            // Trigger file download
                            const blob = new Blob([payloadJson], { type: 'application/json' })
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = `handshake-request-${payload.senderFingerprint.slice(0, 8)}.beap-handshake.json`
                            document.body.appendChild(a)
                            a.click()
                            document.body.removeChild(a)
                            URL.revokeObjectURL(url)
                            alert('Handshake request downloaded! Share the file with your recipient.')
                          } else if (handshakeDelivery === 'messenger') {
                            // Copy to clipboard for messenger
                            await navigator.clipboard.writeText(payloadJson)
                            alert('Handshake request copied to clipboard! Paste it in your messenger.')
                          } else {
                            // Email: copy to clipboard (email sending requires OAuth integration)
                            await navigator.clipboard.writeText(payloadJson)
                            alert('Handshake request copied to clipboard! Paste it in your email body to ' + handshakeTo)
                          }
                          
                          console.log('[Sidepanel] Handshake request created:', {
                            fingerprint: payload.senderFingerprint.slice(0, 8) + '...',
                            hasX25519Key: !!payload.senderX25519PublicKeyB64,
                            delivery: handshakeDelivery
                          })
                          
                          setDockedSubmode('command')
                        } catch (err) {
                          console.error('[Sidepanel] Failed to create handshake request:', err)
                          alert('Failed to create handshake request: ' + (err instanceof Error ? err.message : 'Unknown error'))
                        } finally {
                          setHandshakeSending(false)
                        }
                      }}
                      style={{ 
                        padding: '8px 20px', 
                        background: (identityLoading || handshakeSending) 
                          ? 'rgba(139,92,246,0.5)' 
                          : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', 
                        border: 'none', 
                        borderRadius: '8px', 
                        color: 'white', 
                        fontSize: '12px', 
                        fontWeight: 600, 
                        cursor: (identityLoading || handshakeSending) ? 'wait' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        opacity: (identityLoading || handshakeSending) ? 0.7 : 1,
                      }}
                    >
                      {handshakeSending ? '⏳ Creating...' : (handshakeDelivery === 'email' ? '📧 Send' : handshakeDelivery === 'messenger' ? '💬 Insert' : '💾 Download')}
                    </button>
                  </div>
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
                  padding: '14px'
                }}
              >
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
                        maxWidth: '80%',
                        padding: '10px 14px',
                        borderRadius: '12px',
                        fontSize: '13px',
                        lineHeight: '1.5',
                        background: msg.role === 'user' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.12)',
                        border: msg.role === 'user' ? '1px solid rgba(34,197,94,0.5)' : '1px solid rgba(255,255,255,0.25)'
                      }}>
                        {msg.imageUrl ? (
                          <img 
                            src={msg.imageUrl} 
                            alt="Screenshot" 
                            style={{ 
                              maxWidth: '260px', 
                              height: 'auto', 
                              borderRadius: '8px',
                              display: 'block'
                            }} 
                          />
                        ) : (
                          msg.text
                        )}
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

              {/* Compose Area */}
              <div 
                id="ccd-compose-sidepanel"
                style={{
                display: 'grid',
                gridTemplateColumns: '1fr 40px 40px auto',
                gap: '8px',
                alignItems: 'center',
                padding: '12px 14px'
              }}>
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleChatKeyDown}
                  placeholder="Type your message..."
                  style={{
                    boxSizing: 'border-box',
                    height: '40px',
                    minHeight: '40px',
                    resize: 'vertical',
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.20)',
                    color: 'white',
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
                    height: '40px',
                    background: 'rgba(255,255,255,0.15)',
                    border: '1px solid rgba(255,255,255,0.25)',
                    color: 'white',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '18px',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                >
                  📎
                </button>
                <button 
                  title="Voice" 
                  style={{
                    height: '40px',
                    background: 'rgba(255,255,255,0.15)',
                    border: '1px solid rgba(255,255,255,0.25)',
                    color: 'white',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '18px',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                >
                  🎙️
                </button>
                {renderSendButton()}
          </div>

            {/* Trigger Creation UI - Minimal View Section 1 */}
            {showTriggerPrompt && (
              <div style={{
                padding: '12px 14px',
                background: 'rgba(255,255,255,0.08)',
                borderTop: '1px solid rgba(255,255,255,0.20)'
              }}>
                <div style={{ marginBottom: '8px', fontSize: '12px', fontWeight: '700', opacity: 0.85 }}>
                  {showTriggerPrompt.mode === 'screenshot' ? '📸 Screenshot' : '🎥 Stream'}
                </div>
                {showTriggerPrompt.createTrigger && (
                  <input
                    type="text"
                    placeholder="Trigger Name"
                    value={showTriggerPrompt.name || ''}
                    onChange={(e) => setShowTriggerPrompt({ ...showTriggerPrompt, name: e.target.value })}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.20)',
                      color: 'white',
                      borderRadius: '6px',
                      fontSize: '12px',
                      marginBottom: '8px'
                    }}
                  />
                )}
                {showTriggerPrompt.addCommand && (
                  <textarea
                    placeholder="Optional Command"
                    value={showTriggerPrompt.command || ''}
                    onChange={(e) => setShowTriggerPrompt({ ...showTriggerPrompt, command: e.target.value })}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.20)',
                      color: 'white',
                      borderRadius: '6px',
                      fontSize: '12px',
                      minHeight: '60px',
                      marginBottom: '8px',
                      resize: 'vertical',
                      fontFamily: 'inherit'
                    }}
                  />
                )}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShowTriggerPrompt(null)}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(255,255,255,0.15)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      color: 'white',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      const name = showTriggerPrompt.name?.trim() || ''
                      const command = showTriggerPrompt.command?.trim() || ''
                      
                      // If createTrigger is checked, save the trigger
                      if (showTriggerPrompt.createTrigger) {
                        if (!name) {
                          alert('Please enter a trigger name')
                          return
                        }
                        
                        const triggerData = {
                          name,
                          command,
                          at: Date.now(),
                          rect: showTriggerPrompt.rect,
                          bounds: showTriggerPrompt.bounds,
                          mode: showTriggerPrompt.mode
                        }
                        
                        // Save to chrome.storage for dropdown
                        chrome.storage.local.get(['optimando-tagged-triggers'], (result) => {
                          const triggers = result['optimando-tagged-triggers'] || []
                          triggers.push(triggerData)
                          chrome.storage.local.set({ 'optimando-tagged-triggers': triggers }, () => {
                            console.log('✅ Trigger saved to storage:', triggerData)
                            setTriggers(triggers)
                            // Notify other contexts
                            try { chrome.runtime?.sendMessage({ type:'TRIGGERS_UPDATED' }) } catch {}
                          })
                        })
                        
                        // Send trigger to Electron
                        try {
                          chrome.runtime?.sendMessage({
                            type: 'ELECTRON_SAVE_TRIGGER',
                            name,
                            mode: showTriggerPrompt.mode,
                            rect: showTriggerPrompt.rect,
                            displayId: 0, // Main display for sidepanel
                            imageUrl: showTriggerPrompt.imageUrl,
                            videoUrl: showTriggerPrompt.videoUrl,
                            command: command || undefined
                          })
                        } catch (err) {
                          console.error('Error sending trigger to Electron:', err)
                        }
                      }
                      
                      // Auto-process: If there's a command or trigger name, send to LLM
                      const triggerNameToUse = name || command
                      const shouldAutoProcess = showTriggerPrompt.addCommand || (showTriggerPrompt.createTrigger && triggerNameToUse)
                      
                      if (shouldAutoProcess && triggerNameToUse && showTriggerPrompt.imageUrl) {
                        // Use the trigger name as @trigger format for routing
                        const triggerText = triggerNameToUse.startsWith('@') ? triggerNameToUse : `@${triggerNameToUse}`
                        
                        console.log('[Sidepanel] Auto-processing trigger creation:', { triggerText, hasImage: true })
                        
                        // Clear the prompt first
                        setShowTriggerPrompt(null)
                        setCreateTriggerChecked(false)
                        setAddCommandChecked(false)
                        
                        // Send to LLM for processing
                        handleSendMessageWithTrigger(triggerText, showTriggerPrompt.imageUrl)
                      } else {
                        // Just post the screenshot to chat (no auto-process)
                        if (showTriggerPrompt.imageUrl) {
                          const imageMessage = {
                            role: 'user' as const,
                            text: `![Screenshot](${showTriggerPrompt.imageUrl})`,
                            imageUrl: showTriggerPrompt.imageUrl
                          }
                          setChatMessages(prev => [...prev, imageMessage])
                          // Scroll to bottom
                          setTimeout(() => {
                            if (chatRef.current) {
                              chatRef.current.scrollTop = chatRef.current.scrollHeight
                            }
                          }, 100)
                        }
                        
                        // Clear the prompt
                        setShowTriggerPrompt(null)
                        setCreateTriggerChecked(false)
                        setAddCommandChecked(false)
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
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
                      <span style={{ fontSize: '48px', marginBottom: '16px' }}>📥</span>
                      <div style={{ fontSize: '18px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px' }}>BEAP Inbox</div>
                      <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', maxWidth: '280px' }}>
                        Received BEAP™ packages will appear here. All packages are verified before display.
                      </div>
                    </div>
                  )}
                  
                  {/* ========================================== */}
                  {/* OUTBOX VIEW */}
                  {/* ========================================== */}
                  {beapSubmode === 'outbox' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
                      <span style={{ fontSize: '48px', marginBottom: '16px' }}>📤</span>
                      <div style={{ fontSize: '18px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px' }}>BEAP Outbox</div>
                      <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', maxWidth: '280px' }}>
                        Packages pending delivery. Monitor send status and delivery confirmations.
                      </div>
                    </div>
                  )}
                  
                  {/* ========================================== */}
                  {/* ARCHIVED VIEW */}
                  {/* ========================================== */}
                  {beapSubmode === 'archived' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
                      <span style={{ fontSize: '48px', marginBottom: '16px' }}>📁</span>
                      <div style={{ fontSize: '18px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px' }}>Archived Packages</div>
                      <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', maxWidth: '280px' }}>
                        Successfully executed packages are archived here for reference.
                      </div>
                    </div>
                  )}
                  
                  {/* ========================================== */}
                  {/* REJECTED VIEW */}
                  {/* ========================================== */}
                  {beapSubmode === 'rejected' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
                      <span style={{ fontSize: '48px', marginBottom: '16px' }}>🚫</span>
                      <div style={{ fontSize: '18px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px' }}>Rejected Packages</div>
                      <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', maxWidth: '280px' }}>
                        Rejected packages that failed verification or were declined by the user.
                      </div>
                    </div>
                  )}
                  
                  {/* ========================================== */}
                  {/* DRAFT VIEW - Main UI */}
                  {/* ========================================== */}
                  {beapSubmode === 'draft' && (
                    <>
                  {/* DELIVERY METHOD - FIRST */}
                  <div style={{ padding: '14px 18px', borderBottom: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.1)' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Delivery Method
                    </label>
                    <select
                      value={handshakeDelivery}
                      onChange={(e) => setHandshakeDelivery(e.target.value as 'email' | 'messenger' | 'download')}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        background: theme === 'standard' ? 'white' : '#1f2937',
                        border: `1px solid ${theme === 'standard' ? '#e1e8ed' : 'rgba(255,255,255,0.15)'}`,
                        borderRadius: '8px',
                        color: theme === 'standard' ? '#1f2937' : 'white',
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="email" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>📧 Email</option>
                      <option value="messenger" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>💬 Messenger (Web)</option>
                      <option value="download" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>💾 Download (USB/Wallet)</option>
                    </select>
                  </div>
                  
                  {/* EMAIL ACCOUNTS SECTION - Only visible when email delivery selected */}
                  {handshakeDelivery === 'email' && (
                  <div style={{ 
                    padding: '16px 18px', 
                    borderBottom: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.1)',
                    background: theme === 'standard' ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.1)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '16px' }}>🔗</span>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Connected Email Accounts</span>
                      </div>
                      <button
                        onClick={() => setShowEmailSetupWizard(true)}
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
                        background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.05)',
                        borderRadius: '8px',
                        border: theme === 'standard' ? '1px dashed rgba(15,23,42,0.2)' : '1px dashed rgba(255,255,255,0.2)',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
                        <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>No email accounts connected</div>
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
                                {account.provider === 'gmail' ? '📧' : account.provider === 'microsoft365' ? '📨' : '✉️'}
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
                          value={selectedEmailAccountId || emailAccounts[0]?.id || ''}
                          onChange={(e) => setSelectedEmailAccountId(e.target.value)}
                          style={{
                            width: '100%',
                            background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.1)',
                            border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.2)',
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
                    <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#1f2937' : 'white' }}>BEAP™ Message</span>
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
                        Message
                      </label>
                      <textarea
                        className="beap-textarea"
                        value={beapDraftMessage}
                        onChange={(e) => setBeapDraftMessage(e.target.value)}
                        placeholder="Compose your BEAP™ message..."
                        style={{
                          flex: 1,
                          minHeight: '120px',
                          background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)',
                          border: theme === 'standard' ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.15)',
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
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.1)' }}>
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
                            border: theme === 'standard' ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.25)',
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
                          Attachments
                        </label>
                        <input
                          type="file"
                          multiple
                          onChange={async (e) => {
                            const files = Array.from(e.target.files ?? [])
                            if (!files.length) return
                            const newItems: DraftAttachment[] = []
                            for (const file of files) {
                              if (file.size > 10 * 1024 * 1024) { console.warn(`[BEAP] Skipping ${file.name}: exceeds 10MB limit`); continue }
                              if (beapDraftAttachments.length + newItems.length >= 20) { console.warn('[BEAP] Max 20 attachments reached'); break }
                              const dataBase64 = await new Promise<string>((resolve, reject) => {
                                const reader = new FileReader()
                                reader.onload = () => { const res = String(reader.result ?? ''); resolve(res.includes(',') ? res.split(',')[1] : res) }
                                reader.onerror = () => reject(reader.error)
                                reader.readAsDataURL(file)
                              })
                              const attachmentId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
                              const mimeType = file.type || 'application/octet-stream'
                              const isPdf = mimeType.toLowerCase() === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
                              // Create initial CapsuleAttachment
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
                                processing: { parsing: isPdf, rasterizing: isPdf }
                              })
                            }
                            // Add items to state immediately (with processing flags)
                            setBeapDraftAttachments((prev) => [...prev, ...newItems])
                            e.currentTarget.value = ''
                            // Process PDFs asynchronously
                            for (const item of newItems) {
                              const isPdf = item.mime.toLowerCase() === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf')
                              if (isPdf) {
                                console.log(`[BEAP] Processing PDF: ${item.name}`)
                                // Call parser
                                processAttachmentForParsing(item.capsuleAttachment, item.dataBase64)
                                  .then((parseResult) => {
                                    console.log(`[BEAP] Parse complete for ${item.name}:`, parseResult.error || 'success')
                                    setBeapDraftAttachments((prev) => prev.map((a) => 
                                      a.id === item.id ? {
                                        ...a,
                                        capsuleAttachment: parseResult.attachment,
                                        processing: { ...a.processing, parsing: false, error: parseResult.error || a.processing.error }
                                      } : a
                                    ))
                                  })
                                  .catch((err) => {
                                    console.error(`[BEAP] Parse error for ${item.name}:`, err)
                                    setBeapDraftAttachments((prev) => prev.map((a) => 
                                      a.id === item.id ? { ...a, processing: { ...a.processing, parsing: false, error: String(err) } } : a
                                    ))
                                  })
                                // Call rasterizer
                                processAttachmentForRasterization(item.capsuleAttachment, item.dataBase64, 144)
                                  .then((rasterResult) => {
                                    console.log(`[BEAP] Rasterize complete for ${item.name}:`, rasterResult.error || 'success', rasterResult.rasterPageData?.length || 0, 'pages')
                                    setBeapDraftAttachments((prev) => prev.map((a) => 
                                      a.id === item.id ? {
                                        ...a,
                                        capsuleAttachment: { ...a.capsuleAttachment, previewRef: rasterResult.attachment.previewRef, rasterProof: rasterResult.rasterProof },
                                        processing: { ...a.processing, rasterizing: false, error: rasterResult.error || a.processing.error },
                                        rasterPageData: rasterResult.rasterPageData || undefined
                                      } : a
                                    ))
                                  })
                                  .catch((err) => {
                                    console.error(`[BEAP] Rasterize error for ${item.name}:`, err)
                                    setBeapDraftAttachments((prev) => prev.map((a) => 
                                      a.id === item.id ? { ...a, processing: { ...a.processing, rasterizing: false, error: String(err) } } : a
                                    ))
                                  })
                              }
                            }
                          }}
                          style={{ fontSize: '11px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)' }}
                        />
                        {beapDraftAttachments.length > 0 && (
                          <div style={{ marginTop: '8px' }}>
                            {beapDraftAttachments.map((a) => (
                              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: theme === 'standard' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)', borderRadius: '4px', marginBottom: '4px' }}>
                                <div>
                                  <div style={{ fontSize: '11px', color: theme === 'standard' ? '#0f172a' : 'white' }}>{a.name}</div>
                                  <div style={{ fontSize: '9px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.5)' }}>{a.mime} · {a.size} bytes</div>
                                </div>
                                <button onClick={() => setBeapDraftAttachments((prev) => prev.filter((x) => x.id !== a.id))} style={{ background: 'transparent', border: 'none', color: theme === 'standard' ? '#ef4444' : '#f87171', fontSize: '10px', cursor: 'pointer' }}>Remove</button>
                              </div>
                            ))}
                            <button onClick={() => setBeapDraftAttachments([])} style={{ background: 'transparent', border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer', marginTop: '4px' }}>Clear all</button>
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
                    borderTop: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.1)',
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
                        border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.2)',
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
                        const selectedAccount = emailAccounts.find(a => a.id === selectedEmailAccountId) || emailAccounts[0]
                        console.log('[BEAP Message] Sending:', { 
                          method: handshakeDelivery, 
                          to: handshakeTo, 
                          message: handshakeMessage,
                          fromAccount: selectedAccount?.email
                        })
                        setNotification({ message: handshakeDelivery === 'download' ? 'Package downloaded!' : 'BEAP™ Message sent!', type: 'success' })
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
                      {handshakeDelivery === 'email' ? '📧 Send' : handshakeDelivery === 'messenger' ? '💬 Insert' : '💾 Download'}
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
                onConnectEmail={() => setShowEmailSetupWizard(true)}
                onDisconnectEmail={disconnectEmailAccount}
                onSelectEmailAccount={setSelectedEmailAccountId}
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
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>{notification.message}</span>
          </div>
        )}
      </div>
    )
  }

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
              width: '32px',
              height: '32px',
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
              width: '32px',
              height: '32px',
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
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleChatDrop}
          >
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                    border: theme === 'standard' ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(168,85,247,0.4)',
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
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {dockedPanelMode !== 'admin' && dockedPanelMode !== 'beap-messages' && dockedPanelMode !== 'augmented-overlay' && dockedWorkspace !== 'wrguard' && <>
                  <button 
                    onClick={handleScreenSelect}
                    title="LmGTFY - Capture a screen area as screenshot or stream"
                    style={{
                      ...chatControlButtonStyle(),
                      borderRadius: '6px',
                      padding: '0 8px',
height: '28px',
                        minWidth: '28px',
                        background: 'rgba(255,255,255,0.15)',
                        border: 'none',
                        color: '#ffffff',
                        fontSize: '14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      if (theme === 'standard') {
                        e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (theme === 'standard') {
                        e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                      }
                    }}
                  >
                    ✎
                  </button>
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
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (theme === 'standard') {
                          e.currentTarget.style.background = '#f8f9fb'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                        }
                      }}
                    >
                      Tags <span style={{ fontSize: '11px', opacity: 0.9 }}>▾</span>
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
                          triggers.map((trigger, i) => (
                            <div 
                              key={i}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '6px 8px',
                                borderBottom: '1px solid rgba(255,255,255,0.20)',
                                cursor: 'pointer'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                              <button
                                onClick={() => handleTriggerClick(trigger)}
                                style={{
                                  flex: 1,
                                  textAlign: 'left',
                                  padding: 0,
                                  fontSize: '12px',
                                  background: 'transparent',
                                  border: 0,
                                  color: 'inherit',
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  minWidth: 0
                                }}
                              >
                                {trigger.name || `Trigger ${i + 1}`}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteTrigger(i)
                                }}
                                style={{
                                  width: '20px',
                                  height: '20px',
                                  border: 'none',
                                  background: 'rgba(239,68,68,0.2)',
                                  color: '#ef4444',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontSize: '16px',
                                  lineHeight: 1,
                                  padding: 0,
                                  marginLeft: '8px',
                                  flexShrink: 0
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.4)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.2)'}
                              >
                                ×
                              </button>
                            </div>
                          ))
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
                  <button style={{ padding: '4px 10px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #e1e8ed' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', cursor: 'pointer' }}>Connect</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}></div>
                <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <textarea placeholder="Message or capsule..." style={{ flex: 1, padding: '8px 10px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: 'white', fontSize: '12px', resize: 'none', minHeight: '32px', maxHeight: '80px' }} />
                  <button title="Build Capsule" style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>💊</button>
                  <button title="AI Assistant" style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✨</button>
                  <button title="Attach" style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📎</button>
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
                    <textarea placeholder="Chat..." style={{ flex: 1, padding: '6px 8px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: 'white', fontSize: '11px', resize: 'none', minHeight: '28px' }} />
                    <button title="AI Assistant" style={{ width: '28px', height: '28px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '12px', cursor: 'pointer' }}>✨</button>
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
                    <textarea placeholder="Group chat..." style={{ flex: 1, padding: '6px 8px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: 'white', fontSize: '11px', resize: 'none', minHeight: '28px' }} />
                    <button title="AI Assistant" style={{ width: '28px', height: '28px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '12px', cursor: 'pointer' }}>✨</button>
                    <button style={{ padding: '6px 12px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Send</button>
                  </div>
                </div>
              </div>
            )}

            {/* BEAP Handshake Request - App/Admin View */}
            {dockedPanelMode === 'handshake' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : (theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.06)'), minHeight: '280px', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ padding: '12px 14px', borderBottom: `1px solid ${theme === 'standard' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>🤝</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#1f2937' : 'white' }}>BEAP™ Handshake Request</span>
                </div>
                
                {/* DELIVERY METHOD - FIRST */}
                <div style={{ padding: '14px 18px', borderBottom: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Delivery Method</label>
                  <select value={handshakeDelivery} onChange={(e) => setHandshakeDelivery(e.target.value as 'email' | 'messenger' | 'download')} style={{ width: '100%', padding: '10px 12px', background: theme === 'standard' ? 'white' : '#1f2937', border: `1px solid ${theme === 'standard' ? 'rgba(147, 51, 234, 0.15)' : 'rgba(255,255,255,0.15)'}`, borderRadius: '8px', color: theme === 'standard' ? '#1f2937' : 'white', fontSize: '13px', cursor: 'pointer' }}>
                    <option value="email" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>📧 Email</option>
                    <option value="messenger" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>💬 Messenger (Web)</option>
                    <option value="download" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>💾 Download (USB/Wallet)</option>
                  </select>
                </div>
                
                {/* EMAIL ACCOUNTS SECTION - Only visible when email delivery selected */}
                {handshakeDelivery === 'email' && (
                <div style={{ padding: '16px 18px', borderBottom: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)', background: theme === 'standard' ? 'rgba(139,92,246,0.05)' : 'rgba(139,92,246,0.1)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px' }}>🔗</span>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Connected Email Accounts</span>
                    </div>
                    <button onClick={() => setShowEmailSetupWizard(true)} style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', border: 'none', color: 'white', borderRadius: '6px', padding: '6px 12px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}><span>+</span> Connect Email</button>
                  </div>
                  {isLoadingEmailAccounts ? (
                    <div style={{ padding: '12px', textAlign: 'center', opacity: 0.6, fontSize: '12px' }}>Loading accounts...</div>
                  ) : emailAccounts.length === 0 ? (
                    <div style={{ padding: '20px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.05)', borderRadius: '8px', border: theme === 'standard' ? '1px dashed rgba(15,23,42,0.2)' : '1px dashed rgba(255,255,255,0.2)', textAlign: 'center' }}>
                      <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
                      <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>No email accounts connected</div>
                      <div style={{ fontSize: '11px', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.5)' }}>Connect your email to send handshake requests</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {emailAccounts.map(account => (
                        <div key={account.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', borderRadius: '8px', border: account.status === 'active' ? (theme === 'standard' ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(34,197,94,0.4)') : (theme === 'standard' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(239,68,68,0.4)') }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '18px' }}>{account.provider === 'gmail' ? '📧' : account.provider === 'microsoft365' ? '📨' : '✉️'}</span>
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: '500', color: theme === 'standard' ? '#0f172a' : 'white' }}>{account.email || account.displayName}</div>
                              <div style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: account.status === 'active' ? '#22c55e' : '#ef4444' }} />
                                <span style={{ color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>{account.status === 'active' ? 'Connected' : account.lastError || 'Error'}</span>
                              </div>
                            </div>
                          </div>
                          <button onClick={() => disconnectEmailAccount(account.id)} title="Disconnect" style={{ background: 'transparent', border: 'none', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '4px', fontSize: '14px' }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {emailAccounts.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Send From:</label>
                      <select value={selectedEmailAccountId || emailAccounts[0]?.id || ''} onChange={(e) => setSelectedEmailAccountId(e.target.value)} style={{ width: '100%', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.1)', border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#0f172a' : 'white', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer', outline: 'none' }}>
                        {emailAccounts.map(account => (<option key={account.id} value={account.id}>{account.email || account.displayName} ({account.provider})</option>))}
                      </select>
                    </div>
                  )}
                </div>
                )}
                
                <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Your Fingerprint - PROMINENT */}
                  <div style={{
                    padding: '12px 14px',
                    background: theme === 'standard' ? 'rgba(139, 92, 246, 0.08)' : 'rgba(139, 92, 246, 0.15)',
                    border: `2px solid ${theme === 'standard' ? 'rgba(139, 92, 246, 0.2)' : 'rgba(139, 92, 246, 0.3)'}`,
                    borderRadius: '10px',
                  }}>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                    }}>
                      <div style={{ 
                        fontSize: '11px', 
                        fontWeight: 600, 
                        color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', 
                        textTransform: 'uppercase', 
                        letterSpacing: '0.5px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}>
                        🔐 {TOOLTIPS.FINGERPRINT_TITLE}
                        <span 
                          style={{ cursor: 'help', fontSize: '11px', fontWeight: 400 }}
                          title={TOOLTIPS.FINGERPRINT}
                        >
                          ⓘ
                        </span>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(ourFingerprint)
                            setFingerprintCopied(true)
                            setTimeout(() => setFingerprintCopied(false), 2000)
                          } catch (err) {
                            console.error('Failed to copy:', err)
                          }
                        }}
                        style={{
                          padding: '4px 10px',
                          fontSize: '10px',
                          background: theme === 'standard' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
                          border: 'none',
                          borderRadius: '4px',
                          color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)',
                          cursor: 'pointer',
                        }}
                      >
                        {fingerprintCopied ? '✓ Copied' : '📋 Copy'}
                      </button>
                    </div>
                    <div style={{
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      color: theme === 'standard' ? '#1f2937' : 'white',
                      wordBreak: 'break-all',
                      lineHeight: 1.5,
                    }}>
                      {formatFingerprintGrouped(ourFingerprint)}
                    </div>
                    <div style={{
                      marginTop: '8px',
                      fontSize: '10px',
                      color: theme === 'standard' ? '#9ca3af' : 'rgba(255,255,255,0.5)',
                    }}>
                      Short: <span style={{ fontFamily: 'monospace' }}>{ourFingerprintShort}</span>
                    </div>
                  </div>
                  
                  {/* To Field - Only for Email */}
                  {handshakeDelivery === 'email' && (
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        To:
                      </label>
                      <input
                        type="email"
                        value={handshakeTo}
                        onChange={(e) => setHandshakeTo(e.target.value)}
                        placeholder="recipient@example.com"
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)',
                          border: `1px solid ${theme === 'standard' ? '#e1e8ed' : 'rgba(255,255,255,0.15)'}`,
                          borderRadius: '8px',
                          color: theme === 'standard' ? '#1f2937' : 'white',
                          fontSize: '13px',
                        }}
                      />
                    </div>
                  )}
                  
                  {/* Message */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Message
                    </label>
                    <textarea
                      value={handshakeMessage}
                      onChange={(e) => setHandshakeMessage(e.target.value)}
                      style={{
                        flex: 1,
                        minHeight: '120px',
                        padding: '10px 12px',
                        background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)',
                        border: `1px solid ${theme === 'standard' ? '#e1e8ed' : 'rgba(255,255,255,0.15)'}`,
                        borderRadius: '8px',
                        color: theme === 'standard' ? '#1f2937' : 'white',
                        fontSize: '13px',
                        lineHeight: '1.5',
                        resize: 'none',
                      }}
                    />
                  </div>
                  
                  {/* Policy Note */}
                  <div style={{
                    padding: '10px 12px',
                    background: theme === 'standard' ? 'rgba(59, 130, 246, 0.08)' : 'rgba(59, 130, 246, 0.15)',
                    borderRadius: '8px',
                    fontSize: '11px',
                    color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.8)',
                  }}>
                    🛡️ {POLICY_NOTES.LOCAL_OVERRIDE}
                  </div>
                  
                  {/* Info */}
                  <div style={{
                    padding: '10px 12px',
                    background: theme === 'standard' ? 'rgba(139, 92, 246, 0.08)' : 'rgba(139, 92, 246, 0.15)',
                    borderRadius: '8px',
                    fontSize: '11px',
                    color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.8)',
                  }}>
                    💡 This creates a secure BEAP™ package. Recipient will appear in your Handshakes once accepted.
                  </div>
                </div>
                
                {/* Footer */}
                <div style={{ padding: '12px 14px', borderTop: `1px solid ${theme === 'standard' ? 'rgba(147, 51, 234, 0.12)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button 
                    onClick={() => setDockedSubmode('command')}
                    style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${theme === 'standard' ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)'}`, borderRadius: '8px', color: theme === 'standard' ? '#536471' : 'white', fontSize: '12px', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                      if (handshakeDelivery === 'email' && !handshakeTo) {
                        alert('Please enter a recipient email address')
                        return
                      }
                      alert(`Handshake request ${handshakeDelivery === 'download' ? 'downloaded' : 'sent'} successfully!`)
                      setDockedSubmode('command')
                    }}
                    style={{ 
                      padding: '8px 20px', 
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', 
                      border: 'none', 
                      borderRadius: '8px', 
                      color: 'white', 
                      fontSize: '12px', 
                      fontWeight: 600, 
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    {handshakeDelivery === 'email' ? '📧 Send' : handshakeDelivery === 'messenger' ? '💬 Insert' : '💾 Download'}
                  </button>
                </div>
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
                    padding: '14px'
                  }}
                >
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
                          maxWidth: '80%',
                          padding: '10px 14px',
                          borderRadius: '12px',
                          fontSize: '13px',
                          lineHeight: '1.5',
                          background: msg.role === 'user' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.12)',
                          border: msg.role === 'user' ? '1px solid rgba(34,197,94,0.5)' : '1px solid rgba(255,255,255,0.25)'
                        }}>
                          {msg.imageUrl ? (
                            <img 
                              src={msg.imageUrl} 
                              alt="Screenshot" 
                              style={{ 
                                maxWidth: '260px', 
                                height: 'auto', 
                                borderRadius: '8px',
                                display: 'block'
                              }} 
                            />
                          ) : (
                            msg.text
                          )}
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

                {/* Compose Area */}
                <div 
                  id="ccd-compose-sidepanel"
                  style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 40px auto',
                  gap: '8px',
                  alignItems: 'center',
                  padding: '12px 14px'
                }}>
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={handleChatKeyDown}
                    placeholder="Type your message..."
                    style={{
                      boxSizing: 'border-box',
                      height: '40px',
                      minHeight: '40px',
                      resize: 'vertical',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.20)',
                      color: 'white',
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
                      height: '40px',
                      background: 'rgba(255,255,255,0.15)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      color: 'white',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '18px',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                  >
                    📎
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
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
                    <span style={{ fontSize: '48px', marginBottom: '16px' }}>📥</span>
                    <div style={{ fontSize: '18px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px' }}>BEAP Inbox</div>
                    <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', maxWidth: '280px' }}>
                      Received BEAP™ packages will appear here.
                    </div>
                  </div>
                )}
                {beapSubmode === 'outbox' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
                    <span style={{ fontSize: '48px', marginBottom: '16px' }}>📤</span>
                    <div style={{ fontSize: '18px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px' }}>BEAP Outbox</div>
                    <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', maxWidth: '280px' }}>
                      Packages pending delivery.
                    </div>
                  </div>
                )}
                {beapSubmode === 'archived' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
                    <span style={{ fontSize: '48px', marginBottom: '16px' }}>📁</span>
                    <div style={{ fontSize: '18px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px' }}>Archived Packages</div>
                    <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', maxWidth: '280px' }}>
                      Successfully executed packages.
                    </div>
                  </div>
                )}
                {beapSubmode === 'rejected' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
                    <span style={{ fontSize: '48px', marginBottom: '16px' }}>🚫</span>
                    <div style={{ fontSize: '18px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px' }}>Rejected Packages</div>
                    <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', maxWidth: '280px' }}>
                      Rejected packages.
                    </div>
                  </div>
                )}
                
                {/* Draft view - EMAIL ACCOUNTS + BEAP Message */}
                {beapSubmode === 'draft' && (
                  <>
                {/* DELIVERY METHOD - FIRST */}
                <div style={{ padding: '14px 18px', borderBottom: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Delivery Method</label>
                  <select value={handshakeDelivery} onChange={(e) => setHandshakeDelivery(e.target.value as 'email' | 'messenger' | 'download')} style={{ width: '100%', padding: '10px 12px', background: theme === 'standard' ? 'white' : '#1f2937', border: `1px solid ${theme === 'standard' ? 'rgba(147, 51, 234, 0.15)' : 'rgba(255,255,255,0.15)'}`, borderRadius: '8px', color: theme === 'standard' ? '#1f2937' : 'white', fontSize: '13px', cursor: 'pointer' }}>
                    <option value="email" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>📧 Email</option>
                    <option value="messenger" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>💬 Messenger (Web)</option>
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
                      onClick={() => setShowEmailSetupWizard(true)}
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
                      background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.05)',
                      borderRadius: '8px',
                      border: theme === 'standard' ? '1px dashed rgba(15,23,42,0.2)' : '1px dashed rgba(255,255,255,0.2)',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
                      <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>No email accounts connected</div>
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
                              {account.provider === 'gmail' ? '📧' : account.provider === 'microsoft365' ? '📨' : '✉️'}
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
                      <select value={selectedEmailAccountId || emailAccounts[0]?.id || ''} onChange={(e) => setSelectedEmailAccountId(e.target.value)} style={{ width: '100%', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.1)', border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#0f172a' : 'white', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer', outline: 'none' }}>
                        {emailAccounts.map(account => (<option key={account.id} value={account.id}>{account.email || account.displayName} ({account.provider})</option>))}
                      </select>
                    </div>
                  )}
                </div>
                )}
                {/* BEAP™ Message UI - App View */}
                <div style={{ padding: '12px 14px', borderBottom: `1px solid ${theme === 'standard' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>📦</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#1f2937' : 'white' }}>BEAP™ Message</span>
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
                    <RecipientHandshakeSelect handshakes={handshakes} selectedHandshakeId={selectedRecipient?.handshake_id || null} onSelect={setSelectedRecipient} theme={theme} />
                  )}
                  {/* Delivery Method Panel - Adapts to recipient mode */}
                  <DeliveryMethodPanel deliveryMethod={handshakeDelivery} recipientMode={beapRecipientMode} selectedRecipient={selectedRecipient} emailTo={beapDraftTo} onEmailToChange={setBeapDraftTo} theme={theme} ourFingerprintShort={ourFingerprintShort} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Message</label>
                    <textarea className="beap-textarea" value={beapDraftMessage} onChange={(e) => setBeapDraftMessage(e.target.value)} placeholder="Compose your BEAP™ message..." style={{ flex: 1, minHeight: '120px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.15)', color: theme === 'standard' ? '#0f172a' : 'white', borderRadius: '6px', padding: '10px 12px', fontSize: '12px', lineHeight: '1.5', resize: 'none', outline: 'none', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }} />
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
                      <select value={beapDraftSessionId} onChange={(e) => setBeapDraftSessionId(e.target.value)} onClick={() => loadAvailableSessions()} style={{ width: '100%', background: theme === 'standard' ? '#ffffff' : '#1e293b', border: theme === 'standard' ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.25)', color: theme === 'standard' ? '#0f172a' : '#f1f5f9', borderRadius: '6px', padding: '8px 10px', fontSize: '12px', outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}>
                        <option value="" style={{ background: theme === 'standard' ? '#ffffff' : '#1e293b', color: theme === 'standard' ? '#0f172a' : '#f1f5f9' }}>{availableSessions.length === 0 ? '— No sessions available —' : '— Select a session —'}</option>
                        {availableSessions.map((s) => (<option key={s.key} value={s.key} style={{ background: theme === 'standard' ? '#ffffff' : '#1e293b', color: theme === 'standard' ? '#0f172a' : '#f1f5f9' }}>{s.name} ({new Date(s.timestamp).toLocaleDateString()})</option>))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', fontWeight: 500, marginBottom: '4px', display: 'block', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>Attachments</label>
                      <input type="file" multiple onChange={async (e) => { const files = Array.from(e.target.files ?? []); if (!files.length) return; const newItems: DraftAttachment[] = []; for (const file of files) { if (file.size > 10 * 1024 * 1024) { console.warn(`[BEAP] Skipping ${file.name}: exceeds 10MB limit`); continue } if (beapDraftAttachments.length + newItems.length >= 20) { console.warn('[BEAP] Max 20 attachments reached'); break } const dataBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const res = String(reader.result ?? ''); resolve(res.includes(',') ? res.split(',')[1] : res) }; reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) }); const attachmentId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; const mimeType = file.type || 'application/octet-stream'; const isPdf = mimeType.toLowerCase() === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'); const capsuleAttachment: CapsuleAttachment = { id: attachmentId, originalName: file.name, originalSize: file.size, originalType: mimeType, semanticContent: null, semanticExtracted: false, encryptedRef: `encrypted_${attachmentId}`, encryptedHash: '', previewRef: null, rasterProof: null, isMedia: mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/'), hasTranscript: false }; newItems.push({ id: attachmentId, name: file.name, mime: mimeType, size: file.size, dataBase64, capsuleAttachment, processing: { parsing: isPdf, rasterizing: isPdf } }) } setBeapDraftAttachments((prev) => [...prev, ...newItems]); e.currentTarget.value = ''; for (const item of newItems) { const isPdf = item.mime.toLowerCase() === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf'); if (isPdf) { console.log(`[BEAP] Processing PDF: ${item.name}`); processAttachmentForParsing(item.capsuleAttachment, item.dataBase64).then((r) => { console.log(`[BEAP] Parse done: ${item.name}`); setBeapDraftAttachments((prev) => prev.map((a) => a.id === item.id ? { ...a, capsuleAttachment: r.attachment, processing: { ...a.processing, parsing: false, error: r.error || a.processing.error } } : a)) }).catch((err) => { setBeapDraftAttachments((prev) => prev.map((a) => a.id === item.id ? { ...a, processing: { ...a.processing, parsing: false, error: String(err) } } : a)) }); processAttachmentForRasterization(item.capsuleAttachment, item.dataBase64, 144).then((r) => { console.log(`[BEAP] Raster done: ${item.name}`); setBeapDraftAttachments((prev) => prev.map((a) => a.id === item.id ? { ...a, capsuleAttachment: { ...a.capsuleAttachment, previewRef: r.attachment.previewRef, rasterProof: r.rasterProof }, processing: { ...a.processing, rasterizing: false, error: r.error || a.processing.error } } : a)) }).catch((err) => { setBeapDraftAttachments((prev) => prev.map((a) => a.id === item.id ? { ...a, processing: { ...a.processing, rasterizing: false, error: String(err) } } : a)) }) } } }} style={{ fontSize: '11px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)' }} />
                      {beapDraftAttachments.length > 0 && (
                        <div style={{ marginTop: '8px' }}>
                          {beapDraftAttachments.map((a) => (<div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: theme === 'standard' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)', borderRadius: '4px', marginBottom: '4px' }}><div><div style={{ fontSize: '11px', color: theme === 'standard' ? '#0f172a' : 'white' }}>{a.name}{(a.processing.parsing || a.processing.rasterizing) && ' ⏳'}{a.capsuleAttachment.semanticExtracted && ' ✓'}</div><div style={{ fontSize: '9px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.5)' }}>{a.mime} · {a.size} bytes{a.processing.error && ` · ⚠️ ${a.processing.error.slice(0,30)}`}</div></div><button onClick={() => setBeapDraftAttachments((prev) => prev.filter((x) => x.id !== a.id))} style={{ background: 'transparent', border: 'none', color: theme === 'standard' ? '#ef4444' : '#f87171', fontSize: '10px', cursor: 'pointer' }}>Remove</button></div>))}
                          <button onClick={() => setBeapDraftAttachments([])} style={{ background: 'transparent', border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer', marginTop: '4px' }}>Clear all</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ padding: '12px 14px', borderTop: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'flex-end', gap: '8px', background: theme === 'standard' ? '#ffffff' : 'rgba(0,0,0,0.2)' }}>
                  <button onClick={() => { setBeapDraftTo(''); setBeapDraftMessage(''); setBeapDraftEncryptedMessage(''); setBeapDraftSessionId(''); setBeapDraftAttachments([]); setSelectedRecipient(null) }} style={{ background: 'transparent', border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#536471' : 'rgba(255,255,255,0.7)', borderRadius: '6px', padding: '8px 16px', fontSize: '12px', cursor: 'pointer' }}>Clear</button>
                  <button onClick={handleSendBeapMessage} disabled={isBeapSendDisabled} style={{ background: isBeapSendDisabled ? 'rgba(168,85,247,0.5)' : 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)', border: 'none', color: 'white', borderRadius: '6px', padding: '8px 20px', fontSize: '12px', fontWeight: 600, cursor: isBeapSendDisabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: isBeapSendDisabled ? 0.7 : 1 }}>{getBeapSendButtonLabel()}</button>
                </div>
                  </>
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
                onConnectEmail={() => setShowEmailSetupWizard(true)}
                onDisconnectEmail={disconnectEmailAccount}
                onSelectEmailAccount={setSelectedEmailAccountId}
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
      
      {/* Session Controls at the very top - Two Rows */}
      <div style={{ 
        padding: '12px 16px',
        borderBottom: theme === 'standard' ? '1px solid #e1e8ed' : theme === 'dark' ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.2)',
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
            console.log('📤 Export session...')
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

        {/* Row 2: ADMIN/Master Tab Label + 4 Admin Icons (matching width) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{
            fontSize: masterTabId ? '9px' : '11px', 
            fontWeight: '700', 
            opacity: 0.85, 
            textTransform: 'uppercase', 
            letterSpacing: masterTabId ? '0.4px' : '0.5px',
            width: masterTabId ? '65px' : '32px',
            textAlign: 'center',
            lineHeight: masterTabId ? '1.1' : 'normal',
            whiteSpace: masterTabId ? 'normal' : 'nowrap'
          }}>
            {masterTabId && masterTabId !== "01" ? `Master Tab (${masterTabId})` : 'ADMIN'}
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={openUnifiedAdmin} title="Admin Configuration (Agents, Context, Memory)" style={adminIconStyle}>⚙️</button>
          <button onClick={openAddView} title="Add View" style={adminIconStyle}>⊞</button>
          <button onClick={openSessions} title="Sessions" style={adminIconStyle}>📚</button>
          <button onClick={openSettings} title="Settings" style={adminIconStyle}>🔧</button>
        </div>
      </div>

      {/* WR Login / Backend Switcher Section */}
      <BackendSwitcherInline theme={theme} />

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
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleChatDrop}
          >
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                    border: theme === 'standard' ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(168,85,247,0.4)',
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
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {dockedPanelMode !== 'admin' && dockedPanelMode !== 'beap-messages' && dockedPanelMode !== 'augmented-overlay' && dockedWorkspace !== 'wrguard' && <>
                  <button 
                    onClick={handleScreenSelect}
                    title="LmGTFY - Capture a screen area as screenshot or stream"
                    style={{
                      ...chatControlButtonStyle(),
                      borderRadius: '6px',
                      padding: '0 8px',
height: '28px',
                        minWidth: '28px',
                        background: 'rgba(255,255,255,0.15)',
                        border: 'none',
                        color: '#ffffff',
                        fontSize: '14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      if (theme === 'standard') {
                        e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (theme === 'standard') {
                        e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                      }
                    }}
                  >
                    ✎
                  </button>
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
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (theme === 'standard') {
                          e.currentTarget.style.background = '#f8f9fb'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                        }
                      }}
                    >
                      Tags <span style={{ fontSize: '11px', opacity: 0.9 }}>▾</span>
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
                          triggers.map((trigger, i) => (
                            <div 
                              key={i}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '6px 8px',
                                borderBottom: '1px solid rgba(255,255,255,0.20)',
                                cursor: 'pointer'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                              <button
                                onClick={() => handleTriggerClick(trigger)}
                                style={{
                                  flex: 1,
                                  textAlign: 'left',
                                  padding: 0,
                                  fontSize: '12px',
                                  background: 'transparent',
                                  border: 0,
                                  color: 'inherit',
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  minWidth: 0
                                }}
                              >
                                {trigger.name || `Trigger ${i + 1}`}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteTrigger(i)
                                }}
                                style={{
                                  width: '20px',
                                  height: '20px',
                                  border: 'none',
                                  background: 'rgba(239,68,68,0.2)',
                                  color: '#ef4444',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontSize: '16px',
                                  lineHeight: 1,
                                  padding: 0,
                                  marginLeft: '8px',
                                  flexShrink: 0
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.4)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.2)'}
                              >
                                ×
                              </button>
                            </div>
                          ))
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
                  <button style={{ padding: '4px 10px', background: theme === 'standard' ? '#f8f9fb' : 'rgba(255,255,255,0.12)', border: theme === 'standard' ? '1px solid #e1e8ed' : 'none', borderRadius: '6px', color: theme === 'standard' ? '#0f172a' : 'white', fontSize: '11px', cursor: 'pointer' }}>Connect</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}></div>
                <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <textarea placeholder="Message or capsule..." style={{ flex: 1, padding: '8px 10px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: 'white', fontSize: '12px', resize: 'none', minHeight: '32px', maxHeight: '80px' }} />
                  <button title="Build Capsule" style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>💊</button>
                  <button title="AI Assistant" style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✨</button>
                  <button title="Attach" style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📎</button>
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
                    <textarea placeholder="Chat..." style={{ flex: 1, padding: '6px 8px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: 'white', fontSize: '11px', resize: 'none', minHeight: '28px' }} />
                    <button title="AI Assistant" style={{ width: '28px', height: '28px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '12px', cursor: 'pointer' }}>✨</button>
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
                    <textarea placeholder="Group chat..." style={{ flex: 1, padding: '6px 8px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: 'white', fontSize: '11px', resize: 'none', minHeight: '28px' }} />
                    <button title="AI Assistant" style={{ width: '28px', height: '28px', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '12px', cursor: 'pointer' }}>✨</button>
                    <button style={{ padding: '6px 12px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Send</button>
                  </div>
                </div>
              </div>
            )}

            {/* BEAP Handshake Request - App/Admin View */}
            {dockedPanelMode === 'handshake' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: theme === 'pro' ? 'rgba(118,75,162,0.25)' : (theme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.06)'), minHeight: '280px', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ padding: '12px 14px', borderBottom: `1px solid ${theme === 'standard' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>🤝</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#1f2937' : 'white' }}>BEAP™ Handshake Request</span>
                </div>
                
                {/* DELIVERY METHOD - FIRST */}
                <div style={{ padding: '14px 18px', borderBottom: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Delivery Method</label>
                  <select value={handshakeDelivery} onChange={(e) => setHandshakeDelivery(e.target.value as 'email' | 'messenger' | 'download')} style={{ width: '100%', padding: '10px 12px', background: theme === 'standard' ? 'white' : '#1f2937', border: `1px solid ${theme === 'standard' ? 'rgba(147, 51, 234, 0.15)' : 'rgba(255,255,255,0.15)'}`, borderRadius: '8px', color: theme === 'standard' ? '#1f2937' : 'white', fontSize: '13px', cursor: 'pointer' }}>
                    <option value="email" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>📧 Email</option>
                    <option value="messenger" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>💬 Messenger (Web)</option>
                    <option value="download" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>💾 Download (USB/Wallet)</option>
                  </select>
                </div>
                
                {/* EMAIL ACCOUNTS SECTION - Only visible when email delivery selected */}
                {handshakeDelivery === 'email' && (
                <div style={{ padding: '16px 18px', borderBottom: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)', background: theme === 'standard' ? 'rgba(139,92,246,0.05)' : 'rgba(139,92,246,0.1)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px' }}>🔗</span>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Connected Email Accounts</span>
                    </div>
                    <button onClick={() => setShowEmailSetupWizard(true)} style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', border: 'none', color: 'white', borderRadius: '6px', padding: '6px 12px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}><span>+</span> Connect Email</button>
                  </div>
                  {isLoadingEmailAccounts ? (
                    <div style={{ padding: '12px', textAlign: 'center', opacity: 0.6, fontSize: '12px' }}>Loading accounts...</div>
                  ) : emailAccounts.length === 0 ? (
                    <div style={{ padding: '20px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.05)', borderRadius: '8px', border: theme === 'standard' ? '1px dashed rgba(15,23,42,0.2)' : '1px dashed rgba(255,255,255,0.2)', textAlign: 'center' }}>
                      <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
                      <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>No email accounts connected</div>
                      <div style={{ fontSize: '11px', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.5)' }}>Connect your email to send handshake requests</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {emailAccounts.map(account => (
                        <div key={account.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', borderRadius: '8px', border: account.status === 'active' ? (theme === 'standard' ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(34,197,94,0.4)') : (theme === 'standard' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(239,68,68,0.4)') }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '18px' }}>{account.provider === 'gmail' ? '📧' : account.provider === 'microsoft365' ? '📨' : '✉️'}</span>
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: '500', color: theme === 'standard' ? '#0f172a' : 'white' }}>{account.email || account.displayName}</div>
                              <div style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: account.status === 'active' ? '#22c55e' : '#ef4444' }} />
                                <span style={{ color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>{account.status === 'active' ? 'Connected' : account.lastError || 'Error'}</span>
                              </div>
                            </div>
                          </div>
                          <button onClick={() => disconnectEmailAccount(account.id)} title="Disconnect" style={{ background: 'transparent', border: 'none', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '4px', fontSize: '14px' }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {emailAccounts.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Send From:</label>
                      <select value={selectedEmailAccountId || emailAccounts[0]?.id || ''} onChange={(e) => setSelectedEmailAccountId(e.target.value)} style={{ width: '100%', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.1)', border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#0f172a' : 'white', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer', outline: 'none' }}>
                        {emailAccounts.map(account => (<option key={account.id} value={account.id}>{account.email || account.displayName} ({account.provider})</option>))}
                      </select>
                    </div>
                  )}
                </div>
                )}
                
                <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Your Fingerprint - PROMINENT */}
                  <div style={{
                    padding: '12px 14px',
                    background: theme === 'standard' ? 'rgba(139, 92, 246, 0.08)' : 'rgba(139, 92, 246, 0.15)',
                    border: `2px solid ${theme === 'standard' ? 'rgba(139, 92, 246, 0.2)' : 'rgba(139, 92, 246, 0.3)'}`,
                    borderRadius: '10px',
                  }}>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                    }}>
                      <div style={{ 
                        fontSize: '11px', 
                        fontWeight: 600, 
                        color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', 
                        textTransform: 'uppercase', 
                        letterSpacing: '0.5px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}>
                        🔐 {TOOLTIPS.FINGERPRINT_TITLE}
                        <span 
                          style={{ cursor: 'help', fontSize: '11px', fontWeight: 400 }}
                          title={TOOLTIPS.FINGERPRINT}
                        >
                          ⓘ
                        </span>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(ourFingerprint)
                            setFingerprintCopied(true)
                            setTimeout(() => setFingerprintCopied(false), 2000)
                          } catch (err) {
                            console.error('Failed to copy:', err)
                          }
                        }}
                        style={{
                          padding: '4px 10px',
                          fontSize: '10px',
                          background: theme === 'standard' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
                          border: 'none',
                          borderRadius: '4px',
                          color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)',
                          cursor: 'pointer',
                        }}
                      >
                        {fingerprintCopied ? '✓ Copied' : '📋 Copy'}
                      </button>
                    </div>
                    <div style={{
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      color: theme === 'standard' ? '#1f2937' : 'white',
                      wordBreak: 'break-all',
                      lineHeight: 1.5,
                    }}>
                      {formatFingerprintGrouped(ourFingerprint)}
                    </div>
                    <div style={{
                      marginTop: '8px',
                      fontSize: '10px',
                      color: theme === 'standard' ? '#9ca3af' : 'rgba(255,255,255,0.5)',
                    }}>
                      Short: <span style={{ fontFamily: 'monospace' }}>{ourFingerprintShort}</span>
                    </div>
                  </div>
                  
                  {/* To Field - Only for Email */}
                  {handshakeDelivery === 'email' && (
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        To:
                      </label>
                      <input
                        type="email"
                        value={handshakeTo}
                        onChange={(e) => setHandshakeTo(e.target.value)}
                        placeholder="recipient@example.com"
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)',
                          border: `1px solid ${theme === 'standard' ? '#e1e8ed' : 'rgba(255,255,255,0.15)'}`,
                          borderRadius: '8px',
                          color: theme === 'standard' ? '#1f2937' : 'white',
                          fontSize: '13px',
                        }}
                      />
                    </div>
                  )}
                  
                  {/* Message */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Message
                    </label>
                    <textarea
                      value={handshakeMessage}
                      onChange={(e) => setHandshakeMessage(e.target.value)}
                      style={{
                        flex: 1,
                        minHeight: '120px',
                        padding: '10px 12px',
                        background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)',
                        border: `1px solid ${theme === 'standard' ? '#e1e8ed' : 'rgba(255,255,255,0.15)'}`,
                        borderRadius: '8px',
                        color: theme === 'standard' ? '#1f2937' : 'white',
                        fontSize: '13px',
                        lineHeight: '1.5',
                        resize: 'none',
                      }}
                    />
                  </div>
                  
                  {/* Policy Note */}
                  <div style={{
                    padding: '10px 12px',
                    background: theme === 'standard' ? 'rgba(59, 130, 246, 0.08)' : 'rgba(59, 130, 246, 0.15)',
                    borderRadius: '8px',
                    fontSize: '11px',
                    color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.8)',
                  }}>
                    🛡️ {POLICY_NOTES.LOCAL_OVERRIDE}
                  </div>
                  
                  {/* Info */}
                  <div style={{
                    padding: '10px 12px',
                    background: theme === 'standard' ? 'rgba(139, 92, 246, 0.08)' : 'rgba(139, 92, 246, 0.15)',
                    borderRadius: '8px',
                    fontSize: '11px',
                    color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.8)',
                  }}>
                    💡 This creates a secure BEAP™ package. Recipient will appear in your Handshakes once accepted.
                  </div>
                </div>
                
                {/* Footer */}
                <div style={{ padding: '12px 14px', borderTop: `1px solid ${theme === 'standard' ? 'rgba(147, 51, 234, 0.12)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button 
                    onClick={() => setDockedSubmode('command')}
                    style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${theme === 'standard' ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)'}`, borderRadius: '8px', color: theme === 'standard' ? '#536471' : 'white', fontSize: '12px', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                      if (handshakeDelivery === 'email' && !handshakeTo) {
                        alert('Please enter a recipient email address')
                        return
                      }
                      alert(`Handshake request ${handshakeDelivery === 'download' ? 'downloaded' : 'sent'} successfully!`)
                      setDockedSubmode('command')
                    }}
                    style={{ 
                      padding: '8px 20px', 
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', 
                      border: 'none', 
                      borderRadius: '8px', 
                      color: 'white', 
                      fontSize: '12px', 
                      fontWeight: 600, 
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    {handshakeDelivery === 'email' ? '📧 Send' : handshakeDelivery === 'messenger' ? '💬 Insert' : '💾 Download'}
                  </button>
                </div>
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
                    padding: '14px'
                  }}
                >
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
                          maxWidth: '80%',
                          padding: '10px 14px',
                          borderRadius: '12px',
                          fontSize: '13px',
                          lineHeight: '1.5',
                          background: msg.role === 'user' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.12)',
                          border: msg.role === 'user' ? '1px solid rgba(34,197,94,0.5)' : '1px solid rgba(255,255,255,0.25)'
                        }}>
                          {msg.imageUrl ? (
                            <img 
                              src={msg.imageUrl} 
                              alt="Screenshot" 
                              style={{ 
                                maxWidth: '260px', 
                                height: 'auto', 
                                borderRadius: '8px',
                                display: 'block'
                              }} 
                            />
                          ) : (
                            msg.text
                          )}
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

                {/* Compose Area */}
                <div 
                  id="ccd-compose-sidepanel"
                  style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 40px auto',
                  gap: '8px',
                  alignItems: 'center',
                  padding: '12px 14px'
                }}>
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={handleChatKeyDown}
                    placeholder="Type your message..."
                    style={{
                      boxSizing: 'border-box',
                      height: '40px',
                      minHeight: '40px',
                      resize: 'vertical',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.20)',
                      color: 'white',
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
                      height: '40px',
                      background: 'rgba(255,255,255,0.15)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      color: 'white',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '18px',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                  >
                    📎
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
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
                    <span style={{ fontSize: '48px', marginBottom: '16px' }}>📥</span>
                    <div style={{ fontSize: '18px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px' }}>BEAP Inbox</div>
                    <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', maxWidth: '280px' }}>Received BEAP™ packages will appear here.</div>
                  </div>
                )}
                {beapSubmode === 'outbox' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
                    <span style={{ fontSize: '48px', marginBottom: '16px' }}>📤</span>
                    <div style={{ fontSize: '18px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px' }}>BEAP Outbox</div>
                    <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', maxWidth: '280px' }}>Packages pending delivery.</div>
                  </div>
                )}
                {beapSubmode === 'archived' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
                    <span style={{ fontSize: '48px', marginBottom: '16px' }}>📁</span>
                    <div style={{ fontSize: '18px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px' }}>Archived Packages</div>
                    <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', maxWidth: '280px' }}>Successfully executed packages.</div>
                  </div>
                )}
                {beapSubmode === 'rejected' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
                    <span style={{ fontSize: '48px', marginBottom: '16px' }}>🚫</span>
                    <div style={{ fontSize: '18px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px' }}>Rejected Packages</div>
                    <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', maxWidth: '280px' }}>Rejected packages.</div>
                  </div>
                )}
                
                {/* Draft view */}
                {beapSubmode === 'draft' && (
                  <>
                {/* DELIVERY METHOD - FIRST */}
                <div style={{ padding: '14px 18px', borderBottom: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Delivery Method</label>
                  <select value={handshakeDelivery} onChange={(e) => setHandshakeDelivery(e.target.value as 'email' | 'messenger' | 'download')} style={{ width: '100%', padding: '10px 12px', background: theme === 'standard' ? 'white' : '#1f2937', border: `1px solid ${theme === 'standard' ? 'rgba(147, 51, 234, 0.15)' : 'rgba(255,255,255,0.15)'}`, borderRadius: '8px', color: theme === 'standard' ? '#1f2937' : 'white', fontSize: '13px', cursor: 'pointer' }}>
                    <option value="email" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>📧 Email</option>
                    <option value="messenger" style={{ background: theme === 'standard' ? 'white' : '#1f2937', color: theme === 'standard' ? '#1f2937' : 'white' }}>💬 Messenger (Web)</option>
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
                      onClick={() => setShowEmailSetupWizard(true)}
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
                      background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.05)',
                      borderRadius: '8px',
                      border: theme === 'standard' ? '1px dashed rgba(15,23,42,0.2)' : '1px dashed rgba(255,255,255,0.2)',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
                      <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>No email accounts connected</div>
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
                              {account.provider === 'gmail' ? '📧' : account.provider === 'microsoft365' ? '📨' : '✉️'}
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
                      <select value={selectedEmailAccountId || emailAccounts[0]?.id || ''} onChange={(e) => setSelectedEmailAccountId(e.target.value)} style={{ width: '100%', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.1)', border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#0f172a' : 'white', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer', outline: 'none' }}>
                        {emailAccounts.map(account => (<option key={account.id} value={account.id}>{account.email || account.displayName} ({account.provider})</option>))}
                      </select>
                    </div>
                  )}
                </div>
                )}
                
                {/* BEAP™ Message UI - Admin View */}
                <div style={{ padding: '12px 14px', borderBottom: `1px solid ${theme === 'standard' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>📦</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#1f2937' : 'white' }}>BEAP™ Message</span>
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
                    <RecipientHandshakeSelect handshakes={handshakes} selectedHandshakeId={selectedRecipient?.handshake_id || null} onSelect={setSelectedRecipient} theme={theme} />
                  )}
                  {/* Delivery Method Panel - Adapts to recipient mode */}
                  <DeliveryMethodPanel deliveryMethod={handshakeDelivery} recipientMode={beapRecipientMode} selectedRecipient={selectedRecipient} emailTo={beapDraftTo} onEmailToChange={setBeapDraftTo} theme={theme} ourFingerprintShort={ourFingerprintShort} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: theme === 'standard' ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Message</label>
                    <textarea className="beap-textarea" value={beapDraftMessage} onChange={(e) => setBeapDraftMessage(e.target.value)} placeholder="Compose your BEAP™ message..." style={{ flex: 1, minHeight: '120px', background: theme === 'standard' ? 'white' : 'rgba(255,255,255,0.08)', border: theme === 'standard' ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.15)', color: theme === 'standard' ? '#0f172a' : 'white', borderRadius: '6px', padding: '10px 12px', fontSize: '12px', lineHeight: '1.5', resize: 'none', outline: 'none', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }} />
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
                      <select value={beapDraftSessionId} onChange={(e) => setBeapDraftSessionId(e.target.value)} onClick={() => loadAvailableSessions()} style={{ width: '100%', background: theme === 'standard' ? '#ffffff' : '#1e293b', border: theme === 'standard' ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.25)', color: theme === 'standard' ? '#0f172a' : '#f1f5f9', borderRadius: '6px', padding: '8px 10px', fontSize: '12px', outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}>
                        <option value="" style={{ background: theme === 'standard' ? '#ffffff' : '#1e293b', color: theme === 'standard' ? '#0f172a' : '#f1f5f9' }}>{availableSessions.length === 0 ? '— No sessions available —' : '— Select a session —'}</option>
                        {availableSessions.map((s) => (<option key={s.key} value={s.key} style={{ background: theme === 'standard' ? '#ffffff' : '#1e293b', color: theme === 'standard' ? '#0f172a' : '#f1f5f9' }}>{s.name} ({new Date(s.timestamp).toLocaleDateString()})</option>))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', fontWeight: 500, marginBottom: '4px', display: 'block', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>Attachments</label>
                      <input type="file" multiple onChange={async (e) => { const files = Array.from(e.target.files ?? []); if (!files.length) return; const newItems: DraftAttachment[] = []; for (const file of files) { if (file.size > 10 * 1024 * 1024) { console.warn(`[BEAP] Skipping ${file.name}: exceeds 10MB limit`); continue } if (beapDraftAttachments.length + newItems.length >= 20) { console.warn('[BEAP] Max 20 attachments reached'); break } const dataBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const res = String(reader.result ?? ''); resolve(res.includes(',') ? res.split(',')[1] : res) }; reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) }); const attachmentId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; const mimeType = file.type || 'application/octet-stream'; const isPdf = mimeType.toLowerCase() === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'); const capsuleAttachment: CapsuleAttachment = { id: attachmentId, originalName: file.name, originalSize: file.size, originalType: mimeType, semanticContent: null, semanticExtracted: false, encryptedRef: `encrypted_${attachmentId}`, encryptedHash: '', previewRef: null, rasterProof: null, isMedia: mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/'), hasTranscript: false }; newItems.push({ id: attachmentId, name: file.name, mime: mimeType, size: file.size, dataBase64, capsuleAttachment, processing: { parsing: isPdf, rasterizing: isPdf } }) } setBeapDraftAttachments((prev) => [...prev, ...newItems]); e.currentTarget.value = ''; for (const item of newItems) { const isPdf = item.mime.toLowerCase() === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf'); if (isPdf) { console.log(`[BEAP] Processing PDF: ${item.name}`); processAttachmentForParsing(item.capsuleAttachment, item.dataBase64).then((r) => { console.log(`[BEAP] Parse done: ${item.name}`); setBeapDraftAttachments((prev) => prev.map((a) => a.id === item.id ? { ...a, capsuleAttachment: r.attachment, processing: { ...a.processing, parsing: false, error: r.error || a.processing.error } } : a)) }).catch((err) => { setBeapDraftAttachments((prev) => prev.map((a) => a.id === item.id ? { ...a, processing: { ...a.processing, parsing: false, error: String(err) } } : a)) }); processAttachmentForRasterization(item.capsuleAttachment, item.dataBase64, 144).then((r) => { console.log(`[BEAP] Raster done: ${item.name}`); setBeapDraftAttachments((prev) => prev.map((a) => a.id === item.id ? { ...a, capsuleAttachment: { ...a.capsuleAttachment, previewRef: r.attachment.previewRef, rasterProof: r.rasterProof }, processing: { ...a.processing, rasterizing: false, error: r.error || a.processing.error } } : a)) }).catch((err) => { setBeapDraftAttachments((prev) => prev.map((a) => a.id === item.id ? { ...a, processing: { ...a.processing, rasterizing: false, error: String(err) } } : a)) }) } } }} style={{ fontSize: '11px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)' }} />
                      {beapDraftAttachments.length > 0 && (
                        <div style={{ marginTop: '8px' }}>
                          {beapDraftAttachments.map((a) => (<div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: theme === 'standard' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)', borderRadius: '4px', marginBottom: '4px' }}><div><div style={{ fontSize: '11px', color: theme === 'standard' ? '#0f172a' : 'white' }}>{a.name}{(a.processing.parsing || a.processing.rasterizing) && ' ⏳'}{a.capsuleAttachment.semanticExtracted && ' ✓'}</div><div style={{ fontSize: '9px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.5)' }}>{a.mime} · {a.size} bytes{a.processing.error && ` · ⚠️ ${a.processing.error.slice(0,30)}`}</div></div><button onClick={() => setBeapDraftAttachments((prev) => prev.filter((x) => x.id !== a.id))} style={{ background: 'transparent', border: 'none', color: theme === 'standard' ? '#ef4444' : '#f87171', fontSize: '10px', cursor: 'pointer' }}>Remove</button></div>))}
                          <button onClick={() => setBeapDraftAttachments([])} style={{ background: 'transparent', border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer', marginTop: '4px' }}>Clear all</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ padding: '12px 14px', borderTop: theme === 'standard' ? '1px solid rgba(147, 51, 234, 0.12)' : '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'flex-end', gap: '8px', background: theme === 'standard' ? '#ffffff' : 'rgba(0,0,0,0.2)' }}>
                  <button onClick={() => { setBeapDraftTo(''); setBeapDraftMessage(''); setBeapDraftEncryptedMessage(''); setBeapDraftSessionId(''); setBeapDraftAttachments([]); setSelectedRecipient(null) }} style={{ background: 'transparent', border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.2)', color: theme === 'standard' ? '#536471' : 'rgba(255,255,255,0.7)', borderRadius: '6px', padding: '8px 16px', fontSize: '12px', cursor: 'pointer' }}>Clear</button>
                  <button onClick={handleSendBeapMessage} disabled={isBeapSendDisabled} style={{ background: isBeapSendDisabled ? 'rgba(168,85,247,0.5)' : 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)', border: 'none', color: 'white', borderRadius: '6px', padding: '8px 20px', fontSize: '12px', fontWeight: 600, cursor: isBeapSendDisabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: isBeapSendDisabled ? 0.7 : 1 }}>{getBeapSendButtonLabel()}</button>
                </div>
                  </>
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
                onConnectEmail={() => setShowEmailSetupWizard(true)}
                onDisconnectEmail={disconnectEmailAccount}
                onSelectEmailAccount={setSelectedEmailAccountId}
              />
            )}

            {/* Trigger Creation UI */}
            {showTriggerPrompt && (
              <div style={{
                padding: '12px 14px',
                background: 'rgba(255,255,255,0.08)',
                borderTop: '1px solid rgba(255,255,255,0.20)'
              }}>
                <div style={{ marginBottom: '8px', fontSize: '12px', fontWeight: '700', opacity: 0.85 }}>
                  {showTriggerPrompt.mode === 'screenshot' ? '📸 Screenshot' : '🎥 Stream'}
                </div>
                {showTriggerPrompt.createTrigger && (
                  <input
                    type="text"
                    placeholder="Trigger Name"
                    value={showTriggerPrompt.name || ''}
                    onChange={(e) => setShowTriggerPrompt({ ...showTriggerPrompt, name: e.target.value })}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.20)',
                      color: 'white',
                      borderRadius: '6px',
                      fontSize: '12px',
                      marginBottom: '8px'
                    }}
                  />
                )}
                {showTriggerPrompt.addCommand && (
                  <textarea
                    placeholder="Optional Command"
                    value={showTriggerPrompt.command || ''}
                    onChange={(e) => setShowTriggerPrompt({ ...showTriggerPrompt, command: e.target.value })}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.20)',
                      color: 'white',
                      borderRadius: '6px',
                      fontSize: '12px',
                      minHeight: '60px',
                      marginBottom: '8px',
                      resize: 'vertical',
                      fontFamily: 'inherit'
                    }}
                  />
                )}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShowTriggerPrompt(null)}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(255,255,255,0.15)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      color: 'white',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      const name = showTriggerPrompt.name?.trim() || ''
                      const command = showTriggerPrompt.command?.trim() || ''
                      
                      // If createTrigger is checked, save the trigger
                      if (showTriggerPrompt.createTrigger) {
                        if (!name) {
                          alert('Please enter a trigger name')
                          return
                        }
                        
                        const triggerData = {
                          name,
                          command,
                          at: Date.now(),
                          rect: showTriggerPrompt.rect,
                          bounds: showTriggerPrompt.bounds,
                          mode: showTriggerPrompt.mode
                        }
                        
                        // Save to chrome.storage for dropdown
                        chrome.storage.local.get(['optimando-tagged-triggers'], (result) => {
                          const triggers = result['optimando-tagged-triggers'] || []
                          triggers.push(triggerData)
                          chrome.storage.local.set({ 'optimando-tagged-triggers': triggers }, () => {
                            console.log('✅ Trigger saved to storage:', triggerData)
                            setTriggers(triggers)
                            // Notify other contexts
                            try { chrome.runtime?.sendMessage({ type:'TRIGGERS_UPDATED' }) } catch {}
                          })
                        })
                        
                        // Send trigger to Electron
                        try {
                          chrome.runtime?.sendMessage({
                            type: 'ELECTRON_SAVE_TRIGGER',
                            name,
                            mode: showTriggerPrompt.mode,
                            rect: showTriggerPrompt.rect,
                            displayId: 0, // Main display for sidepanel
                            imageUrl: showTriggerPrompt.imageUrl,
                            videoUrl: showTriggerPrompt.videoUrl,
                            command: command || undefined
                          })
                        } catch (err) {
                          console.error('Error sending trigger to Electron:', err)
                        }
                      }
                      
                      // Auto-process: If there's a command or trigger name, send to LLM
                      const triggerNameToUse = name || command
                      const shouldAutoProcess = showTriggerPrompt.addCommand || (showTriggerPrompt.createTrigger && triggerNameToUse)
                      
                      if (shouldAutoProcess && triggerNameToUse && showTriggerPrompt.imageUrl) {
                        // Use the trigger name as @trigger format for routing
                        const triggerText = triggerNameToUse.startsWith('@') ? triggerNameToUse : `@${triggerNameToUse}`
                        
                        console.log('[Sidepanel] Auto-processing trigger creation:', { triggerText, hasImage: true })
                        
                        // Clear the prompt first
                        setShowTriggerPrompt(null)
                        setCreateTriggerChecked(false)
                        setAddCommandChecked(false)
                        
                        // Send to LLM for processing
                        handleSendMessageWithTrigger(triggerText, showTriggerPrompt.imageUrl)
                      } else {
                        // Just post the screenshot to chat (no auto-process)
                        if (showTriggerPrompt.imageUrl) {
                          const imageMessage = {
                            role: 'user' as const,
                            text: `![Screenshot](${showTriggerPrompt.imageUrl})`,
                            imageUrl: showTriggerPrompt.imageUrl
                          }
                          setChatMessages(prev => [...prev, imageMessage])
                          // Scroll to bottom
                          setTimeout(() => {
                            if (chatRef.current) {
                              chatRef.current.scrollTop = chatRef.current.scrollHeight
                            }
                          }, 100)
                        }
                        
                        // Clear the prompt
                        setShowTriggerPrompt(null)
                        setCreateTriggerChecked(false)
                        setAddCommandChecked(false)
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
                border: '1px solid rgba(15,23,42,0.2)',
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

      {/* Email Setup Wizard Modal - Global (accessible from all views) */}
      {showEmailSetupWizard && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          zIndex: 2147483651,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            width: '380px',
            maxHeight: '85vh',
            background: theme === 'standard' ? '#ffffff' : 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '16px',
            border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
            boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
            overflow: 'hidden'
          }}>
            {/* Header */}
            <div style={{
              padding: '20px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              color: 'white',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '24px' }}>📧</span>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: '600' }}>Connect Your Email</div>
                  <div style={{ fontSize: '11px', opacity: 0.9 }}>Secure access via official API</div>
                </div>
              </div>
              <button
                onClick={() => { setShowEmailSetupWizard(false); setEmailSetupStep('provider'); }}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  color: 'white',
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                ×
              </button>
            </div>
            
            {/* Content */}
            <div style={{ padding: '20px', overflowY: 'auto', maxHeight: 'calc(85vh - 80px)' }}>
              {emailSetupStep === 'provider' && (
                <>
                  <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '16px' }}>
                    Choose your email provider to connect securely:
                  </div>
                  
                  {/* Gmail Option */}
                  <button
                    onClick={startGmailConnect}
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                      border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      marginBottom: '10px',
                      textAlign: 'left',
                      transition: 'all 0.15s'
                    }}
                  >
                    <span style={{ fontSize: '24px' }}>📧</span>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Gmail</div>
                      <div style={{ fontSize: '11px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>Connect via Google OAuth</div>
                    </div>
                    <span style={{ marginLeft: 'auto', fontSize: '14px', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.4)' }}>→</span>
                  </button>
                  
                  {/* Microsoft 365 Option */}
                  <button
                    onClick={startOutlookConnect}
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                      border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      marginBottom: '10px',
                      textAlign: 'left',
                      transition: 'all 0.15s'
                    }}
                  >
                    <span style={{ fontSize: '24px' }}>📨</span>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Microsoft 365 / Outlook</div>
                      <div style={{ fontSize: '11px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>Connect via Microsoft OAuth</div>
                    </div>
                    <span style={{ marginLeft: 'auto', fontSize: '14px', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.4)' }}>→</span>
                  </button>
                  
                  {/* IMAP Option */}
                  <button
                    onClick={() => { setEmailSetupStep('credentials'); loadImapPresets(); }}
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                      border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      textAlign: 'left',
                      transition: 'all 0.15s'
                    }}
                  >
                    <span style={{ fontSize: '24px' }}>✉️</span>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Other (IMAP)</div>
                      <div style={{ fontSize: '11px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>Web.de, GMX, Yahoo, T-Online, etc.</div>
                    </div>
                    <span style={{ marginLeft: 'auto', fontSize: '14px', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.4)' }}>→</span>
                  </button>
                  
                  {/* Security note */}
                  <div style={{ 
                    marginTop: '16px', 
                    padding: '12px', 
                    background: theme === 'standard' ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.15)',
                    borderRadius: '8px',
                    border: '1px solid rgba(59,130,246,0.2)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <span style={{ fontSize: '14px' }}>🔒</span>
                      <div style={{ fontSize: '11px', color: theme === 'standard' ? '#1e40af' : 'rgba(255,255,255,0.8)', lineHeight: '1.5' }}>
                        <strong>Security:</strong> Your emails are never rendered with scripts or tracking. All content is sanitized locally before display.
                      </div>
                    </div>
                  </div>
                </>
              )}
              
              {emailSetupStep === 'credentials' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Back button */}
                  <button
                    onClick={() => setEmailSetupStep('provider')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: 'none',
                      border: 'none',
                      color: theme === 'standard' ? '#3b82f6' : '#60a5fa',
                      fontSize: '13px',
                      cursor: 'pointer',
                      padding: '0',
                      marginBottom: '8px'
                    }}
                  >
                    ← Back to providers
                  </button>
                  
                  {/* Preset selector */}
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>
                      Provider Preset (Optional)
                    </label>
                    <select
                      onChange={(e) => applyImapPreset(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                        border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '8px',
                        fontSize: '13px',
                        color: theme === 'standard' ? '#0f172a' : 'white'
                      }}
                    >
                      <option value="">Select a preset...</option>
                      {Object.entries(imapPresets).filter(([k]) => k !== 'custom').map(([key, preset]) => (
                        <option key={key} value={key}>{preset.name}</option>
                      ))}
                      <option value="custom">Custom IMAP Server</option>
                    </select>
                  </div>
                  
                  {/* Email field */}
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>
                      Email Address *
                    </label>
                    <input
                      type="email"
                      placeholder="your@email.com"
                      value={imapForm.email}
                      onChange={(e) => {
                        const email = e.target.value
                        setImapForm(prev => ({ ...prev, email, username: prev.username || email }))
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                        border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '8px',
                        fontSize: '13px',
                        color: theme === 'standard' ? '#0f172a' : 'white'
                      }}
                    />
                  </div>
                  
                  {/* IMAP Server */}
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px' }}>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>
                        IMAP Server *
                      </label>
                      <input
                        type="text"
                        placeholder="imap.example.com"
                        value={imapForm.host}
                        onChange={(e) => setImapForm(prev => ({ ...prev, host: e.target.value }))}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                          border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                          borderRadius: '8px',
                          fontSize: '13px',
                          color: theme === 'standard' ? '#0f172a' : 'white'
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>
                        Port
                      </label>
                      <input
                        type="number"
                        value={imapForm.port}
                        onChange={(e) => setImapForm(prev => ({ ...prev, port: parseInt(e.target.value) || 993 }))}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                          border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                          borderRadius: '8px',
                          fontSize: '13px',
                          color: theme === 'standard' ? '#0f172a' : 'white'
                        }}
                      />
                    </div>
                  </div>
                  
                  {/* Username */}
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>
                      Username *
                    </label>
                    <input
                      type="text"
                      placeholder="Usually your email address"
                      value={imapForm.username}
                      onChange={(e) => setImapForm(prev => ({ ...prev, username: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                        border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '8px',
                        fontSize: '13px',
                        color: theme === 'standard' ? '#0f172a' : 'white'
                      }}
                    />
                  </div>
                  
                  {/* Password */}
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>
                      Password / App Password *
                    </label>
                    <input
                      type="password"
                      placeholder="Your password or app-specific password"
                      value={imapForm.password}
                      onChange={(e) => setImapForm(prev => ({ ...prev, password: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                        border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '8px',
                        fontSize: '13px',
                        color: theme === 'standard' ? '#0f172a' : 'white'
                      }}
                    />
                  </div>
                  
                  {/* Connect button */}
                  <button
                    onClick={connectImapAccount}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                      border: 'none',
                      borderRadius: '8px',
                      color: 'white',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      marginTop: '8px'
                    }}
                  >
                    Connect Email Account
                  </button>
                  
                  {/* Security note */}
                  <div style={{ 
                    marginTop: '8px', 
                    padding: '10px', 
                    background: theme === 'standard' ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.15)',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: theme === 'standard' ? '#1e40af' : 'rgba(255,255,255,0.8)',
                    lineHeight: '1.4'
                  }}>
                    🔒 <strong>Tip:</strong> For Gmail, Yahoo, and other accounts with 2FA, use an App Password instead of your regular password.
                  </div>
                </div>
              )}
              
              {/* Gmail OAuth Credentials Form */}
              {emailSetupStep === 'gmail-credentials' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <button
                    onClick={() => setEmailSetupStep('provider')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      background: 'none', border: 'none',
                      color: theme === 'standard' ? '#3b82f6' : '#60a5fa',
                      fontSize: '13px', cursor: 'pointer', padding: '0', marginBottom: '8px'
                    }}
                  >
                    ← Back to providers
                  </button>
                  
                  <div style={{ 
                    padding: '12px', 
                    background: theme === 'standard' ? 'rgba(234,179,8,0.1)' : 'rgba(234,179,8,0.15)',
                    borderRadius: '8px', border: '1px solid rgba(234,179,8,0.3)', marginBottom: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <span>⚙️</span>
                      <div style={{ fontSize: '11px', color: theme === 'standard' ? '#854d0e' : 'rgba(255,255,255,0.9)', lineHeight: '1.5' }}>
                        <strong>One-time setup:</strong> You need a Google Cloud OAuth Client ID. 
                        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" 
                           style={{ color: theme === 'standard' ? '#3b82f6' : '#60a5fa', marginLeft: '4px' }}>
                          Get it here →
                        </a>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>
                      Client ID *
                    </label>
                    <input
                      type="text"
                      placeholder="xxxxxxxxx.apps.googleusercontent.com"
                      value={gmailCredentials.clientId}
                      onChange={(e) => setGmailCredentials(prev => ({ ...prev, clientId: e.target.value }))}
                      style={{
                        width: '100%', padding: '10px 12px',
                        background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                        border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '8px', fontSize: '13px', color: theme === 'standard' ? '#0f172a' : 'white'
                      }}
                    />
                  </div>
                  
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>
                      Client Secret *
                    </label>
                    <input
                      type="password"
                      placeholder="GOCSPX-xxxxxxxxx"
                      value={gmailCredentials.clientSecret}
                      onChange={(e) => setGmailCredentials(prev => ({ ...prev, clientSecret: e.target.value }))}
                      style={{
                        width: '100%', padding: '10px 12px',
                        background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                        border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '8px', fontSize: '13px', color: theme === 'standard' ? '#0f172a' : 'white'
                      }}
                    />
                  </div>
                  
                  <button
                    onClick={saveGmailCredentialsAndConnect}
                    style={{
                      width: '100%', padding: '12px',
                      background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                      border: 'none', borderRadius: '8px',
                      color: 'white', fontSize: '14px', fontWeight: '600',
                      cursor: 'pointer', marginTop: '8px'
                    }}
                  >
                    Save & Connect Gmail
                  </button>
                </div>
              )}
              
              {/* Outlook OAuth Credentials Form */}
              {emailSetupStep === 'outlook-credentials' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <button
                    onClick={() => setEmailSetupStep('provider')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      background: 'none', border: 'none',
                      color: theme === 'standard' ? '#3b82f6' : '#60a5fa',
                      fontSize: '13px', cursor: 'pointer', padding: '0', marginBottom: '8px'
                    }}
                  >
                    ← Back to providers
                  </button>
                  
                  <div style={{ 
                    padding: '12px', 
                    background: theme === 'standard' ? 'rgba(234,179,8,0.1)' : 'rgba(234,179,8,0.15)',
                    borderRadius: '8px', border: '1px solid rgba(234,179,8,0.3)', marginBottom: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <span>⚙️</span>
                      <div style={{ fontSize: '11px', color: theme === 'standard' ? '#854d0e' : 'rgba(255,255,255,0.9)', lineHeight: '1.5' }}>
                        <strong>One-time setup:</strong> You need an Azure AD App Registration. 
                        <a href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener" 
                           style={{ color: theme === 'standard' ? '#3b82f6' : '#60a5fa', marginLeft: '4px' }}>
                          Get it here →
                        </a>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>
                      Application (Client) ID *
                    </label>
                    <input
                      type="text"
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      value={outlookCredentials.clientId}
                      onChange={(e) => setOutlookCredentials(prev => ({ ...prev, clientId: e.target.value }))}
                      style={{
                        width: '100%', padding: '10px 12px',
                        background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                        border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '8px', fontSize: '13px', color: theme === 'standard' ? '#0f172a' : 'white'
                      }}
                    />
                  </div>
                  
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>
                      Client Secret (optional for public clients)
                    </label>
                    <input
                      type="password"
                      placeholder="Leave empty for public client apps"
                      value={outlookCredentials.clientSecret}
                      onChange={(e) => setOutlookCredentials(prev => ({ ...prev, clientSecret: e.target.value }))}
                      style={{
                        width: '100%', padding: '10px 12px',
                        background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                        border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '8px', fontSize: '13px', color: theme === 'standard' ? '#0f172a' : 'white'
                      }}
                    />
                  </div>
                  
                  <button
                    onClick={saveOutlookCredentialsAndConnect}
                    style={{
                      width: '100%', padding: '12px',
                      background: 'linear-gradient(135deg, #0078d4 0%, #004578 100%)',
                      border: 'none', borderRadius: '8px',
                      color: 'white', fontSize: '14px', fontWeight: '600',
                      cursor: 'pointer', marginTop: '8px'
                    }}
                  >
                    Save & Connect Outlook
                  </button>
                </div>
              )}
              
              {emailSetupStep === 'connecting' && (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <div style={{ 
                    width: '48px', 
                    height: '48px', 
                    border: '3px solid rgba(59,130,246,0.3)',
                    borderTopColor: '#3b82f6',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    margin: '0 auto 20px'
                  }} />
                  <div style={{ fontSize: '14px', color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px', fontWeight: '600' }}>
                    Waiting for Authorization...
                  </div>
                  <div style={{ fontSize: '12px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)', marginBottom: '12px' }}>
                    A browser window should open for you to sign in.
                  </div>
                  <div style={{ 
                    fontSize: '11px', 
                    color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.4)',
                    padding: '12px',
                    background: theme === 'standard' ? '#f1f5f9' : 'rgba(255,255,255,0.05)',
                    borderRadius: '8px',
                    lineHeight: '1.5'
                  }}>
                    💡 Complete the sign-in in your browser, then return here. This may take a few minutes.
                  </div>
                  <style>{`
                    @keyframes spin {
                      to { transform: rotate(360deg); }
                    }
                  `}</style>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>{notification.message}</span>
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
