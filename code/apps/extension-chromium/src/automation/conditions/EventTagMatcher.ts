/**
 * Event Tag Trigger Matcher
 * 
 * Deterministic evaluation engine for Event Tag (direct_tag) triggers.
 * 
 * Matching Flow:
 * 1. Match by channel (email, chat, web, etc.)
 * 2. Match by tag (tag must be in event's extractedTags)
 * 3. Evaluate conditions sequentially (all must pass)
 * 
 * This module does NOT use any LLM or fuzzy matching at runtime.
 * All decisions are based on exact matches and structured conditions.
 * 
 * @example
 * ```typescript
 * const matcher = new EventTagMatcher()
 * const result = matcher.evaluate(event, triggerConfig)
 * if (result.matched) {
 *   // Trigger should fire
 * }
 * ```
 */

import type {
  NormalizedEvent,
  UnifiedTriggerConfig,
  EventTagCondition,
  EventChannel,
  WRCodeCondition,
  SenderWhitelistCondition,
  BodyKeywordsCondition,
  WebsiteFilterCondition
} from '../types'

/**
 * Result of evaluating a trigger against an event
 */
export interface MatchResult {
  /** Whether the trigger matched */
  matched: boolean
  
  /** Reason for the result (for debugging) */
  reason: string
  
  /** Which conditions passed (for debugging) */
  conditionResults?: Array<{
    type: string
    passed: boolean
    details: string
  }>
}

/**
 * Validation result for trigger configuration
 */
export interface TriggerValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Event Tag Matcher
 * 
 * Evaluates Event Tag triggers against normalized events using
 * deterministic matching logic.
 */
export class EventTagMatcher {
  /**
   * Evaluate a trigger against an event
   * 
   * @param event - The normalized event to match
   * @param trigger - The trigger configuration
   * @returns Match result with reason and condition details
   */
  evaluate(event: NormalizedEvent, trigger: UnifiedTriggerConfig): MatchResult {
    // Only handle direct_tag triggers
    if (trigger.type !== 'direct_tag') {
      return { matched: false, reason: 'Not a direct_tag trigger' }
    }
    
    // 1. Channel matching (if specified)
    if (trigger.channel && event.channel) {
      if (!this.matchChannel(event.channel, trigger.channel)) {
        return { 
          matched: false, 
          reason: `Channel mismatch: expected ${trigger.channel}, got ${event.channel}` 
        }
      }
    }
    
    // 2. Tag matching (required)
    const tag = trigger.tag || (trigger.tagName ? `#${trigger.tagName}` : null)
    if (!tag) {
      return { matched: false, reason: 'No tag configured' }
    }
    
    if (!this.matchTag(event, tag)) {
      return { 
        matched: false, 
        reason: `Tag ${tag} not found in event` 
      }
    }
    
    // 3. Evaluate structured conditions (if any)
    const conditions = trigger.eventTagConditions || []
    const conditionResults: MatchResult['conditionResults'] = []
    
    for (const condition of conditions) {
      const result = this.evaluateCondition(event, condition)
      conditionResults.push(result)
      
      if (!result.passed) {
        return {
          matched: false,
          reason: `Condition failed: ${result.type} - ${result.details}`,
          conditionResults
        }
      }
    }
    
    // 4. Legacy: evaluate expectedContext as keywords (backward compatibility)
    if (trigger.expectedContext && !trigger.eventTagConditions?.length) {
      const keywords = trigger.expectedContext.split(',').map(k => k.trim()).filter(Boolean)
      if (keywords.length > 0) {
        const legacyResult = this.evaluateBodyKeywords(event, {
          type: 'body_keywords',
          keywords,
          caseInsensitive: true
        })
        conditionResults.push(legacyResult)
        
        if (!legacyResult.passed) {
          return {
            matched: false,
            reason: `Legacy context condition failed: ${legacyResult.details}`,
            conditionResults
          }
        }
      }
    }
    
    // 5. Legacy: evaluate websiteFilter (backward compatibility)
    if (trigger.websiteFilter && !trigger.eventTagConditions?.some(c => c.type === 'website_filter')) {
      const legacyResult = this.evaluateWebsiteFilter(event, {
        type: 'website_filter',
        patterns: [trigger.websiteFilter]
      })
      conditionResults.push(legacyResult)
      
      if (!legacyResult.passed) {
        return {
          matched: false,
          reason: `Legacy website filter failed: ${legacyResult.details}`,
          conditionResults
        }
      }
    }
    
    return {
      matched: true,
      reason: `Matched tag ${tag}${conditions.length ? ` with ${conditions.length} conditions` : ''}`,
      conditionResults
    }
  }
  
