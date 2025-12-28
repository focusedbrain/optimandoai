/**
 * Pre-Verification Handling Domain Schema
 * 
 * Controls protective/stability measures BEFORE BEAP verification.
 * This is purely about DoS protection, rate limiting, and storage.
 * 
 * BEAP SECURITY INVARIANT:
 * - NO content parsing at this stage
 * - NO artefact type inspection
 * - Only envelope-level / size-level checks
 * - Verification MUST complete before any content inspection
 * 
 * @version 2.0.0
 */

import { z } from 'zod'

/**
 * Quarantine behavior for unverified packages
 */
export const QuarantineBehaviorSchema = z.enum([
  'reject',         // Immediately reject unverifiable packages
  'quarantine',     // Hold in quarantine for manual review
  'hold_timeout',   // Hold with timeout, then reject
  'drop_silent',    // Silently drop (no response)
])

export type QuarantineBehavior = z.infer<typeof QuarantineBehaviorSchema>

/**
 * Rate limit action when exceeded
 */
export const RateLimitActionSchema = z.enum([
  'reject',         // Reject with error
  'queue',          // Queue for later processing
  'throttle',       // Slow down processing
  'drop_silent',    // Silently drop
])

export type RateLimitAction = z.infer<typeof RateLimitActionSchema>

/**
 * Pre-Verification Handling Policy Schema
 * 
 * All these controls operate BEFORE BEAP verification.
 * They protect against DoS, resource exhaustion, and flooding.
 */
export const PreVerificationPolicySchema = z.object({
  // ========================================
  // PACKAGE-LEVEL LIMITS
  // ========================================
  
  // Maximum size for a single package (bytes)
  maxPackageSizeBytes: z.number().int().positive().default(50_000_000), // 50MB
  
  // Maximum number of chunks in a package
  maxChunksPerPackage: z.number().int().positive().default(100),
  
  // Maximum number of artefacts in a package
  maxArtefactsPerPackage: z.number().int().positive().default(50),
  
  // Maximum size for any single artefact (bytes)
  maxArtefactSizeBytes: z.number().int().positive().default(25_000_000), // 25MB
  
  // ========================================
  // RATE LIMITING (Pre-verification)
  // ========================================
  
  // Max packages per sender per hour (0 = unlimited)
  maxPackagesPerSenderPerHour: z.number().int().nonnegative().default(100),
  
  // Max packages per handshake group per hour
  maxPackagesPerGroupPerHour: z.number().int().nonnegative().default(500),
  
  // Max packages from unknown senders per hour (before handshake)
  maxUnknownSenderPackagesPerHour: z.number().int().nonnegative().default(10),
  
  // Max total pending packages in queue
  maxPendingPackages: z.number().int().nonnegative().default(1000),
  
  // Action when rate limit exceeded
  rateLimitAction: RateLimitActionSchema.default('reject'),
  
  // ========================================
  // QUARANTINE / HOLDING BEHAVIOR
  // ========================================
  
  // Behavior for packages that fail verification
  verificationFailureBehavior: QuarantineBehaviorSchema.default('reject'),
  
  // Behavior for packages with invalid signatures
  invalidSignatureBehavior: QuarantineBehaviorSchema.default('reject'),
  
  // Behavior for packages from blocked senders
  blockedSenderBehavior: QuarantineBehaviorSchema.default('drop_silent'),
  
  // Quarantine timeout (seconds, 0 = indefinite hold)
  quarantineTimeoutSeconds: z.number().int().nonnegative().default(86400), // 24h
  
  // ========================================
  // STORAGE LIMITS (Pre-verification queue)
  // ========================================
  
  // Maximum storage for pending packages (bytes)
  maxPendingStorageBytes: z.number().int().positive().default(500_000_000), // 500MB
  
  // Maximum storage for quarantined packages (bytes)
  maxQuarantineStorageBytes: z.number().int().positive().default(100_000_000), // 100MB
  
  // Auto-purge oldest pending packages when storage full
  autoPurgePending: z.boolean().default(true),
  
  // ========================================
  // VERIFICATION REQUIREMENTS
  // ========================================
  
  // Require valid BEAP envelope structure
  requireValidEnvelope: z.boolean().default(true),
  
  // Require timestamp within validity window
  requireValidTimestamp: z.boolean().default(true),
  
  // Timestamp validity window (seconds)
  timestampValidityWindowSeconds: z.number().int().positive().default(300), // 5 min
  
  // Require replay protection (nonce check)
  requireReplayProtection: z.boolean().default(true),
  
  // ========================================
  // AUDIT
  // ========================================
  
  // Log all pre-verification events
  auditPreVerification: z.boolean().default(true),
  
  // Log rejected packages
  auditRejections: z.boolean().default(true),
  
  // Log rate limit events
  auditRateLimits: z.boolean().default(true),
})

export type PreVerificationPolicy = z.infer<typeof PreVerificationPolicySchema>

/**
 * Default pre-verification policy - secure by default
 */
export const DEFAULT_PRE_VERIFICATION_POLICY: PreVerificationPolicy = {
  maxPackageSizeBytes: 50_000_000,
  maxChunksPerPackage: 100,
  maxArtefactsPerPackage: 50,
  maxArtefactSizeBytes: 25_000_000,
  maxPackagesPerSenderPerHour: 100,
  maxPackagesPerGroupPerHour: 500,
  maxUnknownSenderPackagesPerHour: 10,
  maxPendingPackages: 1000,
  rateLimitAction: 'reject',
  verificationFailureBehavior: 'reject',
  invalidSignatureBehavior: 'reject',
  blockedSenderBehavior: 'drop_silent',
  quarantineTimeoutSeconds: 86400,
  maxPendingStorageBytes: 500_000_000,
  maxQuarantineStorageBytes: 100_000_000,
  autoPurgePending: true,
  requireValidEnvelope: true,
  requireValidTimestamp: true,
  timestampValidityWindowSeconds: 300,
  requireReplayProtection: true,
  auditPreVerification: true,
  auditRejections: true,
  auditRateLimits: true,
}


