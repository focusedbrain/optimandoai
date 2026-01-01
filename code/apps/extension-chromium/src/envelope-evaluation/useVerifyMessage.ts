/**
 * useVerifyMessage Hook
 * 
 * React hook for verifying incoming BEAP messages.
 * Integrates envelope evaluation with the BEAP messages store.
 * 
 * @version 1.0.0
 */

import { useCallback } from 'react'
import { useBeapMessagesStore } from '../beap-messages/useBeapMessagesStore'
import { evaluateIncomingMessage, createMockIncomingMessage } from './evaluateEnvelope'
import type {
  IncomingBeapMessage,
  BeapEnvelope,
  CapsuleMetadata,
  EvaluationResult
} from './types'
import type { RejectionReasonUI, EnvelopeSummaryUI, CapsuleMetadataUI } from '../beap-messages/types'

/**
 * Hook return type
 */
interface UseVerifyMessageReturn {
  /** Verify a message by ID */
  verifyMessage: (messageId: string) => Promise<EvaluationResult>
  
  /** Import and verify a new message */
  importAndVerify: (message: IncomingBeapMessage, autoVerify?: boolean) => Promise<EvaluationResult | null>
  
  /** Create a mock incoming message for testing */
  createTestMessage: (overrides?: Partial<IncomingBeapMessage>) => IncomingBeapMessage
}

/**
 * Convert envelope evaluation types to UI types
 */
function toEnvelopeSummaryUI(summary: EvaluationResult['envelopeSummary']): EnvelopeSummaryUI | undefined {
  if (!summary) return undefined
  
  return {
    envelopeIdShort: summary.envelopeIdShort,
    senderFingerprintDisplay: summary.senderFingerprintDisplay,
    channelDisplay: summary.channelDisplay,
    ingressSummary: summary.ingressSummary,
    egressSummary: summary.egressSummary,
    createdAt: summary.createdAt,
    expiryStatus: summary.expiryStatus,
    signatureStatusDisplay: summary.signatureStatusDisplay,
    hashVerificationDisplay: summary.hashVerificationDisplay
  }
}

function toCapsuleMetadataUI(metadata: CapsuleMetadata | undefined): CapsuleMetadataUI | undefined {
  if (!metadata) return undefined
  
  return {
    capsuleId: metadata.capsuleId,
    title: metadata.title,
    attachmentCount: metadata.attachmentCount,
    attachmentNames: metadata.attachmentNames,
    sessionRefCount: metadata.sessionRefCount,
    hasDataRequest: metadata.hasDataRequest
  }
}

function toRejectionReasonUI(reason: EvaluationResult['rejectionReason']): RejectionReasonUI | undefined {
  if (!reason) return undefined
  
  return {
    code: reason.code,
    humanSummary: reason.humanSummary,
    details: reason.details,
    timestamp: reason.timestamp,
    failedStep: reason.failedStep
  }
}

/**
 * Hook for verifying incoming BEAP messages
 */
