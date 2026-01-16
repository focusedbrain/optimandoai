/**
 * BEAP™ Capsule Builder Store
 * 
 * Zustand store for the envelope-aware capsule builder.
 * Properly separates envelope (read-only) from capsule (editable).
 * 
 * CRITICAL INVARIANTS:
 * - Envelope is authoritative and read-only in the builder
 * - Capsule edits cannot expand envelope capabilities
 * - Envelope changes trigger automatic regeneration
 * 
 * @version 2.0.0
 */

import { create } from 'zustand'
import type {
  BeapEnvelope,
  BeapCapsule,
  CapsuleAttachment,
  CapsuleSessionRef,
  CapsuleBuilderContext,
  CapsuleBuilderState,
  EnvelopeState,
  CapsuleState,
  EnvelopeSummary,
  CapabilityClass,
  NetworkConstraints,
  ApplyResult,
  BuilderSource
} from './canonical-types'
import { requiresBeapBuilder, type BuilderDecisionContext } from './requiresBuilder'
import { generateMockFingerprint } from '../handshake/fingerprint'

// =============================================================================
// Envelope Generation
// =============================================================================

/**
 * Generate a new envelope with current capabilities
 */
function generateEnvelope(
  capabilities: CapabilityClass[],
  networkConstraints: NetworkConstraints,
  senderFingerprint: string,
  handshakeId: string | null
): BeapEnvelope {
  return {
    version: '1.0',
    envelopeId: `env_${crypto.randomUUID()}`,
    senderFingerprint,
    recipientFingerprint: null,
    handshakeId,
    hardwareAttestation: 'pending',
    createdAt: Date.now(),
    validUntil: null,
    nonce: crypto.randomUUID(),
    capabilities,
    networkConstraints,
    capsuleHash: null,
    signature: null
  }
}

/**
 * Generate envelope summary for UI display
 */
function generateEnvelopeSummary(
  envelope: BeapEnvelope,
  handshakeName: string | null,
  requiresRegeneration: boolean
): EnvelopeSummary {
  const fp = envelope.senderFingerprint
  const senderShort = fp.length > 12 
    ? `${fp.slice(0, 6)}...${fp.slice(-4)}`
    : fp
  
  // Generate capability summary
  const capLabels: Record<CapabilityClass, string> = {
    critical_automation: 'Automation',
    monetary: 'Monetary',
    ui_actions: 'UI Actions',
    data_access: 'Data Access',
    session_control: 'Sessions',
    network_egress: 'Egress',
    network_ingress: 'Ingress'
  }
  
  const capSummary = envelope.capabilities.length > 0
    ? envelope.capabilities.map(c => capLabels[c]).join(', ')
    : 'None declared'
  
  // Attestation status
  const attestationLabels = {
    verified: '✓ Hardware Verified',
    pending: '⏳ Attestation Pending',
    unavailable: '— Not Available'
  }
  
  return {
    senderShort,
    senderFull: envelope.senderFingerprint,
    handshakeName,
    attestationStatus: attestationLabels[envelope.hardwareAttestation],
    capabilitySummary: capSummary,
    requiresRegeneration
  }
}

// =============================================================================
// Default State
// =============================================================================

const defaultNetworkConstraints: NetworkConstraints = {
  allowedIngress: [],
  allowedEgress: [],
  offlineOnly: false
}

const defaultEnvelopeState: EnvelopeState = {
  envelope: null,
  summary: null,
  requiresRegeneration: false,
  pendingCapabilities: [],
  pendingNetworkConstraints: null
}

const defaultCapsuleState: CapsuleState = {
  text: '',
  attachments: [],
  selectedSessions: [],
  dataRequest: '',
  uploadingAttachments: [],
  errors: []
}

const initialState: CapsuleBuilderState = {
  isOpen: false,
  context: null,
  envelope: defaultEnvelopeState,
  capsule: defaultCapsuleState,
  isBuilding: false,
  validationErrors: []
}

// =============================================================================
// Store Interface
// =============================================================================

interface CapsuleBuilderStore extends CapsuleBuilderState {
  // =========================================================================
  // Lifecycle
  // =========================================================================
  
  /** Open the builder with context */
  openBuilder: (context: CapsuleBuilderContext) => void
  
  /** Close the builder (discard changes) */
  closeBuilder: () => void
  
  /** Reset to initial state */
  reset: () => void
  
  // =========================================================================
  // Capsule Editing (editable section)
  // =========================================================================
  
  /** Set message text */
  setText: (text: string) => void
  
