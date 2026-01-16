/**
 * Ingress Channels Domain Schema
 * 
 * Controls WHAT DOORS EXIST for packages to enter the system.
 * This is about transport-level controls, NOT content inspection.
 * 
 * BEAP SECURITY INVARIANT:
 * - BEAP packages are the default/mandatory channel
 * - Non-BEAP channels must wrap into BEAP before entering policy engine
 * - No content parsing occurs at channel level
 * 
 * @version 2.0.0
 */

import { z } from 'zod'

/**
 * Attestation tier requirements for channel access
 */
export const AttestationTierSchema = z.enum([
  'none',           // No attestation required (development only)
  'self_signed',    // Self-signed keys accepted
  'known_sender',   // Sender in handshake registry
  'verified_org',   // Verified organization key
  'hardware_bound', // Hardware-bound attestation required
])

export type AttestationTier = z.infer<typeof AttestationTierSchema>

/**
 * Network scope for channel access
 */
export const NetworkScopeSchema = z.enum([
  'localhost',      // Only local machine
  'lan',            // Local area network only
  'vpn',            // VPN-connected networks
  'internet',       // Public internet
])

export type NetworkScope = z.infer<typeof NetworkScopeSchema>

/**
 * Individual channel configuration
 */
export const ChannelConfigSchema = z.object({
  // Whether this channel is enabled
  enabled: z.boolean(),
  
  // Required attestation tier
  requiredAttestation: AttestationTierSchema.default('known_sender'),
  
  // Allowed network scopes (empty = none allowed)
  allowedScopes: z.array(NetworkScopeSchema).default([]),
  
  // Rate limit: max packages per hour (0 = unlimited)
  rateLimitPerHour: z.number().int().nonnegative().default(0),
  
  // Allowed handshake group IDs (empty = all groups, if attestation passes)
  allowedHandshakeGroups: z.array(z.string()).default([]),
  
  // Blocked sender IDs (takes precedence)
  blockedSenders: z.array(z.string()).default([]),
})

export type ChannelConfig = z.infer<typeof ChannelConfigSchema>

/**
 * Ingress Channels Policy Schema
 * 
 * Controls which doors exist for packages to enter.
 * BEAP is the secure-by-default transport.
 */
export const ChannelsPolicySchema = z.object({
  // ========================================
  // BEAP PACKAGE CHANNEL (Primary/Mandatory)
  // ========================================
  beapPackages: ChannelConfigSchema.default({
    enabled: true, // BEAP is enabled by default
    requiredAttestation: 'known_sender',
    allowedScopes: ['lan', 'vpn', 'internet'],
    rateLimitPerHour: 0, // No rate limit for verified BEAP
    allowedHandshakeGroups: [],
    blockedSenders: [],
  }),
  
  // ========================================
  // LOCAL PACKAGE BUILDER (Authoring)
  // ========================================
  localPackageBuilder: ChannelConfigSchema.default({
    enabled: true, // Local authoring enabled
    requiredAttestation: 'none', // Local = trusted
    allowedScopes: ['localhost'],
    rateLimitPerHour: 0,
    allowedHandshakeGroups: [],
    blockedSenders: [],
  }),
  
  // ========================================
  // HTTPS WEBHOOKS (Non-BEAP inbound)
  // ========================================
  // Must wrap into BEAP before entering policy engine
  httpsWebhooks: ChannelConfigSchema.default({
    enabled: false, // Off by default
    requiredAttestation: 'verified_org',
    allowedScopes: [], // None by default
    rateLimitPerHour: 100,
    allowedHandshakeGroups: [],
    blockedSenders: [],
  }),
  
  // ========================================
  // EMAIL BRIDGE (Legacy)
  // ========================================
  // Must wrap into BEAP before entering policy engine
  emailBridge: ChannelConfigSchema.default({
    enabled: false, // Off by default
    requiredAttestation: 'verified_org',
    allowedScopes: [],
    rateLimitPerHour: 50,
    allowedHandshakeGroups: [],
    blockedSenders: [],
  }),
  
  // ========================================
  // FILESYSTEM WATCH (Folder drop)
  // ========================================
  filesystemWatch: ChannelConfigSchema.default({
    enabled: false,
    requiredAttestation: 'none', // Local filesystem = trusted
    allowedScopes: ['localhost'],
    rateLimitPerHour: 0,
    allowedHandshakeGroups: [],
    blockedSenders: [],
  }),
  
  // ========================================
  // BROWSER EXTENSION INBOUND
  // ========================================
  browserExtension: ChannelConfigSchema.default({
    enabled: true, // Extension is a valid channel
    requiredAttestation: 'none', // Extension = trusted context
    allowedScopes: ['localhost'],
    rateLimitPerHour: 0,
    allowedHandshakeGroups: [],
    blockedSenders: [],
  }),
  
  // ========================================
  // GLOBAL CHANNEL SETTINGS
  // ========================================
  
  // Require all non-BEAP channels to wrap into BEAP
  requireBeapWrapper: z.boolean().default(true),
  
  // Log all channel activity
  auditChannelActivity: z.boolean().default(true),
})

export type ChannelsPolicy = z.infer<typeof ChannelsPolicySchema>

/**
 * Default channels policy - secure by default
 */
export const DEFAULT_CHANNELS_POLICY: ChannelsPolicy = {
  beapPackages: {
    enabled: true,
    requiredAttestation: 'known_sender',
    allowedScopes: ['lan', 'vpn', 'internet'],
    rateLimitPerHour: 0,
    allowedHandshakeGroups: [],
    blockedSenders: [],
  },
  localPackageBuilder: {
    enabled: true,
    requiredAttestation: 'none',
    allowedScopes: ['localhost'],
    rateLimitPerHour: 0,
    allowedHandshakeGroups: [],
    blockedSenders: [],
  },
  httpsWebhooks: {
    enabled: false,
    requiredAttestation: 'verified_org',
    allowedScopes: [],
    rateLimitPerHour: 100,
    allowedHandshakeGroups: [],
    blockedSenders: [],
  },
  emailBridge: {
    enabled: false,
    requiredAttestation: 'verified_org',
    allowedScopes: [],
    rateLimitPerHour: 50,
    allowedHandshakeGroups: [],
    blockedSenders: [],
  },
  filesystemWatch: {
    enabled: false,
    requiredAttestation: 'none',
    allowedScopes: ['localhost'],
    rateLimitPerHour: 0,
    allowedHandshakeGroups: [],
    blockedSenders: [],
  },
  browserExtension: {
    enabled: true,
    requiredAttestation: 'none',
    allowedScopes: ['localhost'],
    rateLimitPerHour: 0,
    allowedHandshakeGroups: [],
    blockedSenders: [],
  },
  requireBeapWrapper: true,
  auditChannelActivity: true,
}



