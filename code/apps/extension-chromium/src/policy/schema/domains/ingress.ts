/**
 * Ingress Domain Schema
 * 
 * Defines what artefacts and content can enter the system.
 * Deny by default: empty arrays = nothing allowed.
 */

import { z } from 'zod'

/**
 * Allowed artefact types for ingress
 * Each type represents a different level of processing/risk
 */
export const ArtefactTypeSchema = z.enum([
  'text',                // Plain text only
  'html_sanitized',      // HTML with scripts/styles stripped
  'pdf_text',            // Extracted text from PDF
  'image_ocr',           // OCR extracted text from images
  'structured_data',     // JSON/CSV/structured formats
  'attachment_metadata', // File metadata only (no content)
  'markdown',            // Markdown formatted text
  'code_snippet',        // Code with syntax highlighting
])

export type ArtefactType = z.infer<typeof ArtefactTypeSchema>

/**
 * Parsing constraint levels
 */
export const ParsingConstraintSchema = z.enum([
  'strict',      // Only parse known safe formats
  'permissive',  // Allow more formats with validation
  'custom',      // Custom parsing rules defined
])

export type ParsingConstraint = z.infer<typeof ParsingConstraintSchema>

/**
 * Ingress Policy Schema
 * Controls what can enter the system
 */
export const IngressPolicySchema = z.object({
  // Allowed artefact types (empty = deny all)
  allowedArtefactTypes: z.array(ArtefactTypeSchema).default([]),
  
  // Maximum size in bytes for any single artefact
  maxSizeBytes: z.number().int().positive().default(10_000_000), // 10MB default
  
  // Maximum total size in bytes per transaction
  maxTotalSizeBytes: z.number().int().positive().default(50_000_000), // 50MB default
  
  // Allow reconstruction of original artefacts from processed versions
  allowReconstruction: z.boolean().default(false),
  
  // Allow dynamic content (scripts, macros, etc.) - HIGH RISK
  allowDynamicContent: z.boolean().default(false),
  
  // Allow external resource loading (images, fonts, etc.)
  allowExternalResources: z.boolean().default(false),
  
  // Parsing constraint level
  parsingConstraint: ParsingConstraintSchema.default('strict'),
  
  // Allowed source domains (empty = none, ['*'] = all)
  allowedSources: z.array(z.string()).default([]),
  
  // Blocked source domains (takes precedence over allowed)
  blockedSources: z.array(z.string()).default([]),
  
  // Require cryptographic verification of source
  requireSourceVerification: z.boolean().default(true),
  
  // Maximum number of attachments per message
  maxAttachments: z.number().int().nonnegative().default(10),
})

export type IngressPolicy = z.infer<typeof IngressPolicySchema>

/**
 * Default restrictive ingress policy
 */
export const DEFAULT_INGRESS_POLICY: IngressPolicy = {
  allowedArtefactTypes: ['text', 'markdown'], // Only safe text formats
  maxSizeBytes: 10_000_000,
  maxTotalSizeBytes: 50_000_000,
  allowReconstruction: false,
  allowDynamicContent: false,
  allowExternalResources: false,
  parsingConstraint: 'strict',
  allowedSources: [],
  blockedSources: [],
  requireSourceVerification: true,
  maxAttachments: 10,
}



