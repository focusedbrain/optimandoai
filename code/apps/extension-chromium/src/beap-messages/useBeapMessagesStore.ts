/**
 * BEAP Messages Store
 * 
 * Zustand store for managing BEAP messages UI state.
 * Integrates with Outbox store for delivery tracking.
 * 
 * @version 2.0.0
 */

import { create } from 'zustand'
import type { 
  BeapMessageUI, 
  BeapFolder, 
  BeapMessageStatus, 
  BeapDeliveryStatus,
  DeliveryAttempt,
  VerificationStatus,
  RejectionReasonUI,
  EnvelopeSummaryUI,
  CapsuleMetadataUI
} from './types'
import { SEED_MESSAGES } from './seedData'

// =============================================================================
// Store Interface
// =============================================================================

interface BeapMessagesState {
  /** All messages */
  messages: BeapMessageUI[]
  
  /** Currently selected message ID */
  selectedMessageId: string | null
  
  /** Search query for filtering */
  searchQuery: string
  
  /** Loading state */
  isLoading: boolean
  
  // =========================================================================
  // Queries
  // =========================================================================
  
  /** Get messages by folder with search filter applied */
  getMessagesForFolder: (folder: BeapFolder) => BeapMessageUI[]
  
  /** Get selected message */
  getSelectedMessage: () => BeapMessageUI | null
  
  /** Get message by ID */
  getMessageById: (id: string) => BeapMessageUI | null
  
  /** Get message by package ID */
  getMessageByPackageId: (packageId: string) => BeapMessageUI | null
  
  // =========================================================================
  // Actions
  // =========================================================================
  
  /** Select a message */
  selectMessage: (id: string | null) => void
  
  /** Set search query */
  setSearchQuery: (query: string) => void
  
  /** Add a message (for future use) */
  addMessage: (message: BeapMessageUI) => void
  
  /** Update message status */
  updateMessageStatus: (id: string, status: BeapMessageUI['status']) => void
  
  /** Move message to different folder */
  moveToFolder: (id: string, folder: BeapFolder) => void
  
  // =========================================================================
  // Outbox-specific Actions
  // =========================================================================
  
  /** Add outbox message from send result */
  addOutboxMessage: (message: BeapMessageUI) => void
  
  /** Update delivery status for outbox message */
  updateDeliveryStatus: (
    id: string, 
    deliveryStatus: BeapDeliveryStatus, 
    error?: string
  ) => void
  
  /** Add delivery attempt */
  addDeliveryAttempt: (id: string, attempt: DeliveryAttempt) => void
  
  /** Confirm messenger send */
  confirmMessengerSent: (id: string) => void
  
  /** Confirm download delivered */
  confirmDownloadDelivered: (id: string) => void
  
  /** Set messenger payload */
  setMessengerPayload: (id: string, payload: string) => void
  
  /** Set download reference */
  setDownloadRef: (id: string, downloadRef: string) => void
  
  /** Reset to seed data (for development) */
  resetToSeedData: () => void
  
  // =========================================================================
  // Verification Actions (Inbox gating)
  // =========================================================================
  
  /** Import message as pending verification */
  importMessage: (message: BeapMessageUI) => void
  
  /** Update verification status */
  updateVerificationStatus: (id: string, status: VerificationStatus) => void
  
  /** Mark message as accepted */
  acceptMessage: (
    id: string, 
    envelopeSummary: EnvelopeSummaryUI, 
    capsuleMetadata?: CapsuleMetadataUI
  ) => void
  
  /** Mark message as rejected */
  rejectMessage: (id: string, reason: RejectionReasonUI) => void
  
  /** Move message from inbox to rejected folder */
  moveToRejected: (id: string, reason: RejectionReasonUI) => void
  
  /** Get pending verification messages */
  getPendingVerificationMessages: () => BeapMessageUI[]
  