export function useVerifyMessage(): UseVerifyMessageReturn {
  const {
    getMessageById,
    updateVerificationStatus,
    acceptMessage,
    moveToRejected
  } = useBeapMessagesStore()
  
  /**
   * Verify a message by ID
   */
  const verifyMessage = useCallback(async (messageId: string): Promise<EvaluationResult> => {
    const message = getMessageById(messageId)
    
    if (!message) {
      return {
        passed: false,
        status: 'rejected',
        rejectionReason: {
          code: 'evaluation_error',
          humanSummary: 'Message not found.',
          timestamp: Date.now(),
          failedStep: 'envelope_verification'
        },
        stepsCompleted: {
          envelopeVerification: false,
          boundaryCheck: false,
          wrguardIntersection: false
        },
        evaluatedAt: Date.now()
      }
    }
    
    // Set status to verifying
    updateVerificationStatus(messageId, 'verifying')
    
    // Create a mock incoming message from the stored message data
    // In a real implementation, this would use stored raw data
    const incomingMessage = createMockIncomingMessage({
      id: messageId,
      envelope: createEnvelopeFromMessage(message),
      capsuleMetadata: {
        capsuleId: message.capsuleRef || crypto.randomUUID(),
        title: message.title,
        attachmentCount: message.attachments.length,
        attachmentNames: message.attachments.map(a => a.name),
        sessionRefCount: 0,
        hasDataRequest: false,
        contentLengthHint: message.bodyText.length
      }
    })
    
    // Simulate async verification (in real implementation, this could be slow)
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // Run evaluation
    const result = evaluateIncomingMessage(incomingMessage)
    
    // Update store based on result
    if (result.passed) {
      acceptMessage(
        messageId,
        toEnvelopeSummaryUI(result.envelopeSummary)!,
        toCapsuleMetadataUI(result.capsuleMetadata)
      )
    } else {
      moveToRejected(messageId, toRejectionReasonUI(result.rejectionReason)!)
    }
    
    return result
  }, [getMessageById, updateVerificationStatus, acceptMessage, moveToRejected])
  
  /**
   * Import and optionally verify a new message
   */
  const importAndVerify = useCallback(async (
    message: IncomingBeapMessage,
    autoVerify = true
  ): Promise<EvaluationResult | null> => {
    const { importMessage } = useBeapMessagesStore.getState()
    
    // Import message (creates with pending_verification status)
    importMessage({
      id: message.id,
      folder: 'inbox',
      fingerprint: message.envelope.senderFingerprint?.slice(0, 12) + '...' || 'Unknown',
      fingerprintFull: message.envelope.senderFingerprint,
      deliveryMethod: message.envelope.ingressChannel === 'unknown' ? 'email' : message.envelope.ingressChannel,
      title: message.capsuleMetadata.title,
      timestamp: message.importedAt,
      bodyText: '[Encrypted - Verification Required]',
      attachments: message.capsuleMetadata.attachmentNames.map(name => ({ name })),
      status: 'pending_verification',
      verificationStatus: 'pending_verification',
      direction: 'inbound',
      incomingMessageRef: message.id
    })
    
    // If auto-verify, run verification immediately
    if (autoVerify) {
      return verifyMessage(message.id)
    }
    
    return null
  }, [verifyMessage])
  
  /**
   * Create a mock incoming message for testing
   */
  const createTestMessage = useCallback((
    overrides?: Partial<IncomingBeapMessage>
  ): IncomingBeapMessage => {
    return createMockIncomingMessage(overrides)
  }, [])
  
  return {
    verifyMessage,
    importAndVerify,
    createTestMessage
  }
}

/**
 * Create an envelope from stored message data (for re-verification)
 * In a real implementation, this would use stored raw envelope data
 */
function createEnvelopeFromMessage(message: any): BeapEnvelope {
  // Check if message has characteristics that should fail verification
  // This is for testing/demo purposes
  const isFromUnknownSender = message.senderName === 'Unknown' || !message.senderName
  const hasWebEgress = message.title?.toLowerCase().includes('egress')
  
  return {
    envelopeId: message.envelopeRef || crypto.randomUUID(),
    packageId: message.packageId || crypto.randomUUID(),
    envelopeHash: 'sha256:' + crypto.randomUUID().replace(/-/g, ''),
    signatureStatus: 'valid',
    senderFingerprint: message.fingerprintFull,
    ingressChannel: message.deliveryMethod === 'unknown' ? 'email' : message.deliveryMethod,
    ingressDeclarations: [
      {
        type: isFromUnknownSender ? 'public' : 'handshake',
        source: message.senderName || 'unknown',
        verified: !isFromUnknownSender
      }
    ],
    egressDeclarations: hasWebEgress
      ? [{ type: 'web', target: 'slack.com', required: true }]
      : [{ type: 'none', target: 'local-only', required: false }],
    createdAt: message.timestamp
  }
}

