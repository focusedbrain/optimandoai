/**
 * NlpClassifier Unit Tests
 */

import { NlpClassifier } from '../NlpClassifier'
import type { ClassifiedInput } from '../types'

describe('NlpClassifier', () => {
  let classifier: NlpClassifier

  beforeEach(() => {
    classifier = new NlpClassifier({ debug: false })
  })

  describe('extractTriggers', () => {
    it('should extract single trigger with # prefix', () => {
      const triggers = classifier.extractTriggers('Hello #termin17 world')
      expect(triggers).toEqual(['#termin17'])
    })

    it('should extract multiple triggers', () => {
      const triggers = classifier.extractTriggers('Process #termin17 #buchhaltung please')
      expect(triggers).toContain('#termin17')
      expect(triggers).toContain('#buchhaltung')
      expect(triggers).toHaveLength(2)
    })

    it('should extract triggers with hyphens', () => {
      const triggers = classifier.extractTriggers('Check #invoice-2024 now')
      expect(triggers).toEqual(['#invoice-2024'])
    })

    it('should return empty array for no triggers', () => {
      const triggers = classifier.extractTriggers('Hello world with no triggers')
      expect(triggers).toEqual([])
    })

    it('should handle German text with umlauts in surrounding words', () => {
      const triggers = classifier.extractTriggers('Bitte den Termin für #meeting123 eintragen')
      expect(triggers).toEqual(['#meeting123'])
    })
  })

  describe('classify', () => {
    it('should classify simple text with trigger', async () => {
      const result = await classifier.classify(
        'Bitte trage den Termin am 17.8. ein #termin17 #buchhaltung',
        'inline_chat'
      )

      expect(result.success).toBe(true)
      expect(result.input.triggers).toContain('#termin17')
      expect(result.input.triggers).toContain('#buchhaltung')
      expect(result.input.source).toBe('inline_chat')
      expect(result.input.errors).toEqual([])
      expect(result.input.timestampIso).toBeDefined()
    })

    it('should extract date entities', async () => {
      const result = await classifier.classify(
        'Meeting on 17.8.2024 at 14:30',
        'inline_chat'
      )

      expect(result.success).toBe(true)
      
      // Should have date entity
      const dateEntity = result.input.entities.find(e => e.type === 'date')
      expect(dateEntity).toBeDefined()
      expect(dateEntity?.value).toContain('17')
      
      // Should have time entity
      const timeEntity = result.input.entities.find(e => e.type === 'time')
      expect(timeEntity).toBeDefined()
      expect(timeEntity?.value).toContain('14:30')
    })

    it('should extract email entities', async () => {
      const result = await classifier.classify(
        'Send to test@example.com please',
        'inline_chat'
      )

      expect(result.success).toBe(true)
      const emailEntity = result.input.entities.find(e => e.type === 'email')
      expect(emailEntity).toBeDefined()
      expect(emailEntity?.value).toBe('test@example.com')
    })

    it('should extract URL entities', async () => {
      const result = await classifier.classify(
        'Check https://example.com/page for details',
        'inline_chat'
      )

      expect(result.success).toBe(true)
      const urlEntity = result.input.entities.find(e => e.type === 'url')
      expect(urlEntity).toBeDefined()
      expect(urlEntity?.value).toBe('https://example.com/page')
    })

    it('should set source correctly for OCR input', async () => {
      const result = await classifier.classify(
        'Some OCR extracted text',
        'ocr'
      )

      expect(result.input.source).toBe('ocr')
    })

    it('should include processing time', async () => {
      const result = await classifier.classify('Test text', 'inline_chat')
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should normalize text to lowercase', async () => {
      const result = await classifier.classify(
        'HELLO World #Test',
        'inline_chat'
      )

      expect(result.input.normalizedText).toBe('hello world #test')
    })

    it('should handle empty string gracefully', async () => {
      const result = await classifier.classify('', 'inline_chat')
      
      expect(result.success).toBe(true)
      expect(result.input.triggers).toEqual([])
      expect(result.input.entities).toEqual([])
    })

    it('should preserve rawText exactly as provided', async () => {
      const input = 'Hello  World   #test'
      const result = await classifier.classify(input, 'inline_chat')
      
      expect(result.input.rawText).toBe(input)
    })

    it('should include optional metadata', async () => {
      const result = await classifier.classify(
        'Test',
        'ocr',
        { sourceUrl: 'https://test.com', ocrConfidence: 85, sessionKey: 'session123' }
      )

      expect(result.input.sourceUrl).toBe('https://test.com')
      expect(result.input.ocrConfidence).toBe(85)
      expect(result.input.sessionKey).toBe('session123')
    })
  })

  describe('error handling', () => {
    it('should return errors array when issues occur', async () => {
      // Even if wink-nlp fails to load, fallback regex should work
      const result = await classifier.classify('#test input', 'inline_chat')
      
      // Should still extract triggers using regex fallback
      expect(result.input.triggers).toContain('#test')
      // errors array should exist (may be empty or have init errors)
      expect(Array.isArray(result.input.errors)).toBe(true)
    })

    it('should never throw on malformed input', async () => {
      // Various edge cases that shouldn't throw
      await expect(classifier.classify(null as any, 'inline_chat')).resolves.toBeDefined()
      await expect(classifier.classify(undefined as any, 'inline_chat')).resolves.toBeDefined()
      await expect(classifier.classify('###', 'inline_chat')).resolves.toBeDefined()
      await expect(classifier.classify('@@@', 'inline_chat')).resolves.toBeDefined()
    })
  })

  describe('getStatus', () => {
    it('should return status object', () => {
      const status = classifier.getStatus()
      expect(status).toHaveProperty('initialized')
      // May or may not have error depending on wink-nlp availability
    })
  })

  describe('ClassifiedInput structure', () => {
    it('should have all required fields', async () => {
      const result = await classifier.classify('Test #trigger', 'inline_chat')
      const input = result.input

      // Required fields
      expect(input).toHaveProperty('rawText')
      expect(input).toHaveProperty('normalizedText')
      expect(input).toHaveProperty('triggers')
      expect(input).toHaveProperty('entities')
      expect(input).toHaveProperty('source')
      expect(input).toHaveProperty('errors')
      expect(input).toHaveProperty('timestampIso')

      // Types
      expect(typeof input.rawText).toBe('string')
      expect(typeof input.normalizedText).toBe('string')
      expect(Array.isArray(input.triggers)).toBe(true)
      expect(Array.isArray(input.entities)).toBe(true)
      expect(Array.isArray(input.errors)).toBe(true)
      expect(typeof input.timestampIso).toBe('string')
    })

    it('should have valid ISO timestamp', async () => {
      const result = await classifier.classify('Test', 'inline_chat')
      const timestamp = new Date(result.input.timestampIso)
      
      expect(timestamp.getTime()).not.toBeNaN()
      expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('integration scenario', () => {
    it('should correctly classify German appointment text', async () => {
      const input = 'Bitte trage den Termin am 17.8. ein #termin17 #buchhaltung'
      const result = await classifier.classify(input, 'inline_chat')

      // Verify triggers
      expect(result.input.triggers).toContain('#termin17')
      expect(result.input.triggers).toContain('#buchhaltung')
      expect(result.input.triggers).toHaveLength(2)

      // Verify date entity
      const dateEntity = result.input.entities.find(e => e.type === 'date')
      expect(dateEntity).toBeDefined()
      expect(dateEntity?.value).toContain('17')

      // Verify structure
      expect(result.success).toBe(true)
      expect(result.input.rawText).toBe(input)
      expect(result.input.source).toBe('inline_chat')
    })
  })
})


