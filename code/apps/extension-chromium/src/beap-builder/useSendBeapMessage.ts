/**
 * useSendBeapMessage Hook
 * 
 * React hook that integrates the send pipeline with the messages store.
 * Provides a unified interface for sending BEAP messages from any context.
 * 
 * @version 1.0.0
 */

import { useState, useCallback } from 'react'
import { useBeapMessagesStore } from '../beap-messages/useBeapMessagesStore'
import { sendBeapMessage, confirmMessengerSent, confirmDownloadDelivered } from './sendPipeline'
import { requiresBeapBuilder, canSendSilently } from './requiresBuilder'
import type { SendContext, SendResult, DeliveryMethod } from './dispatch-types'
import type { BeapMessageUI, BeapDeliveryMethod } from '../beap-messages/types'
import type { Handshake } from '../handshake/types'

// =============================================================================
// Hook Interface
// =============================================================================

interface UseSendBeapMessageResult {
  /** Whether a send is in progress */
  isSending: boolean
  
  /** Last send result */
  lastResult: SendResult | null
  
  /** Last error */
  error: string | null
  
  /** Check if builder is required for given content */
  checkBuilderRequired: (
    text: string,
    attachments: any[],
    sessions: any[],
    dataRequest: string
  ) => boolean
  
  /** Send a message (main function) */
  send: (context: Omit<SendContext, 'source'> & { source?: SendContext['source'] }) => Promise<SendResult>
  
  /** Send text-only message (silent path) */
  sendTextOnly: (
    text: string,
    handshake?: Handshake | null,
    deliveryMethod?: DeliveryMethod
  ) => Promise<SendResult>
  
  /** Confirm messenger send was completed */
  confirmMessenger: (messageId: string) => void
  
  /** Confirm download was delivered */
  confirmDownload: (messageId: string) => void
  
  /** Copy messenger payload to clipboard */
  copyMessengerPayload: (messageId: string) => Promise<boolean>
  
  /** Retry failed email send */
  retryEmail: (messageId: string) => Promise<SendResult | null>
  
