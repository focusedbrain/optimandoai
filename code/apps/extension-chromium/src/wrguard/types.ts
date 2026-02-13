/**
 * WRGuard Types
 * 
 * Types for the WRGuard local enforcement and configuration context.
 * 
 * WRGuard is:
 * - A local enforcement context
 * - Where providers, sites, and local policy posture are defined
 * 
 * WRGuard is NOT:
 * - A capsule builder
 * - An envelope editor
 * - A runtime execution engine (yet)
 * 
 * =============================================================================
 * BLOCKED EMAIL DOMAINS — SINGLE SOURCE OF TRUTH
 * =============================================================================
 * 
 * This file defines the authoritative list of email domains where WRGuard™
 * inbox protection is enforced. The blocking mechanism:
 * 
 * 1. DOMAIN MATCHING:
 *    - Uses `hostname.includes(domain)` for flexible subdomain matching
 *    - Example: 'outlook.live.com' matches 'mail.outlook.live.com'
 * 
 * 2. BLOCKING BEHAVIOR:
 *    - Email clicks are blocked in capture phase (prevents opening emails)
 *    - WRGuard overlay is displayed explaining the restriction
 *    - Block applies immediately on page load, before any external connection
 * 
 * 3. ADDING NEW DOMAINS:
 *    - Add to WRGUARD_BLOCKED_EMAIL_DOMAINS array below
 *    - Also add to manifest.config.ts content_scripts matches for the
 *      mailguard-content-script.ts to be injected on those pages
 * 
 * 4. CONFIGURATION:
 *    - DEFAULT_PROTECTED_SITES provides user-facing toggle per domain
 *    - WRGUARD_BLOCKED_EMAIL_DOMAINS is the runtime enforcement list
 * 
 * @version 1.0.0
 */

// =============================================================================
// BLOCKED EMAIL DOMAINS — Single Source of Truth for MailGuard enforcement
// =============================================================================

/**
 * List of email provider domains where WRGuard™ inbox protection is enforced.
 * Email content cannot be opened on these domains inside the workstation.
 * 
 * IMPORTANT: When adding new domains:
 * 1. Add the domain string here
 * 2. Add matching pattern to manifest.config.ts content_scripts
 * 3. Optionally add to DEFAULT_PROTECTED_SITES for UI toggle
 */
export const WRGUARD_BLOCKED_EMAIL_DOMAINS: readonly string[] = [
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com'
] as const

/**
 * Check if a hostname matches any blocked email domain.
 * Uses includes() for subdomain flexibility.
 */
export function isBlockedEmailDomain(hostname: string): boolean {
  return WRGUARD_BLOCKED_EMAIL_DOMAINS.some(domain => hostname.includes(domain))
}

/**
 * Get the matching blocked domain for a hostname, or null if not blocked.
 */
export function getBlockedEmailDomain(hostname: string): string | null {
  return WRGUARD_BLOCKED_EMAIL_DOMAINS.find(domain => hostname.includes(domain)) ?? null
}

// =============================================================================
// Email Providers
// =============================================================================

/**
 * Supported email provider types
 */
export type EmailProviderType = 'gmail' | 'outlook' | 'yahoo' | 'imap' | 'other'

/**
 * Connection status for a provider
 */
export type ProviderConnectionStatus = 
  | 'connected'
  | 'disconnected'
  | 'connecting'
  | 'error'
  | 'expired'

/**
 * Email provider configuration
 */
export interface EmailProvider {
  /** Unique provider ID */
  id: string
  
  /** Provider type */
  type: EmailProviderType
  
  /** Display name (e.g., "My Gmail") */
  name: string
  
  /** Email address associated */
  email: string
  
  /** Connection status */
  status: ProviderConnectionStatus
  
  /** Error message if status is 'error' */
  error?: string
  
  /** Last connected timestamp */
  lastConnected?: number
  
  /** OAuth token expiry (if applicable) */
  tokenExpiry?: number
  
  /** Whether this is the default provider */
  isDefault: boolean
  
  /** Created timestamp */
  createdAt: number
}

/**
 * Provider configuration for display
 */
export const PROVIDER_CONFIG: Record<EmailProviderType, {
  label: string
  icon: string
  color: string
  authType: 'oauth' | 'credentials'
}> = {
  gmail: {
    label: 'Gmail',
    icon: '📧',
    color: '#EA4335',
    authType: 'oauth'
  },
  outlook: {
    label: 'Outlook',
    icon: '📬',
    color: '#0078D4',
    authType: 'oauth'
  },
  yahoo: {
    label: 'Yahoo Mail',
    icon: '📨',
    color: '#6001D2',
    authType: 'oauth'
  },
  imap: {
    label: 'IMAP/SMTP',
    icon: '🔧',
    color: '#64748b',
    authType: 'credentials'
  },
  other: {
    label: 'Other',
    icon: '📧',
    color: '#64748b',
    authType: 'credentials'
  }
}

// =============================================================================
// Protected Sites
// =============================================================================

/**
 * Source of protected site entry
 */
export type ProtectedSiteSource = 'default' | 'user'

/**
 * A protected site entry
 */
