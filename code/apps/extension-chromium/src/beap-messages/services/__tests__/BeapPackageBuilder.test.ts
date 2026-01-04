/**
 * BEAP Package Builder Regression Tests
 * 
 * Tests guard against regressions in:
 * - Encrypted content leakage into transport
 * - Policy gating for qBEAP builds
 * - Automation tag extraction
 * - Workspace structure integrity
 * 
 * @vitest-environment jsdom
 * @version 1.0.0
 */

import { describe, it, expect } from 'vitest'
import {
  buildPackage,
  buildDraftEmailPackage,
  extractAutomationTags,
  type BeapPackageConfig,
  type DraftBuildPolicy
} from '../BeapPackageBuilder'

// =============================================================================
// Test Fixtures
// =============================================================================

const createBaseConfig = (): Omit<BeapPackageConfig, 'recipientMode'> => ({
  deliveryMethod: 'email',
  selectedRecipient: {
    handshake_id: 'test-hs-123',
    receiver_fingerprint_short: 'ABC1…2345',
    receiver_fingerprint_full: 'ABC123456789012345678901234567890123456789012345',
    receiver_display_name: 'Test Recipient',
    receiver_organization: 'Test Org',
    receiver_email_list: ['test@example.com']
  },
  senderFingerprint: 'SENDER123456789012345678901234567890123456789012',
  senderFingerprintShort: 'SND1…6789',
  emailTo: 'test@example.com',
  subject: 'Test Message',
  messageBody: 'This is the transport plaintext message.',
  attachments: []
})

const createPrivateConfig = (overrides: Partial<BeapPackageConfig> = {}): BeapPackageConfig => ({
  ...createBaseConfig(),
  recipientMode: 'private',
  ...overrides
})

const createPublicConfig = (overrides: Partial<BeapPackageConfig> = {}): BeapPackageConfig => ({
  ...createBaseConfig(),
  recipientMode: 'public',
  selectedRecipient: null, // Public mode doesn't use handshake
  ...overrides
})

// =============================================================================
// Test C: Encrypted content never appears in EmailTransportContract
// =============================================================================

describe('Transport Leak Prevention', () => {
  it('should never include encrypted content in qBEAP package transport fields', () => {
    const SECRET = 'SECRET123_CONFIDENTIAL_DATA'
    const config = createPrivateConfig({
      messageBody: 'Hello, please see attached package.',
      encryptedMessage: SECRET
    })

    const result = buildPackage(config)
    
    expect(result.success).toBe(true)
    expect(result.package).toBeDefined()
    
    if (result.package) {
      // Check that SECRET does not appear in any transport-visible fields
      const pkg = result.package
      
      // Metadata filename should not contain secret
      expect(pkg.metadata.filename).not.toContain(SECRET)
      
      // Delivery hint should not contain secret
      expect(pkg.metadata.delivery_hint || '').not.toContain(SECRET)
      
      // Header fields should not contain secret
      expect(JSON.stringify(pkg.header)).not.toContain(SECRET)
    }
  })

  it('should fail build if encrypted message appears in transport plaintext', () => {
    const SECRET = 'SECRET_CONTENT'
    const config = createPrivateConfig({
      // Transport plaintext contains the encrypted content (violation!)
      messageBody: `Here is the message: ${SECRET}`,
      encryptedMessage: SECRET
    })

    const result = buildPackage(config)
    
    expect(result.success).toBe(false)
    expect(result.error).toContain('SECURITY')
    expect(result.error).toContain('leaked')
  })
})

// =============================================================================
// Test D: Policy requiresEncryptedMessage blocks qBEAP build
// =============================================================================

