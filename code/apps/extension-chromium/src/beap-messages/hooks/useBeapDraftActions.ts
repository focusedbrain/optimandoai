/**
 * useBeapDraftActions Hook
 * 
 * Manages BEAP draft state and actions with correct encoding and identity semantics.
 * Shared between docked sidepanel and popup command chat.
 * 
 * Key Rules:
 * - PRIVATE mode (qBEAP): Requires valid handshake selection
 * - PUBLIC mode (pBEAP): No handshake required, no encryption
 * - Actions disabled until preconditions are met
 * 
 * @version 1.0.0
 */

import { useState, useCallback, useMemo } from 'react'
import type { RecipientMode, SelectedRecipient, DeliveryMethod } from '../components'
import { 
  validatePackageConfig, 
  canBuildPackage, 
  executeDeliveryAction,
  type BeapPackageConfig,
  type DeliveryResult 
} from '../services'
import { useBeapMessagesStore } from '../useBeapMessagesStore'

// =============================================================================
// Types
// =============================================================================

export interface BeapDraftState {
  recipientMode: RecipientMode
  selectedRecipient: SelectedRecipient | null
  deliveryMethod: DeliveryMethod
  emailTo: string
  subject: string
  messageBody: string
  attachments: File[]
}

export interface BeapDraftValidation {
  canSend: boolean
  errors: string[]
  warnings: string[]
  buttonLabel: string
  buttonDisabled: boolean
  disabledReason?: string
}

export interface BeapDraftActions {
  // State setters
  setRecipientMode: (mode: RecipientMode) => void
  setSelectedRecipient: (recipient: SelectedRecipient | null) => void
  setDeliveryMethod: (method: DeliveryMethod) => void
  setEmailTo: (email: string) => void
  setSubject: (subject: string) => void
  setMessageBody: (body: string) => void
  addAttachment: (file: File) => void
  removeAttachment: (index: number) => void
  
  // Actions
  executeAction: () => Promise<DeliveryResult>
  clearDraft: () => void
  
  // Computed
  validation: BeapDraftValidation
  isExecuting: boolean
  lastResult: DeliveryResult | null
}

// =============================================================================
// Hook
// =============================================================================

export interface UseBeapDraftActionsOptions {
  senderFingerprint: string
  senderFingerprintShort: string
  onSuccess?: (result: DeliveryResult) => void
  onError?: (error: string) => void
}

