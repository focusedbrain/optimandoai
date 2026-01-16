/**
 * useWRChatSend Hook
 * 
 * Simplified hook for sending BEAP messages from WR Chat.
 * Handles the silent vs explicit builder decision and integrates with the send pipeline.
 * 
 * Rules:
 * - Text-only messages go silent (builder does not open)
 * - Messages with attachments/sessions/data requests require builder
 * - All sends create Outbox entries
 * - Chat sends are immediate (optimistic UI)
 * 
 * @version 1.0.0
 */

import { useState, useCallback } from 'react'
import { useSendBeapMessage } from './useSendBeapMessage'
import { canSendSilently } from './requiresBuilder'
import type { SendResult, DeliveryMethod } from './dispatch-types'
import type { Handshake } from '../handshake/types'

// =============================================================================
// Types
// =============================================================================

export interface WRChatSendOptions {
  /** Message text */
  text: string
  
  /** Selected handshake (if in a trusted chat) */
  handshake?: Handshake | null
  
  /** Chat type */
  chatType: 'direct' | 'group'
  
  /** Session ID (for group sessions) */
  sessionId?: string
  
  /** Recipient fingerprint (for direct chat) */
  recipientFingerprint?: string
  
  /** Attachments (triggers builder) */
  attachments?: File[]
  
  /** Selected sessions (triggers builder) */
  selectedSessions?: { sessionId: string; sessionName: string }[]
  
  /** Data/automation request (triggers builder) */
  dataRequest?: string
  
  /** User explicitly opened builder */
  builderOpened?: boolean
}

export interface WRChatSendResult {
  success: boolean
  messageId: string | null
  error: string | null
  wasBuilderRequired: boolean
}

// =============================================================================
// Hook
// =============================================================================

export function useWRChatSend() {
  const [isSending, setIsSending] = useState(false)
  const [builderRequired, setBuilderRequired] = useState(false)
  const [pendingContext, setPendingContext] = useState<WRChatSendOptions | null>(null)
  
  const { send, checkBuilderRequired } = useSendBeapMessage()
  
  // =========================================================================
  // Check if builder should open
  // =========================================================================
  
  const shouldOpenBuilder = useCallback((options: Partial<WRChatSendOptions>): boolean => {
    const attachments = options.attachments || []
    const sessions = options.selectedSessions || []
    const dataRequest = options.dataRequest || ''
    const text = options.text || ''
    
    return !canSendSilently(text, attachments, sessions, dataRequest)
  }, [])
  
  // =========================================================================
  // Send (Silent Path)
  // =========================================================================
  
  const sendSilent = useCallback(async (
    options: WRChatSendOptions
  ): Promise<WRChatSendResult> => {
    setIsSending(true)
    
    try {
      const result = await send({
        source: options.chatType === 'direct' ? 'wr-chat-direct' : 'wr-chat-group',
        text: options.text,
        attachments: [], // Silent path has no attachments
        selectedSessions: [],
        dataRequest: '',
        handshake: options.handshake,
        builderUsed: false,
        ingressConstraints: [],
        egressConstraints: [],
        offlineOnly: false,
        delivery: {
          method: 'chat',
          chat: {
            chatType: options.chatType,
            sessionId: options.sessionId,
            recipientFingerprint: options.recipientFingerprint
          }
        }
      })
      
      return {
        success: result.success,
        messageId: result.outboxEntryId,
        error: result.error,
        wasBuilderRequired: false
      }
    } finally {
      setIsSending(false)
    }
  }, [send])
  
  // =========================================================================
  // Send (After Builder)
  // =========================================================================
  
  const sendAfterBuilder = useCallback(async (
    options: WRChatSendOptions,
    builderData: {
      attachments: { id: string; name: string; size: number; type: string; dataRef: string; semanticContent: string | null; encryptedRef: string | null }[]
      selectedSessions: { sessionId: string; sessionName: string; requiredCapability: string }[]
      dataRequest: string
      ingressConstraints: string[]
      egressConstraints: string[]
    }
  ): Promise<WRChatSendResult> => {
    setIsSending(true)
    setBuilderRequired(false)
    setPendingContext(null)
    
    try {
      const result = await send({
        source: options.chatType === 'direct' ? 'wr-chat-direct' : 'wr-chat-group',
        text: options.text,
        attachments: builderData.attachments,
        selectedSessions: builderData.selectedSessions,
        dataRequest: builderData.dataRequest,
        handshake: options.handshake,
        builderUsed: true,
        ingressConstraints: builderData.ingressConstraints,
        egressConstraints: builderData.egressConstraints,
        offlineOnly: false,
        delivery: {
          method: 'chat',
          chat: {
            chatType: options.chatType,
            sessionId: options.sessionId,
            recipientFingerprint: options.recipientFingerprint
          }
        }
      })
      
      return {
        success: result.success,
        messageId: result.outboxEntryId,
        error: result.error,
        wasBuilderRequired: true
      }
    } finally {
      setIsSending(false)
    }
  }, [send])
  
  // =========================================================================
  // Main Send Entry Point
  // =========================================================================
  
  const sendMessage = useCallback(async (
    options: WRChatSendOptions
  ): Promise<WRChatSendResult | { requiresBuilder: true; context: WRChatSendOptions }> => {
    // Check if builder is required
    const needsBuilder = shouldOpenBuilder(options)
    
    if (needsBuilder) {
      // Store context and signal that builder should open
      setBuilderRequired(true)
      setPendingContext(options)
      
      return {
        requiresBuilder: true,
        context: options
      }
    }
    
    // Silent path - send directly
    return sendSilent(options)
  }, [shouldOpenBuilder, sendSilent])
  
  // =========================================================================
  // Cancel Builder
  // =========================================================================
  
  const cancelBuilder = useCallback(() => {
    setBuilderRequired(false)
    setPendingContext(null)
  }, [])
  
  return {
    /** Whether a send is in progress */
    isSending,
    
    /** Whether builder is required for current pending send */
    builderRequired,
    
    /** Pending context if builder is required */
    pendingContext,
    
    /** Check if builder would be required */
    shouldOpenBuilder,
    
    /** Send a message (may return requiresBuilder) */
    sendMessage,
    
    /** Send after builder is completed */
    sendAfterBuilder,
    
    /** Cancel the builder (discard pending send) */
    cancelBuilder
  }
}

/**
 * Quick send for text-only messages
 * Use this for guaranteed silent sends
 */
export function useQuickSend() {
  const { sendTextOnly, isSending, error } = useSendBeapMessage()
  
  const quickSend = useCallback(async (
    text: string,
    handshake?: Handshake | null
  ) => {
    return sendTextOnly(text, handshake, 'chat')
  }, [sendTextOnly])
  
  return {
    quickSend,
    isSending,
    error
  }
}