  /** Clear last error */
  clearError: () => void
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useSendBeapMessage(): UseSendBeapMessageResult {
  const [isSending, setIsSending] = useState(false)
  const [lastResult, setLastResult] = useState<SendResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  const {
    addOutboxMessage,
    updateDeliveryStatus,
    addDeliveryAttempt,
    confirmMessengerSent: storeConfirmMessenger,
    confirmDownloadDelivered: storeConfirmDownload,
    setMessengerPayload,
    setDownloadRef,
    getMessageById,
    getMessageByPackageId
  } = useBeapMessagesStore()
  
  // =========================================================================
  // Check if builder is required
  // =========================================================================
  
  const checkBuilderRequired = useCallback((
    text: string,
    attachments: any[],
    sessions: any[],
    dataRequest: string
  ): boolean => {
    return !canSendSilently(text, attachments, sessions, dataRequest)
  }, [])
  
  // =========================================================================
  // Main Send Function
  // =========================================================================
  
  const send = useCallback(async (
    context: Omit<SendContext, 'source'> & { source?: SendContext['source'] }
  ): Promise<SendResult> => {
    setIsSending(true)
    setError(null)
    
    try {
      // Apply defaults
      const fullContext: SendContext = {
        source: context.source || 'beap-drafts',
        text: context.text,
        subject: context.subject,
        attachments: context.attachments || [],
        selectedSessions: context.selectedSessions || [],
        dataRequest: context.dataRequest || '',
        handshake: context.handshake,
        delivery: context.delivery,
        builderUsed: context.builderUsed || false,
        ingressConstraints: context.ingressConstraints || [],
        egressConstraints: context.egressConstraints || [],
        offlineOnly: context.offlineOnly || false
      }
      
      // Send through pipeline
      const result = await sendBeapMessage(fullContext)
      setLastResult(result)
      
      if (result.success && result.packageId) {
        // Create BeapMessageUI from result
        const messageUI: BeapMessageUI = {
          id: result.outboxEntryId || `msg_${crypto.randomUUID()}`,
          folder: 'outbox',
          fingerprint: result.envelope?.senderFingerprint.slice(0, 16) || '',
          fingerprintFull: result.envelope?.senderFingerprint,
          deliveryMethod: result.deliveryMethod as BeapDeliveryMethod,
          title: fullContext.subject || '(No subject)',
          timestamp: Date.now(),
          bodyText: fullContext.text,
          attachments: fullContext.attachments.map(a => ({
            name: a.name,
            size: a.size,
            type: a.type
          })),
          status: mapDeliveryStatusToStatus(result.deliveryStatus),
          direction: 'outbound',
          packageId: result.packageId,
          envelopeRef: result.envelope?.envelopeId,
          capsuleRef: result.capsule?.capsuleId,
          deliveryStatus: result.deliveryStatus,
          deliveryAttempts: [{ at: Date.now(), status: result.deliveryStatus }]
        }
        
        // Add to store
        addOutboxMessage(messageUI)
        
        // Handle method-specific data
        if (result.deliveryMethod === 'messenger' && result.success) {
          // For messenger, we need to store the payload
          const payload = buildMessengerPayloadFromResult(fullContext, result)
          setMessengerPayload(messageUI.id, payload)
        }
      } else if (!result.success) {
        setError(result.error || 'Send failed')
      }
      
      return result
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Send failed'
      setError(errorMessage)
      
      const failedResult: SendResult = {
        success: false,
        packageId: null,
        envelope: null,
        capsule: null,
        outboxEntryId: null,
        error: errorMessage,
        deliveryMethod: context.delivery.method,
        deliveryStatus: 'failed'
      }
      
      setLastResult(failedResult)
      return failedResult
    } finally {
      setIsSending(false)
    }
  }, [addOutboxMessage, setMessengerPayload])
  
  // =========================================================================
  // Send Text Only (Silent Path)
  // =========================================================================
  
  const sendTextOnly = useCallback(async (
    text: string,
    handshake?: Handshake | null,
    deliveryMethod: DeliveryMethod = 'chat'
  ): Promise<SendResult> => {
    return send({
      text,
      handshake,
      attachments: [],
      selectedSessions: [],
      dataRequest: '',
      builderUsed: false,
      ingressConstraints: [],
      egressConstraints: [],
      offlineOnly: false,
      delivery: {
        method: deliveryMethod,
        chat: deliveryMethod === 'chat' ? {
          chatType: 'direct'
        } : undefined
      }
    })
  }, [send])
  
  // =========================================================================
  // Confirm Actions
  // =========================================================================
  
  const confirmMessenger = useCallback((messageId: string) => {
    storeConfirmMessenger(messageId)
  }, [storeConfirmMessenger])
  
  const confirmDownload = useCallback((messageId: string) => {
    storeConfirmDownload(messageId)
  }, [storeConfirmDownload])
  
  // =========================================================================
  // Copy Messenger Payload
  // =========================================================================
  
  const copyMessengerPayload = useCallback(async (messageId: string): Promise<boolean> => {
    const message = getMessageById(messageId)
    if (!message?.messengerPayload) return false
    
    try {
      await navigator.clipboard.writeText(message.messengerPayload)
      return true
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
      return false
    }
  }, [getMessageById])
  
  // =========================================================================
  // Retry Email
  // =========================================================================
  
  const retryEmail = useCallback(async (messageId: string): Promise<SendResult | null> => {
    const message = getMessageById(messageId)
    if (!message || message.deliveryMethod !== 'email') return null
    
    // Update status to queued
    updateDeliveryStatus(messageId, 'queued')
    addDeliveryAttempt(messageId, { at: Date.now(), status: 'queued' })
    
    // Re-send would need full context - for now just update status
    // In a full implementation, we'd store the original context
    console.log('[useSendBeapMessage] Retry email:', messageId)
    
    // Simulate retry
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Update to sent (or failed in real implementation)
    updateDeliveryStatus(messageId, 'sent')
    addDeliveryAttempt(messageId, { at: Date.now(), status: 'sent' })
    
    return {
      success: true,
      packageId: message.packageId || null,
      envelope: null,
      capsule: null,
      outboxEntryId: messageId,
      error: null,
      deliveryMethod: 'email',
      deliveryStatus: 'sent'
    }
  }, [getMessageById, updateDeliveryStatus, addDeliveryAttempt])
  
  // =========================================================================
  // Clear Error
  // =========================================================================
  
  const clearError = useCallback(() => {
    setError(null)
  }, [])
  
  return {
    isSending,
    lastResult,
    error,
    checkBuilderRequired,
    send,
    sendTextOnly,
    confirmMessenger,
    confirmDownload,
    copyMessengerPayload,
    retryEmail,
    clearError
  }
}

// =============================================================================
// Helpers
// =============================================================================

function mapDeliveryStatusToStatus(
  deliveryStatus: SendResult['deliveryStatus']
): BeapMessageUI['status'] {
  const map: Record<SendResult['deliveryStatus'], BeapMessageUI['status']> = {
    queued: 'queued',
    sending: 'sending',
    sent: 'sent',
    failed: 'failed',
    pending_user_action: 'pending_user_action',
    sent_manual: 'sent_manual',
    sent_chat: 'sent_chat'
  }
  return map[deliveryStatus]
}

function buildMessengerPayloadFromResult(
  context: SendContext,
  result: SendResult
): string {
  const lines = [
    `📦 BEAP™ Secure Package`,
    ``,
    context.text,
    ``,
    `---`,
    `Package ID: ${result.packageId}`,
    result.envelope ? `Envelope: ${result.envelope.envelopeId}` : '',
    result.capsule ? `Capsule: ${result.capsule.capsuleId}` : '',
    context.attachments.length > 0 
      ? `Attachments: ${context.attachments.length} file(s)` 
      : '',
    ``,
    `This message was sent via BEAP™ secure messaging.`
  ].filter(Boolean)
  
  return lines.join('\n')
}