export function useBeapDraftActions(options: UseBeapDraftActionsOptions): [BeapDraftState, BeapDraftActions] {
  const { senderFingerprint, senderFingerprintShort, onSuccess, onError } = options
  
  // Core state
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('private')
  const [selectedRecipient, setSelectedRecipient] = useState<SelectedRecipient | null>(null)
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('email')
  const [emailTo, setEmailTo] = useState('')
  const [subject, setSubject] = useState('')
  const [messageBody, setMessageBody] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  
  // Execution state
  const [isExecuting, setIsExecuting] = useState(false)
  const [lastResult, setLastResult] = useState<DeliveryResult | null>(null)
  
  // Store for adding outbox messages
  const addOutboxMessage = useBeapMessagesStore(state => state.addMessage)
  
  // Current state object
  const state: BeapDraftState = {
    recipientMode,
    selectedRecipient,
    deliveryMethod,
    emailTo,
    subject,
    messageBody,
    attachments
  }
  
  // Build config for validation and execution
  const buildConfig = useCallback((): BeapPackageConfig => ({
    recipientMode,
    deliveryMethod,
    selectedRecipient,
    senderFingerprint,
    senderFingerprintShort,
    emailTo,
    subject,
    messageBody,
    attachments
  }), [recipientMode, deliveryMethod, selectedRecipient, senderFingerprint, senderFingerprintShort, emailTo, subject, messageBody, attachments])
  
  // Validation
  const validation = useMemo((): BeapDraftValidation => {
    const config = buildConfig()
    const result = validatePackageConfig(config)
    const canSend = result.valid
    
    // Determine button label based on delivery method
    let buttonLabel: string
    switch (deliveryMethod) {
      case 'email':
        buttonLabel = '📧 Send BEAP™ Message'
        break
      case 'messenger':
        buttonLabel = '📋 Copy BEAP™ Payload'
        break
      case 'download':
        buttonLabel = '💾 Download BEAP™ Package'
        break
      default:
        buttonLabel = '📤 Send'
    }
    
    // Determine if button should be disabled and why
    let buttonDisabled = !canSend || isExecuting
    let disabledReason: string | undefined
    
    if (isExecuting) {
      disabledReason = 'Processing...'
    } else if (!canSend && result.errors.length > 0) {
      disabledReason = result.errors[0]
    } else if (recipientMode === 'private' && !selectedRecipient) {
      buttonDisabled = true
      disabledReason = 'Select a handshake recipient'
    }
    
    return {
      canSend,
      errors: result.errors,
      warnings: result.warnings,
      buttonLabel,
      buttonDisabled,
      disabledReason
    }
  }, [buildConfig, deliveryMethod, recipientMode, selectedRecipient, isExecuting])
  
  // Clear recipient when switching to PUBLIC mode
  const handleSetRecipientMode = useCallback((mode: RecipientMode) => {
    setRecipientMode(mode)
    if (mode === 'public') {
      setSelectedRecipient(null)
    }
  }, [])
  
  // Handle attachment add/remove
  const addAttachment = useCallback((file: File) => {
    setAttachments(prev => [...prev, file])
  }, [])
  
  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }, [])
  
  // Clear draft
  const clearDraft = useCallback(() => {
    setRecipientMode('private')
    setSelectedRecipient(null)
    setDeliveryMethod('email')
    setEmailTo('')
    setSubject('')
    setMessageBody('')
    setAttachments([])
    setLastResult(null)
  }, [])
  
  // Execute action
  const executeAction = useCallback(async (): Promise<DeliveryResult> => {
    if (validation.buttonDisabled) {
      const errorResult: DeliveryResult = {
        success: false,
        action: deliveryMethod === 'email' ? 'sent' : deliveryMethod === 'messenger' ? 'copied' : 'downloaded',
        message: validation.disabledReason || 'Cannot execute action'
      }
      return errorResult
    }
    
    setIsExecuting(true)
    
    try {
      const config = buildConfig()
      const result = await executeDeliveryAction(config)
      
      setLastResult(result)
      
      if (result.success) {
        // Add to outbox
        addOutboxMessage({
          id: `beap_${Date.now()}`,
          folder: 'Outbox',
          sender: 'You',
          senderFingerprint,
          recipient: recipientMode === 'private' 
            ? (selectedRecipient?.receiver_display_name || 'Unknown')
            : 'PUBLIC',
          recipientFingerprint: recipientMode === 'private'
            ? selectedRecipient?.receiver_fingerprint_short
            : undefined,
          subject: subject || 'BEAP™ Message',
          preview: messageBody.slice(0, 100),
          date: new Date().toISOString(),
          status: deliveryMethod === 'email' ? 'sending' : 'delivered',
          deliveryStatus: {
            state: deliveryMethod === 'email' ? 'sending' : 'delivered',
            method: deliveryMethod,
            timestamp: Date.now()
          },
          attachments: attachments.map(f => ({
            name: f.name,
            size: f.size,
            type: f.type
          })),
          encodingType: recipientMode === 'private' ? 'qBEAP' : 'pBEAP'
        })
        
        // Clear draft on success
        clearDraft()
        
        if (onSuccess) {
          onSuccess(result)
        }
      } else {
        if (onError) {
          onError(result.message)
        }
      }
      
      return result
    } catch (error) {
      const errorResult: DeliveryResult = {
        success: false,
        action: deliveryMethod === 'email' ? 'sent' : deliveryMethod === 'messenger' ? 'copied' : 'downloaded',
        message: error instanceof Error ? error.message : 'An unexpected error occurred'
      }
      setLastResult(errorResult)
      
      if (onError) {
        onError(errorResult.message)
      }
      
      return errorResult
    } finally {
      setIsExecuting(false)
    }
  }, [
    validation.buttonDisabled, 
    validation.disabledReason, 
    deliveryMethod, 
    buildConfig, 
    addOutboxMessage,
    senderFingerprint,
    recipientMode,
    selectedRecipient,
    subject,
    messageBody,
    attachments,
    clearDraft,
    onSuccess,
    onError
  ])
  
  // Actions object
  const actions: BeapDraftActions = {
    setRecipientMode: handleSetRecipientMode,
    setSelectedRecipient,
    setDeliveryMethod,
    setEmailTo,
    setSubject,
    setMessageBody,
    addAttachment,
    removeAttachment,
    executeAction,
    clearDraft,
    validation,
    isExecuting,
    lastResult
  }
  
  return [state, actions]
}

export default useBeapDraftActions

