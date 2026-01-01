/**
 * Archival Service
 * 
 * Deterministic, explicit archival of BEAP messages.
 * Freezes mutable fields and preserves all references.
 * 
 * @version 1.0.0
 */

import type {
  ArchiveRecord,
  ArchiveEligibility,
  AuditRefs
} from './types'
import { useAuditStore, logArchiveEvent } from './useAuditStore'
import { useBeapMessagesStore } from '../beap-messages/useBeapMessagesStore'
import { useReconstructionStore } from '../reconstruction/useReconstructionStore'
import { useIngressStore } from '../ingress/useIngressStore'
import type { BeapMessageUI } from '../beap-messages/types'

// =============================================================================
// Hash Utilities
// =============================================================================

/**
 * Compute SHA-256 hash
 */
async function computeHash(data: string): Promise<string> {
  const encoder = new TextEncoder()
  const dataBuffer = encoder.encode(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// =============================================================================
// Eligibility Check
// =============================================================================

/**
 * Check if a message is eligible for archival
 */
export function checkArchiveEligibility(message: BeapMessageUI): ArchiveEligibility {
  const { folder, status, verificationStatus, deliveryStatus, direction } = message
  
  // Already archived
  if (folder === 'archived') {
    return {
      eligible: false,
      reason: 'Message is already archived',
      status,
      hasReconstruction: false,
      hasDeliveryConfirmation: false
    }
  }
  
  // Inbox messages - must be accepted (optionally reconstructed)
  if (folder === 'inbox') {
    const isAccepted = verificationStatus === 'accepted' || status === 'accepted'
    
    if (!isAccepted && status !== 'pending_verification') {
      // Pending verification can't be archived
      return {
        eligible: false,
        reason: 'Inbox messages must be accepted before archiving',
        status,
        hasReconstruction: false,
        hasDeliveryConfirmation: false
      }
    }
    
    // Check reconstruction status
    const reconstructionStore = useReconstructionStore.getState()
    const reconstructionState = reconstructionStore.getState(message.id)
    const hasReconstruction = reconstructionState === 'done'
    
    return {
      eligible: isAccepted,
      reason: isAccepted ? undefined : 'Inbox messages must be accepted before archiving',
      status,
      hasReconstruction,
      hasDeliveryConfirmation: false
    }
  }
  
  // Outbox messages - must have delivery completed
  if (folder === 'outbox') {
    const isDeliveryCompleted = 
      deliveryStatus === 'sent' ||
      deliveryStatus === 'sent_manual' ||
      deliveryStatus === 'sent_chat' ||
      status === 'sent' ||
      status === 'sent_manual' ||
      status === 'sent_chat'
    
    return {
      eligible: isDeliveryCompleted,
      reason: isDeliveryCompleted 
        ? undefined 
        : 'Outbox messages must have delivery confirmed before archiving',
      status,
      hasReconstruction: false,
      hasDeliveryConfirmation: isDeliveryCompleted
    }
  }
  
  // Rejected messages - always eligible
  if (folder === 'rejected') {
    return {
      eligible: true,
      status,
      hasReconstruction: false,
      hasDeliveryConfirmation: false
    }
  }
  
  // Unknown folder
  return {
    eligible: false,
    reason: 'Unknown folder type',
    status,
    hasReconstruction: false,
    hasDeliveryConfirmation: false
  }
}

// =============================================================================
// Archive Message
// =============================================================================

/**
 * Archive a message
 * Creates frozen snapshot and moves to archived folder
 */
export async function archiveMessage(
  messageId: string
): Promise<{ success: boolean; error?: string; record?: ArchiveRecord }> {
  const messagesStore = useBeapMessagesStore.getState()
  const reconstructionStore = useReconstructionStore.getState()
  const ingressStore = useIngressStore.getState()
  const auditStore = useAuditStore.getState()
  
  // Get message
  const message = messagesStore.getMessageById(messageId)
  if (!message) {
    return { success: false, error: 'Message not found' }
  }
  
  // Check eligibility
  const eligibility = checkArchiveEligibility(message)
  if (!eligibility.eligible) {
    return { success: false, error: eligibility.reason }
  }
  
  try {
    // Get related data
    const reconstructionRecord = reconstructionStore.getRecord(messageId)
    const ingressEvents = ingressStore.getEventsByMessageId(messageId)
    const auditChain = auditStore.getChain(messageId)
    
    // Compute envelope hash (from message data)
    const envelopeData = JSON.stringify({
      id: message.id,
      fingerprint: message.fingerprintFull || message.fingerprint,
      deliveryMethod: message.deliveryMethod,
      timestamp: message.timestamp
    })
    const envelopeHash = await computeHash(envelopeData)
    
    // Build archive record
    const archiveRecord: ArchiveRecord = {
      messageId,
      archivedAt: Date.now(),
      archivedBy: 'user',
      
      // Frozen message snapshot
      messageSnapshot: {
        title: message.title,
        status: message.status,
        direction: message.direction,
        deliveryMethod: message.deliveryMethod,
        timestamp: message.timestamp,
        fingerprint: message.fingerprint,
        fingerprintFull: message.fingerprintFull,
        senderName: message.senderName,
        channelSite: message.channelSite
      },
      
      // Envelope reference
      envelopeRef: {
        envelopeHash,
        summary: message.envelopeSummary as Record<string, unknown> | undefined
      },
      
      // Capsule reference
      capsuleRef: {
        capsuleHash: message.capsuleRef ? await computeHash(message.capsuleRef) : undefined,
        semanticTextHash: reconstructionRecord 
          ? await computeHash(JSON.stringify(reconstructionRecord.semanticTextByArtefact))
          : undefined,
        attachmentCount: message.attachments.length
      },
      
      // Reconstruction references
      reconstructionRef: reconstructionRecord ? {
        reconstructionHash: await computeHash(JSON.stringify(reconstructionRecord)),
        semanticTextHashes: reconstructionRecord.semanticTextByArtefact.map(s => s.textHash),
        rasterHashes: reconstructionRecord.rasterRefs.flatMap(r => r.pages.map(p => p.imageHash))
      } : undefined,
      
      // Event references
      ingressEventIds: ingressEvents.map(e => e.eventId),
      dispatchEventIds: message.deliveryAttempts?.map((_, i) => `dispatch_${messageId}_${i}`) || [],
      
      // Audit chain hash
      auditChainHash: auditChain?.headHash || '',
      
      // Rejection reason (for rejected messages)
      rejectionReason: message.rejectionReasonData ? {
        code: message.rejectionReasonData.code,
        summary: message.rejectionReasonData.humanSummary,
        details: message.rejectionReasonData.details,
        timestamp: message.rejectionReasonData.timestamp
      } : undefined
    }
    
    // Build audit refs
    const auditRefs: AuditRefs = {
      envelopeHash,
      capsuleHash: archiveRecord.capsuleRef.capsuleHash,
      artefactHashes: archiveRecord.reconstructionRef?.rasterHashes,
      ingressEventId: ingressEvents[0]?.eventId,
      reconstructionHash: archiveRecord.reconstructionRef?.reconstructionHash
    }
    
    // Log archive event
    await logArchiveEvent(messageId, auditRefs)
    
    // Move to archived folder
    messagesStore.moveToFolder(messageId, 'archived')
    messagesStore.updateMessageStatus(messageId, 'archived')
    
    console.log(`[Archival] Message ${messageId} archived successfully`)
    
    return {
      success: true,
      record: archiveRecord
    }
    
  } catch (error) {
    console.error('[Archival] Archive failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Archive failed'
    }
  }
}

// =============================================================================
// Archive Store
// =============================================================================

/**
 * Simple in-memory store for archive records
 * In production, this would be persisted
 */
const archiveRecords: Map<string, ArchiveRecord> = new Map()

/**
 * Store archive record
 */
export function storeArchiveRecord(record: ArchiveRecord): void {
  archiveRecords.set(record.messageId, record)
}

/**
 * Get archive record
 */
export function getArchiveRecord(messageId: string): ArchiveRecord | undefined {
  return archiveRecords.get(messageId)
}

/**
 * Check if message is archived
 */
export function isArchived(messageId: string): boolean {
  return archiveRecords.has(messageId)
}

