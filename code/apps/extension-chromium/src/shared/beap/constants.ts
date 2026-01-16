/**
 * BEAP Canonical Constants
 * 
 * Central source of truth for BEAP package format constants.
 * These constants define the canonical file formats and markers.
 * 
 * INVARIANTS:
 * - .beap files are JSON containers with cleartext envelope
 * - .qbeap files are opaque binary blobs (encrypted capsule)
 * - Only .beap files are importable as messages
 * - .qbeap is referenced from envelope but never parsed directly
 * 
 * @version 1.0.0
 */

// =============================================================================
// File Extensions
// =============================================================================

/**
 * BEAP Package container extension
 * - JSON container with cleartext envelope
 * - Importable as a message
 */
export const BEAP_PACKAGE_EXT = '.beap' as const

/**
 * Encrypted Capsule artefact extension
 * - Opaque binary blob (NOT JSON)
 * - NOT importable as standalone message
 * - Referenced by envelope via hash/size/encoding
 * - Decryption only on receiver-side, outside originating network
 */
export const BEAP_ENCRYPTED_CAPSULE_EXT = '.qbeap' as const

// =============================================================================
// Marker Keys (minimal validation)
// =============================================================================

/**
 * Minimum marker type for BEAP package identification
 * Used for quick "looks like a BEAP package" check
 */
export const BEAP_MIN_MARKER_TYPE = 'BEAP_PACKAGE' as const

/**
 * Current BEAP version string
 */
export const BEAP_VERSION_CURRENT = '1.0' as const

// =============================================================================
// Import Restrictions
// =============================================================================

/**
 * Allowed extensions for package import
 * 
 * CRITICAL: .qbeap is explicitly NOT in this list
 * .qbeap files cannot be imported as standalone messages,
 * only as referenced artefacts within a .beap package
 */
export const ALLOWED_IMPORT_EXTENSIONS = [BEAP_PACKAGE_EXT] as const

/**
 * Extensions that are never directly importable as messages
 */
export const NON_IMPORTABLE_EXTENSIONS = [BEAP_ENCRYPTED_CAPSULE_EXT] as const

// =============================================================================
// MIME Types
// =============================================================================

/**
 * MIME type for BEAP package
 */
export const BEAP_PACKAGE_MIME = 'application/x-beap+json' as const

/**
 * MIME type for encrypted capsule
 */
export const BEAP_ENCRYPTED_CAPSULE_MIME = 'application/x-beap+encrypted' as const