  /**
   * Validate a trigger configuration
   * 
   * @param trigger - The trigger to validate
   * @returns Validation result with errors and warnings
   */
  validateTrigger(trigger: UnifiedTriggerConfig): TriggerValidationResult {
    const errors: string[] = []
    const warnings: string[] = []
    
    if (trigger.type !== 'direct_tag') {
      return { valid: true, errors: [], warnings: [] }
    }
    
    // Tag validation
    const tag = trigger.tag || (trigger.tagName ? `#${trigger.tagName}` : null)
    if (!tag) {
      errors.push('Tag is required')
    } else if (!tag.startsWith('#')) {
      errors.push('Tag must start with #')
    } else if (!/^#[\w-]+$/.test(tag)) {
      errors.push('Tag must contain only letters, numbers, hyphens, and underscores')
    }
    
    // Condition validation
    if (trigger.eventTagConditions) {
      for (const condition of trigger.eventTagConditions) {
        const condErrors = this.validateCondition(condition)
        errors.push(...condErrors)
      }
    }
    
    // Legacy field warnings
    if (trigger.tagName) {
      warnings.push('tagName is deprecated, use tag instead')
    }
    if (trigger.expectedContext) {
      warnings.push('expectedContext is deprecated, use eventTagConditions with body_keywords instead')
    }
    if (trigger.websiteFilter && !trigger.eventTagConditions?.some(c => c.type === 'website_filter')) {
      warnings.push('websiteFilter is deprecated, use eventTagConditions with website_filter instead')
    }
    
    return { valid: errors.length === 0, errors, warnings }
  }
  
  /**
   * Validate a single condition
   */
  private validateCondition(condition: EventTagCondition): string[] {
    const errors: string[] = []
    
    switch (condition.type) {
      case 'wrcode_valid':
        // No specific validation needed
        break
        
      case 'sender_whitelist':
        if (!condition.allowedSenders || condition.allowedSenders.length === 0) {
          errors.push('Sender whitelist must have at least one email address')
        } else {
          for (const sender of condition.allowedSenders) {
            if (!this.isValidEmail(sender)) {
              errors.push(`Invalid email format: ${sender}`)
            }
          }
        }
        break
        
      case 'body_keywords':
        if (!condition.keywords || condition.keywords.length === 0) {
          errors.push('Body keywords must have at least one keyword')
        }
        break
        
      case 'website_filter':
        if (!condition.patterns || condition.patterns.length === 0) {
          errors.push('Website filter must have at least one pattern')
        }
        break
        
      default:
        errors.push(`Unknown condition type: ${(condition as any).type}`)
    }
    
    return errors
  }
  
  /**
   * Check if channels match
   */
  private matchChannel(eventChannel: EventChannel, triggerChannel: EventChannel): boolean {
    return eventChannel === triggerChannel
  }
  
  /**
   * Check if event contains the required tag
   */
  private matchTag(event: NormalizedEvent, tag: string): boolean {
    const normalizedTag = tag.toLowerCase()
    
    // Check extractedTags first
    if (event.extractedTags?.length) {
      return event.extractedTags.some(t => t.toLowerCase() === normalizedTag)
    }
    
    // Check metadata.tags (legacy format)
    const metadataTags = event.metadata?.tags as string[] | undefined
    if (metadataTags?.length) {
      return metadataTags.some(t => {
        const normalized = t.startsWith('#') ? t.toLowerCase() : `#${t.toLowerCase()}`
        return normalized === normalizedTag
      })
    }
    
    // Fallback: search in input text
    const searchText = [event.subject, event.body, event.input].filter(Boolean).join(' ').toLowerCase()
    return searchText.includes(normalizedTag)
  }
  
  /**
   * Evaluate a single condition
   */
  private evaluateCondition(
    event: NormalizedEvent, 
    condition: EventTagCondition
  ): { type: string; passed: boolean; details: string } {
    switch (condition.type) {
      case 'wrcode_valid':
        return this.evaluateWRCode(event, condition)
        
      case 'sender_whitelist':
        return this.evaluateSenderWhitelist(event, condition)
        
      case 'body_keywords':
        return this.evaluateBodyKeywords(event, condition)
        
      case 'website_filter':
        return this.evaluateWebsiteFilter(event, condition)
        
      default:
        return {
          type: 'unknown',
          passed: false,
          details: `Unknown condition type: ${(condition as any).type}`
        }
    }
  }
  
  /**
   * Evaluate WRCode validation condition
   */
  private evaluateWRCode(
    event: NormalizedEvent, 
    condition: WRCodeCondition
  ): { type: string; passed: boolean; details: string } {
    if (!condition.required) {
      return { type: 'wrcode_valid', passed: true, details: 'WRCode not required' }
    }
    
    const passed = event.wrcodeValid === true
    return {
      type: 'wrcode_valid',
      passed,
      details: passed ? 'WRCode validation passed' : 'WRCode validation failed or not present'
    }
  }
  
