/**
 * Policy Templates Module
 * 
 * Pre-defined policy templates for common use cases.
 */

import type { CanonicalPolicy, PolicyLayer } from '../schema'
import { RESTRICTIVE_TEMPLATE, createRestrictivePolicy } from './restrictive'
import { STANDARD_TEMPLATE, createStandardPolicy } from './standard'
import { PERMISSIVE_TEMPLATE, createPermissivePolicy } from './permissive'

// Re-export templates
export { RESTRICTIVE_TEMPLATE, createRestrictivePolicy }
export { STANDARD_TEMPLATE, createStandardPolicy }
export { PERMISSIVE_TEMPLATE, createPermissivePolicy }

/**
 * Template types
 */
export type TemplateName = 'restrictive' | 'standard' | 'permissive'

/**
 * All templates map
 */
const TEMPLATES: Record<TemplateName, Omit<CanonicalPolicy, 'id' | 'createdAt' | 'updatedAt'>> = {
  restrictive: RESTRICTIVE_TEMPLATE,
  standard: STANDARD_TEMPLATE,
  permissive: PERMISSIVE_TEMPLATE,
}

/**
 * Create a policy from a named template
 */
export function createPolicyFromTemplate(
  template: TemplateName,
  layer: PolicyLayer,
  name?: string
): CanonicalPolicy {
  const now = Date.now()
  const id = crypto.randomUUID()
  
  const base = TEMPLATES[template]
  
  if (!base) {
    console.error('[createPolicyFromTemplate] Unknown template:', template)
    // Fallback to standard
    return createPolicyFromTemplate('standard', layer, name)
  }
  
  return {
    ...base,
    id,
    name: name ?? `${base.name} (${layer})`,
    layer,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Get template description
 */
export function getTemplateDescription(template: TemplateName): string {
  const descriptions: Record<TemplateName, string> = {
    restrictive: 'Maximum security, minimal permissions. For high-security environments.',
    standard: 'Balanced security and functionality. For typical business use.',
    permissive: 'Relaxed restrictions for development and testing. Not for production.',
  }
  return descriptions[template]
}

/**
 * Get recommended template for a risk tier
 */
export function getRecommendedTemplate(riskTolerance: 'low' | 'medium' | 'high'): TemplateName {
  const mapping: Record<typeof riskTolerance, TemplateName> = {
    low: 'restrictive',
    medium: 'standard',
    high: 'permissive',
  }
  return mapping[riskTolerance]
}