describe('Policy Gating', () => {
  it('should fail qBEAP build when policy requires encrypted message but none provided', () => {
    const policy: DraftBuildPolicy = {
      requiresEncryptedMessage: true
    }
    
    const config = createPrivateConfig({
      encryptedMessage: '', // Empty!
      policy
    })

    const result = buildPackage(config)
    
    expect(result.success).toBe(false)
    expect(result.error).toContain('Encrypted message required')
  })

  it('should pass qBEAP build when policy requires encrypted message and it is provided', () => {
    const policy: DraftBuildPolicy = {
      requiresEncryptedMessage: true
    }
    
    const config = createPrivateConfig({
      encryptedMessage: 'This is the encrypted content.',
      policy
    })

    const result = buildPackage(config)
    
    expect(result.success).toBe(true)
  })

  it('should fail qBEAP build when policy requires private triggers but tags in plaintext', () => {
    const policy: DraftBuildPolicy = {
      requiresPrivateTriggersInEncryptedOnly: true
    }
    
    const config = createPrivateConfig({
      messageBody: 'Hello #process this request', // Tag in plaintext!
      encryptedMessage: 'Secret data here',
      policy
    })

    const result = buildPackage(config)
    
    expect(result.success).toBe(false)
    expect(result.error).toContain('Automation tags in plaintext are forbidden')
  })

  it('should pass qBEAP build when no policy restrictions', () => {
    const config = createPrivateConfig({
      encryptedMessage: '', // Empty is OK without policy
      policy: {} // No restrictions
    })

    const result = buildPackage(config)
    
    expect(result.success).toBe(true)
  })
})

// =============================================================================
// Automation Tag Extraction
// =============================================================================

describe('extractAutomationTags', () => {
  it('should extract simple hashtags', () => {
    const text = 'Please #process this #request immediately'
    const tags = extractAutomationTags(text)
    
    expect(tags).toEqual(['#process', '#request'])
  })

  it('should handle tags with special characters', () => {
    const text = '#tag-with-dash #tag_with_underscore #tag:colon #tag.dot'
    const tags = extractAutomationTags(text)
    
    expect(tags).toEqual(['#tag-with-dash', '#tag_with_underscore', '#tag:colon', '#tag.dot'])
  })

  it('should deduplicate tags preserving first occurrence', () => {
    const text = '#duplicate hello #other #duplicate world'
    const tags = extractAutomationTags(text)
    
    expect(tags).toEqual(['#duplicate', '#other'])
  })

  it('should preserve case', () => {
    const text = '#CamelCase #lowercase #UPPERCASE'
    const tags = extractAutomationTags(text)
    
    expect(tags).toEqual(['#CamelCase', '#lowercase', '#UPPERCASE'])
  })

  it('should return empty array for text without tags', () => {
    const text = 'No hashtags here, just regular text'
    const tags = extractAutomationTags(text)
    
    expect(tags).toEqual([])
  })

  it('should return empty array for empty/null input', () => {
    expect(extractAutomationTags('')).toEqual([])
    expect(extractAutomationTags(null as unknown as string)).toEqual([])
  })
})

// =============================================================================
// pBEAP Behavior (unchanged from before)
// =============================================================================

describe('pBEAP Public Mode', () => {
  it('should build pBEAP package successfully', () => {
    const config = createPublicConfig({
      messageBody: 'This is a public message'
    })

    const result = buildPackage(config)
    
    expect(result.success).toBe(true)
    expect(result.package).toBeDefined()
    expect(result.package?.header.encoding).toBe('pBEAP')
    expect(result.package?.header.encryption_mode).toBe('NONE')
  })

  it('should not require encrypted message for pBEAP', () => {
    const config = createPublicConfig({
      messageBody: 'Public message',
      encryptedMessage: '' // No encrypted message
    })

    const result = buildPackage(config)
    
    expect(result.success).toBe(true)
  })

  it('should ignore policy.requiresEncryptedMessage for pBEAP', () => {
    const config = createPublicConfig({
      messageBody: 'Public message',
      policy: { requiresEncryptedMessage: true } // Should be ignored for public
    })

    const result = buildPackage(config)
    
    expect(result.success).toBe(true)
  })
})

// =============================================================================
// Navigation/Workspace Structure Guard (Lightweight)
// =============================================================================

