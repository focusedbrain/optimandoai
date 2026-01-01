/**
 * BEAP Canonical Module
 * 
 * Central source of truth for BEAP constants, types, and validators.
 * 
 * This module establishes the canonical mental model for BEAP packages:
 * 
 * MENTAL MODEL:
 * - A BEAP "message" is always a BEAP Package: Envelope + Capsule (+ artefacts)
 * - The Envelope is NEVER encrypted (verification + policy binding before decryption)
 * - Policies/constraints live in the Envelope (envelope-bound)
 * - Capsule contains payload semantics but cannot expand envelope capabilities
 * - Import/Ingress is fail-closed: no parsing/rendering/decryption before verification
 * 
 * FILE FORMATS:
 * - .beap  = Package container (JSON, envelope in cleartext)
 * - .qbeap = Encrypted capsule (opaque binary, NOT JSON)
 * 
 * LIFECYCLE:
 * 1. Import: creates Inbox item with verificationState='pending_verification', stores rawRef
 * 2. Verification: uses Envelope only (stub crypto for now)
 * 3. After accepted: Tika may extract text, PDFium may rasterize
 * 4. Outbox: send creates Outbox entry first, then dispatch
 * 
 * @module shared/beap
 * @version 1.0.0
 */

// =============================================================================
// Constants
// =============================================================================

export {
  // File extensions
  BEAP_PACKAGE_EXT,
  BEAP_ENCRYPTED_CAPSULE_EXT,
  
  // Marker keys
  BEAP_MIN_MARKER_TYPE,
  BEAP_VERSION_CURRENT,
  
  // Import restrictions
  ALLOWED_IMPORT_EXTENSIONS,
  NON_IMPORTABLE_EXTENSIONS,
  
  // MIME types
  BEAP_PACKAGE_MIME,
  BEAP_ENCRYPTED_CAPSULE_MIME,
} from './constants'

// =============================================================================
// Types
// =============================================================================

export type {
  // Verification
  VerificationState,
  
  // Folders
  Folder,
  
  // Ingress/Egress
  Source,
  DeliveryMethod,
  
  // Reconstruction
  ReconstructionState,
  
  // Import
  ImportKind,
  
  // Minimal structures
  MinimalEnvelopeMarker,
  BeapPackageMarker,
} from './types'

// =============================================================================
// Validators
// =============================================================================

export {
  // Marker validation
  isBeapPackageJson,
  
  // Import detection
  detectImportKind,
  isImportableAsMessage,
  isEncryptedCapsule,
  
  // Guardrails
  assertNoPrematureProcessing,
  documentCapsuleOpacityInvariant,
} from './validators'


