/**
 * BEAP Canonical Types
 * 
 * Central type definitions for BEAP package lifecycle.
 * These types are distinct from existing PackageStatus/IngressChannel types
 * and represent the canonical BEAP mental model.
 * 
 * INVARIANTS:
 * - VerificationState is about envelope verification, not package lifecycle
 * - Folder represents workspace sections for packages
 * - Source represents ingress origin (where package came from)
 * - ReconstructionState tracks artefact reconstruction AFTER acceptance
 * 
 * @version 1.0.0
 */

// =============================================================================
// Verification State
// =============================================================================

/**
 * Envelope verification outcome
 * 
 * This is DISTINCT from PackageStatus:
 * - VerificationState = envelope cryptographic verification result
 * - PackageStatus = package lifecycle stage
 * 
 * Flow:
 * 1. Package arrives → verificationState = 'pending_verification'
 * 2. Envelope verification runs (stub crypto for now)
 * 3. Result → 'accepted' or 'rejected'
 * 
 * CRITICAL: No parsing/rendering/decryption before 'accepted'
 */
export type VerificationState = 
  | 'pending_verification'  // Awaiting envelope verification
  | 'accepted'              // Envelope verified, package can be processed
  | 'rejected'              // Envelope verification failed

// =============================================================================
// Folder
// =============================================================================

/**
 * Workspace folder for packages
 * 
 * Maps to UI sections in BEAP Packages view
 */
export type Folder = 
  | 'inbox'     // Incoming packages (pending + registered)
  | 'outbox'    // Outgoing packages queued for delivery
  | 'archived'  // Successfully executed packages
  | 'rejected'  // Rejected/quarantined packages
  | 'drafts'    // Outgoing packages being composed

// =============================================================================
// Source
// =============================================================================

/**
 * Origin channel for package ingress
 * 
 * Simplified from IngressChannel for canonical use.
 * Used in envelope declaration.
 */
export type Source = 
  | 'email'      // Email bridge (Gmail, Outlook, etc.)
  | 'messenger'  // Web messenger (WhatsApp, Signal, Telegram, etc.)
  | 'download'   // File download / manual import
  | 'chat'       // WR Chat inline capsule

// =============================================================================
// Delivery Method
// =============================================================================

/**
 * Egress delivery method
 * 
 * How a package is dispatched externally.
 * Note: WR Chat uses silent mode (no external delivery)
 */
export type DeliveryMethod = 
  | 'email'      // Email attachment
  | 'messenger'  // Messenger link/paste
  | 'download'   // File download (USB, wallet, offline)

// =============================================================================
// Reconstruction State
// =============================================================================

/**
 * Artefact reconstruction state
 * 
 * Tracks processing of artefacts AFTER acceptance.
 * Reconstruction includes:
 * - Tika text extraction from documents
 * - PDFium rasterization to images
 * - OCR text extraction from images
 * 
 * CRITICAL: Reconstruction is ONLY permitted after:
 * - verificationState === 'accepted'
 * - Policy allows reconstruction
 */
export type ReconstructionState = 
  | 'none'     // No reconstruction performed or needed
  | 'running'  // Reconstruction in progress
  | 'done'     // Reconstruction complete
  | 'failed'   // Reconstruction failed

// =============================================================================
// Import Kind
// =============================================================================

/**
 * Result of file extension detection for import
 */
export type ImportKind = 
  | 'beap_package'       // .beap file - importable as message
  | 'encrypted_capsule'  // .qbeap file - NOT importable as message
  | 'unknown'            // Unknown extension

// =============================================================================
// Envelope Reference (minimal)
// =============================================================================

/**
 * Minimal envelope structure for marker validation
 * 
 * This is NOT the full envelope schema, just the minimum
 * required for "looks like a BEAP package" check.
 */
export interface MinimalEnvelopeMarker {
  /** BEAP version string */
  beapVersion: string
  
  /** Package type marker */
  type: string
  
  /** Envelope object (any structure) */
  envelope: Record<string, unknown>
}

// =============================================================================
// Package Container (minimal)
// =============================================================================

/**
 * Minimal BEAP package structure for validation
 */
export interface BeapPackageMarker extends MinimalEnvelopeMarker {
  type: 'BEAP_PACKAGE'
}


