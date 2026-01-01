/**
 * Audit Store
 * 
 * Append-only, hash-chained audit trail for BEAP messages.
 * NO deletions, NO rewrites.
 * 
 * @version 1.0.0
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  AuditEvent,
  AuditEventType,
  AuditActor,
  AuditRefs,
  AuditChain
} from './types'

// =============================================================================
// Hash Utilities
// =============================================================================

/**
 * Compute SHA-256 hash of data
 */
async function computeHash(data: string): Promise<string> {
  const encoder = new TextEncoder()
  const dataBuffer = encoder.encode(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Compute hash of an audit event (excluding eventHash)
 */
async function computeEventHash(event: Omit<AuditEvent, 'eventHash'>): Promise<string> {
  const data = JSON.stringify({
    eventId: event.eventId,
    messageId: event.messageId,
    type: event.type,
    timestamp: event.timestamp,
    actor: event.actor,
    summary: event.summary,
    refs: event.refs,
    prevEventHash: event.prevEventHash,
    metadata: event.metadata
  })
  return computeHash(data)
}

// =============================================================================
// Store Interface
// =============================================================================

interface AuditStoreState {
  /** Events indexed by message ID */
  eventsByMessage: Record<string, AuditEvent[]>
  
  // =========================================================================
  // Queries
  // =========================================================================
  
  /** Get all events for a message */
  getEvents: (messageId: string) => AuditEvent[]
  
  /** Get audit chain for a message */
  getChain: (messageId: string) => AuditChain | null
  
  /** Get last event for a message */
  getLastEvent: (messageId: string) => AuditEvent | null
  
  /** Verify chain integrity for a message */
  verifyChainIntegrity: (messageId: string) => Promise<boolean>
  
  // =========================================================================
  // Actions (APPEND ONLY)
  // =========================================================================
  
  /** Append a new event (NO deletions, NO rewrites) */
  appendEvent: (params: {
    messageId: string
    type: AuditEventType
    actor: AuditActor
    summary: string
    refs?: AuditRefs
    metadata?: Record<string, unknown>
  }) => Promise<AuditEvent>
  
  /** Initialize chain for a new message (internal) */
  initializeChain: (messageId: string) => void
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useAuditStore = create<AuditStoreState>()(
  persist(
    (set, get) => ({
      eventsByMessage: {},
      
      // =========================================================================
      // Queries
      // =========================================================================
      
      getEvents: (messageId) => {
        return get().eventsByMessage[messageId] || []
      },
      
      getChain: (messageId) => {
        const events = get().eventsByMessage[messageId]
        if (!events || events.length === 0) return null
        
        const lastEvent = events[events.length - 1]
        
        return {
          messageId,
          events,
          headHash: lastEvent.eventHash,
          eventCount: events.length,
          createdAt: events[0].timestamp,
          lastEventAt: lastEvent.timestamp,
          integrityVerified: true // Will be verified on demand
        }
      },
      
      getLastEvent: (messageId) => {
        const events = get().eventsByMessage[messageId]
        if (!events || events.length === 0) return null
        return events[events.length - 1]
      },
      
      verifyChainIntegrity: async (messageId) => {
        const events = get().eventsByMessage[messageId]
        if (!events || events.length === 0) return true
        
        for (let i = 0; i < events.length; i++) {
          const event = events[i]
          
          // Verify prev hash
          if (i === 0) {
            if (event.prevEventHash !== null) return false
          } else {
            if (event.prevEventHash !== events[i - 1].eventHash) return false
          }
          
          // Verify event hash
          const expectedHash = await computeEventHash({
            eventId: event.eventId,
            messageId: event.messageId,
            type: event.type,
            timestamp: event.timestamp,
            actor: event.actor,
            summary: event.summary,
            refs: event.refs,
            prevEventHash: event.prevEventHash,
            metadata: event.metadata
          })
          
          if (expectedHash !== event.eventHash) return false
        }
        
        return true
      },
      
      // =========================================================================
      // Actions
      // =========================================================================
      
      appendEvent: async (params) => {
        const { messageId, type, actor, summary, refs = {}, metadata } = params
        
        // Get existing events
        const existingEvents = get().eventsByMessage[messageId] || []
        const lastEvent = existingEvents.length > 0 
          ? existingEvents[existingEvents.length - 1] 
          : null
        
        // Create new event
        const eventId = `evt_${crypto.randomUUID().slice(0, 12)}`
        const timestamp = Date.now()
        const prevEventHash = lastEvent?.eventHash || null
        
        // Compute event hash
        const eventWithoutHash = {
          eventId,
          messageId,
          type,
          timestamp,
          actor,
          summary,
          refs,
          prevEventHash,
          metadata
        }
        
        const eventHash = await computeEventHash(eventWithoutHash)
        
        const newEvent: AuditEvent = {
          ...eventWithoutHash,
          eventHash
        }
        
        // APPEND ONLY - never modify existing events
        set(state => ({
          eventsByMessage: {
            ...state.eventsByMessage,
            [messageId]: [...(state.eventsByMessage[messageId] || []), newEvent]
          }
        }))
        
        console.log(`[Audit] Appended event: ${type} for ${messageId}`)
        
        return newEvent
      },
      
      initializeChain: (messageId) => {
        const existing = get().eventsByMessage[messageId]
        if (!existing) {
          set(state => ({
            eventsByMessage: {
              ...state.eventsByMessage,
              [messageId]: []
            }
          }))
        }
      }
    }),
    {
      name: 'beap-audit-store',
      storage: createJSONStorage(() => {
        return {
          getItem: async (name) => {
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
              const result = await chrome.storage.local.get([name])
              return result[name] || null
            }
            return localStorage.getItem(name)
          },
          setItem: async (name, value) => {
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
              await chrome.storage.local.set({ [name]: value })
            } else {
              localStorage.setItem(name, value)
            }
          },
          removeItem: async (name) => {
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
              await chrome.storage.local.remove([name])
            } else {
              localStorage.removeItem(name)
            }
          }
        }
      })
    }
  )
)

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Log an import event
 */
