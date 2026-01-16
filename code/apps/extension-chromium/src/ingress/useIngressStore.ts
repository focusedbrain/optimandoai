/**
 * Ingress Store
 * 
 * Zustand store for managing ingress events and import payloads.
 * Append-only event log for audit trail.
 * 
 * @version 1.0.0
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  IngressEvent,
  ImportPayload,
  IngressSource
} from './types'

// =============================================================================
// Store Interface
// =============================================================================

interface IngressState {
  /** Ingress events (append-only log) */
  events: IngressEvent[]
  
  /** Stored import payloads */
  payloads: ImportPayload[]
  
  // =========================================================================
  // Events
  // =========================================================================
  
  /** Add an ingress event */
  addEvent: (event: IngressEvent) => void
  
  /** Get events by message ID */
  getEventsByMessageId: (messageId: string) => IngressEvent[]
  
  /** Get events by source */
  getEventsBySource: (source: IngressSource) => IngressEvent[]
  
  /** Get all events */
  getAllEvents: () => IngressEvent[]
  
  /** Get recent events */
  getRecentEvents: (limit?: number) => IngressEvent[]
  
  // =========================================================================
  // Payloads
  // =========================================================================
  
  /** Store a payload */
  storePayload: (payload: ImportPayload) => void
  
  /** Get payload by ID */
  getPayload: (payloadId: string) => ImportPayload | null
  
  /** Get payload by raw ref */
  getPayloadByRef: (rawRef: string) => ImportPayload | null
  
  /** Delete payload (for cleanup) */
  deletePayload: (payloadId: string) => void
  
  // =========================================================================
  // Utilities
  // =========================================================================
  
  /** Clear all data (for testing) */
  clearAll: () => void
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useIngressStore = create<IngressState>()(
  persist(
    (set, get) => ({
      events: [],
      payloads: [],
      
      // =========================================================================
      // Events
      // =========================================================================
      
      addEvent: (event) => {
        set(state => ({
          events: [...state.events, event]
        }))
      },
      
      getEventsByMessageId: (messageId) => {
        return get().events.filter(e => e.messageId === messageId)
      },
      
      getEventsBySource: (source) => {
        return get().events.filter(e => e.source === source)
      },
      
      getAllEvents: () => get().events,
      
      getRecentEvents: (limit = 50) => {
        return get().events
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, limit)
      },
      
      // =========================================================================
      // Payloads
      // =========================================================================
      
      storePayload: (payload) => {
        set(state => ({
          payloads: [...state.payloads, payload]
        }))
      },
      
      getPayload: (payloadId) => {
        return get().payloads.find(p => p.payloadId === payloadId) || null
      },
      
      getPayloadByRef: (rawRef) => {
        // rawRef format: "payload:<payloadId>"
        const payloadId = rawRef.replace('payload:', '')
        return get().getPayload(payloadId)
      },
      
      deletePayload: (payloadId) => {
        set(state => ({
          payloads: state.payloads.filter(p => p.payloadId !== payloadId)
        }))
      },
      
      // =========================================================================
      // Utilities
      // =========================================================================
      
      clearAll: () => {
        set({ events: [], payloads: [] })
      }
    }),
    {
      name: 'beap-ingress-store',
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
// Selector Hooks
// =============================================================================

export const useIngressEvents = () =>
  useIngressStore(state => state.events)

export const useRecentIngressEvents = (limit = 50) =>
  useIngressStore(state => state.getRecentEvents(limit))

