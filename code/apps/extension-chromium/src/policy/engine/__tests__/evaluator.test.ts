/**
 * Policy Evaluator Unit Tests
 * 
 * Tests the core invariants:
 * 1. NO ESCALATION: Lower layers cannot enable what higher layers deny
 * 2. DENY BY DEFAULT: Undefined capabilities are denied
 * 3. INTERSECTION: Effective policy is the intersection of all layers
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { 
  computeEffectivePolicy, 
  verifyNoEscalation,
  getDeniedCapabilities,
  type PolicyEvaluationInput 
} from '../evaluator'
import { createDefaultPolicy, type CanonicalPolicy } from '../../schema'

describe('computeEffectivePolicy', () => {
  let lnp: CanonicalPolicy
  
  beforeEach(() => {
    lnp = createDefaultPolicy('local', 'Test Local Policy')
  })
  
  it('should return effective policy with only LNP', () => {
    const result = computeEffectivePolicy({ lnp })
    
    expect(result.effective).toBeDefined()
    expect(result.appliedLayers).toEqual(['local'])
    expect(result.effectiveRiskTier).toBeDefined()
  })
  
  it('should apply NBP restrictions when present', () => {
    const nbp = createDefaultPolicy('network', 'Network Policy')
    nbp.ingress = {
      ...nbp.ingress!,
      allowedArtefactTypes: ['text'], // Only text
    }
    
    lnp.ingress = {
      ...lnp.ingress!,
      allowedArtefactTypes: ['text', 'markdown', 'html_sanitized'],
    }
    
    const result = computeEffectivePolicy({ nbp, lnp })
    
    // Intersection should only include 'text'
    expect(result.effective.ingress?.allowedArtefactTypes).toEqual(['text'])
    expect(result.appliedLayers).toContain('network')
  })
  
  it('should apply HSP restrictions', () => {
    const hsp = createDefaultPolicy('handshake', 'Sender Policy')
    hsp.egress = {
      ...hsp.egress!,
      allowedChannels: ['email'],
    }
    
    lnp.egress = {
      ...lnp.egress!,
      allowedChannels: ['email', 'api', 'webhook'],
    }
    
    const result = computeEffectivePolicy({ lnp, hsp })
    
    // HSP restricts to email only
    expect(result.effective.egress?.allowedChannels).toEqual(['email'])
  })
  
  it('should track denials from each layer', () => {
    const nbp = createDefaultPolicy('network', 'Network Policy')
    nbp.ingress = {
      ...nbp.ingress!,
      allowDynamicContent: false,
    }
    
    lnp.ingress = {
      ...lnp.ingress!,
      allowDynamicContent: true, // LNP allows but NBP denies
    }
    
    const result = computeEffectivePolicy({ nbp, lnp })
    
    // Dynamic content should be denied
    expect(result.effective.ingress?.allowDynamicContent).toBe(false)
    expect(result.denials.length).toBeGreaterThan(0)
  })
  
  it('should calculate correct risk tier', () => {
    lnp.ingress = {
      ...lnp.ingress!,
      allowDynamicContent: true, // High risk
      allowReconstruction: true, // Medium risk
    }
    lnp.egress = {
      ...lnp.egress!,
      requireApproval: false, // Medium risk
      requireEncryption: false, // Medium risk
    }
    
    const result = computeEffectivePolicy({ lnp })
    
    expect(['high', 'critical']).toContain(result.effectiveRiskTier)
  })
  
  it('should require consent when CAP exceeds HSP', () => {
    const hsp = createDefaultPolicy('handshake', 'Sender Policy')
    hsp.ingress = {
      ...hsp.ingress!,
      allowDynamicContent: false,
    }
    
    const cap = createDefaultPolicy('capsule', 'Capsule Policy')
    cap.ingress = {
      ...cap.ingress!,
      allowDynamicContent: true, // Requests more than HSP allows
    }
    
    const result = computeEffectivePolicy({ lnp, hsp, cap })
    
    expect(result.requiresConsent).toBe(true)
  })
  
  it('should use minimum for numeric limits', () => {
    const nbp = createDefaultPolicy('network', 'Network Policy')
    nbp.ingress = {
      ...nbp.ingress!,
      maxSizeBytes: 1_000_000, // 1MB
    }
    
    lnp.ingress = {
      ...lnp.ingress!,
      maxSizeBytes: 5_000_000, // 5MB
    }
    
    const result = computeEffectivePolicy({ nbp, lnp })
    
    // Should use the more restrictive (smaller) limit
    expect(result.effective.ingress?.maxSizeBytes).toBe(1_000_000)
  })
  
  it('should union blocked destinations', () => {
    const nbp = createDefaultPolicy('network', 'Network Policy')
    nbp.egress = {
      ...nbp.egress!,
      blockedDestinations: ['evil.com'],
    }
    
    lnp.egress = {
      ...lnp.egress!,
      blockedDestinations: ['malware.net'],
    }
    
    const result = computeEffectivePolicy({ nbp, lnp })
    
    // Both blocks should apply
    expect(result.effective.egress?.blockedDestinations).toContain('evil.com')
    expect(result.effective.egress?.blockedDestinations).toContain('malware.net')
  })
})

describe('verifyNoEscalation', () => {
  it('should detect escalation in boolean permissions', () => {
    const higher = createDefaultPolicy('network', 'Network Policy')
    higher.ingress = {
      ...higher.ingress!,
      allowDynamicContent: false,
    }
    
    const lower = createDefaultPolicy('local', 'Local Policy')
    lower.ingress = {
      ...lower.ingress!,
      allowDynamicContent: true, // Escalation!
    }
    
    const result = verifyNoEscalation(higher, lower)
    
    expect(result.valid).toBe(false)
    expect(result.violations).toContain('Lower layer enables dynamic content denied by higher layer')
  })
  
  it('should detect escalation in array permissions', () => {
    const higher = createDefaultPolicy('network', 'Network Policy')
    higher.ingress = {
      ...higher.ingress!,
      allowedArtefactTypes: ['text'],
    }
    
    const lower = createDefaultPolicy('local', 'Local Policy')
    lower.ingress = {
      ...lower.ingress!,
      allowedArtefactTypes: ['text', 'html_sanitized'], // Escalation!
    }
    
    const result = verifyNoEscalation(higher, lower)
    
    expect(result.valid).toBe(false)
    expect(result.violations.some(v => v.includes('html_sanitized'))).toBe(true)
  })
  
  it('should detect escalation in numeric limits', () => {
    const higher = createDefaultPolicy('network', 'Network Policy')
    higher.ingress = {
      ...higher.ingress!,
      maxSizeBytes: 1_000_000,
    }
    
    const lower = createDefaultPolicy('local', 'Local Policy')
    lower.ingress = {
      ...lower.ingress!,
      maxSizeBytes: 5_000_000, // Escalation!
    }
    
    const result = verifyNoEscalation(higher, lower)
    
    expect(result.valid).toBe(false)
    expect(result.violations).toContain('Lower layer has higher size limit than higher layer')
  })
  
  it('should pass when lower layer is more restrictive', () => {
    const higher = createDefaultPolicy('network', 'Network Policy')
    higher.ingress = {
      ...higher.ingress!,
      allowedArtefactTypes: ['text', 'markdown'],
      maxSizeBytes: 10_000_000,
    }
    
    const lower = createDefaultPolicy('local', 'Local Policy')
    lower.ingress = {
      ...lower.ingress!,
      allowedArtefactTypes: ['text'], // More restrictive
      maxSizeBytes: 5_000_000, // More restrictive
    }
    
    const result = verifyNoEscalation(higher, lower)
    
    expect(result.valid).toBe(true)
    expect(result.violations).toHaveLength(0)
  })
})

describe('getDeniedCapabilities', () => {
  it('should list all denied capabilities', () => {
    const requested = createDefaultPolicy('capsule', 'Capsule Request')
    requested.ingress = {
      ...requested.ingress!,
      allowDynamicContent: true,
      allowedArtefactTypes: ['text', 'html_sanitized', 'image_ocr'],
    }
    requested.egress = {
      ...requested.egress!,
      allowedChannels: ['email', 'api', 'webhook'],
      allowBulkExport: true,
    }
    
    const effective = createDefaultPolicy('local', 'Effective Policy')
    effective.ingress = {
      ...effective.ingress!,
      allowDynamicContent: false,
      allowedArtefactTypes: ['text'],
    }
    effective.egress = {
      ...effective.egress!,
      allowedChannels: ['email'],
      allowBulkExport: false,
    }
    
    const denials = getDeniedCapabilities(requested, effective)
    
    // Dynamic content denied
    expect(denials.some(d => d.capability === 'allowDynamicContent')).toBe(true)
    
    // Artefact types denied
    expect(denials.some(d => d.requestedValue === 'html_sanitized')).toBe(true)
    expect(denials.some(d => d.requestedValue === 'image_ocr')).toBe(true)
    
    // Channels denied
    expect(denials.some(d => d.requestedValue === 'api')).toBe(true)
    expect(denials.some(d => d.requestedValue === 'webhook')).toBe(true)
    
    // Bulk export denied
    expect(denials.some(d => d.capability === 'allowBulkExport')).toBe(true)
  })
  
  it('should return empty array when all requested capabilities are allowed', () => {
    const requested = createDefaultPolicy('capsule', 'Capsule Request')
    requested.ingress = {
      ...requested.ingress!,
      allowedArtefactTypes: ['text'],
    }
    
    const effective = createDefaultPolicy('local', 'Effective Policy')
    effective.ingress = {
      ...effective.ingress!,
      allowedArtefactTypes: ['text', 'markdown'],
    }
    
    const denials = getDeniedCapabilities(requested, effective)
    
    expect(denials.filter(d => d.domain === 'ingress' && d.capability === 'allowedArtefactTypes')).toHaveLength(0)
  })
})