export async function logImportEvent(
  messageId: string,
  source: string,
  refs: AuditRefs = {}
): Promise<AuditEvent> {
  return useAuditStore.getState().appendEvent({
    messageId,
    type: 'imported',
    actor: 'user',
    summary: `Message imported from ${source}`,
    refs
  })
}

/**
 * Log a verification event
 */
export async function logVerificationEvent(
  messageId: string,
  accepted: boolean,
  reason?: string,
  refs: AuditRefs = {}
): Promise<AuditEvent> {
  return useAuditStore.getState().appendEvent({
    messageId,
    type: accepted ? 'verified.accepted' : 'verified.rejected',
    actor: 'system',
    summary: accepted 
      ? 'Message passed envelope verification'
      : `Message rejected: ${reason || 'verification failed'}`,
    refs
  })
}

/**
 * Log a dispatch event
 */
export async function logDispatchEvent(
  messageId: string,
  method: string,
  refs: AuditRefs = {}
): Promise<AuditEvent> {
  return useAuditStore.getState().appendEvent({
    messageId,
    type: 'dispatched',
    actor: 'system',
    summary: `Message dispatched via ${method}`,
    refs
  })
}

/**
 * Log a delivery confirmation event
 */
export async function logDeliveryEvent(
  messageId: string,
  confirmed: boolean,
  method: string,
  refs: AuditRefs = {}
): Promise<AuditEvent> {
  return useAuditStore.getState().appendEvent({
    messageId,
    type: confirmed ? 'delivery.confirmed' : 'delivery.failed',
    actor: confirmed ? 'user' : 'system',
    summary: confirmed 
      ? `Delivery confirmed via ${method}`
      : `Delivery failed via ${method}`,
    refs
  })
}

/**
 * Log a reconstruction event
 */
export async function logReconstructionEvent(
  messageId: string,
  status: 'started' | 'completed' | 'failed',
  refs: AuditRefs = {}
): Promise<AuditEvent> {
  const typeMap = {
    started: 'reconstructed.started' as const,
    completed: 'reconstructed.completed' as const,
    failed: 'reconstructed.failed' as const
  }
  
  const summaryMap = {
    started: 'Content reconstruction started',
    completed: 'Content reconstruction completed',
    failed: 'Content reconstruction failed'
  }
  
  return useAuditStore.getState().appendEvent({
    messageId,
    type: typeMap[status],
    actor: 'system',
    summary: summaryMap[status],
    refs
  })
}

/**
 * Log an archive event
 */
export async function logArchiveEvent(
  messageId: string,
  refs: AuditRefs = {}
): Promise<AuditEvent> {
  return useAuditStore.getState().appendEvent({
    messageId,
    type: 'archived',
    actor: 'user',
    summary: 'Message archived',
    refs
  })
}

/**
 * Log an export event
 */
export async function logExportEvent(
  messageId: string,
  exportType: 'audit' | 'proof',
  refs: AuditRefs = {}
): Promise<AuditEvent> {
  return useAuditStore.getState().appendEvent({
    messageId,
    type: exportType === 'audit' ? 'exported.audit' : 'exported.proof',
    actor: 'user',
    summary: exportType === 'audit' 
      ? 'Audit log exported'
      : 'Proof bundle exported',
    refs
  })
}

// =============================================================================
// Selector Hooks
// =============================================================================

export const useAuditEvents = (messageId: string) =>
  useAuditStore(state => state.getEvents(messageId))

export const useAuditChain = (messageId: string) =>
  useAuditStore(state => state.getChain(messageId))

