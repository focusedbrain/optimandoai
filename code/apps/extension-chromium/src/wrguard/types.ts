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
 * @version 1.0.0
 */

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