  /** Add attachment */
  addAttachment: (attachment: CapsuleAttachment) => void
  
  /** Remove attachment */
  removeAttachment: (attachmentId: string) => void
  
  /** Update attachment (e.g., after parsing) */
  updateAttachment: (attachmentId: string, updates: Partial<CapsuleAttachment>) => void
  
  /** Set attachment upload status */
  setAttachmentUploading: (attachmentId: string, uploading: boolean) => void
  
  /** Select a session */
  selectSession: (session: CapsuleSessionRef) => void
  
  /** Deselect a session */
  deselectSession: (sessionId: string) => void
  
  /** Set data/automation request */
  setDataRequest: (request: string) => void
  
  // =========================================================================
  // Envelope Constraints (triggers regeneration)
  // =========================================================================
  
  /** Request capability addition */
  requestCapability: (capability: CapabilityClass) => void
  
  /** Remove pending capability */
  removeCapability: (capability: CapabilityClass) => void
  
  /** Set ingress constraints */
  setIngressConstraints: (sources: string[]) => void
  
  /** Set egress constraints */
  setEgressConstraints: (destinations: string[]) => void
  
  /** Set offline-only mode */
  setOfflineOnly: (offlineOnly: boolean) => void
  
  // =========================================================================
  // Actions
  // =========================================================================
  
  /** Apply changes (stores capsule, marks envelope for regeneration if needed) */
  apply: () => ApplyResult
  
  /** Check if builder is required for current content */
  checkIfBuilderRequired: () => boolean
  
  /** Regenerate envelope with pending changes */
  regenerateEnvelope: () => void
  
  // =========================================================================
  // Queries
  // =========================================================================
  
  /** Get current envelope (read-only) */
  getEnvelope: () => BeapEnvelope | null
  
  /** Get current capsule draft */
  getCapsuleDraft: () => CapsuleState
  
  /** Check if a capability is available in envelope */
  hasCapability: (capability: CapabilityClass) => boolean
  
