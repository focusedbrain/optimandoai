/**
 * BEAP Package Registry Store
 * 
 * Zustand store implementing the canonical package registry with:
 * - Uniqueness enforcement at store level
 * - Append-only ingress event log
 * - Auto-registration logic with handshake/consent gating
 * 
 * INVARIANTS:
 * - No duplicate package_id allowed
 * - IngressEvents accumulate without changing package_id
 * - Auto-register only with trusted handshake + Full-Auto policy
 * 
 * @version 1.0.0
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  BeapPackage,
  IngressEvent,
  PackageStatus,
  IngressChannel,
  AutoRegisterPolicy,
  AutoRegisterCheckResult,
  PackageRegistrationRequest,
  PackageRegistrationResult
} from './types'

// =============================================================================
// Helper: Generate IDs
// =============================================================================

function generateEventId(): string {
  return `evt_${crypto.randomUUID()}`
}

// =============================================================================
// Store Interface
// =============================================================================

interface PackageRegistryState {
  // =========================================================================
  // State
  // =========================================================================
  
  /**
   * Canonical package registry
   * Key: package_id, Value: BeapPackage
   */
  packages: Record<string, BeapPackage>
  
  /**
   * Append-only ingress event log
   * Ordered by timestamp (newest first for display)
   */
  events: IngressEvent[]
  
  /**
   * Pending registrations awaiting user consent
   */
  pendingConsent: PackageRegistrationRequest[]
  
  /**
   * Loading state
   */
  isLoading: boolean
  
  /**
   * Last sync timestamp
   */
  lastSync: number | null
  
  // =========================================================================
  // Queries
  // =========================================================================
  
  /**
   * Get package by ID
   */
  getPackage: (packageId: string) => BeapPackage | null
  
  /**
   * Check if package exists
   */
  hasPackage: (packageId: string) => boolean
  
  /**
   * Get packages by status
   */
  getPackagesByStatus: (status: PackageStatus) => BeapPackage[]
  
  /**
   * Get packages for a specific BEAP section
   */
  getPackagesForSection: (section: 'inbox' | 'drafts' | 'outbox' | 'archive' | 'rejected') => BeapPackage[]
  
  /**
   * Get events for a package
   */
  getEventsForPackage: (packageId: string) => IngressEvent[]
  
  /**
   * Get all events for a channel
   */
  getEventsByChannel: (channel: IngressChannel) => IngressEvent[]
  
  // =========================================================================
  // Actions
  // =========================================================================
  
  /**
   * Register a package from channel import
   * Enforces uniqueness: if package_id exists, links event only
   */
  registerPackage: (
    request: PackageRegistrationRequest,
    autoRegisterCheck: AutoRegisterCheckResult
  ) => PackageRegistrationResult
  
  /**
   * Update package status
   */
  updatePackageStatus: (packageId: string, status: PackageStatus, reason?: string) => boolean
  
  /**
   * Accept a pending package (user consent)
   */
  acceptPendingPackage: (packageId: string) => PackageRegistrationResult
  
  /**
   * Reject a pending package
   */
  rejectPendingPackage: (packageId: string, reason: string) => boolean
  
  /**
   * Create a draft package (outgoing)
   */
  createDraft: (draft: Omit<BeapPackage, 'package_id' | 'created_at' | 'updated_at' | 'status' | 'direction' | 'auto_registered'>) => BeapPackage
  
  /**
   * Move draft to outbox
   */
  sendDraft: (packageId: string) => boolean
  
  /**
   * Mark package as executed
   */
  markExecuted: (packageId: string) => boolean
  
  /**
   * Add pending consent request
   */
  addPendingConsent: (request: PackageRegistrationRequest) => void
  
  /**
   * Remove pending consent request
   */
  removePendingConsent: (packageId: string) => void
  
  /**
   * Clear all data (for testing/reset)
   */
  reset: () => void
  
  /**
   * Set loading state
   */
  setLoading: (loading: boolean) => void
}

// =============================================================================
// Section to Status Mapping
// =============================================================================

const SECTION_STATUSES: Record<string, PackageStatus[]> = {
  inbox: ['pending', 'registered'],
  drafts: ['draft'],
  outbox: ['outbox'],
  archive: ['executed'],
  rejected: ['rejected']
}

// =============================================================================
// Store Implementation
// =============================================================================

