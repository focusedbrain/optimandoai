/**
 * NLP Classifier
 * 
 * Uses wink-nlp for tokenization and entity extraction, with a robust
 * fallback parser for when NLP is unavailable or fails.
 * 
 * Features:
 * - Lazy model initialization (only loads when first used)
 * - Trigger detection (any token starting with #)
 * - Entity extraction (dates, numbers, emails, URLs)
 * - Error-tolerant: always returns valid ClassifiedInput
 */

import type {
  ClassifiedInput,
  ClassificationResult,
  ExtractedEntity,
  NlpClassifierConfig
} from './types'

// wink-nlp types
type WinkNlp = any
type WinkModel = any
type WinkDoc = any

/**
 * NLP Classifier - Central text classification engine
 */
export class NlpClassifier {
  private config: Required<NlpClassifierConfig>
  private nlp: WinkNlp | null = null
  private model: WinkModel | null = null
  private isInitializing = false
  private initPromise: Promise<void> | null = null
  private initError: string | null = null

  constructor(config: NlpClassifierConfig = {}) {
    this.config = {
      debug: config.debug ?? false,
      language: config.language ?? 'en',
      extractEntities: config.extractEntities ?? true,
      detectIntents: config.detectIntents ?? false,
      triggerPrefix: config.triggerPrefix ?? '#'
    }
  }