  /** Check if session selection is allowed */
  canSelectSession: (session: CapsuleSessionRef) => boolean
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useCapsuleBuilder = create<CapsuleBuilderStore>((set, get) => ({
  ...initialState,
  
  // =========================================================================
  // Lifecycle
  // =========================================================================
  
  openBuilder: (context) => {
    // Generate fingerprint for envelope
    const senderFingerprint = generateMockFingerprint()
    const handshakeId = context.handshake?.handshake_id ?? null
    const handshakeName = context.handshake?.partner_name ?? null
    
    // Generate initial envelope with no capabilities
    const envelope = generateEnvelope(
      [],
      defaultNetworkConstraints,
      senderFingerprint,
      handshakeId
    )
    
    const summary = generateEnvelopeSummary(envelope, handshakeName, false)
    
    // Prefill capsule from context
    const capsule: CapsuleState = {
      text: context.body || '',
      attachments: [],
      selectedSessions: [],
      dataRequest: '',
      uploadingAttachments: [],
      errors: []
    }
    
    set({
      isOpen: true,
      context,
      envelope: {
        envelope,
        summary,
        requiresRegeneration: false,
        pendingCapabilities: [],
        pendingNetworkConstraints: null
      },
      capsule,
      isBuilding: false,
      validationErrors: []
    })
  },
  
  closeBuilder: () => {
    set({ isOpen: false })
  },
  
  reset: () => {
    set(initialState)
  },
  
  // =========================================================================
  // Capsule Editing
  // =========================================================================
  
  setText: (text) => {
    set(state => ({
      capsule: { ...state.capsule, text }
    }))
  },
  
  addAttachment: (attachment) => {
    set(state => {
      const newAttachments = [...state.capsule.attachments, attachment]
      
      // Check if we need critical_automation for session-related attachments
      let needsEnvelopeUpdate = false
      let pendingCaps = [...state.envelope.pendingCapabilities]
      
      if (attachment.isMedia && !state.envelope.envelope?.capabilities.includes('data_access')) {
        if (!pendingCaps.includes('data_access')) {
          pendingCaps.push('data_access')
          needsEnvelopeUpdate = true
        }
      }
      
      return {
        capsule: { ...state.capsule, attachments: newAttachments },
        envelope: needsEnvelopeUpdate ? {
          ...state.envelope,
          requiresRegeneration: true,
          pendingCapabilities: pendingCaps
        } : state.envelope
      }
    })
  },
  
  removeAttachment: (attachmentId) => {
    set(state => ({
      capsule: {
        ...state.capsule,
        attachments: state.capsule.attachments.filter(a => a.id !== attachmentId)
      }
    }))
  },
  
  updateAttachment: (attachmentId, updates) => {
    set(state => ({
      capsule: {
        ...state.capsule,
        attachments: state.capsule.attachments.map(a => 
          a.id === attachmentId ? { ...a, ...updates } : a
        )
      }
    }))
  },
  
  setAttachmentUploading: (attachmentId, uploading) => {
    set(state => ({
      capsule: {
        ...state.capsule,
        uploadingAttachments: uploading
          ? [...state.capsule.uploadingAttachments, attachmentId]
          : state.capsule.uploadingAttachments.filter(id => id !== attachmentId)
      }
    }))
  },
  
  selectSession: (session) => {
    set(state => {
      // Check if envelope supports this capability
      const envelopeCaps = state.envelope.envelope?.capabilities || []
      const pendingCaps = [...state.envelope.pendingCapabilities]
      let requiresRegeneration = state.envelope.requiresRegeneration
      
      if (!envelopeCaps.includes(session.requiredCapability)) {
        if (!pendingCaps.includes(session.requiredCapability)) {
          pendingCaps.push(session.requiredCapability)
          requiresRegeneration = true
        }
      }
      
      // Always need session_control capability
      if (!envelopeCaps.includes('session_control') && !pendingCaps.includes('session_control')) {
        pendingCaps.push('session_control')
        requiresRegeneration = true
      }
      
      return {
        capsule: {
          ...state.capsule,
          selectedSessions: [...state.capsule.selectedSessions, {
            ...session,
            envelopeSupports: envelopeCaps.includes(session.requiredCapability) || pendingCaps.includes(session.requiredCapability)
          }]
        },
        envelope: {
          ...state.envelope,
          requiresRegeneration,
          pendingCapabilities: pendingCaps
        }
      }
    })
  },
  
  deselectSession: (sessionId) => {
    set(state => ({
      capsule: {
        ...state.capsule,
        selectedSessions: state.capsule.selectedSessions.filter(s => s.sessionId !== sessionId)
      }
    }))
  },
  
  setDataRequest: (request) => {
    set(state => {
      let pendingCaps = [...state.envelope.pendingCapabilities]
      let requiresRegeneration = state.envelope.requiresRegeneration
      const envelopeCaps = state.envelope.envelope?.capabilities || []
      
      // Data request requires data_access capability
      if (request.trim().length > 0) {
        if (!envelopeCaps.includes('data_access') && !pendingCaps.includes('data_access')) {
          pendingCaps.push('data_access')
          requiresRegeneration = true
        }
      }
      
      return {
        capsule: { ...state.capsule, dataRequest: request },
        envelope: {
          ...state.envelope,
          requiresRegeneration,
          pendingCapabilities: pendingCaps
        }
      }
    })
  },
  
  // =========================================================================
  // Envelope Constraints
  // =========================================================================
  
  requestCapability: (capability) => {
    set(state => {
      const pendingCaps = [...state.envelope.pendingCapabilities]
      if (!pendingCaps.includes(capability)) {
        pendingCaps.push(capability)
      }
      return {
        envelope: {
          ...state.envelope,
          requiresRegeneration: true,
          pendingCapabilities: pendingCaps
        }
      }
    })
  },
  
  removeCapability: (capability) => {
    set(state => ({
      envelope: {
        ...state.envelope,
        pendingCapabilities: state.envelope.pendingCapabilities.filter(c => c !== capability)
      }
    }))
  },
  
  setIngressConstraints: (sources) => {
    set(state => {
      const pending = state.envelope.pendingNetworkConstraints || { ...defaultNetworkConstraints }
      return {
        envelope: {
          ...state.envelope,
          requiresRegeneration: true,
          pendingNetworkConstraints: {
            ...pending,
            allowedIngress: sources
          }
        }
      }
    })
  },
  
  setEgressConstraints: (destinations) => {
    set(state => {
      const pending = state.envelope.pendingNetworkConstraints || { ...defaultNetworkConstraints }
      return {
        envelope: {
          ...state.envelope,
          requiresRegeneration: true,
          pendingNetworkConstraints: {
            ...pending,
            allowedEgress: destinations
          }
        }
      }
    })
  },
  
  setOfflineOnly: (offlineOnly) => {
    set(state => {
      const pending = state.envelope.pendingNetworkConstraints || { ...defaultNetworkConstraints }
      return {
        envelope: {
          ...state.envelope,
          requiresRegeneration: true,
          pendingNetworkConstraints: {
            ...pending,
            offlineOnly
          }
        }
      }
    })
  },
  
  // =========================================================================
  // Actions
  // =========================================================================
  
  apply: () => {
    const state = get()
    
    try {
      // Validate capsule
      if (state.capsule.text.trim().length === 0 && state.capsule.attachments.length === 0) {
        return {
          success: false,
          capsule: null,
          envelopeRequiresRegeneration: state.envelope.requiresRegeneration,
          error: 'Message content or attachments required'
        }
      }
      
      // Build capsule object
      const capsule: BeapCapsule = {
        version: '1.0',
        capsuleId: `cap_${crypto.randomUUID()}`,
        text: state.capsule.text,
        attachments: state.capsule.attachments,
        sessionRefs: state.capsule.selectedSessions,
        dataRequest: state.capsule.dataRequest,
        createdAt: Date.now(),
        hash: null // Will be computed when envelope is finalized
      }
      
      set({ isOpen: false })
      
      return {
        success: true,
        capsule,
        envelopeRequiresRegeneration: state.envelope.requiresRegeneration,
        error: null
      }
    } catch (error) {
      return {
        success: false,
        capsule: null,
        envelopeRequiresRegeneration: state.envelope.requiresRegeneration,
        error: error instanceof Error ? error.message : 'Failed to apply'
      }
    }
  },
  
  checkIfBuilderRequired: () => {
    const state = get()
    const context: BuilderDecisionContext = {
      attachments: state.capsule.attachments,
      selectedSessions: state.capsule.selectedSessions,
      dataRequest: state.capsule.dataRequest,
      ingressConstraints: state.envelope.pendingNetworkConstraints?.allowedIngress || null,
      egressConstraints: state.envelope.pendingNetworkConstraints?.allowedEgress || null,
      userInvoked: false
    }
    return requiresBeapBuilder(context).required
  },
  
  regenerateEnvelope: () => {
    set(state => {
      if (!state.envelope.envelope) return state
      
      // Combine current and pending capabilities
      const allCapabilities = [
        ...new Set([
          ...state.envelope.envelope.capabilities,
          ...state.envelope.pendingCapabilities
        ])
      ]
      
      // Merge network constraints
      const networkConstraints: NetworkConstraints = {
        ...state.envelope.envelope.networkConstraints,
        ...(state.envelope.pendingNetworkConstraints || {})
      }
      
      // Generate new envelope
      const newEnvelope = generateEnvelope(
        allCapabilities,
        networkConstraints,
        state.envelope.envelope.senderFingerprint,
        state.envelope.envelope.handshakeId
      )
      
      const summary = generateEnvelopeSummary(
        newEnvelope,
        state.envelope.summary?.handshakeName || null,
        false
      )
      
      return {
        envelope: {
          envelope: newEnvelope,
          summary,
          requiresRegeneration: false,
          pendingCapabilities: [],
          pendingNetworkConstraints: null
        }
      }
    })
  },
  
  // =========================================================================
  // Queries
  // =========================================================================
  
  getEnvelope: () => get().envelope.envelope,
  
  getCapsuleDraft: () => get().capsule,
  
  hasCapability: (capability) => {
    const state = get()
    const envCaps = state.envelope.envelope?.capabilities || []
    const pendingCaps = state.envelope.pendingCapabilities
    return envCaps.includes(capability) || pendingCaps.includes(capability)
  },
  
  canSelectSession: (session) => {
    const state = get()
    const envCaps = state.envelope.envelope?.capabilities || []
    const pendingCaps = state.envelope.pendingCapabilities
    
    // Session can be selected if capability is present or will be added
    return (
      envCaps.includes(session.requiredCapability) ||
      pendingCaps.includes(session.requiredCapability) ||
      true // Always allow selection, but mark envelope for regeneration
    )
  }
}))

// =============================================================================
// Convenience Hooks
// =============================================================================

export const useIsBuilderOpen = () => 
  useCapsuleBuilder(state => state.isOpen)

export const useEnvelopeSummary = () => 
  useCapsuleBuilder(state => state.envelope.summary)

export const useCapsuleDraft = () => 
  useCapsuleBuilder(state => state.capsule)

export const useEnvelopeRequiresRegeneration = () => 
  useCapsuleBuilder(state => state.envelope.requiresRegeneration)

export const useBuilderValidationErrors = () => 
  useCapsuleBuilder(state => state.validationErrors)