export const usePackageStore = create<PackageRegistryState>()(
  persist(
    (set, get) => ({
      // Initial state
      packages: {},
      events: [],
      pendingConsent: [],
      isLoading: false,
      lastSync: null,

      // =========================================================================
      // Queries
      // =========================================================================

      getPackage: (packageId) => {
        return get().packages[packageId] || null
      },

      hasPackage: (packageId) => {
        return packageId in get().packages
      },

      getPackagesByStatus: (status) => {
        return Object.values(get().packages).filter(p => p.status === status)
      },

      getPackagesForSection: (section) => {
        const statuses = SECTION_STATUSES[section] || []
        return Object.values(get().packages)
          .filter(p => statuses.includes(p.status))
          .sort((a, b) => b.updated_at - a.updated_at) // Newest first
      },

      getEventsForPackage: (packageId) => {
        return get().events.filter(e => e.package_id === packageId)
      },

      getEventsByChannel: (channel) => {
        return get().events.filter(e => e.channel === channel)
      },

      // =========================================================================
      // Actions
      // =========================================================================

      registerPackage: (request, autoRegisterCheck) => {
        const state = get()
        const now = Date.now()
        
        // Check if package already exists (deduplication)
        const existingPackage = state.packages[request.package_id]
        
        if (existingPackage) {
          // Package exists - just create new ingress event
          const event: IngressEvent = {
            event_id: generateEventId(),
            package_id: request.package_id,
            channel: request.channel,
            site: request.site,
            timestamp: now,
            raw_ref: request.raw_ref,
            channel_message_id: request.channel_message_id,
            channel_metadata: null
          }
          
          set((s) => ({
            events: [event, ...s.events],
            lastSync: now
          }))
          
          return {
            success: true,
            package: existingPackage,
            event,
            was_new: false,
            auto_registered: existingPackage.auto_registered,
            error: null,
            requires_consent: false
          }
        }
        
        // New package - check auto-registration rules
        if (!autoRegisterCheck.allowed) {
          // Requires user consent - add to pending
          get().addPendingConsent(request)
          
          return {
            success: false,
            package: null,
            event: null,
            was_new: true,
            auto_registered: false,
            error: null,
            requires_consent: true
          }
        }
        
        // Auto-registration allowed - create package and event
        const newPackage: BeapPackage = {
          package_id: request.package_id,
          status: 'registered',
          capsule_ref: request.capsule_ref,
          envelope_ref: null, // Could be derived from envelope_data
          handshake_id: autoRegisterCheck.handshake_id,
          sender_fingerprint: request.envelope_data.sender_fingerprint,
          sender_name: null, // Will be populated from handshake lookup
          subject: request.subject,
          preview: request.preview,
          auto_registered: true,
          created_at: now,
          updated_at: now,
          executed_at: null,
          rejected_at: null,
          rejected_reason: null,
          policy_id: null,
          attachments_count: 0,
          direction: 'incoming'
        }
        
        const event: IngressEvent = {
          event_id: generateEventId(),
          package_id: request.package_id,
          channel: request.channel,
          site: request.site,
          timestamp: now,
          raw_ref: request.raw_ref,
          channel_message_id: request.channel_message_id,
          channel_metadata: null
        }
        
        set((s) => ({
          packages: { ...s.packages, [newPackage.package_id]: newPackage },
          events: [event, ...s.events],
          lastSync: now
        }))
        
        return {
          success: true,
          package: newPackage,
          event,
          was_new: true,
          auto_registered: true,
          error: null,
          requires_consent: false
        }
      },

      updatePackageStatus: (packageId, status, reason) => {
        const state = get()
        const pkg = state.packages[packageId]
        if (!pkg) return false
        
        const now = Date.now()
        const updates: Partial<BeapPackage> = {
          status,
          updated_at: now
        }
        
        if (status === 'executed') {
          updates.executed_at = now
        } else if (status === 'rejected') {
          updates.rejected_at = now
          updates.rejected_reason = reason || null
        }
        
        set((s) => ({
          packages: {
            ...s.packages,
            [packageId]: { ...pkg, ...updates }
          },
          lastSync: now
        }))
        
        return true
      },

      acceptPendingPackage: (packageId) => {
        const state = get()
        const request = state.pendingConsent.find(r => r.package_id === packageId)
        
        if (!request) {
          return {
            success: false,
            package: null,
            event: null,
            was_new: false,
            auto_registered: false,
            error: 'Pending request not found',
            requires_consent: false
          }
        }
        
        const now = Date.now()
        
        // Create package with user consent (not auto-registered)
        const newPackage: BeapPackage = {
          package_id: request.package_id,
          status: 'registered',
          capsule_ref: request.capsule_ref,
          envelope_ref: null,
          handshake_id: null, // Will be populated if sender matches handshake
          sender_fingerprint: request.envelope_data.sender_fingerprint,
          sender_name: null,
          subject: request.subject,
          preview: request.preview,
          auto_registered: false, // User consented
          created_at: now,
          updated_at: now,
          executed_at: null,
          rejected_at: null,
          rejected_reason: null,
          policy_id: null,
          attachments_count: 0,
          direction: 'incoming'
        }
        
        const event: IngressEvent = {
          event_id: generateEventId(),
          package_id: request.package_id,
          channel: request.channel,
          site: request.site,
          timestamp: now,
          raw_ref: request.raw_ref,
          channel_message_id: request.channel_message_id,
          channel_metadata: null
        }
        
        set((s) => ({
          packages: { ...s.packages, [newPackage.package_id]: newPackage },
          events: [event, ...s.events],
          pendingConsent: s.pendingConsent.filter(r => r.package_id !== packageId),
          lastSync: now
        }))
        
        return {
          success: true,
          package: newPackage,
          event,
          was_new: true,
          auto_registered: false,
          error: null,
          requires_consent: false
        }
      },

      rejectPendingPackage: (packageId, reason) => {
        const state = get()
        const request = state.pendingConsent.find(r => r.package_id === packageId)
        
        if (!request) return false
        
        const now = Date.now()
        
        // Create rejected package entry for audit
        const rejectedPackage: BeapPackage = {
          package_id: request.package_id,
          status: 'rejected',
          capsule_ref: request.capsule_ref,
          envelope_ref: null,
          handshake_id: null,
          sender_fingerprint: request.envelope_data.sender_fingerprint,
          sender_name: null,
          subject: request.subject,
          preview: request.preview,
          auto_registered: false,
          created_at: now,
          updated_at: now,
          executed_at: null,
          rejected_at: now,
          rejected_reason: reason,
          policy_id: null,
          attachments_count: 0,
          direction: 'incoming'
        }
        
        set((s) => ({
          packages: { ...s.packages, [rejectedPackage.package_id]: rejectedPackage },
          pendingConsent: s.pendingConsent.filter(r => r.package_id !== packageId),
          lastSync: now
        }))
        
        return true
      },

      createDraft: (draft) => {
        const now = Date.now()
        const packageId = `beap_draft_${crypto.randomUUID()}`
        
        const newPackage: BeapPackage = {
          ...draft,
          package_id: packageId,
          status: 'draft',
          direction: 'outgoing',
          auto_registered: false,
          created_at: now,
          updated_at: now
        }
        
        set((s) => ({
          packages: { ...s.packages, [packageId]: newPackage },
          lastSync: now
        }))
        
        return newPackage
      },

      sendDraft: (packageId) => {
        return get().updatePackageStatus(packageId, 'outbox')
      },

      markExecuted: (packageId) => {
        return get().updatePackageStatus(packageId, 'executed')
      },

      addPendingConsent: (request) => {
        set((s) => {
          // Don't add duplicates
          if (s.pendingConsent.some(r => r.package_id === request.package_id)) {
            return s
          }
          return {
            pendingConsent: [...s.pendingConsent, request],
            lastSync: Date.now()
          }
        })
      },

      removePendingConsent: (packageId) => {
        set((s) => ({
          pendingConsent: s.pendingConsent.filter(r => r.package_id !== packageId),
          lastSync: Date.now()
        }))
      },

      reset: () => {
        set({
          packages: {},
          events: [],
          pendingConsent: [],
          isLoading: false,
          lastSync: null
        })
      },

      setLoading: (loading) => {
        set({ isLoading: loading })
      }
    }),
    {
      name: 'beap-package-registry',
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
        packages: state.packages,
        events: state.events,
        pendingConsent: state.pendingConsent,
        lastSync: state.lastSync
      })
    }
  )
)