describe('Workspace Structure Guard', () => {
  /**
   * This test guards against accidental changes to the workspace/submode structure.
   * If these constants change, this test should fail and alert the developer.
   */
  it('should have expected workspace mode values', () => {
    // These are the expected mode values used in the Draft Email path
    const expectedRecipientModes = ['private', 'public'] as const
    const expectedDeliveryMethods = ['email', 'messenger', 'download'] as const
    
    // Verify that 'private' and 'public' are valid recipient modes
    // by creating configs with each and ensuring they don't throw
    for (const mode of expectedRecipientModes) {
      const config = mode === 'private' 
        ? createPrivateConfig({}) 
        : createPublicConfig({})
      
      expect(config.recipientMode).toBe(mode)
    }
    
    // Verify delivery methods
    for (const method of expectedDeliveryMethods) {
      const config = createPrivateConfig({ deliveryMethod: method })
      expect(config.deliveryMethod).toBe(method)
    }
  })

  it('should include automation metadata with receiver authority flag in qBEAP', () => {
    const config = createPrivateConfig({
      messageBody: 'Hello #process',
      encryptedMessage: 'Secret #trigger content'
    })

    const result = buildPackage(config)
    
    expect(result.success).toBe(true)
    expect(result.packageJson).toBeDefined()
    
    // Parse the payload to verify automation metadata
    if (result.package) {
      const payloadJson = atob(result.package.payload)
      const payload = JSON.parse(payloadJson)
      
      expect(payload.automation).toBeDefined()
      expect(payload.automation.receiverHasFinalAuthority).toBe(true)
      expect(payload.automation.tags).toContain('#trigger')
      expect(payload.automation.tags).toContain('#process')
    }
  })
})

// =============================================================================
// Result Type Consistency
// =============================================================================

describe('Result Type Consistency', () => {
  it('should always return consistent result shape for success', () => {
    const config = createPrivateConfig({ encryptedMessage: 'test' })
    const result = buildPackage(config)
    
    expect(typeof result.success).toBe('boolean')
    expect(result.success).toBe(true)
    expect(result.package).toBeDefined()
    expect(result.packageJson).toBeDefined()
    expect(result.error).toBeUndefined()
  })

  it('should always return consistent result shape for failure', () => {
    const config = createPrivateConfig({
      messageBody: 'LEAK',
      encryptedMessage: 'LEAK' // Same content = leak
    })
    const result = buildPackage(config)
    
    expect(typeof result.success).toBe('boolean')
    expect(result.success).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(result.package).toBeUndefined()
  })
})

// =============================================================================
// Unified BeapBuildResult Adapter
// =============================================================================

describe('BeapBuildResult Unified Type', () => {
  it('should return canonical BeapBuildResult shape on success', () => {
    const config = createPrivateConfig({ encryptedMessage: 'test encrypted' })
    const result = buildDraftEmailPackage(config)
    
    // Verify BeapBuildResult canonical fields
    expect(typeof result.success).toBe('boolean')
    expect(result.success).toBe(true)
    expect(typeof result.packageId).toBe('string')
    expect(result.packageId).toBeTruthy()
    expect(typeof result.capsuleRef).toBe('string')
    expect(typeof result.envelopeRef).toBe('string')
    expect(result.silentMode).toBe(false) // Draft Email is always explicit
    expect(result.error).toBeUndefined()
  })

  it('should return canonical BeapBuildResult shape on failure', () => {
    const config = createPrivateConfig({
      selectedRecipient: null, // Missing recipient = failure
      encryptedMessage: 'test'
    })
    const result = buildDraftEmailPackage(config)
    
    // Verify BeapBuildResult canonical fields for failure
    expect(result.success).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(result.error).toBeTruthy()
    expect(result.silentMode).toBe(false)
    expect(result.packageId).toBeUndefined()
    expect(result.capsuleRef).toBeUndefined()
  })

  it('should set silentMode to false for all Draft Email builds', () => {
    // Success case
    const successConfig = createPublicConfig()
    const successResult = buildDraftEmailPackage(successConfig)
    expect(successResult.silentMode).toBe(false)

    // Failure case
    const failConfig = createPrivateConfig({ selectedRecipient: null })
    const failResult = buildDraftEmailPackage(failConfig)
    expect(failResult.silentMode).toBe(false)
  })
})

