/**
 * WRGuard Store
 * 
 * Zustand store for WRGuard configuration management.
 * Handles email providers, protected sites, and policy overview.
 * 
 * This is purely declarative configuration - no enforcement logic.
 * 
 * @version 1.0.0
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  WRGuardConfig,
  EmailProvider,
  EmailProviderType,
  ProviderConnectionStatus,
  ProtectedSite,
  ProtectedSiteSource,
  PolicyOverview,
  WRGuardSection
} from './types'
import {
  DEFAULT_PROTECTED_SITES,
  DEFAULT_POLICY_OVERVIEW
} from './types'

// =============================================================================
// Store Interface
// =============================================================================

interface WRGuardState extends WRGuardConfig {
  /** Current active section */
  activeSection: WRGuardSection
  
  /** Loading state */
  isLoading: boolean
  
  // =========================================================================
  // Navigation
  // =========================================================================
  
  /** Set active section */
  setActiveSection: (section: WRGuardSection) => void
  
  // =========================================================================
  // Email Providers
  // =========================================================================
  
  /** Get all providers */
  getProviders: () => EmailProvider[]
  
  /** Get provider by ID */
  getProvider: (id: string) => EmailProvider | null
  
  /** Get connected providers */
  getConnectedProviders: () => EmailProvider[]
  
  /** Add a new provider */
  addProvider: (provider: Omit<EmailProvider, 'id' | 'createdAt'>) => void
  
  /** Update provider status */
  updateProviderStatus: (id: string, status: ProviderConnectionStatus, error?: string) => void
  
  /** Set default provider */
  setDefaultProvider: (id: string) => void
  
  /** Remove provider */
  removeProvider: (id: string) => void
  
  /** Connect provider (placeholder) */
  connectProvider: (id: string) => Promise<boolean>
  
  /** Disconnect provider */
  disconnectProvider: (id: string) => void
  
  // =========================================================================
  // Protected Sites
  // =========================================================================
  
  /** Get all protected sites */
  getProtectedSites: () => ProtectedSite[]
  
  /** Get enabled protected sites */
  getEnabledSites: () => ProtectedSite[]
  
  /** Check if domain is protected */
  isDomainProtected: (domain: string) => boolean
  
  /** Add protected site */
  addProtectedSite: (domain: string, description?: string) => void
  
  /** Remove protected site */
  removeProtectedSite: (id: string) => void
  
  /** Toggle protected site enabled state */
  toggleProtectedSite: (id: string) => void
  
  /** Reset to default sites */
  resetProtectedSites: () => void
  
  // =========================================================================
  // Policy Overview
  // =========================================================================
  
  /** Get policy overview */
  getPolicyOverview: () => PolicyOverview
  
  // =========================================================================
  // Initialization
  // =========================================================================
  
  /** Initialize WRGuard with defaults */
  initialize: () => void
  
  /** Reset all configuration */
  reset: () => void
}

// =============================================================================
// Initial State
// =============================================================================

const createInitialState = (): Omit<WRGuardConfig, 'protectedSites'> & { protectedSites: ProtectedSite[] } => ({
  providers: [],
  protectedSites: DEFAULT_PROTECTED_SITES.map((site, index) => ({
    ...site,
    id: `default_${index}`,
    addedAt: Date.now()
  })),
  policyOverview: DEFAULT_POLICY_OVERVIEW,
  initialized: false,
  lastUpdated: Date.now()
})

// =============================================================================
// Store Implementation
// =============================================================================

