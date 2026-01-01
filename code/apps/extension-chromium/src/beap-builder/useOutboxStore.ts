/**
 * Outbox Store
 * 
 * Zustand store for managing Outbox entries and delivery state transitions.
 * 
 * @version 1.0.0
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  OutboxEntry,
  DeliveryStatus,
  DeliveryAttempt,
  DeliveryMethod
} from './dispatch-types'

// =============================================================================
// Store Interface
// =============================================================================

interface OutboxState {
  /** All outbox entries */
  entries: Record<string, OutboxEntry>
  
  /** Loading state */
  isLoading: boolean
  
  // =========================================================================
  // Queries
  // =========================================================================
  
  /** Get all entries sorted by date */
  getAllEntries: () => OutboxEntry[]
  
  /** Get entry by ID */
  getEntry: (id: string) => OutboxEntry | null
  
  /** Get entry by package ID */
  getEntryByPackageId: (packageId: string) => OutboxEntry | null
  
  /** Get entries by status */
  getEntriesByStatus: (status: DeliveryStatus) => OutboxEntry[]
  
  /** Get entries by method */
  getEntriesByMethod: (method: DeliveryMethod) => OutboxEntry[]
  
  /** Get pending entries (queued or pending_user_action) */
  getPendingEntries: () => OutboxEntry[]
  
  /** Get counts by status */
  getStatusCounts: () => Record<DeliveryStatus, number>
  
  // =========================================================================
  // Actions
  // =========================================================================
  
  /** Add a new outbox entry */
  addEntry: (entry: OutboxEntry) => void
  
  /** Update entry status */
  updateStatus: (
    entryId: string, 
    status: DeliveryStatus, 
    error?: string
  ) => void
  
  /** Add delivery attempt */
  addAttempt: (
    entryId: string, 
    attempt: DeliveryAttempt
  ) => void
  
  /** Mark messenger send as confirmed */
  confirmMessengerSent: (entryId: string) => void
  
  /** Mark download as delivered */
  confirmDownloadDelivered: (entryId: string) => void
  
  /** Retry failed email send */
  retryEmail: (entryId: string) => void
  
  /** Archive entry (remove from active view) */
  archiveEntry: (entryId: string) => void
  
  /** Delete entry */
  deleteEntry: (entryId: string) => void
  
  /** Clear all entries */
  clearAll: () => void
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useOutboxStore = create<OutboxState>()(
  persist(
    (set, get) => ({
      entries: {},
      isLoading: false,
      
      // =========================================================================
      // Queries
      // =========================================================================
      
      getAllEntries: () => {
        return Object.values(get().entries)
          .sort((a, b) => b.updatedAt - a.updatedAt)
      },
      
      getEntry: (id) => {
        return get().entries[id] || null
      },
      
      getEntryByPackageId: (packageId) => {
        return Object.values(get().entries)
          .find(e => e.packageId === packageId) || null
      },
      
      getEntriesByStatus: (status) => {
        return Object.values(get().entries)
          .filter(e => e.deliveryStatus === status)
          .sort((a, b) => b.updatedAt - a.updatedAt)
      },
      
      getEntriesByMethod: (method) => {
        return Object.values(get().entries)
          .filter(e => e.deliveryMethod === method)
          .sort((a, b) => b.updatedAt - a.updatedAt)
      },
      
      getPendingEntries: () => {
        const pendingStatuses: DeliveryStatus[] = ['queued', 'sending', 'pending_user_action']
        return Object.values(get().entries)
          .filter(e => pendingStatuses.includes(e.deliveryStatus))
          .sort((a, b) => b.updatedAt - a.updatedAt)
      },
      
      getStatusCounts: () => {
        const counts: Record<DeliveryStatus, number> = {
          queued: 0,
          sending: 0,
          sent: 0,
          failed: 0,
          pending_user_action: 0,
          sent_manual: 0,
          sent_chat: 0
        }
        
        Object.values(get().entries).forEach(entry => {
          counts[entry.deliveryStatus]++
        })
        
        return counts
      },
      
      // =========================================================================
      // Actions
      // =========================================================================
      
      addEntry: (entry) => {
        set(state => ({
          entries: {
            ...state.entries,
            [entry.id]: entry
          }
        }))
      },
      
      updateStatus: (entryId, status, error) => {
        set(state => {
          const entry = state.entries[entryId]
          if (!entry) return state
          
          const updatedEntry: OutboxEntry = {
            ...entry,
            deliveryStatus: status,
            deliveryError: error,
            updatedAt: Date.now(),
            deliveryAttempts: [
              ...entry.deliveryAttempts,
              { at: Date.now(), status, error }
            ]
          }
          
          return {
            entries: {
              ...state.entries,
              [entryId]: updatedEntry
            }
          }
        })
      },
      
      addAttempt: (entryId, attempt) => {
        set(state => {
          const entry = state.entries[entryId]
          if (!entry) return state
          
          return {
            entries: {
              ...state.entries,
              [entryId]: {
                ...entry,
                deliveryAttempts: [...entry.deliveryAttempts, attempt],
                updatedAt: Date.now()
              }
            }
          }
        })
      },
      
      confirmMessengerSent: (entryId) => {
        get().updateStatus(entryId, 'sent_manual')
      },
      
      confirmDownloadDelivered: (entryId) => {
        get().updateStatus(entryId, 'sent_manual')
      },
      
      retryEmail: (entryId) => {
        const entry = get().entries[entryId]
        if (!entry || entry.deliveryMethod !== 'email') return
        
        // Set to queued for retry
        get().updateStatus(entryId, 'queued')
        
        // The actual retry would be handled by the send pipeline
        // This just updates the status to indicate retry is pending
      },
      
      archiveEntry: (entryId) => {
        // For now, we just mark it - could move to separate archive store later
        set(state => {
          const entry = state.entries[entryId]
          if (!entry) return state
          
          return {
            entries: {
              ...state.entries,
              [entryId]: {
                ...entry,
                updatedAt: Date.now()
              }
            }
          }
        })
      },
      
      deleteEntry: (entryId) => {
        set(state => {
          const { [entryId]: removed, ...rest } = state.entries
          return { entries: rest }
        })
      },
      
      clearAll: () => {
        set({ entries: {} })
      }
    }),
    {
      name: 'beap-outbox',
      storage: createJSONStorage(() => {
        // Use chrome.storage.local for persistence
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
      }),
      partialize: (state) => ({
        entries: state.entries
      })
    }
  )
)

// =============================================================================
// Selector Hooks
// =============================================================================

export const useOutboxEntries = () =>
  useOutboxStore(state => state.getAllEntries())

export const usePendingOutboxEntries = () =>
  useOutboxStore(state => state.getPendingEntries())

export const useOutboxStatusCounts = () =>
  useOutboxStore(state => state.getStatusCounts())

export const useOutboxEntry = (entryId: string) =>
  useOutboxStore(state => state.getEntry(entryId))

