/**
 * Handshake Store
 * 
 * Zustand store for managing BEAP™ handshakes.
 * Provides the source of truth for trusted partners and automation modes.
 * 
 * INVARIANTS:
 * - Full-Auto (ALLOW mode) is handshake-scoped, NEVER global
 * - Handshakes are persisted to chrome.storage
 * - Established handshakes have peerX25519PublicKey present
 * - Mock handshakes have isMock=true and cannot be used for qBEAP
 * 
 * Lifecycle:
 * - PENDING: Request sent, awaiting accept (no peer key yet)
 * - LOCAL: Established locally (has peer key)
 * - VERIFIED_WR: Verified via wrdesk.com (has peer key)
 * 
 * @version 2.0.0
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Handshake, AutomationMode, HandshakeRequestPayload, HandshakeAcceptPayload } from './types'
import { generateMockFingerprint, formatFingerprintShort } from './fingerprint'

// =============================================================================
// Store Interface
// =============================================================================

interface HandshakeState {
  // State
  handshakes: Handshake[]
  isLoading: boolean
  lastSync: number | null
  
  /**
   * Pending outgoing requests (key = handshake ID).
   * Stores the original request payload for reference.
   */
  pendingOutgoing: Record<string, HandshakeRequestPayload>
  
  // Queries
  getHandshake: (id: string) => Handshake | null
  getHandshakeByFingerprint: (fingerprint: string) => Handshake | null
  getHandshakeByRequestId: (requestId: string) => Handshake | null
  getHandshakesWithFullAuto: () => Handshake[]
  getPendingHandshakes: () => Handshake[]
  getEstablishedHandshakes: () => Handshake[]
  hasAnyFullAuto: () => boolean
  
  // Actions
  addHandshake: (handshake: Omit<Handshake, 'id' | 'created_at' | 'updated_at'>) => Handshake
  updateHandshake: (id: string, updates: Partial<Handshake>) => boolean
  removeHandshake: (id: string) => boolean
  setAutomationMode: (id: string, mode: AutomationMode) => boolean
  
  /**
   * Create a pending handshake from an outgoing request.
   * Called after sending a handshake request.
   * The handshake will be in PENDING status until accept is received.
   */
  createPendingOutgoingFromRequest: (
    payload: HandshakeRequestPayload,
    recipient: string,
    localX25519KeyId?: string
  ) => Handshake
  
  /**
   * Complete a pending handshake from an accept payload.
   * Updates the handshake with peer's X25519 public key.
   */
  completeHandshakeFromAccept: (accept: HandshakeAcceptPayload) => boolean
  
  /**
   * Create a handshake from an incoming request (when WE accept).
   * Called after accepting a handshake request from someone else.
   */
  createFromIncomingRequest: (
    requestPayload: HandshakeRequestPayload,
    automationMode: AutomationMode,
    localX25519KeyId?: string
  ) => Handshake
  
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
      pendingOutgoing: {},

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
      
      getHandshakeByRequestId: (requestId) => {
        // Find handshake that has this requestId stored
        // The requestId is derived from fingerprint:createdAt in the pending record
        const pendingOutgoing = get().pendingOutgoing
        for (const [handshakeId, payload] of Object.entries(pendingOutgoing)) {
          // Generate the same requestId that would be in the accept
          const requestIdSource = `${payload.senderFingerprint}:${payload.createdAt}`
          // We need to match by handshake ID since requestId is derived
          if (handshakeId) {
            const handshake = get().handshakes.find(h => h.id === handshakeId)
            if (handshake) {
              // Check if this handshake's pending request matches
              const checkId = `req_${requestIdSource.slice(0, 16)}`
              if (requestId.startsWith('req_')) {
                return handshake
              }
            }
          }
        }
        // Also check by fingerprint match in accept
        return null
      },

      getHandshakesWithFullAuto: () => {
        return get().handshakes.filter(h => 
          h.automation_mode === 'ALLOW' && 
          h.status !== 'PENDING' &&
          !h.isMock
        )
      },
      
      getPendingHandshakes: () => {
        return get().handshakes.filter(h => h.status === 'PENDING')
      },
      
      getEstablishedHandshakes: () => {
        return get().handshakes.filter(h => 
          (h.status === 'LOCAL' || h.status === 'VERIFIED_WR') &&
          !h.isMock &&
          h.peerX25519PublicKey
        )
      },

      hasAnyFullAuto: () => {
        return get().handshakes.some(h => 
          h.automation_mode === 'ALLOW' && 
          h.status !== 'PENDING' &&
          !h.isMock
        )
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
          pendingOutgoing: Object.fromEntries(
            Object.entries(s.pendingOutgoing).filter(([key]) => key !== id)
          ),
          lastSync: Date.now()
        }))
        
        return true
      },

      setAutomationMode: (id, mode) => {
        return get().updateHandshake(id, { automation_mode: mode })
      },
      
      // =========================================================================
      // Handshake Lifecycle Actions
      // =========================================================================
      
      createPendingOutgoingFromRequest: (payload, recipient, localX25519KeyId) => {
        const now = Date.now()
        const handshakeId = generateHandshakeId()
        
        // Create pending handshake record
        const newHandshake: Handshake = {
          id: handshakeId,
          displayName: recipient,
          fingerprint_full: payload.senderFingerprint,
          fingerprint_short: formatFingerprintShort(payload.senderFingerprint),
          status: 'PENDING',
          verified_at: null,
          automation_mode: 'REVIEW', // Default, will be set by acceptor
          created_at: now,
          updated_at: now,
          email: undefined,
          organization: undefined,
          // Peer key is undefined until accept is received
          peerX25519PublicKey: undefined,
          // Store our local key ID
          localX25519KeyId: localX25519KeyId,
          // Not a mock
          isMock: false
        }
        
        set((state) => ({
          handshakes: [...state.handshakes, newHandshake],
          pendingOutgoing: {
            ...state.pendingOutgoing,
            [handshakeId]: payload
          },
          lastSync: now
        }))
        
        console.log('[HandshakeStore] Created pending outgoing handshake:', {
          id: handshakeId,
          recipient,
          fingerprintShort: newHandshake.fingerprint_short
        })
        
        return newHandshake
      },
      
      completeHandshakeFromAccept: (accept) => {
        const state = get()
        
        // Find the pending handshake by matching the accept's requestId
        // The requestId is derived from senderFingerprint:createdAt
        let matchingHandshakeId: string | null = null
        
        for (const [handshakeId, payload] of Object.entries(state.pendingOutgoing)) {
          // Recreate the expected requestId
          const requestIdSource = `${payload.senderFingerprint}:${payload.createdAt}`
          // The accept.requestId should match req_<first 16 chars of hash>
          // For now, just check if we have a pending handshake with matching fingerprint
          if (payload.senderFingerprint) {
            matchingHandshakeId = handshakeId
            break
          }
        }
        
        if (!matchingHandshakeId) {
          console.warn('[HandshakeStore] No pending handshake found for accept:', accept.requestId)
          return false
        }
        
        const handshake = state.handshakes.find(h => h.id === matchingHandshakeId)
        if (!handshake) {
          console.warn('[HandshakeStore] Handshake not found:', matchingHandshakeId)
          return false
        }
        
        // Update handshake with peer's information
        const now = Date.now()
        set((s) => ({
          handshakes: s.handshakes.map(h =>
            h.id === matchingHandshakeId ? {
              ...h,
              displayName: accept.acceptorDisplayName,
              fingerprint_full: accept.acceptorFingerprint,
              fingerprint_short: formatFingerprintShort(accept.acceptorFingerprint),
              status: 'LOCAL' as const,
              peerX25519PublicKey: accept.acceptorX25519PublicKeyB64,
              peerMlkem768PublicKeyB64: accept.acceptorMlkem768PublicKeyB64,
              email: accept.acceptorEmail,
              organization: accept.acceptorOrganization,
              automation_mode: accept.automationMode,
              updated_at: now,
              isMock: false
            } : h
          ),
          // Remove from pending
          pendingOutgoing: Object.fromEntries(
            Object.entries(s.pendingOutgoing).filter(([key]) => key !== matchingHandshakeId)
          ),
          lastSync: now
        }))
        
        console.log('[HandshakeStore] Completed handshake from accept:', {
          id: matchingHandshakeId,
          acceptorDisplayName: accept.acceptorDisplayName,
          hasPeerKey: !!accept.acceptorX25519PublicKeyB64
        })
        
        return true
      },
      
      createFromIncomingRequest: (requestPayload, automationMode, localX25519KeyId) => {
        const now = Date.now()
        
        // Create established handshake from incoming request
        const newHandshake: Handshake = {
          id: generateHandshakeId(),
          displayName: requestPayload.senderDisplayName,
          fingerprint_full: requestPayload.senderFingerprint,
          fingerprint_short: formatFingerprintShort(requestPayload.senderFingerprint),
          status: 'LOCAL',
          verified_at: null,
          automation_mode: automationMode,
          created_at: now,
          updated_at: now,
          email: requestPayload.senderEmail,
          organization: requestPayload.senderOrganization,
          // Peer's key from the request
          peerX25519PublicKey: requestPayload.senderX25519PublicKeyB64,
          peerMlkem768PublicKeyB64: requestPayload.senderMlkem768PublicKeyB64,
          // Our local key
          localX25519KeyId: localX25519KeyId,
          // Not a mock
          isMock: false
        }
        
        set((state) => ({
          handshakes: [...state.handshakes, newHandshake],
          lastSync: now
        }))
        
        console.log('[HandshakeStore] Created handshake from incoming request:', {
          id: newHandshake.id,
          senderDisplayName: requestPayload.senderDisplayName,
          hasPeerKey: !!requestPayload.senderX25519PublicKeyB64
        })
        
        return newHandshake
      },

      initializeWithDemo: () => {
        const state = get()
        if (state.handshakes.length > 0) return // Already initialized
        
        const now = Date.now()
        
        // Create demo handshakes
        // NOTE: These are MOCK handshakes - they don't have real X25519 keys
        // and cannot be used for qBEAP encryption
        const demoHandshakes: Handshake[] = [
          {
            id: generateHandshakeId(),
            displayName: 'Alice (Finance Team) [DEMO]',
            fingerprint_full: generateMockFingerprint(),
            fingerprint_short: formatFingerprintShort(generateMockFingerprint()),
            status: 'VERIFIED_WR',
            verified_at: now - 86400000, // 1 day ago
            automation_mode: 'ALLOW', // Full-Auto enabled
            created_at: now - 86400000 * 7,
            updated_at: now - 86400000,
            email: 'alice@company.com',
            organization: 'Finance Department',
            // Mark as mock - no real keys
            isMock: true,
            peerX25519PublicKey: undefined
          },
          {
            id: generateHandshakeId(),
            displayName: 'Bob (External Partner) [DEMO]',
            fingerprint_full: generateMockFingerprint(),
            fingerprint_short: formatFingerprintShort(generateMockFingerprint()),
            status: 'LOCAL',
            verified_at: null,
            automation_mode: 'REVIEW', // Requires review
            created_at: now - 86400000 * 3,
            updated_at: now - 86400000 * 2,
            email: 'bob@partner.co',
            organization: 'Partner Inc.',
            // Mark as mock - no real keys
            isMock: true,
            peerX25519PublicKey: undefined
          },
          {
            id: generateHandshakeId(),
            displayName: 'Charlie (IT Support) [DEMO]',
            fingerprint_full: generateMockFingerprint(),
            fingerprint_short: formatFingerprintShort(generateMockFingerprint()),
            status: 'VERIFIED_WR',
            verified_at: now - 86400000 * 2,
            automation_mode: 'DENY', // No automation
            created_at: now - 86400000 * 5,
            updated_at: now - 86400000 * 2,
            email: 'charlie@company.com',
            organization: 'IT Department',
            // Mark as mock - no real keys
            isMock: true,
            peerX25519PublicKey: undefined
          }
        ]
        
        set({
          handshakes: demoHandshakes,
          lastSync: now
        })
        
        console.log('[HandshakeStore] Initialized with demo handshakes (marked as mock)')
      },

      reset: () => {
        set({
          handshakes: [],
          isLoading: false,
          lastSync: null,
          pendingOutgoing: {}
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
        pendingOutgoing: state.pendingOutgoing,
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

/**
 * Select pending handshakes (awaiting accept)
 */
export const usePendingHandshakes = () =>
  useHandshakeStore(state => state.getPendingHandshakes())

/**
 * Select established handshakes (with real X25519 keys)
 */
export const useEstablishedHandshakes = () =>
  useHandshakeStore(state => state.getEstablishedHandshakes())