  /**
   * Log debug information
   */
  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log('[NlpClassifier]', ...args)
    }
  }

  /**
   * Initialize wink-nlp lazily
   */
  private async initialize(): Promise<void> {
    if (this.nlp) return
    if (this.initError) return // Don't retry if init failed

    if (this.isInitializing && this.initPromise) {
      await this.initPromise
      return
    }

    this.isInitializing = true
    this.initPromise = this.doInitialize()

    try {
      await this.initPromise
    } finally {
      this.isInitializing = false
    }
  }

  private async doInitialize(): Promise<void> {
    try {
      this.log('Initializing wink-nlp...')
      
      // Dynamic import for lazy loading
      const winkNLP = (await import('wink-nlp')).default
      const model = (await import('wink-eng-lite-web-model')).default

      this.nlp = winkNLP(model)
      this.model = model
      
      this.log('wink-nlp initialized successfully')
    } catch (error: any) {
      this.initError = error.message || String(error)
      console.warn('[NlpClassifier] Failed to initialize wink-nlp:', this.initError)
      console.warn('[NlpClassifier] Falling back to regex-based parsing')
    }
  }

  /**
   * Classify input text into structured JSON
   */
  async classify(
    rawText: string,
    source: 'inline_chat' | 'ocr' | 'other' = 'inline_chat',
    options?: { sourceUrl?: string; ocrConfidence?: number; sessionKey?: string }
  ): Promise<ClassificationResult> {
    const startTime = Date.now()
    const errors: string[] = []

    // Ensure initialized
    await this.initialize()

    let triggers: string[] = []
    let entities: ExtractedEntity[] = []
    let intents: string[] | undefined

    try {
      if (this.nlp) {
        // Use wink-nlp for parsing
        const result = this.parseWithWink(rawText)
        triggers = result.triggers
        entities = result.entities
        intents = result.intents
      } else {
        // Fallback to regex parsing
        if (this.initError) {
          errors.push(`NLP init failed: ${this.initError}`)
        }
        const result = this.parseWithRegex(rawText)
        triggers = result.triggers
        entities = result.entities
      }
    } catch (error: any) {
      errors.push(`Parse error: ${error.message || String(error)}`)
      // Use fallback on any error
      const result = this.parseWithRegex(rawText)
      triggers = result.triggers
      entities = result.entities
    }

    const classifiedInput: ClassifiedInput = {
      rawText,
      normalizedText: this.normalizeText(rawText),
      triggers,
      entities,
      intents,
      source,
      errors,
      timestampIso: new Date().toISOString(),
      ocrConfidence: options?.ocrConfidence,
      sourceUrl: options?.sourceUrl,
      sessionKey: options?.sessionKey
    }

    const processingTimeMs = Date.now() - startTime
    this.log(`Classification complete in ${processingTimeMs}ms:`, {
      triggers: triggers.length,
      entities: entities.length,
      errors: errors.length
    })

    return {
      success: errors.length === 0,
      input: classifiedInput,
      processingTimeMs
    }
  }

  /**
   * Parse text using wink-nlp
   */
  private parseWithWink(text: string): {
    triggers: string[]
    entities: ExtractedEntity[]
    intents?: string[]
  } {
    const triggers: string[] = []
    const entities: ExtractedEntity[] = []

    if (!this.nlp) {
      return { triggers, entities }
    }

    const doc: WinkDoc = this.nlp.readDoc(text)
    const tokens = doc.tokens()

    // Process each token
    tokens.each((token: any) => {
      const value = token.out()
      const tokenText = value as string

      // Check for triggers (# prefix)
      if (tokenText.startsWith(this.config.triggerPrefix)) {
        triggers.push(tokenText)
        
        // Also add as hashtag entity
        const tokenIndex = text.indexOf(tokenText)
        if (tokenIndex >= 0) {
          entities.push({
            type: 'hashtag',
            value: tokenText,
            start: tokenIndex,
            end: tokenIndex + tokenText.length
          })
        }
      }

      // Check for @ mentions (backward compatibility)
      if (tokenText.startsWith('@') && tokenText.length > 1) {
        const tokenIndex = text.indexOf(tokenText)
        if (tokenIndex >= 0) {
          entities.push({
            type: 'mention',
            value: tokenText,
            start: tokenIndex,
            end: tokenIndex + tokenText.length
          })
        }
      }
    })

    // Extract named entities using wink-nlp's entity recognition
    try {
      const winkEntities = doc.entities()
      winkEntities.each((entity: any) => {
        const entityText = entity.out()
        const entityType = entity.out(this.nlp.its.type) as string
        const entityIndex = text.indexOf(entityText)

        if (entityIndex >= 0) {
          entities.push({
            type: this.mapWinkEntityType(entityType),
            value: entityText,
            start: entityIndex,
            end: entityIndex + entityText.length
          })
        }
      })
    } catch (e) {
      this.log('Entity extraction warning:', e)
    }

    // Also use regex to catch patterns wink might miss
    const regexEntities = this.extractEntitiesWithRegex(text)
    for (const entity of regexEntities) {
      // Avoid duplicates
      if (!entities.some(e => e.start === entity.start && e.end === entity.end)) {
        entities.push(entity)
      }
    }

    // Simple intent detection based on keywords
    const intents = this.config.detectIntents ? this.detectIntents(text) : undefined

    return { triggers, entities, intents }
  }

  /**
   * Map wink-nlp entity types to our simplified types
   */
  private mapWinkEntityType(winkType: string): ExtractedEntity['type'] {
    const typeMap: Record<string, ExtractedEntity['type']> = {
      'DATE': 'date',
      'TIME': 'time',
      'PERSON': 'person',
      'ORG': 'org',
      'ORGANIZATION': 'org',
      'CARDINAL': 'number',
      'ORDINAL': 'number',
      'MONEY': 'number',
      'PERCENT': 'number',
      'EMAIL': 'email',
      'URL': 'url',
      'HASHTAG': 'hashtag'
    }
    return typeMap[winkType?.toUpperCase()] || 'other'
  }

  /**
   * Fallback regex-based parser when wink-nlp is unavailable
   */
  private parseWithRegex(text: string): {
    triggers: string[]
    entities: ExtractedEntity[]
  } {
    const triggers: string[] = []
    const entities: ExtractedEntity[] = []

    // Extract triggers (#word patterns)
    const triggerRegex = /#[\w\-]+/g
    let match: RegExpExecArray | null
    while ((match = triggerRegex.exec(text)) !== null) {
      triggers.push(match[0])
      entities.push({
        type: 'hashtag',
        value: match[0],
        start: match.index,
        end: match.index + match[0].length
      })
    }

    // Extract other entities
    const regexEntities = this.extractEntitiesWithRegex(text)
    entities.push(...regexEntities)

    return { triggers, entities }
  }

  /**
   * Extract entities using regex patterns
   */
  private extractEntitiesWithRegex(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = []

    // Date patterns (European and US formats)
    const datePatterns = [
      /\b(\d{1,2})[./-](\d{1,2})[./-]?(\d{2,4})?\b/g,  // 17.8., 17.8.2024, 17/8/24
      /\b(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*(\d{2,4})?\b/gi,
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{0,4}\b/gi
    ]

    for (const pattern of datePatterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(text)) !== null) {
        entities.push({
          type: 'date',
          value: match[0],
          start: match.index,
          end: match.index + match[0].length
        })
      }
    }

    // Time patterns
    const timePattern = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?\b/g
    let timeMatch: RegExpExecArray | null
    while ((timeMatch = timePattern.exec(text)) !== null) {
      entities.push({
        type: 'time',
        value: timeMatch[0],
        start: timeMatch.index,
        end: timeMatch.index + timeMatch[0].length
      })
    }

    // Email pattern
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
    let emailMatch: RegExpExecArray | null
    while ((emailMatch = emailPattern.exec(text)) !== null) {
      entities.push({
        type: 'email',
        value: emailMatch[0],
        start: emailMatch.index,
        end: emailMatch.index + emailMatch[0].length
      })
    }

    // URL pattern
    const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g
    let urlMatch: RegExpExecArray | null
    while ((urlMatch = urlPattern.exec(text)) !== null) {
      entities.push({
        type: 'url',
        value: urlMatch[0],
        start: urlMatch.index,
        end: urlMatch.index + urlMatch[0].length
      })
    }

    // Number patterns (integers, decimals, currencies)
    const numberPattern = /\b(?:[€$£¥]\s*)?[\d,]+(?:\.\d+)?(?:\s*[€$£¥%])?\b/g
    let numMatch: RegExpExecArray | null
    while ((numMatch = numberPattern.exec(text)) !== null) {
      // Skip if it's part of a date/time we already extracted
      const isPartOfOther = entities.some(e => 
        numMatch!.index >= e.start && numMatch!.index < e.end
      )
      if (!isPartOfOther && /\d/.test(numMatch[0])) {
        entities.push({
          type: 'number',
          value: numMatch[0],
          start: numMatch.index,
          end: numMatch.index + numMatch[0].length
        })
      }
    }

    // @ mentions (backward compatibility)
    const mentionPattern = /@[\w-]+/g
    let mentionMatch: RegExpExecArray | null
    while ((mentionMatch = mentionPattern.exec(text)) !== null) {
      entities.push({
        type: 'mention',
        value: mentionMatch[0],
        start: mentionMatch.index,
        end: mentionMatch.index + mentionMatch[0].length
      })
    }

    return entities
  }

  /**
   * Simple keyword-based intent detection
   */
  private detectIntents(text: string): string[] {
    const intents: string[] = []
    const lowerText = text.toLowerCase()

    const intentKeywords: Record<string, string[]> = {
      'schedule': ['termin', 'meeting', 'appointment', 'schedule', 'calendar', 'book'],
      'invoice': ['rechnung', 'invoice', 'bill', 'payment', 'buchhaltung', 'accounting'],
      'search': ['search', 'find', 'look for', 'suche', 'finden'],
      'summarize': ['summarize', 'summary', 'zusammenfassung', 'zusammenfassen'],
      'translate': ['translate', 'übersetzen', 'translation'],
      'create': ['create', 'make', 'erstellen', 'anlegen', 'new'],
      'update': ['update', 'change', 'modify', 'ändern', 'aktualisieren'],
      'delete': ['delete', 'remove', 'löschen', 'entfernen']
    }

    for (const [intent, keywords] of Object.entries(intentKeywords)) {
      if (keywords.some(kw => lowerText.includes(kw))) {
        intents.push(intent)
      }
    }

    return intents
  }

  /**
   * Normalize text for comparison
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
  }

  /**
   * Quick trigger extraction without full classification
   * Useful for fast routing decisions
   */
  extractTriggers(text: string): string[] {
    const triggers: string[] = []
    const triggerRegex = /#[\w\-]+/g
    let match: RegExpExecArray | null
    while ((match = triggerRegex.exec(text)) !== null) {
      triggers.push(match[0])
    }
    return triggers
  }

  /**
   * Check if NLP engine is available
   */
  isNlpAvailable(): boolean {
    return this.nlp !== null
  }

  /**
   * Get initialization status
   */
  getStatus(): { initialized: boolean; error?: string } {
    return {
      initialized: this.nlp !== null,
      error: this.initError || undefined
    }
  }
}

/**
 * Default singleton instance
 */
export const nlpClassifier = new NlpClassifier({ debug: false })

