/**
 * Intersection Logic Unit Tests
 * 
 * Tests the array and policy intersection utilities.
 */

import { describe, it, expect } from 'vitest'
import { 
  intersectArrays, 
  unionArrays, 
  intersectIngress, 
  intersectEgress 
} from '../intersection'
import { DEFAULT_INGRESS_POLICY, DEFAULT_EGRESS_POLICY } from '../../schema'
import type { IngressPolicy, EgressPolicy } from '../../schema'

describe('intersectArrays', () => {
  it('should return common elements', () => {
    const result = intersectArrays(['a', 'b', 'c'], ['b', 'c', 'd'])
    expect(result).toEqual(['b', 'c'])
  })
  
  it('should return empty array when no common elements', () => {
    const result = intersectArrays(['a', 'b'], ['c', 'd'])
    expect(result).toEqual([])
  })
  
  it('should handle empty arrays', () => {
    expect(intersectArrays([], ['a', 'b'])).toEqual([])
    expect(intersectArrays(['a', 'b'], [])).toEqual([])
    expect(intersectArrays([], [])).toEqual([])
  })
  
  it('should preserve order from first array', () => {
    const result = intersectArrays(['c', 'b', 'a'], ['a', 'b', 'c'])
    expect(result).toEqual(['c', 'b', 'a'])
  })
})

describe('unionArrays', () => {
  it('should combine all unique elements', () => {
    const result = unionArrays(['a', 'b'], ['b', 'c'])
    expect(result).toHaveLength(3)
    expect(result).toContain('a')
    expect(result).toContain('b')
    expect(result).toContain('c')
  })
  
  it('should handle empty arrays', () => {
    expect(unionArrays([], ['a', 'b'])).toEqual(['a', 'b'])
    expect(unionArrays(['a', 'b'], [])).toEqual(['a', 'b'])
    expect(unionArrays([], [])).toEqual([])
  })
  
  it('should not duplicate elements', () => {
    const result = unionArrays(['a', 'a', 'b'], ['b', 'b', 'c'])
    expect(result).toHaveLength(3)
  })
})

describe('intersectIngress', () => {
  it('should intersect artefact types from multiple policies', () => {
    const p1: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      allowedArtefactTypes: ['text', 'markdown', 'html_sanitized'],
    }
    
    const p2: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      allowedArtefactTypes: ['text', 'markdown'],
    }
    
    const p3: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      allowedArtefactTypes: ['text'],
    }
    
    const result = intersectIngress([p1, p2, p3], ['network', 'local', 'handshake'])
    
    expect(result.policy.allowedArtefactTypes).toEqual(['text'])
  })
  
  it('should use minimum size limit', () => {
    const p1: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      maxSizeBytes: 10_000_000,
    }
    
    const p2: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      maxSizeBytes: 5_000_000,
    }
    
    const result = intersectIngress([p1, p2], ['network', 'local'])
    
    expect(result.policy.maxSizeBytes).toBe(5_000_000)
  })
  
  it('should AND boolean permissions', () => {
    const p1: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      allowDynamicContent: true,
    }
    
    const p2: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      allowDynamicContent: false,
    }
    
    const result = intersectIngress([p1, p2], ['network', 'local'])
    
    expect(result.policy.allowDynamicContent).toBe(false)
  })
  
  it('should OR boolean requirements', () => {
    const p1: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      requireSourceVerification: false,
    }
    
    const p2: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      requireSourceVerification: true,
    }
    
    const result = intersectIngress([p1, p2], ['network', 'local'])
    
    expect(result.policy.requireSourceVerification).toBe(true)
  })
  
  it('should union blocked sources', () => {
    const p1: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      blockedSources: ['evil.com'],
    }
    
    const p2: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      blockedSources: ['malware.net'],
    }
    
    const result = intersectIngress([p1, p2], ['network', 'local'])
    
    expect(result.policy.blockedSources).toContain('evil.com')
    expect(result.policy.blockedSources).toContain('malware.net')
  })
  
  it('should track denials', () => {
    const p1: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      allowedArtefactTypes: ['text', 'markdown'],
    }
    
    const p2: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      allowedArtefactTypes: ['text'],
    }
    
    const result = intersectIngress([p1, p2], ['network', 'local'])
    
    // 'markdown' should be denied
    const markdownDenial = result.denials.find(d => 
      d.domain === 'ingress' && 
      d.reason.includes('markdown')
    )
    expect(markdownDenial).toBeDefined()
  })
  
  it('should use strictest parsing constraint', () => {
    const p1: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      parsingConstraint: 'permissive',
    }
    
    const p2: IngressPolicy = {
      ...DEFAULT_INGRESS_POLICY,
      parsingConstraint: 'strict',
    }
    
    const result = intersectIngress([p1, p2], ['network', 'local'])
    
    expect(result.policy.parsingConstraint).toBe('strict')
  })
})