  /** Get accepted messages */
  getAcceptedMessages: () => BeapMessageUI[]
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useBeapMessagesStore = create<BeapMessagesState>((set, get) => ({
  // Initial state with seed data
  messages: SEED_MESSAGES,
  selectedMessageId: null,
  searchQuery: '',
  isLoading: false,
  
  // =========================================================================
  // Queries
  // =========================================================================
  
  getMessagesForFolder: (folder) => {
    const { messages, searchQuery } = get()
    let filtered = messages.filter(m => m.folder === folder)
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(m => 
        m.title.toLowerCase().includes(query) ||
        m.bodyText.toLowerCase().includes(query) ||
        m.fingerprint.toLowerCase().includes(query) ||
        (m.senderName?.toLowerCase().includes(query))
      )
    }
    
    // Sort by timestamp (newest first)
    return filtered.sort((a, b) => b.timestamp - a.timestamp)
  },
  
  getSelectedMessage: () => {
    const { messages, selectedMessageId } = get()
    if (!selectedMessageId) return null
    return messages.find(m => m.id === selectedMessageId) || null
  },
  
  getMessageById: (id) => {
    return get().messages.find(m => m.id === id) || null
  },
  
  getMessageByPackageId: (packageId) => {
    return get().messages.find(m => m.packageId === packageId) || null
  },
  
  // =========================================================================
  // Actions
  // =========================================================================
  
  selectMessage: (id) => {
    set({ selectedMessageId: id })
  },
  
  setSearchQuery: (query) => {
    set({ searchQuery: query })
  },
  
  addMessage: (message) => {
    set(state => ({
      messages: [message, ...state.messages]
    }))
  },
  
  updateMessageStatus: (id, status) => {
    set(state => ({
      messages: state.messages.map(m => 
        m.id === id ? { ...m, status } : m
      )
    }))
  },
  
  moveToFolder: (id, folder) => {
    set(state => ({
      messages: state.messages.map(m => 
        m.id === id ? { ...m, folder } : m
      )
    }))
  },
  
  // =========================================================================
  // Outbox-specific Actions
  // =========================================================================
  
  addOutboxMessage: (message) => {
    set(state => ({
      messages: [message, ...state.messages]
    }))
  },
  
  updateDeliveryStatus: (id, deliveryStatus, error) => {
    set(state => ({
      messages: state.messages.map(m => {
        if (m.id !== id) return m
        
        // Map delivery status to message status
        const statusMap: Record<BeapDeliveryStatus, BeapMessageStatus> = {
          queued: 'queued',
          sending: 'sending',
          sent: 'sent',
          failed: 'failed',
          pending_user_action: 'pending_user_action',
          sent_manual: 'sent_manual',
          sent_chat: 'sent_chat'
        }
        
        return {
          ...m,
          status: statusMap[deliveryStatus],
          deliveryStatus,
          deliveryError: error
        }
      })
    }))
  },
  
  addDeliveryAttempt: (id, attempt) => {
    set(state => ({
      messages: state.messages.map(m => {
        if (m.id !== id) return m
        
        return {
          ...m,
          deliveryAttempts: [...(m.deliveryAttempts || []), attempt]
        }
      })
    }))
  },
  
  confirmMessengerSent: (id) => {
    const { updateDeliveryStatus, addDeliveryAttempt } = get()
    updateDeliveryStatus(id, 'sent_manual')
    addDeliveryAttempt(id, { at: Date.now(), status: 'sent_manual' })
  },
  
  confirmDownloadDelivered: (id) => {
    const { updateDeliveryStatus, addDeliveryAttempt } = get()
    updateDeliveryStatus(id, 'sent_manual')
    addDeliveryAttempt(id, { at: Date.now(), status: 'sent_manual' })
  },
  
  setMessengerPayload: (id, payload) => {
    set(state => ({
      messages: state.messages.map(m =>
        m.id === id ? { ...m, messengerPayload: payload } : m
      )
    }))
  },
  
  setDownloadRef: (id, downloadRef) => {
    set(state => ({
      messages: state.messages.map(m =>
        m.id === id ? { ...m, downloadRef } : m
      )
    }))
  },
  
  resetToSeedData: () => {
    set({
      messages: SEED_MESSAGES,
      selectedMessageId: null,
      searchQuery: ''
    })
  },
  
  // =========================================================================
  // Verification Actions (Inbox gating)
  // =========================================================================
  
  importMessage: (message) => {
    // Import as pending_verification
    const importedMessage: BeapMessageUI = {
      ...message,
      folder: 'inbox',
      status: 'pending_verification',
      verificationStatus: 'pending_verification',
      direction: 'inbound'
    }
    
    set(state => ({
      messages: [importedMessage, ...state.messages]
    }))
  },
  
  updateVerificationStatus: (id, status) => {
    set(state => ({
      messages: state.messages.map(m => {
        if (m.id !== id) return m
        
        // Map verification status to message status
        const statusMap: Record<VerificationStatus, BeapMessageStatus> = {
          pending_verification: 'pending_verification',
          verifying: 'verifying',
          accepted: 'accepted',
          rejected: 'rejected'
        }
        
        return {
          ...m,
          status: statusMap[status],
          verificationStatus: status
        }
      })
    }))
  },
  
  acceptMessage: (id, envelopeSummary, capsuleMetadata) => {
    set(state => ({
      messages: state.messages.map(m => {
        if (m.id !== id) return m
        
        return {
          ...m,
          status: 'accepted',
          verificationStatus: 'accepted',
          envelopeSummary,
          capsuleMetadata
        }
      })
    }))
  },
  
  rejectMessage: (id, reason) => {
    set(state => ({
      messages: state.messages.map(m => {
        if (m.id !== id) return m
        
        return {
          ...m,
          status: 'rejected',
          verificationStatus: 'rejected',
          rejectionReasonData: reason,
          rejectReason: reason.humanSummary
        }
      })
    }))
  },
  
  moveToRejected: (id, reason) => {
    set(state => ({
      messages: state.messages.map(m => {
        if (m.id !== id) return m
        
        return {
          ...m,
          folder: 'rejected',
          status: 'rejected',
          verificationStatus: 'rejected',
          rejectionReasonData: reason,
          rejectReason: reason.humanSummary
        }
      })
    }))
  },
  
  getPendingVerificationMessages: () => {
    return get().messages.filter(
      m => m.folder === 'inbox' && m.verificationStatus === 'pending_verification'
    )
  },
  
  getAcceptedMessages: () => {
    return get().messages.filter(
      m => m.folder === 'inbox' && m.verificationStatus === 'accepted'
    )
  }
}))

// =============================================================================
// Selector Hooks
// =============================================================================

export const useInboxMessages = () => 
  useBeapMessagesStore(state => state.getMessagesForFolder('inbox'))

export const useOutboxMessages = () => 
  useBeapMessagesStore(state => state.getMessagesForFolder('outbox'))

export const useArchivedMessages = () => 
  useBeapMessagesStore(state => state.getMessagesForFolder('archived'))

export const useRejectedMessages = () => 
  useBeapMessagesStore(state => state.getMessagesForFolder('rejected'))

export const useSelectedMessage = () => 
  useBeapMessagesStore(state => state.getSelectedMessage())

export const useSearchQuery = () => 
  useBeapMessagesStore(state => state.searchQuery)

