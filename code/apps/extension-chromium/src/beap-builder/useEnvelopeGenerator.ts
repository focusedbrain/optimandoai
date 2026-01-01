/**
 * Envelope Generator Store
 * 
 * Zustand store for automatic envelope generation based on execution boundary declarations.
 * 
 * INVARIANTS:
 * - Envelope regenerates automatically on ANY ingress/egress change
 * - No manual confirmation required
 * - Envelope is always deterministically generated
 * - User cannot edit envelope directly, only declare boundaries
 * 
 * @version 1.0.0
 */

import { create } from 'zustand'
import type {
  ExecutionBoundary,
  EgressPreset,
  EgressDestination,
  IngressPreset,
  IngressSource,
  EnvelopeDisplaySummary,
  EgressDeclaration,
  IngressDeclaration
} from './boundary-types'
import {
  createDefaultBoundary,
  generateEgressSummary,
  generateIngressSummary
} from './boundary-types'
import type { BeapEnvelope, CapabilityClass, NetworkConstraints } from './canonical-types'
import { generateMockFingerprint } from '../handshake/fingerprint'

// =============================================================================
// Store Interface
// =============================================================================

interface EnvelopeGeneratorState {
  /** Current execution boundary declaration */
  boundary: ExecutionBoundary
  
  /** Current generated envelope */
  envelope: BeapEnvelope | null
  
  /** Envelope display summary */
  summary: EnvelopeDisplaySummary | null
  
  /** Generation count (for tracking) */
  generationCount: number
  
  /** Is regeneration in progress */
  isRegenerating: boolean
  
  /** Handshake ID (if linked) */
  handshakeId: string | null
  
  /** Handshake name (if linked) */
  handshakeName: string | null
  
  // =========================================================================
  // Egress Actions
  // =========================================================================
  
  /** Set egress preset (triggers regeneration) */
  setEgressPreset: (preset: EgressPreset) => void
  
  /** Add egress destination (triggers regeneration) */
  addEgressDestination: (destination: Omit<EgressDestination, 'id'>) => void
  
  /** Remove egress destination (triggers regeneration) */
  removeEgressDestination: (id: string) => void
  
  /** Update egress destination (triggers regeneration) */
  updateEgressDestination: (id: string, updates: Partial<EgressDestination>) => void
  
  // =========================================================================
  // Ingress Actions
  // =========================================================================
  
  /** Set ingress preset (triggers regeneration) */
  setIngressPreset: (preset: IngressPreset) => void
  
  /** Add ingress source (triggers regeneration) */
  addIngressSource: (source: Omit<IngressSource, 'id'>) => void
  
  /** Remove ingress source (triggers regeneration) */
  removeIngressSource: (id: string) => void
  
  /** Set session references (triggers regeneration) */
  setSessionRefs: (sessionIds: string[]) => void
  
  // =========================================================================
  // Handshake
  // =========================================================================
  
  /** Set handshake reference */
  setHandshake: (id: string | null, name: string | null) => void
  
  // =========================================================================
  // Core Actions
  // =========================================================================
  
  /** Force envelope regeneration */
  regenerateEnvelope: () => void
  
  /** Reset to default boundary */
  reset: () => void
  
