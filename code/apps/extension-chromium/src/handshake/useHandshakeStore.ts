/**
 * Handshake Store
 * 
 * Zustand store for managing BEAP™ handshakes.
 * Provides the source of truth for trusted partners and automation modes.
 * 
 * INVARIANTS:
 * - Full-Auto (ALLOW mode) is handshake-scoped, NEVER global
 * - Handshakes are persisted to chrome.storage
 * 
 * @version 1.0.0
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Handshake, AutomationMode } from './types'
import { generateMockFingerprint, formatFingerprintShort } from './fingerprint'

// =============================================================================
// Store Interface
// =============================================================================

interface HandshakeState {
  // State
  handshakes: Handshake[]
  isLoading: boolean
  lastSync: number | null
  
  // Queries
  getHandshake: (id: string) => Handshake | null
  getHandshakeByFingerprint: (fingerprint: string) => Handshake | null
  getHandshakesWithFullAuto: () => Handshake[]
  hasAnyFullAuto: () => boolean
  
  // Actions
  addHandshake: (handshake: Omit<Handshake, 'id' | 'created_at' | 'updated_at'>) => Handshake
  updateHandshake: (id: string, updates: Partial<Handshake>) => boolean
  removeHandshake: (id: string) => boolean
  setAutomationMode: (id: string, mode: AutomationMode) => boolean
  
  // Initialize with demo data
  initializeWithDemo: () => void
  reset: () => void
}

// =============================================================================
// Helper: Generate IDs
// =============================================================================

function generateHandshakeId(): string {
  return `hs_${crypto.randomUUID().slice(0, 12)}`
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useHandshakeStore = create<HandshakeState>()(
  persist(
    (set, get) => ({
      handshakes: [],
      isLoading: false,
      lastSync: null,

      // Queries
      getHandshake: (id) => {
        return get().handshakes.find(h => h.id === id) || null
      },

      getHandshakeByFingerprint: (fingerprint) => {
        return get().handshakes.find(h => 
          h.fingerprint_full === fingerprint || 
          h.fingerprint_short === fingerprint
        ) || null
      },

      getHandshakesWithFullAuto: () => {
        return get().handshakes.filter(h => h.automation_mode === 'ALLOW')
      },

      hasAnyFullAuto: () => {
        return get().handshakes.some(h => h.automation_mode === 'ALLOW')
      },

      // Actions
      addHandshake: (handshake) => {
        const now = Date.now()
        const newHandshake: Handshake = {
          ...handshake,
          id: generateHandshakeId(),
          created_at: now,
          updated_at: now
        }
        
        set((state) => ({
          handshakes: [...state.handshakes, newHandshake],
          lastSync: now
        }))
        
        return newHandshake
      },

      updateHandshake: (id, updates) => {
        const state = get()
        const handshake = state.handshakes.find(h => h.id === id)
        if (!handshake) return false
        
        set((s) => ({
          handshakes: s.handshakes.map(h =>
            h.id === id ? { ...h, ...updates, updated_at: Date.now() } : h
          ),
          lastSync: Date.now()
        }))
        
        return true
      },

      removeHandshake: (id) => {
        const state = get()
        if (!state.handshakes.find(h => h.id === id)) return false
        
        set((s) => ({
          handshakes: s.handshakes.filter(h => h.id !== id),
          lastSync: Date.now()
        }))
        
        return true
      },

      setAutomationMode: (id, mode) => {
        return get().updateHandshake(id, { automation_mode: mode })
      },

      initializeWithDemo: () => {
        const state = get()
        if (state.handshakes.length > 0) return // Already initialized
        
        const now = Date.now()
        
        // Create demo handshakes
        const demoHandshakes: Handshake[] = [
          {
            id: generateHandshakeId(),
            displayName: 'Alice (Finance Team)',
            fingerprint_full: generateMockFingerprint(),
            fingerprint_short: formatFingerprintShort(generateMockFingerprint()),
            status: 'VERIFIED_WR',
            verified_at: now - 86400000, // 1 day ago
            automation_mode: 'ALLOW', // Full-Auto enabled
            created_at: now - 86400000 * 7,
            updated_at: now - 86400000,
            email: 'alice@company.com',
            organization: 'Finance Department'
          },
          {
            id: generateHandshakeId(),
            displayName: 'Bob (External Partner)',
            fingerprint_full: generateMockFingerprint(),
            fingerprint_short: formatFingerprintShort(generateMockFingerprint()),
            status: 'LOCAL',
            verified_at: null,
            automation_mode: 'REVIEW', // Requires review
            created_at: now - 86400000 * 3,
            updated_at: now - 86400000 * 2,
            email: 'bob@partner.co',
            organization: 'Partner Inc.'
          },
          {
            id: generateHandshakeId(),
            displayName: 'Charlie (IT Support)',
            fingerprint_full: generateMockFingerprint(),
            fingerprint_short: formatFingerprintShort(generateMockFingerprint()),
            status: 'VERIFIED_WR',
            verified_at: now - 86400000 * 2,
            automation_mode: 'DENY', // No automation
            created_at: now - 86400000 * 5,
            updated_at: now - 86400000 * 2,
            email: 'charlie@company.com',
            organization: 'IT Department'
          }
        ]
        
        set({
          handshakes: demoHandshakes,
          lastSync: now
        })
      },

      reset: () => {
        set({
          handshakes: [],
          isLoading: false,
          lastSync: null
        })
      }
    }),
    {
      name: 'beap-handshake-store',
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
      }),
      partialize: (state) => ({
        handshakes: state.handshakes,
        lastSync: state.lastSync
      }),
      onRehydrateStorage: () => (state) => {
        // Initialize with demo data if empty
        if (state && state.handshakes.length === 0) {
          state.initializeWithDemo()
        }
      }
    }
  )
)

// =============================================================================
// Selector Hooks
// =============================================================================

/**
 * Select all handshakes
 */
export const useHandshakes = () =>
  useHandshakeStore(state => state.handshakes)

/**
 * Select handshakes with Full-Auto enabled
 */
export const useFullAutoHandshakes = () =>
  useHandshakeStore(state => state.getHandshakesWithFullAuto())

/**
 * Check if any handshake has Full-Auto
 */
export const useHasAnyFullAuto = () =>
  useHandshakeStore(state => state.hasAnyFullAuto())

/**
 * Get Full-Auto status for WRGuard display
 */
export const useFullAutoStatus = () =>
  useHandshakeStore(state => {
    const fullAutoHandshakes = state.getHandshakesWithFullAuto()
    const hasAnyFullAuto = fullAutoHandshakes.length > 0
    
    let explanation: string
    if (!hasAnyFullAuto) {
      explanation = 'Full-Auto is not available. Establish a trusted handshake with Full-Auto permissions to enable automated package processing.'
    } else if (fullAutoHandshakes.length === 1) {
      explanation = `Full-Auto is active for handshake with ${fullAutoHandshakes[0].displayName}. Packages from this sender will be auto-registered.`
    } else {
      explanation = `Full-Auto is active for ${fullAutoHandshakes.length} handshakes. Packages from these senders will be auto-registered.`
    }
    
    return {
      hasAnyFullAuto,
      fullAutoHandshakes: fullAutoHandshakes.map(h => ({
        handshakeId: h.id,
        displayName: h.displayName,
        fingerprint: h.fingerprint_short
      })),
      explanation
    }
  })



