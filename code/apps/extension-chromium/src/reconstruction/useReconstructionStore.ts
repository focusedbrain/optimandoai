/**
 * Reconstruction Store
 * 
 * Zustand store for managing reconstruction records.
 * Tracks reconstruction state per message.
 * 
 * @version 1.0.0
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  ReconstructionRecord,
  ReconstructionState,
  SemanticTextEntry,
  RasterRef
} from './types'

// =============================================================================
// Store Interface
// =============================================================================

interface ReconstructionStoreState {
  /** Reconstruction records by message ID */
  records: Record<string, ReconstructionRecord>
  
  // =========================================================================
  // Queries
  // =========================================================================
  
  /** Get reconstruction record for a message */
  getRecord: (messageId: string) => ReconstructionRecord | null
  
  /** Get reconstruction state for a message */
  getState: (messageId: string) => ReconstructionState
  
  /** Check if message has been reconstructed */
  isReconstructed: (messageId: string) => boolean
  
  /** Get semantic text for a message */
  getSemanticText: (messageId: string) => SemanticTextEntry[]
  
  /** Get raster refs for a message */
  getRasterRefs: (messageId: string) => RasterRef[]
  
  // =========================================================================
  // Actions
  // =========================================================================
  
  /** Start reconstruction (set state to running) */
  startReconstruction: (messageId: string, envelopeHash: string) => void
  
  /** Complete reconstruction successfully */
  completeReconstruction: (
    messageId: string,
    semanticTextByArtefact: SemanticTextEntry[],
    rasterRefs: RasterRef[]
  ) => void
  
  /** Mark reconstruction as failed */
  failReconstruction: (messageId: string, error: string) => void
  
  /** Clear reconstruction record for a message */
  clearRecord: (messageId: string) => void
  
  /** Clear all records (for development) */
  clearAll: () => void
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useReconstructionStore = create<ReconstructionStoreState>()(
  persist(
    (set, get) => ({
      records: {},
      
      // =========================================================================
      // Queries
      // =========================================================================
      
      getRecord: (messageId) => {
        return get().records[messageId] || null
      },
      
      getState: (messageId) => {
        const record = get().records[messageId]
        return record?.state || 'none'
      },
      
      isReconstructed: (messageId) => {
        const record = get().records[messageId]
        return record?.state === 'done'
      },
      
      getSemanticText: (messageId) => {
        const record = get().records[messageId]
        return record?.semanticTextByArtefact || []
      },
      
      getRasterRefs: (messageId) => {
        const record = get().records[messageId]
        return record?.rasterRefs || []
      },
      
      // =========================================================================
      // Actions
      // =========================================================================
      
      startReconstruction: (messageId, envelopeHash) => {
        set(state => ({
          records: {
            ...state.records,
            [messageId]: {
              messageId,
              state: 'running',
              semanticTextByArtefact: [],
              rasterRefs: [],
              startedAt: Date.now(),
              envelopeHash,
              version: (state.records[messageId]?.version || 0) + 1
            }
          }
        }))
      },
      
      completeReconstruction: (messageId, semanticTextByArtefact, rasterRefs) => {
        set(state => {
          const existing = state.records[messageId]
          if (!existing) return state
          
          return {
            records: {
              ...state.records,
              [messageId]: {
                ...existing,
                state: 'done',
                semanticTextByArtefact,
                rasterRefs,
                completedAt: Date.now()
              }
            }
          }
        })
      },
      
      failReconstruction: (messageId, error) => {
        set(state => {
          const existing = state.records[messageId]
          if (!existing) return state
          
          return {
            records: {
              ...state.records,
              [messageId]: {
                ...existing,
                state: 'failed',
                error,
                completedAt: Date.now()
              }
            }
          }
        })
      },
      
      clearRecord: (messageId) => {
        set(state => {
          const { [messageId]: _, ...rest } = state.records
          return { records: rest }
        })
      },
      
      clearAll: () => {
        set({ records: {} })
      }
    }),
    {
      name: 'beap-reconstruction-store',
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

export const useReconstructionState = (messageId: string) =>
  useReconstructionStore(state => state.getState(messageId))

export const useIsReconstructed = (messageId: string) =>
  useReconstructionStore(state => state.isReconstructed(messageId))

export const useSemanticText = (messageId: string) =>
  useReconstructionStore(state => state.getSemanticText(messageId))

export const useRasterRefs = (messageId: string) =>
  useReconstructionStore(state => state.getRasterRefs(messageId))