// =============================================================================
// Selector Hooks
// =============================================================================

/**
 * Select packages for inbox section
 */
export const useInboxPackages = () => 
  usePackageStore(state => state.getPackagesForSection('inbox'))

/**
 * Select packages for drafts section
 */
export const useDraftPackages = () => 
  usePackageStore(state => state.getPackagesForSection('drafts'))

/**
 * Select packages for outbox section
 */
export const useOutboxPackages = () => 
  usePackageStore(state => state.getPackagesForSection('outbox'))

/**
 * Select packages for archive section
 */
export const useArchivePackages = () => 
  usePackageStore(state => state.getPackagesForSection('archive'))

/**
 * Select packages for rejected section
 */
export const useRejectedPackages = () => 
  usePackageStore(state => state.getPackagesForSection('rejected'))

/**
 * Select pending consent requests
 */
export const usePendingConsent = () => 
  usePackageStore(state => state.pendingConsent)

/**
 * Get package count by section
 */
export const usePackageCounts = () => 
  usePackageStore(state => ({
    inbox: state.getPackagesForSection('inbox').length,
    drafts: state.getPackagesForSection('drafts').length,
    outbox: state.getPackagesForSection('outbox').length,
    archive: state.getPackagesForSection('archive').length,
    rejected: state.getPackagesForSection('rejected').length,
    pending: state.pendingConsent.length
  }))