  /** Get current envelope for sending */
  getEnvelope: () => BeapEnvelope | null
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useEnvelopeGenerator = create<EnvelopeGeneratorState>((set, get) => ({
  boundary: createDefaultBoundary(),
  envelope: null,
  summary: null,
  generationCount: 0,
  isRegenerating: false,
  handshakeId: null,
  handshakeName: null,
  
  // =========================================================================
  // Egress Actions
  // =========================================================================
  
  setEgressPreset: (preset) => {
    set(state => {
      const newEgress: EgressDeclaration = {
        ...state.boundary.egress,
        preset,
        summary: generateEgressSummary({ ...state.boundary.egress, preset })
      }
      
      return {
        boundary: {
          ...state.boundary,
          egress: newEgress,
          isDefault: false,
          lastModified: Date.now()
        }
      }
    })
    
    // Trigger regeneration
    get().regenerateEnvelope()
  },
  
  addEgressDestination: (destination) => {
    set(state => {
      const newDestination: EgressDestination = {
        ...destination,
        id: `egress_${crypto.randomUUID().slice(0, 8)}`
      }
      
      const newAllowlist = [...state.boundary.egress.allowlist, newDestination]
      const newEgress: EgressDeclaration = {
        ...state.boundary.egress,
        allowlist: newAllowlist,
        summary: generateEgressSummary({ ...state.boundary.egress, allowlist: newAllowlist })
      }
      
      return {
        boundary: {
          ...state.boundary,
          egress: newEgress,
          isDefault: false,
          lastModified: Date.now()
        }
      }
    })
    
    get().regenerateEnvelope()
  },
  
  removeEgressDestination: (id) => {
    set(state => {
      const newAllowlist = state.boundary.egress.allowlist.filter(d => d.id !== id)
      const newEgress: EgressDeclaration = {
        ...state.boundary.egress,
        allowlist: newAllowlist,
        summary: generateEgressSummary({ ...state.boundary.egress, allowlist: newAllowlist })
      }
      
      return {
        boundary: {
          ...state.boundary,
          egress: newEgress,
          lastModified: Date.now()
        }
      }
    })
    
    get().regenerateEnvelope()
  },
  
  updateEgressDestination: (id, updates) => {
    set(state => {
      const newAllowlist = state.boundary.egress.allowlist.map(d =>
        d.id === id ? { ...d, ...updates } : d
      )
      const newEgress: EgressDeclaration = {
        ...state.boundary.egress,
        allowlist: newAllowlist,
        summary: generateEgressSummary({ ...state.boundary.egress, allowlist: newAllowlist })
      }
      
      return {
        boundary: {
          ...state.boundary,
          egress: newEgress,
          lastModified: Date.now()
        }
      }
    })
    
    get().regenerateEnvelope()
  },
  
  // =========================================================================
  // Ingress Actions
  // =========================================================================
  
  setIngressPreset: (preset) => {
    set(state => {
      const newIngress: IngressDeclaration = {
        ...state.boundary.ingress,
        preset,
        summary: generateIngressSummary({ ...state.boundary.ingress, preset })
      }
      
      return {
        boundary: {
          ...state.boundary,
          ingress: newIngress,
          isDefault: false,
          lastModified: Date.now()
        }
      }
    })
    
    get().regenerateEnvelope()
  },
  
  addIngressSource: (source) => {
    set(state => {
      const newSource: IngressSource = {
        ...source,
        id: `ingress_${crypto.randomUUID().slice(0, 8)}`
      }
      
      const newAllowlist = [...state.boundary.ingress.allowlist, newSource]
      const newIngress: IngressDeclaration = {
        ...state.boundary.ingress,
        allowlist: newAllowlist,
        summary: generateIngressSummary({ ...state.boundary.ingress, allowlist: newAllowlist })
      }
      
      return {
        boundary: {
          ...state.boundary,
          ingress: newIngress,
          isDefault: false,
          lastModified: Date.now()
        }
      }
    })
    
    get().regenerateEnvelope()
  },
  
  removeIngressSource: (id) => {
    set(state => {
      const newAllowlist = state.boundary.ingress.allowlist.filter(s => s.id !== id)
      const newIngress: IngressDeclaration = {
        ...state.boundary.ingress,
        allowlist: newAllowlist,
        summary: generateIngressSummary({ ...state.boundary.ingress, allowlist: newAllowlist })
      }
      
      return {
        boundary: {
          ...state.boundary,
          ingress: newIngress,
          lastModified: Date.now()
        }
      }
    })
    
    get().regenerateEnvelope()
  },
  
  setSessionRefs: (sessionIds) => {
    set(state => {
      const newIngress: IngressDeclaration = {
        ...state.boundary.ingress,
        sessionRefs: sessionIds,
        summary: generateIngressSummary({ ...state.boundary.ingress, sessionRefs: sessionIds })
      }
      
      return {
        boundary: {
          ...state.boundary,
          ingress: newIngress,
          isDefault: false,
          lastModified: Date.now()
        }
      }
    })
    
    get().regenerateEnvelope()
  },
  
  // =========================================================================
  // Handshake
  // =========================================================================
  
  setHandshake: (id, name) => {
    set({ handshakeId: id, handshakeName: name })
    get().regenerateEnvelope()
  },
  
  // =========================================================================
  // Core Actions
  // =========================================================================
  
  regenerateEnvelope: () => {
    set({ isRegenerating: true })
    
    const state = get()
    const { boundary, handshakeId, handshakeName, generationCount } = state
    
    // Generate deterministic envelope
    const envelope = generateEnvelopeFromBoundary(boundary, handshakeId)
    
    // Generate display summary
    const summary = generateDisplaySummary(envelope, boundary, handshakeName)
    
    set({
      envelope,
      summary,
      generationCount: generationCount + 1,
      isRegenerating: false
    })
    
    console.log('[EnvelopeGenerator] Regenerated envelope:', envelope.envelopeId.slice(0, 16))
  },
  
  reset: () => {
    set({
      boundary: createDefaultBoundary(),
      envelope: null,
      summary: null,
      generationCount: 0,
      handshakeId: null,
      handshakeName: null
    })
  },
  
  getEnvelope: () => {
    return get().envelope
  }
}))

// =============================================================================
// Envelope Generation Logic
// =============================================================================

/**
 * Generate a BeapEnvelope from execution boundary declaration
 */
function generateEnvelopeFromBoundary(
  boundary: ExecutionBoundary,
  handshakeId: string | null
): BeapEnvelope {
  const senderFingerprint = generateMockFingerprint()
  const now = Date.now()
  
  // Derive capabilities from boundary
  const capabilities: CapabilityClass[] = []
  
  // Egress implies network_egress capability
  if (boundary.egress.preset !== 'none') {
    capabilities.push('network_egress')
  }
  
  // Ingress may imply network_ingress
  if (boundary.ingress.preset === 'allowlisted') {
    capabilities.push('network_ingress')
  }
  
  // Session derived implies session_control
  if (boundary.ingress.preset === 'session_derived' && boundary.ingress.sessionRefs.length > 0) {
    capabilities.push('session_control')
  }
  
  // Build network constraints from boundary
  const networkConstraints: NetworkConstraints = {
    allowedIngress: boundary.ingress.preset === 'allowlisted'
      ? boundary.ingress.allowlist.map(s => s.source)
      : boundary.ingress.preset === 'session_derived'
        ? boundary.ingress.sessionRefs
        : [],
    allowedEgress: boundary.egress.preset === 'allowlisted'
      ? boundary.egress.allowlist.map(d => d.destination)
      : boundary.egress.preset === 'local_only'
        ? ['localhost', '127.0.0.1']
        : boundary.egress.preset === 'unrestricted'
          ? ['*']
          : [],
    offlineOnly: boundary.egress.preset === 'none'
  }
  
  // Generate envelope ID deterministically from content
  const envelopeContent = JSON.stringify({
    boundary,
    handshakeId,
    timestamp: now
  })
  const envelopeId = `env_${simpleHash(envelopeContent)}`
  
  return {
    version: '1.0',
    envelopeId,
    senderFingerprint,
    recipientFingerprint: null,
    handshakeId,
    hardwareAttestation: 'pending',
    createdAt: now,
    validUntil: now + (7 * 24 * 60 * 60 * 1000), // 7 days
    nonce: crypto.randomUUID(),
    capabilities,
    networkConstraints,
    capsuleHash: null,
    signature: null
  }
}

/**
 * Generate display summary from envelope and boundary
 */
function generateDisplaySummary(
  envelope: BeapEnvelope,
  boundary: ExecutionBoundary,
  handshakeName: string | null
): EnvelopeDisplaySummary {
  return {
    envelopeHashShort: envelope.envelopeId.slice(4, 12).toUpperCase(),
    envelopeId: envelope.envelopeId,
    fingerprintShort: `${envelope.senderFingerprint.slice(0, 4)}…${envelope.senderFingerprint.slice(-4)}`,
    fingerprintFull: envelope.senderFingerprint,
    handshakeRef: envelope.handshakeId,
    handshakeName,
    ingressSummary: boundary.ingress.summary,
    egressSummary: boundary.egress.summary,
    attestationStatus: envelope.hardwareAttestation,
    generatedAt: envelope.createdAt,
    isStale: false
  }
}

/**
 * Simple hash function for deterministic ID generation
 */
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  
  // Convert to hex and pad
  const hex = Math.abs(hash).toString(16).toUpperCase()
  return hex.padStart(16, '0')
}

// =============================================================================
// Selector Hooks
// =============================================================================

export const useExecutionBoundary = () =>
  useEnvelopeGenerator(state => state.boundary)

export const useEnvelopeDisplaySummary = () =>
  useEnvelopeGenerator(state => state.summary)

export const useIsEnvelopeRegenerating = () =>
  useEnvelopeGenerator(state => state.isRegenerating)

export const useEgressDeclaration = () =>
  useEnvelopeGenerator(state => state.boundary.egress)

export const useIngressDeclaration = () =>
  useEnvelopeGenerator(state => state.boundary.ingress)

export const useGenerationCount = () =>
  useEnvelopeGenerator(state => state.generationCount)

