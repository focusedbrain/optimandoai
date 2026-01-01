/**
 * Ingress & Egress Boundary Types
 * 
 * Types for declaring execution boundaries in the BEAP envelope.
 * These are envelope-bound constraints, NOT capsule fields.
 * 
 * INVARIANTS:
 * - Egress MUST always be explicitly declared
 * - Ingress MUST always be explicitly declared
 * - Any change triggers automatic envelope regeneration
 * - No implicit defaults allowed
 * 
 * @version 1.0.0
 */

// =============================================================================
// Egress Declaration
// =============================================================================

/**
 * Egress preset options
 */
export type EgressPreset =
  | 'none'          // No external egress
  | 'local_only'    // Effects restricted to local device
  | 'allowlisted'   // Explicit destination allowlist
  | 'unrestricted'  // Advanced / discouraged

/**
 * Egress destination type tags
 */
export type EgressDestinationType = 'email' | 'api' | 'web' | 'p2p' | 'other'

/**
 * A single egress destination entry
 */
export interface EgressDestination {
  /** Unique ID for this entry */
  id: string
  
  /** Domain or origin (e.g., mail.google.com, api.stripe.com) */
  destination: string
  
  /** Optional type tag */
  type?: EgressDestinationType
  
  /** Optional description */
  description?: string
}

/**
 * Complete egress declaration
 */
export interface EgressDeclaration {
  /** Selected preset */
  preset: EgressPreset
  
  /** Allowlisted destinations (only used when preset === 'allowlisted') */
  allowlist: EgressDestination[]
  
  /** Human-readable summary */
  summary: string
}

// =============================================================================
// Ingress Declaration
// =============================================================================

/**
 * Ingress preset options
 */
export type IngressPreset =
  | 'capsule_only'     // No external input allowed
  | 'session_derived'  // Input only from selected sessions
  | 'allowlisted'      // Explicitly declared sources

/**
 * Ingress source type tags
 */
export type IngressSourceType = 'session' | 'api' | 'file' | 'user_input' | 'other'

/**
 * A single ingress source entry
 */
export interface IngressSource {
  /** Unique ID for this entry */
  id: string
  
  /** Source identifier (domain, session ID, etc.) */
  source: string
  
  /** Type tag */
  type: IngressSourceType
  
  /** Optional description */
  description?: string
}

/**
 * Complete ingress declaration
 */
export interface IngressDeclaration {
  /** Selected preset */
  preset: IngressPreset
  
  /** Allowlisted sources (only used when preset === 'allowlisted') */
  allowlist: IngressSource[]
  
  /** Session references (only used when preset === 'session_derived') */
  sessionRefs: string[]
  
  /** Human-readable summary */
  summary: string
}

// =============================================================================
// Combined Execution Boundary
// =============================================================================

/**
 * Complete execution boundary declaration
 * This feeds into envelope generation
 */
export interface ExecutionBoundary {
  /** Egress declaration */
  egress: EgressDeclaration
  
  /** Ingress declaration */
  ingress: IngressDeclaration
  
  /** Whether this is the initial/default state (must be changed) */
  isDefault: boolean
  
  /** Last modification timestamp */
  lastModified: number
}

// =============================================================================
// Envelope Summary (Read-Only Display)
// =============================================================================

/**
 * Read-only envelope summary for UI display
 */
export interface EnvelopeDisplaySummary {
  /** Short envelope hash (first 8 chars) */
  envelopeHashShort: string
  
  /** Full envelope ID */
  envelopeId: string
  
  /** Sender fingerprint (short form) */
  fingerprintShort: string
  
  /** Full fingerprint */
  fingerprintFull: string
  
  /** Handshake reference (if present) */
  handshakeRef: string | null
  
  /** Handshake name (if present) */
  handshakeName: string | null
  
  /** Ingress declaration (human-readable) */
  ingressSummary: string
  
  /** Egress declaration (human-readable) */
  egressSummary: string
  
  /** Hardware attestation status */
  attestationStatus: 'verified' | 'pending' | 'unavailable'
  
  /** Generation timestamp */
  generatedAt: number
  
  /** Whether envelope is stale (needs regeneration) */
  isStale: boolean
}