export const useWRGuardStore = create<WRGuardState>()(
  persist(
    (set, get) => ({
      ...createInitialState(),
      activeSection: 'providers',
      isLoading: false,
      
      // =========================================================================
      // Navigation
      // =========================================================================
      
      setActiveSection: (section) => set({ activeSection: section }),
      
      // =========================================================================
      // Email Providers
      // =========================================================================
      
      getProviders: () => get().providers,
      
      getProvider: (id) => get().providers.find(p => p.id === id) || null,
      
      getConnectedProviders: () => 
        get().providers.filter(p => p.status === 'connected'),
      
      addProvider: (provider) => {
        const newProvider: EmailProvider = {
          ...provider,
          id: `provider_${crypto.randomUUID().slice(0, 8)}`,
          createdAt: Date.now()
        }
        
        set(state => ({
          providers: [...state.providers, newProvider],
          lastUpdated: Date.now()
        }))
      },
      
      updateProviderStatus: (id, status, error) => {
        set(state => ({
          providers: state.providers.map(p =>
            p.id === id
              ? {
                  ...p,
                  status,
                  error,
                  lastConnected: status === 'connected' ? Date.now() : p.lastConnected
                }
              : p
          ),
          lastUpdated: Date.now()
        }))
      },
      
      setDefaultProvider: (id) => {
        set(state => ({
          providers: state.providers.map(p => ({
            ...p,
            isDefault: p.id === id
          })),
          lastUpdated: Date.now()
        }))
      },
      
      removeProvider: (id) => {
        set(state => ({
          providers: state.providers.filter(p => p.id !== id),
          lastUpdated: Date.now()
        }))
      },
      
      connectProvider: async (id) => {
        const { updateProviderStatus, getProvider } = get()
        const provider = getProvider(id)
        
        if (!provider) return false
        
        updateProviderStatus(id, 'connecting')
        
        // Simulate connection (would trigger OAuth flow in reality)
        await new Promise(resolve => setTimeout(resolve, 1500))
        
        // For now, always succeed (placeholder)
        updateProviderStatus(id, 'connected')
        return true
      },
      
      disconnectProvider: (id) => {
        get().updateProviderStatus(id, 'disconnected')
      },
      
      // =========================================================================
      // Protected Sites
      // =========================================================================
      
      getProtectedSites: () => get().protectedSites,
      
      getEnabledSites: () => 
        get().protectedSites.filter(s => s.enabled),
      
      isDomainProtected: (domain) => {
        const sites = get().protectedSites
        const normalizedDomain = domain.toLowerCase().replace(/^www\./, '')
        
        return sites.some(site => {
          const normalizedSite = site.domain.toLowerCase().replace(/^www\./, '')
          return site.enabled && (
            normalizedDomain === normalizedSite ||
            normalizedDomain.endsWith('.' + normalizedSite)
          )
        })
      },
      
      addProtectedSite: (domain, description) => {
        const normalizedDomain = domain.toLowerCase().trim()
        
        // Check for duplicates
        if (get().protectedSites.some(s => s.domain.toLowerCase() === normalizedDomain)) {
          console.warn('[WRGuard] Site already exists:', domain)
          return
        }
        
        const newSite: ProtectedSite = {
          id: `site_${crypto.randomUUID().slice(0, 8)}`,
          domain: normalizedDomain,
          source: 'user',
          addedAt: Date.now(),
          description,
          enabled: true
        }
        
        set(state => ({
          protectedSites: [...state.protectedSites, newSite],
          lastUpdated: Date.now()
        }))
      },
      
      removeProtectedSite: (id) => {
        const site = get().protectedSites.find(s => s.id === id)
        
        // Prevent removing default sites
        if (site?.source === 'default') {
          console.warn('[WRGuard] Cannot remove default site:', site.domain)
          return
        }
        
        set(state => ({
          protectedSites: state.protectedSites.filter(s => s.id !== id),
          lastUpdated: Date.now()
        }))
      },
      
      toggleProtectedSite: (id) => {
        set(state => ({
          protectedSites: state.protectedSites.map(s =>
            s.id === id ? { ...s, enabled: !s.enabled } : s
          ),
          lastUpdated: Date.now()
        }))
      },
      
      resetProtectedSites: () => {
        set({
          protectedSites: DEFAULT_PROTECTED_SITES.map((site, index) => ({
            ...site,
            id: `default_${index}`,
            addedAt: Date.now()
          })),
          lastUpdated: Date.now()
        })
      },
      
      // =========================================================================
      // Policy Overview
      // =========================================================================
      
      getPolicyOverview: () => get().policyOverview,
      
      // =========================================================================
      // Initialization
      // =========================================================================
      
      initialize: () => {
        const state = get()
        
        if (state.initialized) return
        
        // Ensure default sites exist
        const hasDefaults = DEFAULT_PROTECTED_SITES.every(defaultSite =>
          state.protectedSites.some(s => 
            s.domain.toLowerCase() === defaultSite.domain.toLowerCase()
          )
        )
        
        if (!hasDefaults) {
          set({
            protectedSites: [
              ...state.protectedSites,
              ...DEFAULT_PROTECTED_SITES
                .filter(ds => !state.protectedSites.some(s => 
                  s.domain.toLowerCase() === ds.domain.toLowerCase()
                ))
                .map((site, index) => ({
                  ...site,
                  id: `default_${Date.now()}_${index}`,
                  addedAt: Date.now()
                }))
            ]
          })
        }
        
        set({ initialized: true })
      },
      
      reset: () => {
        set({
          ...createInitialState(),
          initialized: true
        })
      }
    }),
    {
      name: 'wrguard-config',
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
        providers: state.providers,
        protectedSites: state.protectedSites,
        policyOverview: state.policyOverview,
        initialized: state.initialized,
        lastUpdated: state.lastUpdated
      })
    }
  )
)

// =============================================================================
// Selector Hooks
// =============================================================================

export const useActiveSection = () =>
  useWRGuardStore(state => state.activeSection)

export const useEmailProviders = () =>
  useWRGuardStore(state => state.providers)

export const useConnectedProviders = () =>
  useWRGuardStore(state => state.getConnectedProviders())

export const useProtectedSites = () =>
  useWRGuardStore(state => state.protectedSites)

export const usePolicyOverview = () =>
  useWRGuardStore(state => state.policyOverview)

export const useIsWRGuardInitialized = () =>
  useWRGuardStore(state => state.initialized)
