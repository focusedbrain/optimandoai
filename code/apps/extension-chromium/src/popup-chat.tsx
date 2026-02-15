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
import { WRGuardWorkspace } from './wrguard'
import { formatFingerprintShort, formatFingerprintGrouped } from './handshake/fingerprint'
import { HANDSHAKE_REQUEST_TEMPLATE, POLICY_NOTES } from './handshake/microcopy'
import { RecipientModeSwitch, RecipientHandshakeSelect, DeliveryMethodPanel, executeDeliveryAction } from './beap-messages'
import type { RecipientMode, SelectedRecipient, DeliveryMethod, BeapPackageConfig } from './beap-messages'
import { useHandshakeStore } from './handshake/useHandshakeStore'
import {
  getOurIdentity,
  createHandshakeRequestPayload,
  type OurIdentity
} from './handshake/handshakeService'
import { serializeHandshakeRequestPayload } from './handshake/handshakePayload'
import { processAttachmentForParsing, processAttachmentForRasterization } from './beap-builder'
import type { CapsuleAttachment, RasterProof, RasterPageData } from './beap-builder'

// =============================================================================
// Theme Type - Matches docked version
// =============================================================================

type Theme = 'pro' | 'dark' | 'standard'

// Workspace types - MIRRORS docked sidepanel exactly
type DockedWorkspace = 'wr-chat' | 'augmented-overlay' | 'beap-messages' | 'wrguard'
type DockedSubmode = 'command' | 'p2p-chat' | 'p2p-stream' | 'group-stream' | 'handshake'
type BeapSubmode = 'inbox' | 'draft' | 'outbox' | 'archived' | 'rejected'

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
  if (t === 'professional' || t === 'pro') return 'pro'
  if (t === 'dark') return 'dark'
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
  const [userInfo, setUserInfo] = useState<{ displayName?: string; email?: string; initials?: string; picture?: string }>({})
  const [pictureError, setPictureError] = useState(false)
  
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
        } else {
          setIsLoggedIn(false);
          setUserInfo({});
        }
      });
    };

    checkAuthStatus();
    // Refresh auth status every 30 seconds
    const interval = setInterval(checkAuthStatus, 30000);
    return () => clearInterval(interval);
  }, []);
  
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
    chrome.runtime.sendMessage({ type: 'AUTH_LOGIN' }, (response) => {
      setIsLoggingIn(false);
      if (response?.ok) {
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
          }
        });
      } else {
        // SSO failed for any reason - fall back to opening wrdesk.com
        console.log('[AUTH] SSO failed, falling back to wrdesk.com. Reason:', response?.error || 'unknown');
        chrome.runtime.sendMessage({ type: 'OPEN_WRDESK_HOME_IF_NEEDED' });
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
  const [beapSubmode, setBeapSubmode] = useState<BeapSubmode>('inbox')
  
  // Handle launchMode query parameter from Electron dashboard
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const launchMode = params.get('launchMode')
    if (launchMode === 'dashboard-beap') {
      // Preselect BEAP Messages with Inbox when opened from dashboard
      setDockedWorkspace('beap-messages')
      setBeapSubmode('inbox')
    }
  }, []) // Only run on mount
  
  // Helper to get combined mode for conditional rendering - SAME as docked
  const dockedPanelMode = dockedWorkspace === 'wr-chat' ? dockedSubmode : dockedWorkspace
  
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
        console.error('[PopupChat] Failed to load identity:', err)
      })
      .finally(() => {
        if (mounted) setIdentityLoading(false)
      })
    
    return () => { mounted = false }
  }, [])
  
  // Derived fingerprint values (safe to use after loading)
  const ourFingerprint = identity?.fingerprint || ''
  const ourFingerprintShort = identity ? formatFingerprintShort(identity.fingerprint) : '...'
  
  // Initial handshake message template with fingerprint
  const initialHandshakeMessage = ourFingerprint 
    ? HANDSHAKE_REQUEST_TEMPLATE.replace('[FINGERPRINT]', ourFingerprint)
    : HANDSHAKE_REQUEST_TEMPLATE
  
  // BEAP Handshake Request state
  const [handshakeDelivery, setHandshakeDelivery] = useState<'email' | 'messenger' | 'download'>('email')
  const [handshakeTo, setHandshakeTo] = useState('')
  const [handshakeSubject, setHandshakeSubject] = useState('Request to Establish BEAP™ Secure Communication Handshake')
  const [handshakeMessage, setHandshakeMessage] = useState('')
  const [fingerprintCopied, setFingerprintCopied] = useState(false)
  
  // BEAP Draft separate state (like docked version)
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
    lastError?: string
  }
  
  const [emailAccounts, setEmailAccounts] = useState<EmailAccountPopup[]>([])
  const [isLoadingEmailAccounts, setIsLoadingEmailAccounts] = useState(false)
  const [selectedEmailAccountId, setSelectedEmailAccountId] = useState<string | null>(null)
  const [showEmailSetupWizard, setShowEmailSetupWizard] = useState(false)
  const [emailSetupStep, setEmailSetupStep] = useState<'provider' | 'connecting'>('provider')
  const [isConnectingEmail, setIsConnectingEmail] = useState(false)
  
  // Load email accounts from Electron via background script
  const loadEmailAccounts = async () => {
    setIsLoadingEmailAccounts(true)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EMAIL_LIST_ACCOUNTS' })
      if (response?.ok && response?.data) {
        setEmailAccounts(response.data)
        if (response.data.length > 0 && !selectedEmailAccountId) {
          setSelectedEmailAccountId(response.data[0].id)
        }
      }
    } catch (error) {
      console.error('[PopupChat] Failed to load email accounts:', error)
    } finally {
      setIsLoadingEmailAccounts(false)
    }
  }
  
  // Load email accounts on mount
  useEffect(() => {
    loadEmailAccounts()
  }, [])
  
  // Reload email accounts when switching to relevant workspaces
  useEffect(() => {
    if (dockedWorkspace === 'beap-messages' || dockedWorkspace === 'wrguard') {
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
  
  // Connect email handler - opens the wizard modal
  const handleConnectEmail = () => {
    console.log('[PopupChat] handleConnectEmail called, opening wizard modal')
    setShowEmailSetupWizard(true)
    setEmailSetupStep('provider')
  }
  
  // Helper to clean up error messages
  const cleanErrorMessage = (error: string): string => {
    // If it looks like HTML, extract a simple message
    if (error.includes('<!DOCTYPE') || error.includes('<html')) {
      return 'Backend server not available. Please ensure the server is running.'
    }
    // If it starts with "Request failed:", clean it up
    if (error.startsWith('Request failed:')) {
      const cleanedError = error.replace('Request failed:', '').trim()
      if (cleanedError.includes('<!DOCTYPE') || cleanedError.includes('<html')) {
        return 'Backend server not available. Please ensure the server is running.'
      }
      return cleanedError || 'Connection failed'
    }
    return error
  }
  
  // Gmail OAuth connect
  const connectGmailAccount = async () => {
    // Prevent double-clicks
    if (isConnectingEmail) return
    
    setIsConnectingEmail(true)
    setEmailSetupStep('connecting')
    
    // Small delay to show the connecting state before async operation
    await new Promise(resolve => setTimeout(resolve, 100))
    
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EMAIL_CONNECT_GMAIL' })
      if (response?.ok && response?.data) {
        // Reload accounts from backend to ensure consistency
        await loadEmailAccounts()
        setSelectedEmailAccountId(response.data.id)
        setToastMessage({ message: 'Gmail connected successfully!', type: 'success' })
        setShowEmailSetupWizard(false)
        setEmailSetupStep('provider')
      } else {
        const errorMsg = response?.error || 'Failed to connect Gmail'
        throw new Error(cleanErrorMessage(errorMsg))
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Failed to connect Gmail'
      const message = cleanErrorMessage(rawMessage)
      setToastMessage({ message, type: 'error' })
      // Delay returning to provider to prevent flicker
      await new Promise(resolve => setTimeout(resolve, 500))
      setEmailSetupStep('provider')
    } finally {
      setIsConnectingEmail(false)
      setTimeout(() => setToastMessage(null), 4000)
    }
  }
  
  // Outlook OAuth connect
  const connectOutlookAccount = async () => {
    // Prevent double-clicks
    if (isConnectingEmail) return
    
    setIsConnectingEmail(true)
    setEmailSetupStep('connecting')
    
    // Small delay to show the connecting state before async operation
    await new Promise(resolve => setTimeout(resolve, 100))
    
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EMAIL_CONNECT_OUTLOOK' })
      if (response?.ok && response?.data) {
        // Reload accounts from backend to ensure consistency
        await loadEmailAccounts()
        setSelectedEmailAccountId(response.data.id)
        setToastMessage({ message: 'Microsoft 365 connected successfully!', type: 'success' })
        setShowEmailSetupWizard(false)
        setEmailSetupStep('provider')
      } else {
        const errorMsg = response?.error || 'Failed to connect Outlook'
        throw new Error(cleanErrorMessage(errorMsg))
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Failed to connect Outlook'
      const message = cleanErrorMessage(rawMessage)
      setToastMessage({ message, type: 'error' })
      // Delay returning to provider to prevent flicker
      await new Promise(resolve => setTimeout(resolve, 500))
      setEmailSetupStep('provider')
    } finally {
      setIsConnectingEmail(false)
      setTimeout(() => setToastMessage(null), 4000)
    }
  }
  
  // BEAP Message sending state
  const [isSendingBeap, setIsSendingBeap] = useState(false)
  const [toastMessage, setToastMessage] = useState<{message: string, type: 'success' | 'error'} | null>(null)
  
  // Handler for sending BEAP messages (matches docked sidepanel exactly)
  const handleSendBeapMessage = async () => {
    // Validate preconditions
    if (beapRecipientMode === 'private' && !selectedRecipient) {
      setToastMessage({ message: 'Please select a handshake recipient', type: 'error' })
      setTimeout(() => setToastMessage(null), 3000)
      return
    }
    
    if (!beapDraftMessage.trim()) {
      setToastMessage({ message: 'Please enter a message', type: 'error' })
      setTimeout(() => setToastMessage(null), 3000)
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
        deliveryMethod: beapDeliveryMethod as DeliveryMethod,
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
        const actionLabel = beapDeliveryMethod === 'download' ? 'Package downloaded!' 
          : beapDeliveryMethod === 'messenger' ? 'Payload copied to clipboard!' 
          : 'BEAP™ Message sent!'
        setToastMessage({ message: actionLabel, type: 'success' })
        
        // Clear form
        setBeapDraftTo('')
        setBeapDraftMessage('')
        setBeapDraftEncryptedMessage('')
        setBeapDraftSessionId('')
        setBeapDraftAttachments([])
        setSelectedRecipient(null)
      } else {
        setToastMessage({ message: result.message || 'Failed to send message', type: 'error' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred'
      setToastMessage({ message, type: 'error' })
    } finally {
      setIsSendingBeap(false)
      setTimeout(() => setToastMessage(null), 3000)
    }
  }
  
  // Get button label based on delivery method
  const getBeapSendButtonLabel = () => {
    if (isSendingBeap) return '⏳ Processing...'
    switch (beapDeliveryMethod) {
      case 'email': return '📧 Send'
      case 'messenger': return '📋 Copy'
      case 'download': return '💾 Download'
      default: return '📤 Send'
    }
  }
  
  // Check if send button should be disabled
  const isBeapSendDisabled = isSendingBeap || !beapDraftMessage.trim() || 
    (beapRecipientMode === 'private' && !selectedRecipient)
  
  // Sync message with fingerprint if it changes (backup)
  useEffect(() => {
    if (!handshakeMessage || handshakeMessage.trim() === '') {
      setHandshakeMessage(initialHandshakeMessage)
    }
  }, [initialHandshakeMessage, handshakeMessage])
  
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
  const [beapDeliveryMethod, setBeapDeliveryMethod] = useState<'email' | 'messenger' | 'download'>('email')
  const [beapFingerprintCopied, setBeapFingerprintCopied] = useState(false)
  
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
                onChange={(e) => setBeapDeliveryMethod(e.target.value as 'email' | 'messenger' | 'download')}
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
                <option value="messenger" style={{ background: isStandard ? 'white' : '#1f2937', color: isStandard ? '#1f2937' : 'white' }}>💬 Messenger (Web)</option>
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
                        value={selectedEmailAccountId || emailAccounts[0]?.id || ''}
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
              <span style={{ fontSize: '13px', fontWeight: '600', color: textColor }}>BEAP™ Message</span>
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
                deliveryMethod={beapDeliveryMethod}
                recipientMode={beapRecipientMode}
                selectedRecipient={selectedRecipient}
                emailTo={beapDraftTo}
                onEmailToChange={setBeapDraftTo}
                theme={theme}
                ourFingerprintShort={ourFingerprintShort}
              />
              
              {/* Message Content */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: mutedColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Message
                </label>
                <textarea
                  value={beapDraftMessage}
                  onChange={(e) => setBeapDraftMessage(e.target.value)}
                  placeholder="Compose your BEAP™ message..."
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
                  <label style={{ fontSize: '10px', fontWeight: 500, marginBottom: '4px', display: 'block', color: mutedColor }}>Attachments</label>
                  <input type="file" multiple onChange={async (e) => { const files = Array.from(e.target.files ?? []); if (!files.length) return; const newItems: DraftAttachment[] = []; for (const file of files) { if (file.size > 10 * 1024 * 1024) { console.warn(`[BEAP] Skipping ${file.name}: exceeds 10MB limit`); continue } if (beapDraftAttachments.length + newItems.length >= 20) { console.warn('[BEAP] Max 20 attachments reached'); break } const dataBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const res = String(reader.result ?? ''); resolve(res.includes(',') ? res.split(',')[1] : res) }; reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) }); const attachmentId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; const mimeType = file.type || 'application/octet-stream'; const isPdf = mimeType.toLowerCase() === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'); const capsuleAttachment: CapsuleAttachment = { id: attachmentId, originalName: file.name, originalSize: file.size, originalType: mimeType, semanticContent: null, semanticExtracted: false, encryptedRef: `encrypted_${attachmentId}`, encryptedHash: '', previewRef: null, rasterProof: null, isMedia: mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/'), hasTranscript: false }; newItems.push({ id: attachmentId, name: file.name, mime: mimeType, size: file.size, dataBase64, capsuleAttachment, processing: { parsing: isPdf, rasterizing: isPdf } }) } setBeapDraftAttachments((prev) => [...prev, ...newItems]); e.currentTarget.value = ''; for (const item of newItems) { const isPdf = item.mime.toLowerCase() === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf'); if (isPdf) { console.log(`[BEAP] Processing PDF: ${item.name}`); processAttachmentForParsing(item.capsuleAttachment, item.dataBase64).then((r) => { console.log(`[BEAP] Parse done: ${item.name}`); setBeapDraftAttachments((prev) => prev.map((a) => a.id === item.id ? { ...a, capsuleAttachment: r.attachment, processing: { ...a.processing, parsing: false, error: r.error || a.processing.error } } : a)) }).catch((err) => { setBeapDraftAttachments((prev) => prev.map((a) => a.id === item.id ? { ...a, processing: { ...a.processing, parsing: false, error: String(err) } } : a)) }); processAttachmentForRasterization(item.capsuleAttachment, item.dataBase64, 144).then((r) => { console.log(`[BEAP] Raster done: ${item.name}`, r.rasterPageData?.length || 0, 'pages'); setBeapDraftAttachments((prev) => prev.map((a) => a.id === item.id ? { ...a, capsuleAttachment: { ...a.capsuleAttachment, previewRef: r.attachment.previewRef, rasterProof: r.rasterProof }, processing: { ...a.processing, rasterizing: false, error: r.error || a.processing.error }, rasterPageData: r.rasterPageData || undefined } : a)) }).catch((err) => { setBeapDraftAttachments((prev) => prev.map((a) => a.id === item.id ? { ...a, processing: { ...a.processing, rasterizing: false, error: String(err) } } : a)) }) } } }} style={{ fontSize: '11px', color: mutedColor }} />
                  {beapDraftAttachments.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      {beapDraftAttachments.map((a) => (<div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: isStandard ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)', borderRadius: '4px', marginBottom: '4px' }}><div><div style={{ fontSize: '11px', color: textColor }}>{a.name}{(a.processing.parsing || a.processing.rasterizing) && ' ⏳'}{a.capsuleAttachment.semanticExtracted && ' ✓'}</div><div style={{ fontSize: '9px', color: mutedColor }}>{a.mime} · {a.size} bytes{a.processing.error && ` · ⚠️ ${a.processing.error.slice(0,30)}`}</div></div><button onClick={() => setBeapDraftAttachments((prev) => prev.filter((x) => x.id !== a.id))} style={{ background: 'transparent', border: 'none', color: isStandard ? '#ef4444' : '#f87171', fontSize: '10px', cursor: 'pointer' }}>Remove</button></div>))}
                      <button onClick={() => setBeapDraftAttachments([])} style={{ background: 'transparent', border: isStandard ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.2)', color: mutedColor, borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer', marginTop: '4px' }}>Clear all</button>
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
          onSelectEmailAccount={setSelectedEmailAccountId}
        />
      )
    }
    
    // BEAP Messages workspace - simple inline views
    if (dockedWorkspace === 'beap-messages') {
      return renderBeapMessagesContent()
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
        return <CommandChatView theme={theme} />
      case 'p2p-chat':
        return <P2PChatPlaceholder theme={theme} />
      case 'p2p-stream':
        return <P2PStreamPlaceholder theme={theme} />
      case 'group-stream':
        return <GroupChatPlaceholder theme={theme} />
      case 'handshake':
        return renderHandshakeRequest()
      default:
        return <CommandChatView theme={theme} />
    }
  }
  
  // Render BEAP Handshake Request Interface
  const renderHandshakeRequest = () => {
    const isStandard = theme === 'standard'
    const isPro = theme === 'pro'
    
    return (
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        background: isPro ? 'rgba(118, 75, 162, 0.45)' : (isStandard ? '#f8f9fb' : 'rgba(255,255,255,0.06)'),
        overflow: 'hidden' 
      }}>
        {/* Header */}
        <div style={{ 
          padding: '12px 14px', 
          borderBottom: `1px solid ${isStandard ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`, 
          display: 'flex', 
          alignItems: 'center', 
          gap: '10px' 
        }}>
          <span style={{ fontSize: '18px' }}>🤝</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: isStandard ? '#1f2937' : 'white' }}>BEAP™ Handshake Request</span>
        </div>
        
        {/* DELIVERY METHOD - FIRST */}
        <div style={{ padding: '14px 18px', borderBottom: isStandard ? '1px solid rgba(15,23,42,0.1)' : '1px solid rgba(255,255,255,0.1)' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: isStandard ? '#6b7280' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Delivery Method
          </label>
          <select
            value={handshakeDelivery}
            onChange={(e) => setHandshakeDelivery(e.target.value as 'email' | 'messenger' | 'download')}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: isStandard ? 'white' : '#1f2937',
              border: `1px solid ${isStandard ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
              borderRadius: '8px',
              color: isStandard ? '#1f2937' : 'white',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            <option value="email" style={{ background: isStandard ? 'white' : '#1f2937', color: isStandard ? '#1f2937' : 'white' }}>📧 Email</option>
            <option value="messenger" style={{ background: isStandard ? 'white' : '#1f2937', color: isStandard ? '#1f2937' : 'white' }}>💬 Messenger (Web)</option>
            <option value="download" style={{ background: isStandard ? 'white' : '#1f2937', color: isStandard ? '#1f2937' : 'white' }}>💾 Download (USB/Wallet)</option>
          </select>
        </div>
        
        {/* EMAIL ACCOUNTS SECTION - Only visible when email delivery selected */}
        {handshakeDelivery === 'email' && (
        <div style={{ 
          padding: '16px 18px', 
          borderBottom: isStandard ? '1px solid rgba(15,23,42,0.1)' : '1px solid rgba(255,255,255,0.1)',
          background: isStandard ? 'rgba(139,92,246,0.05)' : 'rgba(139,92,246,0.1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>🔗</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: isStandard ? '#0f172a' : 'white' }}>Connected Email Accounts</span>
            </div>
            <button
              type="button"
              onClick={handleConnectEmail}
              style={{
                background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
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
            <div style={{ padding: '12px', textAlign: 'center', opacity: 0.6, fontSize: '12px' }}>Loading accounts...</div>
          ) : emailAccounts.length === 0 ? (
            <div style={{ 
              padding: '20px', 
              background: isStandard ? 'white' : 'rgba(255,255,255,0.05)',
              borderRadius: '8px',
              border: isStandard ? '1px dashed rgba(15,23,42,0.2)' : '1px dashed rgba(255,255,255,0.2)',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
              <div style={{ fontSize: '13px', color: isStandard ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>No email accounts connected</div>
              <div style={{ fontSize: '11px', color: isStandard ? '#94a3b8' : 'rgba(255,255,255,0.5)' }}>
                Connect your email to send handshake requests
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
                      <div style={{ fontSize: '13px', fontWeight: '500', color: isStandard ? '#0f172a' : 'white' }}>
                        {account.email || account.displayName}
                      </div>
                      <div style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: account.status === 'active' ? '#22c55e' : '#ef4444' }} />
                        <span style={{ color: isStandard ? '#64748b' : 'rgba(255,255,255,0.6)' }}>
                          {account.status === 'active' ? 'Connected' : account.lastError || 'Error'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => disconnectEmailAccount(account.id)}
                    title="Disconnect"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: isStandard ? '#94a3b8' : 'rgba(255,255,255,0.5)',
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
          
          {/* Send From selector */}
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
                value={selectedEmailAccountId || emailAccounts[0]?.id || ''}
                onChange={(e) => setSelectedEmailAccountId(e.target.value)}
                style={{
                  width: '100%',
                  background: isStandard ? 'white' : 'rgba(255,255,255,0.1)',
                  border: isStandard ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.2)',
                  color: isStandard ? '#0f172a' : 'white',
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
        
        <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Your Fingerprint - PROMINENT */}
          <div style={{
            padding: '12px 14px',
            background: isStandard ? '#f8f9fb' : 'rgba(139, 92, 246, 0.15)',
            border: `2px solid ${isStandard ? '#e1e8ed' : 'rgba(139, 92, 246, 0.3)'}`,
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
                color: isStandard ? '#6b7280' : 'rgba(255,255,255,0.7)', 
                textTransform: 'uppercase', 
                letterSpacing: '0.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}>
                🔐 Your Fingerprint
                <span 
                  style={{ cursor: 'help', fontSize: '11px', fontWeight: 400 }}
                  title="A fingerprint is a short identifier derived from the handshake identity. It helps prevent mix-ups and look-alike contacts. It is not a secret key."
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
                  background: isStandard ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '4px',
                  color: isStandard ? '#6b7280' : 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                }}
              >
                {fingerprintCopied ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>
            <div style={{
              fontFamily: 'monospace',
              fontSize: '11px',
              color: isStandard ? '#1f2937' : 'white',
              wordBreak: 'break-all',
              lineHeight: 1.5,
            }}>
              {formatFingerprintGrouped(ourFingerprint)}
            </div>
            <div style={{
              marginTop: '8px',
              fontSize: '10px',
              color: isStandard ? '#9ca3af' : 'rgba(255,255,255,0.5)',
            }}>
              Short: <span style={{ fontFamily: 'monospace' }}>{ourFingerprintShort}</span>
            </div>
          </div>
          
          {/* To & Subject Fields - Only for Email */}
          {handshakeDelivery === 'email' && (
            <>
              <div>
                <label style={{ 
                  fontSize: '11px', 
                  fontWeight: 600, 
                  marginBottom: '6px', 
                  display: 'block', 
                  color: isStandard ? '#6b7280' : 'rgba(255,255,255,0.7)', 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.5px' 
                }}>
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
                    background: isStandard ? 'white' : 'rgba(255,255,255,0.08)',
                    border: `1px solid ${isStandard ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
                    borderRadius: '8px',
                    color: isStandard ? '#1f2937' : 'white',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ 
                  fontSize: '11px', 
                  fontWeight: 600, 
                  marginBottom: '6px', 
                  display: 'block', 
                  color: isStandard ? '#6b7280' : 'rgba(255,255,255,0.7)', 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.5px' 
                }}>
                  Subject:
                </label>
                <input
                  type="text"
                  value={handshakeSubject}
                  onChange={(e) => setHandshakeSubject(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: isStandard ? 'white' : 'rgba(255,255,255,0.08)',
                    border: `1px solid ${isStandard ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
                    borderRadius: '8px',
                    color: isStandard ? '#1f2937' : 'white',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </>
          )}
          
          {/* Message */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <label style={{ 
              fontSize: '11px', 
              fontWeight: 600, 
              marginBottom: '6px', 
              display: 'block', 
              color: isStandard ? '#6b7280' : 'rgba(255,255,255,0.7)', 
              textTransform: 'uppercase', 
              letterSpacing: '0.5px' 
            }}>
              Message
            </label>
            <textarea
              value={handshakeMessage}
              onChange={(e) => setHandshakeMessage(e.target.value)}
              style={{
                flex: 1,
                minHeight: '180px',
                padding: '10px 12px',
                background: isStandard ? 'white' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${isStandard ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: '8px',
                color: isStandard ? '#1f2937' : 'white',
                fontSize: '13px',
                lineHeight: '1.5',
                resize: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          
          {/* Info */}
          <div style={{
            padding: '10px 12px',
            background: isStandard ? '#f8f9fb' : 'rgba(139, 92, 246, 0.15)',
            borderRadius: '8px',
            fontSize: '11px',
            color: isStandard ? '#6b7280' : 'rgba(255,255,255,0.8)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}>
            <div>💡 This creates a secure BEAP™ package. Recipient will appear in your Handshakes once accepted.</div>
            <div style={{ opacity: 0.8, fontSize: '10px' }}>ℹ️ {POLICY_NOTES.LOCAL_OVERRIDE}</div>
          </div>
        </div>
        
        {/* Footer */}
        <div style={{ 
          padding: '12px 14px', 
          borderTop: `1px solid ${isStandard ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`, 
          display: 'flex', 
          gap: '10px', 
          justifyContent: 'flex-end' 
        }}>
          <button 
            onClick={() => setDockedSubmode('command')}
            style={{ 
              padding: '8px 16px', 
              background: 'transparent', 
              border: `1px solid ${isStandard ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)'}`, 
              borderRadius: '8px', 
              color: isStandard ? '#6b7280' : 'white', 
              fontSize: '12px', 
              cursor: 'pointer' 
            }}
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
                
                console.log('[PopupChat] Handshake request created:', {
                  fingerprint: payload.senderFingerprint.slice(0, 8) + '...',
                  hasX25519Key: !!payload.senderX25519PublicKeyB64,
                  delivery: handshakeDelivery
                })
                
                setDockedSubmode('command')
              } catch (err) {
                console.error('[PopupChat] Failed to create handshake request:', err)
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
    )
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
          background: toastMessage.type === 'success' ? 'rgba(34,197,94,0.95)' : 'rgba(239,68,68,0.95)',
          color: 'white',
          fontSize: '12px',
          fontWeight: 500,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>{toastMessage.type === 'success' ? '✓' : '✕'}</span>
          <span>{toastMessage.message}</span>
        </div>
      )}
      
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
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
      
      {/* Email Setup Wizard Modal */}
      {showEmailSetupWizard && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          zIndex: 2147483647,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            width: '340px',
            maxHeight: '85vh',
            background: theme === 'standard' ? '#ffffff' : 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '16px',
            border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.15)',
            boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
            overflow: 'hidden'
          }}>
            {/* Header */}
            <div style={{
              padding: '16px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              color: 'white',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>📧</span>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600' }}>Connect Your Email</div>
                  <div style={{ fontSize: '10px', opacity: 0.9 }}>Secure access via official API</div>
                </div>
              </div>
              <button
                onClick={() => { setShowEmailSetupWizard(false); setEmailSetupStep('provider'); }}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  color: 'white',
                  width: '26px',
                  height: '26px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                ×
              </button>
            </div>
            
            {/* Content */}
            <div style={{ padding: '16px', overflowY: 'auto', maxHeight: 'calc(85vh - 70px)' }}>
              {emailSetupStep === 'provider' && (
                <>
                  <div style={{ fontSize: '12px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '14px' }}>
                    Choose your email provider to connect:
                  </div>
                  
                  {/* Gmail Option */}
                  <button
                    onClick={connectGmailAccount}
                    disabled={isConnectingEmail}
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                      border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '10px',
                      cursor: isConnectingEmail ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      marginBottom: '8px',
                      textAlign: 'left',
                      opacity: isConnectingEmail ? 0.6 : 1
                    }}
                  >
                    <span style={{ fontSize: '22px' }}>📧</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Gmail</div>
                      <div style={{ fontSize: '10px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>Connect via Google OAuth</div>
                    </div>
                    <span style={{ fontSize: '12px', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.4)' }}>→</span>
                  </button>
                  
                  {/* Microsoft 365 Option */}
                  <button
                    onClick={connectOutlookAccount}
                    disabled={isConnectingEmail}
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                      border: theme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '10px',
                      cursor: isConnectingEmail ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      textAlign: 'left',
                      opacity: isConnectingEmail ? 0.6 : 1
                    }}
                  >
                    <span style={{ fontSize: '22px' }}>📨</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Microsoft 365 / Outlook</div>
                      <div style={{ fontSize: '10px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>Connect via Microsoft OAuth</div>
                    </div>
                    <span style={{ fontSize: '12px', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.4)' }}>→</span>
                  </button>
                  
                  {/* Security note */}
                  <div style={{ 
                    marginTop: '14px', 
                    padding: '10px', 
                    background: theme === 'standard' ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.15)',
                    borderRadius: '8px',
                    border: '1px solid rgba(59,130,246,0.2)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <span style={{ fontSize: '12px' }}>🔒</span>
                      <div style={{ fontSize: '10px', color: theme === 'standard' ? '#1e40af' : 'rgba(255,255,255,0.8)', lineHeight: '1.4' }}>
                        <strong>Security:</strong> Your emails are never rendered with scripts or tracking.
                      </div>
                    </div>
                  </div>
                </>
              )}
              
              {emailSetupStep === 'connecting' && (
                <div style={{ textAlign: 'center', padding: '30px 20px' }}>
                  <div style={{ fontSize: '36px', marginBottom: '16px' }}>⏳</div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px' }}>
                    Connecting...
                  </div>
                  <div style={{ fontSize: '12px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)' }}>
                    Please complete the OAuth flow in the popup window.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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







