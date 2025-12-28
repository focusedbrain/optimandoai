/**
 * Policy Store
 * 
 * Zustand store for managing policy state across the extension.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { CanonicalPolicy, PolicyLayer } from '../schema'
import { createPolicyFromTemplate } from '../templates'

interface PolicyState {
  // Local Node Policy
  localPolicy: CanonicalPolicy | null
  
  // Network Baseline Policy
  networkPolicy: CanonicalPolicy | null
  
  // Handshake/Sender Policies
  handshakePolicies: CanonicalPolicy[]
  
  // Currently selected handshake ID
  selectedHandshakeId: string | null
  
  // Capsule Ask Policies (per-capsule)
  capsulePolicies: Record<string, CanonicalPolicy>
  
  // Loading state
  isLoading: boolean
  
  // Last sync timestamp
  lastSync: number | null
  
  // Actions
  setLocalPolicy: (policy: CanonicalPolicy) => void
  setNetworkPolicy: (policy: CanonicalPolicy | null) => void
  addHandshakePolicy: (policy: CanonicalPolicy) => void
  updateHandshakePolicy: (id: string, policy: Partial<CanonicalPolicy>) => void
  removeHandshakePolicy: (id: string) => void
  setSelectedHandshake: (id: string | null) => void
  setCapsulePolicy: (capsuleId: string, policy: CanonicalPolicy) => void
  removeCapsulePolicy: (capsuleId: string) => void
  initializeWithDefaults: () => void
  setLoading: (loading: boolean) => void
}

export const usePolicyStore = create<PolicyState>()(
  persist(
    (set, get) => ({
      localPolicy: null,
      networkPolicy: null,
      handshakePolicies: [],
      selectedHandshakeId: null,
      capsulePolicies: {},
      isLoading: false,
      lastSync: null,

      setLocalPolicy: (policy) => {
        set({ 
          localPolicy: policy,
          lastSync: Date.now(),
        })
      },

      setNetworkPolicy: (policy) => {
        set({ 
          networkPolicy: policy,
          lastSync: Date.now(),
        })
      },

      addHandshakePolicy: (policy) => {
        set((state) => ({
          handshakePolicies: [...state.handshakePolicies, policy],
          lastSync: Date.now(),
        }))
      },

      updateHandshakePolicy: (id, updates) => {
        set((state) => ({
          handshakePolicies: state.handshakePolicies.map(p =>
            p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
          ),
          lastSync: Date.now(),
        }))
      },

      removeHandshakePolicy: (id) => {
        set((state) => ({
          handshakePolicies: state.handshakePolicies.filter(p => p.id !== id),
          selectedHandshakeId: state.selectedHandshakeId === id ? null : state.selectedHandshakeId,
          lastSync: Date.now(),
        }))
      },

      setSelectedHandshake: (id) => {
        set({ selectedHandshakeId: id })
      },

      setCapsulePolicy: (capsuleId, policy) => {
        set((state) => ({
          capsulePolicies: { ...state.capsulePolicies, [capsuleId]: policy },
          lastSync: Date.now(),
        }))
      },

      removeCapsulePolicy: (capsuleId) => {
        set((state) => {
          const { [capsuleId]: _, ...rest } = state.capsulePolicies
          return { capsulePolicies: rest, lastSync: Date.now() }
        })
      },

      initializeWithDefaults: () => {
        const state = get()
        if (!state.localPolicy) {
          const defaultLocal = createPolicyFromTemplate('standard', 'local', 'Local Node Policy')
          set({ 
            localPolicy: defaultLocal,
            lastSync: Date.now(),
          })
        }
      },

      setLoading: (loading) => {
        set({ isLoading: loading })
      },
    }),
    {
      name: 'wr-policy-store',
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
          },
        }
      }),
      partialize: (state) => ({
        localPolicy: state.localPolicy,
        networkPolicy: state.networkPolicy,
        handshakePolicies: state.handshakePolicies,
        capsulePolicies: state.capsulePolicies,
        lastSync: state.lastSync,
      }),
    }
  )
)