// =============================================================================
// Preset Configurations
// =============================================================================

export const EGRESS_PRESET_CONFIG: Record<EgressPreset, {
  label: string
  description: string
  icon: string
  isAdvanced: boolean
}> = {
  none: {
    label: 'No external egress',
    description: 'Capsule execution produces no outbound effects',
    icon: '🔒',
    isAdvanced: false
  },
  local_only: {
    label: 'Local only egress',
    description: 'Effects restricted to the local device/environment',
    icon: '💻',
    isAdvanced: false
  },
  allowlisted: {
    label: 'Allowlisted destinations',
    description: 'User defines explicit destinations',
    icon: '📋',
    isAdvanced: false
  },
  unrestricted: {
    label: 'Unrestricted egress',
    description: 'Advanced — Not recommended for sensitive operations',
    icon: '⚠️',
    isAdvanced: true
  }
}

export const INGRESS_PRESET_CONFIG: Record<IngressPreset, {
  label: string
  description: string
  icon: string
}> = {
  capsule_only: {
    label: 'Capsule only',
    description: 'No external input allowed during execution',
    icon: '📦'
  },
  session_derived: {
    label: 'Session derived',
    description: 'Input only from selected automation sessions',
    icon: '🔄'
  },
  allowlisted: {
    label: 'Allowlisted sources',
    description: 'Explicitly declared input sources',
    icon: '📋'
  }
}

export const EGRESS_DESTINATION_TYPES: { value: EgressDestinationType; label: string; icon: string }[] = [
  { value: 'email', label: 'Email', icon: '📧' },
  { value: 'api', label: 'API', icon: '🔌' },
  { value: 'web', label: 'Web', icon: '🌐' },
  { value: 'p2p', label: 'P2P', icon: '🔗' },
  { value: 'other', label: 'Other', icon: '📎' }
]

export const INGRESS_SOURCE_TYPES: { value: IngressSourceType; label: string; icon: string }[] = [
  { value: 'session', label: 'Session', icon: '🔄' },
  { value: 'api', label: 'API', icon: '🔌' },
  { value: 'file', label: 'File', icon: '📁' },
  { value: 'user_input', label: 'User Input', icon: '⌨️' },
  { value: 'other', label: 'Other', icon: '📎' }
]

// =============================================================================
// Helpers
// =============================================================================

/**
 * Generate human-readable egress summary
 */
export function generateEgressSummary(declaration: EgressDeclaration): string {
  switch (declaration.preset) {
    case 'none':
      return 'No external egress permitted'
    case 'local_only':
      return 'Local device only'
    case 'allowlisted':
      if (declaration.allowlist.length === 0) {
        return 'Allowlisted (no destinations defined)'
      }
      return `Allowlisted: ${declaration.allowlist.map(d => d.destination).join(', ')}`
    case 'unrestricted':
      return 'Unrestricted (advanced)'
    default:
      return 'Unknown'
  }
}

/**
 * Generate human-readable ingress summary
 */
export function generateIngressSummary(declaration: IngressDeclaration): string {
  switch (declaration.preset) {
    case 'capsule_only':
      return 'Capsule content only'
    case 'session_derived':
      if (declaration.sessionRefs.length === 0) {
        return 'Session derived (no sessions selected)'
      }
      return `Sessions: ${declaration.sessionRefs.length} selected`
    case 'allowlisted':
      if (declaration.allowlist.length === 0) {
        return 'Allowlisted (no sources defined)'
      }
      return `Allowlisted: ${declaration.allowlist.map(s => s.source).join(', ')}`
    default:
      return 'Unknown'
  }
}

/**
 * Create default execution boundary (must be explicitly changed)
 */
export function createDefaultBoundary(): ExecutionBoundary {
  return {
    egress: {
      preset: 'none',
      allowlist: [],
      summary: generateEgressSummary({ preset: 'none', allowlist: [], summary: '' })
    },
    ingress: {
      preset: 'capsule_only',
      allowlist: [],
      sessionRefs: [],
      summary: generateIngressSummary({ preset: 'capsule_only', allowlist: [], sessionRefs: [], summary: '' })
    },
    isDefault: true,
    lastModified: Date.now()
  }
}

