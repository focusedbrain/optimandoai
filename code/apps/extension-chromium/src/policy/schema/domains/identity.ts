/**
 * Identity Domain Schema
 * 
 * Defines identity and privacy constraints: attributes, sharing, purpose binding.
 * Deny by default: empty arrays = no identity sharing.
 */

import { z } from 'zod'

/**
 * Identity attribute types
 */
export const IdentityAttributeSchema = z.enum([
  'name',               // Full name
  'email',              // Email address
  'phone',              // Phone number
  'organization',       // Organization name
  'department',         // Department
  'role',               // Job role/title
  'location',           // Geographic location
  'timezone',           // Timezone
  'language',           // Preferred language
  'profile_image',      // Profile picture
  'public_key',         // Public key
  'custom_attributes',  // Custom defined attributes
])

export type IdentityAttribute = z.infer<typeof IdentityAttributeSchema>

/**
 * Identity verification levels
 */
export const VerificationLevelSchema = z.enum([
  'none',               // No verification
  'email_verified',     // Email verified
  'phone_verified',     // Phone verified
  'id_verified',        // Government ID verified
  'organization_verified', // Organization membership verified
])

export type VerificationLevel = z.infer<typeof VerificationLevelSchema>

/**
 * Pseudonymity modes
 */
export const PseudonymityModeSchema = z.enum([
  'real_identity',      // Use real identity
  'pseudonym',          // Use consistent pseudonym
  'anonymous',          // Fully anonymous
  'role_based',         // Identity based on role
])

export type PseudonymityMode = z.infer<typeof PseudonymityModeSchema>

/**
 * Identity Policy Schema
 */
export const IdentityPolicySchema = z.object({
  // Allowed attributes to share (empty = deny all)
  allowedAttributes: z.array(IdentityAttributeSchema).default([]),
  
  // Required verification level
  requiredVerification: VerificationLevelSchema.default('none'),
  
  // Pseudonymity mode
  pseudonymityMode: PseudonymityModeSchema.default('real_identity'),
  
  // Allow attribute updates
  allowAttributeUpdates: z.boolean().default(false),
  
  // Require consent for each attribute share
  requireConsentPerAttribute: z.boolean().default(true),
  
  // Purpose binding for identity sharing
  allowedPurposes: z.array(z.string()).default([]),
  
  // Retention period for shared identity (days)
  retentionDays: z.number().int().positive().default(30),
  
  // Allow identity linking across services
  allowIdentityLinking: z.boolean().default(false),
  
  // Audit identity access
  auditIdentityAccess: z.boolean().default(true),
  
  // Allow identity delegation
  allowDelegation: z.boolean().default(false),
  
  // Minimum pseudonym rotation (days, 0 = no rotation)
  pseudonymRotationDays: z.number().int().nonnegative().default(0),
})

export type IdentityPolicy = z.infer<typeof IdentityPolicySchema>

/**
 * Default restrictive identity policy
 */
export const DEFAULT_IDENTITY_POLICY: IdentityPolicy = {
  allowedAttributes: [],
  requiredVerification: 'none',
  pseudonymityMode: 'real_identity',
  allowAttributeUpdates: false,
  requireConsentPerAttribute: true,
  allowedPurposes: [],
  retentionDays: 30,
  allowIdentityLinking: false,
  auditIdentityAccess: true,
  allowDelegation: false,
  pseudonymRotationDays: 0,
}