describe('intersectEgress', () => {
  it('should intersect data categories', () => {
    const p1: EgressPolicy = {
      ...DEFAULT_EGRESS_POLICY,
      allowedDataCategories: ['public', 'internal', 'confidential'],
    }
    
    const p2: EgressPolicy = {
      ...DEFAULT_EGRESS_POLICY,
      allowedDataCategories: ['public', 'internal'],
    }
    
    const result = intersectEgress([p1, p2], ['network', 'local'])
    
    expect(result.policy.allowedDataCategories).toEqual(['public', 'internal'])
  })
  
  it('should intersect channels', () => {
    const p1: EgressPolicy = {
      ...DEFAULT_EGRESS_POLICY,
      allowedChannels: ['email', 'api', 'webhook'],
    }
    
    const p2: EgressPolicy = {
      ...DEFAULT_EGRESS_POLICY,
      allowedChannels: ['email', 'api'],
    }
    
    const result = intersectEgress([p1, p2], ['network', 'local'])
    
    expect(result.policy.allowedChannels).toEqual(['email', 'api'])
  })
  
  it('should OR requirement booleans', () => {
    const p1: EgressPolicy = {
      ...DEFAULT_EGRESS_POLICY,
      requireApproval: false,
      requireEncryption: false,
    }
    
    const p2: EgressPolicy = {
      ...DEFAULT_EGRESS_POLICY,
      requireApproval: true,
      requireEncryption: true,
    }
    
    const result = intersectEgress([p1, p2], ['network', 'local'])
    
    expect(result.policy.requireApproval).toBe(true)
    expect(result.policy.requireEncryption).toBe(true)
  })
  
  it('should AND permission booleans', () => {
    const p1: EgressPolicy = {
      ...DEFAULT_EGRESS_POLICY,
      allowBulkExport: true,
    }
    
    const p2: EgressPolicy = {
      ...DEFAULT_EGRESS_POLICY,
      allowBulkExport: false,
    }
    
    const result = intersectEgress([p1, p2], ['network', 'local'])
    
    expect(result.policy.allowBulkExport).toBe(false)
  })
  
  it('should use minimum rate limit', () => {
    const p1: EgressPolicy = {
      ...DEFAULT_EGRESS_POLICY,
      maxOperationsPerHour: 1000,
    }
    
    const p2: EgressPolicy = {
      ...DEFAULT_EGRESS_POLICY,
      maxOperationsPerHour: 100,
    }
    
    const result = intersectEgress([p1, p2], ['network', 'local'])
    
    expect(result.policy.maxOperationsPerHour).toBe(100)
  })
  
  it('should union blocked destinations', () => {
    const p1: EgressPolicy = {
      ...DEFAULT_EGRESS_POLICY,
      blockedDestinations: ['competitor.com'],
    }
    
    const p2: EgressPolicy = {
      ...DEFAULT_EGRESS_POLICY,
      blockedDestinations: ['spam.org'],
    }
    
    const result = intersectEgress([p1, p2], ['network', 'local'])
    
    expect(result.policy.blockedDestinations).toContain('competitor.com')
    expect(result.policy.blockedDestinations).toContain('spam.org')
  })
})

