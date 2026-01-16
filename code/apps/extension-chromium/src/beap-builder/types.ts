/**
 * BEAP Builder Types
 * 
 * Unified BEAP Builder module that handles both Silent and Explicit modes.
 * 
 * DESIGN PRINCIPLES:
 * - Single implementation shared across WR Chat and Drafts
 * - Context-aware: prefills target, session, handshake based on context
 * - Silent Mode: auto-builds capsule without UI interruption
 * - Explicit Mode: opens builder UI for complex configurations
 * 
 * @version 1.0.0
 */

import type { CanonicalPolicy } from '../policy/schema/types'
import type { Handshake } from '../handshake/types'

// =============================================================================
// Builder Mode
// =============================================================================

/**
 * Silent Mode: Auto-build without UI interruption
 * Explicit Mode: Opens builder UI for configuration
 */
export type BuilderMode = 'silent' | 'explicit'

// =============================================================================
// Builder Context
// =============================================================================

/**
 * Context passed to the BEAP Builder
 * Used to prefill fields and determine mode
 */
export interface BuilderContext {
  /** Where the builder was invoked from */
  source: 'wr-chat' | 'drafts' | 'inbox' | 'content-script'
  
  /** Target recipient (email/identifier) - prefilled if available */
  target?: string
  
  /** Associated session ID (if in automation context) */
  sessionId?: string
  
  /** Preselected handshake (if sender/recipient has one) */
  handshake?: Handshake | null
  
  /** Reply-to package ID (if replying) */
  replyToPackageId?: string
  
  /** Subject line - prefilled if available */
  subject?: string
  
  /** Body content - prefilled if available */
  body?: string
  
  /** Initial attachments */
  attachments?: BuilderAttachment[]
}

// =============================================================================
// Builder Attachments
// =============================================================================

export interface BuilderAttachment {
  /** Unique ID */
  id: string
  
  /** File name */
  name: string
  
  /** MIME type */
  type: string
  
  /** Size in bytes */
  size: number
  
  /** Data reference (base64, blob URL, or storage key) */
  dataRef: string
  
  /** Whether this contains automation/session data */
  containsAutomation?: boolean
  
  /** Whether this is a media file (image/video/audio) */
  isMedia?: boolean
}

// =============================================================================
// Mode Trigger Analysis
// =============================================================================

/**
 * Result of analyzing content to determine builder mode
 */
export interface ModeTriggerResult {
  /** Determined mode */
  mode: BuilderMode
  
  /** Reasons why explicit mode is required (if applicable) */
  explicitReasons: ExplicitModeReason[]
  
  /** Whether content passes silent mode requirements */
  canBeSilent: boolean
}

export type ExplicitModeReason = 
  | 'user_invoked_builder'      // User explicitly clicked BEAP Builder
  | 'has_attachments'           // Attachments/media added
  | 'has_media'                 // Media files (images/video/audio)
  | 'automation_requested'      // Automation/sessions requested
  | 'ingress_deviation'         // Ingress differs from baseline
  | 'egress_deviation'          // Egress differs from baseline
  | 'policy_deviation'          // Custom policy differs from WRGuard baseline
  | 'session_context'           // Package is part of automation session

// =============================================================================
// Silent Mode Build Request
// =============================================================================

export interface SilentBuildRequest {
  /** Content to package */
  content: string
  
  /** Content type */
  contentType: 'text' | 'markdown'
  
  /** Target recipient */
  target: string
  
  /** Subject line */
  subject: string
  
  /** Context for handshake lookup */
  context?: BuilderContext
}

// =============================================================================
// Explicit Mode Build Request
// =============================================================================

export interface ExplicitBuildRequest extends SilentBuildRequest {
  /** Attachments */
  attachments: BuilderAttachment[]
  
  /** Requested automation permissions */
  automation?: {
    enabled: boolean
    sessionId?: string
    permissions?: string[]
  }
  
  /** Custom policy overrides */
  policyOverrides?: Partial<CanonicalPolicy>
  
  /** Associated handshake ID */
  handshakeId?: string
}

// =============================================================================
// Build Result
// =============================================================================

export interface BeapBuildResult {
  /** Success flag */
  success: boolean
  
  /** Generated package ID */
  packageId?: string
  
  /** Generated capsule reference */
  capsuleRef?: string
  
  /** Generated envelope reference */
  envelopeRef?: string
  
  /** Error message if failed */
  error?: string
  
  /** Applied policy */
  appliedPolicy?: CanonicalPolicy
  
  /** Whether silent mode was used */
  silentMode: boolean
}

// =============================================================================
// Delivery Options (only in Drafts)
// =============================================================================

export type DeliveryMethod = 'email' | 'messenger' | 'download'

export interface DeliveryConfig {
  /** Selected delivery method */
  method: DeliveryMethod
  
  /** Email-specific config */
  email?: {
    to: string[]
    cc?: string[]
    bcc?: string[]
    accountId: string
  }
  
  /** Messenger-specific config */
  messenger?: {
    platform: 'whatsapp' | 'signal' | 'telegram' | 'slack' | 'teams' | 'other'
    recipient: string
    insertMethod: 'copy' | 'inject'
  }
  
  /** Download-specific config */
  download?: {
    format: 'file' | 'usb' | 'wallet' | 'offline'
    filename?: string
  }
}

// =============================================================================
// Builder State (for UI)
// =============================================================================

export interface BuilderState {
  /** Current mode */
  mode: BuilderMode
  
  /** Is builder open (for explicit mode) */
  isOpen: boolean
  
  /** Current context */
  context: BuilderContext | null
  
  /** Draft content */
  draft: {
    target: string
    subject: string
    body: string
    attachments: BuilderAttachment[]
  }
  
  /** Selected handshake */
  selectedHandshake: Handshake | null
  
  /** Custom policy (if any) */
  customPolicy: CanonicalPolicy | null
  
  /** Automation config (if any) */
  automationConfig: {
    enabled: boolean
    sessionId: string | null
    permissions: string[]
  }
  
  /** Delivery config (only for Drafts) */
  deliveryConfig: DeliveryConfig | null
  
  /** Validation errors */
  validationErrors: string[]
  
  /** Is building in progress */
  isBuilding: boolean
}