export interface ProtectedSite {
  /** Unique ID */
  id: string
  
  /** Domain or origin (e.g., mail.google.com) */
  domain: string
  
  /** Source: default or user-added */
  source: ProtectedSiteSource
  
  /** Added timestamp */
  addedAt: number
  
  /** Optional description */
  description?: string
  
  /** Whether the site is enabled */
  enabled: boolean
}

/**
 * Default protected sites (must be included on first load)
 */
export const DEFAULT_PROTECTED_SITES: Omit<ProtectedSite, 'id' | 'addedAt'>[] = [
  {
    domain: 'mail.google.com',
    source: 'default',
    description: 'Gmail - Google Mail',
    enabled: true
  },
  {
    domain: 'outlook.com',
    source: 'default',
    description: 'Microsoft Outlook',
    enabled: true
  },
  {
    domain: 'outlook.office.com',
    source: 'default',
    description: 'Outlook Web App',
    enabled: true
  },
  {
    domain: 'outlook.office365.com',
    source: 'default',
    description: 'Outlook Office 365',
    enabled: true
  }
]

// =============================================================================
// Policy Overview
// =============================================================================

/**
 * Policy posture summary (read-only display)
 */
export type PolicyPosture = 'restrictive' | 'balanced' | 'permissive'

/**
 * Policy overview for display
 */
export interface PolicyOverview {
  /** Ingress policy posture */
  ingress: {
    posture: PolicyPosture
    summary: string
  }
  
  /** Egress policy posture */
  egress: {
    posture: PolicyPosture
    summary: string
  }
  
  /** Attachment handling */
  attachments: {
    summary: string
    allowedTypes: string[]
    maxSize: number // in bytes
  }
  
  /** Execution defaults */
  execution: {
    summary: string
    automationMode: 'deny' | 'review' | 'allow'
    offlinePreferred: boolean
  }
  
  /** Last updated timestamp */
  lastUpdated: number
}

/**
 * Default policy overview
 */
export const DEFAULT_POLICY_OVERVIEW: PolicyOverview = {
  ingress: {
    posture: 'restrictive',
    summary: 'Only capsule content is processed. No external inputs allowed during execution.'
  },
  egress: {
    posture: 'restrictive',
    summary: 'No external egress permitted by default. All outbound effects must be explicitly declared.'
  },
  attachments: {
    summary: 'Attachments are parsed for semantic content. Executables and macros are blocked.',
    allowedTypes: ['application/pdf', 'image/*', 'text/*', 'application/vnd.openxmlformats-officedocument.*'],
    maxSize: 25 * 1024 * 1024 // 25MB
  },
  execution: {
    summary: 'Automation requires explicit review. Critical operations blocked by default.',
    automationMode: 'review',
    offlinePreferred: true
  },
  lastUpdated: Date.now()
}

// =============================================================================
// WRGuard Configuration State
// =============================================================================

/**
 * Complete WRGuard configuration
 */
export interface WRGuardConfig {
  /** Configured email providers */
  providers: EmailProvider[]
  
  /** Protected sites list */
  protectedSites: ProtectedSite[]
  
  /** Policy overview (read-only) */
  policyOverview: PolicyOverview
  
  /** Whether WRGuard has been initialized */
  initialized: boolean
  
  /** Last configuration update */
  lastUpdated: number
}

// =============================================================================
// WRGuard Workspace Navigation
// =============================================================================

/**
 * WRGuard workspace sections
 */
export type WRGuardSection = 
  | 'providers'
  | 'protected-sites'
  | 'policies'
  | 'runtime-controls'

export const WRGUARD_SECTIONS: { id: WRGuardSection; label: string; icon: string }[] = [
  { id: 'providers', label: 'Email Providers', icon: '📧' },
  { id: 'protected-sites', label: 'Protected Sites', icon: '🛡️' },
  { id: 'policies', label: 'Policies', icon: '📋' },
  { id: 'runtime-controls', label: 'Runtime Controls', icon: '⚙️' }
]

// =============================================================================
// Site Protection Settings (used by overlayProtection.ts)
// =============================================================================

/**
 * Settings for protecting a specific site
 */
export interface SiteProtectionSettings {
  /** Block external links */
  blockLinks: boolean
  /** Block attachment downloads */
  blockAttachments: boolean
  /** Block external media (images, videos) */
  blockMedia: boolean
  /** Block automation triggers (forms, scripts) */
  blockAutomationTriggers: boolean
  /** Allow bypass with user confirmation */
  allowBypassWithConfirmation: boolean
}

/**
 * Default protection settings - most restrictive
 */
export const DEFAULT_PROTECTION_SETTINGS: SiteProtectionSettings = {
  blockLinks: true,
  blockAttachments: true,
  blockMedia: true,
  blockAutomationTriggers: true,
  allowBypassWithConfirmation: false
}

/**
 * Event logged when content is blocked
 */
export interface OverlayBlockEvent {
  /** Site where block occurred */
  site: string
  /** Type of content blocked */
  blockedType: 'link' | 'attachment' | 'media' | 'automation'
  /** Details about what was blocked */
  details: string
  /** Timestamp */
  timestamp: number
}