  /**
   * Evaluate sender whitelist condition
   */
  private evaluateSenderWhitelist(
    event: NormalizedEvent, 
    condition: SenderWhitelistCondition
  ): { type: string; passed: boolean; details: string } {
    if (!condition.allowedSenders || condition.allowedSenders.length === 0) {
      return { type: 'sender_whitelist', passed: true, details: 'No senders in whitelist' }
    }
    
    const sender = event.senderAddress?.toLowerCase()
    if (!sender) {
      return { 
        type: 'sender_whitelist', 
        passed: false, 
        details: 'No sender address in event' 
      }
    }
    
    const allowed = condition.allowedSenders.map(s => s.toLowerCase())
    const passed = allowed.includes(sender)
    
    return {
      type: 'sender_whitelist',
      passed,
      details: passed 
        ? `Sender ${sender} is in whitelist` 
        : `Sender ${sender} not in whitelist`
    }
  }
  
  /**
   * Evaluate body keywords condition
   */
  private evaluateBodyKeywords(
    event: NormalizedEvent, 
    condition: BodyKeywordsCondition
  ): { type: string; passed: boolean; details: string } {
    if (!condition.keywords || condition.keywords.length === 0) {
      return { type: 'body_keywords', passed: true, details: 'No keywords specified' }
    }
    
    // Build search text from available content
    const searchText = [event.subject, event.body, event.input]
      .filter(Boolean)
      .join(' ')
    
    const normalizedSearch = condition.caseInsensitive !== false 
      ? searchText.toLowerCase() 
      : searchText
    
    const matchedKeyword = condition.keywords.find(keyword => {
      const normalizedKeyword = condition.caseInsensitive !== false 
        ? keyword.toLowerCase() 
        : keyword
      return normalizedSearch.includes(normalizedKeyword)
    })
    
    return {
      type: 'body_keywords',
      passed: !!matchedKeyword,
      details: matchedKeyword 
        ? `Matched keyword: "${matchedKeyword}"` 
        : `None of ${condition.keywords.length} keywords found`
    }
  }
  
  /**
   * Evaluate website filter condition
   */
  private evaluateWebsiteFilter(
    event: NormalizedEvent, 
    condition: WebsiteFilterCondition
  ): { type: string; passed: boolean; details: string } {
    if (!condition.patterns || condition.patterns.length === 0) {
      return { type: 'website_filter', passed: true, details: 'No patterns specified' }
    }
    
    const url = event.url?.toLowerCase()
    const domain = event.domain?.toLowerCase()
    
    if (!url && !domain) {
      // No URL context - pass if channel is not web
      if (event.channel !== 'web') {
        return { type: 'website_filter', passed: true, details: 'Not a web event' }
      }
      return { type: 'website_filter', passed: false, details: 'No URL in web event' }
    }
    
    const matchedPattern = condition.patterns.find(pattern => {
      return this.matchUrlPattern(pattern.toLowerCase(), url, domain)
    })
    
    return {
      type: 'website_filter',
      passed: !!matchedPattern,
      details: matchedPattern 
        ? `Matched pattern: "${matchedPattern}"` 
        : `URL ${url || domain} did not match any patterns`
    }
  }
  
  /**
   * Match a URL pattern against URL and domain
   * Supports wildcards like *.example.com
   */
  private matchUrlPattern(pattern: string, url?: string, domain?: string): boolean {
    // Convert wildcard pattern to regex
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape regex chars except *
      .replace(/\*/g, '.*')                     // Convert * to .*
    
    const regex = new RegExp(`^${regexPattern}$`, 'i')
    
    // Try matching against URL first
    if (url && regex.test(url)) {
      return true
    }
    
    // Try matching against domain
    if (domain && regex.test(domain)) {
      return true
    }
    
    // Try partial match in URL
    if (url && url.includes(pattern.replace(/\*/g, ''))) {
      return true
    }
    
    return false
  }
  
  /**
   * Basic email format validation
   */
  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }
  
  /**
   * Extract tags from text content
   * 
   * @param text - Text to extract tags from
   * @returns Array of tags (with # prefix)
   */
  static extractTags(text: string): string[] {
    const matches = text.match(/#[\w-]+/g)
    return matches ? [...new Set(matches.map(t => t.toLowerCase()))] : []
  }
  
  /**
   * Normalize an incoming email event
   * 
   * Creates a properly normalized event from raw email data.
   * This is a helper for email processing pipelines.
   */
  static normalizeEmailEvent(params: {
    id?: string
    subject: string
    body: string
    senderAddress: string
    wrcodeValid?: boolean
    wrcodeData?: Record<string, any>
    timestamp?: number
  }): Partial<NormalizedEvent> {
    const combinedText = `${params.subject} ${params.body}`
    
    return {
      id: params.id || `email_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      timestamp: params.timestamp || Date.now(),
      source: 'api',
      channel: 'email',
      scope: 'global',
      modalities: ['text'],
      input: combinedText,
      subject: params.subject,
      body: params.body,
      senderAddress: params.senderAddress,
      wrcodeValid: params.wrcodeValid,
      wrcodeData: params.wrcodeData,
      extractedTags: EventTagMatcher.extractTags(combinedText),
      metadata: {
        tags: EventTagMatcher.extractTags(combinedText)
      }
    }
  }
}

/**
 * Singleton instance for convenience
 */
export const eventTagMatcher = new EventTagMatcher()

